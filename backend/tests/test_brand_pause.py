"""Tests for brand pause functionality."""
from datetime import UTC, datetime, timedelta

import pytest
from httpx import AsyncClient

from tests.conftest import register_and_login


@pytest.mark.asyncio
async def test_paused_pitch_brand_blocks_run(client: AsyncClient):
    """Expired pitch brand should block tracking runs."""
    await register_and_login(client, "pause@test.com", "Password123")

    # Create a pitch brand
    brand_resp = await client.post(
        "/api/brands",
        json={"name": "PausedBrand", "tier": "basic", "brand_type": "pitch", "prompts": ["test prompt"], "website_url": "https://paused.example.com"},
    )
    assert brand_resp.status_code == 201
    brand_id = brand_resp.json()["id"]

    # Manually expire the brand by setting pitch_expires_at in the past
    from app.database import AsyncSessionLocal
    from app.models import Brand
    async with AsyncSessionLocal() as db:
        brand = await db.get(Brand, brand_id)
        brand.pitch_expires_at = datetime.now(UTC).replace(tzinfo=None) - timedelta(days=1)
        await db.commit()

    # Attempt to trigger a run — should be blocked
    run_resp = await client.post(f"/api/tracking/run/{brand_id}")
    assert run_resp.status_code == 403
    assert "paused" in run_resp.json()["detail"].lower()


@pytest.mark.asyncio
async def test_paused_brand_allows_read(client: AsyncClient):
    """Paused brand should still allow reading data."""
    await register_and_login(client, "pauseread@test.com", "Password123")

    # Create a pitch brand
    brand_resp = await client.post(
        "/api/brands",
        json={"name": "ReadableBrand", "tier": "basic", "brand_type": "pitch", "prompts": ["test prompt"], "website_url": "https://readable.example.com"},
    )
    assert brand_resp.status_code == 201
    brand_id = brand_resp.json()["id"]

    # Expire the brand
    from app.database import AsyncSessionLocal
    from app.models import Brand
    async with AsyncSessionLocal() as db:
        brand = await db.get(Brand, brand_id)
        brand.pitch_expires_at = datetime.now(UTC).replace(tzinfo=None) - timedelta(days=1)
        await db.commit()

    # Reading brand should still work
    get_resp = await client.get(f"/api/brands/{brand_id}")
    assert get_resp.status_code == 200


@pytest.mark.asyncio
async def test_lapsed_subscription_blocks_run(client: AsyncClient):
    """Lapsed subscription should block tracking runs."""
    token = await register_and_login(client, "lapsed@test.com", "Password123")

    # Create a brand
    brand_resp = await client.post(
        "/api/brands",
        json={"name": "LapsedBrand", "tier": "basic", "brand_type": "pitch", "prompts": ["test"], "website_url": "https://lapsed.com"},
        cookies={"clarity_token": token},
    )
    brand_id = brand_resp.json()["id"]

    # Set subscription status to canceled
    from sqlalchemy import select

    from app.database import AsyncSessionLocal
    from app.models import User
    async with AsyncSessionLocal() as db:
        result = await db.execute(select(User).where(User.email == "lapsed@test.com"))
        user = result.scalar_one()
        user.subscription_status = "canceled"
        await db.commit()

    # Attempt to trigger a run — should be blocked.
    # require_active_subscription fires before require_brand_active, so a
    # canceled subscription returns 402 (payment required) rather than 403.
    run_resp = await client.post(f"/api/tracking/run/{brand_id}", cookies={"clarity_token": token})
    assert run_resp.status_code in (402, 403)
    assert run_resp.status_code != 202, "Run should be blocked for a canceled subscription"
