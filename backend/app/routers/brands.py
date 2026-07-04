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

import json as _json
import logging
import os as _os
import re
from typing import Annotated

logger = logging.getLogger(__name__)


def _ensure_question_mark(text: str) -> str:
    """Strip trailing whitespace and trailing terminal punctuation, then append '?'."""
    cleaned = text.strip().rstrip("?.!")
    if not cleaned:
        return cleaned
    return cleaned + "?"


from datetime import UTC, datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import delete as sa_delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.database import fail_stale_runs_for_brand, get_db
from app.dependencies import CurrentUser, check_rate_limit, get_brand_for_user, get_data_owner_id
from app.models import Brand, CompetitorMention, Competitor, ContentAttribution, ContentDraft, ContentGap, DraftAttribution, Prompt, PromptRunScore, QueryResult, TrackingRun, User
from app.schemas import (
    BrandCreate,
    BrandDetail,
    BrandSummary,
    BrandUpdate,
    BrandWithStats,
    CompetitorAnalysisResponse,
    CompetitorByModel,
    CompetitorCreate,
    CompetitorPromptResult,
    CompetitorResponse,
    FetchWebsiteContextRequest,
    FetchWebsiteContextResponse,
    InferScopeResponse,
    OverallSOV,
    PromptCreate,
    PromptResponse,
    PromptUpdate,
)

router = APIRouter(prefix="/brands", tags=["brands"])

DbDep = Annotated[AsyncSession, Depends(get_db)]



def _slugify(name: str) -> str:
    slug = name.lower().strip()
    slug = re.sub(r"[^\w\s-]", "", slug)
    slug = re.sub(r"[\s_-]+", "-", slug)
    slug = slug.strip("-")
    return slug


async def _get_brand_or_404(
    db: AsyncSession, brand_id: int, user: User | None = None, *, owner_only: bool = False
) -> Brand:
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
    if user is not None:
        if getattr(user, "is_admin", False):
            return brand
        if owner_only:
            if brand.user_id != user.id:
                raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access denied")
        else:
            effective_owner_id = await get_data_owner_id(db, user)
            if brand.user_id != effective_owner_id:
                raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access denied")
    return brand


async def _attach_has_history(db: AsyncSession, brand: Brand) -> None:
    """Set `has_history` (transient attribute) on each of the brand's prompts."""
    if not brand.prompts:
        return
    prompt_ids = [p.id for p in brand.prompts]
    rows = await db.execute(
        select(QueryResult.prompt_id)
        .where(QueryResult.prompt_id.in_(prompt_ids))
        .distinct()
    )
    with_history = {r[0] for r in rows.all()}
    for p in brand.prompts:
        p.has_history = p.id in with_history


# ── List brands with stats (for brand switcher) ───────────────────────────────

@router.get("/with-stats", response_model=list[BrandWithStats])
async def list_brands_with_stats(db: DbDep, user: CurrentUser):
    """Returns brands enriched with latest run score and trend direction."""
    owner_id = await get_data_owner_id(db, user)
    # Get user's brands with prompt count
    brands_result = await db.execute(
        select(Brand, func.count(Prompt.id).label("prompt_count"))
        .outerjoin(Prompt, Prompt.brand_id == Brand.id)
        .where(Brand.user_id == owner_id, Brand.brand_type != "agency")
        .group_by(Brand.id)
        .order_by(Brand.created_at.desc())
    )
    brand_rows = brands_result.all()

    brand_ids = [b.id for b, _ in brand_rows]

    # Fetch the last 3 completed runs per brand.
    # Cap total loaded rows to avoid runaway queries on large datasets.
    runs_result = await db.execute(
        select(TrackingRun)
        .where(
            TrackingRun.brand_id.in_(brand_ids),
            TrackingRun.status == "completed",
            TrackingRun.overall_score.isnot(None),
        )
        .order_by(TrackingRun.brand_id, TrackingRun.completed_at.desc())
        .limit(len(brand_ids) * 10)
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
                brand_type=getattr(brand, "brand_type", "standard"),
                prompt_limit=getattr(brand, "prompt_limit", 25),
                pitch_expires_at=getattr(brand, "pitch_expires_at", None),
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
async def list_brands(db: DbDep, user: CurrentUser):
    owner_id = await get_data_owner_id(db, user)
    result = await db.execute(
        select(Brand, func.count(Prompt.id).label("prompt_count"))
        .outerjoin(Prompt, Prompt.brand_id == Brand.id)
        .where(Brand.user_id == owner_id, Brand.brand_type != "agency")
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
                brand_type=brand.brand_type,
                prompt_limit=getattr(brand, "prompt_limit", 25),
                pitch_expires_at=brand.pitch_expires_at,
                prompt_count=prompt_count,
                website_url=brand.website_url,
                created_at=brand.created_at,
                updated_at=brand.updated_at,
            )
        )
    return brands


# ── Create brand ──────────────────────────────────────────────────────────────

@router.post("", response_model=BrandDetail, status_code=status.HTTP_201_CREATED)
async def create_brand(payload: BrandCreate, db: DbDep, user: CurrentUser):
    if not user.is_admin:
        from app.routers.billing import BRAND_TYPE_LIMITS
        limits = BRAND_TYPE_LIMITS.get(user.subscription_tier, BRAND_TYPE_LIMITS[None])

        # Validate brand_type is allowed for this tier
        if payload.brand_type not in limits or limits[payload.brand_type] == 0:
            if payload.brand_type == "pro":
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="Pro brands require a Pro subscription. Upgrade to create pro brands.",
                )
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Your subscription does not allow creating {payload.brand_type} brands.",
            )

        brand_type_limit = limits[payload.brand_type]
        existing_of_type = await db.execute(
            select(func.count(Brand.id)).where(
                Brand.user_id == user.id,
                Brand.brand_type == payload.brand_type,
            )
        )
        count_of_type = existing_of_type.scalar_one()
        if count_of_type >= brand_type_limit:
            from app.routers.billing import TIER_DISPLAY_NAMES
            tier_display = TIER_DISPLAY_NAMES.get(user.subscription_tier, "Free")
            kind = "pitch" if payload.brand_type == "pitch" else "standard"
            raise HTTPException(
                status_code=status.HTTP_402_PAYMENT_REQUIRED,
                detail=f"Brand limit reached: your {tier_display} plan allows {brand_type_limit} {kind} brand(s). Upgrade to add more.",
            )

    slug = _slugify(payload.name)

    # Ensure slug uniqueness (global namespace)
    existing = await db.execute(select(Brand).where(Brand.slug == slug))
    if existing.scalar_one_or_none():
        if user.is_admin:
            # Admin can create duplicates — generate a unique slug
            suffix = 2
            while True:
                candidate = f"{slug}-{suffix}"
                check = await db.execute(select(Brand).where(Brand.slug == candidate))
                if not check.scalar_one_or_none():
                    slug = candidate
                    break
                suffix += 1
        else:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"A brand with slug '{slug}' already exists",
            )

    if not user.is_admin:
        # Per-user deduplication: prevent the same brand occupying multiple slots
        # (blocks cycling pitch brands or double-tracking via standard + pitch)
        base_slug = _slugify(payload.name)
        dup_name_result = await db.execute(
            select(func.count(Brand.id)).where(
                Brand.user_id == user.id,
                Brand.slug == base_slug,
            )
        )
        if (dup_name_result.scalar_one() or 0) > 0:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Your account is already tracking a brand with this name.",
            )

        if payload.website_url:
            norm_url = payload.website_url.rstrip("/").lower()
            dup_url_result = await db.execute(
                select(func.count(Brand.id)).where(
                    Brand.user_id == user.id,
                    func.lower(Brand.website_url) == norm_url,
                )
            )
            if (dup_url_result.scalar_one() or 0) > 0:
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail="Your account is already tracking a brand at this website.",
                )

    pitch_expires_at = None
    if payload.brand_type == "pitch":
        pitch_expires_at = datetime.now(UTC).replace(tzinfo=None) + timedelta(days=30)

    from app.routers.billing import PROMPT_LIMITS
    # Set prompt limit based on brand type
    prompt_limit = PROMPT_LIMITS.get(payload.brand_type, 25)

    # Enforce tier based on brand_type — ignore user-supplied value to prevent
    # free users from choosing "premium" tier.
    BRAND_TYPE_TO_TIER = {"pitch": "basic", "standard": "standard", "pro": "premium"}
    enforced_tier = BRAND_TYPE_TO_TIER.get(payload.brand_type, "basic")

    brand = Brand(
        name=payload.name,
        slug=slug,
        tier=enforced_tier,
        brand_type=payload.brand_type,
        prompt_limit=prompt_limit,
        pitch_expires_at=pitch_expires_at,
        user_id=user.id,
        website_url=payload.website_url,
    )
    db.add(brand)
    await db.flush()  # gets brand.id without committing

    # Cap initial prompts at the brand's prompt_limit
    prompt_list = payload.prompts[:prompt_limit]
    for text in prompt_list:
        text = text.strip()
        if text:
            prompt_type = "pitch" if payload.brand_type == "pitch" else "standard"
            db.add(Prompt(brand_id=brand.id, text=text, prompt_type=prompt_type))

    # Eagerly create a ContentCluster shell per prompt so the cluster grid
    # always shows 1 card per tracked prompt (no orphans).
    await db.flush()
    from app.models import ContentCluster as _CC
    inserted_prompts = (await db.execute(
        select(Prompt).where(Prompt.brand_id == brand.id)
    )).scalars().all()
    for p in inserted_prompts:
        existing = (await db.execute(
            select(_CC).where(_CC.prompt_id == p.id)
        )).scalar_one_or_none()
        if existing is None:
            db.add(_CC(
                brand_id=brand.id, prompt_id=p.id,
                status="pending", pillar_mode="none", version=0,
            ))

    await db.commit()
    await db.refresh(brand)

    # Re-load with prompts
    result = await db.execute(
        select(Brand).where(Brand.id == brand.id).options(selectinload(Brand.prompts))
    )
    brand = result.scalar_one()
    await _attach_has_history(db, brand)
    return BrandDetail.model_validate(brand)


# ── Get brand ─────────────────────────────────────────────────────────────────

@router.get("/{brand_id}", response_model=BrandDetail)
async def get_brand(brand_id: int, db: DbDep, user: CurrentUser):
    brand = await _get_brand_or_404(db, brand_id, user)
    await _attach_has_history(db, brand)
    return BrandDetail.model_validate(brand)


# ── Update brand ──────────────────────────────────────────────────────────────

@router.put("/{brand_id}", response_model=BrandDetail)
async def update_brand(brand_id: int, payload: BrandUpdate, db: DbDep, user: CurrentUser):
    brand = await _get_brand_or_404(db, brand_id, user)

    if payload.name is not None:
        new_slug = _slugify(payload.name)
        if new_slug != brand.slug:
            # Global slug uniqueness
            existing = await db.execute(select(Brand).where(Brand.slug == new_slug))
            if existing.scalar_one_or_none():
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail=f"A brand with slug '{new_slug}' already exists",
                )
            # Per-user name dedup (same check as create_brand)
            if not getattr(user, "is_admin", False):
                dup_result = await db.execute(
                    select(func.count(Brand.id)).where(
                        Brand.user_id == user.id,
                        Brand.slug == new_slug,
                    )
                )
                if (dup_result.scalar_one() or 0) > 0:
                    raise HTTPException(
                        status_code=status.HTTP_409_CONFLICT,
                        detail="Your account is already tracking a brand with this name.",
                    )
            brand.slug = new_slug
        brand.name = payload.name

    if payload.tier is not None:
        if not user.is_admin:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Brand tier cannot be changed directly. Upgrade your subscription instead.",
            )
        brand.tier = payload.tier

    if payload.website_url is not None:
        brand.website_url = payload.website_url or None

    await db.commit()
    await db.refresh(brand)

    result = await db.execute(
        select(Brand).where(Brand.id == brand.id).options(selectinload(Brand.prompts))
    )
    brand = result.scalar_one()
    await _attach_has_history(db, brand)
    return BrandDetail.model_validate(brand)


# ── Delete brand ──────────────────────────────────────────────────────────────

@router.delete("/{brand_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_brand(brand_id: int, db: DbDep, user: CurrentUser):
    brand = await _get_brand_or_404(db, brand_id, user, owner_only=True)
    # Clean up rows that reference this brand's prompts/runs without ondelete rules
    prompt_ids = [p.id for p in brand.prompts] if brand.prompts else []
    if prompt_ids:
        await db.execute(sa_delete(ContentAttribution).where(ContentAttribution.prompt_id.in_(prompt_ids)))
        await db.execute(sa_delete(CompetitorMention).where(CompetitorMention.prompt_id.in_(prompt_ids)))
        await db.execute(sa_delete(QueryResult).where(QueryResult.prompt_id.in_(prompt_ids)))
        await db.execute(sa_delete(ContentDraft).where(ContentDraft.prompt_id.in_(prompt_ids)))
    await db.execute(sa_delete(ContentAttribution).where(ContentAttribution.brand_id == brand_id))
    await db.delete(brand)
    await db.commit()


# ── Add prompt ────────────────────────────────────────────────────────────────

@router.post(
    "/{brand_id}/prompts",
    response_model=PromptResponse,
    status_code=status.HTTP_201_CREATED,
)
async def add_prompt(
    brand_id: int,
    payload: PromptCreate,
    db: DbDep,
    user: CurrentUser,
):
    # Verify brand exists and belongs to user
    brand_obj = await get_brand_for_user(brand_id, db, user)

    # Auto-fail stale runs before checking, then block only on genuinely active runs
    await fail_stale_runs_for_brand(db, brand_id)
    active_run = await db.execute(
        select(TrackingRun.id).where(
            TrackingRun.brand_id == brand_id,
            TrackingRun.status.in_(["pending", "running"]),
        ).limit(1)
    )
    if active_run.scalar_one_or_none() is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Cannot modify prompts while a report is running.",
        )

    text = payload.text.strip()
    if not text:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Prompt text cannot be empty",
        )

    # Enforce prompt limits for non-admin users
    if not user.is_admin:
        from sqlalchemy import func as sqlfunc
        prompt_count_result = await db.execute(
            select(sqlfunc.count(Prompt.id)).where(Prompt.brand_id == brand_id)
        )
        current_count = prompt_count_result.scalar_one()
        limit = getattr(brand_obj, "prompt_limit", 25)
        if current_count >= limit:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Prompt limit reached ({limit}). Delete a prompt or upgrade your brand type.",
            )

    # Check for duplicate prompt text (case-insensitive)
    existing = await db.execute(
        select(Prompt.id).where(
            Prompt.brand_id == brand_id,
            func.lower(Prompt.text) == text.lower(),
        ).limit(1)
    )
    if existing.scalar_one_or_none() is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="This prompt already exists for this brand.",
        )

    # Infer prompt_type from brand_type
    prompt_type = "pitch" if brand_obj.brand_type == "pitch" else "standard"
    prompt = Prompt(brand_id=brand_id, text=text, prompt_type=prompt_type)
    db.add(prompt)
    await db.flush()
    # Eager ContentCluster shell — keeps 1 prompt = 1 cluster card invariant.
    from app.models import ContentCluster as _CC
    db.add(_CC(
        brand_id=brand_id, prompt_id=prompt.id,
        status="pending", pillar_mode="none", version=0,
    ))
    await db.commit()
    await db.refresh(prompt)

    from app.services.analytics_service import log_event
    await log_event("prompt_added", {"prompt_text": text}, brand_id=brand_id)

    prompt.has_history = False
    return PromptResponse.model_validate(prompt)


# ── Delete prompt ─────────────────────────────────────────────────────────────

@router.delete(
    "/{brand_id}/prompts/{prompt_id}",
    status_code=status.HTTP_204_NO_CONTENT,
)
async def delete_prompt(brand_id: int, prompt_id: int, db: DbDep, user: CurrentUser):
    await get_brand_for_user(brand_id, db, user)

    # Auto-fail stale runs before checking, then block only on genuinely active runs
    await fail_stale_runs_for_brand(db, brand_id)
    active_run = await db.execute(
        select(TrackingRun.id).where(
            TrackingRun.brand_id == brand_id,
            TrackingRun.status.in_(["pending", "running"]),
        ).limit(1)
    )
    if active_run.scalar_one_or_none() is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Cannot modify prompts while a report is running.",
        )

    result = await db.execute(
        select(Prompt).where(Prompt.id == prompt_id, Prompt.brand_id == brand_id)
    )
    prompt = result.scalar_one_or_none()
    if prompt is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Prompt {prompt_id} not found for brand {brand_id}",
        )
    prompt_text = prompt.text
    # Clean up all rows that reference this prompt before deleting it.
    # Explicit deletes avoid relying on DB-level CASCADE which may differ
    # between SQLite schemas created at different times.
    await db.execute(sa_delete(ContentAttribution).where(ContentAttribution.prompt_id == prompt_id))
    await db.execute(sa_delete(PromptRunScore).where(PromptRunScore.prompt_id == prompt_id))
    await db.execute(sa_delete(ContentGap).where(ContentGap.prompt_id == prompt_id))
    await db.execute(sa_delete(DraftAttribution).where(DraftAttribution.prompt_id == prompt_id))
    await db.execute(sa_delete(CompetitorMention).where(CompetitorMention.prompt_id == prompt_id))
    await db.execute(sa_delete(QueryResult).where(QueryResult.prompt_id == prompt_id))
    await db.execute(sa_delete(ContentDraft).where(ContentDraft.prompt_id == prompt_id))
    await db.delete(prompt)
    await db.commit()

    from app.services.analytics_service import log_event
    await log_event("prompt_removed", {"prompt_id": prompt_id, "prompt_text": prompt_text}, brand_id=brand_id)


# ── Update prompt text ───────────────────────────────────────────────────────

@router.patch(
    "/{brand_id}/prompts/{prompt_id}",
    response_model=PromptResponse,
)
async def update_prompt(
    brand_id: int,
    prompt_id: int,
    payload: PromptUpdate,
    db: DbDep,
    user: CurrentUser,
):
    """Edit a prompt's text. Only allowed when the prompt has no QueryResult history."""
    await get_brand_for_user(brand_id, db, user)

    # Block edits while a run is active (mirrors add/delete)
    await fail_stale_runs_for_brand(db, brand_id)
    active_run = await db.execute(
        select(TrackingRun.id).where(
            TrackingRun.brand_id == brand_id,
            TrackingRun.status.in_(["pending", "running"]),
        ).limit(1)
    )
    if active_run.scalar_one_or_none() is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Cannot modify prompts while a report is running.",
        )

    text = payload.text.strip()
    if not text:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Prompt text cannot be empty",
        )

    # Load the prompt
    result = await db.execute(
        select(Prompt).where(Prompt.id == prompt_id, Prompt.brand_id == brand_id)
    )
    prompt = result.scalar_one_or_none()
    if prompt is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Prompt {prompt_id} not found for brand {brand_id}",
        )

    # No-op: same text → return success without re-checking history
    if prompt.text == text:
        history_check = await db.execute(
            select(QueryResult.id).where(QueryResult.prompt_id == prompt_id).limit(1)
        )
        prompt.has_history = history_check.scalar_one_or_none() is not None
        return PromptResponse.model_validate(prompt)

    # Block edits when the prompt already has tracking history
    history_check = await db.execute(
        select(QueryResult.id).where(QueryResult.prompt_id == prompt_id).limit(1)
    )
    if history_check.scalar_one_or_none() is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Prompt is locked — has tracking history. Delete and re-add to change wording.",
        )

    # Duplicate check — exclude self
    dup = await db.execute(
        select(Prompt.id).where(
            Prompt.brand_id == brand_id,
            func.lower(Prompt.text) == text.lower(),
            Prompt.id != prompt_id,
        ).limit(1)
    )
    if dup.scalar_one_or_none() is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="This prompt already exists for this brand.",
        )

    prompt.text = text
    await db.commit()
    await db.refresh(prompt)

    prompt.has_history = False  # we just confirmed above

    from app.services.analytics_service import log_event
    await log_event("prompt_edited", {"prompt_id": prompt_id, "new_text": text}, brand_id=brand_id)

    return PromptResponse.model_validate(prompt)


# ── List competitors ──────────────────────────────────────────────────────────

@router.get("/{brand_id}/competitors", response_model=list[CompetitorResponse])
async def list_competitors(brand_id: int, db: DbDep, user: CurrentUser):
    await get_brand_for_user(brand_id, db, user)
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
async def add_competitor(brand_id: int, payload: CompetitorCreate, db: DbDep, user: CurrentUser):
    await get_brand_for_user(brand_id, db, user)

    if not user.is_admin:
        from app.routers.billing import COMPETITOR_LIMITS
        limit = COMPETITOR_LIMITS.get(user.subscription_tier or "", 3)
        count_result = await db.execute(
            select(func.count(Competitor.id)).where(Competitor.brand_id == brand_id)
        )
        current_count = count_result.scalar_one()
        if current_count >= limit:
            from app.routers.billing import TIER_DISPLAY_NAMES
            tier_display = TIER_DISPLAY_NAMES.get(user.subscription_tier, "Free")
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Competitor limit reached: your {tier_display} plan allows {limit} competitor(s) per brand.",
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
async def remove_competitor(brand_id: int, competitor_id: int, db: DbDep, user: CurrentUser):
    await get_brand_for_user(brand_id, db, user)
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


# ── Suggest prompts via Claude ────────────────────────────────────────────────

@router.post("/{brand_id}/suggest-prompts", response_model=list[str])
async def suggest_prompts(brand_id: int, db: DbDep, user: CurrentUser):
    """Use Claude to generate 12-15 diverse tracking prompt suggestions for a brand."""
    check_rate_limit(user.id, limit=5, scope="brands_write")
    from app.models import BrandProfile as BrandProfileModel

    brand = await _get_brand_or_404(db, brand_id, user)

    # Load brand profile
    profile_result = await db.execute(
        select(BrandProfileModel).where(BrandProfileModel.brand_id == brand_id)
    )
    profile = profile_result.scalar_one_or_none()

    # Build context string
    context_parts = [f"Brand name: {brand.name}"]
    if profile:
        if profile.company_description:
            context_parts.append(f"Company description: {profile.company_description}")

    # Load competitors
    comp_result = await db.execute(
        select(Competitor).where(Competitor.brand_id == brand_id)
    )
    competitors = comp_result.scalars().all()
    if competitors:
        context_parts.append(f"Known competitors: {', '.join(c.name for c in competitors)}")

    # Existing prompts (to avoid duplicates)
    existing = [p.text for p in brand.prompts]
    if existing:
        existing_sample = "; ".join(existing[:5])
        context_parts.append(f"Already tracking (avoid duplicates): {existing_sample}")

    scope_block = ""
    if profile and profile.market_scope:
        geo_line = f"\nGeography: {profile.geography}" if profile.geography else ""
        if profile.geography:
            geo_examples = f"'best X in {profile.geography}', '{profile.geography}-area X'"
        else:
            geo_examples = "geographically scoped phrasings appropriate to the brand's locale"
        scope_block = (
            f"\n\nMarket scope: {profile.market_scope}{geo_line}\n\n"
            "When generating queries, scope them to where this brand actually competes. "
            f"For local scope, use the geography in queries (e.g. {geo_examples}). "
            "For national, prefer country-specific phrasings. "
            "For niche B2B, use vertical-specific phrasings rather than geographic ones. "
            "Avoid global/national phrasings the brand has no realistic chance of appearing in."
        )

    context = "\n".join(context_parts) + scope_block

    system_prompt = f"""You generate AI visibility tracking prompts for brands. Your job is to find the real search queries that consumers type into ChatGPT, Claude, or Perplexity when researching solutions — NOT when looking up a specific brand.

{context}

Return ONLY a valid JSON array of strings — no explanation, no markdown, no comments. 12-15 prompts total.
EVERY prompt MUST be phrased as a question and end with "?".

GENERATE ONLY these types of queries:
1. Category/solution queries — "What are the best [category] options?", "Which [category] tools are worth it?"
2. Comparison queries — "How does [competitor] compare to alternatives?", "Best alternatives to [competitor]"
3. Problem-seeking queries — "How do I [specific problem this brand solves]?", "What's the most effective way to [task]?"
4. Clinical/research queries — "How accurate is [technology]?", "What does the research say about [approach]?"
5. Buying-decision queries — "What should I look for when choosing a [category] solution?", "Is [category] worth it?"

NEVER generate:
- Direct brand name lookups ("What is [brand name]?", "Tell me about [brand]", "What does [brand] do?")
- Generic awareness questions about the brand itself
- Any query where the brand name appears in the question

The goal is to find queries where a user is researching a problem or category, and the brand COULD appear in the AI's answer. Write questions a real person would type when they don't yet know which brand to choose."""

    api_key = _os.getenv("ANTHROPIC_API_KEY", "")
    if not api_key:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="ANTHROPIC_API_KEY not configured. Add your key in Settings.",
        )

    try:
        import anthropic
        client = anthropic.AsyncAnthropic(api_key=api_key)
        response = await client.messages.create(
            model="claude-haiku-4-5-20251001",
            max_tokens=1200,
            messages=[{"role": "user", "content": system_prompt}],
        )
        text = response.content[0].text.strip() if response.content else "[]"
        # Extract JSON array from response
        m = re.search(r"\[[\s\S]*\]", text)
        if m:
            suggestions = _json.loads(m.group())
        else:
            suggestions = _json.loads(text)
        cleaned = [_ensure_question_mark(s) for s in suggestions if isinstance(s, str)]
        return [s for s in cleaned if s][:15]
    except Exception as exc:
        logger.exception("suggest_prompts failed")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Suggestion generation failed. Please try again.",
        )


@router.post("/{brand_id}/infer-scope")
async def infer_scope(brand_id: int, db: DbDep, user: CurrentUser) -> InferScopeResponse:
    """Use Claude to infer the brand's market scope. Does NOT persist — caller saves via PUT /profile."""
    from app.models import BrandProfile as BrandProfileModel

    check_rate_limit(user.id, limit=5, scope="brands_write")
    brand = await _get_brand_or_404(db, brand_id, user)

    profile_result = await db.execute(
        select(BrandProfileModel).where(BrandProfileModel.brand_id == brand_id)
    )
    profile = profile_result.scalar_one_or_none()

    comp_result = await db.execute(
        select(Competitor).where(Competitor.brand_id == brand_id)
    )
    competitors = comp_result.scalars().all()

    context_parts = [f"Brand name: {brand.name}"]
    if brand.website_url:
        context_parts.append(f"Website: {brand.website_url}")
    if profile and profile.company_description:
        context_parts.append(f"Description: {profile.company_description}")
    if profile and profile.internal_brand_context:
        context_parts.append(f"Website content excerpt:\n{profile.internal_brand_context[:3000]}")
    if competitors:
        context_parts.append(f"Known competitors: {', '.join(c.name for c in competitors)}")

    api_key = _os.getenv("ANTHROPIC_API_KEY", "")
    if not api_key:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="ANTHROPIC_API_KEY not configured.",
        )

    context = "\n".join(context_parts)
    prompt = f"""Classify the market scope of this brand based on the context below.

{context}

Return ONLY a JSON object with two fields, no markdown, no explanation:
{{
  "market_scope": "local" | "national" | "global" | "niche",
  "geography": "<short string describing where this brand competes — city/region for local, country for national, region(s) for global, vertical descriptor for niche>"
}}

Definitions:
- "local"  — operates in a single city or metro area (a coffee roaster in Portland, a clinic in Berlin)
- "national" — operates across one country (a US-only SaaS, a UK retailer)
- "global" — operates across multiple countries (Salesforce, Notion)
- "niche" — narrow B2B vertical that competes regardless of geography (a kubernetes operator, a pharma billing tool)

If unsure, prefer "national"."""

    try:
        import anthropic
        client = anthropic.AsyncAnthropic(api_key=api_key)
        response = await client.messages.create(
            model="claude-haiku-4-5-20251001",
            max_tokens=200,
            messages=[{"role": "user", "content": prompt}],
        )
        text = response.content[0].text.strip() if response.content else "{}"
        m = re.search(r"\{[\s\S]*\}", text)
        data = _json.loads(m.group() if m else text)
    except Exception:
        logger.exception("infer_scope failed")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Scope inference failed. Please try again.",
        )

    raw_scope = (data.get("market_scope") or "").lower().strip()
    allowed = {"local", "national", "global", "niche"}
    scope = raw_scope if raw_scope in allowed else "national"
    geography = data.get("geography")
    if isinstance(geography, str):
        geography = geography.strip() or None
    else:
        geography = None
    return InferScopeResponse(market_scope=scope, geography=geography)


# ── Fetch website context without an existing brand (onboarding) ─────────────

@router.post("/fetch-website-context", response_model=FetchWebsiteContextResponse)
async def fetch_website_context_endpoint(
    payload: FetchWebsiteContextRequest,
    user: CurrentUser,
):
    """
    Fetch website content via Jina Reader without requiring a brand.
    Used by onboarding wizard to get context before brand creation.
    Rate limited to 5 calls/minute per user.
    """
    from app.services.jina_service import fetch_website_context

    check_rate_limit(user.id, limit=5, scope="brands_write")  # 5 per minute

    try:
        context = await fetch_website_context(payload.url)
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid URL: {e}",
        )
    except Exception as e:
        logger.warning("Jina fetch failed for %s: %s", payload.url, e)
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Failed to fetch website content. Please check the URL and try again.",
        )

    # Best-effort: generate a clean company description from the scraped content
    description = None
    if context and context.strip():
        try:
            import os

            import anthropic

            api_key = os.getenv("ANTHROPIC_API_KEY", "")
            if api_key:
                brand_label = f' for "{payload.brand_name}"' if payload.brand_name else ""
                client = anthropic.AsyncAnthropic(api_key=api_key)
                resp = await client.messages.create(
                    model="claude-haiku-4-5-20251001",
                    max_tokens=256,
                    messages=[{
                        "role": "user",
                        "content": (
                            f"Based on this website content, write a concise 1-2 sentence company description{brand_label}. "
                            "Describe what the company does and what makes it notable. "
                            "Be professional and factual. Return ONLY the description, nothing else.\n\n"
                            f"Website content:\n---\n{context[:6000]}\n---"
                        ),
                    }],
                )
                description = resp.content[0].text.strip()
                # Guard against LLM refusal text leaking through
                if description and any(
                    description.lower().startswith(p)
                    for p in ["i cannot", "i can't", "i'm unable", "sorry,", "unfortunately,", "i am unable", "based on the provided"]
                ):
                    description = None
        except Exception as exc:
            logger.warning("Description generation failed for %s (non-fatal): %s", payload.url, exc)

    return FetchWebsiteContextResponse(context=context, description=description)


# ── Suggest prompts without an existing brand (onboarding) ───────────────────

from pydantic import BaseModel as _BaseModel


from pydantic import Field as _Field


class _SuggestPreviewReq(_BaseModel):
    name: str = _Field(..., max_length=255)
    description: str = _Field("", max_length=2000)
    website_context: str = _Field("", max_length=10_000)


@router.post("/suggest-prompts-preview", response_model=list[str])
async def suggest_prompts_preview(payload: _SuggestPreviewReq, db: DbDep, user: CurrentUser):
    """Generate tracking prompt suggestions from just a brand name (for onboarding wizard)."""
    check_rate_limit(user.id, limit=5, scope="brands_write")
    api_key = _os.getenv("ANTHROPIC_API_KEY", "")
    if not api_key:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="ANTHROPIC_API_KEY not configured",
        )

    context_parts = [f"Brand name: {payload.name.strip()}"]
    if payload.description.strip():
        context_parts.append(f"Company description: {payload.description.strip()}")
    if payload.website_context.strip():
        # Truncate website context to avoid huge prompts
        website_excerpt = payload.website_context.strip()[:3000]
        context_parts.append(f"Website content:\n{website_excerpt}")
    context = "\n".join(context_parts)

    system_prompt = f"""You generate AI visibility tracking prompts for brands. Find the real queries users type into ChatGPT/Claude/Perplexity when researching solutions — NOT looking up a specific brand.

{context}

Return ONLY a valid JSON array of 12 strings — no explanation, no markdown.
EVERY prompt MUST be phrased as a question and end with "?".

Generate category queries, comparison queries, problem-seeking queries, and buying-decision queries. NEVER include the brand name in any question."""

    try:
        import anthropic
        client = anthropic.AsyncAnthropic(api_key=api_key)
        response = await client.messages.create(
            model="claude-haiku-4-5-20251001",
            max_tokens=1000,
            messages=[{"role": "user", "content": system_prompt}],
        )
        text = response.content[0].text.strip() if response.content else "[]"
        m = re.search(r"\[[\s\S]*\]", text)
        suggestions = _json.loads(m.group() if m else text)
        cleaned = [_ensure_question_mark(s) for s in suggestions if isinstance(s, str)]
        return [s for s in cleaned if s][:12]
    except Exception as exc:
        logger.exception("suggest_prompts_preview failed")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Suggestion generation failed. Please try again.",
        )


# ── Refresh website context (Jina Reader) ─────────────────────────────────────

@router.post("/{brand_id}/refresh-website-context", status_code=status.HTTP_202_ACCEPTED)
async def refresh_website_context(brand_id: int, db: DbDep, user: CurrentUser):
    """Fetch and store brand website content via Jina Reader."""
    brand = await get_brand_for_user(brand_id, db, user)
    if not brand.website_url:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Brand has no website_url configured",
        )
    import asyncio

    from app.services.jina_service import refresh_brand_website_context
    asyncio.create_task(
        refresh_brand_website_context(brand_id),
        name=f"jina-refresh-{brand_id}",
    )
    return {"message": "Website context refresh started", "brand_id": brand_id}


# ── Competitor analysis ────────────────────────────────────────────────────────

@router.get("/{brand_id}/competitor-analysis", response_model=CompetitorAnalysisResponse)
async def get_competitor_analysis(
    brand_id: int,
    db: DbDep,
    user: CurrentUser,
    run_id: int | None = None,
):
    """Per-prompt brand vs competitor mention rates with model breakdown."""
    from app.models import CompetitorMention, QueryResult

    brand = await get_brand_for_user(brand_id, db, user)

    # Load competitors
    comps_result = await db.execute(
        select(Competitor)
        .where(Competitor.brand_id == brand_id)
        .order_by(Competitor.created_at)
    )
    competitors = comps_result.scalars().all()

    _empty = CompetitorAnalysisResponse(
        brand_id=brand_id,
        brand_name=brand.name,
        run_id=None,
        has_data=False,
        overall=OverallSOV(brand_name=brand.name, brand_pct=0.0, competitors=[]),
        prompts=[],
    )

    if not competitors:
        return _empty

    # Resolve run
    if run_id is None:
        run_result = await db.execute(
            select(TrackingRun)
            .where(TrackingRun.brand_id == brand_id, TrackingRun.status == "completed")
            .order_by(TrackingRun.completed_at.desc())
            .limit(1)
        )
        run = run_result.scalar_one_or_none()
        if run is None:
            return _empty
        run_id = run.id

    # Load query results (exclude errors)
    from app.models import Prompt as PromptModel
    qr_result = await db.execute(
        select(QueryResult, PromptModel.text.label("prompt_text"))
        .join(PromptModel, QueryResult.prompt_id == PromptModel.id)
        .where(QueryResult.tracking_run_id == run_id, QueryResult.response_text.isnot(None))
    )
    query_rows = qr_result.all()

    if not query_rows:
        return _empty

    # Load competitor mention rows for this run
    cm_result = await db.execute(
        select(CompetitorMention).where(CompetitorMention.tracking_run_id == run_id)
    )
    comp_mention_rows = cm_result.scalars().all()

    # Build brand stats per prompt
    brand_stats: dict[int, dict] = {}
    prompt_texts: dict[int, str] = {}
    for qr, pt in query_rows:
        pid = qr.prompt_id
        prompt_texts[pid] = pt
        if pid not in brand_stats:
            brand_stats[pid] = {"total": 0, "mentioned": 0, "by_model": {}}
        brand_stats[pid]["total"] += 1
        if qr.mentioned:
            brand_stats[pid]["mentioned"] += 1
        m = qr.model
        bm = brand_stats[pid]["by_model"]
        if m not in bm:
            bm[m] = {"total": 0, "mentioned": 0}
        bm[m]["total"] += 1
        if qr.mentioned:
            bm[m]["mentioned"] += 1

    # Build competitor stats per (competitor_id, prompt_id)
    comp_stats: dict[int, dict[int, dict]] = {}

    if comp_mention_rows:
        for cm in comp_mention_rows:
            cid, pid, m = cm.competitor_id, cm.prompt_id, cm.model
            if cid not in comp_stats:
                comp_stats[cid] = {}
            if pid not in comp_stats[cid]:
                comp_stats[cid][pid] = {"total": 0, "mentioned": 0, "by_model": {}}
            comp_stats[cid][pid]["total"] += 1
            if cm.mentioned:
                comp_stats[cid][pid]["mentioned"] += 1
            if m not in comp_stats[cid][pid]["by_model"]:
                comp_stats[cid][pid]["by_model"][m] = {"total": 0, "mentioned": 0}
            comp_stats[cid][pid]["by_model"][m]["total"] += 1
            if cm.mentioned:
                comp_stats[cid][pid]["by_model"][m]["mentioned"] += 1
    else:
        # Fallback: text-search competitor names in query results
        for qr, _ in query_rows:
            pid, m = qr.prompt_id, qr.model
            text = qr.response_text or ""
            for comp in competitors:
                cid = comp.id
                mentioned = comp.name.lower() in text.lower()
                if cid not in comp_stats:
                    comp_stats[cid] = {}
                if pid not in comp_stats[cid]:
                    comp_stats[cid][pid] = {"total": 0, "mentioned": 0, "by_model": {}}
                comp_stats[cid][pid]["total"] += 1
                if mentioned:
                    comp_stats[cid][pid]["mentioned"] += 1
                if m not in comp_stats[cid][pid]["by_model"]:
                    comp_stats[cid][pid]["by_model"][m] = {"total": 0, "mentioned": 0}
                comp_stats[cid][pid]["by_model"][m]["total"] += 1
                if mentioned:
                    comp_stats[cid][pid]["by_model"][m]["mentioned"] += 1

    # Build prompt results
    prompt_results: list[CompetitorPromptResult] = []
    for pid, bs in brand_stats.items():
        brand_rate = (bs["mentioned"] / bs["total"] * 100) if bs["total"] > 0 else 0.0
        brand_by_model = {
            mk: round((v["mentioned"] / v["total"] * 100) if v["total"] > 0 else 0.0, 1)
            for mk, v in bs["by_model"].items()
        }
        comp_rates: list[CompetitorByModel] = []
        for comp in competitors:
            cs = comp_stats.get(comp.id, {}).get(pid, {"total": 0, "mentioned": 0, "by_model": {}})
            rate = (cs["mentioned"] / cs["total"] * 100) if cs["total"] > 0 else 0.0
            by_model = {
                mk: round((v["mentioned"] / v["total"] * 100) if v["total"] > 0 else 0.0, 1)
                for mk, v in cs["by_model"].items()
            }
            comp_rates.append(CompetitorByModel(
                name=comp.name, rate=round(rate, 1), by_model=by_model,
            ))
        max_comp = max((c.rate for c in comp_rates), default=0.0)
        if brand_rate > max_comp:
            outcome = "win"
        elif brand_rate < max_comp:
            outcome = "lose"
        else:
            outcome = "tie"
        prompt_results.append(CompetitorPromptResult(
            prompt_id=pid,
            prompt_text=prompt_texts.get(pid, ""),
            brand_rate=round(brand_rate, 1),
            brand_by_model=brand_by_model,
            outcome=outcome,
            competitors=comp_rates,
        ))

    # Overall SOV
    total_brand_q = sum(bs["total"] for bs in brand_stats.values())
    total_brand_m = sum(bs["mentioned"] for bs in brand_stats.values())
    overall_brand_pct = (total_brand_m / total_brand_q * 100) if total_brand_q > 0 else 0.0

    overall_comps = []
    for comp in competitors:
        total_m = sum(comp_stats.get(comp.id, {}).get(pid, {}).get("mentioned", 0) for pid in brand_stats)
        total_q = sum(comp_stats.get(comp.id, {}).get(pid, {}).get("total", 0) for pid in brand_stats)
        overall_comps.append({
            "name": comp.name,
            "pct": round((total_m / total_q * 100) if total_q > 0 else 0.0, 1),
        })

    return CompetitorAnalysisResponse(
        brand_id=brand_id,
        brand_name=brand.name,
        run_id=run_id,
        has_data=len(prompt_results) > 0,
        overall=OverallSOV(
            brand_name=brand.name,
            brand_pct=round(overall_brand_pct, 1),
            competitors=overall_comps,
        ),
        prompts=sorted(prompt_results, key=lambda p: (-p.brand_rate, p.prompt_id)),
    )


# ── Content attribution (draft performance tracking) ──────────────────────────

@router.get("/{brand_id}/content-attribution")
async def get_content_attribution(
    brand_id: int, db: DbDep, user: CurrentUser
):
    """Return draft attribution records showing visibility delta since posting."""
    from app.models import ContentDraft, DraftAttribution
    from app.models import Prompt as PromptModel
    from app.schemas import DraftAttributionResponse

    await get_brand_for_user(brand_id, db, user)

    result = await db.execute(
        select(DraftAttribution)
        .where(DraftAttribution.brand_id == brand_id)
        .order_by(DraftAttribution.posted_at.desc())
    )
    attributions = result.scalars().all()

    if not attributions:
        return []

    # Load draft and prompt details
    draft_ids = [a.draft_id for a in attributions]
    prompt_ids = [a.prompt_id for a in attributions if a.prompt_id]

    drafts_result = await db.execute(
        select(ContentDraft).where(ContentDraft.id.in_(draft_ids))
    )
    drafts_map = {d.id: d for d in drafts_result.scalars().all()}

    prompts_result = await db.execute(
        select(PromptModel).where(PromptModel.id.in_(prompt_ids))
    )
    prompts_map = {p.id: p for p in prompts_result.scalars().all()}

    output = []
    for attr in attributions:
        draft = drafts_map.get(attr.draft_id)
        prompt = prompts_map.get(attr.prompt_id) if attr.prompt_id else None
        output.append(DraftAttributionResponse(
            id=attr.id,
            draft_id=attr.draft_id,
            brand_id=attr.brand_id,
            prompt_id=attr.prompt_id,
            prompt_text=prompt.text if prompt else None,
            draft_title=draft.title if draft else None,
            draft_platform=draft.platform if draft else None,
            posted_at=attr.posted_at,
            score_at_posting=attr.score_at_posting,
            current_score=attr.current_score,
            delta=attr.delta,
            runs_since_posting=attr.runs_since_posting or 0,
            created_at=attr.created_at,
        ))

    return output


# ── Quora question search ──────────────────────────────────────────────────────

@router.get("/{brand_id}/quora-questions")
async def get_quora_questions(
    brand_id: int,
    prompt_id: int,
    db: DbDep,
    user: CurrentUser,
):
    """
    Return real Quora questions related to the given prompt via Google CSE.
    Results are cached per prompt_id for 24 hours to preserve API quota.
    Returns {questions: [...]} — empty list if CSE is not configured.
    """
    await get_brand_for_user(brand_id, db, user)

    prompt_result = await db.execute(
        select(Prompt).where(Prompt.id == prompt_id, Prompt.brand_id == brand_id)
    )
    prompt = prompt_result.scalar_one_or_none()
    if prompt is None:
        raise HTTPException(status_code=404, detail="Prompt not found")

    from app.services.quora_search_service import extract_keywords, search_quora_questions
    keywords = extract_keywords(prompt.text)
    questions = await search_quora_questions(keywords, num_results=5, cache_key=prompt_id)
    return {"questions": questions}
