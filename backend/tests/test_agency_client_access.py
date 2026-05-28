"""Tests for require_client_access and per-client authorization."""
from __future__ import annotations

import pytest
from sqlalchemy import select, update

from app.database import AsyncSessionLocal
from app.models import AgencyClientAssignment, User
from tests.conftest import login_user, register_and_login


async def _make_agency_user(client, email: str = "staff@example.com", admin: bool = False) -> None:
    """Register/verify/login + flip is_agency_staff (and optionally is_admin)."""
    await register_and_login(client, email=email)
    async with AsyncSessionLocal() as db:
        await db.execute(
            update(User).where(User.email == email).values(is_agency_staff=True, is_admin=admin)
        )
        await db.commit()


@pytest.mark.asyncio
async def test_non_admin_staff_blocked_from_unassigned_client(client):
    """A non-admin staff member cannot GET a client they're not assigned to."""
    await _make_agency_user(client, email="staff-a@example.com", admin=True)
    create = await client.post("/api/agency/clients", json={"name": "Owned"})
    cid = create.json()["id"]

    await client.post("/api/auth/logout")
    await _make_agency_user(client, email="staff-b@example.com")
    resp = await client.get(f"/api/agency/clients/{cid}")
    assert resp.status_code == 403
    assert "assigned" in resp.json()["detail"].lower()


@pytest.mark.asyncio
async def test_admin_bypasses_assignment_check(client):
    """Admins access any client regardless of assignment."""
    await _make_agency_user(client, email="staff-a@example.com", admin=True)
    create = await client.post("/api/agency/clients", json={"name": "Owned"})
    cid = create.json()["id"]

    await client.post("/api/auth/logout")
    await _make_agency_user(client, email="admin@example.com", admin=True)
    resp = await client.get(f"/api/agency/clients/{cid}")
    assert resp.status_code == 200


@pytest.mark.asyncio
async def test_assigned_staff_can_access_client(client):
    """Manually-assigned staff (no create) can access the client."""
    await _make_agency_user(client, email="staff-a@example.com", admin=True)
    create = await client.post("/api/agency/clients", json={"name": "Shared"})
    cid = create.json()["id"]

    await client.post("/api/auth/logout")
    await _make_agency_user(client, email="staff-b@example.com")

    async with AsyncSessionLocal() as db:
        b = (await db.execute(select(User).where(User.email == "staff-b@example.com"))).scalar_one()
        db.add(AgencyClientAssignment(agency_client_id=cid, staff_user_id=b.id))
        await db.commit()

    resp = await client.get(f"/api/agency/clients/{cid}")
    assert resp.status_code == 200


@pytest.mark.asyncio
async def test_creating_client_auto_assigns_creator(client):
    """POST /clients creates an AgencyClientAssignment for the calling user."""
    await _make_agency_user(client, email="creator@example.com", admin=True)
    create = await client.post("/api/agency/clients", json={"name": "AutoAssign"})
    cid = create.json()["id"]

    async with AsyncSessionLocal() as db:
        user = (await db.execute(select(User).where(User.email == "creator@example.com"))).scalar_one()
        rows = (await db.execute(
            select(AgencyClientAssignment).where(
                AgencyClientAssignment.agency_client_id == cid,
                AgencyClientAssignment.staff_user_id == user.id,
            )
        )).scalars().all()
        assert len(rows) == 1


@pytest.mark.asyncio
async def test_non_admin_blocked_from_unassigned_client_documents(client):
    """List documents endpoint enforces assignment (representative direct endpoint)."""
    await _make_agency_user(client, email="owner@example.com", admin=True)
    create = await client.post("/api/agency/clients", json={"name": "DocClient"})
    cid = create.json()["id"]

    await client.post("/api/auth/logout")
    await _make_agency_user(client, email="intruder@example.com")
    resp = await client.get(f"/api/agency/clients/{cid}/documents")
    assert resp.status_code == 403


@pytest.mark.asyncio
async def test_list_clients_filters_to_assigned_only(client):
    """A staff member only sees clients they're assigned to (cross-client filter)."""
    await _make_agency_user(client, email="staff-a@example.com", admin=True)
    await client.post("/api/agency/clients", json={"name": "A One"})
    await client.post("/api/agency/clients", json={"name": "A Two"})

    await client.post("/api/auth/logout")
    # Temporarily admin so staff-b can create; demoted back to non-admin before list assertion.
    await _make_agency_user(client, email="staff-b@example.com", admin=True)
    await client.post("/api/agency/clients", json={"name": "B One"})
    async with AsyncSessionLocal() as db:
        await db.execute(
            update(User).where(User.email == "staff-b@example.com").values(is_admin=False)
        )
        await db.commit()

    resp = await client.get("/api/agency/clients")
    assert resp.status_code == 200
    names = [c["name"] for c in resp.json()]
    assert names == ["B One"]


@pytest.mark.asyncio
async def test_assign_and_unassign_staff_endpoints(client):
    """Owner can assign another staff member; that member then gets access."""
    await _make_agency_user(client, email="owner@example.com", admin=True)
    create = await client.post("/api/agency/clients", json={"name": "ShareMe"})
    cid = create.json()["id"]

    # Make a second staff user
    await client.post("/api/auth/logout")
    await _make_agency_user(client, email="newbie@example.com")
    async with AsyncSessionLocal() as db:
        newbie = (await db.execute(select(User).where(User.email == "newbie@example.com"))).scalar_one()
        newbie_id = newbie.id

    # Owner logs back in and assigns newbie
    await client.post("/api/auth/logout")
    await login_user(client, email="owner@example.com")

    assign = await client.post(f"/api/agency/clients/{cid}/staff-assigned/{newbie_id}")
    assert assign.status_code == 201
    assert assign.json()["email"] == "newbie@example.com"

    listed = await client.get(f"/api/agency/clients/{cid}/staff-assigned")
    emails = {row["email"] for row in listed.json()}
    assert "owner@example.com" in emails  # auto-assigned at create
    assert "newbie@example.com" in emails  # just assigned

    # Newbie can now access
    await client.post("/api/auth/logout")
    await login_user(client, email="newbie@example.com")
    resp = await client.get(f"/api/agency/clients/{cid}")
    assert resp.status_code == 200

    # Owner unassigns newbie
    await client.post("/api/auth/logout")
    await login_user(client, email="owner@example.com")
    unassign = await client.delete(f"/api/agency/clients/{cid}/staff-assigned/{newbie_id}")
    assert unassign.status_code == 204

    # Newbie blocked again
    await client.post("/api/auth/logout")
    await login_user(client, email="newbie@example.com")
    resp = await client.get(f"/api/agency/clients/{cid}")
    assert resp.status_code == 403
