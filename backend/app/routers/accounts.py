"""
Accounts router — manage platform account connections and API key status.

Routes
------
GET    /api/accounts                   — list all account connections
POST   /api/accounts/connect           — connect or update an account
DELETE /api/accounts/{platform}        — disconnect an account
GET    /api/accounts/{platform}        — get a specific account's status
GET    /api/settings/api-keys          — which LLM API keys are configured (bool per key)
"""
from __future__ import annotations

import json
import os
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models import AccountConnection, utcnow
from app.schemas import AccountConnectionSchema, ConnectAccountRequest

router = APIRouter(tags=["accounts"])

DbDep = Annotated[AsyncSession, Depends(get_db)]

SUPPORTED_PLATFORMS = {"reddit", "quora", "medium", "wikipedia"}


async def _get_account_or_404(db: AsyncSession, platform: str) -> AccountConnection:
    result = await db.execute(
        select(AccountConnection).where(AccountConnection.platform == platform)
    )
    account = result.scalar_one_or_none()
    if account is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"No account connection found for platform '{platform}'",
        )
    return account


# ── List all accounts ─────────────────────────────────────────────────────────

@router.get("/accounts", response_model=list[AccountConnectionSchema])
async def list_accounts(db: DbDep):
    """Return all account connections."""
    result = await db.execute(
        select(AccountConnection).order_by(AccountConnection.platform)
    )
    accounts = result.scalars().all()
    return [AccountConnectionSchema.model_validate(a) for a in accounts]


# ── Connect / update account ──────────────────────────────────────────────────

@router.post("/accounts/connect", response_model=AccountConnectionSchema, status_code=status.HTTP_200_OK)
async def connect_account(request: ConnectAccountRequest, db: DbDep):
    """
    Connect or update an account connection.

    If an existing record exists for the platform it is updated; otherwise a
    new one is created.  Credentials are stored as a raw JSON string.
    """
    if request.platform not in SUPPORTED_PLATFORMS:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Unsupported platform '{request.platform}'. Must be one of {sorted(SUPPORTED_PLATFORMS)}",
        )

    result = await db.execute(
        select(AccountConnection).where(AccountConnection.platform == request.platform)
    )
    account: AccountConnection | None = result.scalar_one_or_none()

    now = utcnow()
    credentials_json = json.dumps(request.credentials)

    # Attempt to extract a display name from credentials (best-effort)
    display_name: str | None = (
        request.credentials.get("username")
        or request.credentials.get("display_name")
        or request.credentials.get("email")
        or None
    )

    if account is None:
        account = AccountConnection(
            platform=request.platform,
            status="connected",
            credentials=credentials_json,
            display_name=display_name,
            connected_at=now,
            last_verified_at=now,
            error_message=None,
        )
        db.add(account)
    else:
        account.status = "connected"
        account.credentials = credentials_json
        if display_name:
            account.display_name = display_name
        account.connected_at = now
        account.last_verified_at = now
        account.error_message = None
        account.updated_at = now

    await db.commit()
    await db.refresh(account)
    return AccountConnectionSchema.model_validate(account)


# ── Disconnect account ────────────────────────────────────────────────────────

@router.delete("/accounts/{platform}", status_code=status.HTTP_204_NO_CONTENT)
async def disconnect_account(platform: str, db: DbDep):
    """Disconnect an account (clears credentials, sets status to disconnected)."""
    account = await _get_account_or_404(db, platform)
    account.status = "disconnected"
    account.credentials = None
    account.display_name = None
    account.connected_at = None
    account.last_verified_at = None
    account.error_message = None
    account.updated_at = utcnow()
    await db.commit()


# ── Get specific account ──────────────────────────────────────────────────────

@router.get("/accounts/{platform}", response_model=AccountConnectionSchema)
async def get_account(platform: str, db: DbDep):
    """Return status of a specific account connection."""
    account = await _get_account_or_404(db, platform)
    return AccountConnectionSchema.model_validate(account)


# ── API key status ────────────────────────────────────────────────────────────

@router.get("/settings/api-keys")
async def get_api_key_status():
    """
    Return which LLM API keys are configured (True/False, never the values).
    """
    return {
        "openai": bool(os.getenv("OPENAI_API_KEY", "").strip()),
        "anthropic": bool(os.getenv("ANTHROPIC_API_KEY", "").strip()),
        "perplexity": bool(os.getenv("PERPLEXITY_API_KEY", "").strip()),
        "gemini": bool(os.getenv("GEMINI_API_KEY", "").strip()),
    }
