"""Tests for pitch brand manual action limits."""
from datetime import UTC, datetime, timedelta
from unittest.mock import patch

import httpx
import pytest

from tests.conftest import register_and_login

pytestmark = pytest.mark.asyncio

_PITCH_BRAND = {
    "tier": "basic",
    "brand_type": "pitch",
    "website_url": "https://example.com",
    "prompts": ["test prompt"],
}

_STANDARD_BRAND = {
    "tier": "basic",
    "website_url": "https://example.com",
    "prompts": ["test prompt"],
}


async def test_pitch_brand_daily_run_limit(client: httpx.AsyncClient):
    """Pitch brand should be limited to 1 manual run per day."""
    await register_and_login(client, "pitchrun@test.com", "password123")

    brand_resp = await client.post(
        "/api/brands",
        json={"name": "PitchRunLimit", **_PITCH_BRAND},
    )
    assert brand_resp.status_code == 201, brand_resp.text
    brand_id = brand_resp.json()["id"]

    # Seed a completed manual run from today to simulate first run already used
    from app.database import AsyncSessionLocal
    from app.models import TrackingRun
    async with AsyncSessionLocal() as db:
        today_run = TrackingRun(
            brand_id=brand_id,
            status="completed",
            run_type="manual",
            created_at=datetime.now(UTC).replace(tzinfo=None),
            completed_at=datetime.now(UTC).replace(tzinfo=None),
        )
        db.add(today_run)
        await db.commit()

    # Second manual run today should be blocked with 429
    with patch("app.routers.tracking._background_run_with_id"):
        run_resp = await client.post(f"/api/tracking/run/{brand_id}")
    assert run_resp.status_code == 429, run_resp.text
    assert "1" in run_resp.json()["detail"]  # mentions the limit of 1


async def test_pitch_brand_daily_run_limit_first_run_allowed(client: httpx.AsyncClient):
    """Pitch brand should allow the first manual run of the day."""
    await register_and_login(client, "pitchrunfirst@test.com", "password123")

    brand_resp = await client.post(
        "/api/brands",
        json={"name": "PitchRunFirst", **_PITCH_BRAND},
    )
    assert brand_resp.status_code == 201, brand_resp.text
    brand_id = brand_resp.json()["id"]

    # First run of the day should succeed
    with patch("app.routers.tracking._background_run_with_id"):
        run_resp = await client.post(f"/api/tracking/run/{brand_id}")
    assert run_resp.status_code == 202, run_resp.text


async def test_pitch_brand_yesterday_run_does_not_block(client: httpx.AsyncClient):
    """A manual run from yesterday should not block today's run for a pitch brand."""
    await register_and_login(client, "pitchrunyest@test.com", "password123")

    brand_resp = await client.post(
        "/api/brands",
        json={"name": "PitchRunYest", **_PITCH_BRAND},
    )
    assert brand_resp.status_code == 201, brand_resp.text
    brand_id = brand_resp.json()["id"]

    # Seed a completed manual run from yesterday (outside today's window)
    from app.database import AsyncSessionLocal
    from app.models import TrackingRun
    async with AsyncSessionLocal() as db:
        yesterday = datetime.now(UTC).replace(tzinfo=None) - timedelta(days=1)
        old_run = TrackingRun(
            brand_id=brand_id,
            status="completed",
            run_type="manual",
            created_at=yesterday,
            completed_at=yesterday,
        )
        db.add(old_run)
        await db.commit()

    # Run today should still be allowed
    with patch("app.routers.tracking._background_run_with_id"):
        run_resp = await client.post(f"/api/tracking/run/{brand_id}")
    assert run_resp.status_code == 202, run_resp.text


async def test_standard_brand_not_affected_by_pitch_limit(client: httpx.AsyncClient):
    """A standard brand should not be subject to the pitch brand 1/day per-brand limit."""
    await register_and_login(client, "standardrun@test.com", "password123")

    brand_resp = await client.post(
        "/api/brands",
        json={"name": "StandardRunBrand", **_STANDARD_BRAND},
    )
    assert brand_resp.status_code == 201, brand_resp.text
    brand_id = brand_resp.json()["id"]

    # Seed today's run — standard brands have no per-brand daily limit beyond the tier limit
    from app.database import AsyncSessionLocal
    from app.models import TrackingRun
    async with AsyncSessionLocal() as db:
        today_run = TrackingRun(
            brand_id=brand_id,
            status="completed",
            run_type="manual",
            created_at=datetime.now(UTC).replace(tzinfo=None),
            completed_at=datetime.now(UTC).replace(tzinfo=None),
        )
        db.add(today_run)
        await db.commit()

    # Starter has 3 runs/day — seeding 1 run should leave 2 remaining
    with patch("app.routers.tracking._background_run_with_id"):
        run_resp = await client.post(f"/api/tracking/run/{brand_id}")
    assert run_resp.status_code == 202, run_resp.text


async def test_pitch_brand_weekly_scan_limit(client: httpx.AsyncClient):
    """Pitch brand should be limited to 1 manual scan per week."""
    await register_and_login(client, "pitchscan@test.com", "password123", subscription_tier="starter")

    brand_resp = await client.post(
        "/api/brands",
        json={"name": "PitchScanLimit", **_PITCH_BRAND},
    )
    assert brand_resp.status_code == 201, brand_resp.text
    brand_id = brand_resp.json()["id"]

    # Seed a scan event from this week to simulate first scan already used
    import json

    from app.database import AsyncSessionLocal
    from app.models import AnalyticsEvent
    async with AsyncSessionLocal() as db:
        scan_event = AnalyticsEvent(
            event_type="manual_scan_triggered",
            brand_id=brand_id,
            data=json.dumps({"brand_id": brand_id}),
            created_at=datetime.now(UTC).replace(tzinfo=None),
        )
        db.add(scan_event)
        await db.commit()

    # Second scan this week should be blocked with 429
    scan_resp = await client.post(f"/api/opportunities/{brand_id}/scan")
    assert scan_resp.status_code == 429, scan_resp.text
    assert "1" in scan_resp.json()["detail"]  # mentions the limit of 1


async def test_pitch_brand_weekly_scan_limit_first_scan_allowed(client: httpx.AsyncClient):
    """Pitch brand should allow the first manual scan of the week."""
    await register_and_login(client, "pitchscanfirst@test.com", "password123", subscription_tier="starter")

    brand_resp = await client.post(
        "/api/brands",
        json={"name": "PitchScanFirst", **_PITCH_BRAND},
    )
    assert brand_resp.status_code == 201, brand_resp.text
    brand_id = brand_resp.json()["id"]

    # First scan of the week should succeed
    with patch("app.routers.opportunities._scan_and_log"):
        scan_resp = await client.post(f"/api/opportunities/{brand_id}/scan")
    assert scan_resp.status_code == 202, scan_resp.text


async def test_pitch_brand_old_scan_does_not_block(client: httpx.AsyncClient):
    """A scan from more than 7 days ago should not block this week's scan."""
    await register_and_login(client, "pitchscanold@test.com", "password123", subscription_tier="starter")

    brand_resp = await client.post(
        "/api/brands",
        json={"name": "PitchScanOld", **_PITCH_BRAND},
    )
    assert brand_resp.status_code == 201, brand_resp.text
    brand_id = brand_resp.json()["id"]

    # Seed a scan from 8 days ago (outside the rolling window)
    import json

    from app.database import AsyncSessionLocal
    from app.models import AnalyticsEvent
    async with AsyncSessionLocal() as db:
        old_event = AnalyticsEvent(
            event_type="manual_scan_triggered",
            brand_id=brand_id,
            data=json.dumps({"brand_id": brand_id}),
            created_at=datetime.now(UTC).replace(tzinfo=None) - timedelta(days=8),
        )
        db.add(old_event)
        await db.commit()

    # Scan this week should be allowed
    with patch("app.routers.opportunities._scan_and_log"):
        scan_resp = await client.post(f"/api/opportunities/{brand_id}/scan")
    assert scan_resp.status_code == 202, scan_resp.text
