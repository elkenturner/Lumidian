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

from sqlalchemy import select

from app.database import AsyncSessionLocal
from app.models import Brand, Prompt, QueryResult, RunModelScore, TrackingRun
from app.models import utcnow as _utcnow
from app.services.drafting_service import auto_draft_top_gaps
from app.services.llm_service import (
    SUPPORTED_MODELS,
    models_for_tier,
    is_paid_tier,
    is_pro_for_brand,
    runs_per_prompt_for_brand,
    query_model,
)
from app.services.quora_scanner_service import scan_brand_opportunities as quora_scan
from app.services.reddit_scanner_service import scan_brand_opportunities as reddit_scan

logger = logging.getLogger(__name__)

MAX_CONCURRENT = 10


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

    # Strip URL citations + bracketed refs before matching so brand names
    # appearing only inside footnote URLs don't trigger false positives.
    from app.services.llm_service import _strip_url_citations
    cleaned = _strip_url_citations(response_text)

    brand_norm = _normalize(brand_name)
    response_norm = _normalize(cleaned)

    # Exact case-insensitive match
    exact = brand_name.lower() in cleaned.lower()
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
        cleaned[:200],
    )
    return mentioned


async def _persist_prompt_run_scores(
    db,
    run_id: int,
    brand_id: int,
    query_results: list,
) -> int:
    """Compute and add per-prompt per-model PromptRunScore rows to the session.
    Does NOT commit — caller is responsible for committing."""
    from app.models import PromptRunScore

    prompt_model_stats: dict[tuple[int, str], dict] = {}
    for qr in query_results:
        if qr.error:
            continue
        key = (qr.prompt_id, qr.model)
        if key not in prompt_model_stats:
            prompt_model_stats[key] = {"total": 0, "mentioned": 0}
        stats = prompt_model_stats[key]
        stats["total"] += 1
        if qr.mentioned:
            stats["mentioned"] += 1

    count = 0
    for (prompt_id, model), stats in prompt_model_stats.items():
        tq = stats["total"]
        tm = stats["mentioned"]
        score = round(tm / tq * 100.0, 2) if tq > 0 else 0.0
        db.add(PromptRunScore(
            prompt_id=prompt_id,
            tracking_run_id=run_id,
            brand_id=brand_id,
            model=model,
            score=score,
            mentioned_count=tm,
            query_count=tq,
        ))
        count += 1
    logger.info("Added %d PromptRunScore rows for run %d", count, run_id)
    return count


async def _log_score_change_events(
    brand_id: int,
    run_id: int,
    new_scores: list[dict],
) -> None:
    """Log ContentEvent for any prompt+model score changes >= 5pp from previous run."""
    from app.models import PromptRunScore
    from app.services.content_event_service import log_content_event

    THRESHOLD = 5.0

    async with AsyncSessionLocal() as db:
        for ns in new_scores:
            result = await db.execute(
                select(PromptRunScore)
                .where(
                    PromptRunScore.prompt_id == ns["prompt_id"],
                    PromptRunScore.model == ns["model"],
                    PromptRunScore.tracking_run_id != run_id,
                )
                .order_by(PromptRunScore.created_at.desc())
                .limit(1)
            )
            prev = result.scalar_one_or_none()
            if prev is None:
                continue
            delta = round(ns["score"] - prev.score, 2)
            if abs(delta) >= THRESHOLD:
                await log_content_event(
                    event_type="score_change",
                    brand_id=brand_id,
                    prompt_id=ns["prompt_id"],
                    data={
                        "prompt_id": ns["prompt_id"],
                        "model": ns["model"],
                        "old_score": prev.score,
                        "new_score": ns["score"],
                        "delta": delta,
                        "tracking_run_id": run_id,
                    },
                )


def _compute_overall_score(model_stats: dict[str, dict]) -> float:
    """Avg-of-per-model overall score; skips models with zero queries.

    Spec: 2026-04-20-cost-accuracy-decisions.md, decision #5.
    """
    per_model_scores: list[float] = []
    for stats in model_stats.values():
        tq = stats.get("total_queries", 0)
        if tq <= 0:
            continue
        tm = stats.get("total_mentions", 0)
        per_model_scores.append(tm / tq * 100.0)
    if not per_model_scores:
        return 0.0
    return sum(per_model_scores) / len(per_model_scores)


async def finalize_run(run_id: int, *, error_message: str | None = None) -> bool:
    """Compute scores from the persisted QueryResult rows for run_id, write
    RunModelScore + PromptRunScore, and mark the run completed.

    Reads from the DB (not an in-memory list) so it works both for a normal
    finish and for a partially-completed run recovered after a restart.
    Idempotent: clears any existing RunModelScore/PromptRunScore for the run
    before re-adding. Returns True if finalized as completed (>=1 result),
    False if the run had zero results (caller decides how to handle).
    """
    from sqlalchemy import delete
    from app.models import PromptRunScore

    async with AsyncSessionLocal() as db:
        run = await db.get(TrackingRun, run_id)
        if run is None:
            return False

        qr_rows = (await db.execute(
            select(QueryResult).where(QueryResult.tracking_run_id == run_id)
        )).scalars().all()

        if not qr_rows:
            return False

        # Idempotency: remove prior score rows for this run before recomputing.
        await db.execute(delete(RunModelScore).where(RunModelScore.tracking_run_id == run_id))
        await db.execute(delete(PromptRunScore).where(PromptRunScore.tracking_run_id == run_id))

        model_stats: dict[str, dict] = {}
        for qr in qr_rows:
            if qr.error:
                continue
            stats = model_stats.setdefault(qr.model, {"total_queries": 0, "total_mentions": 0})
            stats["total_queries"] += 1
            if qr.mentioned:
                stats["total_mentions"] += 1

        overall_queries = 0
        overall_mentions = 0
        for model_name, stats in model_stats.items():
            tq = stats["total_queries"]
            tm = stats["total_mentions"]
            score = (tm / tq * 100.0) if tq > 0 else 0.0
            db.add(RunModelScore(
                tracking_run_id=run_id, model=model_name,
                total_queries=tq, total_mentions=tm, score=round(score, 2),
            ))
            overall_queries += tq
            overall_mentions += tm

        overall_score = _compute_overall_score(model_stats)

        run.status = "completed"
        run.completed_at = _utcnow()
        run.overall_score = round(overall_score, 2)
        run.total_queries = overall_queries
        run.total_mentions = overall_mentions
        if error_message:
            run.error_message = error_message

        await _persist_prompt_run_scores(db, run_id, run.brand_id, qr_rows)
        await db.commit()

    logger.info("finalize_run %d: completed score=%.2f%% (%d/%d)",
                run_id, overall_score, overall_mentions, overall_queries)
    return True


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
    is_paid: bool = False   # True for any paid tier or agency brand — gates ChatGPT search + sonar-pro
    prompt_data: list[tuple[int, str]] = []  # (prompt_id, prompt_text)
    run_id: int = 0

    async with AsyncSessionLocal() as db:
        # ── 1. Load brand ────────────────────────────────────────────────────
        brand_result = await db.execute(select(Brand).where(Brand.id == brand_id))
        brand: Brand | None = brand_result.scalar_one_or_none()
        if brand is None:
            raise ValueError(f"Brand {brand_id} not found")

        brand_name = str(brand.name)
        brand_type = str(brand.brand_type or "standard")

        # Load user subscription tier for model selection
        from app.models import User
        user_result = await db.execute(select(User).where(User.id == brand.user_id))
        user = user_result.scalar_one_or_none()
        tier = user.subscription_tier if user else None
        is_paid = is_pro_for_brand(brand_type, tier)

        active_models = models_for_tier(brand_type, tier)

        prompts_result = await db.execute(
            select(Prompt).where(Prompt.brand_id == brand_id)
        )
        prompt_data = [(p.id, p.text) for p in prompts_result.scalars().all()]
        if not prompt_data:
            raise ValueError(f"Brand {brand_id} has no prompts configured")

        runs_per_prompt = runs_per_prompt_for_brand(brand_type)

        logger.info(
            "Scheduled run starting — brand=%r prompts=%d runs_per_prompt=%d",
            brand_name, len(prompt_data), runs_per_prompt,
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

    # Import cancel event support for cooperative cancellation
    try:
        from app.routers.tracking import get_cancel_event
        cancel_evt = get_cancel_event(run_id)
    except Exception:
        cancel_evt = None

    async def _bounded_query(
        prompt_id: int,
        prompt_text: str,
        model: str,
        run_number: int,
    ) -> QueryResult:
        async with semaphore:
            result = await query_model(model, prompt_text, brand_name, pro=is_paid, brand_type=brand_type, cancel_event=cancel_evt)
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
            citations=result.get("citations"),
        )

    tasks = [
        _bounded_query(pid, ptext, model, run_number)
        for pid, ptext in prompt_data
        for model in active_models
        for run_number in range(1, runs_per_prompt + 1)
    ]

    try:
        query_results: list[QueryResult] = await asyncio.gather(*tasks)
    except Exception as exc:
        logger.exception("Fatal error during query gathering for run %d", run_id)
        try:
            async with AsyncSessionLocal() as db:
                run = await db.get(TrackingRun, run_id)
                if run:
                    run.status = "failed"
                    run.error_message = str(exc)
                    run.completed_at = _utcnow()
                    await db.commit()
        except Exception as inner_exc:
            logger.critical(
                "CRITICAL: Failed to mark run %d as failed after query gathering error — "
                "run may be stuck in 'running' state. Original error: %s, Cleanup error: %s",
                run_id, exc, inner_exc,
            )
        raise

    # ── 4 & 5. Persist results and compute scores ────────────────────────────
    try:
        async with AsyncSessionLocal() as db:
            for qr in query_results:
                db.add(qr)
            await db.commit()
    except Exception as exc:
        logger.exception("Error persisting results for run %d", run_id)
        try:
            async with AsyncSessionLocal() as err_db:
                run = await err_db.get(TrackingRun, run_id)
                if run:
                    run.status = "failed"
                    run.error_message = f"DB error: {exc}"
                    run.completed_at = _utcnow()
                    await err_db.commit()
        except Exception as inner_exc:
            logger.critical(
                "CRITICAL: Failed to mark run %d as failed — run may be stuck. "
                "Original: %s, Cleanup: %s", run_id, exc, inner_exc,
            )
        raise

    await finalize_run(run_id)

    # Read back aggregate values written by finalize_run for use in notifications/email
    async with AsyncSessionLocal() as db:
        _run = await db.get(TrackingRun, run_id)
        overall_score: float = _run.overall_score if _run and _run.overall_score is not None else 0.0
        overall_queries: int = _run.total_queries if _run and _run.total_queries is not None else 0
        overall_mentions: int = _run.total_mentions if _run and _run.total_mentions is not None else 0

    # ── 6. Classify sentiment for mentioned responses ────────────────────────
    _post_processing_warnings: list[str] = []

    logger.info("Scheduled run %d complete — starting sentiment classification", run_id)
    try:
        from app.services.sentiment_service import classify_sentiments_for_run

        await classify_sentiments_for_run(list(query_results), brand_name)
    except Exception as exc:
        _post_processing_warnings.append(f"sentiment: {exc}")
        logger.warning(
            "Sentiment classification failed for run %d (non-fatal): %s", run_id, exc
        )

    # ── 6b. Detect competitor mentions ───────────────────────────────────────
    logger.info("Running competitor mention detection for run %d", run_id)
    try:
        from app.models import Competitor as CompetitorModel
        from app.models import CompetitorMention

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
                    response_norm = _normalize(qr.response_text)
                    for comp in competitors:
                        exact = comp.name.lower() in qr.response_text.lower()
                        fuzzy = _normalize(comp.name) in response_norm
                        mentioned = exact or fuzzy
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
        _post_processing_warnings.append(f"competitor_detection: {exc}")
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
        _post_processing_warnings.append(f"attribution: {exc}")
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
        _post_processing_warnings.append(f"draft_attribution: {exc}")
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
        _post_processing_warnings.append(f"gap_analysis: {exc}")
        logger.warning(
            "Gap analysis failed for run %d (non-fatal): %s", run_id, exc
        )

    # ── 8a. Extract citation sources from query responses ────────────────────
    try:
        from app.services.site_audit.citations import extract_for_run
        await extract_for_run(run_id)
    except Exception as exc:  # noqa: BLE001
        _post_processing_warnings.append(f"citations: {exc}")
        logger.warning("citation extraction failed for run %d: %s", run_id, exc)

    # ── 8b. Log significant prompt score changes ────────────────────────────
    try:
        from app.models import PromptRunScore as _PRS
        async with AsyncSessionLocal() as prs_db:
            prs_result = await prs_db.execute(
                select(_PRS).where(_PRS.tracking_run_id == run_id)
            )
            new_scores = [
                {"prompt_id": s.prompt_id, "model": s.model, "score": s.score}
                for s in prs_result.scalars().all()
            ]
        if new_scores:
            await _log_score_change_events(brand_id, run_id, new_scores)
    except Exception as exc:
        _post_processing_warnings.append(f"score_events: {exc}")
        logger.warning("Score change event logging failed for run %d (non-fatal): %s", run_id, exc)

    # ── 9b. Onboarding post-processing pipeline ──────────────────────────────
    if run_type == "onboarding":
        logger.info(
            "Onboarding run %d complete — firing post-processing pipeline for brand_id=%d",
            run_id, brand_id,
        )
        asyncio.create_task(
            _onboarding_post_process(brand_id),
            name=f"onboarding-post-{brand_id}",
        )

    # ── 10. Create in-app notifications ──────────────────────────────────────
    try:
        from app.models import Brand as BrandModel
        from app.models import Notification

        async with AsyncSessionLocal() as notif_db:
            brand_res = await notif_db.execute(select(BrandModel).where(BrandModel.id == brand_id))
            brand_obj = brand_res.scalar_one_or_none()
            if brand_obj and brand_obj.user_id:
                uid = brand_obj.user_id

                notif_db.add(Notification(
                    user_id=uid,
                    type="report_ready",
                    title=f"Run complete — {brand_name}",
                    body=f"Score: {round(overall_score, 1)}% ({overall_mentions}/{overall_queries} mentions)",
                    link=f"/tracker/{brand_id}/results",
                ))

                # Score-drop alert vs previous completed run
                prev_res = await notif_db.execute(
                    select(TrackingRun)
                    .where(
                        TrackingRun.brand_id == brand_id,
                        TrackingRun.status == "completed",
                        TrackingRun.id != run_id,
                    )
                    .order_by(TrackingRun.completed_at.desc())
                    .limit(1)
                )
                prev_run = prev_res.scalar_one_or_none()
                if prev_run and prev_run.overall_score is not None:
                    drop = prev_run.overall_score - overall_score
                    if drop >= 15.0:
                        notif_db.add(Notification(
                            user_id=uid,
                            type="visibility_drop",
                            title=f"Visibility dropped {drop:.1f}pp — {brand_name}",
                            body=f"Previous: {prev_run.overall_score:.1f}% → Now: {overall_score:.1f}%",
                            link=f"/tracker/{brand_id}/results",
                        ))

                await notif_db.commit()
    except Exception as exc:
        _post_processing_warnings.append(f"notifications: {exc}")
        logger.warning("Notification creation failed for run %d (non-fatal): %s", run_id, exc)

    # ── 9. Send report-ready email ────────────────────────────────────────────
    try:
        from app.models import User as UserModel
        from app.services.email_service import send_email_background, send_report_ready_email

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
                    send_email_background(
                        send_report_ready_email,
                        email=owner.email,
                        name=owner.name,
                        brand_name=brand_name,
                        overall_score=round(overall_score, 1),
                        run_id=run_id,
                    )
    except Exception as exc:
        _post_processing_warnings.append(f"email: {exc}")
        logger.warning("Report-ready email failed for run %d (non-fatal): %s", run_id, exc)

    # Persist post-processing warnings so partial failures are visible
    if _post_processing_warnings:
        try:
            async with AsyncSessionLocal() as warn_db:
                run = await warn_db.get(TrackingRun, run_id)
                if run:
                    run.error_message = "Post-processing warnings: " + "; ".join(_post_processing_warnings)
                    await warn_db.commit()
            logger.warning(
                "Run %d completed with %d post-processing warning(s): %s",
                run_id, len(_post_processing_warnings), "; ".join(_post_processing_warnings),
            )
        except Exception as exc:
            logger.warning("Failed to persist post-processing warnings for run %d: %s", run_id, exc)

    return run_id


async def _onboarding_post_process(brand_id: int) -> None:
    """
    Sequential post-processing pipeline for onboarding tracking runs.

    Fired as a background asyncio.create_task after gap analysis completes.
    Steps run in order; each is non-fatal:
      1. Generate initial content drafts (count depends on user tier)
      2. Scan for live opportunities (parallel)

    state.generating_brands and state.scanning_brands are updated so
    AppShell's background-status banners reflect each phase.
    """
    from app import state
    from app.models import User
    from app.services.drafting_service import get_draft_cap

    # Resolve tier up-front in its own session so step 2 still has it
    # available even if step 1 raises mid-way.
    tier: str | None = None
    brand_type: str = "standard"
    try:
        async with AsyncSessionLocal() as db:
            brand = await db.get(Brand, brand_id)
            user = await db.get(User, brand.user_id) if brand else None
            tier = user.subscription_tier if user else None
            brand_type = brand.brand_type if brand else "standard"
    except Exception as exc:
        logger.warning(
            "Onboarding post-process: failed to resolve tier for brand_id=%d (non-fatal): %s",
            brand_id, exc,
        )

    # ── Step 1: Draft generation ─────────────────────────────────────────────
    state.generating_brands.add(brand_id)
    try:
        cap = get_draft_cap(tier, brand_type)
        async with AsyncSessionLocal() as db:
            drafts = await auto_draft_top_gaps(
                db=db,
                brand_id=brand_id,
                max_gaps=cap,
                clear_existing=False,
                source="onboarding",
            )
        logger.info(
            "Onboarding post-process: generated %d/%d drafts for brand_id=%d (tier=%s)",
            len(drafts), cap, brand_id, tier,
        )
    except Exception as exc:
        logger.warning(
            "Onboarding draft generation failed for brand_id=%d (non-fatal): %s",
            brand_id, exc,
        )
    finally:
        state.generating_brands.discard(brand_id)

    # ── Step 2: Live opportunity scan (in parallel) ──────────────────────────
    # Reddit + Quora are scanned for all tiers; LinkedIn + X are only
    # surfaced for paid tiers (matches the gating in /opportunities/scan).
    state.scanning_brands.add(brand_id)
    try:
        scan_tasks = [
            reddit_scan(brand_id, clear_existing=True),
            quora_scan(brand_id, clear_existing=True),
        ]
        if is_paid_tier(tier):
            from app.services.linkedin_scanner_service import (
                scan_brand_opportunities as linkedin_scan,
            )
            from app.services.x_scanner_service import (
                scan_brand_opportunities as x_scan,
            )
            scan_tasks.append(linkedin_scan(brand_id, clear_existing=True))
            scan_tasks.append(x_scan(brand_id, clear_existing=True))

        await asyncio.gather(*scan_tasks, return_exceptions=True)
        logger.info(
            "Onboarding post-process: opportunity scan complete for brand_id=%d (tier=%s, scanners=%d)",
            brand_id, tier, len(scan_tasks),
        )
    except Exception as exc:
        logger.warning(
            "Onboarding opp scan failed for brand_id=%d (non-fatal): %s",
            brand_id, exc,
        )
    finally:
        state.scanning_brands.discard(brand_id)
