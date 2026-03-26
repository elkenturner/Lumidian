"""
Results router — analytics and response data for a brand.

Routes
------
GET /api/results/{brand_id}/overview    — latest run stats + per-model breakdown
GET /api/results/{brand_id}/trends      — all completed runs (for trend chart)
GET /api/results/{brand_id}/responses   — paginated query results (filter by run_id)
"""
from __future__ import annotations

from datetime import datetime, timezone, timedelta
from typing import Annotated, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.database import get_db
from app.dependencies import CurrentUser, get_brand_for_user
from app.models import Brand, TrackingRun, QueryResult, RunModelScore, Prompt, ContentAttribution
from app.utils import normalise_model, MODEL_ORDER
from app.schemas import (
    OverviewResponse,
    TrendPoint,
    TrendsResponse,
    TrackingRunSummary,
    ModelScoreResponse,
    QueryResultResponse,
    PaginatedQueryResults,
    ContentAttributionSummary,
)

router = APIRouter(prefix="/results", tags=["results"])

DbDep = Annotated[AsyncSession, Depends(get_db)]


async def _get_brand_or_404(db: AsyncSession, brand_id: int) -> Brand:
    result = await db.execute(select(Brand).where(Brand.id == brand_id))
    brand = result.scalar_one_or_none()
    if brand is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Brand {brand_id} not found",
        )
    return brand


# ── Overview ──────────────────────────────────────────────────────────────────

@router.get("/{brand_id}/overview", response_model=OverviewResponse)
async def get_overview(brand_id: int, db: DbDep, user: CurrentUser):
    brand = await get_brand_for_user(brand_id, db, user)

    # Latest completed run
    run_result = await db.execute(
        select(TrackingRun)
        .where(
            TrackingRun.brand_id == brand_id,
            TrackingRun.status == "completed",
        )
        .order_by(TrackingRun.completed_at.desc())
        .limit(1)
    )
    latest_run: Optional[TrackingRun] = run_result.scalar_one_or_none()

    model_breakdown: list[ModelScoreResponse] = []
    if latest_run is not None:
        scores_result = await db.execute(
            select(RunModelScore).where(
                RunModelScore.tracking_run_id == latest_run.id
            )
        )
        scores = scores_result.scalars().all()
        model_breakdown = [ModelScoreResponse.model_validate(s) for s in scores]

    # Content influence flag from latest run
    has_content_influence = latest_run.has_content_influence if latest_run else False

    # Recent attributions for this brand (last 30 days)
    thirty_days_ago = datetime.now(timezone.utc).replace(tzinfo=None) - timedelta(days=30)
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

    from collections import defaultdict as _dd
    scores_by_run: dict[int, dict[str, float]] = _dd(dict)
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
    run_id: Optional[int] = Query(None, description="Filter by specific tracking run ID"),
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
