"""
Analytics event logging helper.

log_event() is fire-and-forget: it always creates its own DB session and
never raises — failures are logged as warnings so they never break the
calling code path.
"""
from __future__ import annotations

import json
import logging
from typing import Any

logger = logging.getLogger(__name__)


async def log_event(
    event_type: str,
    data: dict[str, Any] | None = None,
    brand_id: int | None = None,
    user_id: int | None = None,
) -> None:
    """Append an analytics event row. Never raises."""
    try:
        from app.database import AsyncSessionLocal
        from app.models import AnalyticsEvent

        async with AsyncSessionLocal() as db:
            event = AnalyticsEvent(
                event_type=event_type,
                brand_id=brand_id,
                user_id=user_id,
                data=json.dumps(data) if data else None,
            )
            db.add(event)
            await db.commit()
    except Exception as exc:
        logger.warning("Event logging failed (non-fatal): %s — %s", event_type, exc)
