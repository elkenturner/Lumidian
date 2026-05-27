"""Tests for agency tier-up (model list, runs/prompt, admin-only client creation)."""
from __future__ import annotations

import pytest
from sqlalchemy import update

from app.database import AsyncSessionLocal
from app.models import User
from tests.conftest import register_and_login


async def _promote(client, email: str, *, agency_staff: bool = False, admin: bool = False) -> None:
    """Register + verify + login, then set is_agency_staff / is_admin flags."""
    await register_and_login(client, email=email)
    async with AsyncSessionLocal() as db:
        await db.execute(
            update(User)
            .where(User.email == email)
            .values(is_agency_staff=agency_staff, is_admin=admin)
        )
        await db.commit()


@pytest.mark.asyncio
async def test_create_client_blocked_for_non_admin_staff(client):
    """Non-admin agency staff cannot create new clients."""
    await _promote(client, "staff@example.com", agency_staff=True, admin=False)
    resp = await client.post("/api/agency/clients", json={"name": "Acme"})
    assert resp.status_code == 403
    assert "admin" in resp.json()["detail"].lower()


@pytest.mark.asyncio
async def test_create_client_allowed_for_admin(client):
    """Admins can create new agency clients."""
    await _promote(client, "admin@example.com", agency_staff=False, admin=True)
    resp = await client.post("/api/agency/clients", json={"name": "Acme"})
    assert resp.status_code == 201
    body = resp.json()
    assert body["name"] == "Acme"
