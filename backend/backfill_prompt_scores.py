"""
One-time backfill: populate PromptRunScore from historical QueryResult data.

Run: cd backend && python backfill_prompt_scores.py
"""
import asyncio
import logging
import sys

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger(__name__)


async def backfill():
    from app.database import AsyncSessionLocal, engine, Base
    from app.models import QueryResult, TrackingRun, PromptRunScore
    from sqlalchemy import select, func

    # Check if already backfilled
    async with AsyncSessionLocal() as db:
        count_result = await db.execute(select(func.count()).select_from(PromptRunScore))
        existing = count_result.scalar_one()
        if existing > 0:
            logger.info("PromptRunScore already has %d rows — skipping backfill.", existing)
            return

    # Get all completed runs
    async with AsyncSessionLocal() as db:
        runs_result = await db.execute(
            select(TrackingRun)
            .where(TrackingRun.status == "completed")
            .order_by(TrackingRun.completed_at.asc())
        )
        runs = runs_result.scalars().all()
        logger.info("Found %d completed runs to backfill.", len(runs))

        total_scores = 0
        for run in runs:
            qr_result = await db.execute(
                select(QueryResult).where(QueryResult.tracking_run_id == run.id)
            )
            qrs = qr_result.scalars().all()

            stats: dict[tuple[int, str], dict] = {}
            for qr in qrs:
                if qr.error:
                    continue
                key = (qr.prompt_id, qr.model)
                if key not in stats:
                    stats[key] = {"total": 0, "mentioned": 0}
                s = stats[key]
                s["total"] += 1
                if qr.mentioned:
                    s["mentioned"] += 1

            for (prompt_id, model), s in stats.items():
                tq = s["total"]
                tm = s["mentioned"]
                score = round(tm / tq * 100.0, 2) if tq > 0 else 0.0
                db.add(PromptRunScore(
                    prompt_id=prompt_id,
                    tracking_run_id=run.id,
                    brand_id=run.brand_id,
                    model=model,
                    score=score,
                    mentioned_count=tm,
                    query_count=tq,
                ))
                total_scores += 1

            if total_scores % 100 == 0 and total_scores > 0:
                await db.commit()
                logger.info("Progress: %d scores inserted...", total_scores)

        await db.commit()
        logger.info("Backfill complete: %d PromptRunScore rows inserted.", total_scores)

    await engine.dispose()


if __name__ == "__main__":
    asyncio.run(backfill())
