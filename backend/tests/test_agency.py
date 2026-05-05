"""Tests for the agency portal router."""
from __future__ import annotations

import pytest
from sqlalchemy import update

from app.database import AsyncSessionLocal
from app.models import User
from tests.conftest import register_and_login


async def _make_agency_user(client, email: str = "agency@example.com") -> None:
    """Register, verify, log in, then flip is_agency_staff=True. Cookies stick on `client`."""
    await register_and_login(client, email=email)
    async with AsyncSessionLocal() as db:
        await db.execute(update(User).where(User.email == email).values(is_agency_staff=True))
        await db.commit()


@pytest.mark.asyncio
async def test_non_staff_cannot_list_clients(client):
    await register_and_login(client, email="user@example.com")
    resp = await client.get("/api/agency/clients")
    assert resp.status_code == 403


@pytest.mark.asyncio
async def test_unauthenticated_cannot_access_agency(client):
    resp = await client.get("/api/agency/clients")
    assert resp.status_code in (401, 403)


@pytest.mark.asyncio
async def test_staff_can_create_and_list_clients(client):
    await _make_agency_user(client)

    create = await client.post(
        "/api/agency/clients",
        json={"name": "Acme Co", "primary_contact_email": "ceo@acme.com"},
    )
    assert create.status_code == 201, create.text
    created = create.json()
    assert created["name"] == "Acme Co"
    assert created["slug"] == "acme-co"
    assert created["status"] == "onboarding"
    assert created["brand_id"] is not None
    assert created["drafts_pending"] == 0

    listing = await client.get("/api/agency/clients")
    assert listing.status_code == 200
    assert any(c["id"] == created["id"] for c in listing.json())


@pytest.mark.asyncio
async def test_create_client_handles_slug_collision(client):
    await _make_agency_user(client)
    a = await client.post("/api/agency/clients", json={"name": "Acme"})
    b = await client.post("/api/agency/clients", json={"name": "Acme"})
    assert a.json()["slug"] == "acme"
    assert b.json()["slug"] == "acme-2"


@pytest.mark.asyncio
async def test_update_client_status_sets_retainer_started_at(client):
    await _make_agency_user(client)
    create = await client.post("/api/agency/clients", json={"name": "Beta Inc"})
    cid = create.json()["id"]

    upd = await client.patch(f"/api/agency/clients/{cid}", json={"status": "active"})
    assert upd.status_code == 200
    assert upd.json()["status"] == "active"
    assert upd.json()["retainer_started_at"] is not None


@pytest.mark.asyncio
async def test_delete_client_marks_churned(client):
    await _make_agency_user(client)
    create = await client.post("/api/agency/clients", json={"name": "Gamma"})
    cid = create.json()["id"]

    resp = await client.delete(f"/api/agency/clients/{cid}")
    assert resp.status_code == 204

    detail = await client.get(f"/api/agency/clients/{cid}")
    assert detail.json()["status"] == "churned"


@pytest.mark.asyncio
async def test_today_returns_empty_when_no_drafts(client):
    await _make_agency_user(client)
    resp = await client.get("/api/agency/today")
    assert resp.status_code == 200
    body = resp.json()
    assert body["drafts_to_review"] == []
    assert body["drafts_to_review_count"] == 0
    assert body["active_clients"] == 0
