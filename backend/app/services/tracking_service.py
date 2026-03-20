"""
Tracking Service — orchestrates a full tracking run for a brand.

run_tracking(brand_id, run_type) -> int (run_id)

Workflow:
1.  Load brand + prompts from DB.
2.  Create a TrackingRun record (status=running).
3.  For every prompt × every model × N repetitions, fire an async query
    through llm_service.query_model, bounded by a semaphore (max 10
    concurrent requests).
4.  Persist every QueryResult row.
5.  Aggregate per-model scores and the overall score, then write
    RunModelScore rows and update the TrackingRun to status=completed.
6.  On any unhandled exception → status=failed + error_message.
"""
from __future__ import annotations

import asyncio
import logging
import re
from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import AsyncSessionLocal
from app.models import Brand, Prompt, TrackingRun, QueryResult, RunModelScore
from app.services.llm_service import query_model, SUPPORTED_MODELS, TIER_RUNS

logger = logging.getLogger(__name__)

MAX_CONCURRENT = 10


def _utcnow() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


def _normalize(text: str) -> str:
    """Lowercase and strip all non-alphanumeric characters."""
    return re.sub(r"[^a-z0-9]", "", text.lower())


def _detect_mention(
    brand_name: str,
    response_text: str | None,
    error: str | None,
    model: str,
) -> bool:
    if not response_text or error == "api_key_not_configured":
        return False

    brand_norm = _normalize(brand_name)
    response_norm = _normalize(response_text)

    # Exact case-insensitive match
    exact = brand_name.lower() in response_text.lower()
    # Normalized match (handles "Spotit Early" → "spotitearly" == "spotitearly")
    fuzzy = brand_norm in response_norm

    mentioned = exact or fuzzy

    logger.info(
        "[mention_detection] model=%s brand=%r brand_norm=%r "
        "exact=%s fuzzy=%s mentioned=%s | response_preview=%r",
        model,
        brand_name,
        brand_norm,
        exact,
        fuzzy,
        mentioned,
        response_text[:200],
    )
    return mentioned


async def run_tracking(
    brand_id: int,
    run_type: str = "manual",
    schedule_slot: str | None = None,
) -> int:
    """
    Execute a complete tracking run for the given brand.

    Returns the tracking_run.id so callers can surface it immediately
    (the heavy work happens inside this coroutine, which the caller should
    schedule with asyncio.create_task or a BackgroundTask).
    """
    # Extract values as plain Python types while the session is open, so we
    # never access SQLAlchemy-managed attributes on detached objects later.
    brand_name: str = ""
    brand_tier: str = "basic"
    prompt_data: list[tuple[int, str]] = []  # (prompt_id, prompt_text)
    run_id: int = 0

    async with AsyncSessionLocal() as db:
        # ── 1. Load brand ────────────────────────────────────────────────────
        brand_result = await db.execute(select(Brand).where(Brand.id == brand_id))
        brand: Brand | None = brand_result.scalar_one_or_none()
        if brand is None:
            raise ValueError(f"Brand {brand_id} not found")

        brand_name = str(brand.name)
        brand_tier = str(brand.tier)

        prompts_result = await db.execute(
            select(Prompt).where(Prompt.brand_id == brand_id)
        )
        prompt_data = [(p.id, p.text) for p in prompts_result.scalars().all()]
        if not prompt_data:
            raise ValueError(f"Brand {brand_id} has no prompts configured")

        runs_per_prompt = TIER_RUNS.get(brand_tier, TIER_RUNS["basic"])

        logger.info(
            "Scheduled run starting — brand=%r tier=%s prompts=%d runs_per_prompt=%d",
            brand_name, brand_tier, len(prompt_data), runs_per_prompt,
        )

        # ── 2. Create TrackingRun record ─────────────────────────────────────
        tracking_run = TrackingRun(
            brand_id=brand_id,
            status="running",
            run_type=run_type,
            schedule_slot=schedule_slot,
            started_at=_utcnow(),
        )
        db.add(tracking_run)
        await db.commit()
        await db.refresh(tracking_run)
        run_id = tracking_run.id

    # ── 3. Execute queries ───────────────────────────────────────────────────
    semaphore = asyncio.Semaphore(MAX_CONCURRENT)

    async def _bounded_query(
        prompt_id: int,
        prompt_text: str,
        model: str,
        run_number: int,
    ) -> QueryResult:
        async with semaphore:
            result = await query_model(model, prompt_text, brand_name)
        response_text = result.get("response_text")
        error = result.get("error")

        # Log every non-configuration error so nothing is silently swallowed
        if error and error != "api_key_not_configured":
            logger.warning(
                "[tracking] model=%s run_number=%d prompt=%r error=%s",
                model, run_number, prompt_text[:120], error,
            )

        mentioned = _detect_mention(brand_name, response_text, error, model)
        return QueryResult(
            tracking_run_id=run_id,
            prompt_id=prompt_id,
            model=model,
            run_number=run_number,
            response_text=response_text,
            mentioned=mentioned,
            latency_ms=result.get("latency_ms"),
            error=error,
        )

    tasks = [
        _bounded_query(pid, ptext, model, run_number)
        for pid, ptext in prompt_data
        for model in SUPPORTED_MODELS
        for run_number in range(1, runs_per_prompt + 1)
    ]

    try:
        query_results: list[QueryResult] = await asyncio.gather(*tasks)
    except Exception as exc:
        logger.exception("Fatal error during query gathering for run %d", run_id)
        async with AsyncSessionLocal() as db:
            run = await db.get(TrackingRun, run_id)
            if run:
                run.status = "failed"
                run.error_message = str(exc)
                run.completed_at = _utcnow()
                await db.commit()
        raise

    # ── 4 & 5. Persist results and compute scores ────────────────────────────
    async with AsyncSessionLocal() as db:
        try:
            # Bulk-insert query results
            for qr in query_results:
                db.add(qr)
            await db.flush()

            # Aggregate per-model stats
            model_stats: dict[str, dict] = {
                m: {"total_queries": 0, "total_mentions": 0}
                for m in SUPPORTED_MODELS
            }
            for qr in query_results:
                # Exclude ALL error responses from scoring — errors (rate limits,
                # timeouts, empty responses) should not count as "not mentioned"
                # and should not inflate the denominator.
                if qr.error:
                    continue
                stats = model_stats[qr.model]
                stats["total_queries"] += 1
                if qr.mentioned:
                    stats["total_mentions"] += 1

            overall_queries = 0
            overall_mentions = 0
            for model_name, stats in model_stats.items():
                tq = stats["total_queries"]
                tm = stats["total_mentions"]
                score = (tm / tq * 100.0) if tq > 0 else 0.0
                db.add(
                    RunModelScore(
                        tracking_run_id=run_id,
                        model=model_name,
                        total_queries=tq,
                        total_mentions=tm,
                        score=round(score, 2),
                    )
                )
                overall_queries += tq
                overall_mentions += tm

            overall_score = (
                (overall_mentions / overall_queries * 100.0)
                if overall_queries > 0
                else 0.0
            )

            # Update the TrackingRun
            run = await db.get(TrackingRun, run_id)
            if run:
                run.status = "completed"
                run.completed_at = _utcnow()
                run.overall_score = round(overall_score, 2)
                run.total_queries = overall_queries
                run.total_mentions = overall_mentions

            await db.commit()
            logger.info(
                "Tracking run %d completed. Score=%.2f%% (%d/%d)",
                run_id,
                overall_score,
                overall_mentions,
                overall_queries,
            )
        except Exception as exc:
            await db.rollback()
            logger.exception("Error persisting results for run %d", run_id)
            # Mark run as failed in a clean session
            async with AsyncSessionLocal() as err_db:
                run = await err_db.get(TrackingRun, run_id)
                if run:
                    run.status = "failed"
                    run.error_message = f"DB error: {exc}"
                    run.completed_at = _utcnow()
                    await err_db.commit()
            raise

    # ── 6. Classify sentiment for mentioned responses ────────────────────────
    logger.info("Scheduled run %d complete — starting sentiment classification", run_id)
    try:
        from app.services.sentiment_service import classify_sentiments_for_run

        await classify_sentiments_for_run(list(query_results), brand_name)
    except Exception as exc:
        logger.warning(
            "Sentiment classification failed for run %d (non-fatal): %s", run_id, exc
        )

    # ── 6b. Detect competitor mentions ───────────────────────────────────────
    logger.info("Running competitor mention detection for run %d", run_id)
    try:
        from app.models import Competitor as CompetitorModel, CompetitorMention

        async with AsyncSessionLocal() as comp_db:
            comps_result = await comp_db.execute(
                select(CompetitorModel).where(CompetitorModel.brand_id == brand_id)
            )
            competitors = comps_result.scalars().all()

            if competitors:
                comp_mention_rows = []
                for qr in query_results:
                    if not qr.response_text or qr.error:
                        continue
                    for comp in competitors:
                        mentioned = comp.name.lower() in qr.response_text.lower()
                        comp_mention_rows.append(CompetitorMention(
                            tracking_run_id=run_id,
                            competitor_id=comp.id,
                            prompt_id=qr.prompt_id,
                            model=qr.model,
                            run_number=qr.run_number,
                            mentioned=mentioned,
                        ))
                for cm in comp_mention_rows:
                    comp_db.add(cm)
                await comp_db.commit()
                logger.info(
                    "Competitor detection: %d mention records for run %d",
                    len(comp_mention_rows), run_id,
                )
    except Exception as exc:
        logger.warning(
            "Competitor detection failed for run %d (non-fatal): %s", run_id, exc
        )

    # ── 7. Calculate content attribution ────────────────────────────────────
    try:
        from app.services.content_service import calculate_attribution

        async with AsyncSessionLocal() as attr_db:
            attributions = await calculate_attribution(attr_db, run_id)
            if attributions:
                logger.info(
                    "Attribution calculated: %d record(s) for run %d",
                    len(attributions),
                    run_id,
                )
    except Exception as exc:
        # Attribution failure is non-fatal; the run itself already completed.
        logger.warning(
            "Attribution calculation failed for run %d (non-fatal): %s", run_id, exc
        )

    # ── 9. Update draft attributions ─────────────────────────────────────────
    logger.info("Updating draft attributions for run %d", run_id)
    try:
        from app.models import DraftAttribution

        async with AsyncSessionLocal() as attr_db:
            attr_result = await attr_db.execute(
                select(DraftAttribution).where(
                    DraftAttribution.brand_id == brand_id,
                    DraftAttribution.prompt_id.is_not(None),
                )
            )
            attributions = attr_result.scalars().all()

            if attributions:
                # Build prompt_id → (mentions, total) from this run
                prompt_stats: dict[int, tuple[int, int]] = {}
                for qr in query_results:
                    if qr.error:
                        continue
                    pid = qr.prompt_id
                    m, t = prompt_stats.get(pid, (0, 0))
                    prompt_stats[pid] = (m + (1 if qr.mentioned else 0), t + 1)

                for attr in attributions:
                    pid = attr.prompt_id
                    if pid in prompt_stats:
                        mentions, total = prompt_stats[pid]
                        new_score = round(mentions / total * 100.0, 2) if total > 0 else 0.0
                        attr.current_score = new_score
                        if attr.score_at_posting is not None:
                            attr.delta = round(new_score - attr.score_at_posting, 2)
                    attr.runs_since_posting = (attr.runs_since_posting or 0) + 1

                await attr_db.commit()
                logger.info("Updated %d draft attributions for run %d", len(attributions), run_id)
    except Exception as exc:
        logger.warning("Draft attribution update failed for run %d (non-fatal): %s", run_id, exc)

    # ── 8. Run content gap analysis ──────────────────────────────────────────
    logger.info("Starting content gap analysis for run %d", run_id)
    try:
        from app.services.gap_analysis_service import run_gap_analysis

        gap_ids = await run_gap_analysis(brand_id, run_id)
        logger.info(
            "Gap analysis complete: %d gaps identified for run %d", len(gap_ids), run_id
        )
    except Exception as exc:
        logger.warning(
            "Gap analysis failed for run %d (non-fatal): %s", run_id, exc
        )

    # ── 9. Send report-ready email ────────────────────────────────────────────
    try:
        from app.models import User as UserModel
        from app.services.email_service import send_report_ready_email

        async with AsyncSessionLocal() as email_db:
            brand_result = await email_db.execute(
                select(Brand).where(Brand.id == brand_id)
            )
            brand_obj = brand_result.scalar_one_or_none()
            if brand_obj and brand_obj.user_id:
                user_result = await email_db.execute(
                    select(UserModel).where(UserModel.id == brand_obj.user_id)
                )
                owner = user_result.scalar_one_or_none()
                if owner:
                    final_score = (overall_mentions / overall_queries * 100.0) if overall_queries > 0 else 0.0
                    send_report_ready_email(
                        email=owner.email,
                        name=owner.name,
                        brand_name=brand_name,
                        overall_score=round(final_score, 1),
                        run_id=run_id,
                    )
    except Exception as exc:
        logger.warning("Report-ready email failed for run %d (non-fatal): %s", run_id, exc)

    return run_id
