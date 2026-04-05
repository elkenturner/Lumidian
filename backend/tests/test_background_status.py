"""
Tests for GET /api/tracking/background-status

Returns:
  { report_running: bool, drafts_generating: bool, scanning: bool }

- report_running: true if any of the user's brands has a TrackingRun
  with status 'pending' or 'running'
- drafts_generating: true if any of the user's brand IDs is in
  state.generating_brands
- scanning: true if any of the user's brand IDs is in state.scanning_brands
"""
import httpx
import pytest

from tests.conftest import create_brand, register_and_login

pytestmark = pytest.mark.asyncio


async def test_background_status_unauthenticated(client: httpx.AsyncClient):
    """Unauthenticated requests are rejected with 401."""
    resp = await client.get("/api/tracking/background-status")
    assert resp.status_code == 401


async def test_background_status_all_false_when_idle(client: httpx.AsyncClient):
    """All flags are false when the user has a brand but nothing is running."""
    await register_and_login(client, email="bg_idle@example.com")
    await create_brand(client, name="Idle Brand")

    resp = await client.get("/api/tracking/background-status")
    assert resp.status_code == 200
    data = resp.json()
    assert data["report_running"] is False
    assert data["drafts_generating"] is False
    assert data["scanning"] is False


async def test_background_status_no_brands(client: httpx.AsyncClient):
    """Users with no brands get all-false without errors."""
    await register_and_login(client, email="bg_nobrands@example.com")

    resp = await client.get("/api/tracking/background-status")
    assert resp.status_code == 200
    data = resp.json()
    assert data["report_running"] is False
    assert data["drafts_generating"] is False
    assert data["scanning"] is False


async def test_background_status_report_running(client: httpx.AsyncClient):
    """report_running is true when the user's brand has a pending/running TrackingRun."""
    await register_and_login(client, email="bg_running@example.com")
    brand = await create_brand(client, name="Running Brand")

    # Seed a pending run
    from app.database import AsyncSessionLocal
    from app.models import TrackingRun

    async with AsyncSessionLocal() as db:
        db.add(TrackingRun(brand_id=brand["id"], status="pending", run_type="manual"))
        await db.commit()

    resp = await client.get("/api/tracking/background-status")
    assert resp.status_code == 200
    assert resp.json()["report_running"] is True


async def test_background_status_drafts_generating(client: httpx.AsyncClient):
    """drafts_generating is true when the brand's ID is in state.generating_brands."""
    await register_and_login(client, email="bg_drafting@example.com")
    brand = await create_brand(client, name="Drafting Brand")

    from app import state
    state.generating_brands.add(brand["id"])
    try:
        resp = await client.get("/api/tracking/background-status")
        assert resp.status_code == 200
        assert resp.json()["drafts_generating"] is True
    finally:
        state.generating_brands.discard(brand["id"])


async def test_background_status_scanning(client: httpx.AsyncClient):
    """scanning is true when the brand's ID is in state.scanning_brands."""
    await register_and_login(client, email="bg_scanning@example.com")
    brand = await create_brand(client, name="Scanning Brand")

    from app import state
    state.scanning_brands.add(brand["id"])
    try:
        resp = await client.get("/api/tracking/background-status")
        assert resp.status_code == 200
        assert resp.json()["scanning"] is True
    finally:
        state.scanning_brands.discard(brand["id"])


async def test_background_status_only_own_brands(client: httpx.AsyncClient):
    """State from another user's brand does not bleed into this user's status."""
    # User A owns the brand that is generating
    await register_and_login(client, email="bg_owner@example.com")
    brand = await create_brand(client, name="Owner Brand")

    from app import state
    state.generating_brands.add(brand["id"])
    try:
        # User B has no brands — should see all-false
        await register_and_login(client, email="bg_other@example.com")
        resp = await client.get("/api/tracking/background-status")
        assert resp.status_code == 200
        assert resp.json()["drafts_generating"] is False
    finally:
        state.generating_brands.discard(brand["id"])
