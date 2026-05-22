"""
APScheduler-based scheduler for Lumidian.

Jobs:
  • 02:00 UTC        — SQLite backup (daily)
  • 04:00 UTC, day 1 — Monthly website context refresh via Jina Reader
  • 06:00 UTC        — Pitch brand expiry: warn users 24 h before expiry, delete expired brands
  • 08:00 UTC        — Morning tracking sweep (once daily)
  • 21:00 UTC        — Visibility drop alerts (email if score drops ≥ 15 pts vs previous run)

Pitch brand lifecycle:
  - Created with pitch_expires_at = now + 30 days
  - At 06:00 UTC daily: users whose pitch brand expires in 23–25 h receive a warning email
  - At 06:00 UTC daily: brands whose pitch_expires_at <= now are deleted (cascade removes prompts,
    tracking runs, drafts, and content settings)
  - Morning/evening tracking sweeps and auto-draft sweeps skip expired pitch brands
"""

import asyncio
import logging
import os
from datetime import UTC

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.cron import CronTrigger
from apscheduler.triggers.interval import IntervalTrigger

logger = logging.getLogger(__name__)

scheduler = AsyncIOScheduler(timezone="UTC")

# Limit concurrent scheduled tracking runs to avoid overwhelming LLM APIs
_MAX_CONCURRENT_RUNS = 5
_run_semaphore = asyncio.Semaphore(_MAX_CONCURRENT_RUNS)


async def _get_paused_user_ids() -> set[int]:
    """Fetch all paused user IDs in a single query (avoids N+1 per brand)."""
    from sqlalchemy import select

    from app.database import AsyncSessionLocal
    from app.models import User

    async with AsyncSessionLocal() as db:
        result = await db.execute(select(User.id).where(User.is_paused == True))
        return set(result.scalars().all())


def _is_brand_paused(brand, paused_user_ids: set[int]) -> bool:
    """Check if a brand should be skipped in scheduled sweeps.

    Skips if:
      - Pitch brand has expired
      - Brand is orphaned (user_id IS NULL) — defense-in-depth against any
        user-deletion path that forgets to cascade; otherwise the scheduler
        would burn LLM quota on brands no one can ever see
      - Brand owner has is_paused=True (admin-paused account)
    """
    from datetime import datetime

    now = datetime.now(UTC).replace(tzinfo=None)

    # Skip expired pitch brands
    if brand.brand_type == "pitch" and brand.pitch_expires_at and brand.pitch_expires_at <= now:
        return True

    # Skip orphaned brands (no owner)
    if brand.user_id is None:
        return True

    # Skip brands whose owner is paused
    if brand.user_id in paused_user_ids:
        return True

    return False


async def _is_scheduler_paused() -> bool:
    """Return True if the scheduler has been paused via the settings API."""
    from sqlalchemy import select

    from app.database import AsyncSessionLocal
    from app.models import SystemSetting
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

    from sqlalchemy import select

    from app.database import AsyncSessionLocal, cleanup_stale_runs
    from app.models import Brand

    logger.info("Scheduler: starting %s sweep", schedule_slot)

    # Clean up any runs stuck from previous sweeps before starting new ones
    await cleanup_stale_runs()

    async with AsyncSessionLocal() as db:
        result = await db.execute(select(Brand))
        brands = result.scalars().all()

    if not brands:
        logger.info("Scheduler: no brands found, skipping %s sweep", schedule_slot)
        return

    paused_user_ids = await _get_paused_user_ids()

    for brand in brands:
        if brand.brand_type == "agency":
            continue  # agency brands have their own weekly sweep

        # Skip paused brands
        if _is_brand_paused(brand, paused_user_ids):
            logger.info(
                "Scheduler: skipping paused brand %d (%s) [%s]",
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

    async with _run_semaphore:
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


async def _run_agency_brand_and_report(brand_id: int, client_id: int) -> None:
    """Run weekly tracking for an agency brand, then auto-generate the weekly report. Non-fatal."""
    await _safe_run(brand_id, "weekly")
    try:
        from app.database import AsyncSessionLocal
        from app.models import AgencyClient
        from app.services.document_engine import generate_document, get_template

        template = get_template("agency_weekly_report")
        if template is None:
            return
        async with AsyncSessionLocal() as db:
            client = await db.get(AgencyClient, client_id)
            if client is None:
                return
            await generate_document(db, client=client, template=template, actor_user_id=None)
    except Exception as e:
        logger.error("Weekly agency report generation failed for brand %d: %s", brand_id, e)


async def _run_all_agency_brands() -> None:
    """Fetch agency-tier brands and trigger a tracking run for each. Runs weekly."""
    if await _is_scheduler_paused():
        logger.info("Scheduler paused — skipping weekly agency sweep")
        return

    from sqlalchemy import select
    from app.database import AsyncSessionLocal, cleanup_stale_runs
    from app.models import AgencyClient, Brand

    logger.info("Scheduler: starting weekly agency sweep")
    await cleanup_stale_runs()

    async with AsyncSessionLocal() as db:
        rows = await db.execute(
            select(Brand).join(
                AgencyClient, AgencyClient.id == Brand.agency_client_id
            ).where(
                Brand.brand_type == "agency",
                AgencyClient.status.in_(("onboarding", "active")),
            )
        )
        brands = rows.scalars().all()

    if not brands:
        logger.info("Scheduler: no agency brands, skipping weekly sweep")
        return

    for brand in brands:
        logger.info("Scheduler: queuing weekly tracking+report for agency brand %d (%s)", brand.id, brand.name)
        asyncio.create_task(
            _run_agency_brand_and_report(brand.id, brand.agency_client_id),
            name=f"tracking-agency-{brand.id}",
        )


async def _sqlite_backup_sweep() -> None:
    """
    Daily SQLite backup (02:00 UTC).
    Uses VACUUM INTO for a consistent snapshot safe during concurrent writes.
    Keeps the last 7 backups and deletes older ones automatically.
    """
    from datetime import datetime
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

    # Store backups alongside the DB (on the persistent volume in production)
    backup_dir = db_path.parent / "backups"
    backup_dir.mkdir(parents=True, exist_ok=True)

    timestamp = datetime.now(UTC).strftime("%Y%m%d_%H%M%S")
    backup_file = backup_dir / f"clarity_ai_{timestamp}.db"

    # Use VACUUM INTO for a consistent backup (safe during concurrent writes)
    import sqlite3 as _sqlite3
    try:
        conn = _sqlite3.connect(str(db_path))
        conn.execute(f"VACUUM INTO '{backup_file}'")
        conn.close()
        logger.info("SQLite backup created (VACUUM INTO): %s", backup_file)
    except Exception:
        logger.exception("SQLite backup failed")
        return

    # Prune: keep only the 7 most recent backups
    backups = sorted(backup_dir.glob("clarity_ai_*.db"), key=lambda p: p.stat().st_mtime, reverse=True)
    for old_backup in backups[7:]:
        try:
            old_backup.unlink()
            logger.info("Old backup removed: %s", old_backup)
        except Exception:
            logger.warning("Could not remove old backup %s", old_backup)

    # Clean up expired/used password reset tokens
    try:
        from sqlalchemy import delete

        from app.database import AsyncSessionLocal
        from app.models import PasswordResetToken

        now = datetime.now(UTC).replace(tzinfo=None)
        async with AsyncSessionLocal() as db:
            result = await db.execute(
                delete(PasswordResetToken).where(
                    (PasswordResetToken.used == True) | (PasswordResetToken.expires_at < now)  # noqa: E712
                )
            )
            await db.commit()
            if result.rowcount:
                logger.info("Cleaned up %d expired/used password reset tokens", result.rowcount)
    except Exception:
        logger.exception("Password reset token cleanup failed (non-fatal)")

    # Clean up old read notifications (older than 30 days)
    try:
        from sqlalchemy import delete as sa_delete
        from datetime import timedelta

        from app.database import AsyncSessionLocal
        from app.models import Notification

        cutoff = datetime.now(UTC).replace(tzinfo=None) - timedelta(days=30)
        async with AsyncSessionLocal() as db:
            result = await db.execute(
                sa_delete(Notification).where(
                    Notification.read == True,  # noqa: E712
                    Notification.created_at < cutoff,
                )
            )
            await db.commit()
            if result.rowcount:
                logger.info("Cleaned up %d old read notifications", result.rowcount)
    except Exception:
        logger.exception("Notification cleanup failed (non-fatal)")


async def _website_context_refresh_sweep() -> None:
    """
    Monthly website context refresh (04:00 UTC, day 1 of month).
    Fetches fresh Jina Reader content for every brand that has a website_url.
    """
    if await _is_scheduler_paused():
        logger.info("Scheduler paused — skipping website context refresh sweep")
        return

    from sqlalchemy import select

    from app.database import AsyncSessionLocal
    from app.models import Brand
    from app.services.jina_service import refresh_brand_website_context

    logger.info("Scheduler: starting monthly website context refresh sweep")

    async with AsyncSessionLocal() as db:
        result = await db.execute(select(Brand).where(Brand.website_url.isnot(None)))
        brands = result.scalars().all()

    paused_user_ids = await _get_paused_user_ids()

    for brand in brands:
        if _is_brand_paused(brand, paused_user_ids):
            logger.info("Scheduler: skipping paused brand %d in website context refresh", brand.id)
            continue
        try:
            ok = await refresh_brand_website_context(brand.id)
            if ok:
                logger.info("Website context refreshed for brand %d (%s)", brand.id, brand.name)
        except Exception:
            logger.exception("Website context refresh failed for brand %d", brand.id)

    logger.info("Scheduler: website context refresh sweep complete")


async def _visibility_alert_sweep() -> None:
    """
    Daily threshold check (21:00 UTC — after evening tracking sweep).

    For each brand with at least 2 completed runs: compare the two most recent
    overall_score values. If the drop exceeds ALERT_DROP_PCT, email the brand
    owner. A brand is only alerted once per 7-day window to avoid spam.
    """
    ALERT_DROP_PCT = 15.0       # trigger when score drops ≥ 15 points (raised 2026-04-20 to compensate for finer 3-run granularity)
    ALERT_COOLDOWN_DAYS = 7     # don't re-alert within 7 days

    if await _is_scheduler_paused():
        logger.info("Scheduler paused — skipping visibility alert sweep")
        return

    from datetime import datetime, timedelta

    from sqlalchemy import select

    from app.database import AsyncSessionLocal
    from app.models import Brand, SystemSetting, TrackingRun, User
    from app.services.email_service import send_visibility_alert_email

    logger.info("Scheduler: starting visibility alert sweep")
    now = datetime.now(UTC).replace(tzinfo=None)
    cooldown_cutoff = now - timedelta(days=ALERT_COOLDOWN_DAYS)

    paused_user_ids = await _get_paused_user_ids()

    async with AsyncSessionLocal() as db:
        brands_result = await db.execute(select(Brand))
        brands = brands_result.scalars().all()

        for brand in brands:
            if _is_brand_paused(brand, paused_user_ids):
                continue  # No need to log - this is a silent skip for alert processing

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

            # Skip unverified emails — don't send alerts to addresses the user hasn't confirmed
            if not getattr(user, "email_verified", True):
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
    from datetime import datetime, timedelta

    from sqlalchemy import select

    from app.database import AsyncSessionLocal
    from app.models import Brand, User
    from app.services.email_service import send_pitch_expiry_warning_email

    if await _is_scheduler_paused():
        logger.info("Scheduler paused — skipping pitch expiry sweep")
        return

    logger.info("Scheduler: starting pitch expiry sweep")
    now = datetime.now(UTC).replace(tzinfo=None)
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
            # Skip unverified emails — don't send alerts to addresses the user hasn't confirmed
            if not getattr(user, "email_verified", True):
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

    # Prospect audits — 60-day retention
    try:
        await cleanup_stale_prospect_audits()
    except Exception:
        logger.exception("prospect-audit cleanup failed inside daily sweep")

    logger.info("Scheduler: pitch expiry sweep complete")


async def cleanup_stale_prospect_audits(retention_days: int = 60) -> int:
    """Delete ProspectAudit rows older than `retention_days`. Returns delete count.

    Silently logs and continues on missing PDF files."""
    from datetime import datetime, timedelta
    from pathlib import Path

    from sqlalchemy import select

    from app.database import AsyncSessionLocal
    from app.models import ProspectAudit

    cutoff = datetime.utcnow() - timedelta(days=retention_days)
    deleted = 0
    async with AsyncSessionLocal() as db:
        result = await db.execute(select(ProspectAudit).where(ProspectAudit.created_at < cutoff))
        stale = result.scalars().all()
        for a in stale:
            if a.pdf_path:
                try:
                    Path(a.pdf_path).unlink(missing_ok=True)
                except Exception as exc:
                    logger.warning("prospect-audit cleanup: failed to remove PDF %s: %s", a.pdf_path, exc)
            await db.delete(a)
            deleted += 1
        if deleted:
            await db.commit()
            logger.info("Scheduler: cleaned up %d stale prospect audits (>%d days old)", deleted, retention_days)
    return deleted


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

    scheduler.add_job(
        _run_all_agency_brands,
        trigger=CronTrigger(day_of_week="sun", hour=2, minute=0, timezone="UTC"),
        id="weekly_agency_sweep",
        name="Weekly agency tracking sweep (Sunday 02:00 UTC)",
        replace_existing=True,
        misfire_grace_time=3600,
    )

    async def _stale_cluster_cleanup_tick() -> None:
        from app.database import AsyncSessionLocal
        from app.services.cluster_cleanup import auto_fail_stale_clusters
        async with AsyncSessionLocal() as db:
            try:
                await auto_fail_stale_clusters(db, max_age_minutes=15)
            except Exception as exc:
                logger.warning("cluster stale cleanup failed: %s", exc)

    scheduler.add_job(
        _stale_cluster_cleanup_tick,
        trigger=IntervalTrigger(minutes=5),
        id="cluster_stale_cleanup",
        name="Auto-fail stuck content clusters (every 5 min)",
        replace_existing=True,
        misfire_grace_time=300,
    )

    scheduler.start()
    logger.info("Scheduler started. Jobs: %s", [j.id for j in scheduler.get_jobs()])


def stop_scheduler() -> None:
    """Gracefully shut down the scheduler. Called from FastAPI lifespan."""
    if scheduler.running:
        scheduler.shutdown(wait=False)
        logger.info("Scheduler stopped.")
