"""
Tests for authentication endpoints:
  POST /api/auth/register
  POST /api/auth/login
  POST /api/auth/logout
  GET  /api/auth/me
  JWT validation
  Password length enforcement
"""
import pytest
import httpx
from tests.conftest import register_user, login_user, register_and_login


pytestmark = pytest.mark.asyncio


# ── Register ──────────────────────────────────────────────────────────────────

async def test_register_success(client: httpx.AsyncClient):
    resp = await client.post(
        "/api/auth/register",
        json={"email": "newuser@example.com", "password": "password123", "name": "New User"},
    )
    assert resp.status_code == 201
    data = resp.json()
    assert data["email"] == "newuser@example.com"
    assert data["name"] == "New User"
    assert "password" not in data
    assert "password_hash" not in data


async def test_register_sets_cookie(client: httpx.AsyncClient):
    resp = await client.post(
        "/api/auth/register",
        json={"email": "cookie@example.com", "password": "password123"},
    )
    assert resp.status_code == 201
    assert "clarity_token" in resp.cookies


async def test_register_duplicate_email(client: httpx.AsyncClient):
    await register_user(client, email="dup@example.com")
    resp = await client.post(
        "/api/auth/register",
        json={"email": "dup@example.com", "password": "password123"},
    )
    assert resp.status_code == 409


async def test_register_short_password(client: httpx.AsyncClient):
    resp = await client.post(
        "/api/auth/register",
        json={"email": "short@example.com", "password": "abc"},
    )
    assert resp.status_code == 422


async def test_register_email_normalised(client: httpx.AsyncClient):
    resp = await client.post(
        "/api/auth/register",
        json={"email": "  Upper@EXAMPLE.COM  ", "password": "password123"},
    )
    assert resp.status_code == 201
    assert resp.json()["email"] == "upper@example.com"


async def test_register_admin_flag(client: httpx.AsyncClient):
    """A user whose email is in ADMIN_EMAILS env var should get is_admin=True."""
    resp = await client.post(
        "/api/auth/register",
        json={"email": "admin@test.com", "password": "password123"},
    )
    assert resp.status_code == 201
    assert resp.json()["is_admin"] is True


async def test_register_non_admin(client: httpx.AsyncClient):
    resp = await client.post(
        "/api/auth/register",
        json={"email": "regular@example.com", "password": "password123"},
    )
    assert resp.status_code == 201
    assert resp.json()["is_admin"] is False


# ── Login ─────────────────────────────────────────────────────────────────────

async def test_login_success(client: httpx.AsyncClient):
    await register_user(client, email="login@example.com", password="mypassword")
    resp = await client.post(
        "/api/auth/login",
        json={"email": "login@example.com", "password": "mypassword"},
    )
    assert resp.status_code == 200
    assert "clarity_token" in resp.cookies


async def test_login_wrong_password(client: httpx.AsyncClient):
    await register_user(client, email="wrongpw@example.com", password="correct")
    resp = await client.post(
        "/api/auth/login",
        json={"email": "wrongpw@example.com", "password": "wrong"},
    )
    assert resp.status_code == 401


async def test_login_unknown_email(client: httpx.AsyncClient):
    resp = await client.post(
        "/api/auth/login",
        json={"email": "nobody@example.com", "password": "password123"},
    )
    assert resp.status_code == 401


async def test_login_case_insensitive(client: httpx.AsyncClient):
    await register_user(client, email="case@example.com", password="password123")
    resp = await client.post(
        "/api/auth/login",
        json={"email": "CASE@EXAMPLE.COM", "password": "password123"},
    )
    assert resp.status_code == 200


# ── Logout ────────────────────────────────────────────────────────────────────

async def test_logout_clears_cookie(client: httpx.AsyncClient):
    await register_and_login(client, email="logout@example.com")
    resp = await client.post("/api/auth/logout")
    assert resp.status_code == 200
    # Cookie should be cleared (empty value or deleted)
    assert resp.cookies.get("clarity_token", "") == ""


# ── /me ───────────────────────────────────────────────────────────────────────

async def test_me_authenticated(client: httpx.AsyncClient):
    await register_and_login(client, email="me@example.com")
    resp = await client.get("/api/auth/me")
    assert resp.status_code == 200
    assert resp.json()["email"] == "me@example.com"


async def test_me_unauthenticated(client: httpx.AsyncClient):
    resp = await client.get("/api/auth/me")
    assert resp.status_code == 401


# ── JWT validation ────────────────────────────────────────────────────────────

async def test_invalid_token_rejected(client: httpx.AsyncClient):
    resp = await client.get(
        "/api/auth/me",
        cookies={"clarity_token": "this.is.not.a.valid.jwt"},
    )
    assert resp.status_code == 401


async def test_tampered_token_rejected(client: httpx.AsyncClient):
    """A JWT signed with a different secret should be rejected."""
    import jwt as pyjwt
    from datetime import datetime, timezone, timedelta

    fake_token = pyjwt.encode(
        {"sub": "999", "exp": datetime.now(timezone.utc) + timedelta(days=1)},
        "wrong-secret",
        algorithm="HS256",
    )
    resp = await client.get(
        "/api/auth/me",
        cookies={"clarity_token": fake_token},
    )
    assert resp.status_code == 401


# ── Password reset token placeholder (tested in test_password_reset.py) ───────
# (full tests are in test_password_reset.py once Task 2 is implemented)
