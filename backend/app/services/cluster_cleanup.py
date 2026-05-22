"""Auto-fail clusters stuck in briefing/generating beyond a threshold."""
from __future__ import annotations

import logging
from datetime import datetime, timedelta, UTC

from sqlalchemy import update
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import ContentCluster

logger = logging.getLogger(__name__)


async def auto_fail_stale_clusters(
    db: AsyncSession,
    *,
    max_age_minutes: int = 15,
) -> int:
    """Flip stuck briefing→briefing_failed and stuck generating→generation_partial."""
    cutoff = datetime.now(UTC).replace(tzinfo=None) - timedelta(minutes=max_age_minutes)
    result_b = await db.execute(
        update(ContentCluster)
        .where(
            ContentCluster.status == "briefing",
            ContentCluster.created_at < cutoff,
        )
        .values(status="briefing_failed", failure_reason="timeout")
    )
    result_g = await db.execute(
        update(ContentCluster)
        .where(
            ContentCluster.status == "generating",
            ContentCluster.created_at < cutoff,
        )
        .values(status="generation_partial", failure_reason="timeout")
    )
    await db.commit()
    total = (result_b.rowcount or 0) + (result_g.rowcount or 0)
    if total:
        logger.warning("Auto-failed %d stale cluster(s)", total)
    return total
