"""
Tests for authentication endpoints:
  POST /api/auth/register
  POST /api/auth/login
  POST /api/auth/logout
  GET  /api/auth/me
  JWT validation
  Password complexity enforcement
  Email verification flow
"""
import logging

import httpx
import pytest

from tests.conftest import AsyncSessionLocal, register_and_login, register_user

pytestmark = pytest.mark.asyncio


# ── Register ──────────────────────────────────────────────────────────────────

async def test_register_success(client: httpx.AsyncClient):
    resp = await client.post(
        "/api/auth/register",
        json={"email": "newuser@example.com", "password": "Password123", "name": "New User"},
    )
    assert resp.status_code == 201
    data = resp.json()
    assert data["email"] == "newuser@example.com"
    assert data["needs_verification"] is True
    assert "password" not in data
    assert "password_hash" not in data


async def test_register_does_not_set_cookie(client: httpx.AsyncClient):
    resp = await client.post(
        "/api/auth/register",
        json={"email": "cookie@example.com", "password": "Password123"},
    )
    assert resp.status_code == 201
    assert "clarity_token" not in resp.cookies


async def test_register_duplicate_verified_email(client: httpx.AsyncClient):
    """Verified account blocks re-registration with same email."""
    await register_and_login(client, email="dup@example.com")
    resp = await client.post(
        "/api/auth/register",
        json={"email": "dup@example.com", "password": "Password123"},
    )
    assert resp.status_code == 409


async def test_register_allows_reuse_of_unverified_email(client: httpx.AsyncClient):
    """Unverified account can be replaced by re-registering the same email."""
    await register_user(client, email="reuse@example.com")
    resp = await client.post(
        "/api/auth/register",
        json={"email": "reuse@example.com", "password": "NewPassword1", "name": "Retry"},
    )
    assert resp.status_code == 201
    assert resp.json()["email"] == "reuse@example.com"


async def test_register_reuse_cascades_abandoned_brands(client: httpx.AsyncClient):
    """Re-registering an unverified email must wipe the abandoned user's brands.

    `brands.user_id` uses ON DELETE SET NULL, so if the re-register flow naively
    deleted the stale User it would orphan any brand/prompt/run rows created
    during onboarding — and the scheduler would keep sweeping them forever.
    This regression guards the cascade in auth.register.
    """
    from sqlalchemy import select

    from app.models import Brand, Prompt, User

    await register_user(client, email="abandon@example.com", password="Password123")

    # Grab the unverified user and stand up the kind of junk they would have
    # produced during the abandoned onboarding flow. We snapshot the password
    # hash because SQLite can reuse the old row's primary key after the cascade,
    # so the id alone is not a reliable identity check.
    async with AsyncSessionLocal() as db:
        stale_user = (
            await db.execute(select(User).where(User.email == "abandon@example.com"))
        ).scalar_one()
        stale_user_id = stale_user.id
        stale_password_hash = stale_user.password_hash
        brand = Brand(
            name="Abandoned Brand",
            slug="abandoned-brand",
            user_id=stale_user_id,
            brand_type="pitch",
        )
        db.add(brand)
        await db.flush()
        stale_brand_id = brand.id
        db.add(Prompt(brand_id=stale_brand_id, text="orphan prompt"))
        await db.commit()

    # Re-register with the same email — this must cascade-delete the user.
    resp = await client.post(
        "/api/auth/register",
        json={"email": "abandon@example.com", "password": "NewPassword1"},
    )
    assert resp.status_code == 201

    async with AsyncSessionLocal() as db:
        # Exactly one user exists under this email, and it's the fresh one
        # (different password hash than the abandoned account).
        users = (
            await db.execute(select(User).where(User.email == "abandon@example.com"))
        ).scalars().all()
        assert len(users) == 1
        assert users[0].password_hash != stale_password_hash

        # Abandoned brand and its prompt were cascaded, not orphaned.
        assert (
            await db.execute(select(Brand).where(Brand.id == stale_brand_id))
        ).scalar_one_or_none() is None
        orphans = (
            await db.execute(select(Brand).where(Brand.user_id.is_(None)))
        ).scalars().all()
        assert orphans == []
        prompts_left = (
            await db.execute(select(Prompt).where(Prompt.brand_id == stale_brand_id))
        ).scalars().all()
        assert prompts_left == []


async def test_register_weak_password_rejected(client: httpx.AsyncClient):
    resp = await client.post(
        "/api/auth/register",
        json={"email": "weak@example.com", "password": "abc"},
    )
    assert resp.status_code == 422


async def test_register_password_needs_uppercase(client: httpx.AsyncClient):
    resp = await client.post(
        "/api/auth/register",
        json={"email": "noup@example.com", "password": "password123"},
    )
    assert resp.status_code == 422
    assert "uppercase" in resp.json()["detail"].lower()


async def test_register_password_needs_lowercase(client: httpx.AsyncClient):
    resp = await client.post(
        "/api/auth/register",
        json={"email": "nolow@example.com", "password": "PASSWORD123"},
    )
    assert resp.status_code == 422
    assert "lowercase" in resp.json()["detail"].lower()


async def test_register_password_needs_digit(client: httpx.AsyncClient):
    resp = await client.post(
        "/api/auth/register",
        json={"email": "nodigit@example.com", "password": "PasswordAbc"},
    )
    assert resp.status_code == 422
    assert "number" in resp.json()["detail"].lower()


async def test_register_email_normalised(client: httpx.AsyncClient):
    resp = await client.post(
        "/api/auth/register",
        json={"email": "  Upper@EXAMPLE.COM  ", "password": "Password123"},
    )
    assert resp.status_code == 201
    assert resp.json()["email"] == "upper@example.com"


async def test_register_admin_flag(client: httpx.AsyncClient):
    """A user whose email is in ADMIN_EMAILS env var should get is_admin in the DB."""
    resp = await client.post(
        "/api/auth/register",
        json={"email": "admin@test.com", "password": "Password123"},
    )
    assert resp.status_code == 201
    # Registration returns minimal data; verify via DB
    from sqlalchemy import text
    async with AsyncSessionLocal() as db:
        row = await db.execute(text("SELECT is_admin FROM users WHERE email = 'admin@test.com'"))
        assert row.scalar_one() == 1


async def test_register_non_admin(client: httpx.AsyncClient):
    resp = await client.post(
        "/api/auth/register",
        json={"email": "regular@example.com", "password": "Password123"},
    )
    assert resp.status_code == 201
    from sqlalchemy import text
    async with AsyncSessionLocal() as db:
        row = await db.execute(text("SELECT is_admin FROM users WHERE email = 'regular@example.com'"))
        assert row.scalar_one() == 0


# ── Login ─────────────────────────────────────────────────────────────────────

async def test_login_success(client: httpx.AsyncClient):
    await register_and_login(client, email="login@example.com", password="MyPassword1")
    await client.post("/api/auth/logout")
    resp = await client.post(
        "/api/auth/login",
        json={"email": "login@example.com", "password": "MyPassword1"},
    )
    assert resp.status_code == 200
    assert "clarity_token" in resp.cookies


async def test_login_wrong_password(client: httpx.AsyncClient):
    await register_and_login(client, email="wrongpw@example.com", password="Correct123")
    await client.post("/api/auth/logout")
    resp = await client.post(
        "/api/auth/login",
        json={"email": "wrongpw@example.com", "password": "Wrong123456"},
    )
    assert resp.status_code == 401


async def test_login_unknown_email(client: httpx.AsyncClient):
    resp = await client.post(
        "/api/auth/login",
        json={"email": "nobody@example.com", "password": "Password123"},
    )
    assert resp.status_code == 401


async def test_login_case_insensitive(client: httpx.AsyncClient):
    await register_and_login(client, email="case@example.com", password="Password123")
    await client.post("/api/auth/logout")
    resp = await client.post(
        "/api/auth/login",
        json={"email": "CASE@EXAMPLE.COM", "password": "Password123"},
    )
    assert resp.status_code == 200


async def test_login_blocked_for_unverified_user(client: httpx.AsyncClient):
    """Unverified users get a 200 needs_verification response instead of a 403."""
    await register_user(client, email="unverif_login@example.com")
    resp = await client.post(
        "/api/auth/login",
        json={"email": "unverif_login@example.com", "password": "Password123"},
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data.get("needs_verification") is True
    assert data.get("email") == "unverif_login@example.com"
    # No auth cookies should be set
    assert "clarity_token" not in resp.cookies


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
    from datetime import datetime, timedelta, timezone

    import jwt as pyjwt

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


# ── Auth Event Logging ────────────────────────────────────────────────────────

async def test_failed_login_is_logged(client, caplog):
    """A wrong-password login attempt must emit a warning log."""
    with caplog.at_level(logging.WARNING, logger="app.routers.auth"):
        resp = await client.post("/api/auth/login", json={
            "email": "nobody@example.com",
            "password": "wrongpassword"
        })
    assert resp.status_code == 401
    assert any("failed login" in r.message.lower() for r in caplog.records)


# ── Google OAuth Open Redirect Fix ────────────────────────────────────────────

from datetime import UTC

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


# ── TOTP Setup Rate Limiting ─────────────────────────────────────────────────

async def test_totp_setup_rate_limited(client):
    """2FA setup must be rate-limited."""
    from app.routers.auth import _totp_setup_attempts
    _totp_setup_attempts.clear()

    email = "totp_rate@example.com"
    await register_and_login(client, email=email, password="Password123")

    for _ in range(5):
        resp = await client.post("/api/auth/2fa/setup")
        assert resp.status_code in (200, 400, 403)

    resp = await client.post("/api/auth/2fa/setup")
    assert resp.status_code == 429


# ── CSRF Origin Check Middleware ──────────────────────────────────────────────

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


# ── Password Reset Token Hashing ─────────────────────────────────────────────

@pytest.mark.asyncio
async def test_password_reset_token_stored_as_hash(client, db_session):
    """Reset token stored in DB must be a SHA-256 hash, not the raw token."""
    from sqlalchemy import select as sa_select

    from app.models import PasswordResetToken

    # Register a user
    await client.post("/api/auth/register", json={
        "email": "hashtest@example.com", "password": "Password123"
    })
    # Trigger a reset
    resp = await client.post("/api/auth/forgot-password", json={"email": "hashtest@example.com"})
    assert resp.status_code == 200

    # DB must store SHA-256 hash (64-char hex string, not the raw token)
    result = await db_session.execute(sa_select(PasswordResetToken))
    tokens = result.scalars().all()
    assert len(tokens) > 0
    for t in tokens:
        assert len(t.token) == 64 and all(c in "0123456789abcdef" for c in t.token), f"Token not hashed: {t.token[:20]}"


@pytest.mark.asyncio
async def test_password_reset_end_to_end(client, db_session):
    """Full reset flow: request reset, redeem hashed token, verify new password works."""
    from unittest.mock import patch

    from sqlalchemy import select as sa_select, text

    from app.models import PasswordResetToken

    # Register and verify user
    await client.post("/api/auth/register", json={
        "email": "e2ereset@example.com", "password": "OldPassword123"
    })
    async with AsyncSessionLocal() as db:
        await db.execute(text("UPDATE users SET email_verified = 1 WHERE email = 'e2ereset@example.com'"))
        await db.commit()

    captured_link = {}

    async def mock_send_awaited(fn, **kwargs):
        if "reset_link" in kwargs:
            captured_link["url"] = kwargs["reset_link"]
        return True

    with patch("app.services.email_service.send_email_awaited", side_effect=mock_send_awaited):
        await client.post("/api/auth/forgot-password", json={"email": "e2ereset@example.com"})

    assert "url" in captured_link, "Reset link was not captured"

    raw_token = captured_link["url"].split("token=")[-1]

    resp = await client.post("/api/auth/reset-password", json={
        "token": raw_token,
        "new_password": "NewPassword456"
    })
    assert resp.status_code == 200

    result = await db_session.execute(sa_select(PasswordResetToken))
    tokens = result.scalars().all()
    assert all(t.used for t in tokens), "Token should be marked used after redemption"

    login_resp = await client.post("/api/auth/login", json={
        "email": "e2ereset@example.com",
        "password": "NewPassword456"
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
    password = "Password123"
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
    resp = await client.post("/api/auth/2fa/disable", json={"password": "WrongPass1"})
    assert resp.status_code == 401


async def test_login_with_2fa_enabled_returns_challenge(client: httpx.AsyncClient):
    """Login when 2FA is enabled returns requires_2fa=True and a challenge_token."""
    import pyotp
    email = "totp_challenge@example.com"
    password = "Password123"
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
    password = "Password123"
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

async def test_verify_email_with_valid_code(client: httpx.AsyncClient, db_session):
    """Correct verification code marks user as verified."""
    from sqlalchemy import text

    from app.routers.auth import hash_password

    email = "verify_ok@example.com"
    await register_user(client, email=email)

    # Reset the code to a known value directly via DB so we can submit it.
    known_code = "123456"
    code_hash = hash_password(known_code)
    from datetime import datetime, timedelta
    expires = datetime.now(UTC).replace(tzinfo=None) + timedelta(hours=24)
    await db_session.execute(
        text("UPDATE users SET email_verification_code = :h, email_verification_expires_at = :e WHERE email = :email"),
        {"h": code_hash, "e": expires, "email": email},
    )
    await db_session.commit()

    resp = await client.post("/api/auth/verify-email", json={"email": email, "code": known_code})
    assert resp.status_code == 200
    assert "verified" in resp.json()["message"].lower()


async def test_verify_email_with_wrong_code(client: httpx.AsyncClient):
    """Wrong verification code returns 400."""
    email = "verify_bad@example.com"
    await register_user(client, email=email)
    resp = await client.post("/api/auth/verify-email", json={"email": email, "code": "000000"})
    assert resp.status_code == 400


async def test_resend_verification_returns_200(client: httpx.AsyncClient):
    """Resend endpoint returns 200."""
    email = "resend_ok@example.com"
    await register_user(client, email=email)

    resp = await client.post("/api/auth/resend-verification", json={"email": email})
    assert resp.status_code == 200


async def test_resend_verification_no_enumeration(client: httpx.AsyncClient):
    """Resend for unknown email returns 200 (no enumeration)."""
    resp = await client.post("/api/auth/resend-verification", json={"email": "nobody@example.com"})
    assert resp.status_code == 200


# ── Paused account ────────────────────────────────────────────────────────────

async def test_paused_user_gets_structured_403(client: httpx.AsyncClient):
    """Paused users hit /auth/me with a structured detail object so the
    frontend can detect this case via a stable code, not a brittle string match."""
    await register_and_login(client, email="paused@example.com")
    async with AsyncSessionLocal() as db:
        from sqlalchemy import text
        await db.execute(
            text("UPDATE users SET is_paused = 1 WHERE email = :e"),
            {"e": "paused@example.com"},
        )
        await db.commit()

    resp = await client.get("/api/auth/me")
    assert resp.status_code == 403
    body = resp.json()
    assert isinstance(body["detail"], dict), f"detail should be dict, got: {body['detail']}"
    assert body["detail"]["code"] == "account_paused"
    assert "paused" in body["detail"]["message"].lower()


async def test_paused_user_unverified_dep_gets_structured_403(client: httpx.AsyncClient):
    """The allow_unverified dependency is used by /auth/me and should also
    return the structured paused error so the same frontend handler works.

    We exercise the AllowUnverifiedUser dependency specifically by logging in
    with a verified account (to get a session cookie), then flipping
    email_verified back to 0 and is_paused to 1 in the DB.  The dep allows
    unverified users through but must still block paused ones.
    """
    # register_and_login gives us a valid session cookie
    await register_and_login(client, email="paused-unverified@example.com")
    async with AsyncSessionLocal() as db:
        from sqlalchemy import text
        # Simulate an unverified-but-paused account: flip both flags
        await db.execute(
            text("UPDATE users SET is_paused = 1, email_verified = 0 WHERE email = :e"),
            {"e": "paused-unverified@example.com"},
        )
        await db.commit()

    # /auth/me uses AllowUnverifiedUser — should return structured 403 for paused
    resp = await client.get("/api/auth/me")
    assert resp.status_code == 403
    body = resp.json()
    assert isinstance(body["detail"], dict)
    assert body["detail"]["code"] == "account_paused"


async def test_paused_admin_not_blocked(client: httpx.AsyncClient):
    """Admin users bypass the paused 403 check entirely."""
    await register_and_login(client, email="paused-admin@example.com")
    async with AsyncSessionLocal() as db:
        from sqlalchemy import text
        await db.execute(
            text("UPDATE users SET is_paused = 1, is_admin = 1 WHERE email = :e"),
            {"e": "paused-admin@example.com"},
        )
        await db.commit()

    resp = await client.get("/api/auth/me")
    assert resp.status_code == 200
    assert resp.json()["email"] == "paused-admin@example.com"


async def test_paused_user_can_still_logout(client: httpx.AsyncClient):
    """Logout endpoint must work for paused users — it doesn't depend on
    get_current_user, but this test guards against a future regression."""
    await register_and_login(client, email="paused-logout@example.com")
    async with AsyncSessionLocal() as db:
        from sqlalchemy import text
        await db.execute(
            text("UPDATE users SET is_paused = 1 WHERE email = :e"),
            {"e": "paused-logout@example.com"},
        )
        await db.commit()

    resp = await client.post("/api/auth/logout")
    assert resp.status_code == 200
    # Cookie cleared in response
    set_cookie = resp.headers.get("set-cookie", "")
    assert "clarity_token=" in set_cookie
    assert "Max-Age=0" in set_cookie or "max-age=0" in set_cookie or "expires=" in set_cookie.lower()


async def test_paused_user_cannot_call_protected_endpoints(client: httpx.AsyncClient):
    """Sanity: a paused user gets the structured 403 from any
    get_current_user-dependent endpoint, not just /auth/me."""
    await register_and_login(client, email="paused-protected@example.com")
    async with AsyncSessionLocal() as db:
        from sqlalchemy import text
        await db.execute(
            text("UPDATE users SET is_paused = 1 WHERE email = :e"),
            {"e": "paused-protected@example.com"},
        )
        await db.commit()

    resp = await client.get("/api/brands")  # uses get_current_user
    assert resp.status_code == 403
    body = resp.json()
    assert isinstance(body["detail"], dict)
    assert body["detail"]["code"] == "account_paused"


async def test_auth_me_includes_subscription_trial_end(client: httpx.AsyncClient):
    """The frontend BillingPausedBanner reads subscription_trial_end from
    /auth/me to detect 'trial ended' (status=trialing, trial_end in past)."""
    from datetime import datetime, timedelta, timezone

    await register_and_login(client, email="trial@example.com")
    trial_end = (datetime.now(timezone.utc) + timedelta(days=3)).replace(microsecond=0)
    async with AsyncSessionLocal() as db:
        from sqlalchemy import text
        await db.execute(
            text(
                "UPDATE users SET subscription_status = 'trialing', "
                "subscription_trial_end = :te WHERE email = :e"
            ),
            {"te": trial_end, "e": "trial@example.com"},
        )
        await db.commit()

    resp = await client.get("/api/auth/me")
    assert resp.status_code == 200
    data = resp.json()
    assert "subscription_trial_end" in data, f"missing field; got keys: {list(data.keys())}"
    assert data["subscription_trial_end"] is not None
    assert data["subscription_status"] == "trialing"
