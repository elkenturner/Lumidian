"""
Accounts router — manage platform account connections and API key status.

Routes
------
GET    /api/accounts                   — list all account connections
POST   /api/accounts/connect           — connect or update an account
DELETE /api/accounts/{platform}        — disconnect an account
GET    /api/accounts/{platform}        — get a specific account's status
"""
from __future__ import annotations

import json
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.dependencies import CurrentUser
from app.models import AccountConnection, utcnow
from app.schemas import AccountConnectionSchema, ConnectAccountRequest

router = APIRouter(prefix="/accounts", tags=["accounts"])

DbDep = Annotated[AsyncSession, Depends(get_db)]

SUPPORTED_PLATFORMS = {"reddit", "quora", "medium", "wikipedia", "linkedin", "x"}


async def _get_account_or_404(db: AsyncSession, user_id: int, platform: str) -> AccountConnection:
    result = await db.execute(
        select(AccountConnection).where(
            AccountConnection.user_id == user_id,
            AccountConnection.platform == platform,
        )
    )
    account = result.scalar_one_or_none()
    if account is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"No account connection found for platform '{platform}'",
        )
    return account


# ── List all accounts ─────────────────────────────────────────────────────────

@router.get("", response_model=list[AccountConnectionSchema])
async def list_accounts(db: DbDep, user: CurrentUser):
    """Return all account connections for the current user."""
    result = await db.execute(
        select(AccountConnection)
        .where(AccountConnection.user_id == user.id)
        .order_by(AccountConnection.platform)
    )
    accounts = result.scalars().all()
    return [AccountConnectionSchema.model_validate(a) for a in accounts]


# ── Connect / update account ──────────────────────────────────────────────────

@router.post("/connect", response_model=AccountConnectionSchema, status_code=status.HTTP_200_OK)
async def connect_account(request: ConnectAccountRequest, db: DbDep, user: CurrentUser):
    """
    Connect or update an account connection for the current user.

    If an existing record exists for the platform it is updated; otherwise a
    new one is created.  Credentials are stored as a raw JSON string.
    """
    if request.platform not in SUPPORTED_PLATFORMS:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Unsupported platform. Must be one of {sorted(SUPPORTED_PLATFORMS)}",
        )

    result = await db.execute(
        select(AccountConnection).where(
            AccountConnection.user_id == user.id,
            AccountConnection.platform == request.platform,
        )
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
            user_id=user.id,
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

@router.delete("/{platform}", status_code=status.HTTP_204_NO_CONTENT)
async def disconnect_account(platform: str, db: DbDep, user: CurrentUser):
    """Disconnect an account (clears credentials, sets status to disconnected)."""
    account = await _get_account_or_404(db, user.id, platform)
    account.status = "disconnected"
    account.credentials = None
    account.display_name = None
    account.connected_at = None
    account.last_verified_at = None
    account.error_message = None
    account.updated_at = utcnow()
    await db.commit()


# ── Get specific account ──────────────────────────────────────────────────────

@router.get("/{platform}", response_model=AccountConnectionSchema)
async def get_account(platform: str, db: DbDep, user: CurrentUser):
    """Return status of a specific account connection."""
    account = await _get_account_or_404(db, user.id, platform)
    return AccountConnectionSchema.model_validate(account)
