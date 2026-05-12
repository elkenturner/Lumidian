import pytest
from unittest.mock import patch, AsyncMock

from tests.conftest import register_and_login, create_brand


@pytest.mark.asyncio
async def test_trigger_audit_requires_tier(client):
    await register_and_login(client, subscription_tier=None)  # Free
    # Free tier can only create pitch brands; either way audits should 403.
    r = await client.post(
        "/api/brands",
        json={
            "name": "Test Brand",
            "tier": "basic",
            "brand_type": "pitch",
            "website_url": "https://example.com",
            "prompts": ["What are the best tools for X?"],
        },
    )
    assert r.status_code == 201, r.text
    brand = r.json()
    r = await client.post(f"/api/site-audit/{brand['id']}/trigger")
    assert r.status_code == 403


@pytest.mark.asyncio
async def test_trigger_audit_basic_tier(client):
    await register_and_login(client, subscription_tier="basic")
    brand = await create_brand(client)
    with patch("app.routers.site_audit._run_audit_safe", new=AsyncMock(return_value=None)):
        r = await client.post(f"/api/site-audit/{brand['id']}/trigger")
    assert r.status_code == 202
    assert r.json()["audit_id"]


@pytest.mark.asyncio
async def test_latest_audit_returns_404_when_none(client):
    await register_and_login(client, subscription_tier="basic")
    brand = await create_brand(client)
    r = await client.get(f"/api/site-audit/{brand['id']}/latest")
    assert r.status_code == 404


@pytest.mark.asyncio
async def test_ownership_enforced(client):
    await register_and_login(client, email="owner@x.com", subscription_tier="basic")
    brand = await create_brand(client)
    # Different user tries to read
    await register_and_login(client, email="intruder@x.com", subscription_tier="basic")
    r = await client.get(f"/api/site-audit/{brand['id']}/latest")
    assert r.status_code in (403, 404)


@pytest.mark.asyncio
async def test_llms_txt_endpoint(client):
    await register_and_login(client, subscription_tier="basic")
    brand = await create_brand(client)
    r = await client.get(f"/api/site-audit/{brand['id']}/llms-txt")
    assert r.status_code == 200
    assert r.headers["content-type"].startswith("text/plain")
    # No audit yet -> skeleton; brand "Test Brand" gives "# Test Brand"
    assert "# " in r.text


@pytest.mark.asyncio
async def test_robots_snippet_endpoint(client):
    await register_and_login(client, subscription_tier="basic")
    brand = await create_brand(client)
    r = await client.get(f"/api/site-audit/{brand['id']}/robots-snippet?mode=allow_all")
    assert r.status_code == 200
    assert "GPTBot" in r.text
