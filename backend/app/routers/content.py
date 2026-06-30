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
GET    /draft/{draft_id}/prompt-suggestions     - rank brand's prompts by similarity to this draft's text
GET  /api/content/{brand_id}/settings           — get all platform settings for brand
PUT  /api/content/{brand_id}/settings/{platform} — update platform settings
GET  /api/content/{brand_id}/attribution        — get all attribution records for brand
GET  /api/content/guidelines/{platform}         — get platform guidelines + disclaimer
"""
from __future__ import annotations

import asyncio
import logging
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.dependencies import (
    CurrentUser,
    check_rate_limit,
    get_brand_for_user,
    require_active_subscription,
    require_brand_active,
)
from app.models import Brand, BrandContentSettings, ContentAttribution, ContentDraft, Prompt, TrackingRun, utcnow
from app.schemas import (
    BrandContentSettingsSchema,
    ContentAttributionSchema,
    ContentDraftSchema,
    ContentPostSchema,
    CreateDraftRequest,
    GenerateNowRequest,
    PostDraftRequest,
    PromptSuggestion,
    UpdateContentSettingsRequest,
    UpdateDraftRequest,
)
from app.services.content_service import (
    PLATFORM_GUIDELINES,
    get_low_visibility_prompts,
    post_draft,
)
from app.services.drafting_service import (
    DRAFT_CAP,
    PLATFORM_SPECS,
    auto_draft_top_gaps,
    generate_gap_draft,
    get_draft_cap,
    rank_prompts_by_similarity,
)

SCHEDULED_CAP = 100  # max approved/scheduled drafts queued at once (pro tier default)

TIER_SCHEDULED_CAPS: dict[str | None, int] = {
    None: 10, "": 10,
    "basic": 25,
    "starter": 50,
    "pro": 100,
}

logger = logging.getLogger(__name__)

from datetime import UTC

from app import state as _state


# Outer ceiling on a single cluster's full pipeline (brief + evidence + writers).
# Defense in depth — the per-piece timeout already protects asyncio.gather, but
# this prevents pre-writer phases (brief LLM, Serper) from indefinitely
# stalling the per-brand for-loop. Sized well above PIECE_TIMEOUT_SECONDS × 5.
CLUSTER_TIMEOUT_SECONDS = 900.0


async def _bg_generate_drafts(brand_id: int, max_gaps: int, source: str) -> None:
    """Background coroutine: regenerate clusters per prompt for this brand.

    Routes through the cluster pipeline so each prompt's drafts are generated
    as a coordinated 5-piece set from a shared ContentBrief. The ``max_gaps``
    arg now bounds the number of prompts processed (was: top gaps to draft).
    The legacy ``auto_draft_top_gaps`` path is bypassed.
    """
    import asyncio
    from sqlalchemy import select
    from app.database import AsyncSessionLocal
    from app.models import Brand, Prompt, User
    from app.services.clustering_service import get_or_create_cluster, regenerate_cluster

    try:
        async with AsyncSessionLocal() as db:
            brand = (await db.execute(select(Brand).where(Brand.id == brand_id))).scalar_one_or_none()
            if brand is None:
                logger.warning("_bg_generate_drafts: brand %d not found", brand_id)
                return
            owner = (await db.execute(select(User).where(User.id == brand.user_id))).scalar_one_or_none()
            tier = owner.subscription_tier if owner else None
            prompts = (
                await db.execute(
                    select(Prompt)
                    .where(Prompt.brand_id == brand_id, Prompt.prompt_type == "standard")
                    .order_by(Prompt.id)
                )
            ).scalars().all()
            for prompt in prompts[:max_gaps]:
                try:
                    cluster = await get_or_create_cluster(db, brand_id=brand_id, prompt_id=prompt.id)
                    await asyncio.wait_for(
                        regenerate_cluster(db, cluster_id=cluster.id, tier=tier),
                        timeout=CLUSTER_TIMEOUT_SECONDS,
                    )
                except asyncio.TimeoutError:
                    logger.warning(
                        "_bg_generate_drafts: cluster regen exceeded %ss for prompt %d (brand %d) — advancing",
                        CLUSTER_TIMEOUT_SECONDS, prompt.id, brand_id,
                    )
                    continue
                except Exception:
                    logger.exception(
                        "_bg_generate_drafts: cluster regen failed for prompt %d (brand %d)",
                        prompt.id,
                        brand_id,
                    )
                    continue
    except Exception:
        logger.exception("generate_now background task failed for brand_id=%d", brand_id)
    finally:
        _state.generating_brands.discard(brand_id)


router = APIRouter(prefix="/content", tags=["content"])

DbDep = Annotated[AsyncSession, Depends(get_db)]

SUPPORTED_PLATFORMS = list(PLATFORM_GUIDELINES.keys())
ALL_DRAFT_PLATFORMS = list(PLATFORM_SPECS.keys())

# Weekly manual draft limit for pitch brands (same regardless of tier)
_WEEKLY_MANUAL_LIMIT_PITCH = 1


async def _check_weekly_manual_draft_limit(
    db: AsyncSession, brand: Brand, subscription_tier: str | None = None
) -> int:
    """
    Enforce per-brand weekly manual draft limits.
    Returns the number of manual draft slots remaining this week.
    Raises HTTP 429 if the limit is already reached.

    Paid users (starter/pro) have no weekly limit — only pitch brands
    are capped. The per-click rate limiter is sufficient cost control
    for paid tiers.
    """
    is_pitch = getattr(brand, "brand_type", "standard") == "pitch"
    if not is_pitch and subscription_tier in ("basic", "starter", "pro"):
        return 999  # unlimited for paid users

    from datetime import datetime, timedelta

    from sqlalchemy import func as sqlfunc

    weekly_limit = _WEEKLY_MANUAL_LIMIT_PITCH if is_pitch else 0

    week_ago = datetime.now(UTC).replace(tzinfo=None) - timedelta(days=7)
    count_result = await db.execute(
        select(sqlfunc.count(ContentDraft.id)).where(
            ContentDraft.brand_id == brand.id,
            ContentDraft.source == "manual",
            ContentDraft.created_at >= week_ago,
        )
    )
    used = count_result.scalar_one_or_none() or 0
    remaining = weekly_limit - used
    if remaining <= 0:
        label = "pitch deck" if is_pitch else "brand"
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail=(
                f"Weekly manual draft limit reached ({weekly_limit}/{weekly_limit} for this {label}). "
                "Resets 7 days after your first manual draft this week."
            ),
        )
    return remaining


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


async def _get_draft_for_user(db: AsyncSession, draft_id: int, user) -> ContentDraft:
    """Load draft and verify brand ownership."""
    draft = await _get_draft_or_404(db, draft_id)
    await get_brand_for_user(draft.brand_id, db, user)
    return draft


# ── Platform guidelines ───────────────────────────────────────────────────────

@router.get("/guidelines/{platform}", tags=["content"])
async def get_platform_guidelines(platform: str, user: CurrentUser):
    """Return platform guidelines and disclaimer for a given platform."""
    if platform not in PLATFORM_GUIDELINES:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Platform not found. Supported: {SUPPORTED_PLATFORMS}",
        )
    return PLATFORM_GUIDELINES[platform]


# ── Draft listing ─────────────────────────────────────────────────────────────

@router.get("/{brand_id}/drafts", response_model=list[ContentDraftSchema])
async def list_drafts(
    brand_id: int,
    db: DbDep,
    user: CurrentUser,
    platform: str | None = Query(None, description="Filter by platform"),
    draft_status: str | None = Query(None, alias="status", description="Filter by status"),
    page: int = Query(1, ge=1, description="Page number (1-indexed)"),
    page_size: int = Query(20, ge=1, le=100, description="Results per page"),
):
    """List all content drafts for a brand with optional filters."""
    await get_brand_for_user(brand_id, db, user)

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
async def create_draft(brand_id: int, request: CreateDraftRequest, db: DbDep, user: CurrentUser):
    """Generate a new content draft using Claude for the given brand and platform."""
    if not user.is_admin and not user.subscription_tier:
        raise HTTPException(
            status_code=status.HTTP_402_PAYMENT_REQUIRED,
            detail="Content drafting requires a paid plan. Upgrade to unlock this feature.",
        )
    check_rate_limit(user.id, limit=10)  # burst guard (per minute)
    brand = await get_brand_for_user(brand_id, db, user)
    require_brand_active(brand, user)
    from app.dependencies import require_paid_for_platform
    require_paid_for_platform(request.platform, user)
    if not user.is_admin:
        await _check_weekly_manual_draft_limit(db, brand, user.subscription_tier)

    if request.platform not in ALL_DRAFT_PLATFORMS:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Unsupported platform. Must be one of {ALL_DRAFT_PLATFORMS}",
        )

    # Auto-select lowest-scoring prompt if none specified
    prompt_id = request.prompt_id
    if prompt_id is None:
        low = await get_low_visibility_prompts(db, brand_id, limit=1)
        if not low:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="No prompts configured for this brand.",
            )
        prompt_id = low[0]["prompt_id"]

    try:
        draft = await generate_gap_draft(
            db=db,
            brand_id=brand_id,
            prompt_id=prompt_id,
            platform=request.platform,
            custom_brief=request.custom_brief,
            quora_question_url=request.quora_question_url,
            quora_question_title=request.quora_question_title,
            quora_question_snippet=request.quora_question_snippet,
            source="manual",
        )
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(exc),
        )
    except Exception as exc:
        logger.exception("create_draft: unhandled error for brand_id=%d", brand_id)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Draft generation failed. Please try again.",
        )

    return ContentDraftSchema.model_validate(draft)


# ── Draft detail ──────────────────────────────────────────────────────────────

@router.get("/draft/{draft_id}", response_model=dict)
async def get_draft(draft_id: int, db: DbDep, user: CurrentUser):
    """
    Return draft detail including the platform guidelines that were applied.
    """
    draft = await _get_draft_for_user(db, draft_id, user)
    draft_data = ContentDraftSchema.model_validate(draft).model_dump()

    # Attach live platform guidelines for frontend rendering
    guidelines = PLATFORM_GUIDELINES.get(draft.platform, {})
    draft_data["platform_guidelines"] = guidelines

    return draft_data


# ── Draft attribution helper ──────────────────────────────────────────────────

async def _create_draft_attribution(db: AsyncSession, draft: ContentDraft) -> None:
    """Record current prompt visibility at time of posting for attribution tracking."""
    from app.models import DraftAttribution, QueryResult, TrackingRun

    if draft.prompt_id is None:
        return  # No prompt linked — skip attribution

    # Find the latest completed tracking run for this brand
    latest_run_result = await db.execute(
        select(TrackingRun)
        .where(TrackingRun.brand_id == draft.brand_id, TrackingRun.status == "completed")
        .order_by(TrackingRun.completed_at.desc())
        .limit(1)
    )
    latest_run = latest_run_result.scalar_one_or_none()

    score_at_posting: float | None = None
    if latest_run:
        # Compute prompt visibility from that run's query results
        qr_result = await db.execute(
            select(QueryResult).where(
                QueryResult.tracking_run_id == latest_run.id,
                QueryResult.prompt_id == draft.prompt_id,
                QueryResult.response_text.isnot(None),
            )
        )
        qrs = qr_result.scalars().all()
        if qrs:
            mentions = sum(1 for q in qrs if q.mentioned)
            score_at_posting = round(mentions / len(qrs) * 100.0, 2)

    attribution = DraftAttribution(
        draft_id=draft.id,
        brand_id=draft.brand_id,
        prompt_id=draft.prompt_id,
        posted_at=draft.posted_at or utcnow(),
        score_at_posting=score_at_posting,
        current_score=score_at_posting,
        delta=0.0 if score_at_posting is not None else None,
        runs_since_posting=0,
    )
    db.add(attribution)
    await db.commit()


async def _create_late_attach_attribution(db: AsyncSession, draft: ContentDraft) -> None:
    """Create a null-baseline DraftAttribution row for a draft that was posted
    before having a prompt attached. Safe to call when a row already exists — no-ops."""
    if draft.prompt_id is None:
        return
    from app.models import DraftAttribution

    existing_result = await db.execute(
        select(DraftAttribution).where(DraftAttribution.draft_id == draft.id)
    )
    if existing_result.scalar_one_or_none() is not None:
        return

    attribution = DraftAttribution(
        draft_id=draft.id,
        brand_id=draft.brand_id,
        prompt_id=draft.prompt_id,
        posted_at=draft.posted_at or utcnow(),
        score_at_posting=None,
        current_score=None,
        delta=None,
        runs_since_posting=0,
    )
    db.add(attribution)
    await db.flush()


# ── Draft update ──────────────────────────────────────────────────────────────

@router.put("/draft/{draft_id}", response_model=ContentDraftSchema)
async def update_draft(draft_id: int, request: UpdateDraftRequest, db: DbDep, user: CurrentUser):
    """Update a draft's title, content text, and/or status."""
    draft = await _get_draft_for_user(db, draft_id, user)

    content_changed = request.content_text is not None and request.content_text != draft.content_text
    old_status = draft.status

    if request.title is not None:
        draft.title = request.title
    if request.content_text is not None:
        draft.content_text = request.content_text
        draft.edited_count = (draft.edited_count or 0) + 1
    if request.platform_guidelines_applied is not None:
        draft.platform_guidelines_applied = request.platform_guidelines_applied
    if request.prompt_id is not None:
        prompt_result = await db.execute(
            select(Prompt).where(Prompt.id == request.prompt_id)
        )
        target_prompt = prompt_result.scalar_one_or_none()
        if target_prompt is None or target_prompt.brand_id != draft.brand_id:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="prompt_id must reference a prompt on the same brand as the draft",
            )
        draft.prompt_id = request.prompt_id
        # Late attach: draft was already posted — create null-baseline attribution
        if old_status == "posted":
            # Flush the prompt_id assignment so the helper sees the updated draft
            await db.flush()
            await _create_late_attach_attribution(db, draft)
    if request.status is not None:
        allowed_statuses = {"draft", "approved", "posted", "failed"}
        if request.status not in allowed_statuses:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=f"Invalid status. Must be one of {sorted(allowed_statuses)}",
            )
        if request.status == "approved" and old_status != "approved":
            # Check scheduled cap before approving
            from sqlalchemy import func as sqlfunc
            sched_count_result = await db.execute(
                select(sqlfunc.count(ContentDraft.id)).where(
                    ContentDraft.brand_id == draft.brand_id,
                    ContentDraft.status == "approved",
                )
            )
            sched_count = sched_count_result.scalar_one_or_none() or 0
            brand_obj = await get_brand_for_user(draft.brand_id, db, user)
            sched_cap = TIER_SCHEDULED_CAPS.get(user.subscription_tier, 10) if not user.is_admin else SCHEDULED_CAP
            if getattr(brand_obj, "brand_type", "standard") == "pitch":
                sched_cap = 10
            if sched_count >= sched_cap:
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail=f"Saved drafts queue is full ({sched_cap}/{sched_cap}). Mark some drafts as posted before approving more.",
                )
            now = utcnow()
            draft.approved_at = now
            secs = int((now - draft.created_at).total_seconds()) if draft.created_at else None
            draft.time_to_approve_seconds = secs
        draft.status = request.status
        if request.status == "posted" and old_status != "posted":
            draft.posted_at = utcnow()
            # Snapshot overall brand visibility at time of posting
            latest_run_res = await db.execute(
                select(TrackingRun)
                .where(TrackingRun.brand_id == draft.brand_id, TrackingRun.status == "completed")
                .order_by(TrackingRun.completed_at.desc())
                .limit(1)
            )
            latest_run = latest_run_res.scalar_one_or_none()
            if latest_run and latest_run.overall_score is not None:
                draft.visibility_at_post = round(latest_run.overall_score, 1)
            # NEW: capture posted URL + snapshot brief version for cluster drafts
            if request.posted_url is not None:
                draft.posted_url = request.posted_url
            if draft.cluster_id is not None:
                from app.models import ContentBrief, ContentCluster
                cluster_row = await db.get(ContentCluster, draft.cluster_id)
                if cluster_row is not None and cluster_row.last_brief_id is not None:
                    brief_row = await db.get(ContentBrief, cluster_row.last_brief_id)
                    if brief_row is not None:
                        draft.brief_version = brief_row.version

    draft.updated_at = utcnow()
    await db.commit()
    await db.refresh(draft)

    from app.services.analytics_service import log_event
    if content_changed:
        await log_event("draft_edited", {"draft_id": draft.id, "platform": draft.platform}, brand_id=draft.brand_id)
    if request.prompt_id is not None:
        await log_event(
            "draft_prompt_attached",
            {
                "draft_id": draft.id,
                "prompt_id": request.prompt_id,
                "late_attach": old_status == "posted",
            },
            brand_id=draft.brand_id,
        )
    if request.status == "approved" and old_status != "approved":
        await log_event(
            "draft_approved",
            {
                "draft_id": draft.id,
                "platform": draft.platform,
                "time_since_created_seconds": draft.time_to_approve_seconds,
            },
            brand_id=draft.brand_id,
        )
    if request.status == "posted" and old_status != "posted":
        await log_event(
            "draft_posted",
            {"draft_id": draft.id, "platform": draft.platform},
            brand_id=draft.brand_id,
        )
        from app.services.content_event_service import log_content_event
        await log_content_event(
            event_type="draft_posted",
            brand_id=draft.brand_id,
            prompt_id=draft.prompt_id,
            data={
                "draft_id": draft.id,
                "platform": draft.platform,
                "visibility_at_post": draft.visibility_at_post,
            },
        )
        await _create_draft_attribution(db, draft)

    return ContentDraftSchema.model_validate(draft)


# ── Draft posting ─────────────────────────────────────────────────────────────

@router.post("/draft/{draft_id}/post", response_model=ContentPostSchema, status_code=status.HTTP_201_CREATED)
async def post_draft_endpoint(draft_id: int, request: PostDraftRequest, db: DbDep, user: CurrentUser):
    """Mark a draft as posted and create a ContentPost record."""
    await _get_draft_for_user(db, draft_id, user)
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
async def delete_draft(draft_id: int, db: DbDep, user: CurrentUser):
    """Delete a draft and all associated posts / attributions (cascade)."""
    draft = await _get_draft_for_user(db, draft_id, user)
    secs = int((utcnow() - draft.created_at).total_seconds()) if draft.created_at else None
    brand_id = draft.brand_id
    platform = draft.platform
    await db.delete(draft)
    await db.commit()

    from app.services.analytics_service import log_event
    await log_event(
        "draft_dismissed",
        {"draft_id": draft_id, "platform": platform, "time_since_created_seconds": secs},
        brand_id=brand_id,
    )


# ── Prompt suggestions for orphan drafts ─────────────────────────────────────

# Jaccard similarity thresholds for prompt-suggestion labels.
# Tuned for short prompt text vs. draft paragraphs — revisit if length distributions change.
_VERY_RELEVANT_THRESHOLD = 0.35
_SOMEWHAT_THRESHOLD = 0.15


def _label_for_similarity(score: float) -> str:
    if score >= _VERY_RELEVANT_THRESHOLD:
        return "very_relevant"
    if score >= _SOMEWHAT_THRESHOLD:
        return "somewhat"
    return "loose"


@router.get("/draft/{draft_id}/prompt-suggestions", response_model=list[PromptSuggestion])
async def get_prompt_suggestions_for_draft(draft_id: int, db: DbDep, user: CurrentUser):
    """Return up to 3 tracked prompts ranked by similarity to the draft's content."""
    draft = await _get_draft_for_user(db, draft_id, user)
    prompt_result = await db.execute(
        select(Prompt).where(Prompt.brand_id == draft.brand_id).order_by(Prompt.id)
    )
    prompts = list(prompt_result.scalars().all())
    if not prompts:
        return []
    ranked = rank_prompts_by_similarity(draft.content_text or "", prompts)[:3]
    return [
        PromptSuggestion(
            prompt_id=p.id,
            text=p.text,
            score=round(score, 4),
            label=_label_for_similarity(score),
        )
        for p, score in ranked
    ]


# ── Bulk approve ─────────────────────────────────────────────────────────────

@router.post("/{brand_id}/drafts/approve-all")
async def approve_all_drafts(
    brand_id: int,
    db: DbDep,
    user: CurrentUser,
    platform: str | None = Query(None, description="Only approve drafts for this platform"),
):
    """Bulk-approve all drafts (optionally filtered by platform) up to the tier cap."""
    from sqlalchemy import func as sqlfunc

    brand_obj = await get_brand_for_user(brand_id, db, user)

    # Current scheduled count
    sched_count_result = await db.execute(
        select(sqlfunc.count(ContentDraft.id)).where(
            ContentDraft.brand_id == brand_id,
            ContentDraft.status == "approved",
        )
    )
    sched_count = sched_count_result.scalar_one_or_none() or 0
    sched_cap = TIER_SCHEDULED_CAPS.get(user.subscription_tier, 10) if not user.is_admin else SCHEDULED_CAP
    if getattr(brand_obj, "brand_type", "standard") == "pitch":
        sched_cap = 10

    available = max(0, sched_cap - sched_count)
    if available == 0:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Saved drafts queue is full ({sched_cap}/{sched_cap}). Mark some drafts as posted before approving more.",
        )

    # Fetch pending drafts
    q = select(ContentDraft).where(
        ContentDraft.brand_id == brand_id,
        ContentDraft.status == "draft",
    ).order_by(ContentDraft.created_at)
    if platform:
        q = q.where(ContentDraft.platform == platform)
    result = await db.execute(q)
    pending = list(result.scalars().all())

    now = utcnow()
    approved_count = 0
    for draft in pending:
        if approved_count >= available:
            break
        draft.status = "approved"
        draft.approved_at = now
        secs = int((now - draft.created_at).total_seconds()) if draft.created_at else None
        draft.time_to_approve_seconds = secs
        approved_count += 1

    await db.commit()

    skipped = len(pending) - approved_count
    return {
        "approved": approved_count,
        "skipped": skipped,
        "reason": f"Cap reached ({sched_cap})" if skipped > 0 else None,
    }


# ── Generate now (auto-draft top gaps) ───────────────────────────────────────

@router.post("/{brand_id}/generate-now", status_code=status.HTTP_202_ACCEPTED)
async def generate_now(brand_id: int, request: GenerateNowRequest, db: DbDep, user: CurrentUser):
    """
    Kick off background draft generation for the top N gaps across all enabled
    platforms. Returns 202 immediately; poll GET /draft-status to track progress.
    """
    require_active_subscription(user)
    if not user.is_admin and not user.subscription_tier:
        raise HTTPException(
            status_code=status.HTTP_402_PAYMENT_REQUIRED,
            detail="On-demand draft generation is available on paid plans. Upgrade to unlock this feature.",
        )
    check_rate_limit(user.id, limit=2)  # burst guard (per minute)

    if brand_id in _state.generating_brands:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Draft generation is already in progress for this brand.",
        )
    # Reserve the slot immediately to prevent races across awaits
    _state.generating_brands.add(brand_id)

    try:
        brand = await get_brand_for_user(brand_id, db, user)
        require_brand_active(brand, user)

        # Paid users have no weekly draft limit — the per-click rate limiter
        # (2/min) is sufficient cost control.  Only pitch brands are capped.
        is_pitch = getattr(brand, "brand_type", "standard") == "pitch"
        if not user.is_admin and is_pitch:
            from datetime import datetime, timedelta

            from sqlalchemy import func as sqlfunc

            week_ago = datetime.now(UTC).replace(tzinfo=None) - timedelta(days=7)
            committed_result = await db.execute(
                select(sqlfunc.count(ContentDraft.id)).where(
                    ContentDraft.brand_id == brand_id,
                    ContentDraft.source == "manual",
                    ContentDraft.status.in_(["approved", "posted"]),
                    ContentDraft.created_at >= week_ago,
                )
            )
            committed = committed_result.scalar_one_or_none() or 0
            effective_remaining = _WEEKLY_MANUAL_LIMIT_PITCH - committed
            if effective_remaining <= 0:
                raise HTTPException(
                    status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                    detail=(
                        f"Weekly manual draft limit reached ({_WEEKLY_MANUAL_LIMIT_PITCH}/{_WEEKLY_MANUAL_LIMIT_PITCH} for this pitch deck). "
                        "Resets 7 days after your first manual draft this week."
                    ),
                )
            remaining = min(request.max_gaps, effective_remaining)
        else:
            remaining = request.max_gaps

        # Clamp against the per-tier draft cap so the frontend can't request
        # more drafts than the user's plan allows. Admins bypass.
        if not user.is_admin:
            tier_cap = get_draft_cap(user.subscription_tier, brand.brand_type or "standard")
            remaining = min(remaining, tier_cap)
    except Exception:
        _state.generating_brands.discard(brand_id)
        raise

    asyncio.create_task(
        _bg_generate_drafts(
            brand_id=brand_id,
            max_gaps=remaining,
            source="manual",
        )
    )
    logger.info("generate_now: background task started for brand_id=%d max_gaps=%d", brand_id, remaining)
    return {"status": "generating", "brand_id": brand_id}


# ── Draft queue status ────────────────────────────────────────────────────────

@router.get("/{brand_id}/draft-status")
async def get_draft_status(brand_id: int, db: DbDep, user: CurrentUser):
    """Return current draft queue usage counts and caps."""
    brand_obj = await get_brand_for_user(brand_id, db, user)

    from sqlalchemy import func as sqlfunc

    from app.models import ContentOpportunity

    draft_count_result = await db.execute(
        select(sqlfunc.count(ContentDraft.id)).where(
            ContentDraft.brand_id == brand_id,
            ContentDraft.status == "draft",
        )
    )
    draft_count = draft_count_result.scalar_one_or_none() or 0

    scheduled_count_result = await db.execute(
        select(sqlfunc.count(ContentDraft.id)).where(
            ContentDraft.brand_id == brand_id,
            ContentDraft.status == "approved",
        )
    )
    scheduled_count = scheduled_count_result.scalar_one_or_none() or 0

    # Last scan time: most recent ContentOpportunity created_at for this brand
    last_scan_result = await db.execute(
        select(sqlfunc.max(ContentOpportunity.created_at)).where(
            ContentOpportunity.brand_id == brand_id,
        )
    )
    last_scan_at = last_scan_result.scalar_one_or_none()

    # Weekly draft quota — only applies to pitch brands (paid users are unlimited)
    weekly_drafts_remaining: int | None = None
    weekly_drafts_limit: int | None = None
    is_pitch = getattr(brand_obj, "brand_type", "standard") == "pitch"
    if not user.is_admin and is_pitch:
        from datetime import datetime, timedelta

        week_ago = datetime.now(UTC).replace(tzinfo=None) - timedelta(days=7)
        committed_result = await db.execute(
            select(sqlfunc.count(ContentDraft.id)).where(
                ContentDraft.brand_id == brand_id,
                ContentDraft.source == "manual",
                ContentDraft.status.in_(["approved", "posted"]),
                ContentDraft.created_at >= week_ago,
            )
        )
        committed = committed_result.scalar_one_or_none() or 0
        weekly_drafts_limit = _WEEKLY_MANUAL_LIMIT_PITCH
        weekly_drafts_remaining = max(0, _WEEKLY_MANUAL_LIMIT_PITCH - committed)

    tier = user.subscription_tier
    tier_draft_cap = get_draft_cap(tier, brand_obj.brand_type) if not user.is_admin else DRAFT_CAP
    tier_sched_cap = TIER_SCHEDULED_CAPS.get(tier, 10) if not user.is_admin else SCHEDULED_CAP
    if is_pitch:
        tier_sched_cap = 10

    return {
        "draft_count": draft_count,
        "draft_cap": tier_draft_cap,
        "draft_queue_full": draft_count >= tier_draft_cap,
        "scheduled_count": scheduled_count,
        "scheduled_cap": tier_sched_cap,
        "scheduled_queue_full": scheduled_count >= tier_sched_cap,
        "last_scan_at": last_scan_at.isoformat() if last_scan_at else None,
        "generating": brand_id in _state.generating_brands,
        "weekly_drafts_remaining": weekly_drafts_remaining,
        "weekly_drafts_limit": weekly_drafts_limit,
        "show_upgrade": not user.is_admin and tier not in ("basic", "starter", "pro"),
    }


# ── Gap-targeted draft generation ─────────────────────────────────────────────

@router.post("/{brand_id}/gap-draft", response_model=ContentDraftSchema, status_code=status.HTTP_201_CREATED)
async def create_gap_draft(brand_id: int, request: CreateDraftRequest, db: DbDep, user: CurrentUser):
    """
    Generate a high-quality gap-targeted draft using the Phase 2 drafting engine
    (full BrandProfile context + LLM response analysis).
    """
    if not user.is_admin and not user.subscription_tier:
        raise HTTPException(
            status_code=status.HTTP_402_PAYMENT_REQUIRED,
            detail="Content drafting requires a paid plan. Upgrade to unlock this feature.",
        )
    brand = await get_brand_for_user(brand_id, db, user)
    require_brand_active(brand, user)
    if not user.is_admin:
        await _check_weekly_manual_draft_limit(db, brand, user.subscription_tier)

    if request.platform not in ALL_DRAFT_PLATFORMS:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Unsupported platform. Must be one of {ALL_DRAFT_PLATFORMS}",
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
            quora_question_url=request.quora_question_url,
            quora_question_title=request.quora_question_title,
            quora_question_snippet=request.quora_question_snippet,
            source="manual",
        )
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc))
    except Exception as exc:
        logger.exception("generate_now: draft generation failed")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Draft generation failed. Please try again.",
        )

    return ContentDraftSchema.model_validate(draft)


# ── Brand content settings ────────────────────────────────────────────────────

@router.get("/{brand_id}/settings", response_model=list[BrandContentSettingsSchema])
async def get_brand_settings(brand_id: int, db: DbDep, user: CurrentUser):
    """
    Return content settings for all platforms for a brand.
    Creates default settings on-the-fly for any platform not yet configured.
    """
    await get_brand_for_user(brand_id, db, user)

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
    user: CurrentUser,
):
    """Update content settings for a specific platform for a brand."""
    await get_brand_for_user(brand_id, db, user)

    from app.dependencies import require_paid_for_platform
    require_paid_for_platform(platform, user)

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
async def get_attribution(brand_id: int, db: DbDep, user: CurrentUser):
    """Return all content attribution records for a brand."""
    await get_brand_for_user(brand_id, db, user)

    result = await db.execute(
        select(ContentAttribution)
        .where(ContentAttribution.brand_id == brand_id)
        .order_by(ContentAttribution.measured_at.desc())
        .limit(200)
    )
    attributions = result.scalars().all()
    return [ContentAttributionSchema.model_validate(a) for a in attributions]
