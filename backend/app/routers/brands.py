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
import os as _os
import re
import re as _re
from typing import Annotated, Optional

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.database import get_db
from app.dependencies import get_current_user, get_brand_for_user, CurrentUser
from app.models import Brand, Prompt, Competitor, TrackingRun, User
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


async def _get_brand_or_404(db: AsyncSession, brand_id: int, user: Optional[User] = None) -> Brand:
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
    if user is not None and brand.user_id != user.id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access denied")
    return brand


# ── List brands with stats (for brand switcher) ───────────────────────────────

@router.get("/with-stats", response_model=list[BrandWithStats])
async def list_brands_with_stats(db: DbDep, user: CurrentUser):
    """Returns brands enriched with latest run score and trend direction."""
    # Get user's brands with prompt count
    brands_result = await db.execute(
        select(Brand, func.count(Prompt.id).label("prompt_count"))
        .outerjoin(Prompt, Prompt.brand_id == Brand.id)
        .where(Brand.user_id == user.id)
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
async def list_brands(db: DbDep, user: CurrentUser):
    result = await db.execute(
        select(Brand, func.count(Prompt.id).label("prompt_count"))
        .outerjoin(Prompt, Prompt.brand_id == Brand.id)
        .where(Brand.user_id == user.id)
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
                website_url=brand.website_url,
                created_at=brand.created_at,
                updated_at=brand.updated_at,
            )
        )
    return brands


# ── Create brand ──────────────────────────────────────────────────────────────

@router.post("", response_model=BrandDetail, status_code=status.HTTP_201_CREATED)
async def create_brand(payload: BrandCreate, db: DbDep, user: CurrentUser):
    slug = _slugify(payload.name)

    # Ensure slug uniqueness
    existing = await db.execute(select(Brand).where(Brand.slug == slug))
    if existing.scalar_one_or_none():
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"A brand with slug '{slug}' already exists",
        )

    brand = Brand(name=payload.name, slug=slug, tier=payload.tier, user_id=user.id, website_url=payload.website_url)
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
async def get_brand(brand_id: int, db: DbDep, user: CurrentUser):
    brand = await _get_brand_or_404(db, brand_id, user)
    return BrandDetail.model_validate(brand)


# ── Update brand ──────────────────────────────────────────────────────────────

@router.put("/{brand_id}", response_model=BrandDetail)
async def update_brand(brand_id: int, payload: BrandUpdate, db: DbDep, user: CurrentUser):
    brand = await _get_brand_or_404(db, brand_id, user)

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

    if payload.website_url is not None:
        brand.website_url = payload.website_url or None

    await db.commit()
    await db.refresh(brand)

    result = await db.execute(
        select(Brand).where(Brand.id == brand.id).options(selectinload(Brand.prompts))
    )
    brand = result.scalar_one()
    return BrandDetail.model_validate(brand)


# ── Delete brand ──────────────────────────────────────────────────────────────

@router.delete("/{brand_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_brand(brand_id: int, db: DbDep, user: CurrentUser):
    brand = await _get_brand_or_404(db, brand_id, user)
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
    await get_brand_for_user(brand_id, db, user)

    text = payload.text.strip()
    if not text:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Prompt text cannot be empty",
        )

    # Enforce prompt limits for non-admin users
    if not user.is_admin:
        from app.routers.auth import TIER_LIMITS
        limit = TIER_LIMITS.get(user.subscription_tier or "", 25)
        count_result = await db.execute(
            select(func.count(Prompt.id)).where(
                Prompt.brand_id.in_(
                    select(Brand.id).where(Brand.user_id == user.id)
                )
            )
        )
        total_prompts = count_result.scalar_one()
        if total_prompts >= limit:
            tier_name = user.subscription_tier or "free"
            raise HTTPException(
                status_code=status.HTTP_402_PAYMENT_REQUIRED,
                detail=f"Prompt limit reached ({total_prompts}/{limit} for {tier_name} plan). Please upgrade to add more prompts.",
            )

    prompt = Prompt(brand_id=brand_id, text=text)
    db.add(prompt)
    await db.commit()
    await db.refresh(prompt)

    from app.services.analytics_service import log_event
    await log_event("prompt_added", {"prompt_text": text}, brand_id=brand_id)

    return PromptResponse.model_validate(prompt)


# ── Delete prompt ─────────────────────────────────────────────────────────────

@router.delete(
    "/{brand_id}/prompts/{prompt_id}",
    status_code=status.HTTP_204_NO_CONTENT,
)
async def delete_prompt(brand_id: int, prompt_id: int, db: DbDep, user: CurrentUser):
    await get_brand_for_user(brand_id, db, user)
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
    await db.delete(prompt)
    await db.commit()

    from app.services.analytics_service import log_event
    await log_event("prompt_removed", {"prompt_id": prompt_id, "prompt_text": prompt_text}, brand_id=brand_id)


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
        if profile.target_audience:
            context_parts.append(f"Target audience: {profile.target_audience}")

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

    context = "\n".join(context_parts)

    system_prompt = f"""You generate AI visibility tracking prompts for brands. Your job is to find the real search queries that consumers type into ChatGPT, Claude, or Perplexity when researching solutions — NOT when looking up a specific brand.

{context}

Return ONLY a valid JSON array of strings — no explanation, no markdown, no comments. 12-15 prompts total.

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
        m = _re.search(r"\[[\s\S]*\]", text)
        if m:
            suggestions = _json.loads(m.group())
        else:
            suggestions = _json.loads(text)
        return [s for s in suggestions if isinstance(s, str)][:15]
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Suggestion generation failed: {exc}",
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
    from app.services.jina_service import refresh_brand_website_context
    import asyncio
    asyncio.create_task(
        refresh_brand_website_context(brand_id),
        name=f"jina-refresh-{brand_id}",
    )
    return {"message": "Website context refresh started", "brand_id": brand_id}
