"""
Results router — analytics and response data for a brand.

Routes
------
GET /api/results/{brand_id}/overview              — latest run stats + per-model breakdown
GET /api/results/{brand_id}/trends                — all completed runs (for trend chart)
GET /api/results/{brand_id}/responses             — paginated query results (filter by run_id)
GET /api/results/{brand_id}/prompts/overview      — per-prompt sparkline + score summaries
GET /api/results/{brand_id}/prompt/{id}/timeline  — time-series scores + content events
GET /api/results/{brand_id}/prompt/{id}/detail    — comprehensive prompt intelligence
"""
from __future__ import annotations

import json
from collections import defaultdict
from datetime import UTC, datetime, timedelta
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.database import get_db
from app.dependencies import CurrentUser, get_brand_for_user
from app.services.heuristic_service import evaluate_heuristics
from app.models import (
    Brand, Competitor, CompetitorMention, ContentAttribution, ContentDraft,
    ContentEvent, DraftAttribution, Prompt, PromptRunScore, QueryResult,
    RunModelScore, TrackingRun,
)
from app.schemas import (
    ContentAttributionSummary,
    ContentEventResponse,
    ModelScoreResponse,
    OverviewResponse,
    PaginatedQueryResults,
    PromptCompetitorSummary,
    PromptDetailResponse,
    PromptDraftSnapshot,
    PromptInsight,
    PromptOverviewItem,
    PromptRecentResponse,
    PromptTimelinePoint,
    PromptTimelineResponse,
    PromptsOverviewResponse,
    QueryResultResponse,
    TrackingRunSummary,
    TrendPoint,
    TrendsResponse,
)
from app.utils import normalise_model

router = APIRouter(prefix="/results", tags=["results"])


def _safe_json(data: str | None) -> dict | None:
    """Parse JSON data, returning None on failure."""
    if not data:
        return None
    try:
        return json.loads(data)
    except (json.JSONDecodeError, TypeError):
        return None

DbDep = Annotated[AsyncSession, Depends(get_db)]



# ── Overview ──────────────────────────────────────────────────────────────────

@router.get("/{brand_id}/overview", response_model=OverviewResponse)
async def get_overview(brand_id: int, db: DbDep, user: CurrentUser):
    brand = await get_brand_for_user(brand_id, db, user)

    # Eager-load model scores with the run to avoid a separate round-trip
    run_result = await db.execute(
        select(TrackingRun)
        .where(
            TrackingRun.brand_id == brand_id,
            TrackingRun.status == "completed",
        )
        .options(selectinload(TrackingRun.model_scores))
        .order_by(TrackingRun.completed_at.desc())
        .limit(1)
    )
    latest_run: TrackingRun | None = run_result.scalar_one_or_none()

    model_breakdown: list[ModelScoreResponse] = []
    if latest_run is not None:
        model_breakdown = [ModelScoreResponse.model_validate(s) for s in latest_run.model_scores]

    # Content influence flag from latest run
    has_content_influence = latest_run.has_content_influence if latest_run else False

    # Recent attributions for this brand (last 30 days)
    thirty_days_ago = datetime.now(UTC).replace(tzinfo=None) - timedelta(days=30)
    attr_result = await db.execute(
        select(ContentAttribution)
        .where(
            ContentAttribution.brand_id == brand_id,
            ContentAttribution.measured_at >= thirty_days_ago,
        )
        .order_by(ContentAttribution.measured_at.desc())
    )
    recent_attributions_raw = attr_result.scalars().all()
    recent_attributions = [
        ContentAttributionSummary.model_validate(a) for a in recent_attributions_raw
    ]

    return OverviewResponse(
        brand_id=brand.id,
        brand_name=brand.name,
        brand_tier=brand.tier,
        latest_run=TrackingRunSummary.model_validate(latest_run) if latest_run else None,
        overall_score=latest_run.overall_score if latest_run else None,
        total_queries=latest_run.total_queries if latest_run else None,
        total_mentions=latest_run.total_mentions if latest_run else None,
        model_breakdown=model_breakdown,
        has_content_influence=has_content_influence,
        recent_attributions=recent_attributions,
    )


# ── Trends ────────────────────────────────────────────────────────────────────

@router.get("/{brand_id}/trends", response_model=TrendsResponse)
async def get_trends(
    brand_id: int,
    db: DbDep,
    user: CurrentUser,
    limit: int = Query(90, ge=10, le=365, description="Max runs to return (most recent)"),
):
    brand = await get_brand_for_user(brand_id, db, user)

    runs_result = await db.execute(
        select(TrackingRun)
        .where(
            TrackingRun.brand_id == brand_id,
            TrackingRun.status == "completed",
        )
        .order_by(TrackingRun.created_at.desc())
        .limit(limit)
    )
    runs = list(reversed(runs_result.scalars().all()))

    # Fetch all per-model scores for these runs in one query
    run_ids = [r.id for r in runs]
    if run_ids:
        ms_result = await db.execute(
            select(RunModelScore).where(RunModelScore.tracking_run_id.in_(run_ids))
        )
        all_model_scores = ms_result.scalars().all()
    else:
        all_model_scores = []

    scores_by_run: dict[int, dict[str, float]] = defaultdict(dict)
    for ms in all_model_scores:
        key = normalise_model(ms.model)
        scores_by_run[ms.tracking_run_id][key] = round(ms.score, 1)

    trend_data = [
        TrendPoint(
            run_id=r.id,
            created_at=r.created_at,
            completed_at=r.completed_at,
            overall_score=r.overall_score,
            total_queries=r.total_queries,
            total_mentions=r.total_mentions,
            run_type=r.run_type,
            schedule_slot=r.schedule_slot,
            has_content_influence=r.has_content_influence,
            model_scores=scores_by_run.get(r.id, {}),
        )
        for r in runs
    ]

    return TrendsResponse(
        brand_id=brand.id,
        brand_name=brand.name,
        trend_data=trend_data,
    )


# ── Paginated responses ───────────────────────────────────────────────────────

@router.get("/{brand_id}/responses", response_model=PaginatedQueryResults)
async def get_responses(
    brand_id: int,
    db: DbDep,
    user: CurrentUser,
    run_id: int | None = Query(None, description="Filter by specific tracking run ID"),
    page: int = Query(1, ge=1, description="Page number (1-indexed)"),
    page_size: int = Query(20, ge=1, le=500, description="Results per page"),
):
    brand = await get_brand_for_user(brand_id, db, user)

    # Build base query joining through tracking_runs to scope by brand
    base_query = (
        select(QueryResult)
        .join(TrackingRun, QueryResult.tracking_run_id == TrackingRun.id)
        .where(TrackingRun.brand_id == brand_id)
    )

    if run_id is not None:
        base_query = base_query.where(QueryResult.tracking_run_id == run_id)

    # Total count
    from sqlalchemy import func as sqlfunc

    count_query = select(sqlfunc.count()).select_from(base_query.subquery())
    total_result = await db.execute(count_query)
    total: int = total_result.scalar_one()

    # Paginated rows, also fetch prompt text via join
    offset = (page - 1) * page_size
    rows_result = await db.execute(
        base_query
        .options(selectinload(QueryResult.prompt))
        .order_by(QueryResult.created_at.desc())
        .offset(offset)
        .limit(page_size)
    )
    rows = rows_result.scalars().all()

    items = [
        QueryResultResponse(
            id=qr.id,
            tracking_run_id=qr.tracking_run_id,
            prompt_id=qr.prompt_id,
            prompt_text=qr.prompt.text if qr.prompt else None,
            model=qr.model,
            run_number=qr.run_number,
            response_text=qr.response_text,
            mentioned=qr.mentioned,
            latency_ms=qr.latency_ms,
            error=qr.error,
            created_at=qr.created_at,
        )
        for qr in rows
    ]

    return PaginatedQueryResults(
        total=total,
        page=page,
        page_size=page_size,
        items=items,
    )


# ── Prompts Overview (for sparklines) ────────────────────────────────────────

@router.get("/{brand_id}/prompts/overview", response_model=PromptsOverviewResponse)
async def get_prompts_overview(brand_id: int, db: DbDep, user: CurrentUser):
    brand = await get_brand_for_user(brand_id, db, user)

    # Get all prompts for this brand
    prompts_result = await db.execute(
        select(Prompt).where(Prompt.brand_id == brand_id)
    )
    prompts = prompts_result.scalars().all()
    if not prompts:
        return PromptsOverviewResponse(prompts=[])

    prompt_ids = [p.id for p in prompts]

    # Get PromptRunScore data per prompt
    scores_result = await db.execute(
        select(PromptRunScore)
        .where(PromptRunScore.brand_id == brand_id)
        .order_by(PromptRunScore.created_at.desc())
    )
    all_scores = scores_result.scalars().all()

    # Group by prompt_id
    scores_by_prompt: dict[int, list] = defaultdict(list)
    for s in all_scores:
        scores_by_prompt[s.prompt_id].append(s)

    # Count posted drafts per prompt
    draft_result = await db.execute(
        select(ContentDraft)
        .where(
            ContentDraft.brand_id == brand_id,
            ContentDraft.status == "posted",
            ContentDraft.prompt_id.in_(prompt_ids),
        )
        .order_by(ContentDraft.posted_at.desc())
    )
    drafts = draft_result.scalars().all()
    drafts_by_prompt: dict[int, list] = defaultdict(list)
    for d in drafts:
        if d.prompt_id:
            drafts_by_prompt[d.prompt_id].append(d)

    # Check for recent content events
    thirty_days_ago = datetime.now(UTC).replace(tzinfo=None) - timedelta(days=30)
    events_result = await db.execute(
        select(ContentEvent)
        .where(
            ContentEvent.brand_id == brand_id,
            ContentEvent.created_at >= thirty_days_ago,
        )
    )
    recent_events = events_result.scalars().all()
    prompts_with_events = {e.prompt_id for e in recent_events if e.prompt_id}

    items = []
    for p in prompts:
        prompt_scores = scores_by_prompt.get(p.id, [])

        # Get unique runs, sorted by time (most recent first, then reverse for sparkline)
        runs_seen: dict[int, dict[str, float]] = {}
        for s in prompt_scores:
            if s.tracking_run_id not in runs_seen:
                runs_seen[s.tracking_run_id] = {}
            runs_seen[s.tracking_run_id][s.model] = s.score

        # Build sparkline from overall averages (last 10 runs)
        run_overalls = []
        for run_id, model_scores in runs_seen.items():
            avg = round(sum(model_scores.values()) / len(model_scores), 1) if model_scores else 0
            run_overalls.append(avg)
        sparkline = list(reversed(run_overalls[:10]))  # oldest-to-newest, max 10

        # Current scores from most recent run
        current_model_scores = {}
        if runs_seen:
            latest_run_id = next(iter(runs_seen))
            current_model_scores = runs_seen[latest_run_id]
        current_overall = round(sum(current_model_scores.values()) / len(current_model_scores), 1) if current_model_scores else 0

        # Trend
        trend = "stable"
        if len(sparkline) >= 3:
            recent_avg = sum(sparkline[-3:]) / 3
            older_avg = sum(sparkline[:3]) / 3
            if recent_avg - older_avg >= 3:
                trend = "improving"
            elif older_avg - recent_avg >= 3:
                trend = "declining"

        prompt_drafts = drafts_by_prompt.get(p.id, [])
        items.append(PromptOverviewItem(
            prompt_id=p.id,
            prompt_text=p.text,
            current_overall=current_overall,
            trend=trend,
            sparkline=sparkline,
            model_scores=current_model_scores,
            drafts_posted=len(prompt_drafts),
            last_draft_at=prompt_drafts[0].posted_at if prompt_drafts else None,
            has_recent_content_event=p.id in prompts_with_events,
        ))

    return PromptsOverviewResponse(prompts=items)


# ── Prompt Timeline ──────────────────────────────────────────────────────────

@router.get("/{brand_id}/prompt/{prompt_id}/timeline", response_model=PromptTimelineResponse)
async def get_prompt_timeline(
    brand_id: int,
    prompt_id: int,
    db: DbDep,
    user: CurrentUser,
    days: int = Query(90, ge=7, le=365),
):
    brand = await get_brand_for_user(brand_id, db, user)

    # Get the prompt
    prompt_result = await db.execute(
        select(Prompt).where(Prompt.id == prompt_id, Prompt.brand_id == brand_id)
    )
    prompt = prompt_result.scalar_one_or_none()
    if not prompt:
        raise HTTPException(status_code=404, detail="Prompt not found")

    cutoff = datetime.now(UTC).replace(tzinfo=None) - timedelta(days=days)

    # Get PromptRunScores
    scores_result = await db.execute(
        select(PromptRunScore)
        .join(TrackingRun, PromptRunScore.tracking_run_id == TrackingRun.id)
        .where(
            PromptRunScore.prompt_id == prompt_id,
            PromptRunScore.created_at >= cutoff,
        )
        .order_by(PromptRunScore.created_at.asc())
    )
    scores = scores_result.scalars().all()

    # Build timeline grouped by run
    runs_data: dict[int, dict] = {}
    for s in scores:
        if s.tracking_run_id not in runs_data:
            runs_data[s.tracking_run_id] = {"scores": {}, "completed_at": s.created_at}
        runs_data[s.tracking_run_id]["scores"][s.model] = s.score

    timeline = []
    for run_id, rd in runs_data.items():
        model_scores = rd["scores"]
        overall = round(sum(model_scores.values()) / len(model_scores), 1) if model_scores else 0
        timeline.append(PromptTimelinePoint(
            run_id=run_id,
            completed_at=rd["completed_at"],
            scores=model_scores,
            overall=overall,
        ))

    # Get content events
    events_result = await db.execute(
        select(ContentEvent)
        .where(
            ContentEvent.prompt_id == prompt_id,
            ContentEvent.event_type.in_(["draft_posted", "content_correlated"]),
            ContentEvent.created_at >= cutoff,
        )
        .order_by(ContentEvent.created_at.asc())
    )
    events = events_result.scalars().all()

    content_events = [
        ContentEventResponse(
            id=e.id,
            event_type=e.event_type,
            created_at=e.created_at,
            data=_safe_json(e.data),
        )
        for e in events
    ]

    # Current scores (from latest timeline point)
    current_scores = timeline[-1].scores if timeline else {}

    # Draft count
    draft_count_result = await db.execute(
        select(ContentDraft)
        .where(ContentDraft.prompt_id == prompt_id, ContentDraft.status == "posted")
        .order_by(ContentDraft.posted_at.desc())
    )
    posted_drafts = draft_count_result.scalars().all()

    return PromptTimelineResponse(
        prompt_id=prompt.id,
        prompt_text=prompt.text,
        timeline=timeline,
        content_events=content_events,
        current_scores=current_scores,
        total_drafts_targeting=len(posted_drafts),
        latest_draft_posted_at=posted_drafts[0].posted_at if posted_drafts else None,
    )


# ── Prompt Detail ────────────────────────────────────────────────────────────

@router.get("/{brand_id}/prompt/{prompt_id}/detail", response_model=PromptDetailResponse)
async def get_prompt_detail(
    brand_id: int,
    prompt_id: int,
    db: DbDep,
    user: CurrentUser,
):
    brand = await get_brand_for_user(brand_id, db, user)

    # Get prompt
    prompt_result = await db.execute(
        select(Prompt).where(Prompt.id == prompt_id, Prompt.brand_id == brand_id)
    )
    prompt = prompt_result.scalar_one_or_none()
    if not prompt:
        raise HTTPException(status_code=404, detail="Prompt not found")

    cutoff = datetime.now(UTC).replace(tzinfo=None) - timedelta(days=90)

    # Scores
    scores_result = await db.execute(
        select(PromptRunScore)
        .where(PromptRunScore.prompt_id == prompt_id, PromptRunScore.created_at >= cutoff)
        .order_by(PromptRunScore.created_at.asc())
    )
    scores = scores_result.scalars().all()

    runs_data: dict[int, dict] = {}
    for s in scores:
        if s.tracking_run_id not in runs_data:
            runs_data[s.tracking_run_id] = {"scores": {}, "completed_at": s.created_at}
        runs_data[s.tracking_run_id]["scores"][s.model] = s.score

    timeline = []
    for run_id, rd in runs_data.items():
        ms = rd["scores"]
        overall = round(sum(ms.values()) / len(ms), 1) if ms else 0
        timeline.append(PromptTimelinePoint(
            run_id=run_id, completed_at=rd["completed_at"], scores=ms, overall=overall,
        ))

    current_scores = timeline[-1].scores if timeline else {}

    # Score trend
    trend = "stable"
    if len(timeline) >= 3:
        recent = sum(t.overall for t in timeline[-3:]) / 3
        older = sum(t.overall for t in timeline[:3]) / 3
        if recent - older >= 3:
            trend = "improving"
        elif older - recent >= 3:
            trend = "declining"

    # Content events
    events_result = await db.execute(
        select(ContentEvent)
        .where(ContentEvent.prompt_id == prompt_id, ContentEvent.created_at >= cutoff)
        .order_by(ContentEvent.created_at.asc())
    )
    events = events_result.scalars().all()
    content_events = [
        ContentEventResponse(
            id=e.id, event_type=e.event_type, created_at=e.created_at,
            data=_safe_json(e.data),
        )
        for e in events
    ]

    # Drafts targeting this prompt
    drafts_result = await db.execute(
        select(ContentDraft)
        .where(ContentDraft.prompt_id == prompt_id)
        .order_by(ContentDraft.created_at.desc())
    )
    drafts = drafts_result.scalars().all()

    # Batch-fetch DraftAttribution for posted drafts (avoids N+1)
    posted_draft_ids = [d.id for d in drafts if d.status == "posted"]
    attrs_by_draft: dict[int, DraftAttribution] = {}
    if posted_draft_ids:
        attr_result = await db.execute(
            select(DraftAttribution).where(DraftAttribution.draft_id.in_(posted_draft_ids))
        )
        for attr in attr_result.scalars().all():
            attrs_by_draft[attr.draft_id] = attr

    draft_snapshots = []
    for d in drafts:
        snapshot = {"at_posting": None, "current": None, "delta": None, "runs_since": None}
        attr = attrs_by_draft.get(d.id)
        if attr:
            snapshot = {
                "at_posting": attr.score_at_posting,
                "current": attr.current_score,
                "delta": attr.delta,
                "runs_since": attr.runs_since_posting,
            }
        draft_snapshots.append(PromptDraftSnapshot(
            id=d.id,
            platform=d.platform,
            status=d.status,
            posted_at=d.posted_at,
            visibility_at_post=d.visibility_at_post,
            content_preview=d.content_text[:150] if d.content_text else "",
            score_snapshot=snapshot,
        ))

    # Competitors on this prompt
    comp_result = await db.execute(
        select(Competitor).where(Competitor.brand_id == brand_id)
    )
    competitors = comp_result.scalars().all()

    competitor_summaries = []
    if competitors:
        comp_ids = [c.id for c in competitors]
        comp_by_id = {c.id: c for c in competitors}
        mentions_result = await db.execute(
            select(CompetitorMention)
            .join(TrackingRun, CompetitorMention.tracking_run_id == TrackingRun.id)
            .where(
                CompetitorMention.competitor_id.in_(comp_ids),
                CompetitorMention.prompt_id == prompt_id,
                TrackingRun.completed_at >= cutoff,
            )
        )
        all_mentions = mentions_result.scalars().all()
        mentions_by_comp: dict[int, list] = defaultdict(list)
        for m in all_mentions:
            mentions_by_comp[m.competitor_id].append(m)
        for comp_id, mentions in mentions_by_comp.items():
            rate = round(sum(1 for m in mentions if m.mentioned) / len(mentions), 2)
            competitor_summaries.append(PromptCompetitorSummary(
                name=comp_by_id[comp_id].name, mention_rate=rate, trend="stable",
            ))

    # Heuristics
    history = [{"overall": t.overall, "run_id": t.run_id} for t in timeline]
    event_dicts = [{"event_type": e.event_type, "created_at": str(e.created_at), "data": e.data} for e in events]
    raw_insights = evaluate_heuristics(
        prompt_id=prompt_id,
        current_scores=current_scores,
        score_history=history,
        content_events=event_dicts,
        drafts_posted=sum(1 for d in drafts if d.status == "posted"),
    )
    insights = [PromptInsight(**{k: v for k, v in i.items() if k in ("id", "message", "severity", "model")}) for i in raw_insights]

    # Recent AI responses (latest run, one per model)
    latest_run_result = await db.execute(
        select(TrackingRun)
        .where(TrackingRun.brand_id == brand_id, TrackingRun.status == "completed")
        .order_by(TrackingRun.completed_at.desc())
        .limit(1)
    )
    latest_run = latest_run_result.scalar_one_or_none()

    recent_responses = []
    if latest_run:
        resp_result = await db.execute(
            select(QueryResult)
            .where(
                QueryResult.tracking_run_id == latest_run.id,
                QueryResult.prompt_id == prompt_id,
            )
            .order_by(QueryResult.model)
        )
        resps = resp_result.scalars().all()
        seen_models = set()
        for r in resps:
            if r.model not in seen_models:
                seen_models.add(r.model)
                recent_responses.append(PromptRecentResponse(
                    model=r.model,
                    response_text=r.response_text,
                    mentioned=r.mentioned,
                    sentiment=r.sentiment,
                    created_at=r.created_at,
                ))

    return PromptDetailResponse(
        prompt_id=prompt.id,
        prompt_text=prompt.text,
        prompt_type=prompt.prompt_type or "standard",
        current_scores=current_scores,
        score_trend=trend,
        timeline=timeline,
        content_events=content_events,
        drafts=draft_snapshots,
        competitors=competitor_summaries,
        insights=insights,
        recent_responses=recent_responses,
    )
