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

from app.database import get_db
from app.dependencies import JWT_SECRET, JWT_ALGORITHM, get_current_user
from app.models import User, utcnow

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
    None: 25,  # default for new accounts (no subscription yet)
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
async def get_me(user: Annotated[User, Depends(get_current_user)]):
    return user_to_dict(user)


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
