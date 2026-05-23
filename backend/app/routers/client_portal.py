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
from app.models import Competitor, ContentDraft, Prompt, QueryResult, TrackingRun
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


@router.get("/{token}/responses")
async def list_responses(
    ctx: ClientViewContext = Depends(get_client_view_context),
    db: AsyncSession = Depends(get_db),
    run_id: int | None = None,
    limit: int = 200,
):
    """Raw LLM responses for a run (latest run if run_id not given)."""
    brand_id = ctx.brand.id
    limit = max(1, min(limit, 500))

    if run_id is None:
        latest_q = await db.execute(
            select(TrackingRun.id)
            .where(TrackingRun.brand_id == brand_id, TrackingRun.status == "completed")
            .order_by(desc(TrackingRun.completed_at))
            .limit(1)
        )
        run_id = latest_q.scalar_one_or_none()
        if run_id is None:
            return []

    # Validate the run belongs to this brand (defense in depth)
    own_q = await db.execute(
        select(TrackingRun.id).where(TrackingRun.id == run_id, TrackingRun.brand_id == brand_id)
    )
    if own_q.scalar_one_or_none() is None:
        return []

    rows = await db.execute(
        select(QueryResult, Prompt.text)
        .join(Prompt, Prompt.id == QueryResult.prompt_id)
        .where(QueryResult.tracking_run_id == run_id)
        .order_by(QueryResult.created_at.desc())
        .limit(limit)
    )
    out = []
    for qr, prompt_text in rows.all():
        out.append({
            "id": qr.id,
            "prompt_id": qr.prompt_id,
            "prompt_text": prompt_text,
            "model": qr.model,
            "run_number": qr.run_number,
            "response_text": qr.response_text,
            "mentioned": bool(qr.mentioned),
            "sentiment": qr.sentiment,
            "latency_ms": qr.latency_ms,
            "error": qr.error,
        })
    return out


@router.get("/{token}/competitors")
async def list_competitors(
    ctx: ClientViewContext = Depends(get_client_view_context),
    db: AsyncSession = Depends(get_db),
):
    """Competitor list for this brand."""
    rows = await db.execute(
        select(Competitor)
        .where(Competitor.brand_id == ctx.brand.id)
        .order_by(Competitor.id.asc())
    )
    return [
        {"id": c.id, "name": c.name, "website_url": c.website_url}
        for c in rows.scalars().all()
    ]


@router.get("/{token}/content")
async def list_posted_content(
    ctx: ClientViewContext = Depends(get_client_view_context),
    db: AsyncSession = Depends(get_db),
    limit: int = 100,
):
    """Posted-only content drafts for this brand (in-progress drafts are excluded)."""
    limit = max(1, min(limit, 500))
    rows = await db.execute(
        select(ContentDraft)
        .where(ContentDraft.brand_id == ctx.brand.id, ContentDraft.status == "posted")
        .order_by(desc(ContentDraft.posted_at))
        .limit(limit)
    )
    return [
        {
            "id": d.id,
            "title": d.title,
            "platform": d.platform,
            "status": d.status,
            "content_text": d.content_text,
            "posted_at": d.posted_at.isoformat() if d.posted_at else None,
            "created_at": d.created_at.isoformat() if d.created_at else None,
        }
        for d in rows.scalars().all()
    ]
