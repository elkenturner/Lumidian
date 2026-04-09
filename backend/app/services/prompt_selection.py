"""
Prompt selection for opportunity scanners.

Prioritises prompts with the weakest visibility scores from the latest
tracking run so scanners focus where the brand needs the most help.
Prompts tied at 0% are shuffled for rotation across successive scans.
"""
from __future__ import annotations

import logging
import random

logger = logging.getLogger(__name__)


async def get_priority_prompts(brand_id: int, prompts: list, limit: int = 10) -> list:
    """
    Return up to *limit* prompts sorted by weakest visibility first.

    Uses the latest completed tracking run to compute per-prompt mention
    rates.  Prompts at the same rate are shuffled so different ones get
    coverage on each scan.  Falls back to shuffled selection when no
    tracking data exists.
    """
    if len(prompts) <= limit:
        return list(prompts)

    from sqlalchemy import case, func, select

    from app.database import AsyncSessionLocal
    from app.models import QueryResult, TrackingRun

    try:
        async with AsyncSessionLocal() as db:
            run_result = await db.execute(
                select(TrackingRun.id)
                .where(
                    TrackingRun.brand_id == brand_id,
                    TrackingRun.status == "completed",
                )
                .order_by(TrackingRun.created_at.desc())
                .limit(1)
            )
            run_id = run_result.scalar_one_or_none()

            if not run_id:
                shuffled = list(prompts)
                random.shuffle(shuffled)
                return shuffled[:limit]

            rates_result = await db.execute(
                select(
                    QueryResult.prompt_id,
                    func.count(QueryResult.id).label("total"),
                    func.sum(
                        case(
                            (QueryResult.mentioned == True, 1),  # noqa: E712
                            else_=0,
                        )
                    ).label("mentions"),
                )
                .where(
                    QueryResult.tracking_run_id == run_id,
                    QueryResult.error.is_(None),
                )
                .group_by(QueryResult.prompt_id)
            )

            rates: dict[int, float] = {}
            for row in rates_result:
                total = row.total or 0
                mentions = row.mentions or 0
                rates[row.prompt_id] = mentions / total if total > 0 else 0.0

    except Exception as exc:
        logger.debug("get_priority_prompts: query failed (%s), falling back to shuffle", exc)
        shuffled = list(prompts)
        random.shuffle(shuffled)
        return shuffled[:limit]

    # Shuffle first so ties are randomised, then stable-sort by rate ascending
    prompt_list = list(prompts)
    random.shuffle(prompt_list)
    prompt_list.sort(key=lambda p: rates.get(p.id, 0.0))

    return prompt_list[:limit]
