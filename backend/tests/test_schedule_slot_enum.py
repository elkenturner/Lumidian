"""
Regression test for the production admin-page crash.

The agency weekly sweep (scheduler.py:_run_agency_brand_and_report) writes
TrackingRun rows with schedule_slot="weekly".  SQLAlchemy's Enum does not
validate strings on write (validate_strings defaults to False), so the value
is stored fine — but every *read* coerces the column back into ScheduleSlotEnum
and raises LookupError when "weekly" is not a defined member.  That 500s
GET /api/admin/runs and breaks the admin page in production.
"""
from __future__ import annotations

from datetime import UTC, datetime

import pytest
from sqlalchemy import select

from app.database import AsyncSessionLocal
from app.models import Brand, TrackingRun, User

pytestmark = pytest.mark.asyncio


async def test_weekly_schedule_slot_run_is_readable():
    """A TrackingRun written with schedule_slot='weekly' must be readable
    back through the ORM (mirrors the agency weekly sweep + admin runs query)."""
    async with AsyncSessionLocal() as db:
        user = User(email="agency@test.com", password_hash="x", name="Agency")
        db.add(user)
        await db.flush()

        brand = Brand(name="Agency Brand", slug="agency-brand", user_id=user.id)
        db.add(brand)
        await db.flush()

        run = TrackingRun(
            brand_id=brand.id,
            status="completed",
            run_type="scheduled",
            schedule_slot="weekly",
            created_at=datetime.now(UTC).replace(tzinfo=None),
        )
        db.add(run)
        await db.commit()
        run_id = run.id

    # Fresh session forces the read-side enum coercion that crashes in prod.
    async with AsyncSessionLocal() as db:
        result = await db.execute(select(TrackingRun).where(TrackingRun.id == run_id))
        loaded = result.scalar_one()
        assert loaded.schedule_slot == "weekly"
