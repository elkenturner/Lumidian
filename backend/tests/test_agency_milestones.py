"""Tests for /api/agency/clients/{id}/milestones."""
from __future__ import annotations

import pytest
from sqlalchemy import update

from app.database import AsyncSessionLocal
from app.models import User
from tests.conftest import register_and_login


MILESTONE_KINDS = ["kickoff", "sow", "initial_audit", "strategy_locked", "wikipedia_plan", "site_plan"]


async def _make_agency_admin(client, email: str = "agency-admin@example.com") -> None:
    """Register, verify, log in, then flip is_agency_staff=True + is_admin=True."""
    await register_and_login(client, email=email)
    async with AsyncSessionLocal() as db:
        await db.execute(
            update(User).where(User.email == email).values(is_agency_staff=True, is_admin=True)
        )
        await db.commit()


async def create_agency_client_for_admin(client, *, name: str = "Test client") -> int:
    res = await client.post("/api/agency/clients", json={"name": name})
    assert res.status_code == 201, res.text
    return res.json()["id"]


@pytest.mark.asyncio
async def test_list_milestones_autocreates_six_rows(client):
    await _make_agency_admin(client)
    agency_client_id = await create_agency_client_for_admin(client, name="Acme")
    res = await client.get(f"/api/agency/clients/{agency_client_id}/milestones")
    assert res.status_code == 200
    payload = res.json()
    assert len(payload) == 6
    kinds = sorted(m["kind"] for m in payload)
    assert kinds == sorted(MILESTONE_KINDS)
    for m in payload:
        assert m["status"] == "not_started"
        assert m["completed_at"] is None
        assert m["completed_by"] is None
        assert m["completed_by_name"] is None
        assert m["notes"] is None


async def _make_agency_user_unassigned(client, email: str) -> None:
    """Register + login + flip is_agency_staff=True (but not is_admin)."""
    await register_and_login(client, email=email)
    async with AsyncSessionLocal() as db:
        await db.execute(
            update(User).where(User.email == email).values(is_agency_staff=True)
        )
        await db.commit()


@pytest.mark.asyncio
async def test_list_milestones_unassigned_staff_gets_403(client):
    # Create an admin and a separate non-admin staff user
    await _make_agency_admin(client, "admin@example.com")
    # ...create a client as admin
    res = await client.post("/api/agency/clients", json={"name": "Acme"})
    assert res.status_code == 201
    cid = res.json()["id"]
    # Logout admin, log in a non-admin agency staffer who isn't assigned
    await client.post("/api/auth/logout")
    await _make_agency_user_unassigned(client, "staff@example.com")
    res = await client.get(f"/api/agency/clients/{cid}/milestones")
    assert res.status_code == 403


@pytest.mark.asyncio
async def test_list_milestones_admin_bypass(client):
    # First admin creates a client
    await _make_agency_admin(client, "admin1@example.com")
    res = await client.post("/api/agency/clients", json={"name": "Acme"})
    assert res.status_code == 201
    cid = res.json()["id"]
    # Log out, log in as a different admin (admin bypass)
    await client.post("/api/auth/logout")
    await _make_agency_admin(client, "admin2@example.com")
    res = await client.get(f"/api/agency/clients/{cid}/milestones")
    assert res.status_code == 200
