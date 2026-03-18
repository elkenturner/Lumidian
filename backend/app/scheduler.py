"""
APScheduler-based scheduler for ClarityAI.

Jobs:
  • 08:00 UTC  — Morning tracking sweep
  • 20:00 UTC  — Evening tracking sweep
  • 02:00 UTC  — Reddit opportunity scanner (daily)
  • 03:00 UTC  — Auto-draft scheduler (daily, respects per-brand frequency settings)
  • 04:00 UTC, day 1 — Monthly website context refresh via Jina Reader
"""

import asyncio
import logging

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.cron import CronTrigger

logger = logging.getLogger(__name__)

scheduler = AsyncIOScheduler(timezone="UTC")


async def _is_scheduler_paused() -> bool:
    """Return True if the scheduler has been paused via the settings API."""
    from app.database import AsyncSessionLocal
    from app.models import SystemSetting
    from sqlalchemy import select
    async with AsyncSessionLocal() as db:
        result = await db.execute(
            select(SystemSetting).where(SystemSetting.key == "scheduler_paused")
        )
        setting = result.scalar_one_or_none()
        return setting is not None and setting.value == "true"


async def _run_all_brands(schedule_slot: str) -> None:
    """Fetch all brands and kick off a tracking run for each one."""
    if await _is_scheduler_paused():
        logger.info("Scheduler paused — skipping %s sweep", schedule_slot)
        return

    from app.database import AsyncSessionLocal
    from app.models import Brand
    from app.services.tracking_service import run_tracking
    from sqlalchemy import select

    logger.info("Scheduler: starting %s sweep", schedule_slot)

    async with AsyncSessionLocal() as db:
        result = await db.execute(select(Brand))
        brands = result.scalars().all()

    if not brands:
        logger.info("Scheduler: no brands found, skipping %s sweep", schedule_slot)
        return

    for brand in brands:
        logger.info(
            "Scheduler: queuing tracking run for brand %d (%s) [%s]",
            brand.id,
            brand.name,
            schedule_slot,
        )
        asyncio.create_task(
            _safe_run(brand.id, schedule_slot),
            name=f"tracking-{brand.id}-{schedule_slot}",
        )


async def _safe_run(brand_id: int, schedule_slot: str) -> None:
    """Wrapper that catches and logs exceptions so tasks don't die silently."""
    from app.services.tracking_service import run_tracking

    try:
        run_id = await run_tracking(
            brand_id=brand_id,
            run_type="scheduled",
            schedule_slot=schedule_slot,
        )
        logger.info(
            "Scheduler: completed run_id=%d for brand %d [%s]",
            run_id,
            brand_id,
            schedule_slot,
        )
    except Exception:
        logger.exception(
            "Scheduler: tracking run failed for brand %d [%s]",
            brand_id,
            schedule_slot,
        )


async def _reddit_scanner_sweep() -> None:
    """Daily Reddit scan for all brands (02:00 UTC)."""
    if await _is_scheduler_paused():
        logger.info("Scheduler paused — skipping Reddit scanner sweep")
        return

    from app.services.reddit_scanner_service import scan_all_brands
    logger.info("Scheduler: starting Reddit scanner sweep")
    try:
        await scan_all_brands()
        logger.info("Scheduler: Reddit scanner sweep complete")
    except Exception:
        logger.exception("Scheduler: Reddit scanner sweep failed")


async def _auto_draft_sweep() -> None:
    """
    Daily auto-draft job (03:00 UTC).
    Skipped when the scheduler is paused.

    For each brand, checks whether today is a drafting day based on its
    platform settings, then calls auto_draft_top_gaps for brands that are due.
    """
    if await _is_scheduler_paused():
        logger.info("Scheduler paused — skipping auto-draft sweep")
        return

    from datetime import timedelta
    from app.database import AsyncSessionLocal
    from app.models import Brand, BrandContentSettings, ContentDraft
    from app.services.drafting_service import auto_draft_top_gaps
    from sqlalchemy import select, func

    logger.info("Scheduler: starting auto-draft sweep")

    async with AsyncSessionLocal() as db:
        result = await db.execute(select(Brand))
        brands = result.scalars().all()

    for brand in brands:
        try:
            async with AsyncSessionLocal() as db:
                # Load enabled platform settings
                settings_result = await db.execute(
                    select(BrandContentSettings).where(
                        BrandContentSettings.brand_id == brand.id,
                        BrandContentSettings.enabled == True,
                    )
                )
                settings = list(settings_result.scalars().all())

                if not settings:
                    continue

                # Determine if any platform is due for a draft today
                # based on the most frequent drafting_frequency among enabled platforms
                freq_priority = {"daily": 1, "every_3_days": 3, "weekly": 7, "manual": 9999}
                min_days = min(
                    freq_priority.get(s.drafting_frequency, 9999) for s in settings
                )

                if min_days >= 9999:
                    continue  # all manual

                # Find when the last auto-draft was created for this brand
                last_draft_result = await db.execute(
                    select(func.max(ContentDraft.created_at)).where(
                        ContentDraft.brand_id == brand.id,
                        ContentDraft.content_brief.like("%Gap draft%"),
                    )
                )
                last_draft_at = last_draft_result.scalar_one_or_none()

                if last_draft_at is not None:
                    from datetime import datetime, timezone
                    now = datetime.now(timezone.utc).replace(tzinfo=None)
                    days_since = (now - last_draft_at).days
                    if days_since < min_days:
                        logger.debug(
                            "Scheduler: brand %d skipping auto-draft (%d days since last, need %d)",
                            brand.id, days_since, min_days,
                        )
                        continue

                logger.info("Scheduler: auto-drafting for brand %d (%s)", brand.id, brand.name)
                asyncio.create_task(
                    _safe_auto_draft(brand.id),
                    name=f"auto-draft-{brand.id}",
                )
        except Exception:
            logger.exception("Scheduler: auto-draft sweep error for brand %d", brand.id)

    logger.info("Scheduler: auto-draft sweep dispatched")


async def _website_context_refresh_sweep() -> None:
    """
    Monthly website context refresh (04:00 UTC, day 1 of month).
    Fetches fresh Jina Reader content for every brand that has a website_url.
    """
    if await _is_scheduler_paused():
        logger.info("Scheduler paused — skipping website context refresh sweep")
        return

    from app.database import AsyncSessionLocal
    from app.models import Brand
    from app.services.jina_service import refresh_brand_website_context
    from sqlalchemy import select

    logger.info("Scheduler: starting monthly website context refresh sweep")

    async with AsyncSessionLocal() as db:
        result = await db.execute(select(Brand).where(Brand.website_url.isnot(None)))
        brands = result.scalars().all()

    for brand in brands:
        try:
            ok = await refresh_brand_website_context(brand.id)
            if ok:
                logger.info("Website context refreshed for brand %d (%s)", brand.id, brand.name)
        except Exception:
            logger.exception("Website context refresh failed for brand %d", brand.id)

    logger.info("Scheduler: website context refresh sweep complete")


async def _safe_auto_draft(brand_id: int) -> None:
    """
    Weekly auto-draft wrapper. Deletes all existing 'draft' status drafts for
    the brand before generating new ones (weekly refresh). Drafts in 'approved'
    or 'posted' status are never touched.
    """
    from app.database import AsyncSessionLocal
    from app.services.drafting_service import auto_draft_top_gaps

    try:
        async with AsyncSessionLocal() as db:
            # clear_existing=True: weekly scheduler replaces pending drafts with fresh ones
            drafts = await auto_draft_top_gaps(db=db, brand_id=brand_id, max_gaps=3, clear_existing=True)
        logger.info(
            "Scheduler: auto-draft created %d drafts for brand_id=%d (weekly refresh)",
            len(drafts), brand_id,
        )
    except Exception:
        logger.exception("Scheduler: auto-draft failed for brand_id=%d", brand_id)


def start_scheduler() -> None:
    """Register jobs and start the scheduler. Called from FastAPI lifespan."""
    scheduler.add_job(
        _run_all_brands,
        trigger=CronTrigger(hour=8, minute=0, timezone="UTC"),
        args=["morning"],
        id="morning_sweep",
        name="Morning tracking sweep (08:00 UTC)",
        replace_existing=True,
        misfire_grace_time=300,
    )

    scheduler.add_job(
        _run_all_brands,
        trigger=CronTrigger(hour=20, minute=0, timezone="UTC"),
        args=["evening"],
        id="evening_sweep",
        name="Evening tracking sweep (20:00 UTC)",
        replace_existing=True,
        misfire_grace_time=300,
    )

    scheduler.add_job(
        _reddit_scanner_sweep,
        trigger=CronTrigger(hour=2, minute=0, timezone="UTC"),
        id="reddit_scanner",
        name="Reddit opportunity scanner (02:00 UTC)",
        replace_existing=True,
        misfire_grace_time=600,
    )

    scheduler.add_job(
        _auto_draft_sweep,
        trigger=CronTrigger(hour=3, minute=0, timezone="UTC"),
        id="auto_draft",
        name="Auto-draft scheduler (03:00 UTC)",
        replace_existing=True,
        misfire_grace_time=600,
    )

    scheduler.add_job(
        _website_context_refresh_sweep,
        trigger=CronTrigger(hour=4, minute=0, day=1, timezone="UTC"),
        id="website_context_refresh",
        name="Monthly website context refresh (04:00 UTC, day 1)",
        replace_existing=True,
        misfire_grace_time=3600,
    )

    scheduler.start()
    logger.info("Scheduler started. Jobs: %s", [j.id for j in scheduler.get_jobs()])


def stop_scheduler() -> None:
    """Gracefully shut down the scheduler. Called from FastAPI lifespan."""
    if scheduler.running:
        scheduler.shutdown(wait=False)
        logger.info("Scheduler stopped.")
