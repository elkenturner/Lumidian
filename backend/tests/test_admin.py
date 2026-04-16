"""Tests for the admin router endpoints."""
from __future__ import annotations

import pytest
from httpx import AsyncClient

from tests.conftest import create_brand, register_and_login, register_user

pytestmark = pytest.mark.asyncio


async def make_admin(client: AsyncClient) -> None:
    """Register with admin email, verify, login."""
    await register_and_login(client, email="admin@test.com", password="Password123")


async def _get_user_id(client: AsyncClient, email: str) -> int:
    users = (await client.get("/api/admin/users")).json()
    return next(u["id"] for u in users if u["email"] == email)


# ── Access control ───────────────────────────────────────────────────────

async def test_admin_stats_requires_admin(client: AsyncClient):
    await register_and_login(client, email="nonadmin@test.com")
    resp = await client.get("/api/admin/stats")
    assert resp.status_code == 403


async def test_admin_stats(client: AsyncClient):
    await make_admin(client)
    resp = await client.get("/api/admin/stats")
    assert resp.status_code == 200
    data = resp.json()
    assert "total_users" in data
    assert "runs_today" in data


# ── User list ────────────────────────────────────────────────────────────

async def test_admin_list_users(client: AsyncClient):
    await make_admin(client)
    resp = await client.get("/api/admin/users")
    assert resp.status_code == 200
    users = resp.json()
    assert isinstance(users, list)
    assert len(users) >= 1


# ── User detail ──────────────────────────────────────────────────────────

async def test_admin_get_user(client: AsyncClient):
    await make_admin(client)
    users = (await client.get("/api/admin/users")).json()
    admin_id = users[0]["id"]
    resp = await client.get(f"/api/admin/users/{admin_id}")
    assert resp.status_code == 200
    data = resp.json()
    assert data["email"] == "admin@test.com"
    assert "brand_count" in data
    assert "total_runs" in data


async def test_admin_get_user_not_found(client: AsyncClient):
    await make_admin(client)
    resp = await client.get("/api/admin/users/99999")
    assert resp.status_code == 404


# ── User edit ────────────────────────────────────────────────────────────

async def test_admin_edit_user_tier(client: AsyncClient):
    await make_admin(client)
    await register_user(client, email="editme@test.com")
    target_id = await _get_user_id(client, "editme@test.com")
    resp = await client.patch(
        f"/api/admin/users/{target_id}",
        json={"subscription_tier": "pro", "email_verified": True},
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["subscription_tier"] == "pro"
    assert data["email_verified"] is True


# ── Impersonation ────────────────────────────────────────────────────────

async def test_impersonate_and_exit(client: AsyncClient):
    await make_admin(client)
    await register_user(client, email="target@test.com")
    target_id = await _get_user_id(client, "target@test.com")

    # Verify email for target so /auth/me works
    await client.patch(f"/api/admin/users/{target_id}", json={"email_verified": True})

    # Impersonate
    resp = await client.post(f"/api/admin/impersonate/{target_id}")
    assert resp.status_code == 200
    data = resp.json()
    assert data["target_user_email"] == "target@test.com"
    assert "admin_token" in data
    admin_token = data["admin_token"]

    # Verify we're now the target user
    me_resp = await client.get("/api/auth/me")
    assert me_resp.status_code == 200
    assert me_resp.json()["email"] == "target@test.com"

    # Exit impersonation
    exit_resp = await client.post("/api/admin/exit-impersonation", json={"admin_token": admin_token})
    assert exit_resp.status_code == 200
    assert exit_resp.json()["restored"] is True

    # Verify we're admin again
    me_resp2 = await client.get("/api/auth/me")
    assert me_resp2.status_code == 200
    assert me_resp2.json()["email"] == "admin@test.com"


# ── Brand editing ────────────────────────────────────────────────────────

async def test_admin_user_brands(client: AsyncClient):
    await make_admin(client)
    brand = await create_brand(client, "Admin Test Brand")
    me = (await client.get("/api/auth/me")).json()
    resp = await client.get(f"/api/admin/users/{me['id']}/brands")
    assert resp.status_code == 200
    brands = resp.json()
    assert len(brands) >= 1
    matching = next(b for b in brands if b["id"] == brand["id"])
    assert "prompts" in matching
    assert "competitors" in matching


async def test_admin_edit_brand(client: AsyncClient):
    await make_admin(client)
    brand = await create_brand(client, "OldName")
    resp = await client.patch(f"/api/admin/brands/{brand['id']}", json={"name": "NewName"})
    assert resp.status_code == 200
    data = resp.json()
    assert data["name"] == "NewName"


# ── Prompt editing ───────────────────────────────────────────────────────

async def test_admin_add_and_delete_prompt(client: AsyncClient):
    await make_admin(client)
    brand = await create_brand(client, "PromptBrand")

    # Add
    resp = await client.post(f"/api/admin/brands/{brand['id']}/prompts", json={"text": "New admin prompt"})
    assert resp.status_code == 201
    prompt_id = resp.json()["id"]

    # Edit
    resp = await client.patch(f"/api/admin/prompts/{prompt_id}", json={"text": "Updated admin prompt"})
    assert resp.status_code == 200
    assert resp.json()["text"] == "Updated admin prompt"

    # Delete
    resp = await client.delete(f"/api/admin/prompts/{prompt_id}")
    assert resp.status_code == 200
    assert resp.json()["deleted"] is True


# ── Competitor editing ───────────────────────────────────────────────────

async def test_admin_add_and_delete_competitor(client: AsyncClient):
    await make_admin(client)
    brand = await create_brand(client, "CompBrand")

    # Add
    resp = await client.post(
        f"/api/admin/brands/{brand['id']}/competitors",
        json={"name": "Rival Co", "website_url": "https://rival.co"},
    )
    assert resp.status_code == 201
    comp_id = resp.json()["id"]

    # Delete
    resp = await client.delete(f"/api/admin/competitors/{comp_id}")
    assert resp.status_code == 200
    assert resp.json()["deleted"] is True
