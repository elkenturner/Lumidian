"""Tests for pitch brand manual action limits."""
from datetime import UTC, datetime, timedelta
from unittest.mock import patch

import httpx
import pytest

from app.database import AsyncSessionLocal
from app.models import Brand, TrackingRun
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


async def _create_pitch_brand_orm(user_id: int, name: str) -> int:
    """Insert a pitch brand via ORM (bypasses tier checks). Returns brand_id."""
    import secrets
    from app.models import Prompt
    async with AsyncSessionLocal() as db:
        brand = Brand(
            name=name, slug=f"{name.lower().replace(' ', '-')}-{secrets.token_hex(4)}",
            user_id=user_id, tier="basic", brand_type="pitch", prompt_limit=10,
        )
        db.add(brand)
        await db.flush()
        db.add(Prompt(brand_id=brand.id, text="test prompt", prompt_type="pitch"))
        await db.commit()
        return brand.id


async def _get_user_id(email: str) -> int:
    from sqlalchemy import text
    async with AsyncSessionLocal() as db:
        row = await db.execute(text("SELECT id FROM users WHERE email = :e"), {"e": email})
        return row.scalar_one()


# ── Daily run limits (pitch brands are free-tier only) ───────────────────────

async def test_pitch_brand_daily_run_limit(client: httpx.AsyncClient):
    """Pitch brand should be limited to 1 manual run per day."""
    await register_and_login(client, "pitchrun@test.com", "Password123", subscription_tier=None)

    brand_resp = await client.post(
        "/api/brands",
        json={"name": "PitchRunLimit", **_PITCH_BRAND},
    )
    assert brand_resp.status_code == 201, brand_resp.text
    brand_id = brand_resp.json()["id"]

    # Seed a completed manual run from today to simulate first run already used
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
    await register_and_login(client, "pitchrunfirst@test.com", "Password123", subscription_tier=None)

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
    await register_and_login(client, "pitchrunyest@test.com", "Password123", subscription_tier=None)

    brand_resp = await client.post(
        "/api/brands",
        json={"name": "PitchRunYest", **_PITCH_BRAND},
    )
    assert brand_resp.status_code == 201, brand_resp.text
    brand_id = brand_resp.json()["id"]

    # Seed a completed manual run from yesterday (outside today's window)
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
    await register_and_login(client, "standardrun@test.com", "Password123")

    brand_resp = await client.post(
        "/api/brands",
        json={"name": "StandardRunBrand", **_STANDARD_BRAND},
    )
    assert brand_resp.status_code == 201, brand_resp.text
    brand_id = brand_resp.json()["id"]

    # Seed today's run — standard brands have no per-brand daily limit beyond the tier limit
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


# ── Weekly scan limits (pitch brands inserted via ORM for paid users) ────────
# Paid users can't create pitch brands via API, but existing ones may still
# exist transiently before the startup migration converts them.

async def test_pitch_brand_weekly_scan_limit(client: httpx.AsyncClient):
    """Pitch brand should be limited to 1 manual scan per week."""
    await register_and_login(client, "pitchscan@test.com", "Password123", subscription_tier="starter")
    uid = await _get_user_id("pitchscan@test.com")
    brand_id = await _create_pitch_brand_orm(uid, "PitchScanLimit")

    # Seed a scan event from this week to simulate first scan already used
    import json

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
    await register_and_login(client, "pitchscanfirst@test.com", "Password123", subscription_tier="starter")
    uid = await _get_user_id("pitchscanfirst@test.com")
    brand_id = await _create_pitch_brand_orm(uid, "PitchScanFirst")

    # First scan of the week should succeed
    with patch("app.routers.opportunities._scan_and_log"):
        scan_resp = await client.post(f"/api/opportunities/{brand_id}/scan")
    assert scan_resp.status_code == 202, scan_resp.text


async def test_pitch_brand_old_scan_does_not_block(client: httpx.AsyncClient):
    """A scan from more than 7 days ago should not block this week's scan."""
    await register_and_login(client, "pitchscanold@test.com", "Password123", subscription_tier="starter")
    uid = await _get_user_id("pitchscanold@test.com")
    brand_id = await _create_pitch_brand_orm(uid, "PitchScanOld")

    # Seed a scan from 8 days ago (outside the rolling window)
    import json

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
