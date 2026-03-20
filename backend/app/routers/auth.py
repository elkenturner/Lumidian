"""
Auth router — registration, login, logout, session.

Routes
------
POST /api/auth/register  — create account
POST /api/auth/login     — authenticate, set cookie
POST /api/auth/logout    — clear cookie
GET  /api/auth/me        — return current user
POST /api/auth/google    — exchange Google ID token for session
"""
from __future__ import annotations

import os
from datetime import datetime, timezone, timedelta
from typing import Annotated, Optional

import bcrypt
import jwt
from fastapi import APIRouter, Depends, HTTPException, Response, status
from pydantic import BaseModel, EmailStr
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

import secrets
import logging

from app.database import get_db
from app.dependencies import JWT_SECRET, JWT_ALGORITHM, get_current_user
from app.models import User, PasswordResetToken, utcnow

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/auth", tags=["auth"])

DbDep = Annotated[AsyncSession, Depends(get_db)]

# Admin emails from env — comma-separated. Falls back to ken@clarityai.com if not set.
_raw_admin_emails = os.getenv("ADMIN_EMAILS", "ken@clarityai.com")
_ADMIN_EMAILS: set[str] = {e.strip().lower() for e in _raw_admin_emails.split(",") if e.strip()}

# Use secure cookies when ENVIRONMENT=production
_COOKIE_SECURE = os.getenv("ENVIRONMENT", "development").lower() == "production"


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def verify_password(password: str, hashed: str) -> bool:
    return bcrypt.checkpw(password.encode("utf-8"), hashed.encode("utf-8"))

COOKIE_MAX_AGE = 60 * 60 * 24 * 7  # 7 days

TIER_LIMITS = {
    "starter": 25,
    "pro": 100,
    None: 10,   # free: pitch only (10 prompts)
    "": 10,     # same, for callers that convert None → ""
}

# How many brands of each type a user may own
BRAND_TYPE_LIMITS: dict[str | None, dict[str, int]] = {
    None: {"standard": 0, "pitch": 1},      # free: 1 pitch brand, no standard
    "": {"standard": 0, "pitch": 1},
    "starter": {"standard": 1, "pitch": 1}, # starter: 1 standard + 1 pitch
    "pro": {"standard": 5, "pitch": 10},    # pro: up to 5 standard + pitch decks
}


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
    limit = 999999 if user.is_admin else TIER_LIMITS.get(user.subscription_tier, 25)
    return {
        "id": user.id,
        "email": user.email,
        "name": user.name,
        "subscription_tier": user.subscription_tier,
        "subscription_status": user.subscription_status,
        "is_admin": user.is_admin,
        "prompt_limit": limit,
        "created_at": user.created_at.isoformat() if user.created_at else None,
    }


# ── Register ──────────────────────────────────────────────────────────────────

class RegisterRequest(BaseModel):
    email: str
    password: str
    name: Optional[str] = None


@router.post("/register", status_code=status.HTTP_201_CREATED)
async def register(request: RegisterRequest, response: Response, db: DbDep):
    email = request.email.strip().lower()
    existing = await db.execute(select(User).where(User.email == email))
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Email already registered")
    if len(request.password) < 6:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Password must be at least 6 characters")

    password_hash = hash_password(request.password)
    user = User(
        email=email,
        password_hash=password_hash,
        name=request.name or email.split("@")[0],
        is_admin=(email in _ADMIN_EMAILS),
    )
    db.add(user)
    await db.commit()
    await db.refresh(user)

    token = create_token(user.id)
    set_auth_cookies(response, token)

    from app.services.analytics_service import log_event
    await log_event("user_registered", {"plan": user.subscription_tier}, user_id=user.id)

    try:
        from app.services.email_service import send_welcome_email
        send_welcome_email(email=user.email, name=user.name)
    except Exception as exc:
        logger.warning("Welcome email failed (non-fatal): %s", exc)

    return user_to_dict(user)


# ── Login ─────────────────────────────────────────────────────────────────────

class LoginRequest(BaseModel):
    email: str
    password: str


@router.post("/login")
async def login(request: LoginRequest, response: Response, db: DbDep):
    email = request.email.strip().lower()
    result = await db.execute(select(User).where(User.email == email))
    user = result.scalar_one_or_none()
    if not user or not user.password_hash or not verify_password(request.password, user.password_hash):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid email or password")

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
async def get_me(user: Annotated[User, Depends(get_current_user)], db: DbDep):
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

        try:
            from app.services.email_service import send_password_reset_email
            send_password_reset_email(email=user.email, name=user.name, reset_link=reset_link)
        except Exception as exc:
            logger.warning("Password reset email failed (non-fatal): %s", exc)
            # Always log the link as a fallback so it's not lost
            logger.info("PASSWORD RESET LINK for %s: %s", email, reset_link)

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
