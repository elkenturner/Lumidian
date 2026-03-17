"""
Brands router — CRUD for brands and their associated prompts.

Routes
------
GET    /api/brands                              — list all brands (with prompt count)
POST   /api/brands                              — create brand + initial prompts
GET    /api/brands/{brand_id}                   — get brand with prompts
PUT    /api/brands/{brand_id}                   — update brand name / tier
DELETE /api/brands/{brand_id}                   — delete brand (cascade)
POST   /api/brands/{brand_id}/prompts           — add a prompt to a brand
DELETE /api/brands/{brand_id}/prompts/{prompt_id} — remove a prompt
"""

import re
from typing import Annotated, Optional

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.database import get_db
from app.models import Brand, Prompt, Competitor, TrackingRun
from app.schemas import (
    BrandCreate,
    BrandUpdate,
    BrandSummary,
    BrandDetail,
    BrandWithStats,
    PromptCreate,
    PromptResponse,
    CompetitorCreate,
    CompetitorResponse,
)

router = APIRouter(prefix="/brands", tags=["brands"])

DbDep = Annotated[AsyncSession, Depends(get_db)]


def _slugify(name: str) -> str:
    slug = name.lower().strip()
    slug = re.sub(r"[^\w\s-]", "", slug)
    slug = re.sub(r"[\s_-]+", "-", slug)
    slug = slug.strip("-")
    return slug


async def _get_brand_or_404(db: AsyncSession, brand_id: int) -> Brand:
    result = await db.execute(
        select(Brand)
        .where(Brand.id == brand_id)
        .options(selectinload(Brand.prompts))
    )
    brand = result.scalar_one_or_none()
    if brand is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Brand {brand_id} not found",
        )
    return brand


# ── List brands with stats (for brand switcher) ───────────────────────────────

@router.get("/with-stats", response_model=list[BrandWithStats])
async def list_brands_with_stats(db: DbDep):
    """Returns brands enriched with latest run score and trend direction."""
    # Get all brands with prompt count
    brands_result = await db.execute(
        select(Brand, func.count(Prompt.id).label("prompt_count"))
        .outerjoin(Prompt, Prompt.brand_id == Brand.id)
        .group_by(Brand.id)
        .order_by(Brand.created_at.desc())
    )
    brand_rows = brands_result.all()

    brand_ids = [b.id for b, _ in brand_rows]

    # Fetch the last 3 completed runs per brand using a subquery
    # We'll load all recent completed runs and process in Python
    runs_result = await db.execute(
        select(TrackingRun)
        .where(
            TrackingRun.brand_id.in_(brand_ids),
            TrackingRun.status == "completed",
            TrackingRun.overall_score.isnot(None),
        )
        .order_by(TrackingRun.brand_id, TrackingRun.completed_at.desc())
    )
    all_runs = runs_result.scalars().all()

    # Group runs by brand_id, keep last 3
    from collections import defaultdict
    runs_by_brand: dict[int, list[TrackingRun]] = defaultdict(list)
    for run in all_runs:
        if len(runs_by_brand[run.brand_id]) < 3:
            runs_by_brand[run.brand_id].append(run)

    def _compute_trend(runs: list[TrackingRun]) -> str:
        if len(runs) < 2:
            return "flat"
        # runs[0] is most recent
        newest = runs[0].overall_score or 0.0
        oldest = runs[-1].overall_score or 0.0
        diff = newest - oldest
        if diff > 2.0:
            return "up"
        elif diff < -2.0:
            return "down"
        return "flat"

    result = []
    for brand, prompt_count in brand_rows:
        runs = runs_by_brand.get(brand.id, [])
        latest_run = runs[0] if runs else None
        result.append(
            BrandWithStats(
                id=brand.id,
                name=brand.name,
                slug=brand.slug,
                tier=brand.tier,
                prompt_count=prompt_count,
                overall_score=round(latest_run.overall_score, 2) if latest_run and latest_run.overall_score is not None else None,
                last_run_at=latest_run.completed_at if latest_run else None,
                trend=_compute_trend(runs),
                created_at=brand.created_at,
                updated_at=brand.updated_at,
            )
        )
    return result


# ── List all brands ───────────────────────────────────────────────────────────

@router.get("", response_model=list[BrandSummary])
async def list_brands(db: DbDep):
    result = await db.execute(
        select(Brand, func.count(Prompt.id).label("prompt_count"))
        .outerjoin(Prompt, Prompt.brand_id == Brand.id)
        .group_by(Brand.id)
        .order_by(Brand.created_at.desc())
    )
    rows = result.all()
    brands = []
    for brand, prompt_count in rows:
        brands.append(
            BrandSummary(
                id=brand.id,
                name=brand.name,
                slug=brand.slug,
                tier=brand.tier,
                prompt_count=prompt_count,
                created_at=brand.created_at,
                updated_at=brand.updated_at,
            )
        )
    return brands


# ── Create brand ──────────────────────────────────────────────────────────────

@router.post("", response_model=BrandDetail, status_code=status.HTTP_201_CREATED)
async def create_brand(payload: BrandCreate, db: DbDep):
    slug = _slugify(payload.name)

    # Ensure slug uniqueness
    existing = await db.execute(select(Brand).where(Brand.slug == slug))
    if existing.scalar_one_or_none():
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"A brand with slug '{slug}' already exists",
        )

    brand = Brand(name=payload.name, slug=slug, tier=payload.tier)
    db.add(brand)
    await db.flush()  # gets brand.id without committing

    for text in payload.prompts:
        text = text.strip()
        if text:
            db.add(Prompt(brand_id=brand.id, text=text))

    await db.commit()
    await db.refresh(brand)

    # Re-load with prompts
    result = await db.execute(
        select(Brand).where(Brand.id == brand.id).options(selectinload(Brand.prompts))
    )
    brand = result.scalar_one()
    return BrandDetail.model_validate(brand)


# ── Get brand ─────────────────────────────────────────────────────────────────

@router.get("/{brand_id}", response_model=BrandDetail)
async def get_brand(brand_id: int, db: DbDep):
    brand = await _get_brand_or_404(db, brand_id)
    return BrandDetail.model_validate(brand)


# ── Update brand ──────────────────────────────────────────────────────────────

@router.put("/{brand_id}", response_model=BrandDetail)
async def update_brand(brand_id: int, payload: BrandUpdate, db: DbDep):
    brand = await _get_brand_or_404(db, brand_id)

    if payload.name is not None:
        new_slug = _slugify(payload.name)
        if new_slug != brand.slug:
            existing = await db.execute(select(Brand).where(Brand.slug == new_slug))
            if existing.scalar_one_or_none():
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail=f"A brand with slug '{new_slug}' already exists",
                )
            brand.slug = new_slug
        brand.name = payload.name

    if payload.tier is not None:
        brand.tier = payload.tier

    await db.commit()
    await db.refresh(brand)

    result = await db.execute(
        select(Brand).where(Brand.id == brand.id).options(selectinload(Brand.prompts))
    )
    brand = result.scalar_one()
    return BrandDetail.model_validate(brand)


# ── Delete brand ──────────────────────────────────────────────────────────────

@router.delete("/{brand_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_brand(brand_id: int, db: DbDep):
    brand = await _get_brand_or_404(db, brand_id)
    await db.delete(brand)
    await db.commit()


# ── Add prompt ────────────────────────────────────────────────────────────────

@router.post(
    "/{brand_id}/prompts",
    response_model=PromptResponse,
    status_code=status.HTTP_201_CREATED,
)
async def add_prompt(brand_id: int, payload: PromptCreate, db: DbDep):
    # Verify brand exists
    result = await db.execute(select(Brand).where(Brand.id == brand_id))
    if result.scalar_one_or_none() is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Brand {brand_id} not found",
        )

    text = payload.text.strip()
    if not text:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Prompt text cannot be empty",
        )

    prompt = Prompt(brand_id=brand_id, text=text)
    db.add(prompt)
    await db.commit()
    await db.refresh(prompt)
    return PromptResponse.model_validate(prompt)


# ── Delete prompt ─────────────────────────────────────────────────────────────

@router.delete(
    "/{brand_id}/prompts/{prompt_id}",
    status_code=status.HTTP_204_NO_CONTENT,
)
async def delete_prompt(brand_id: int, prompt_id: int, db: DbDep):
    result = await db.execute(
        select(Prompt).where(Prompt.id == prompt_id, Prompt.brand_id == brand_id)
    )
    prompt = result.scalar_one_or_none()
    if prompt is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Prompt {prompt_id} not found for brand {brand_id}",
        )
    await db.delete(prompt)
    await db.commit()


# ── List competitors ──────────────────────────────────────────────────────────

@router.get("/{brand_id}/competitors", response_model=list[CompetitorResponse])
async def list_competitors(brand_id: int, db: DbDep):
    result = await db.execute(select(Brand).where(Brand.id == brand_id))
    if result.scalar_one_or_none() is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Brand {brand_id} not found",
        )
    comp_result = await db.execute(
        select(Competitor)
        .where(Competitor.brand_id == brand_id)
        .order_by(Competitor.created_at.asc())
    )
    return [CompetitorResponse.model_validate(c) for c in comp_result.scalars().all()]


# ── Add competitor ────────────────────────────────────────────────────────────

@router.post(
    "/{brand_id}/competitors",
    response_model=CompetitorResponse,
    status_code=status.HTTP_201_CREATED,
)
async def add_competitor(brand_id: int, payload: CompetitorCreate, db: DbDep):
    result = await db.execute(select(Brand).where(Brand.id == brand_id))
    if result.scalar_one_or_none() is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Brand {brand_id} not found",
        )
    competitor = Competitor(brand_id=brand_id, name=payload.name)
    db.add(competitor)
    await db.commit()
    await db.refresh(competitor)
    return CompetitorResponse.model_validate(competitor)


# ── Remove competitor ─────────────────────────────────────────────────────────

@router.delete(
    "/{brand_id}/competitors/{competitor_id}",
    status_code=status.HTTP_204_NO_CONTENT,
)
async def remove_competitor(brand_id: int, competitor_id: int, db: DbDep):
    result = await db.execute(
        select(Competitor).where(
            Competitor.id == competitor_id,
            Competitor.brand_id == brand_id,
        )
    )
    competitor = result.scalar_one_or_none()
    if competitor is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Competitor {competitor_id} not found for brand {brand_id}",
        )
    await db.delete(competitor)
    await db.commit()
