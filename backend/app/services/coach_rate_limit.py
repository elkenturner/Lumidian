"""Per-user-per-day rate limiting for the coach.

Uses the existing `rate_limits` SQL table (key/endpoint/created_at). The key is
"coach:{user_id}", the endpoint is the date in UTC. Counter resets at midnight UTC
because each new day uses a different endpoint string.
"""
import time
from datetime import datetime, timedelta, timezone
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession


DAILY_CAPS: dict[str | None, int] = {
    None: 5,        # Free / pitch
    "basic": 25,    # Starter
    "starter": 75,  # Growth
    "pro": 250,     # Pro
}


def _today_utc() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%d")


def _resets_at_iso() -> str:
    now = datetime.now(timezone.utc)
    next_midnight = (now + timedelta(days=1)).replace(hour=0, minute=0, second=0, microsecond=0)
    return next_midnight.isoformat()


async def _count_today(db: AsyncSession, *, user_id: int) -> int:
    key = f"coach:{user_id}"
    today = _today_utc()
    row = (await db.execute(
        text("SELECT COUNT(*) FROM rate_limits WHERE key = :k AND endpoint = :e"),
        {"k": key, "e": today},
    )).scalar()
    return int(row or 0)


async def check_and_increment(db: AsyncSession, *, user_id: int, tier: str | None) -> tuple[bool, int, int]:
    """Returns (allowed, used_after, limit). If not allowed, used_after is the
    current count (no increment performed)."""
    limit = DAILY_CAPS.get(tier, DAILY_CAPS[None])
    used = await _count_today(db, user_id=user_id)
    if used >= limit:
        return (False, used, limit)
    await db.execute(
        text("INSERT INTO rate_limits (key, endpoint, created_at) VALUES (:k, :e, :t)"),
        {"k": f"coach:{user_id}", "e": _today_utc(), "t": time.time()},
    )
    await db.commit()
    return (True, used + 1, limit)


async def get_usage(db: AsyncSession, *, user_id: int, tier: str | None) -> dict:
    used = await _count_today(db, user_id=user_id)
    limit = DAILY_CAPS.get(tier, DAILY_CAPS[None])
    return {"used": used, "limit": limit, "resets_at": _resets_at_iso()}
