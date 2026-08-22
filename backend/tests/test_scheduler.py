"""Tests for scheduler backup integrity check and stale-run cleanup tick."""
import shutil
import sqlite3
from datetime import UTC, datetime, timedelta
from pathlib import Path

import pytest


def test_backup_integrity_check_passes_on_valid_db(tmp_path: Path):
    """A valid copied SQLite file passes PRAGMA integrity_check."""
    # Create a minimal SQLite DB
    src = tmp_path / "test.db"
    conn = sqlite3.connect(str(src))
    conn.execute("CREATE TABLE t (id INTEGER PRIMARY KEY)")
    conn.commit()
    conn.close()

    # Copy it (simulating the backup)
    backup = tmp_path / "test_backup.db"
    shutil.copy2(str(src), str(backup))

    # Run integrity check
    conn = sqlite3.connect(str(backup))
    result = conn.execute("PRAGMA integrity_check").fetchone()
    conn.close()
    assert result[0] == "ok"


def test_backup_integrity_check_detects_corruption(tmp_path: Path):
    """A corrupted file fails PRAGMA integrity_check."""
    # Create a valid DB
    src = tmp_path / "test.db"
    conn = sqlite3.connect(str(src))
    conn.execute("CREATE TABLE t (id INTEGER PRIMARY KEY)")
    conn.commit()
    conn.close()

    # Copy it, then corrupt it
    backup = tmp_path / "corrupt_backup.db"
    shutil.copy2(str(src), str(backup))
    # Overwrite middle of the file with garbage
    with open(str(backup), "r+b") as f:
        f.seek(100)
        f.write(b"\x00" * 200)

    # A corrupted DB either raises an exception or returns a non-"ok" result —
    # both are valid failure modes that the integrity check detects.
    try:
        conn = sqlite3.connect(str(backup))
        result = conn.execute("PRAGMA integrity_check").fetchone()
        conn.close()
        assert result is not None and result[0] != "ok"
    except sqlite3.DatabaseError:
        pass  # Exception is also an acceptable signal of corruption


@pytest.mark.asyncio
async def test_stale_run_cleanup_tick_fails_stale_runs():
    """The scheduler tick (not the polled endpoint) auto-fails stale runs.

    This moves the write off the GET /tracking/background-status read path,
    which was contending with content-generation sweeps for SQLite's single
    writer during the 2026-07-04 incident.
    """
    from app.database import AsyncSessionLocal
    from app.models import Brand, TrackingRun, User
    from app.scheduler import _stale_run_cleanup_tick

    async with AsyncSessionLocal() as db:
        user = User(email="stale_run_tick@example.com", password_hash="x", name="t")
        db.add(user)
        await db.flush()
        brand = Brand(user_id=user.id, name="Stale Tick Brand", slug="stale-tick-brand")
        db.add(brand)
        await db.flush()
        run = TrackingRun(
            brand_id=brand.id,
            status="running",
            run_type="manual",
            created_at=datetime.now(UTC).replace(tzinfo=None) - timedelta(hours=6),
        )
        db.add(run)
        await db.commit()
        run_id = run.id

    await _stale_run_cleanup_tick()

    async with AsyncSessionLocal() as db:
        refreshed = await db.get(TrackingRun, run_id)
        assert refreshed.status == "failed"


@pytest.mark.asyncio
async def test_stale_run_cleanup_tick_leaves_fresh_runs_alone():
    """A recently-created running run is left untouched by the tick."""
    from app.database import AsyncSessionLocal
    from app.models import Brand, TrackingRun, User
    from app.scheduler import _stale_run_cleanup_tick

    async with AsyncSessionLocal() as db:
        user = User(email="fresh_run_tick@example.com", password_hash="x", name="t")
        db.add(user)
        await db.flush()
        brand = Brand(user_id=user.id, name="Fresh Tick Brand", slug="fresh-tick-brand")
        db.add(brand)
        await db.flush()
        run = TrackingRun(brand_id=brand.id, status="running", run_type="manual")
        db.add(run)
        await db.commit()
        run_id = run.id

    await _stale_run_cleanup_tick()

    async with AsyncSessionLocal() as db:
        refreshed = await db.get(TrackingRun, run_id)
        assert refreshed.status == "running"


def test_morning_sweep_runs_weekly_on_monday(monkeypatch):
    """Scheduled tracking is weekly — Monday 08:00 UTC, not daily.

    Pro-only tiering spec (2026-07-29) §3: daily runs mostly re-measure
    unchanged visibility and burn API budget; manual runs cover on-demand needs.

    Captures triggers at registration instead of starting the module-level
    scheduler — AsyncIOScheduler binds the first event loop it starts on, so a
    real start/stop here breaks any later test that starts the scheduler again.
    """
    from app import scheduler as sched_mod

    triggers = {}
    monkeypatch.setattr(
        sched_mod.scheduler, "add_job",
        lambda func, trigger=None, **kw: triggers.__setitem__(kw.get("id"), trigger),
    )
    monkeypatch.setattr(sched_mod.scheduler, "start", lambda: None)

    sched_mod.start_scheduler()

    fields = {f.name: str(f) for f in triggers["morning_sweep"].fields}
    assert fields["day_of_week"] == "mon"
    assert fields["hour"] == "8"
    assert fields["minute"] == "0"


@pytest.mark.asyncio
async def test_tracking_paused_brand_is_skipped_by_sweeps():
    """A brand with tracking_paused=True is excluded from scheduled sweeps.

    Prospect trial brands must never trigger automated owner emails; the
    scheduled-run path is the only one that sends them (manual runs don't),
    so excluding the brand from sweeps is sufficient.
    """
    from app.database import AsyncSessionLocal
    from app.models import Brand, User
    from app.scheduler import _is_brand_paused

    async with AsyncSessionLocal() as db:
        user = User(email="sweep_paused@example.com", password_hash="x", name="t")
        db.add(user)
        await db.flush()
        paused = Brand(
            user_id=user.id, name="Sweep Paused Brand", slug="sweep-paused-brand",
            tracking_paused=True,
        )
        normal = Brand(
            user_id=user.id, name="Sweep Normal Brand", slug="sweep-normal-brand",
        )
        db.add_all([paused, normal])
        await db.commit()

        assert _is_brand_paused(paused, set()) is True
        # Default is False — ordinary brands keep their scheduled runs
        assert normal.tracking_paused is False
        assert _is_brand_paused(normal, set()) is False
