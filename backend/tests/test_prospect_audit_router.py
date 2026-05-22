"""Router endpoints — auth, multi-tenancy, basic state transitions."""
from unittest.mock import patch

import httpx
import pytest
from sqlalchemy import select

from app.database import AsyncSessionLocal
from app.models import User
from tests.conftest import register_and_login


async def _make_staff(client: httpx.AsyncClient, email: str = "staff1@example.com") -> None:
    """Register (or re-login) the given email AND promote to agency staff.
    Cookies are set on the client; no headers needed.

    Safe to call multiple times with the same email within one test — will
    skip registration and just login if the account already exists.
    """
    from tests.conftest import login_user, register_user

    client.cookies.clear()

    # Try to register; if the account already exists (409) just skip.
    resp = await client.post(
        "/api/auth/register",
        json={"email": email, "password": "Password123", "name": "Staff User"},
    )
    if resp.status_code == 201:
        # New account — mark email verified + grant tier so login works.
        async with AsyncSessionLocal() as db:
            from sqlalchemy import text
            await db.execute(
                text("UPDATE users SET email_verified = 1, subscription_tier = 'starter' WHERE email = :e"),
                {"e": email},
            )
            await db.commit()

    await login_user(client, email=email)

    # Ensure is_agency_staff is set (idempotent).
    async with AsyncSessionLocal() as db:
        u = (await db.execute(select(User).where(User.email == email))).scalar_one()
        u.is_agency_staff = True
        await db.commit()


@pytest.mark.asyncio
async def test_post_creates_audit_and_schedules_task(client: httpx.AsyncClient):
    await _make_staff(client)
    with patch("app.routers.prospect_audit.run_audit") as mock_run:
        resp = await client.post(
            "/api/agency/prospects",
            json={"business_name": "Acme", "website_url": "https://acme.com", "is_local": False},
        )
    assert resp.status_code == 201, resp.text
    body = resp.json()
    assert body["status"] == "pending"
    assert body["id"]
    mock_run.assert_called_once_with(body["id"])


@pytest.mark.asyncio
async def test_post_requires_location_when_local(client: httpx.AsyncClient):
    await _make_staff(client)
    resp = await client.post(
        "/api/agency/prospects",
        json={"business_name": "Acme", "website_url": "https://acme.com", "is_local": True},
    )
    assert resp.status_code == 422


@pytest.mark.asyncio
async def test_post_blocks_non_staff(client: httpx.AsyncClient):
    client.cookies.clear()
    await register_and_login(client, email="regular@example.com")
    resp = await client.post(
        "/api/agency/prospects",
        json={"business_name": "Acme", "website_url": "https://acme.com", "is_local": False},
    )
    assert resp.status_code == 403


@pytest.mark.asyncio
async def test_list_returns_only_callers_audits(client: httpx.AsyncClient):
    await _make_staff(client, email="s1@example.com")
    with patch("app.routers.prospect_audit.run_audit"):
        await client.post("/api/agency/prospects", json={"business_name": "A", "website_url": "https://a.com", "is_local": False})

    # Switch to a second staff user
    await _make_staff(client, email="s2@example.com")
    with patch("app.routers.prospect_audit.run_audit"):
        await client.post("/api/agency/prospects", json={"business_name": "B", "website_url": "https://b.com", "is_local": False})

    # User s2's list should only show their own audit
    list2 = await client.get("/api/agency/prospects")
    assert list2.status_code == 200
    items2 = list2.json()
    assert len(items2) == 1
    assert items2[0]["business_name"] == "B"

    # Switch back to s1 and check theirs (already registered — just re-login)
    await _make_staff(client, email="s1@example.com")
    list1 = await client.get("/api/agency/prospects")
    assert list1.status_code == 200
    items1 = list1.json()
    assert len(items1) == 1
    assert items1[0]["business_name"] == "A"


@pytest.mark.asyncio
async def test_get_single_audit(client: httpx.AsyncClient):
    await _make_staff(client)
    with patch("app.routers.prospect_audit.run_audit"):
        post_resp = await client.post(
            "/api/agency/prospects",
            json={"business_name": "Acme", "website_url": "https://acme.com", "is_local": False},
        )
    audit_id = post_resp.json()["id"]
    detail = await client.get(f"/api/agency/prospects/{audit_id}")
    assert detail.status_code == 200
    body = detail.json()
    assert body["business_name"] == "Acme"
    assert body["status"] == "pending"
    assert "has_pdf" in body


@pytest.mark.asyncio
async def test_get_404_when_not_owner(client: httpx.AsyncClient):
    await _make_staff(client, email="s1@example.com")
    with patch("app.routers.prospect_audit.run_audit"):
        post_resp = await client.post(
            "/api/agency/prospects",
            json={"business_name": "Acme", "website_url": "https://acme.com", "is_local": False},
        )
    audit_id = post_resp.json()["id"]

    # Switch to staff #2
    await _make_staff(client, email="s2@example.com")
    resp = await client.get(f"/api/agency/prospects/{audit_id}")
    assert resp.status_code == 404
