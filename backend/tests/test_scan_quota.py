"""
Tests for manual opp scan weekly quota enforcement.

Rules:
  - Free users (subscription_tier=None): 0 manual scans — blocked with 402
  - Starter users: 10 manual scans/week — blocked with 429 once limit reached
  - Pro users: 25 manual scans/week — blocked with 429 once limit reached
  - Admin users: always allowed regardless of tier
  - Weekly counter is per-brand (brand_id + event_type + created_at)
"""
from datetime import UTC
from unittest.mock import AsyncMock, patch

import httpx
import pytest

from tests.conftest import create_brand, register_and_login

pytestmark = pytest.mark.asyncio


async def test_free_user_cannot_trigger_manual_scan(client: httpx.AsyncClient):
    """Free users (no subscription tier) get a 402 on manual scan."""
    await register_and_login(client, email="scan_free@example.com", subscription_tier=None)

    # Free users can't create standard brands via the API (brand limit = 0).
    # Insert directly so we can test the scan quota check independently.
    from sqlalchemy import select as _select

    from app.database import AsyncSessionLocal
    from app.models import Brand, User

    async with AsyncSessionLocal() as db:
        result = await db.execute(_select(User).where(User.email == "scan_free@example.com"))
        user = result.scalar_one()
        brand = Brand(name="Free Scan Brand", slug="free-scan-brand", user_id=user.id)
        db.add(brand)
        await db.commit()
        await db.refresh(brand)
        brand_id = brand.id

    resp = await client.post(f"/api/opportunities/{brand_id}/scan")
    assert resp.status_code == 402, resp.text
    assert "not available" in resp.json()["detail"].lower()


async def test_starter_user_can_trigger_scan_under_limit(client: httpx.AsyncClient):
    """Starter users can trigger a scan when under their weekly limit."""
    await register_and_login(client, email="scan_starter@example.com", subscription_tier="starter")
    brand = await create_brand(client, name="Starter Scan Brand")

    with patch("app.services.reddit_scanner_service.scan_brand_opportunities", new_callable=AsyncMock), \
         patch("app.services.quora_scanner_service.scan_brand_opportunities", new_callable=AsyncMock):
        resp = await client.post(f"/api/opportunities/{brand['id']}/scan")
    assert resp.status_code == 202, resp.text


async def test_starter_user_blocked_at_weekly_limit(client: httpx.AsyncClient):
    """Starter users are blocked with 429 once they have 10 scan events this week."""
    await register_and_login(client, email="scan_limit@example.com", subscription_tier="starter")
    brand = await create_brand(client, name="Limit Brand")

    # Seed 10 manual_scan_triggered analytics events for this brand
    from datetime import datetime, timedelta

    from app.database import AsyncSessionLocal
    from app.models import AnalyticsEvent

    async with AsyncSessionLocal() as db:
        for _ in range(10):
            db.add(AnalyticsEvent(
                event_type="manual_scan_triggered",
                brand_id=brand["id"],
                created_at=datetime.now(UTC).replace(tzinfo=None) - timedelta(hours=1),
            ))
        await db.commit()

    resp = await client.post(f"/api/opportunities/{brand['id']}/scan")
    assert resp.status_code == 429, resp.text
    assert "limit" in resp.json()["detail"].lower()


async def test_old_scan_events_do_not_count_toward_weekly_limit(client: httpx.AsyncClient):
    """Scan events older than 7 days do not count against the weekly limit."""
    await register_and_login(client, email="scan_old@example.com", subscription_tier="starter")
    brand = await create_brand(client, name="Old Scan Brand")

    from datetime import datetime, timedelta

    from app.database import AsyncSessionLocal
    from app.models import AnalyticsEvent

    # Seed 10 events from 8 days ago (outside window)
    async with AsyncSessionLocal() as db:
        for _ in range(10):
            db.add(AnalyticsEvent(
                event_type="manual_scan_triggered",
                brand_id=brand["id"],
                created_at=datetime.now(UTC).replace(tzinfo=None) - timedelta(days=8),
            ))
        await db.commit()

    with patch("app.services.reddit_scanner_service.scan_brand_opportunities", new_callable=AsyncMock), \
         patch("app.services.quora_scanner_service.scan_brand_opportunities", new_callable=AsyncMock):
        resp = await client.post(f"/api/opportunities/{brand['id']}/scan")
    assert resp.status_code == 202, resp.text


async def test_admin_can_always_trigger_scan(client: httpx.AsyncClient):
    """Admin users bypass all scan quota checks."""
    from sqlalchemy import text

    from app.database import AsyncSessionLocal

    await register_and_login(client, email="scan_admin@example.com", subscription_tier=None)
    async with AsyncSessionLocal() as db:
        await db.execute(text("UPDATE users SET is_admin = 1 WHERE email = 'scan_admin@example.com'"))
        await db.commit()

    # Admin users can create brands via the API (they bypass limits).
    # However free plan has 0 standard brand limit, so insert directly.
    from sqlalchemy import select as _select

    from app.database import AsyncSessionLocal as _ASL
    from app.models import Brand as _Brand
    from app.models import User as _User

    async with _ASL() as db:
        result = await db.execute(_select(_User).where(_User.email == "scan_admin@example.com"))
        user = result.scalar_one()
        brand = _Brand(name="Admin Scan Brand", slug="admin-scan-brand", user_id=user.id)
        db.add(brand)
        await db.commit()
        await db.refresh(brand)
        brand_id = brand.id

    with patch("app.services.reddit_scanner_service.scan_brand_opportunities", new_callable=AsyncMock), \
         patch("app.services.quora_scanner_service.scan_brand_opportunities", new_callable=AsyncMock):
        resp = await client.post(f"/api/opportunities/{brand_id}/scan")
    assert resp.status_code == 202, resp.text
