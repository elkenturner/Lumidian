"""
Content event logging helper.

log_content_event() is fire-and-forget: it always creates its own DB session
and never raises — failures are logged as warnings so they never break the
calling code path.  Mirrors the pattern in analytics_service.py.
"""
from __future__ import annotations

import json
import logging
from typing import Any

logger = logging.getLogger(__name__)


async def log_content_event(
    event_type: str,
    brand_id: int,
    prompt_id: int | None = None,
    data: dict[str, Any] | None = None,
) -> None:
    """Append a content event row. Never raises."""
    try:
        from app.database import AsyncSessionLocal
        from app.models import ContentEvent

        async with AsyncSessionLocal() as db:
            event = ContentEvent(
                event_type=event_type,
                brand_id=brand_id,
                prompt_id=prompt_id,
                data=json.dumps(data) if data else None,
            )
            db.add(event)
            await db.commit()
    except Exception as exc:
        logger.warning("Content event logging failed (non-fatal): %s — %s", event_type, exc)
