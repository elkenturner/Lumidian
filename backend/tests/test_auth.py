"""
Tests for authentication endpoints:
  POST /api/auth/register
  POST /api/auth/login
  POST /api/auth/logout
  GET  /api/auth/me
  JWT validation
  Password length enforcement
"""
import logging
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


# ── Task 2: Auth Event Logging ────────────────────────────────────────────────

async def test_failed_login_is_logged(client, caplog):
    """A wrong-password login attempt must emit a warning log."""
    with caplog.at_level(logging.WARNING, logger="app.routers.auth"):
        resp = await client.post("/api/auth/login", json={
            "email": "nobody@example.com",
            "password": "wrongpassword"
        })
    assert resp.status_code == 401
    assert any("failed login" in r.message.lower() for r in caplog.records)


# ── Task 3: Google OAuth Open Redirect Fix ────────────────────────────────────

from app.routers.auth import _safe_redirect_path


def test_safe_redirect_path_blocks_double_slash():
    assert _safe_redirect_path("//evil.com") == "/dashboard"


def test_safe_redirect_path_blocks_backslash():
    assert _safe_redirect_path("/\\evil.com") == "/dashboard"


def test_safe_redirect_path_blocks_external_url():
    assert _safe_redirect_path("https://evil.com") == "/dashboard"


def test_safe_redirect_path_allows_internal_paths():
    assert _safe_redirect_path("/dashboard") == "/dashboard"
    assert _safe_redirect_path("/content/123") == "/content/123"
    assert _safe_redirect_path("/settings/billing") == "/settings/billing"


def test_safe_redirect_path_handles_none():
    assert _safe_redirect_path(None) == "/dashboard"
    assert _safe_redirect_path("") == "/dashboard"


# ── Task 4: TOTP Setup Rate Limiting ─────────────────────────────────────────

async def test_totp_setup_rate_limited(client):
    """2FA setup must be rate-limited."""
    from app.routers.auth import _totp_setup_attempts
    from tests.conftest import AsyncSessionLocal
    from sqlalchemy import text
    _totp_setup_attempts.clear()

    email = "totp_rate@example.com"
    await register_and_login(client, email=email, password="password123")
    # Mark email as verified so get_current_user allows access
    async with AsyncSessionLocal() as db:
        await db.execute(
            text("UPDATE users SET email_verified = 1 WHERE email = :email"),
            {"email": email},
        )
        await db.commit()

    for _ in range(5):
        resp = await client.post("/api/auth/2fa/setup")
        assert resp.status_code in (200, 400, 403)

    resp = await client.post("/api/auth/2fa/setup")
    assert resp.status_code == 429


# ── Task 7: CSRF Origin Check Middleware ──────────────────────────────────────

@pytest.mark.asyncio
async def test_csrf_rejects_cross_origin_post(client):
    """POST from a disallowed Origin must be rejected with 403."""
    resp = await client.post(
        "/api/auth/login",
        json={"email": "test@test.com", "password": "pass"},
        headers={"origin": "https://evil.com"},
    )
    assert resp.status_code == 403


@pytest.mark.asyncio
async def test_csrf_allows_no_origin_header(client):
    """Requests without Origin header must pass through."""
    resp = await client.post(
        "/api/auth/login",
        json={"email": "nonexistent@test.com", "password": "pass"},
    )
    # Reaches auth handler — 401 not 403
    assert resp.status_code == 401


# ── Task 6: Password Reset Token Hashing ─────────────────────────────────────

@pytest.mark.asyncio
async def test_password_reset_token_stored_as_hash(client, db_session):
    """Reset token stored in DB must be a bcrypt hash, not the raw token."""
    from app.models import PasswordResetToken
    from sqlalchemy import select as sa_select

    # Register a user
    await client.post("/api/auth/register", json={
        "email": "hashtest@example.com", "password": "password123"
    })
    # Trigger a reset
    resp = await client.post("/api/auth/forgot-password", json={"email": "hashtest@example.com"})
    assert resp.status_code == 200

    # DB must store bcrypt hash ($2b$)
    result = await db_session.execute(sa_select(PasswordResetToken))
    tokens = result.scalars().all()
    assert len(tokens) > 0
    for t in tokens:
        assert t.token.startswith("$2b$"), f"Token not hashed: {t.token[:20]}"
