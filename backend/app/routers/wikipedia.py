"""Wikipedia surface API endpoints."""
from __future__ import annotations

import logging
from datetime import UTC, datetime
from typing import Annotated

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, status
from sqlalchemy import desc, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import AsyncSessionLocal, get_db
from app.dependencies import CurrentUser
from app.models import (
    Brand,
    WikipediaCandidate,
    WikipediaScan,
)
from app.schemas import (
    UpdateCandidateStatusRequest,
    WikipediaCandidateSchema,
    WikipediaScanSchema,
)
from app.services.wikipedia.caps import (
    is_tier_eligible,
    remaining_drafts_in_window,
    remaining_scans_in_window,
)
from app.services.wikipedia.drafter import (
    ArticleNotFoundError,
    TitleMismatchError,
    draft_candidate,
)
from app.services.wikipedia.scanner import run_scan

logger = logging.getLogger(__name__)

DbDep = Annotated[AsyncSession, Depends(get_db)]

router = APIRouter(prefix="/wikipedia", tags=["wikipedia"])


async def _ensure_brand_owned(db: AsyncSession, brand_id: int, user) -> Brand:
    # Delegate to the canonical check so admin bypass and team-owner
    # resolution behave the same here as on every other surface.
    from app.dependencies import get_brand_for_user
    return await get_brand_for_user(brand_id, db, user)


def _enforce_tier(user, brand: Brand) -> str | None:
    """Raise 402 if user's tier is not eligible for the Wikipedia surface."""
    tier = user.subscription_tier
    if not is_tier_eligible(tier, brand_type=brand.brand_type or "standard"):
        raise HTTPException(status.HTTP_402_PAYMENT_REQUIRED, "Wikipedia surface requires Growth or Pro")
    return tier


@router.get("/{brand_id}/candidates", response_model=list[WikipediaCandidateSchema])
async def list_candidates(
    brand_id: int,
    db: DbDep,
    user: CurrentUser,
    status: str | None = None,
    min_score: float | None = None,
) -> list[WikipediaCandidate]:
    brand = await _ensure_brand_owned(db, brand_id, user)
    _enforce_tier(user, brand)
    stmt = select(WikipediaCandidate).where(WikipediaCandidate.brand_id == brand_id)
    if status:
        stmt = stmt.where(WikipediaCandidate.status == status)
    if min_score is not None:
        stmt = stmt.where(WikipediaCandidate.legitimacy_score >= min_score)
    stmt = stmt.order_by(desc(WikipediaCandidate.legitimacy_score))
    return list((await db.execute(stmt)).scalars().all())


@router.get("/{brand_id}/candidates/{candidate_id}", response_model=WikipediaCandidateSchema)
async def get_candidate(
    brand_id: int,
    candidate_id: int,
    db: DbDep,
    user: CurrentUser,
) -> WikipediaCandidate:
    brand = await _ensure_brand_owned(db, brand_id, user)
    _enforce_tier(user, brand)
    candidate = (
        await db.execute(
            select(WikipediaCandidate).where(
                WikipediaCandidate.id == candidate_id, WikipediaCandidate.brand_id == brand_id
            )
        )
    ).scalar_one_or_none()
    if candidate is None:
        raise HTTPException(404, "Candidate not found")
    return candidate


@router.post("/{brand_id}/scan", response_model=WikipediaScanSchema, status_code=status.HTTP_202_ACCEPTED)
async def trigger_scan(
    brand_id: int,
    db: DbDep,
    user: CurrentUser,
    background: BackgroundTasks,
) -> WikipediaScan:
    brand = await _ensure_brand_owned(db, brand_id, user)
    tier = _enforce_tier(user, brand)

    remaining = await remaining_scans_in_window(
        db, brand_id=brand_id, tier=tier, brand_type=brand.brand_type or "standard"
    )
    if remaining is not None and remaining <= 0:
        raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS, "Scan cap exceeded for this 30-day window")

    scan = WikipediaScan(
        brand_id=brand_id,
        status="running",
        triggered_by=user.id,
        started_at=datetime.now(UTC).replace(tzinfo=None),
    )
    db.add(scan)
    await db.commit()
    await db.refresh(scan)
    scan_id = scan.id

    async def _bg() -> None:
        async with AsyncSessionLocal() as bg_db:
            try:
                await run_scan(bg_db, brand_id=brand_id, triggered_by=user.id, scan_id=scan_id)
            except Exception:
                logger.exception("background scan failed for brand %d", brand_id)

    background.add_task(_bg)
    return scan


@router.get("/{brand_id}/scans/latest", response_model=WikipediaScanSchema | None)
async def get_latest_scan(brand_id: int, db: DbDep, user: CurrentUser) -> WikipediaScan | None:
    brand = await _ensure_brand_owned(db, brand_id, user)
    _enforce_tier(user, brand)
    return (
        await db.execute(
            select(WikipediaScan)
            .where(WikipediaScan.brand_id == brand_id)
            .order_by(desc(WikipediaScan.id))
            .limit(1)
        )
    ).scalar_one_or_none()


@router.post("/{brand_id}/candidates/{candidate_id}/draft", response_model=WikipediaCandidateSchema)
async def draft_endpoint(
    brand_id: int,
    candidate_id: int,
    db: DbDep,
    user: CurrentUser,
) -> WikipediaCandidate:
    brand = await _ensure_brand_owned(db, brand_id, user)
    tier = _enforce_tier(user, brand)
    candidate = (
        await db.execute(
            select(WikipediaCandidate).where(
                WikipediaCandidate.id == candidate_id, WikipediaCandidate.brand_id == brand_id
            )
        )
    ).scalar_one_or_none()
    if candidate is None:
        raise HTTPException(404, "Candidate not found")

    remaining = await remaining_drafts_in_window(
        db, brand_id=brand_id, tier=tier, brand_type=brand.brand_type or "standard"
    )
    if remaining is not None and remaining <= 0:
        raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS, "Draft cap exceeded for this 30-day window")

    try:
        return await draft_candidate(db, candidate_id=candidate.id, tier=tier)
    except ArticleNotFoundError as e:
        raise HTTPException(status.HTTP_410_GONE, str(e))
    except TitleMismatchError as e:
        raise HTTPException(status.HTTP_500_INTERNAL_SERVER_ERROR, str(e))


@router.patch("/{brand_id}/candidates/{candidate_id}/status", response_model=WikipediaCandidateSchema)
async def update_status_endpoint(
    brand_id: int,
    candidate_id: int,
    request: UpdateCandidateStatusRequest,
    db: DbDep,
    user: CurrentUser,
) -> WikipediaCandidate:
    brand = await _ensure_brand_owned(db, brand_id, user)
    _enforce_tier(user, brand)
    candidate = (
        await db.execute(
            select(WikipediaCandidate).where(
                WikipediaCandidate.id == candidate_id, WikipediaCandidate.brand_id == brand_id
            )
        )
    ).scalar_one_or_none()
    if candidate is None:
        raise HTTPException(404, "Candidate not found")
    candidate.status = request.status
    candidate.last_status_change_at = datetime.now(UTC).replace(tzinfo=None)
    await db.commit()
    await db.refresh(candidate)
    return candidate
