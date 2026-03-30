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

import os
import time
import urllib.parse
from collections import defaultdict
from datetime import datetime, timezone, timedelta
from typing import Annotated, Optional

import bcrypt
import httpx
import jwt
from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from fastapi.responses import RedirectResponse
from pydantic import BaseModel, EmailStr
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

import secrets
import logging

from app.database import get_db
from app.dependencies import JWT_SECRET, JWT_ALGORITHM, get_current_user, get_current_user_allow_unverified
from app.models import User, PasswordResetToken, utcnow

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/auth", tags=["auth"])

# ── In-memory rate limiter ─────────────────────────────────────────────────────
# Stores per-IP attempt timestamps; pruned on each check (no background task needed).
_login_attempts: dict = defaultdict(list)
_register_attempts: dict = defaultdict(list)
_RATE_WINDOW = 60.0     # sliding 1-minute window
_MAX_LOGIN = 10         # 10 attempts / minute / IP
_MAX_REGISTER = 5       # 5 attempts / minute / IP
_verify_attempts: dict = defaultdict(list)
_resend_attempts: dict = defaultdict(list)
_MAX_VERIFY = 10        # 10 attempts / minute / IP
_MAX_RESEND = 3         # 3 attempts / minute / IP (prevent email flooding)


def _rate_check(ip: str, store: dict, limit: int) -> None:
    now = time.monotonic()
    cutoff = now - _RATE_WINDOW
    store[ip] = [t for t in store[ip] if t > cutoff]
    if len(store[ip]) >= limit:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Too many requests — please try again later.",
        )
    store[ip].append(now)

DbDep = Annotated[AsyncSession, Depends(get_db)]

# Admin emails from env — comma-separated. Falls back to ken@lumidian.ai if not set.
_raw_admin_emails = os.getenv("ADMIN_EMAILS", "ken@lumidian.ai")
_ADMIN_EMAILS: set[str] = {e.strip().lower() for e in _raw_admin_emails.split(",") if e.strip()}

# Use secure cookies when ENVIRONMENT=production
_COOKIE_SECURE = os.getenv("ENVIRONMENT", "development").lower() == "production"


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def verify_password(password: str, hashed: str) -> bool:
    return bcrypt.checkpw(password.encode("utf-8"), hashed.encode("utf-8"))

COOKIE_MAX_AGE = 60 * 60 * 24 * 7  # 7 days

from app.routers.billing import TIER_LIMITS, BRAND_LIMITS as BRAND_TYPE_LIMITS  # noqa: E402 — single source of truth


def create_token(user_id: int) -> str:
    payload = {
        "sub": str(user_id),
        "exp": datetime.now(timezone.utc) + timedelta(days=7),
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
    name: Optional[str] = None


@router.post("/register", status_code=status.HTTP_201_CREATED)
async def register(body: RegisterRequest, http_req: Request, response: Response, db: DbDep):
    request = body
    _rate_check(http_req.client.host if http_req.client else "unknown", _register_attempts, _MAX_REGISTER)
    email = request.email.strip().lower()
    existing = await db.execute(select(User).where(User.email == email))
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Email already registered")
    if len(request.password) < 6:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Password must be at least 6 characters")

    verification_code = f"{secrets.randbelow(1_000_000):06d}"
    code_hash = hash_password(verification_code)
    code_expires_at = datetime.now(timezone.utc).replace(tzinfo=None) + timedelta(hours=24)

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

    token = create_token(user.id)
    set_auth_cookies(response, token)

    from app.services.analytics_service import log_event
    await log_event("user_registered", {"plan": user.subscription_tier}, user_id=user.id)

    from app.services.email_service import send_email_verification, send_email_background
    send_email_background(send_email_verification, email=user.email, name=user.name, code=verification_code)

    return user_to_dict(user)


# ── Login ─────────────────────────────────────────────────────────────────────

class LoginRequest(BaseModel):
    email: str
    password: str


def create_challenge_token(user_id: int) -> str:
    """Short-lived token used as a 2FA challenge during login (5 min, scope='2fa_challenge')."""
    payload = {
        "sub": str(user_id),
        "scope": "2fa_challenge",
        "exp": datetime.now(timezone.utc) + timedelta(minutes=5),
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)


@router.post("/login")
async def login(body: LoginRequest, http_req: Request, response: Response, db: DbDep):
    _rate_check(http_req.client.host if http_req.client else "unknown", _login_attempts, _MAX_LOGIN)
    request = body
    email = request.email.strip().lower()
    result = await db.execute(select(User).where(User.email == email))
    user = result.scalar_one_or_none()
    if not user or not user.password_hash or not verify_password(request.password, user.password_hash):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid email or password")

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
async def get_me(user: Annotated[User, Depends(get_current_user_allow_unverified)], db: DbDep):
    from app.models import TeamMember
    from sqlalchemy import select as sa_select

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
        from google.oauth2 import id_token as google_id_token
        from google.auth.transport import requests as google_requests
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

    # Find or create user
    result = await db.execute(select(User).where(User.google_id == google_id))
    user = result.scalar_one_or_none()

    if not user:
        # Try matching by email
        result = await db.execute(select(User).where(User.email == email))
        user = result.scalar_one_or_none()
        if user:
            user.google_id = google_id
        else:
            user = User(
                email=email,
                google_id=google_id,
                name=name,
                is_admin=(email in _ADMIN_EMAILS),
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
async def google_auth_url(redirect_to: str = "/dashboard"):
    """Return the Google OAuth authorization URL. Frontend redirects the user there."""
    client_id = os.getenv("GOOGLE_CLIENT_ID", "")
    if not client_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Google OAuth not configured. Set GOOGLE_CLIENT_ID in environment.",
        )
    params = {
        "client_id": client_id,
        "redirect_uri": _google_redirect_uri(),
        "response_type": "code",
        "scope": "openid email profile",
        # state carries where to send the user after login; simple for dev use
        "state": redirect_to,
        "access_type": "online",
        "prompt": "select_account",  # always show account chooser
    }
    url = "https://accounts.google.com/o/oauth2/v2/auth?" + urllib.parse.urlencode(params)
    return {"url": url}


@router.get("/google/callback")
async def google_auth_callback(
    request: Request,
    db: DbDep,
    code: Optional[str] = None,
    state: Optional[str] = None,
    error: Optional[str] = None,
):
    """
    Google redirects here after the user authenticates.
    Exchange the auth code for an id_token, find/create the user,
    set auth cookies, and redirect to the app.
    """
    frontend_url = os.getenv("FRONTEND_URL", "http://localhost:3000")
    redirect_to = state if (state and state.startswith("/")) else "/dashboard"

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
            token_resp.raise_for_status()
            token_data = token_resp.json()
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
        from google.oauth2 import id_token as google_id_token
        from google.auth.transport import requests as google_requests
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

    # Find or create user — same logic as POST /google
    result = await db.execute(select(User).where(User.google_id == google_sub))
    user = result.scalar_one_or_none()
    if not user:
        result = await db.execute(select(User).where(User.email == email))
        user = result.scalar_one_or_none()
        if user:
            user.google_id = google_sub
        else:
            user = User(
                email=email,
                google_id=google_sub,
                name=name,
                is_admin=(email in _ADMIN_EMAILS),
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

    from app.services.analytics_service import log_event
    await log_event("user_google_login", {}, user_id=user.id)

    return redirect_response


# ── Forgot password ───────────────────────────────────────────────────────────

class ForgotPasswordRequest(BaseModel):
    email: str


@router.post("/forgot-password", status_code=status.HTTP_200_OK)
async def forgot_password(request: ForgotPasswordRequest, db: DbDep):
    """
    Generate a 1-hour password reset token and log the reset link to console.
    Always returns 200 to avoid user enumeration.
    """
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

        token_value = secrets.token_urlsafe(48)
        expires_at = datetime.now(timezone.utc).replace(tzinfo=None) + timedelta(hours=1)
        reset_token = PasswordResetToken(
            user_id=user.id,
            token=token_value,
            expires_at=expires_at,
        )
        db.add(reset_token)
        await db.commit()

        frontend_url = os.getenv("FRONTEND_URL", "http://localhost:3000")
        reset_link = f"{frontend_url}/reset-password?token={token_value}"

        from app.services.email_service import send_password_reset_email, send_email_background
        send_email_background(send_password_reset_email, email=user.email, name=user.name, reset_link=reset_link)

    return {"message": "If that email is registered, a reset link has been sent."}


# ── Reset password ─────────────────────────────────────────────────────────────

class ResetPasswordRequest(BaseModel):
    token: str
    new_password: str


@router.post("/reset-password", status_code=status.HTTP_200_OK)
async def reset_password(request: ResetPasswordRequest, db: DbDep):
    """Validate reset token and update user's password."""
    if len(request.new_password) < 6:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Password must be at least 6 characters",
        )

    result = await db.execute(
        select(PasswordResetToken).where(PasswordResetToken.token == request.token)
    )
    reset_token = result.scalar_one_or_none()

    if not reset_token:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid or expired reset token")

    now = datetime.now(timezone.utc).replace(tzinfo=None)
    if reset_token.used or reset_token.expires_at < now:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid or expired reset token")

    # Update password
    user_result = await db.execute(select(User).where(User.id == reset_token.user_id))
    user = user_result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="User not found")

    user.password_hash = hash_password(request.new_password)
    reset_token.used = True
    await db.commit()

    return {"message": "Password updated successfully"}


# ── Email verification ────────────────────────────────────────────────────────

class VerifyEmailRequest(BaseModel):
    code: str


@router.post("/verify-email", status_code=status.HTTP_200_OK)
async def verify_email(
    body: VerifyEmailRequest,
    http_req: Request,
    current_user: Annotated[User, Depends(get_current_user_allow_unverified)],
    db: DbDep,
):
    """Validate the 6-digit code and mark the user's email as verified."""
    _rate_check(http_req.client.host if http_req.client else "unknown", _verify_attempts, _MAX_VERIFY)
    if getattr(current_user, "email_verified", True):
        return {"message": "Email already verified"}

    if not current_user.email_verification_code or not current_user.email_verification_expires_at:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No pending verification. Please resend the code.",
        )

    now = datetime.now(timezone.utc).replace(tzinfo=None)
    if current_user.email_verification_expires_at < now:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Code expired. Please request a new one.",
        )

    if not verify_password(body.code.strip(), current_user.email_verification_code):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid code. Please try again.",
        )

    current_user.email_verified = True
    current_user.email_verification_code = None
    current_user.email_verification_expires_at = None
    await db.commit()

    return {"message": "Email verified successfully"}


@router.post("/resend-verification", status_code=status.HTTP_200_OK)
async def resend_verification(
    http_req: Request,
    current_user: Annotated[User, Depends(get_current_user_allow_unverified)],
    db: DbDep,
):
    """Generate a fresh 6-digit code and resend the verification email."""
    _rate_check(http_req.client.host if http_req.client else "unknown", _resend_attempts, _MAX_RESEND)
    if getattr(current_user, "email_verified", True):
        return {"message": "Email already verified"}

    verification_code = f"{secrets.randbelow(1_000_000):06d}"
    code_hash = hash_password(verification_code)
    code_expires_at = datetime.now(timezone.utc).replace(tzinfo=None) + timedelta(hours=24)

    current_user.email_verification_code = code_hash
    current_user.email_verification_expires_at = code_expires_at
    await db.commit()

    from app.services.email_service import send_email_verification, send_email_background
    send_email_background(
        send_email_verification,
        email=current_user.email,
        name=current_user.name,
        code=verification_code,
    )

    return {"message": "Verification email resent"}


# ── Admin: reset any user's password ──────────────────────────────────────────

class AdminResetPasswordRequest(BaseModel):
    email: str
    new_password: str


@router.post("/admin/reset-password", status_code=status.HTTP_200_OK)
async def admin_reset_password(
    request: AdminResetPasswordRequest,
    db: DbDep,
    current_user: Annotated[User, Depends(get_current_user)],
):
    """Admin-only: directly reset any user's password without a reset token."""
    if not current_user.is_admin:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Admin access required")

    if len(request.new_password) < 6:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Password must be at least 6 characters",
        )

    email = request.email.strip().lower()
    result = await db.execute(select(User).where(User.email == email))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")

    user.password_hash = hash_password(request.new_password)
    await db.commit()

    logger.info("Admin %s reset password for user %s", current_user.email, email)
    return {"message": f"Password reset successfully for {email}"}


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
    import pyotp
    import qrcode
    import io
    import base64

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
    db: DbDep,
):
    """
    Second step of login when 2FA is enabled.
    Validates the challenge token (issued by /login) and the TOTP code,
    then sets auth cookies and returns the user.
    """
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
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid authenticator code.",
        )

    token = create_token(user.id)
    set_auth_cookies(response, token)

    from app.services.analytics_service import log_event
    await log_event("user_login_2fa", {}, user_id=user.id)

    return user_to_dict(user)
