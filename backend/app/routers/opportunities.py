"""
Opportunities router — content opportunities discovered by the Reddit scanner.

Routes
------
GET    /api/opportunities/{brand_id}              — list opportunities for a brand
DELETE /api/opportunities/{opportunity_id}/dismiss — dismiss (mark as dismissed)
POST   /api/opportunities/{opportunity_id}/draft   — draft a reply for a thread
POST   /api/opportunities/{brand_id}/scan          — trigger an on-demand scan
"""
from __future__ import annotations

from typing import Annotated, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models import Brand, ContentOpportunity, Prompt, utcnow
from app.schemas import ContentDraftSchema, ContentOpportunitySchema

router = APIRouter(prefix="/opportunities", tags=["opportunities"])

DbDep = Annotated[AsyncSession, Depends(get_db)]


async def _get_brand_or_404(db: AsyncSession, brand_id: int) -> Brand:
    result = await db.execute(select(Brand).where(Brand.id == brand_id))
    brand = result.scalar_one_or_none()
    if brand is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Brand {brand_id} not found")
    return brand


async def _get_opportunity_or_404(db: AsyncSession, opp_id: int) -> ContentOpportunity:
    result = await db.execute(select(ContentOpportunity).where(ContentOpportunity.id == opp_id))
    opp = result.scalar_one_or_none()
    if opp is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Opportunity {opp_id} not found")
    return opp


def _enrich_opportunity(opp: ContentOpportunity, prompt_text_map: dict[int, str]) -> dict:
    data = ContentOpportunitySchema.model_validate(opp).model_dump()
    if opp.prompt_id and opp.prompt_id in prompt_text_map:
        data["prompt_text"] = prompt_text_map[opp.prompt_id]
    return data


@router.get("/{brand_id}", response_model=list[dict])
async def list_opportunities(
    brand_id: int,
    db: DbDep,
    opp_status: Optional[str] = Query(None, alias="status", description="Filter by status: new, drafted, dismissed"),
    limit: int = Query(50, ge=1, le=200),
):
    """List content opportunities (Reddit/Quora threads) for a brand."""
    await _get_brand_or_404(db, brand_id)

    stmt = (
        select(ContentOpportunity)
        .where(ContentOpportunity.brand_id == brand_id)
    )
    if opp_status is not None:
        stmt = stmt.where(ContentOpportunity.status == opp_status)
    else:
        # Default: only show new ones
        stmt = stmt.where(ContentOpportunity.status == "new")

    stmt = stmt.order_by(
        ContentOpportunity.relevance_score.desc(),
        ContentOpportunity.created_at.desc(),
    ).limit(limit)

    result = await db.execute(stmt)
    opps = list(result.scalars().all())

    # Bulk load prompt texts
    prompt_ids = list({o.prompt_id for o in opps if o.prompt_id})
    prompt_text_map: dict[int, str] = {}
    if prompt_ids:
        pr_result = await db.execute(select(Prompt).where(Prompt.id.in_(prompt_ids)))
        for p in pr_result.scalars().all():
            prompt_text_map[p.id] = p.text

    return [_enrich_opportunity(o, prompt_text_map) for o in opps]


@router.delete("/{opportunity_id}/dismiss", status_code=status.HTTP_204_NO_CONTENT)
async def dismiss_opportunity(opportunity_id: int, db: DbDep):
    """Mark an opportunity as dismissed so it no longer appears in the queue."""
    opp = await _get_opportunity_or_404(db, opportunity_id)
    opp.status = "dismissed"
    await db.commit()


@router.post(
    "/{opportunity_id}/draft",
    response_model=ContentDraftSchema,
    status_code=status.HTTP_201_CREATED,
)
async def draft_opportunity(opportunity_id: int, db: DbDep):
    """
    Generate a reply draft for a specific Reddit/Quora thread opportunity.
    Uses the dynamic drafting engine with full BrandProfile context.
    """
    from app.services.drafting_service import generate_opportunity_draft

    await _get_opportunity_or_404(db, opportunity_id)

    try:
        draft = await generate_opportunity_draft(db=db, opportunity_id=opportunity_id)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc))
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Draft generation failed: {exc}",
        )

    return ContentDraftSchema.model_validate(draft)


@router.post("/{brand_id}/scan", status_code=status.HTTP_202_ACCEPTED)
async def trigger_scan(brand_id: int, db: DbDep):
    """
    Trigger an on-demand Reddit scan for a brand (fire-and-forget).
    Returns immediately; scan runs in the background.
    """
    import asyncio
    from app.services.reddit_scanner_service import scan_brand_opportunities

    await _get_brand_or_404(db, brand_id)

    asyncio.create_task(
        scan_brand_opportunities(brand_id, clear_existing=True),
        name=f"reddit-scan-{brand_id}",
    )
    return {"message": f"Reddit scan started for brand {brand_id}", "brand_id": brand_id}
