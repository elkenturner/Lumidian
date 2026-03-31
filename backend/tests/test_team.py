"""Tests for the team invite flow."""
import httpx
import pytest
from tests.conftest import register_and_login, login_user


async def test_invite_team_member_success(client: httpx.AsyncClient):
    """Owner can invite a team member — returns 201 with invite_link."""
    await register_and_login(client, email="owner_invite@example.com")
    resp = await client.post("/api/team/invite", json={"email": "member@example.com"})
    assert resp.status_code == 201
    data = resp.json()
    assert "invite_link" in data
    assert "/team/accept?token=" in data["invite_link"]


async def test_invite_self_rejected(client: httpx.AsyncClient):
    """Cannot invite yourself — returns 400."""
    await register_and_login(client, email="self_invite@example.com")
    resp = await client.post("/api/team/invite", json={"email": "self_invite@example.com"})
    assert resp.status_code == 400


async def test_list_team_members_empty(client: httpx.AsyncClient):
    """New owner sees empty members list."""
    await register_and_login(client, email="owner_list@example.com")
    resp = await client.get("/api/team/members")
    assert resp.status_code == 200
    assert resp.json() == []


async def test_list_team_members_shows_pending_invite(client: httpx.AsyncClient):
    """Invited member appears in list before accepting."""
    await register_and_login(client, email="owner_show@example.com")
    await client.post("/api/team/invite", json={"email": "pending@example.com"})
    resp = await client.get("/api/team/members")
    assert resp.status_code == 200
    members = resp.json()
    assert len(members) == 1
    assert members[0]["invited_email"] == "pending@example.com"
    assert members[0]["accepted"] is False


async def test_accept_invite(client: httpx.AsyncClient):
    """Invited user can accept the invite and is marked as accepted."""
    # Owner creates invite
    owner_email = "owner_accept_final@example.com"
    acceptor_email = "acceptor_final@example.com"
    await register_and_login(client, email=owner_email)
    invite_resp = await client.post("/api/team/invite", json={"email": acceptor_email})
    token = invite_resp.json()["invite_link"].split("token=")[1]

    # Invited user registers, logs in, and accepts
    await client.post("/api/auth/logout")
    await register_and_login(client, email=acceptor_email)
    accept_resp = await client.get(f"/api/team/accept?token={token}")
    assert accept_resp.status_code == 200

    # Verify acceptor is now a member by logging in as owner
    await client.post("/api/auth/logout")
    await login_user(client, email=owner_email, password="password123")
    members = (await client.get("/api/team/members")).json()
    assert any(m["invited_email"] == acceptor_email and m["accepted"] for m in members)


async def test_remove_team_member(client: httpx.AsyncClient):
    """Owner can remove a team member — invite disappears from list."""
    await register_and_login(client, email="owner_remove@example.com")
    invite_resp = await client.post("/api/team/invite", json={"email": "todelete@example.com"})
    member_id = invite_resp.json()["id"]

    del_resp = await client.delete(f"/api/team/members/{member_id}")
    assert del_resp.status_code == 204

    members = (await client.get("/api/team/members")).json()
    assert all(m["id"] != member_id for m in members)
