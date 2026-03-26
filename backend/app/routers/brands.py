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
from typing import Annotated, Optional

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.database import get_db
from app.dependencies import get_current_user, get_brand_for_user, get_data_owner_id, CurrentUser
from app.models import Brand, Prompt, Competitor, TrackingRun, User
from datetime import datetime, timezone, timedelta
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
    CompetitorAnalysisResponse,
    OverallSOV,
    CompetitorPromptResult,
    CompetitorByModel,
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
    owner_id = await get_data_owner_id(db, user)
    # Get user's brands with prompt count
    brands_result = await db.execute(
        select(Brand, func.count(Prompt.id).label("prompt_count"))
        .outerjoin(Prompt, Prompt.brand_id == Brand.id)
        .where(Brand.user_id == owner_id)
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
        .where(Brand.user_id == owner_id)
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
    if not user.is_admin:
        from app.routers.auth import BRAND_TYPE_LIMITS
        limits = BRAND_TYPE_LIMITS.get(user.subscription_tier, BRAND_TYPE_LIMITS[None])
        brand_type_limit = limits.get(payload.brand_type, 0)

        existing_of_type = await db.execute(
            select(func.count(Brand.id)).where(
                Brand.user_id == user.id,
                Brand.brand_type == payload.brand_type,
            )
        )
        count_of_type = existing_of_type.scalar_one()
        if count_of_type >= brand_type_limit:
            tier_name = user.subscription_tier or "free"
            kind = "pitch" if payload.brand_type == "pitch" else "standard"
            raise HTTPException(
                status_code=status.HTTP_402_PAYMENT_REQUIRED,
                detail=f"Brand limit reached: your {tier_name} plan allows {brand_type_limit} {kind} brand(s). Upgrade to add more.",
            )

    slug = _slugify(payload.name)

    # Ensure slug uniqueness
    existing = await db.execute(select(Brand).where(Brand.slug == slug))
    if existing.scalar_one_or_none():
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"A brand with slug '{slug}' already exists",
        )

    pitch_expires_at = None
    if payload.brand_type == "pitch":
        pitch_expires_at = datetime.now(timezone.utc).replace(tzinfo=None) + timedelta(days=30)

    brand = Brand(
        name=payload.name,
        slug=slug,
        tier=payload.tier,
        brand_type=payload.brand_type,
        pitch_expires_at=pitch_expires_at,
        user_id=user.id,
        website_url=payload.website_url,
    )
    db.add(brand)
    await db.flush()  # gets brand.id without committing

    # Pitch brands cap at 10 prompts
    pitch_limit = 10
    prompt_list = payload.prompts[:pitch_limit] if payload.brand_type == "pitch" else payload.prompts
    for text in prompt_list:
        text = text.strip()
        if text:
            prompt_type = "pitch" if payload.brand_type == "pitch" else "standard"
            db.add(Prompt(brand_id=brand.id, text=text, prompt_type=prompt_type))

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
        # Re-fetch brand to check brand_type and pitch expiry
        brand_result = await db.execute(select(Brand).where(Brand.id == brand_id))
        brand_obj = brand_result.scalar_one_or_none()

        if brand_obj and brand_obj.brand_type == "pitch":
            # Pitch brand: hard cap of 10 prompts per brand
            pitch_prompt_count_result = await db.execute(
                select(func.count(Prompt.id)).where(Prompt.brand_id == brand_id)
            )
            pitch_count = pitch_prompt_count_result.scalar_one()
            if pitch_count >= 10:
                raise HTTPException(
                    status_code=status.HTTP_402_PAYMENT_REQUIRED,
                    detail="Pitch brands are limited to 10 prompts. Upgrade to a standard brand for more.",
                )
        else:
            # Standard brand: check total prompt count against tier limit
            from app.routers.auth import TIER_LIMITS
            limit = TIER_LIMITS.get(user.subscription_tier or "", 10)
            count_result = await db.execute(
                select(func.count(Prompt.id)).where(
                    Prompt.brand_id.in_(
                        select(Brand.id).where(Brand.user_id == user.id, Brand.brand_type == "standard")
                    )
                )
            )
            total_prompts = count_result.scalar_one()
            if total_prompts >= limit:
                tier_name = user.subscription_tier or "free"
                raise HTTPException(
                    status_code=status.HTTP_402_PAYMENT_REQUIRED,
                    detail=f"Prompt limit reached ({total_prompts}/{limit} for {tier_name} plan). Upgrade to add more prompts.",
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
    competitor = Competitor(brand_id=brand_id, name=payload.name, website_url=payload.website_url)
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
        m = re.search(r"\[[\s\S]*\]", text)
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


# ── Suggest prompts without an existing brand (onboarding) ───────────────────

from pydantic import BaseModel as _BaseModel

class _SuggestPreviewReq(_BaseModel):
    name: str
    description: str = ""


@router.post("/suggest-prompts-preview", response_model=list[str])
async def suggest_prompts_preview(payload: _SuggestPreviewReq, db: DbDep, user: CurrentUser):
    """Generate tracking prompt suggestions from just a brand name (for onboarding wizard)."""
    api_key = _os.getenv("ANTHROPIC_API_KEY", "")
    if not api_key:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="ANTHROPIC_API_KEY not configured",
        )

    context_parts = [f"Brand name: {payload.name.strip()}"]
    if payload.description.strip():
        context_parts.append(f"Company description: {payload.description.strip()}")
    context = "\n".join(context_parts)

    system_prompt = f"""You generate AI visibility tracking prompts for brands. Find the real queries users type into ChatGPT/Claude/Perplexity when researching solutions — NOT looking up a specific brand.

{context}

Return ONLY a valid JSON array of 12 strings — no explanation, no markdown.

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
        return [s for s in suggestions if isinstance(s, str)][:12]
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


# ── Competitor analysis ────────────────────────────────────────────────────────

@router.get("/{brand_id}/competitor-analysis", response_model=CompetitorAnalysisResponse)
async def get_competitor_analysis(
    brand_id: int,
    db: DbDep,
    user: CurrentUser,
    run_id: Optional[int] = None,
):
    """Per-prompt brand vs competitor mention rates with model breakdown."""
    from app.models import QueryResult, CompetitorMention

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
    from app.models import DraftAttribution, ContentDraft, Prompt as PromptModel
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
    questions = search_quora_questions(keywords, num_results=5, cache_key=prompt_id)
    return {"questions": questions}
