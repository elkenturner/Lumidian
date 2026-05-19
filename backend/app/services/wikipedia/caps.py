"""Tier gating + rolling-30-day cap math for the Wikipedia surface."""
from __future__ import annotations

from datetime import UTC, datetime, timedelta

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import WikipediaCandidate, WikipediaScan

WIKIPEDIA_ENABLED_TIERS: frozenset[str] = frozenset({"starter", "pro"})

# Per-tier caps over a rolling 30-day window. None = unlimited.
_SCAN_CAPS: dict[str, int | None] = {"starter": 4, "pro": None}
_DRAFT_CAPS: dict[str, int | None] = {"starter": 30, "pro": None}

WINDOW_DAYS = 30


def is_tier_eligible(tier: str | None, *, brand_type: str) -> bool:
    """Agency brands always eligible. Otherwise tier must be in WIKIPEDIA_ENABLED_TIERS."""
    if brand_type == "agency":
        return True
    if not tier:
        return False
    return tier in WIKIPEDIA_ENABLED_TIERS


def _window_start() -> datetime:
    return (datetime.now(UTC) - timedelta(days=WINDOW_DAYS)).replace(tzinfo=None)


async def remaining_scans_in_window(
    db: AsyncSession, *, brand_id: int, tier: str | None, brand_type: str
) -> int | None:
    """Returns scans left in the 30-day window. None = unlimited."""
    if brand_type == "agency" or tier == "pro":
        return None
    cap = _SCAN_CAPS.get(tier or "")
    if cap is None:
        return None
    count = (
        await db.execute(
            select(func.count(WikipediaScan.id)).where(
                WikipediaScan.brand_id == brand_id,
                WikipediaScan.started_at >= _window_start(),
            )
        )
    ).scalar_one()
    return max(cap - int(count or 0), 0)


async def remaining_drafts_in_window(
    db: AsyncSession, *, brand_id: int, tier: str | None, brand_type: str
) -> int | None:
    if brand_type == "agency" or tier == "pro":
        return None
    cap = _DRAFT_CAPS.get(tier or "")
    if cap is None:
        return None
    count = (
        await db.execute(
            select(func.count(WikipediaCandidate.id)).where(
                WikipediaCandidate.brand_id == brand_id,
                WikipediaCandidate.last_drafted_at >= _window_start(),
            )
        )
    ).scalar_one()
    return max(cap - int(count or 0), 0)
