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

import asyncio
import logging
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, status

logger = logging.getLogger(__name__)
from datetime import UTC, datetime, timedelta

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.dependencies import CurrentUser, check_rate_limit, get_brand_for_user, is_paid_only_platform, require_brand_active
from app.models import Brand, ContentOpportunity, Prompt
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


def _blended_score(opp: ContentOpportunity, now: datetime) -> float:
    """Blend relevance (70%) with recency (30%) for sort ordering."""
    rel = opp.relevance_score or 0
    posted = opp.posted_at or opp.created_at
    age_days = (now - posted).days
    if age_days <= 7:
        recency = 100
    elif age_days <= 30:
        recency = 70
    elif age_days <= 60:
        recency = 40
    else:
        recency = 20
    return rel * 0.7 + recency * 0.3


@router.get("/{brand_id}", response_model=list[dict])
async def list_opportunities(
    brand_id: int,
    db: DbDep,
    user: CurrentUser,
    opp_status: str | None = Query(None, alias="status", description="Filter by status: new, drafted, dismissed"),
    limit: int = Query(20, ge=1, le=200),
):
    """List content opportunities for a brand, balanced across platforms."""
    await get_brand_for_user(brand_id, db, user)

    now = datetime.now(UTC).replace(tzinfo=None)
    cutoff = now - timedelta(days=90)

    stmt = (
        select(ContentOpportunity)
        .where(ContentOpportunity.brand_id == brand_id)
        .where(
            func.coalesce(ContentOpportunity.posted_at, ContentOpportunity.created_at) >= cutoff
        )
    )
    if opp_status is not None:
        stmt = stmt.where(ContentOpportunity.status == opp_status)
    else:
        stmt = stmt.where(ContentOpportunity.status == "new")

    result = await db.execute(stmt)
    all_opps = list(result.scalars().all())

    # Sort by blended relevance + recency score (Python-side, small dataset)
    all_opps.sort(key=lambda opp: _blended_score(opp, now), reverse=True)

    # Filter out paid-only platforms for free users
    user_tier = getattr(user, "subscription_tier", None)
    is_admin = getattr(user, "is_admin", False)
    if not is_admin and not user_tier:
        all_opps = [o for o in all_opps if not is_paid_only_platform(o.platform)]

    # Balanced interleaving: distribute evenly across platforms
    from collections import defaultdict
    by_platform: dict[str, list] = defaultdict(list)
    for opp in all_opps:
        by_platform[opp.platform].append(opp)

    n_platforms = len(by_platform)
    if n_platforms == 0:
        interleaved = []
    else:
        interleaved = []
        platform_iters = {
            p: iter(opps) for p, opps in by_platform.items()
        }
        exhausted = set()
        while len(interleaved) < limit and len(exhausted) < n_platforms:
            for p in list(by_platform.keys()):
                if p in exhausted:
                    continue
                try:
                    interleaved.append(next(platform_iters[p]))
                except StopIteration:
                    exhausted.add(p)
                if len(interleaved) >= limit:
                    break

    # Bulk load prompt texts
    prompt_ids = list({o.prompt_id for o in interleaved if o.prompt_id})
    prompt_text_map: dict[int, str] = {}
    if prompt_ids:
        pr_result = await db.execute(select(Prompt).where(Prompt.id.in_(prompt_ids)))
        for p in pr_result.scalars().all():
            prompt_text_map[p.id] = p.text

    return [_enrich_opportunity(o, prompt_text_map) for o in interleaved]


@router.delete("/{opportunity_id}/dismiss", status_code=status.HTTP_204_NO_CONTENT)
async def dismiss_opportunity(opportunity_id: int, db: DbDep, user: CurrentUser):
    """Mark an opportunity as dismissed so it no longer appears in the queue."""
    opp = await _get_opportunity_or_404(db, opportunity_id)
    await get_brand_for_user(opp.brand_id, db, user)
    opp.status = "dismissed"
    await db.commit()


@router.post(
    "/{opportunity_id}/draft",
    response_model=ContentDraftSchema,
    status_code=status.HTTP_201_CREATED,
)
async def draft_opportunity(opportunity_id: int, db: DbDep, user: CurrentUser):
    """
    Generate a reply draft for a specific opportunity thread.
    Uses the dynamic drafting engine with full BrandProfile context.
    """
    check_rate_limit(user.id, limit=10)  # 10 opportunity drafts per minute per user
    from app.services.drafting_service import generate_opportunity_draft

    opp = await _get_opportunity_or_404(db, opportunity_id)
    from app.dependencies import require_paid_for_platform
    require_paid_for_platform(opp.platform, user)
    brand = await get_brand_for_user(opp.brand_id, db, user)

    # Check if brand is paused
    require_brand_active(brand, user)

    # Pitch brands cannot draft from opportunities — paid feature
    if brand.brand_type == "pitch":
        raise HTTPException(
            status_code=status.HTTP_402_PAYMENT_REQUIRED,
            detail="Opportunity drafting is available on paid plans. Upgrade to draft replies from live opportunities.",
        )

    try:
        draft = await generate_opportunity_draft(db=db, opportunity_id=opportunity_id)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc))
    except Exception:
        logger.exception("opportunity draft generation failed")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Draft generation failed. Please try again.",
        )

    from app.services.analytics_service import log_event
    await log_event(
        "opportunity_draft_created",
        {"opportunity_id": opportunity_id, "subreddit": opp.subreddit},
        brand_id=opp.brand_id,
    )

    return ContentDraftSchema.model_validate(draft)


async def _scan_and_log(brand_id: int, user_tier: str | None = None, is_admin: bool = False) -> None:
    """Run all applicable scanners for a brand in parallel, then log the scan_completed event."""
    from app.database import AsyncSessionLocal
    from app.services import quora_scanner_service, reddit_scanner_service
    from app.services.analytics_service import log_event

    scan_tasks = [
        reddit_scanner_service.scan_brand_opportunities(brand_id, clear_existing=True),
        quora_scanner_service.scan_brand_opportunities(brand_id, clear_existing=True),
    ]

    from app.services.llm_service import is_paid_tier
    if is_admin or is_paid_tier(user_tier):
        from app.services import linkedin_scanner_service, x_scanner_service
        scan_tasks.append(linkedin_scanner_service.scan_brand_opportunities(brand_id, clear_existing=True))
        scan_tasks.append(x_scanner_service.scan_brand_opportunities(brand_id, clear_existing=True))

    try:
        await asyncio.gather(*scan_tasks, return_exceptions=True)
    except Exception:
        logger.exception("_scan_and_log: scanner error for brand_id=%d", brand_id)

    # Count opportunities found in the last few minutes for analytics
    try:
        from datetime import datetime, timedelta
        cutoff = datetime.now(UTC).replace(tzinfo=None) - timedelta(minutes=10)
        async with AsyncSessionLocal() as db:
            from sqlalchemy import select as _select
            from app.models import ContentOpportunity
            result = await db.execute(
                _select(ContentOpportunity).where(
                    ContentOpportunity.brand_id == brand_id,
                    ContentOpportunity.created_at >= cutoff,
                )
            )
            new_opps = list(result.scalars().all())
            subreddits = list({o.subreddit for o in new_opps if o.subreddit})
        await log_event(
            "reddit_scan_completed",
            {"opportunities_found": len(new_opps), "subreddits_scanned": subreddits},
            brand_id=brand_id,
        )
    except Exception:
        pass


@router.post("/{brand_id}/scan", status_code=status.HTTP_202_ACCEPTED)
async def trigger_scan(brand_id: int, db: DbDep, user: CurrentUser):
    """
    Trigger an on-demand opportunity scan for a brand (fire-and-forget).
    Returns immediately; scan runs in the background.

    Free: 2 scans per 7-day rolling window.
    Starter: 10 scans per 7-day rolling window.
    Pro: 25 scans per 7-day rolling window.
    Admins: unlimited.
    """
    from datetime import datetime, timedelta

    from sqlalchemy import func as sqlfunc

    from app.models import AnalyticsEvent
    from app.routers.billing import WEEKLY_SCAN_LIMITS
    from app.services.analytics_service import log_event

    check_rate_limit(user.id, limit=3)  # burst guard: 3 per minute
    brand = await get_brand_for_user(brand_id, db, user)

    # Check if brand is paused
    require_brand_active(brand, user)

    if not user.is_admin:
        scan_limit = WEEKLY_SCAN_LIMITS.get(user.subscription_tier or "", 0)
        if scan_limit == 0:
            raise HTTPException(
                status_code=status.HTTP_402_PAYMENT_REQUIRED,
                detail="Opportunity scanning is not available for your current plan.",
            )
        week_ago = datetime.now(UTC).replace(tzinfo=None) - timedelta(days=7)
        used_result = await db.execute(
            select(sqlfunc.count(AnalyticsEvent.id)).where(
                AnalyticsEvent.brand_id == brand_id,
                AnalyticsEvent.event_type == "manual_scan_triggered",
                AnalyticsEvent.created_at >= week_ago,
            )
        )
        used = used_result.scalar_one_or_none() or 0
        if used >= scan_limit:
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail=(
                    f"Weekly scan limit reached ({scan_limit}/{scan_limit}). "
                    "Resets 7 days after your first manual scan this week."
                ),
            )

    # Pitch brands have stricter limits (1/week) regardless of subscription tier
    if brand.brand_type == "pitch":
        from app.routers.billing import WEEKLY_SCAN_LIMITS_PITCH
        _week_ago = datetime.now(UTC).replace(tzinfo=None) - timedelta(days=7)
        pitch_scan_result = await db.execute(
            select(sqlfunc.count(AnalyticsEvent.id)).where(
                AnalyticsEvent.brand_id == brand_id,
                AnalyticsEvent.event_type == "manual_scan_triggered",
                AnalyticsEvent.created_at >= _week_ago,
            )
        )
        pitch_scans = pitch_scan_result.scalar_one_or_none() or 0
        if pitch_scans >= WEEKLY_SCAN_LIMITS_PITCH:
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail=f"Pitch brands are limited to {WEEKLY_SCAN_LIMITS_PITCH} manual scan per week. Try again next week.",
            )

    from app import state as _state

    # Block concurrent scans for this brand
    if brand_id in _state.scanning_brands:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="A scan is already running for this brand. Please wait for it to finish.",
        )
    # Reserve slot immediately to prevent races across awaits
    _state.scanning_brands.add(brand_id)

    try:
        # Log before firing so the event counts immediately on the next quota check
        await log_event("manual_scan_triggered", {"brand_id": brand_id}, brand_id=brand_id)
    except Exception:
        _state.scanning_brands.discard(brand_id)
        raise

    async def _scan_with_state_cleanup(bid: int, tier: str | None, admin: bool = False):
        try:
            await _scan_and_log(bid, user_tier=tier, is_admin=admin)
        finally:
            _state.scanning_brands.discard(bid)

    asyncio.create_task(
        _scan_with_state_cleanup(brand_id, user.subscription_tier, admin=user.is_admin),
        name=f"opportunity-scan-{brand_id}",
    )
    return {"message": f"Scan started for brand {brand_id}", "brand_id": brand_id}
