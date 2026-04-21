"""
Auth router — registration, login, logout, session.

Routes
------
POST /api/auth/register            — create account
POST /api/auth/login               — authenticate, set cookie
POST /api/auth/logout              — clear cookie
GET  /api/auth/me                  — return current user
GET  /api/auth/google/url          — return Google OAuth authorization URL
GET  /api/auth/google/callback     — handle OAuth redirect, set cookie, redirect to app
POST /api/auth/google              — (legacy) exchange Google ID token for session
"""
from __future__ import annotations

import base64
import hashlib
import json
import logging
import os
import re
import secrets
import time
import urllib.parse
from collections import defaultdict
from datetime import UTC, datetime, timedelta
from typing import Annotated

import bcrypt
import httpx
import jwt
from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from fastapi.responses import JSONResponse, RedirectResponse
from pydantic import BaseModel, field_validator
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.dependencies import JWT_ALGORITHM, JWT_SECRET, AllowUnverifiedUser, get_current_user
from app.models import PasswordResetToken, User

logger = logging.getLogger(__name__)

_SAFE_PATH_RE = re.compile(r'^/[a-zA-Z0-9/_\-?=&%#.]*$')


def _safe_redirect_path(state: str | None) -> str:
    """Validate an OAuth state parameter is a safe internal path.
    Rejects anything with double-slash, backslash, or non-path characters."""
    if not state:
        return "/dashboard"
    if not _SAFE_PATH_RE.match(state):
        return "/dashboard"
    # Reject double-slash (protocol-relative URLs like //evil.com)
    if "//" in state:
        return "/dashboard"
    return state


router = APIRouter(prefix="/auth", tags=["auth"])

# ── Rate limiting (DB-backed, survives restarts) ─────────────────────────────
_RATE_WINDOW = 60.0     # sliding 1-minute window
_MAX_LOGIN = 10         # 10 attempts / minute / IP
_MAX_REGISTER = 5       # 5 attempts / minute / IP
_MAX_VERIFY = 10        # 10 attempts / minute / IP
_MAX_RESEND = 3         # 3 attempts / minute / IP (prevent email flooding)
_MAX_TOTP_SETUP = 5     # 5 setups / minute / user_id
_MAX_RESET = 5          # 5 attempts / minute / IP
_MAX_VERIFY_PER_EMAIL = 5   # 5 failed attempts per email, then lock for 15 minutes
_VERIFY_LOCKOUT_SECS = 900  # 15-minute lockout after max failed attempts

# In-memory fallback stores — used by tests and as fallback when no DB session
_login_attempts: dict = defaultdict(list)
_register_attempts: dict = defaultdict(list)
_verify_attempts: dict = defaultdict(list)
_resend_attempts: dict = defaultdict(list)
_totp_setup_attempts: dict = defaultdict(list)
_reset_attempts: dict = defaultdict(list)
# Per-email verification failure tracking: {email: (fail_count, first_fail_time)}
_verify_email_failures: dict[str, tuple[int, float]] = {}


def _get_client_ip(request: Request) -> str:
    """Extract real client IP from X-Forwarded-For header (set by Railway/Fastly proxy).
    Falls back to request.client.host for direct connections (e.g. local dev)."""
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        # X-Forwarded-For format: "client, proxy1, proxy2" — first entry is the real client
        return forwarded.split(",")[0].strip()
    return request.client.host if request.client else "unknown"


async def _rate_check_db(key: str, endpoint: str, limit: int, db) -> None:
    """DB-backed rate check. Counts recent entries in the rate_limits table.
    Falls back to in-memory check if the table doesn't exist (e.g. in tests)."""
    now = time.time()
    cutoff = now - _RATE_WINDOW

    try:
        result = await db.execute(
            text("SELECT COUNT(*) FROM rate_limits WHERE key = :key AND endpoint = :ep AND created_at > :cutoff"),
            {"key": key, "ep": endpoint, "cutoff": cutoff},
        )
        count = result.scalar()
        if count >= limit:
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail="Too many requests — please try again later.",
            )
        await db.execute(
            text("INSERT INTO rate_limits (key, endpoint, created_at) VALUES (:key, :ep, :now)"),
            {"key": key, "ep": endpoint, "now": now},
        )
        # Prune old entries periodically (~1% of requests)
        import random
        if random.random() < 0.01:
            await db.execute(
                text("DELETE FROM rate_limits WHERE created_at < :cutoff"),
                {"cutoff": cutoff},
            )
        await db.flush()
    except Exception as e:
        if "no such table" in str(e):
            # Fallback to in-memory (tests or pre-migration)
            _fallback_stores = {
                "register": _register_attempts, "login": _login_attempts,
                "verify": _verify_attempts, "resend": _resend_attempts,
                "reset": _reset_attempts, "totp_setup": _totp_setup_attempts,
            }
            store = _fallback_stores.get(endpoint, _login_attempts)
            _rate_check(key, store, limit)
        else:
            raise


def _rate_check(ip: str, store: dict, limit: int) -> None:
    """In-memory rate check fallback (used by tests)."""
    now = time.monotonic()
    cutoff = now - _RATE_WINDOW
    store[ip] = [t for t in store[ip] if t > cutoff]
    if len(store[ip]) >= limit:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Too many requests — please try again later.",
        )
    store[ip].append(now)

    # Prune all IPs: re-filter timestamps and remove keys with no recent attempts
    for k in list(store):
        store[k] = [t for t in store[k] if t > cutoff]
        if not store[k]:
            del store[k]

DbDep = Annotated[AsyncSession, Depends(get_db)]

# Admin emails from env — comma-separated. Requires explicit ADMIN_EMAILS env var.
_raw_admin_emails = os.getenv("ADMIN_EMAILS", "")
_ADMIN_EMAILS: set[str] = {e.strip().lower() for e in _raw_admin_emails.split(",") if e.strip()}

# Use secure cookies when ENVIRONMENT=production
_COOKIE_SECURE = os.getenv("ENVIRONMENT", "development").lower() == "production"


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def verify_password(password: str, hashed: str) -> bool:
    return bcrypt.checkpw(password.encode("utf-8"), hashed.encode("utf-8"))

COOKIE_MAX_AGE = 60 * 60 * 24 * 7  # 7 days

from app.routers.billing import TIER_LIMITS  # noqa: E402 — single source of truth


def _validate_password(password: str) -> None:
    """Enforce password complexity: 8+ chars, uppercase, lowercase, digit."""
    errors: list[str] = []
    if len(password) < 8:
        errors.append("at least 8 characters")
    if not re.search(r"[A-Z]", password):
        errors.append("one uppercase letter")
    if not re.search(r"[a-z]", password):
        errors.append("one lowercase letter")
    if not re.search(r"\d", password):
        errors.append("one number")
    if errors:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Password must contain {', '.join(errors)}.",
        )


def create_token(user_id: int) -> str:
    payload = {
        "sub": str(user_id),
        "iat": datetime.now(UTC),
        "exp": datetime.now(UTC) + timedelta(days=7),
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)


def set_auth_cookies(response: Response, token: str) -> None:
    response.set_cookie(
        "clarity_token",
        token,
        httponly=True,
        secure=_COOKIE_SECURE,
        samesite="lax",
        max_age=COOKIE_MAX_AGE,
        path="/",
    )
    # Non-httpOnly session flag for Next.js middleware
    response.set_cookie(
        "clarity_session",
        "1",
        httponly=False,
        secure=_COOKIE_SECURE,
        samesite="lax",
        max_age=COOKIE_MAX_AGE,
        path="/",
    )


def clear_auth_cookies(response: Response) -> None:
    response.delete_cookie("clarity_token", path="/")
    response.delete_cookie("clarity_session", path="/")


def user_to_dict(user: User) -> dict:
    limit = 999999 if user.is_admin else TIER_LIMITS.get(user.subscription_tier or "", 10)
    return {
        "id": user.id,
        "email": user.email,
        "name": user.name,
        "subscription_tier": user.subscription_tier,
        "subscription_status": user.subscription_status,
        "is_admin": user.is_admin,
        "prompt_limit": limit,
        "totp_enabled": bool(user.totp_enabled),
        "created_at": user.created_at.isoformat() if user.created_at else None,
        "email_verified": bool(getattr(user, "email_verified", True)),
    }


# ── Register ──────────────────────────────────────────────────────────────────

class RegisterRequest(BaseModel):
    email: str
    password: str
    name: str | None = None

    @field_validator("name")
    @classmethod
    def validate_name(cls, v: str | None) -> str | None:
        if v is None:
            return v
        if len(v) > 100:
            raise ValueError("Name must be 100 characters or fewer")
        if re.search(r"[<>]", v):
            raise ValueError("Name contains invalid characters")
        return v

    @field_validator("email")
    @classmethod
    def validate_email_format(cls, v: str) -> str:
        v = v.strip().lower()
        if not v or "@" not in v or "." not in v.split("@")[-1]:
            raise ValueError("Invalid email address")
        if len(v) > 255:
            raise ValueError("Email too long")
        # Reject HTML/script tags in email
        if re.search(r"[<>]", v):
            raise ValueError("Invalid email address")
        # Basic email format: local part + @ + domain
        if not re.match(r"^[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}$", v):
            raise ValueError("Invalid email address")
        return v


@router.post("/register", status_code=status.HTTP_201_CREATED)
async def register(body: RegisterRequest, http_req: Request, response: Response, db: DbDep):
    request = body
    await _rate_check_db(_get_client_ip(http_req), "register", _MAX_REGISTER, db)
    email = request.email.strip().lower()

    _validate_password(request.password)

    existing_result = await db.execute(select(User).where(User.email == email))
    existing = existing_result.scalar_one_or_none()
    if existing:
        if existing.email_verified:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Email already registered")
        # Unverified account with this email — replace it so the user can re-register.
        # Must cascade: the abandoned user may have created a pitch brand during
        # onboarding, and brands.user_id uses SET NULL on delete, which would orphan
        # the brand and leave the scheduler sweeping it forever.
        from app.services.user_service import cascade_delete_user
        brands_removed = await cascade_delete_user(db, existing.id)
        await db.flush()
        if brands_removed:
            logger.info(
                "register: replaced unverified user %s — cascaded %d brand(s)",
                email, brands_removed,
            )

    verification_code = f"{secrets.randbelow(100_000_000):08d}"
    code_hash = hash_password(verification_code)
    code_expires_at = datetime.now(UTC).replace(tzinfo=None) + timedelta(hours=24)

    password_hash = hash_password(request.password)
    user = User(
        email=email,
        password_hash=password_hash,
        name=request.name or email.split("@")[0],
        is_admin=(email in _ADMIN_EMAILS),
        email_verified=False,
        email_verification_code=code_hash,
        email_verification_expires_at=code_expires_at,
    )
    db.add(user)
    await db.commit()
    await db.refresh(user)

    # Do NOT set auth cookies — user must verify email first (verify-email sets cookies).

    from app.services.analytics_service import log_event
    await log_event("user_registered", {"plan": user.subscription_tier}, user_id=user.id)

    from app.services.email_service import send_email_awaited, send_email_verification
    email_ok = await send_email_awaited(send_email_verification, email=user.email, name=user.name, code=verification_code)
    if not email_ok:
        logger.error("Registration verification email failed for %s", user.email)

    return {"email": email, "needs_verification": True}


# ── Login ─────────────────────────────────────────────────────────────────────

class LoginRequest(BaseModel):
    email: str
    password: str


def create_challenge_token(user_id: int) -> str:
    """Short-lived token used as a 2FA challenge during login (5 min, scope='2fa_challenge')."""
    payload = {
        "sub": str(user_id),
        "scope": "2fa_challenge",
        "exp": datetime.now(UTC) + timedelta(minutes=5),
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)


@router.post("/login")
async def login(body: LoginRequest, http_req: Request, response: Response, db: DbDep):
    await _rate_check_db(_get_client_ip(http_req), "login", _MAX_LOGIN, db)
    request = body
    email = request.email.strip().lower()
    result = await db.execute(select(User).where(User.email == email))
    user = result.scalar_one_or_none()
    if not user or not user.password_hash or not verify_password(request.password, user.password_hash):
        logger.warning("failed login attempt email=%s ip=%s", email, _get_client_ip(http_req))
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid email or password")

    if not getattr(user, "email_verified", True):
        return JSONResponse(
            status_code=status.HTTP_200_OK,
            content={"email": user.email, "needs_verification": True},
        )

    # If 2FA is enabled, issue a short-lived challenge token instead of a session
    if user.totp_enabled:
        challenge_token = create_challenge_token(user.id)
        return {"requires_2fa": True, "challenge_token": challenge_token}

    token = create_token(user.id)
    set_auth_cookies(response, token)

    from app.services.analytics_service import log_event
    await log_event("user_login", {}, user_id=user.id)

    return user_to_dict(user)


# ── Logout ────────────────────────────────────────────────────────────────────

@router.post("/logout")
async def logout(response: Response):
    clear_auth_cookies(response)
    return {"message": "Logged out"}


# ── Me ────────────────────────────────────────────────────────────────────────

@router.get("/me")
async def get_me(user: AllowUnverifiedUser, db: DbDep):
    from sqlalchemy import select as sa_select

    from app.models import TeamMember

    data = user_to_dict(user)

    # Check if this user is a team member — if so, include owner info
    tm_result = await db.execute(
        sa_select(TeamMember).where(
            TeamMember.user_id == user.id,
            TeamMember.accepted_at.is_not(None),
        ).limit(1)
    )
    membership = tm_result.scalar_one_or_none()
    if membership:
        owner_result = await db.execute(sa_select(User).where(User.id == membership.account_owner_id))
        owner = owner_result.scalar_one_or_none()
        data["is_team_member"] = True
        data["team_owner_name"] = owner.name if owner else None
        data["team_owner_email"] = owner.email if owner else None
    else:
        data["is_team_member"] = False
        data["team_owner_name"] = None
        data["team_owner_email"] = None

    return data


# ── Google OAuth ──────────────────────────────────────────────────────────────

class GoogleAuthRequest(BaseModel):
    id_token: str


@router.post("/google")
async def google_auth(request: GoogleAuthRequest, response: Response, db: DbDep):
    """Verify a Google ID token and create/login the user."""
    google_client_id = os.getenv("GOOGLE_CLIENT_ID", "")
    if not google_client_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Google OAuth not configured. Set GOOGLE_CLIENT_ID in environment.",
        )

    try:
        from google.auth.transport import requests as google_requests
        from google.oauth2 import id_token as google_id_token
        id_info = google_id_token.verify_oauth2_token(
            request.id_token,
            google_requests.Request(),
            google_client_id,
        )
        google_id = id_info["sub"]
        email = id_info.get("email", "").lower()
        name = id_info.get("name")
    except Exception as exc:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=f"Invalid Google token: {exc}")

    if not email:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Google account does not have a verified email address.",
        )

    # Only auto-link if Google confirms the email is verified
    google_email_verified = id_info.get("email_verified", False)

    # Find or create user
    result = await db.execute(select(User).where(User.google_id == google_id))
    user = result.scalar_one_or_none()

    if not user:
        # Try matching by email
        result = await db.execute(select(User).where(User.email == email))
        user = result.scalar_one_or_none()
        if user:
            if not google_email_verified:
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="Cannot link account: Google email is not verified.",
                )
            user.google_id = google_id
        else:
            user = User(
                email=email,
                google_id=google_id,
                name=name,
                is_admin=(email in _ADMIN_EMAILS),
                email_verified=google_email_verified,
            )
            db.add(user)

    await db.commit()
    await db.refresh(user)

    token = create_token(user.id)
    set_auth_cookies(response, token)
    return user_to_dict(user)


# ── Google OAuth — redirect flow ──────────────────────────────────────────────

def _google_redirect_uri() -> str:
    """
    The callback URL registered in Google Cloud Console.
    Routes through the Next.js dev proxy so cookies land on the frontend origin.
    """
    frontend_url = os.getenv("FRONTEND_URL", "http://localhost:3000")
    return f"{frontend_url}/api/auth/google/callback"


@router.get("/google/url")
async def google_auth_url(response: Response, redirect_to: str = "/dashboard"):
    """Return the Google OAuth authorization URL. Frontend redirects the user there."""
    client_id = os.getenv("GOOGLE_CLIENT_ID", "")
    if not client_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Google OAuth not configured. Set GOOGLE_CLIENT_ID in environment.",
        )
    # Generate CSRF token and encode state as JSON with redirect path
    csrf_token = secrets.token_urlsafe(32)
    state_payload = json.dumps({"csrf": csrf_token, "redirect": redirect_to})
    state_b64 = base64.urlsafe_b64encode(state_payload.encode()).decode()

    params = {
        "client_id": client_id,
        "redirect_uri": _google_redirect_uri(),
        "response_type": "code",
        "scope": "openid email profile",
        "state": state_b64,
        "access_type": "online",
        "prompt": "select_account",  # always show account chooser
    }
    url = "https://accounts.google.com/o/oauth2/v2/auth?" + urllib.parse.urlencode(params)

    # Store CSRF token hash in httpOnly cookie (5-minute lifetime)
    _COOKIE_SECURE_LOCAL = os.getenv("ENVIRONMENT", "development").lower() == "production"
    response.set_cookie(
        "oauth_csrf",
        hashlib.sha256(csrf_token.encode()).hexdigest(),
        httponly=True,
        secure=_COOKIE_SECURE_LOCAL,
        samesite="lax",
        max_age=300,
        path="/",
    )
    return {"url": url}


@router.get("/google/callback")
async def google_auth_callback(
    request: Request,
    db: DbDep,
    code: str | None = None,
    state: str | None = None,
    error: str | None = None,
):
    """
    Google redirects here after the user authenticates.
    Exchange the auth code for an id_token, find/create the user,
    set auth cookies, and redirect to the app.
    """
    frontend_url = os.getenv("FRONTEND_URL", "http://localhost:3000")

    # Parse state and verify CSRF token
    redirect_to = "/dashboard"
    if state:
        try:
            state_payload = json.loads(base64.urlsafe_b64decode(state))
            csrf_token = state_payload.get("csrf", "")
            redirect_to = _safe_redirect_path(state_payload.get("redirect"))

            stored_hash = request.cookies.get("oauth_csrf", "")
            expected_hash = hashlib.sha256(csrf_token.encode()).hexdigest()
            if not stored_hash or not secrets.compare_digest(stored_hash, expected_hash):
                logger.warning("google_callback: CSRF state mismatch")
                return RedirectResponse(
                    f"{frontend_url}/login?error=csrf_mismatch", status_code=302
                )
        except (json.JSONDecodeError, ValueError, KeyError):
            logger.warning("google_callback: malformed state parameter")
            return RedirectResponse(
                f"{frontend_url}/login?error=invalid_state", status_code=302
            )
    else:
        logger.warning("google_callback: missing state parameter")
        return RedirectResponse(
            f"{frontend_url}/login?error=missing_state", status_code=302
        )

    # Google signalled an error (e.g. user cancelled)
    if error:
        return RedirectResponse(
            f"{frontend_url}/login?error={urllib.parse.quote(error)}",
            status_code=302,
        )

    if not code:
        return RedirectResponse(f"{frontend_url}/login?error=missing_code", status_code=302)

    client_id = os.getenv("GOOGLE_CLIENT_ID", "")
    client_secret = os.getenv("GOOGLE_CLIENT_SECRET", "")
    if not client_id or not client_secret:
        return RedirectResponse(
            f"{frontend_url}/login?error=oauth_not_configured", status_code=302
        )

    # Exchange authorization code for tokens
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            token_resp = await client.post(
                "https://oauth2.googleapis.com/token",
                data={
                    "code": code,
                    "client_id": client_id,
                    "client_secret": client_secret,
                    "redirect_uri": _google_redirect_uri(),
                    "grant_type": "authorization_code",
                },
            )
            if token_resp.status_code != 200:
                logger.error(
                    "google_callback: token exchange returned HTTP %s — %s",
                    token_resp.status_code,
                    token_resp.text[:500],
                )
                return RedirectResponse(
                    f"{frontend_url}/login?error=token_exchange_failed", status_code=302
                )
            try:
                token_data = token_resp.json()
            except (ValueError, json.JSONDecodeError):
                logger.error(
                    "google_callback: token response was not valid JSON — %s",
                    token_resp.text[:500],
                )
                return RedirectResponse(
                    f"{frontend_url}/login?error=token_exchange_failed", status_code=302
                )
    except Exception as exc:
        logger.error("google_callback: token exchange failed — %s", exc)
        return RedirectResponse(
            f"{frontend_url}/login?error=token_exchange_failed", status_code=302
        )

    id_token_str = token_data.get("id_token", "")
    if not id_token_str:
        return RedirectResponse(
            f"{frontend_url}/login?error=no_id_token", status_code=302
        )

    # Verify and decode the id_token
    try:
        from google.auth.transport import requests as google_requests
        from google.oauth2 import id_token as google_id_token
        id_info = google_id_token.verify_oauth2_token(
            id_token_str,
            google_requests.Request(),
            client_id,
        )
        google_sub = id_info["sub"]
        email = id_info.get("email", "").lower()
        name = id_info.get("name")
    except Exception as exc:
        logger.error("google_callback: id_token verification failed — %s", exc)
        return RedirectResponse(
            f"{frontend_url}/login?error=token_invalid", status_code=302
        )

    if not email:
        return RedirectResponse(
            f"{frontend_url}/login?error=no_email", status_code=302
        )

    # Only auto-link if Google confirms the email is verified
    google_email_verified = id_info.get("email_verified", False)

    # Find or create user — same logic as POST /google
    result = await db.execute(select(User).where(User.google_id == google_sub))
    user = result.scalar_one_or_none()
    if not user:
        result = await db.execute(select(User).where(User.email == email))
        user = result.scalar_one_or_none()
        if user:
            if not google_email_verified:
                return RedirectResponse(
                    f"{frontend_url}/login?error=google_email_not_verified", status_code=302
                )
            user.google_id = google_sub
        else:
            user = User(
                email=email,
                google_id=google_sub,
                name=name,
                is_admin=(email in _ADMIN_EMAILS),
                email_verified=google_email_verified,
            )
            db.add(user)
    await db.commit()
    await db.refresh(user)

    token = create_token(user.id)

    # Set auth cookies on the redirect response
    _COOKIE_SECURE_LOCAL = os.getenv("ENVIRONMENT", "development").lower() == "production"
    redirect_response = RedirectResponse(
        url=f"{frontend_url}{redirect_to}",
        status_code=302,
    )
    redirect_response.set_cookie(
        "clarity_token",
        token,
        httponly=True,
        secure=_COOKIE_SECURE_LOCAL,
        samesite="lax",
        max_age=COOKIE_MAX_AGE,
        path="/",
    )
    # Non-httpOnly flag so Next.js middleware can detect the session
    redirect_response.set_cookie(
        "clarity_session",
        "1",
        httponly=False,
        secure=_COOKIE_SECURE_LOCAL,
        samesite="lax",
        max_age=COOKIE_MAX_AGE,
        path="/",
    )

    # Clear the CSRF cookie
    redirect_response.delete_cookie("oauth_csrf", path="/")

    from app.services.analytics_service import log_event
    await log_event("user_google_login", {}, user_id=user.id)

    return redirect_response


# ── Forgot password ───────────────────────────────────────────────────────────

class ForgotPasswordRequest(BaseModel):
    email: str


@router.post("/forgot-password", status_code=status.HTTP_200_OK)
async def forgot_password(request: ForgotPasswordRequest, http_req: Request, db: DbDep):
    """
    Generate a 1-hour password reset token and log the reset link to console.
    Always returns 200 to avoid user enumeration.
    """
    await _rate_check_db(_get_client_ip(http_req), "reset", _MAX_RESET, db)
    email = request.email.strip().lower()
    result = await db.execute(select(User).where(User.email == email))
    user = result.scalar_one_or_none()

    if user:
        # Invalidate any existing unused tokens for this user
        from sqlalchemy import update as sa_update
        await db.execute(
            sa_update(PasswordResetToken)
            .where(PasswordResetToken.user_id == user.id, PasswordResetToken.used == False)
            .values(used=True)
        )

        import hashlib
        token_value = secrets.token_urlsafe(48)
        token_hash = hashlib.sha256(token_value.encode()).hexdigest()
        expires_at = datetime.now(UTC).replace(tzinfo=None) + timedelta(hours=1)
        reset_token = PasswordResetToken(
            user_id=user.id,
            token=token_hash,   # SHA-256 hash (token is high-entropy, bcrypt unnecessary)
            expires_at=expires_at,
        )
        db.add(reset_token)
        await db.commit()

        frontend_url = os.getenv("FRONTEND_URL", "http://localhost:3000")
        reset_link = f"{frontend_url}/reset-password?token={token_value}"  # raw token in URL

        from app.services.email_service import send_email_awaited, send_password_reset_email
        email_ok = await send_email_awaited(send_password_reset_email, email=user.email, name=user.name, reset_link=reset_link)
        if not email_ok:
            logger.error("Password reset email failed for %s", user.email)

    return {"message": "If that email is registered, a reset link has been sent."}


# ── Reset password ─────────────────────────────────────────────────────────────

class ResetPasswordRequest(BaseModel):
    token: str
    new_password: str


@router.post("/reset-password", status_code=status.HTTP_200_OK)
async def reset_password(request: ResetPasswordRequest, http_req: Request, db: DbDep):
    """Validate reset token and update user's password."""
    await _rate_check_db(_get_client_ip(http_req), "reset", _MAX_RESET, db)
    _validate_password(request.new_password)

    # Direct lookup by SHA-256 hash of the submitted token
    import hashlib
    token_hash = hashlib.sha256(request.token.encode()).hexdigest()
    now_lookup = datetime.now(UTC).replace(tzinfo=None)
    candidate_result = await db.execute(
        select(PasswordResetToken).where(
            PasswordResetToken.token == token_hash,
            PasswordResetToken.used == False,
            PasswordResetToken.expires_at > now_lookup,
        )
    )
    reset_token = candidate_result.scalar_one_or_none()

    if not reset_token:
        logger.warning("invalid password reset token attempt")
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid or expired reset token")

    # Update password
    user_result = await db.execute(select(User).where(User.id == reset_token.user_id))
    user = user_result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="User not found")

    user.password_hash = hash_password(request.new_password)
    user.password_changed_at = datetime.now(UTC).replace(tzinfo=None)
    reset_token.used = True
    await db.commit()

    return {"message": "Password updated successfully"}


# ── Change password (authenticated) ──────────────────────────────────────────

class ChangePasswordRequest(BaseModel):
    current_password: str
    new_password: str


@router.post("/change-password", status_code=status.HTTP_200_OK)
async def change_password(
    body: ChangePasswordRequest,
    db: DbDep,
    current_user: Annotated[User, Depends(get_current_user)],
):
    """Authenticated password change — requires current password."""
    if not current_user.password_hash:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Account uses social login. Set a password via the reset flow.",
        )

    if not verify_password(body.current_password, current_user.password_hash):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Current password is incorrect.",
        )

    _validate_password(body.new_password)

    current_user.password_hash = hash_password(body.new_password)
    current_user.password_changed_at = datetime.now(UTC).replace(tzinfo=None)
    await db.commit()

    return {"message": "Password updated successfully"}


# ── Email verification ────────────────────────────────────────────────────────

class VerifyEmailRequest(BaseModel):
    email: str
    code: str


@router.post("/verify-email", status_code=status.HTTP_200_OK)
async def verify_email(
    body: VerifyEmailRequest,
    http_req: Request,
    db: DbDep,
):
    """Validate the 8-digit code and mark the user's email as verified.
    No auth cookie required — uses email + code for identification."""
    await _rate_check_db(_get_client_ip(http_req), "verify", _MAX_VERIFY, db)

    email = body.email.strip().lower()

    # Per-email brute-force protection: lock after N failed attempts
    now_mono = time.monotonic()
    fail_count, first_fail = _verify_email_failures.get(email, (0, 0.0))
    if fail_count >= _MAX_VERIFY_PER_EMAIL:
        if now_mono - first_fail < _VERIFY_LOCKOUT_SECS:
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail="Too many failed attempts. Please wait 15 minutes before trying again.",
            )
        # Lockout expired — reset
        _verify_email_failures.pop(email, None)

    result = await db.execute(select(User).where(User.email == email))
    user = result.scalar_one_or_none()

    if not user:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid code. Please try again.")

    if getattr(user, "email_verified", True):
        return {"message": "Email already verified"}

    if not user.email_verification_code or not user.email_verification_expires_at:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No pending verification. Please resend the code.",
        )

    now = datetime.now(UTC).replace(tzinfo=None)
    if user.email_verification_expires_at < now:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Code expired. Please request a new one.",
        )

    if not verify_password(body.code.strip(), user.email_verification_code):
        # Track per-email failure
        prev_count, prev_first = _verify_email_failures.get(email, (0, 0.0))
        if prev_count == 0:
            _verify_email_failures[email] = (1, now_mono)
        else:
            _verify_email_failures[email] = (prev_count + 1, prev_first)
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid code. Please try again.",
        )

    # Success — clear failure tracking for this email
    _verify_email_failures.pop(email, None)

    user.email_verified = True
    user.email_verification_code = None
    user.email_verification_expires_at = None
    await db.commit()

    # Auto-login: set auth cookies so the user doesn't have to log in again
    token = create_token(user.id)
    resp = JSONResponse(content={"message": "Email verified successfully", "user": user_to_dict(user)})
    set_auth_cookies(resp, token)
    return resp


class ResendVerificationRequest(BaseModel):
    email: str


@router.post("/resend-verification", status_code=status.HTTP_200_OK)
async def resend_verification(
    body: ResendVerificationRequest,
    http_req: Request,
    db: DbDep,
):
    """Generate a fresh 8-digit code and resend the verification email.
    No auth cookie required — uses email for identification."""
    await _rate_check_db(_get_client_ip(http_req), "resend", _MAX_RESEND, db)

    email = body.email.strip().lower()
    result = await db.execute(select(User).where(User.email == email))
    user = result.scalar_one_or_none()

    # Always return success to prevent email enumeration
    if not user or getattr(user, "email_verified", True):
        return {"message": "If that email is pending verification, a new code has been sent."}

    verification_code = f"{secrets.randbelow(100_000_000):08d}"
    code_hash = hash_password(verification_code)
    code_expires_at = datetime.now(UTC).replace(tzinfo=None) + timedelta(hours=24)

    user.email_verification_code = code_hash
    user.email_verification_expires_at = code_expires_at
    await db.commit()

    from app.services.email_service import send_email_awaited, send_email_verification
    email_ok = await send_email_awaited(
        send_email_verification,
        email=user.email,
        name=user.name,
        code=verification_code,
    )
    if not email_ok:
        logger.error("Resend verification email failed for %s", user.email)

    return {"message": "If that email is pending verification, a new code has been sent."}


# ── Two-Factor Authentication (TOTP) ──────────────────────────────────────────

@router.post("/2fa/setup")
async def setup_2fa(
    current_user: Annotated[User, Depends(get_current_user)],
    db: DbDep,
):
    """
    Generate (or regenerate) a TOTP secret for the authenticated user.
    Returns the provisioning URI and a base64-encoded QR code PNG.
    2FA is NOT enabled yet — the user must confirm with /2fa/enable.
    """
    await _rate_check_db(str(current_user.id), "totp_setup", _MAX_TOTP_SETUP, db)
    import base64
    import io

    import pyotp
    import qrcode

    secret = pyotp.random_base32()
    totp = pyotp.TOTP(secret)
    label = current_user.email
    issuer = "Lumidian"
    uri = totp.provisioning_uri(name=label, issuer_name=issuer)

    # Generate QR code as a data URL
    img = qrcode.make(uri)
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    qr_data_url = "data:image/png;base64," + base64.b64encode(buf.getvalue()).decode()

    # Persist the new secret (not yet enabled)
    current_user.totp_secret = secret
    await db.commit()

    return {
        "secret": secret,
        "otpauth_uri": uri,
        "qr_code": qr_data_url,
    }


class TotpCodeRequest(BaseModel):
    code: str


@router.post("/2fa/enable")
async def enable_2fa(
    body: TotpCodeRequest,
    current_user: Annotated[User, Depends(get_current_user)],
    db: DbDep,
):
    """Confirm a TOTP code and enable 2FA on the account."""
    import pyotp

    if not current_user.totp_secret:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Call /2fa/setup first to generate a secret.",
        )
    totp = pyotp.TOTP(current_user.totp_secret)
    if not totp.verify(body.code.strip(), valid_window=1):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid code. Please try again.",
        )

    current_user.totp_enabled = True
    await db.commit()
    logger.info("2FA enabled for user %s", current_user.email)
    return {"message": "Two-factor authentication enabled."}


class DisableTotpRequest(BaseModel):
    password: str


@router.post("/2fa/disable")
async def disable_2fa(
    body: DisableTotpRequest,
    current_user: Annotated[User, Depends(get_current_user)],
    db: DbDep,
):
    """Verify the user's password and disable 2FA."""
    if not current_user.password_hash or not verify_password(body.password, current_user.password_hash):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect password.",
        )

    current_user.totp_enabled = False
    current_user.totp_secret = None
    await db.commit()
    logger.info("2FA disabled for user %s", current_user.email)
    return {"message": "Two-factor authentication disabled."}


class VerifyTotpRequest(BaseModel):
    challenge_token: str
    code: str


@router.post("/2fa/verify")
async def verify_2fa(
    body: VerifyTotpRequest,
    response: Response,
    http_req: Request,
    db: DbDep,
):
    """
    Second step of login when 2FA is enabled.
    Validates the challenge token (issued by /login) and the TOTP code,
    then sets auth cookies and returns the user.
    """
    await _rate_check_db(_get_client_ip(http_req), "login", _MAX_LOGIN, db)
    import pyotp

    # Decode and validate challenge token
    try:
        payload = jwt.decode(body.challenge_token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
    except jwt.ExpiredSignatureError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Challenge expired. Please log in again.",
        )
    except Exception:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid challenge token.",
        )

    if payload.get("scope") != "2fa_challenge":
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid challenge token.",
        )

    user_id = int(payload["sub"])
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if not user or not user.totp_enabled or not user.totp_secret:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid challenge token.",
        )

    totp = pyotp.TOTP(user.totp_secret)
    if not totp.verify(body.code.strip(), valid_window=1):
        logger.warning("failed 2FA verification for user_id=%s", user_id)
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid authenticator code.",
        )

    token = create_token(user.id)
    set_auth_cookies(response, token)

    from app.services.analytics_service import log_event
    await log_event("user_login_2fa", {}, user_id=user.id)

    return user_to_dict(user)
