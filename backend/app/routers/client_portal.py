"""Public, no-auth client portal router. Token-gated via ClientReviewLink.

All endpoints are read-only mirrors of SaaS surfaces, scoped to the brand
attached to the AgencyClient that owns the token.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy import desc, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.dependencies import ClientViewContext, get_client_view_context
from app.models import TrackingRun
from app.schemas import (
    ClientPortalBrandOut,
    ClientPortalProposalOut,
)

router = APIRouter(prefix="/api/public/client", tags=["client-portal"])


@router.get("/{token}/brand", response_model=ClientPortalBrandOut)
async def get_brand(ctx: ClientViewContext = Depends(get_client_view_context)):
    """Brand summary for the portal home."""
    return ClientPortalBrandOut(
        id=ctx.brand.id,
        name=ctx.brand.name,
        slug=ctx.brand.slug,
        brand_type=ctx.brand.brand_type,
        website_url=ctx.brand.website_url,
    )


@router.get("/{token}/proposal", response_model=ClientPortalProposalOut)
async def get_proposal(ctx: ClientViewContext = Depends(get_client_view_context)):
    """Current 'this week's proposal' pointer (Google Doc URL + label).

    Returns nulls if not set — the frontend hides the card in that case.
    """
    return ClientPortalProposalOut(
        doc_url=ctx.agency_client.current_proposal_doc_url,
        label=ctx.agency_client.current_proposal_label,
    )


@router.get("/{token}/dashboard")
async def get_dashboard(
    ctx: ClientViewContext = Depends(get_client_view_context),
    db: AsyncSession = Depends(get_db),
):
    """Visibility overview for the portal home: overall score, run counts, sparkline data."""
    brand_id = ctx.brand.id

    # Latest completed run
    latest_q = await db.execute(
        select(TrackingRun)
        .where(TrackingRun.brand_id == brand_id, TrackingRun.status == "completed")
        .order_by(desc(TrackingRun.completed_at))
        .limit(1)
    )
    latest = latest_q.scalar_one_or_none()

    # Total completed runs
    count_q = await db.execute(
        select(func.count(TrackingRun.id)).where(
            TrackingRun.brand_id == brand_id, TrackingRun.status == "completed"
        )
    )
    total_runs = count_q.scalar_one() or 0

    # Last 30 days of run scores for the sparkline
    spark_q = await db.execute(
        select(TrackingRun.completed_at, TrackingRun.overall_score)
        .where(TrackingRun.brand_id == brand_id, TrackingRun.status == "completed")
        .order_by(desc(TrackingRun.completed_at))
        .limit(30)
    )
    spark_rows = list(spark_q.all())
    sparkline = [
        {"completed_at": r[0].isoformat() if r[0] else None, "score": r[1]}
        for r in reversed(spark_rows)
    ]

    return {
        "overall_score": latest.overall_score if latest else None,
        "latest_run_at": latest.completed_at.isoformat() if latest and latest.completed_at else None,
        "total_runs": total_runs,
        "sparkline": sparkline,
    }


@router.get("/{token}/runs")
async def list_runs(
    ctx: ClientViewContext = Depends(get_client_view_context),
    db: AsyncSession = Depends(get_db),
    limit: int = 20,
):
    """Recent completed tracking runs for this brand."""
    limit = max(1, min(limit, 100))
    rows = await db.execute(
        select(TrackingRun)
        .where(TrackingRun.brand_id == ctx.brand.id, TrackingRun.status == "completed")
        .order_by(desc(TrackingRun.completed_at))
        .limit(limit)
    )
    runs = rows.scalars().all()
    return [
        {
            "id": r.id,
            "brand_id": r.brand_id,
            "status": r.status,
            "run_type": r.run_type,
            "overall_score": r.overall_score,
            "total_queries": r.total_queries,
            "total_mentions": r.total_mentions,
            "completed_at": r.completed_at.isoformat() if r.completed_at else None,
            "started_at": r.started_at.isoformat() if r.started_at else None,
        }
        for r in runs
    ]
