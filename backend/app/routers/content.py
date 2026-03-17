"""
Content router — draft generation, posting, and attribution for brands.

Routes
------
GET  /api/content/{brand_id}/drafts             — list drafts (paginated, filterable)
POST /api/content/{brand_id}/draft              — generate new draft
GET  /api/content/draft/{draft_id}              — get draft detail with platform guidelines
PUT  /api/content/draft/{draft_id}              — update draft text / status
POST /api/content/draft/{draft_id}/post         — mark as posted
DELETE /api/content/draft/{draft_id}            — delete draft
GET  /api/content/{brand_id}/settings           — get all platform settings for brand
PUT  /api/content/{brand_id}/settings/{platform} — update platform settings
GET  /api/content/{brand_id}/attribution        — get all attribution records for brand
GET  /api/content/guidelines/{platform}         — get platform guidelines + disclaimer
"""
from __future__ import annotations

from typing import Annotated, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models import Brand, ContentDraft, ContentPost, ContentAttribution, BrandContentSettings
from app.schemas import (
    ContentDraftSchema,
    ContentPostSchema,
    ContentAttributionSchema,
    BrandContentSettingsSchema,
    CreateDraftRequest,
    UpdateDraftRequest,
    PostDraftRequest,
    UpdateContentSettingsRequest,
    GenerateNowRequest,
)
from app.services.content_service import (
    PLATFORM_GUIDELINES,
    generate_draft,
    post_draft,
)
from app.services.drafting_service import (
    PLATFORM_SPECS,
    auto_draft_top_gaps,
    generate_gap_draft,
)
from app.models import utcnow

router = APIRouter(prefix="/content", tags=["content"])

DbDep = Annotated[AsyncSession, Depends(get_db)]

SUPPORTED_PLATFORMS = list(PLATFORM_GUIDELINES.keys())
ALL_DRAFT_PLATFORMS = list(PLATFORM_SPECS.keys())


async def _get_brand_or_404(db: AsyncSession, brand_id: int) -> Brand:
    result = await db.execute(select(Brand).where(Brand.id == brand_id))
    brand = result.scalar_one_or_none()
    if brand is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Brand {brand_id} not found",
        )
    return brand


async def _get_draft_or_404(db: AsyncSession, draft_id: int) -> ContentDraft:
    result = await db.execute(select(ContentDraft).where(ContentDraft.id == draft_id))
    draft = result.scalar_one_or_none()
    if draft is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Draft {draft_id} not found",
        )
    return draft


# ── Platform guidelines ───────────────────────────────────────────────────────

@router.get("/guidelines/{platform}", tags=["content"])
async def get_platform_guidelines(platform: str):
    """Return platform guidelines and disclaimer for a given platform."""
    if platform not in PLATFORM_GUIDELINES:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Platform '{platform}' not found. Supported: {SUPPORTED_PLATFORMS}",
        )
    return PLATFORM_GUIDELINES[platform]


# ── Draft listing ─────────────────────────────────────────────────────────────

@router.get("/{brand_id}/drafts", response_model=list[ContentDraftSchema])
async def list_drafts(
    brand_id: int,
    db: DbDep,
    platform: Optional[str] = Query(None, description="Filter by platform"),
    draft_status: Optional[str] = Query(None, alias="status", description="Filter by status"),
    page: int = Query(1, ge=1, description="Page number (1-indexed)"),
    page_size: int = Query(20, ge=1, le=100, description="Results per page"),
):
    """List all content drafts for a brand with optional filters."""
    await _get_brand_or_404(db, brand_id)

    stmt = select(ContentDraft).where(ContentDraft.brand_id == brand_id)
    if platform is not None:
        stmt = stmt.where(ContentDraft.platform == platform)
    if draft_status is not None:
        stmt = stmt.where(ContentDraft.status == draft_status)

    stmt = stmt.order_by(ContentDraft.created_at.desc())
    offset = (page - 1) * page_size
    stmt = stmt.offset(offset).limit(page_size)

    result = await db.execute(stmt)
    drafts = result.scalars().all()
    return [ContentDraftSchema.model_validate(d) for d in drafts]


# ── Draft generation ──────────────────────────────────────────────────────────

@router.post("/{brand_id}/draft", response_model=ContentDraftSchema, status_code=status.HTTP_201_CREATED)
async def create_draft(brand_id: int, request: CreateDraftRequest, db: DbDep):
    """Generate a new content draft using Claude for the given brand and platform."""
    await _get_brand_or_404(db, brand_id)

    if request.platform not in SUPPORTED_PLATFORMS:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Unsupported platform '{request.platform}'. Must be one of {SUPPORTED_PLATFORMS}",
        )

    try:
        draft = await generate_draft(
            db=db,
            brand_id=brand_id,
            platform=request.platform,
            prompt_id=request.prompt_id,
            custom_brief=request.custom_brief,
        )
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(exc),
        )
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Draft generation failed: {exc}",
        )

    return ContentDraftSchema.model_validate(draft)


# ── Draft detail ──────────────────────────────────────────────────────────────

@router.get("/draft/{draft_id}", response_model=dict)
async def get_draft(draft_id: int, db: DbDep):
    """
    Return draft detail including the platform guidelines that were applied.
    """
    draft = await _get_draft_or_404(db, draft_id)
    draft_data = ContentDraftSchema.model_validate(draft).model_dump()

    # Attach live platform guidelines for frontend rendering
    guidelines = PLATFORM_GUIDELINES.get(draft.platform, {})
    draft_data["platform_guidelines"] = guidelines

    return draft_data


# ── Draft update ──────────────────────────────────────────────────────────────

@router.put("/draft/{draft_id}", response_model=ContentDraftSchema)
async def update_draft(draft_id: int, request: UpdateDraftRequest, db: DbDep):
    """Update a draft's title, content text, and/or status."""
    draft = await _get_draft_or_404(db, draft_id)

    if request.title is not None:
        draft.title = request.title
    if request.content_text is not None:
        draft.content_text = request.content_text
    if request.status is not None:
        allowed_statuses = {"draft", "approved", "posted", "failed"}
        if request.status not in allowed_statuses:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=f"Invalid status '{request.status}'. Must be one of {allowed_statuses}",
            )
        draft.status = request.status

    draft.updated_at = utcnow()
    await db.commit()
    await db.refresh(draft)
    return ContentDraftSchema.model_validate(draft)


# ── Draft posting ─────────────────────────────────────────────────────────────

@router.post("/draft/{draft_id}/post", response_model=ContentPostSchema, status_code=status.HTTP_201_CREATED)
async def post_draft_endpoint(draft_id: int, request: PostDraftRequest, db: DbDep):
    """Mark a draft as posted and create a ContentPost record."""
    try:
        content_post = await post_draft(
            db=db,
            draft_id=draft_id,
            post_url=request.post_url,
            platform_post_id=request.platform_post_id,
        )
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(exc),
        )
    return ContentPostSchema.model_validate(content_post)


# ── Draft deletion ────────────────────────────────────────────────────────────

@router.delete("/draft/{draft_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_draft(draft_id: int, db: DbDep):
    """Delete a draft and all associated posts / attributions (cascade)."""
    draft = await _get_draft_or_404(db, draft_id)
    await db.delete(draft)
    await db.commit()


# ── Generate now (auto-draft top gaps) ───────────────────────────────────────

@router.post("/{brand_id}/generate-now", response_model=list[ContentDraftSchema], status_code=status.HTTP_201_CREATED)
async def generate_now(brand_id: int, request: GenerateNowRequest, db: DbDep):
    """
    Immediately run gap analysis and generate drafts for the top N gaps
    across all enabled platforms. Returns all newly created drafts.
    """
    await _get_brand_or_404(db, brand_id)
    try:
        drafts = await auto_draft_top_gaps(
            db=db,
            brand_id=brand_id,
            max_gaps=min(request.max_gaps, 5),
        )
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc))
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Draft generation failed: {exc}",
        )
    return [ContentDraftSchema.model_validate(d) for d in drafts]


# ── Gap-targeted draft generation ─────────────────────────────────────────────

@router.post("/{brand_id}/gap-draft", response_model=ContentDraftSchema, status_code=status.HTTP_201_CREATED)
async def create_gap_draft(brand_id: int, request: CreateDraftRequest, db: DbDep):
    """
    Generate a high-quality gap-targeted draft using the Phase 2 drafting engine
    (full BrandProfile context + LLM response analysis).
    """
    await _get_brand_or_404(db, brand_id)

    if request.platform not in ALL_DRAFT_PLATFORMS:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Unsupported platform '{request.platform}'. Must be one of {ALL_DRAFT_PLATFORMS}",
        )
    if request.prompt_id is None:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="prompt_id is required for gap-targeted drafts",
        )

    try:
        draft = await generate_gap_draft(
            db=db,
            brand_id=brand_id,
            prompt_id=request.prompt_id,
            platform=request.platform,
            custom_brief=request.custom_brief,
        )
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc))
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Draft generation failed: {exc}",
        )

    return ContentDraftSchema.model_validate(draft)


# ── Brand content settings ────────────────────────────────────────────────────

@router.get("/{brand_id}/settings", response_model=list[BrandContentSettingsSchema])
async def get_brand_settings(brand_id: int, db: DbDep):
    """
    Return content settings for all platforms for a brand.
    Creates default settings on-the-fly for any platform not yet configured.
    """
    await _get_brand_or_404(db, brand_id)

    result = await db.execute(
        select(BrandContentSettings).where(BrandContentSettings.brand_id == brand_id)
    )
    existing: list[BrandContentSettings] = list(result.scalars().all())
    existing_platforms = {s.platform for s in existing}

    # Create defaults for missing platforms
    for platform in SUPPORTED_PLATFORMS:
        if platform not in existing_platforms:
            new_setting = BrandContentSettings(
                brand_id=brand_id,
                platform=platform,
            )
            db.add(new_setting)
            existing.append(new_setting)

    if any(s.id is None for s in existing):
        await db.commit()
        for s in existing:
            if s.id is None:
                await db.refresh(s)

    return [BrandContentSettingsSchema.model_validate(s) for s in existing]


@router.put("/{brand_id}/settings/{platform}", response_model=BrandContentSettingsSchema)
async def update_brand_settings(
    brand_id: int,
    platform: str,
    request: UpdateContentSettingsRequest,
    db: DbDep,
):
    """Update content settings for a specific platform for a brand."""
    await _get_brand_or_404(db, brand_id)

    if platform not in SUPPORTED_PLATFORMS:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Platform '{platform}' not found. Supported: {SUPPORTED_PLATFORMS}",
        )

    result = await db.execute(
        select(BrandContentSettings).where(
            BrandContentSettings.brand_id == brand_id,
            BrandContentSettings.platform == platform,
        )
    )
    setting: BrandContentSettings | None = result.scalar_one_or_none()

    if setting is None:
        setting = BrandContentSettings(brand_id=brand_id, platform=platform)
        db.add(setting)

    if request.drafting_frequency is not None:
        allowed_freq = {"daily", "every_3_days", "weekly", "manual"}
        if request.drafting_frequency not in allowed_freq:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=f"Invalid drafting_frequency. Must be one of {allowed_freq}",
            )
        setting.drafting_frequency = request.drafting_frequency

    if request.auto_post is not None:
        setting.auto_post = request.auto_post

    if request.enabled is not None:
        setting.enabled = request.enabled

    setting.updated_at = utcnow()
    await db.commit()
    await db.refresh(setting)
    return BrandContentSettingsSchema.model_validate(setting)


# ── Attribution ───────────────────────────────────────────────────────────────

@router.get("/{brand_id}/attribution", response_model=list[ContentAttributionSchema])
async def get_attribution(brand_id: int, db: DbDep):
    """Return all content attribution records for a brand."""
    await _get_brand_or_404(db, brand_id)

    result = await db.execute(
        select(ContentAttribution)
        .where(ContentAttribution.brand_id == brand_id)
        .order_by(ContentAttribution.measured_at.desc())
    )
    attributions = result.scalars().all()
    return [ContentAttributionSchema.model_validate(a) for a in attributions]
