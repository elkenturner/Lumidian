"""
Shared FastAPI dependencies.
"""
from __future__ import annotations

import logging
import os
from datetime import UTC, datetime
from time import monotonic
from typing import Annotated

import jwt
from fastapi import Cookie, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models import Brand, User

JWT_SECRET = os.getenv("JWT_SECRET", "")
if not JWT_SECRET:
    raise RuntimeError(
        "JWT_SECRET environment variable is not set. "
        "Generate one with: python -c \"import secrets; print(secrets.token_hex(32))\""
    )
JWT_ALGORITHM = "HS256"
logger = logging.getLogger(__name__)

# ── Paid-only platform gate ───────────────────────────────────────────────────

PAID_ONLY_PLATFORMS: frozenset[str] = frozenset({
    "linkedin", "linkedin_article", "linkedin_post", "linkedin_reply",
    "x", "x_thread", "x_post", "x_reply",
})


def is_paid_only_platform(platform: str) -> bool:
    """Return True if the platform requires any paid subscription."""
    return platform in PAID_ONLY_PLATFORMS


def require_paid_for_platform(platform: str, user) -> None:
    """Raise HTTP 403 if the platform is paid-only and the user isn't paid or admin."""
    if not is_paid_only_platform(platform):
        return
    if getattr(user, "is_admin", False):
        return
    if getattr(user, "subscription_tier", None):
        return
    raise HTTPException(
        status_code=status.HTTP_403_FORBIDDEN,
        detail="LinkedIn and X features require a paid plan.",
    )


# ── Per-user in-memory rate limiting ─────────────────────────────────────────
# {user_id: (call_count, window_start_monotonic)}
_rate_store: dict[int, tuple[int, float]] = {}
_RATE_WINDOW = 60.0  # seconds


def check_rate_limit(user_id: int, limit: int) -> None:
    """Raise HTTP 429 if user has exceeded `limit` calls within the last minute.
    Also prunes all stale entries to keep memory bounded."""
    now = monotonic()
    cutoff = now - _RATE_WINDOW

    # Prune all stale entries every call (cheap dict iteration)
    stale_keys = [uid for uid, (_, start) in _rate_store.items() if start < cutoff]
    for uid in stale_keys:
        del _rate_store[uid]

    count, start = _rate_store.get(user_id, (0, 0.0))
    if now - start > _RATE_WINDOW:
        _rate_store[user_id] = (1, now)
    elif count >= limit:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail=f"Rate limit exceeded — max {limit} requests per minute for this endpoint.",
        )
    else:
        _rate_store[user_id] = (count + 1, start)

DbDep = Annotated[AsyncSession, Depends(get_db)]


def decode_token(token: str) -> dict:
    try:
        return jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Token expired")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token")


async def get_current_user(
    db: Annotated[AsyncSession, Depends(get_db)],
    clarity_token: str | None = Cookie(default=None),
) -> User:
    if not clarity_token:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Not authenticated")
    payload = decode_token(clarity_token)
    # Reject non-session tokens (e.g. 2FA challenge tokens)
    if payload.get("scope"):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token scope")
    user_id = payload.get("sub")
    if not user_id:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token")
    result = await db.execute(select(User).where(User.id == int(user_id)))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User not found")
    logger.debug(f"get_current_user: id={user.id} is_admin={user.is_admin}")
    # Admin impersonation sessions bypass paused/unverified/password checks
    is_impersonated = bool(payload.get("impersonated_by"))
    # Invalidate sessions issued before the last password change
    if not is_impersonated:
        token_iat = payload.get("iat")
        pw_changed = getattr(user, "password_changed_at", None)
        if token_iat and pw_changed:
            from datetime import datetime, timezone
            iat_dt = datetime.fromtimestamp(token_iat, tz=timezone.utc).replace(tzinfo=None)
            if iat_dt < pw_changed:
                raise HTTPException(
                    status_code=status.HTTP_401_UNAUTHORIZED,
                    detail="Session expired due to password change. Please log in again.",
                )
    if getattr(user, "is_paused", False) and not user.is_admin and not is_impersonated:
        logger.warning(f"get_current_user: BLOCKED - account paused for user {user.id}")
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail={
                "code": "account_paused",
                "message": "Your account has been paused. Contact support to restore access.",
            },
        )
    if not getattr(user, "email_verified", True) and not user.is_admin and not is_impersonated:
        logger.warning(f"get_current_user: BLOCKED - email not verified for user {user.id}")
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="email_not_verified",
        )
    return user


async def get_current_user_allow_unverified(
    db: Annotated[AsyncSession, Depends(get_db)],
    clarity_token: str | None = Cookie(default=None),
) -> User:
    """Like get_current_user but does NOT block unverified email addresses.
    Use only for /auth/me and the email verification endpoints themselves."""
    if not clarity_token:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Not authenticated")
    payload = decode_token(clarity_token)
    if payload.get("scope"):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token scope")
    user_id = payload.get("sub")
    if not user_id:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token")
    result = await db.execute(select(User).where(User.id == int(user_id)))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User not found")
    is_impersonated = bool(payload.get("impersonated_by"))
    if getattr(user, "is_paused", False) and not user.is_admin and not is_impersonated:
        logger.warning(f"get_current_user_allow_unverified: BLOCKED - account paused for user {user.id}")
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail={
                "code": "account_paused",
                "message": "Your account has been paused. Contact support to restore access.",
            },
        )
    return user


async def get_current_user_optional(
    db: Annotated[AsyncSession, Depends(get_db)],
    clarity_token: str | None = Cookie(default=None),
) -> User | None:
    if not clarity_token:
        return None
    try:
        payload = decode_token(clarity_token)
        user_id = payload.get("sub")
        if not user_id:
            return None
        result = await db.execute(select(User).where(User.id == int(user_id)))
        return result.scalar_one_or_none()
    except HTTPException:
        return None
    except Exception as exc:
        logger.warning("Unexpected error in optional auth lookup: %s", exc)
        return None


CurrentUser = Annotated[User, Depends(get_current_user)]
AllowUnverifiedUser = Annotated[User, Depends(get_current_user_allow_unverified)]
OptionalUser = Annotated[User | None, Depends(get_current_user_optional)]


def is_brand_paused(brand, user) -> bool:
    """
    Check if a brand is paused (read-only).

    A brand is paused when:
    1. It's a pitch brand and pitch_expires_at has passed
    2. User's subscription has lapsed (not active/trialing)
    """
    # Check pitch brand expiry
    if getattr(brand, "brand_type", "standard") == "pitch":
        expires_at = getattr(brand, "pitch_expires_at", None)
        if expires_at:
            now = datetime.now(UTC).replace(tzinfo=None)
            if expires_at <= now:
                return True

    # Check subscription status
    sub_status = getattr(user, "subscription_status", None)
    if sub_status and sub_status not in ("active", "trialing", None):
        return True

    return False


def require_brand_active(brand, user) -> None:
    """
    Raise 403 if the brand is paused.
    Call this in endpoints that modify brand data (runs, drafts, scans).
    """
    # Admins can operate on any brand
    if getattr(user, "is_admin", False):
        return

    if is_brand_paused(brand, user):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Brand is paused. Renew your subscription or upgrade to continue.",
        )


def require_active_subscription(user: User) -> None:
    """
    Raise HTTP 402 if the user's subscription is canceled or past_due.
    Admins are always exempt. Users without any subscription (free tier) are allowed.
    Only blocks users who explicitly have a degraded paid-plan status.
    """
    if user.is_admin:
        return
    blocked_statuses = {"canceled", "past_due", "unpaid"}
    if user.subscription_status in blocked_statuses:
        raise HTTPException(
            status_code=status.HTTP_402_PAYMENT_REQUIRED,
            detail=(
                f"Your subscription is {user.subscription_status}. "
                "Please update your payment method to continue using this feature."
            ),
        )


async def get_data_owner_id(db: AsyncSession, user: User) -> int:
    """
    Return the effective data owner's user_id.
    If the user is a team member (viewer), return the account_owner_id.
    Otherwise return the user's own id.
    """

    from app.models import TeamMember

    result = await db.execute(
        select(TeamMember).where(
            TeamMember.user_id == user.id,
            TeamMember.accepted_at.is_not(None),
        ).order_by(TeamMember.accepted_at.desc()).limit(1)
    )
    membership = result.scalar_one_or_none()
    if membership:
        return membership.account_owner_id
    return user.id


async def get_brand_for_user(brand_id: int, db: AsyncSession, user: User) -> Brand:
    """Load a brand and verify it belongs to the authenticated user or their team owner. Raises 404/403. Admins can access any brand."""
    logger.info(f"get_brand_for_user: brand_id={brand_id}, user.id={user.id}, user.is_admin={getattr(user, 'is_admin', False)}")
    result = await db.execute(select(Brand).where(Brand.id == brand_id))
    brand = result.scalar_one_or_none()
    if brand is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Brand {brand_id} not found")
    # Admins can access any brand
    if getattr(user, "is_admin", False):
        logger.info(f"get_brand_for_user: admin bypass for user {user.id}")
        return brand
    effective_owner_id = await get_data_owner_id(db, user)
    if brand.user_id != effective_owner_id:
        logger.warning(f"get_brand_for_user: ACCESS DENIED user={user.id} brand.user_id={brand.user_id} effective_owner={effective_owner_id}")
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access denied")
    return brand


async def require_owner_only(db: AsyncSession, user: User) -> None:
    """Raise HTTP 403 if the user is a team member (viewer) — write operations are owner-only."""
    from app.models import TeamMember

    result = await db.execute(
        select(TeamMember).where(
            TeamMember.user_id == user.id,
            TeamMember.accepted_at.is_not(None),
        ).limit(1)
    )
    membership = result.scalar_one_or_none()
    if membership:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Team members have read-only access and cannot perform this action.",
        )


# ── Agency portal access ─────────────────────────────────────────────────────


async def require_agency_staff(user: User = Depends(get_current_user)) -> User:
    """Allow only users with is_agency_staff=True or is_admin=True."""
    if not (getattr(user, "is_agency_staff", False) or user.is_admin):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Agency staff access required",
        )
    return user


async def require_client_access(
    client_id: int,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_agency_staff),
) -> User:
    """Verify the agency staff member is assigned to this client.

    Admins bypass entirely. Non-admin staff must have a row in
    agency_client_assignments matching (client_id, user.id).
    """
    if user.is_admin:
        return user
    from app.models import AgencyClientAssignment
    result = await db.execute(
        select(AgencyClientAssignment).where(
            AgencyClientAssignment.agency_client_id == client_id,
            AgencyClientAssignment.staff_user_id == user.id,
        )
    )
    if result.scalar_one_or_none() is None:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Not assigned to this client",
        )
    return user


async def ensure_client_access(db: AsyncSession, user: User, client_id: int) -> None:
    """Helper for indirect-scope endpoints (task_id, draft_id, doc_id, event_id).

    Raises 403 if a non-admin staff member is not assigned to client_id.
    Admins bypass. Call this after resolving the parent client_id from the resource.
    """
    if user.is_admin:
        return
    from app.models import AgencyClientAssignment
    result = await db.execute(
        select(AgencyClientAssignment).where(
            AgencyClientAssignment.agency_client_id == client_id,
            AgencyClientAssignment.staff_user_id == user.id,
        )
    )
    if result.scalar_one_or_none() is None:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Not assigned to this client",
        )
