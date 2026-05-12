"""One-shot backfill of CitationSource rows from all completed TrackingRun history.

Safe to re-run: extract_for_run is idempotent via UNIQUE(query_result_id, url).

Usage:
    python -m scripts.backfill_citations
    python -m scripts.backfill_citations --brand-id 42
    python -m scripts.backfill_citations --since 2026-01-01
"""
from __future__ import annotations

import argparse
import asyncio
import logging
from datetime import datetime, UTC

from sqlalchemy import select

from app.database import AsyncSessionLocal
from app.models import TrackingRun
from app.services.site_audit.citations import extract_for_run

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger(__name__)


async def main(brand_id: int | None, since: datetime | None) -> None:
    async with AsyncSessionLocal() as db:
        q = select(TrackingRun.id, TrackingRun.brand_id).where(
            TrackingRun.status == "completed"
        )
        if brand_id is not None:
            q = q.where(TrackingRun.brand_id == brand_id)
        if since is not None:
            q = q.where(TrackingRun.started_at >= since)
        q = q.order_by(TrackingRun.started_at)
        rows = (await db.execute(q)).all()

    total = 0
    runs = 0
    for run_id, _brand_id in rows:
        try:
            n = await extract_for_run(run_id)
        except Exception:  # noqa: BLE001
            logger.exception("extract_for_run failed for run %d", run_id)
            continue
        total += n
        runs += 1
        if runs % 100 == 0:
            logger.info("Backfilled %d runs, %d citations so far", runs, total)
    logger.info("Backfill complete: %d runs processed, %d citations inserted", runs, total)


def _parse_args() -> argparse.Namespace:
    ap = argparse.ArgumentParser()
    ap.add_argument("--brand-id", type=int, default=None)
    ap.add_argument("--since", type=str, default=None,
                    help="ISO date — only runs started on/after this date")
    return ap.parse_args()


if __name__ == "__main__":
    args = _parse_args()
    since_dt: datetime | None = None
    if args.since:
        since_dt = datetime.fromisoformat(args.since).replace(tzinfo=UTC)
    asyncio.run(main(args.brand_id, since_dt))
