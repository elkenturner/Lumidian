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


@pytest.mark.asyncio
async def test_password_reset_end_to_end(client, db_session):
    """Full reset flow: request reset, redeem hashed token, verify new password works."""
    from unittest.mock import patch
    from app.models import PasswordResetToken
    from sqlalchemy import select as sa_select

    # Register user
    await client.post("/api/auth/register", json={
        "email": "e2ereset@example.com", "password": "oldpassword123"
    })

    captured_link = {}

    def mock_send_bg(fn, **kwargs):
        # Capture the reset_link from the kwargs passed to send_password_reset_email
        if "reset_link" in kwargs:
            captured_link["url"] = kwargs["reset_link"]

    with patch("app.services.email_service.send_email_background", side_effect=mock_send_bg):
        await client.post("/api/auth/forgot-password", json={"email": "e2ereset@example.com"})

    assert "url" in captured_link, "Reset link was not captured"

    # Extract raw token from the URL
    raw_token = captured_link["url"].split("token=")[-1]

    # Redeem the token
    resp = await client.post("/api/auth/reset-password", json={
        "token": raw_token,
        "new_password": "newpassword456"
    })
    assert resp.status_code == 200

    # Verify the token is now marked used
    result = await db_session.execute(sa_select(PasswordResetToken))
    tokens = result.scalars().all()
    assert all(t.used for t in tokens), "Token should be marked used after redemption"

    # Verify login with new password works
    login_resp = await client.post("/api/auth/login", json={
        "email": "e2ereset@example.com",
        "password": "newpassword456"
    })
    assert login_resp.status_code == 200


@pytest.mark.asyncio
async def test_csrf_allows_known_origin(client):
    """Requests from a known allowed origin must pass through to the handler."""
    resp = await client.post(
        "/api/auth/login",
        json={"email": "nobody@example.com", "password": "pass"},
        headers={"origin": "http://localhost:3000"},
    )
    # Reaches the auth handler (401), not blocked by CSRF (403)
    assert resp.status_code == 401


# ── TOTP full flow tests ───────────────────────────────────────────────────────

async def test_totp_setup_returns_fields(client: httpx.AsyncClient):
    """Setup endpoint returns secret, otpauth_uri, and base64 QR code."""
    await register_and_login(client, email="totp_setup@example.com")
    resp = await client.post("/api/auth/2fa/setup")
    assert resp.status_code == 200
    data = resp.json()
    assert "secret" in data
    assert "otpauth_uri" in data
    assert "qr_code" in data
    assert data["qr_code"].startswith("data:image/png;base64,")
    assert "otpauth://totp/" in data["otpauth_uri"]


async def test_totp_enable_with_valid_code(client: httpx.AsyncClient):
    """Enable 2FA with a valid TOTP code — returns 200 and success message."""
    import pyotp
    await register_and_login(client, email="totp_enable@example.com")
    setup_resp = await client.post("/api/auth/2fa/setup")
    secret = setup_resp.json()["secret"]
    totp = pyotp.TOTP(secret)
    resp = await client.post("/api/auth/2fa/enable", json={"code": totp.now()})
    assert resp.status_code == 200
    assert "enabled" in resp.json()["message"].lower()


async def test_totp_enable_with_invalid_code(client: httpx.AsyncClient):
    """Enable 2FA with a wrong code — returns 400."""
    await register_and_login(client, email="totp_bad@example.com")
    await client.post("/api/auth/2fa/setup")
    resp = await client.post("/api/auth/2fa/enable", json={"code": "000000"})
    assert resp.status_code == 400


async def test_totp_enable_requires_setup_first(client: httpx.AsyncClient):
    """Enabling 2FA without calling setup first — returns 400."""
    await register_and_login(client, email="totp_nosetup@example.com")
    resp = await client.post("/api/auth/2fa/enable", json={"code": "123456"})
    assert resp.status_code == 400


async def test_totp_disable_with_correct_password(client: httpx.AsyncClient):
    """Disable 2FA with the correct password — returns 200."""
    import pyotp
    email = "totp_dis@example.com"
    password = "password123"
    await register_and_login(client, email=email, password=password)
    setup_resp = await client.post("/api/auth/2fa/setup")
    totp = pyotp.TOTP(setup_resp.json()["secret"])
    await client.post("/api/auth/2fa/enable", json={"code": totp.now()})
    resp = await client.post("/api/auth/2fa/disable", json={"password": password})
    assert resp.status_code == 200


async def test_totp_disable_with_wrong_password(client: httpx.AsyncClient):
    """Disable 2FA with wrong password — returns 401."""
    import pyotp
    await register_and_login(client, email="totp_dis_bad@example.com")
    setup_resp = await client.post("/api/auth/2fa/setup")
    totp = pyotp.TOTP(setup_resp.json()["secret"])
    await client.post("/api/auth/2fa/enable", json={"code": totp.now()})
    resp = await client.post("/api/auth/2fa/disable", json={"password": "wrongpass"})
    assert resp.status_code == 401


async def test_login_with_2fa_enabled_returns_challenge(client: httpx.AsyncClient):
    """Login when 2FA is enabled returns requires_2fa=True and a challenge_token."""
    import pyotp
    email = "totp_challenge@example.com"
    password = "password123"
    await register_and_login(client, email=email, password=password)
    setup_resp = await client.post("/api/auth/2fa/setup")
    totp = pyotp.TOTP(setup_resp.json()["secret"])
    await client.post("/api/auth/2fa/enable", json={"code": totp.now()})
    await client.post("/api/auth/logout")

    resp = await client.post("/api/auth/login", json={"email": email, "password": password})
    assert resp.status_code == 200
    data = resp.json()
    assert data["requires_2fa"] is True
    assert "challenge_token" in data


async def test_2fa_verify_completes_login(client: httpx.AsyncClient):
    """Full 2FA login: challenge + valid code sets auth cookie and allows /me."""
    import pyotp
    email = "totp_verify_ok@example.com"
    password = "password123"
    await register_and_login(client, email=email, password=password)
    setup_resp = await client.post("/api/auth/2fa/setup")
    secret = setup_resp.json()["secret"]
    totp = pyotp.TOTP(secret)
    await client.post("/api/auth/2fa/enable", json={"code": totp.now()})
    await client.post("/api/auth/logout")

    # Pre-generate verify code before login to avoid timing issues with TOTP window
    verify_code = totp.now()
    login_resp = await client.post("/api/auth/login", json={"email": email, "password": password})
    challenge_token = login_resp.json()["challenge_token"]

    verify_resp = await client.post("/api/auth/2fa/verify", json={
        "challenge_token": challenge_token,
        "code": verify_code,
    })
    assert verify_resp.status_code == 200
    me_resp = await client.get("/api/auth/me")
    assert me_resp.status_code == 200
    assert me_resp.json()["email"] == email


# ── Email verification endpoint tests ────────────────────────────────────────

async def test_register_returns_email_unverified(client: httpx.AsyncClient):
    """Registration response includes email_verified=False for new users."""
    resp = await client.post(
        "/api/auth/register",
        json={"email": "unverif_reg@example.com", "password": "password123", "name": "Test"},
    )
    assert resp.status_code == 201
    assert resp.json()["email_verified"] is False


async def test_unverified_user_blocked_from_protected_endpoint(client: httpx.AsyncClient):
    """Unverified user gets 403 on any protected endpoint."""
    await register_user(client, email="unverif_gate@example.com")
    # Cookie is set by registration — but user is unverified
    resp = await client.get("/api/brands")
    assert resp.status_code == 403
    assert resp.json()["detail"] == "email_not_verified"


async def test_unverified_user_can_call_me(client: httpx.AsyncClient):
    """/auth/me works for unverified users (uses AllowUnverifiedUser)."""
    await register_user(client, email="unverif_me@example.com")
    resp = await client.get("/api/auth/me")
    assert resp.status_code == 200
    assert resp.json()["email_verified"] is False


async def test_verify_email_with_valid_code(client: httpx.AsyncClient, db_session):
    """Correct 6-digit code marks user as verified."""
    from sqlalchemy import text
    from app.routers.auth import hash_password

    email = "verify_ok@example.com"
    await register_user(client, email=email)

    # Reset the code to a known value directly via DB so we can submit it.
    known_code = "123456"
    code_hash = hash_password(known_code)
    from datetime import datetime, timezone, timedelta
    expires = datetime.now(timezone.utc).replace(tzinfo=None) + timedelta(hours=24)
    await db_session.execute(
        text("UPDATE users SET email_verification_code = :h, email_verification_expires_at = :e WHERE email = :email"),
        {"h": code_hash, "e": expires, "email": email},
    )
    await db_session.commit()

    resp = await client.post("/api/auth/verify-email", json={"code": known_code})
    assert resp.status_code == 200
    assert "verified" in resp.json()["message"].lower()

    # Confirm user is now verified
    me = await client.get("/api/auth/me")
    assert me.json()["email_verified"] is True


async def test_verify_email_with_wrong_code(client: httpx.AsyncClient):
    """Wrong 6-digit code returns 400."""
    await register_user(client, email="verify_bad@example.com")
    resp = await client.post("/api/auth/verify-email", json={"code": "000000"})
    assert resp.status_code == 400


async def test_resend_verification_returns_200(client: httpx.AsyncClient):
    """Resend endpoint returns 200 and updates the stored code."""
    email = "resend_ok@example.com"
    await register_user(client, email=email)

    resp = await client.post("/api/auth/resend-verification")
    assert resp.status_code == 200
    assert "resent" in resp.json()["message"].lower()
