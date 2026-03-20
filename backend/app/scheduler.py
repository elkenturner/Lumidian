"""
APScheduler-based scheduler for ClarityAI.

Jobs:
  • 02:00 UTC        — Reddit opportunity scanner (daily) + SQLite backup
  • 03:00 UTC        — Auto-draft scheduler (daily, respects per-brand frequency settings)
  • 04:00 UTC, day 1 — Monthly website context refresh via Jina Reader
  • 06:00 UTC        — Pitch brand expiry: warn users 24 h before expiry, delete expired brands
  • 08:00 UTC        — Morning tracking sweep
  • 20:00 UTC        — Evening tracking sweep
  • 21:00 UTC        — Visibility drop alerts (email if score drops ≥ 15 pts vs previous run)

Pitch brand lifecycle:
  - Created with pitch_expires_at = now + 7 days
  - At 06:00 UTC daily: users whose pitch brand expires in 23–25 h receive a warning email
  - At 06:00 UTC daily: brands whose pitch_expires_at <= now are deleted (cascade removes prompts,
    tracking runs, drafts, and content settings)
  - Morning/evening tracking sweeps and auto-draft sweeps skip expired pitch brands
"""

import asyncio
import logging
import os

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

    from datetime import datetime, timezone
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

    now = datetime.now(timezone.utc).replace(tzinfo=None)
    for brand in brands:
        # Skip pitch brands that have expired (cleanup job handles deletion)
        if brand.brand_type == "pitch" and brand.pitch_expires_at and brand.pitch_expires_at <= now:
            logger.info(
                "Scheduler: skipping expired pitch brand %d (%s) [%s]",
                brand.id, brand.name, schedule_slot,
            )
            continue
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

    from datetime import datetime, timedelta, timezone
    from app.database import AsyncSessionLocal
    from app.models import Brand, BrandContentSettings, ContentDraft
    from app.services.drafting_service import auto_draft_top_gaps
    from sqlalchemy import select, func

    logger.info("Scheduler: starting auto-draft sweep")

    async with AsyncSessionLocal() as db:
        result = await db.execute(select(Brand))
        brands = result.scalars().all()

    now_utc = datetime.now(timezone.utc).replace(tzinfo=None)
    for brand in brands:
        # Skip pitch brands that have expired
        if brand.brand_type == "pitch" and brand.pitch_expires_at and brand.pitch_expires_at <= now_utc:
            logger.info(
                "Scheduler: skipping expired pitch brand %d (%s) in auto-draft sweep",
                brand.id, brand.name,
            )
            continue

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


async def _sqlite_backup_sweep() -> None:
    """
    Daily SQLite backup (02:00 UTC).
    Copies the .db file to backend/backups/ with a timestamp filename.
    Keeps the last 7 backups and deletes older ones automatically.
    """
    import shutil
    from datetime import datetime, timezone
    from pathlib import Path

    db_url = os.getenv("DATABASE_URL", "sqlite+aiosqlite:///./clarity_ai.db")
    if "sqlite" not in db_url:
        logger.info("Backup skipped — not a SQLite database")
        return

    # Extract file path from URL (sqlite+aiosqlite:///./clarity_ai.db → ./clarity_ai.db)
    db_path_str = db_url.split("///", 1)[-1]
    db_path = Path(db_path_str).resolve()

    if not db_path.exists():
        logger.warning("Backup skipped — database file not found: %s", db_path)
        return

    backup_dir = Path(__file__).resolve().parent.parent / "backups"
    backup_dir.mkdir(parents=True, exist_ok=True)

    timestamp = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
    backup_file = backup_dir / f"clarity_ai_{timestamp}.db"

    try:
        shutil.copy2(db_path, backup_file)
        logger.info("SQLite backup created: %s", backup_file)
    except Exception:
        logger.exception("SQLite backup failed — could not copy file")
        return

    # Prune: keep only the 7 most recent backups
    backups = sorted(backup_dir.glob("clarity_ai_*.db"), key=lambda p: p.stat().st_mtime, reverse=True)
    for old_backup in backups[7:]:
        try:
            old_backup.unlink()
            logger.info("Old backup removed: %s", old_backup)
        except Exception:
            logger.warning("Could not remove old backup %s", old_backup)


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
            drafts = await auto_draft_top_gaps(db=db, brand_id=brand_id, max_gaps=20, clear_existing=True)
        logger.info(
            "Scheduler: auto-draft created %d drafts for brand_id=%d (weekly refresh)",
            len(drafts), brand_id,
        )
    except Exception:
        logger.exception("Scheduler: auto-draft failed for brand_id=%d", brand_id)


async def _visibility_alert_sweep() -> None:
    """
    Daily threshold check (21:00 UTC — after evening tracking sweep).

    For each brand with at least 2 completed runs: compare the two most recent
    overall_score values. If the drop exceeds ALERT_DROP_PCT, email the brand
    owner. A brand is only alerted once per 7-day window to avoid spam.
    """
    ALERT_DROP_PCT = 15.0       # trigger when score drops ≥ 15 points
    ALERT_COOLDOWN_DAYS = 7     # don't re-alert within 7 days

    if await _is_scheduler_paused():
        logger.info("Scheduler paused — skipping visibility alert sweep")
        return

    from datetime import datetime, timedelta, timezone
    from app.database import AsyncSessionLocal
    from app.models import Brand, TrackingRun, User, SystemSetting
    from app.services.email_service import send_visibility_alert_email
    from sqlalchemy import select

    logger.info("Scheduler: starting visibility alert sweep")
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    cooldown_cutoff = now - timedelta(days=ALERT_COOLDOWN_DAYS)

    async with AsyncSessionLocal() as db:
        brands_result = await db.execute(select(Brand))
        brands = brands_result.scalars().all()

        for brand in brands:
            if brand.user_id is None:
                continue

            # Get two most recent completed runs
            runs_result = await db.execute(
                select(TrackingRun)
                .where(TrackingRun.brand_id == brand.id, TrackingRun.status == "completed",
                       TrackingRun.overall_score.isnot(None))
                .order_by(TrackingRun.completed_at.desc())
                .limit(2)
            )
            runs = runs_result.scalars().all()
            if len(runs) < 2:
                continue

            current_score = runs[0].overall_score
            previous_score = runs[1].overall_score
            drop = previous_score - current_score

            if drop < ALERT_DROP_PCT:
                continue

            # Check cooldown — look for a recent alert sentinel in SystemSetting
            alert_key = f"visibility_alert_sent_{brand.id}"
            sentinel_result = await db.execute(
                select(SystemSetting).where(SystemSetting.key == alert_key)
            )
            sentinel = sentinel_result.scalar_one_or_none()
            if sentinel:
                try:
                    last_sent = datetime.fromisoformat(sentinel.value)
                    if last_sent >= cooldown_cutoff:
                        continue
                except ValueError:
                    pass

            # Fetch owner
            user_result = await db.execute(select(User).where(User.id == brand.user_id))
            user = user_result.scalar_one_or_none()
            if not user:
                continue

            try:
                send_visibility_alert_email(
                    email=user.email,
                    name=user.name,
                    brand_name=brand.name,
                    current_score=current_score,
                    previous_score=previous_score,
                    drop_pct=drop,
                )
                logger.info(
                    "Visibility alert sent for brand %d (%s): %.1f%% → %.1f%%",
                    brand.id, brand.name, previous_score, current_score,
                )
            except Exception:
                logger.exception("Visibility alert email failed for brand %d", brand.id)
                continue

            # Update cooldown sentinel
            if sentinel:
                sentinel.value = now.isoformat()
            else:
                db.add(SystemSetting(key=alert_key, value=now.isoformat()))
            await db.commit()

    logger.info("Scheduler: visibility alert sweep complete")


async def _pitch_expiry_sweep() -> None:
    """
    Daily pitch-brand lifecycle job (06:00 UTC).

    Two passes:
      1. Warn — email users whose pitch brand expires within the next 24–25 hours
         (the 1-hour window prevents double-warnings on consecutive daily runs).
      2. Delete — remove pitch brands whose pitch_expires_at has passed, along
         with all child rows (prompts, tracking runs, drafts, content settings).
         SQLAlchemy cascade or ON DELETE CASCADE handles child cleanup.
    """
    from datetime import datetime, timedelta, timezone
    from app.database import AsyncSessionLocal
    from app.models import Brand, User
    from app.services.email_service import send_pitch_expiry_warning_email
    from sqlalchemy import select, delete

    if await _is_scheduler_paused():
        logger.info("Scheduler paused — skipping pitch expiry sweep")
        return

    logger.info("Scheduler: starting pitch expiry sweep")
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    warn_start = now + timedelta(hours=23)
    warn_end = now + timedelta(hours=25)

    async with AsyncSessionLocal() as db:
        # ── Pass 1: warn ──────────────────────────────────────────────────────
        result = await db.execute(
            select(Brand).where(
                Brand.brand_type == "pitch",
                Brand.pitch_expires_at >= warn_start,
                Brand.pitch_expires_at < warn_end,
            )
        )
        expiring_soon = result.scalars().all()

        for brand in expiring_soon:
            if brand.user_id is None:
                continue
            user_result = await db.execute(select(User).where(User.id == brand.user_id))
            user = user_result.scalar_one_or_none()
            if user is None:
                continue
            try:
                send_pitch_expiry_warning_email(
                    email=user.email,
                    name=user.name,
                    brand_name=brand.name,
                    expires_at=brand.pitch_expires_at,
                )
                logger.info(
                    "Pitch expiry warning sent for brand %d (%s) to %s",
                    brand.id, brand.name, user.email,
                )
            except Exception:
                logger.exception(
                    "Failed to send pitch expiry warning for brand %d", brand.id
                )

        # ── Pass 2: delete expired brands ─────────────────────────────────────
        expired_result = await db.execute(
            select(Brand).where(
                Brand.brand_type == "pitch",
                Brand.pitch_expires_at <= now,
            )
        )
        expired_brands = expired_result.scalars().all()

        for brand in expired_brands:
            logger.info(
                "Scheduler: deleting expired pitch brand %d (%s) — expired %s",
                brand.id, brand.name, brand.pitch_expires_at,
            )
            await db.delete(brand)

        if expired_brands:
            await db.commit()
            logger.info(
                "Scheduler: deleted %d expired pitch brand(s)", len(expired_brands)
            )
        else:
            logger.info("Scheduler: no expired pitch brands to delete")

    logger.info("Scheduler: pitch expiry sweep complete")


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

    scheduler.add_job(
        _sqlite_backup_sweep,
        trigger=CronTrigger(hour=2, minute=0, timezone="UTC"),
        id="sqlite_backup",
        name="Daily SQLite backup (02:00 UTC)",
        replace_existing=True,
        misfire_grace_time=600,
    )

    scheduler.add_job(
        _pitch_expiry_sweep,
        trigger=CronTrigger(hour=6, minute=0, timezone="UTC"),
        id="pitch_expiry",
        name="Pitch brand expiry warnings & cleanup (06:00 UTC)",
        replace_existing=True,
        misfire_grace_time=600,
    )

    scheduler.add_job(
        _visibility_alert_sweep,
        trigger=CronTrigger(hour=21, minute=0, timezone="UTC"),
        id="visibility_alerts",
        name="Visibility drop alerts (21:00 UTC)",
        replace_existing=True,
        misfire_grace_time=600,
    )

    scheduler.start()
    logger.info("Scheduler started. Jobs: %s", [j.id for j in scheduler.get_jobs()])


def stop_scheduler() -> None:
    """Gracefully shut down the scheduler. Called from FastAPI lifespan."""
    if scheduler.running:
        scheduler.shutdown(wait=False)
        logger.info("Scheduler stopped.")
