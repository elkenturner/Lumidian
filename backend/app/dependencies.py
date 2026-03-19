"""
Shared FastAPI dependencies.
"""
from __future__ import annotations

import os
from time import monotonic
from typing import Annotated, Optional

import jwt
from fastapi import Cookie, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models import User

JWT_SECRET = os.getenv("JWT_SECRET", "")
if not JWT_SECRET:
    raise RuntimeError(
        "JWT_SECRET environment variable is not set. "
        "Generate one with: python -c \"import secrets; print(secrets.token_hex(32))\""
    )
JWT_ALGORITHM = "HS256"

# ── Per-user in-memory rate limiting ─────────────────────────────────────────
# {user_id: (call_count, window_start_monotonic)}
_rate_store: dict[int, tuple[int, float]] = {}
_RATE_WINDOW = 60.0  # seconds


def check_rate_limit(user_id: int, limit: int) -> None:
    """Raise HTTP 429 if user has exceeded `limit` calls within the last minute."""
    count, start = _rate_store.get(user_id, (0, 0.0))
    now = monotonic()
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
    clarity_token: Optional[str] = Cookie(default=None),
) -> User:
    if not clarity_token:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Not authenticated")
    payload = decode_token(clarity_token)
    user_id = payload.get("sub")
    if not user_id:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token")
    result = await db.execute(select(User).where(User.id == int(user_id)))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User not found")
    return user


async def get_current_user_optional(
    db: Annotated[AsyncSession, Depends(get_db)],
    clarity_token: Optional[str] = Cookie(default=None),
) -> Optional[User]:
    if not clarity_token:
        return None
    try:
        payload = decode_token(clarity_token)
        user_id = payload.get("sub")
        if not user_id:
            return None
        result = await db.execute(select(User).where(User.id == int(user_id)))
        return result.scalar_one_or_none()
    except Exception:
        return None


CurrentUser = Annotated[User, Depends(get_current_user)]
OptionalUser = Annotated[Optional[User], Depends(get_current_user_optional)]


async def get_brand_for_user(brand_id: int, db: AsyncSession, user: User) -> "Brand":
    """Load a brand and verify it belongs to the authenticated user. Raises 404/403."""
    from app.models import Brand
    result = await db.execute(select(Brand).where(Brand.id == brand_id))
    brand = result.scalar_one_or_none()
    if brand is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Brand {brand_id} not found")
    if brand.user_id != user.id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access denied")
    return brand
