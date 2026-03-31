"""Tests for the content gaps router (access control + empty states)."""
import httpx
import pytest
from tests.conftest import register_and_login, create_brand


async def test_get_gaps_empty(client: httpx.AsyncClient):
    """Brand with no tracking runs returns empty gaps list."""
    await register_and_login(client, email="gaps_empty@example.com")
    brand = await create_brand(client, name="GapsEmpty")
    resp = await client.get(f"/api/gaps/{brand['id']}")
    assert resp.status_code == 200
    assert resp.json() == []


async def test_get_gap_summary_no_runs(client: httpx.AsyncClient):
    """Brand with no tracking runs returns zero-count summary."""
    await register_and_login(client, email="gaps_summary@example.com")
    brand = await create_brand(client, name="GapsSummary")
    resp = await client.get(f"/api/gaps/{brand['id']}/summary")
    assert resp.status_code == 200
    data = resp.json()
    assert data["total_gaps"] == 0


async def test_get_gaps_requires_auth(client: httpx.AsyncClient):
    """Gaps endpoint returns 401 when unauthenticated."""
    resp = await client.get("/api/gaps/1")
    assert resp.status_code == 401


async def test_get_gaps_wrong_brand(client: httpx.AsyncClient):
    """Gaps endpoint returns 404 for a brand that doesn't exist."""
    await register_and_login(client, email="gaps_404@example.com")
    resp = await client.get("/api/gaps/99999")
    assert resp.status_code == 404


async def test_get_gaps_other_users_brand(client: httpx.AsyncClient):
    """User B cannot access User A's gap data."""
    await register_and_login(client, email="gaps_user_a@example.com")
    brand_a = await create_brand(client, name="GapsUserA")

    await client.post("/api/auth/logout")
    await register_and_login(client, email="gaps_user_b@example.com")
    resp = await client.get(f"/api/gaps/{brand_a['id']}")
    assert resp.status_code in (403, 404)
