"""
Tracking router — trigger and monitor tracking runs.

Routes
------
POST /api/tracking/run/{brand_id}                      — trigger a manual run (fire-and-forget)
POST /api/tracking/run-prompt/{brand_id}/{prompt_id}   — single-prompt mini run (fire-and-forget)
GET  /api/tracking/runs/{brand_id}                     — list last 30 runs for a brand
GET  /api/tracking/run/{run_id}/status                 — poll a specific run's status
"""

import asyncio
import logging
from typing import Annotated

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.database import get_db
from app.routers.billing import DAILY_RUN_LIMITS
from app.dependencies import CurrentUser, check_rate_limit, get_brand_for_user, require_active_subscription, require_brand_active
from app.models import Brand, TrackingRun
from app.schemas import ManualRunResponse, TrackingRunStatus, TrackingRunSummary

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/tracking", tags=["tracking"])

DbDep = Annotated[AsyncSession, Depends(get_db)]


# ── Trigger manual run ────────────────────────────────────────────────────────

@router.post(
    "/run/{brand_id}",
    response_model=ManualRunResponse,
    status_code=status.HTTP_202_ACCEPTED,
)
async def trigger_run(brand_id: int, background_tasks: BackgroundTasks, db: DbDep, user: CurrentUser):
    require_active_subscription(user)
    check_rate_limit(user.id, limit=3)  # 3 manual runs per minute per user (burst protection)
    brand = await get_brand_for_user(brand_id, db, user)

    # Check if brand is paused (expired pitch brand or lapsed subscription)
    require_brand_active(brand, user)

    # Calculate today's start once for all limit checks
    from datetime import datetime, timezone
    from sqlalchemy import func
    today_start = datetime.now(timezone.utc).replace(
        hour=0, minute=0, second=0, microsecond=0, tzinfo=None
    )

    # Enforce daily manual run limits by tier (source of truth: billing.DAILY_RUN_LIMITS)
    tier = user.subscription_tier or None
    daily_limit = DAILY_RUN_LIMITS.get(tier) if not user.is_admin else None
    if daily_limit is not None:
        runs_today_result = await db.execute(
            select(func.count(TrackingRun.id)).where(
                TrackingRun.brand_id.in_(
                    select(Brand.id).where(Brand.user_id == user.id)
                ),
                TrackingRun.run_type == "manual",
                TrackingRun.created_at >= today_start,
            )
        )
        runs_today = runs_today_result.scalar_one()
        if runs_today >= daily_limit:
            plan_label = "Free plan" if not tier else "Starter plan"
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail=f"{plan_label} includes {daily_limit} manual run{'s' if daily_limit > 1 else ''} per day. Your limit resets at midnight UTC. Upgrade to Pro for unlimited runs.",
            )

    # Pitch brands have stricter limits (1/day) regardless of subscription tier
    if brand.brand_type == "pitch":
        from app.routers.billing import DAILY_RUN_LIMITS_PITCH
        pitch_runs_result = await db.execute(
            select(func.count(TrackingRun.id)).where(
                TrackingRun.brand_id == brand_id,
                TrackingRun.run_type == "manual",
                TrackingRun.created_at >= today_start,
            )
        )
        pitch_runs_today = pitch_runs_result.scalar_one()
        if pitch_runs_today >= DAILY_RUN_LIMITS_PITCH:
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail=f"Pitch brands are limited to {DAILY_RUN_LIMITS_PITCH} manual run per day. Try again tomorrow.",
            )

    # Detect if this is the brand's first-ever run (triggers onboarding pipeline)
    completed_runs_result = await db.execute(
        select(func.count(TrackingRun.id)).where(
            TrackingRun.brand_id == brand_id,
            TrackingRun.status == "completed",
        )
    )
    is_first_run = (completed_runs_result.scalar_one() or 0) == 0
    run_type = "onboarding" if is_first_run else "manual"

    # Pre-create the TrackingRun record so we can return its ID immediately.
    tracking_run = TrackingRun(
        brand_id=brand_id,
        status="pending",
        run_type=run_type,
    )
    db.add(tracking_run)
    await db.commit()
    await db.refresh(tracking_run)
    run_id = tracking_run.id

    # Fire-and-forget: the actual work happens in the background.
    # We use asyncio.create_task rather than BackgroundTasks so it runs
    # concurrently within the same event loop (BackgroundTasks runs after
    # the response is sent but is still tied to the request lifecycle in
    # some ASGI implementations).
    asyncio.create_task(
        _background_run_with_id(run_id, brand_id),
        name=f"manual-tracking-{brand_id}-{run_id}",
    )

    return ManualRunResponse(
        run_id=run_id,
        brand_id=brand_id,
        status="pending",
        message="Tracking run queued. Poll /api/tracking/run/{run_id}/status for updates.",
    )


async def _background_run_with_id(run_id: int, brand_id: int) -> None:
    """
    Runs run_tracking but reuses the pre-created TrackingRun row.
    We update its status to 'running' immediately, then delegate to the service.
    """
    from app.database import AsyncSessionLocal

    # Mark as running
    async with AsyncSessionLocal() as db:
        run = await db.get(TrackingRun, run_id)
        if run:
            from datetime import datetime, timezone
            run.status = "running"
            run.started_at = datetime.now(timezone.utc).replace(tzinfo=None)
            await db.commit()

    try:
        await _execute_run_with_id(run_id=run_id, brand_id=brand_id)
    except Exception:
        logger.exception(
            "Manual tracking run %d failed for brand %d", run_id, brand_id
        )


async def _log_run_events(
    run_id: int,
    brand_id: int,
    overall_score: float,
    overall_queries: int,
    overall_mentions: int,
    query_results: list,
) -> None:
    """Log run_completed and per-prompt visibility_changed events."""
    from app.services.analytics_service import log_event
    from app.database import AsyncSessionLocal
    from app.models import QueryResult as QR, TrackingRun as TR
    from app.services.llm_service import SUPPORTED_MODELS

    # log run_completed
    await log_event(
        "run_completed",
        {
            "visibility_score": round(overall_score, 2),
            "total_queries": overall_queries,
            "total_mentions": overall_mentions,
            "models_used": list(SUPPORTED_MODELS),
        },
        brand_id=brand_id,
    )

    # Compute per-prompt scores for this run
    prompt_current: dict[int, list[int]] = {}  # prompt_id -> [mentions, total]
    for qr in query_results:
        if qr.error == "api_key_not_configured":
            continue
        pid = qr.prompt_id
        if pid not in prompt_current:
            prompt_current[pid] = [0, 0]
        prompt_current[pid][1] += 1
        if qr.mentioned:
            prompt_current[pid][0] += 1

    if not prompt_current:
        return

    # Load previous completed run's per-prompt scores
    async with AsyncSessionLocal() as db:
        prev_run_result = await db.execute(
            select(TR)
            .where(
                TR.brand_id == brand_id,
                TR.status == "completed",
                TR.id != run_id,
            )
            .order_by(TR.completed_at.desc())
            .limit(1)
        )
        prev_run = prev_run_result.scalar_one_or_none()

        prompt_prev: dict[int, list[int]] = {}
        if prev_run:
            prev_results = await db.execute(
                select(QR).where(QR.tracking_run_id == prev_run.id)
            )
            for qr in prev_results.scalars().all():
                if qr.error == "api_key_not_configured":
                    continue
                pid = qr.prompt_id
                if pid not in prompt_prev:
                    prompt_prev[pid] = [0, 0]
                prompt_prev[pid][1] += 1
                if qr.mentioned:
                    prompt_prev[pid][0] += 1

    # Log visibility_changed for each prompt with a previous score
    for pid, (cur_m, cur_t) in prompt_current.items():
        if pid not in prompt_prev:
            continue
        prev_m, prev_t = prompt_prev[pid]
        new_score = round(cur_m / cur_t * 100, 2) if cur_t > 0 else 0.0
        old_score = round(prev_m / prev_t * 100, 2) if prev_t > 0 else 0.0
        delta = round(new_score - old_score, 2)
        if delta == 0.0:
            continue
        await log_event(
            "visibility_changed",
            {
                "prompt_id": pid,
                "old_score": old_score,
                "new_score": new_score,
                "delta": delta,
                "model": None,  # overall across all models
            },
            brand_id=brand_id,
        )


async def _execute_run_with_id(run_id: int, brand_id: int) -> None:
    """
    Mirrors tracking_service.run_tracking but uses the pre-created run_id
    instead of inserting a new TrackingRun row.
    """
    import asyncio
    from app.database import AsyncSessionLocal
    from app.models import Brand, Prompt, TrackingRun, QueryResult, RunModelScore
    from app.services.llm_service import query_model, SUPPORTED_MODELS, TIER_RUNS
    from sqlalchemy import select
    from datetime import datetime, timezone

    def utcnow():
        return datetime.now(timezone.utc).replace(tzinfo=None)

    # Extract all values we need as plain Python types before the session closes,
    # so we never access SQLAlchemy-managed attributes on detached objects.
    brand_name: str = ""
    brand_tier: str = "basic"
    prompt_data: list[tuple[int, str]] = []  # (prompt_id, prompt_text)

    async with AsyncSessionLocal() as db:
        brand_result = await db.execute(select(Brand).where(Brand.id == brand_id))
        brand = brand_result.scalar_one_or_none()
        if brand is None:
            async with AsyncSessionLocal() as err_db:
                run = await err_db.get(TrackingRun, run_id)
                if run:
                    run.status = "failed"
                    run.error_message = f"Brand {brand_id} not found"
                    run.completed_at = utcnow()
                    await err_db.commit()
            return

        brand_name = str(brand.name)
        brand_tier = str(brand.tier)

        prompts_result = await db.execute(
            select(Prompt).where(Prompt.brand_id == brand_id)
        )
        prompt_data = [(p.id, p.text) for p in prompts_result.scalars().all()]

    logger.info(
        "Manual run %d — brand=%r tier=%s prompts=%d",
        run_id, brand_name, brand_tier, len(prompt_data),
    )

    if not prompt_data:
        async with AsyncSessionLocal() as err_db:
            run = await err_db.get(TrackingRun, run_id)
            if run:
                run.status = "failed"
                run.error_message = "No prompts configured for this brand"
                run.completed_at = utcnow()
                await err_db.commit()
        return

    runs_per_prompt = TIER_RUNS.get(brand_tier, TIER_RUNS["basic"])
    semaphore = asyncio.Semaphore(10)

    async def _bounded_query(prompt_id: int, prompt_text: str, model: str, run_number: int):
        async with semaphore:
            result = await query_model(model, prompt_text, brand_name)
        return QueryResult(
            tracking_run_id=run_id,
            prompt_id=prompt_id,
            model=model,
            run_number=run_number,
            response_text=result.get("response_text"),
            mentioned=result.get("mentioned", False),
            latency_ms=result.get("latency_ms"),
            error=result.get("error"),
        )

    tasks = [
        _bounded_query(pid, ptext, model, rn)
        for pid, ptext in prompt_data
        for model in SUPPORTED_MODELS
        for rn in range(1, runs_per_prompt + 1)
    ]

    try:
        query_results = await asyncio.gather(*tasks)
    except Exception as exc:
        async with AsyncSessionLocal() as err_db:
            run = await err_db.get(TrackingRun, run_id)
            if run:
                run.status = "failed"
                run.error_message = str(exc)
                run.completed_at = utcnow()
                await err_db.commit()
        return

    async with AsyncSessionLocal() as db:
        try:
            for qr in query_results:
                db.add(qr)
            await db.flush()

            model_stats = {
                m: {"total_queries": 0, "total_mentions": 0} for m in SUPPORTED_MODELS
            }
            for qr in query_results:
                # Exclude ALL errors — they should not count as "not mentioned"
                # and should not inflate the denominator (mirrors tracking_service.py)
                if not qr.response_text:
                    continue
                model_stats[qr.model]["total_queries"] += 1
                if qr.mentioned:
                    model_stats[qr.model]["total_mentions"] += 1

            overall_queries = 0
            overall_mentions = 0
            for model_name, stats in model_stats.items():
                tq = stats["total_queries"]
                tm = stats["total_mentions"]
                score = (tm / tq * 100.0) if tq > 0 else 0.0
                db.add(RunModelScore(
                    tracking_run_id=run_id,
                    model=model_name,
                    total_queries=tq,
                    total_mentions=tm,
                    score=round(score, 2),
                ))
                overall_queries += tq
                overall_mentions += tm

            overall_score = (
                (overall_mentions / overall_queries * 100.0)
                if overall_queries > 0
                else 0.0
            )

            run = await db.get(TrackingRun, run_id)
            if run:
                run.status = "completed"
                run.completed_at = utcnow()
                run.overall_score = round(overall_score, 2)
                run.total_queries = overall_queries
                run.total_mentions = overall_mentions

            await db.commit()
        except Exception as exc:
            await db.rollback()
            async with AsyncSessionLocal() as err_db:
                run = await err_db.get(TrackingRun, run_id)
                if run:
                    run.status = "failed"
                    run.error_message = f"DB error: {exc}"
                    run.completed_at = utcnow()
                    await err_db.commit()
            return

    # Classify sentiment after the main commit (non-fatal)
    logger.info("Manual run %d complete — starting sentiment classification", run_id)
    try:
        from app.services.sentiment_service import classify_sentiments_for_run

        await classify_sentiments_for_run(list(query_results), brand_name)
    except Exception as exc:
        logger.warning(
            "Sentiment classification failed for manual run %d (non-fatal): %s", run_id, exc
        )

    # Log analytics events (non-fatal)
    try:
        await _log_run_events(
            run_id=run_id,
            brand_id=brand_id,
            overall_score=overall_score,
            overall_queries=overall_queries,
            overall_mentions=overall_mentions,
            query_results=list(query_results),
        )
    except Exception as exc:
        logger.warning("Run event logging failed (non-fatal): %s", exc)

    # Detect competitor mentions (non-fatal)
    try:
        from app.models import Competitor as CompetitorModel, CompetitorMention
        from app.database import AsyncSessionLocal

        async with AsyncSessionLocal() as comp_db:
            comps_result = await comp_db.execute(
                select(CompetitorModel).where(CompetitorModel.brand_id == brand_id)
            )
            competitors = comps_result.scalars().all()
            if competitors:
                comp_rows = []
                for qr in query_results:
                    if not qr.response_text:
                        continue
                    for comp in competitors:
                        comp_rows.append(CompetitorMention(
                            tracking_run_id=run_id,
                            competitor_id=comp.id,
                            prompt_id=qr.prompt_id,
                            model=qr.model,
                            run_number=qr.run_number,
                            mentioned=comp.name.lower() in qr.response_text.lower(),
                        ))
                for cm in comp_rows:
                    comp_db.add(cm)
                await comp_db.commit()
                logger.info("Competitor detection: %d records for manual run %d", len(comp_rows), run_id)
    except Exception as exc:
        logger.warning("Competitor detection failed for manual run %d (non-fatal): %s", run_id, exc)

    # Update draft attributions (non-fatal)
    try:
        from app.models import DraftAttribution
        from app.database import AsyncSessionLocal
        from datetime import datetime, timezone

        def _utcnow_local():
            return datetime.now(timezone.utc).replace(tzinfo=None)

        async with AsyncSessionLocal() as attr_db:
            attr_result = await attr_db.execute(
                select(DraftAttribution).where(
                    DraftAttribution.brand_id == brand_id,
                    DraftAttribution.prompt_id.is_not(None),
                )
            )
            attributions = attr_result.scalars().all()
            if attributions:
                prompt_stats: dict[int, tuple[int, int]] = {}
                for qr in query_results:
                    if not qr.response_text:
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
    except Exception as exc:
        logger.warning("Draft attribution update failed for manual run %d (non-fatal): %s", run_id, exc)

    # Run gap analysis (non-fatal)
    logger.info("Manual run %d complete — starting gap analysis", run_id)
    try:
        from app.services.gap_analysis_service import run_gap_analysis

        gap_ids = await run_gap_analysis(brand_id, run_id)
        logger.info("Gap analysis complete for manual run %d: %d gaps", run_id, len(gap_ids))
    except Exception as exc:
        logger.warning("Gap analysis failed for manual run %d (non-fatal): %s", run_id, exc)

    # Fire onboarding post-process pipeline for first-time runs
    async with AsyncSessionLocal() as check_db:
        run_check = await check_db.get(TrackingRun, run_id)
        if run_check and run_check.run_type == "onboarding":
            logger.info(
                "First run %d complete — firing onboarding post-process for brand_id=%d",
                run_id, brand_id,
            )
            from app.services.tracking_service import _onboarding_post_process
            asyncio.create_task(
                _onboarding_post_process(brand_id),
                name=f"onboarding-post-{brand_id}",
            )


# ── Single-prompt mini run ────────────────────────────────────────────────────

@router.post(
    "/run-prompt/{brand_id}/{prompt_id}",
    response_model=ManualRunResponse,
    status_code=status.HTTP_202_ACCEPTED,
)
async def trigger_prompt_run(
    brand_id: int,
    prompt_id: int,
    db: DbDep,
    user: CurrentUser,
):
    """
    Run tracking for a single prompt across all models.
    Creates its own TrackingRun row (run_type='prompt') so it doesn't interfere
    with full scheduled or manual runs.
    """
    from app.models import Prompt

    brand = await get_brand_for_user(brand_id, db, user)
    require_brand_active(brand, user)

    # Verify the prompt belongs to this brand
    prompt_result = await db.execute(
        select(Prompt).where(Prompt.id == prompt_id, Prompt.brand_id == brand_id)
    )
    prompt = prompt_result.scalar_one_or_none()
    if prompt is None:
        raise HTTPException(status_code=404, detail="Prompt not found for this brand")

    tracking_run = TrackingRun(
        brand_id=brand_id,
        status="pending",
        run_type="prompt",
    )
    db.add(tracking_run)
    await db.commit()
    await db.refresh(tracking_run)
    run_id = tracking_run.id

    asyncio.create_task(
        _background_prompt_run(run_id, brand_id, prompt_id, str(prompt.text), str(brand.name), str(brand.tier)),
        name=f"prompt-tracking-{brand_id}-{prompt_id}-{run_id}",
    )

    return ManualRunResponse(
        run_id=run_id,
        brand_id=brand_id,
        status="pending",
        message=f"Single-prompt run queued for prompt {prompt_id}.",
    )


async def _background_prompt_run(
    run_id: int,
    brand_id: int,
    prompt_id: int,
    prompt_text: str,
    brand_name: str,
    brand_tier: str,
) -> None:
    """Execute a single-prompt tracking run independently of full runs."""
    import asyncio as _asyncio
    from app.database import AsyncSessionLocal
    from app.models import TrackingRun as TR, QueryResult, RunModelScore
    from app.services.llm_service import query_model, SUPPORTED_MODELS, TIER_RUNS
    from datetime import datetime, timezone

    def utcnow():
        return datetime.now(timezone.utc).replace(tzinfo=None)

    # Mark as running
    async with AsyncSessionLocal() as db:
        run = await db.get(TR, run_id)
        if run:
            run.status = "running"
            run.started_at = utcnow()
            await db.commit()

    runs_per_prompt = TIER_RUNS.get(brand_tier, TIER_RUNS["basic"])
    semaphore = _asyncio.Semaphore(10)

    async def _bounded_query(model: str, run_number: int):
        async with semaphore:
            result = await query_model(model, prompt_text, brand_name)
        return QueryResult(
            tracking_run_id=run_id,
            prompt_id=prompt_id,
            model=model,
            run_number=run_number,
            response_text=result.get("response_text"),
            mentioned=result.get("mentioned", False),
            latency_ms=result.get("latency_ms"),
            error=result.get("error"),
        )

    tasks = [
        _bounded_query(model, rn)
        for model in SUPPORTED_MODELS
        for rn in range(1, runs_per_prompt + 1)
    ]

    logger.info(
        "Prompt run %d — brand=%r prompt_id=%d tier=%s tasks=%d",
        run_id, brand_name, prompt_id, brand_tier, len(tasks),
    )

    try:
        query_results = await _asyncio.gather(*tasks)
    except Exception as exc:
        async with AsyncSessionLocal() as err_db:
            run = await err_db.get(TR, run_id)
            if run:
                run.status = "failed"
                run.error_message = str(exc)
                run.completed_at = utcnow()
                await err_db.commit()
        logger.exception("Prompt run %d failed during query phase", run_id)
        return

    async with AsyncSessionLocal() as db:
        try:
            for qr in query_results:
                db.add(qr)
            await db.flush()

            model_stats = {m: {"total_queries": 0, "total_mentions": 0} for m in SUPPORTED_MODELS}
            for qr in query_results:
                if not qr.response_text:
                    continue
                model_stats[qr.model]["total_queries"] += 1
                if qr.mentioned:
                    model_stats[qr.model]["total_mentions"] += 1

            overall_queries = 0
            overall_mentions = 0
            for model_name, stats in model_stats.items():
                tq = stats["total_queries"]
                tm = stats["total_mentions"]
                score = (tm / tq * 100.0) if tq > 0 else 0.0
                db.add(RunModelScore(
                    tracking_run_id=run_id,
                    model=model_name,
                    total_queries=tq,
                    total_mentions=tm,
                    score=round(score, 2),
                ))
                overall_queries += tq
                overall_mentions += tm

            overall_score = (overall_mentions / overall_queries * 100.0) if overall_queries > 0 else 0.0

            run = await db.get(TR, run_id)
            if run:
                run.status = "completed"
                run.completed_at = utcnow()
                run.overall_score = round(overall_score, 2)
                run.total_queries = overall_queries
                run.total_mentions = overall_mentions

            await db.commit()
            logger.info(
                "Prompt run %d complete — prompt_id=%d score=%.1f%%",
                run_id, prompt_id, overall_score,
            )
        except Exception as exc:
            await db.rollback()
            async with AsyncSessionLocal() as err_db:
                run = await err_db.get(TR, run_id)
                if run:
                    run.status = "failed"
                    run.error_message = f"DB error: {exc}"
                    run.completed_at = utcnow()
                    await err_db.commit()
            logger.exception("Prompt run %d failed during DB write", run_id)
            return

    # Classify sentiment (non-fatal)
    try:
        from app.services.sentiment_service import classify_sentiments_for_run
        await classify_sentiments_for_run(list(query_results), brand_name)
    except Exception as exc:
        logger.warning("Sentiment classification failed for prompt run %d (non-fatal): %s", run_id, exc)

    # Gap analysis (non-fatal)
    try:
        from app.services.gap_analysis_service import run_gap_analysis
        await run_gap_analysis(brand_id, run_id)
    except Exception as exc:
        logger.warning("Gap analysis failed for prompt run %d (non-fatal): %s", run_id, exc)


# ── List runs for brand ───────────────────────────────────────────────────────

@router.get("/runs/{brand_id}", response_model=list[TrackingRunSummary])
async def list_runs(brand_id: int, db: DbDep, user: CurrentUser):
    await get_brand_for_user(brand_id, db, user)

    runs_result = await db.execute(
        select(TrackingRun)
        .where(TrackingRun.brand_id == brand_id)
        .order_by(TrackingRun.created_at.desc())
        .limit(30)
    )
    runs = runs_result.scalars().all()
    return [TrackingRunSummary.model_validate(r) for r in runs]


# ── Get run status ────────────────────────────────────────────────────────────

@router.get("/run/{run_id}/status", response_model=TrackingRunStatus)
async def get_run_status(run_id: int, db: DbDep, user: CurrentUser):
    run = await db.get(TrackingRun, run_id)
    if run is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Tracking run {run_id} not found",
        )
    await get_brand_for_user(run.brand_id, db, user)
    return TrackingRunStatus.model_validate(run)


@router.get("/background-status")
async def get_background_status(db: DbDep, user: CurrentUser):
    """
    Lightweight poll endpoint for AppShell banners.

    Returns three boolean flags reflecting what is currently happening
    across all of the authenticated user's brands:

    - report_running:    any TrackingRun for user's brands is pending/running
    - drafts_generating: any brand_id is in state.generating_brands
    - scanning:          any brand_id is in state.scanning_brands
    - model_scores:      list of {model, score} for the active run (if any)
    """
    from app import state as _state

    # Get all brand IDs owned by this user
    brands_result = await db.execute(
        select(Brand.id).where(Brand.user_id == user.id)
    )
    user_brand_ids: set[int] = set(brands_result.scalars().all())

    if not user_brand_ids:
        return {"report_running": False, "drafts_generating": False, "scanning": False, "model_scores": []}

    # Check for active tracking runs in the DB
    running_result = await db.execute(
        select(TrackingRun).where(
            TrackingRun.brand_id.in_(user_brand_ids),
            TrackingRun.status.in_(["pending", "running"]),
        )
        .options(selectinload(TrackingRun.model_scores))
        .order_by(TrackingRun.created_at.desc())
        .limit(1)
    )
    active_run = running_result.scalar_one_or_none()
    report_running = active_run is not None

    # Get model scores for the active run
    model_scores = []
    if active_run and active_run.model_scores:
        model_scores = [
            {"model": ms.model, "score": round((ms.total_mentions / ms.total_queries) * 100) if ms.total_queries > 0 else 0}
            for ms in active_run.model_scores
        ]

    # Check in-memory sets for drafts and scanning
    drafts_generating = bool(user_brand_ids & _state.generating_brands)
    scanning = bool(user_brand_ids & _state.scanning_brands)

    return {
        "report_running": report_running,
        "drafts_generating": drafts_generating,
        "scanning": scanning,
        "model_scores": model_scores,
    }
