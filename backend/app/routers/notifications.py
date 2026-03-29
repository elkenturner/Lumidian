"""
Notifications router.

Routes
------
GET  /api/notifications          — last 20 notifications for the current user, unread count
POST /api/notifications/read-all — mark all as read
POST /api/notifications/{id}/read — mark one as read
"""
from __future__ import annotations

from typing import Annotated, List, Optional

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select, update, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.dependencies import CurrentUser
from app.models import Notification

router = APIRouter(prefix="/notifications", tags=["notifications"])

DbDep = Annotated[AsyncSession, Depends(get_db)]


# ── Schemas (inline — small enough not to warrant schema file additions) ───────

from pydantic import BaseModel
from datetime import datetime


class NotificationOut(BaseModel):
    id: int
    type: str
    title: str
    body: Optional[str] = None
    link: Optional[str] = None
    read: bool
    created_at: datetime

    model_config = {"from_attributes": True}


class NotificationsResponse(BaseModel):
    notifications: List[NotificationOut]
    unread_count: int


# ── Helpers ────────────────────────────────────────────────────────────────────

async def _unread_count(db: AsyncSession, user_id: int) -> int:
    r = await db.execute(
        select(func.count()).where(
            Notification.user_id == user_id,
            Notification.read == False,  # noqa: E712
        )
    )
    return r.scalar_one()


# ── Routes ─────────────────────────────────────────────────────────────────────

@router.get("", response_model=NotificationsResponse)
async def get_notifications(db: DbDep, user: CurrentUser):
    result = await db.execute(
        select(Notification)
        .where(Notification.user_id == user.id)
        .order_by(Notification.created_at.desc())
        .limit(20)
    )
    notifs = result.scalars().all()
    unread = await _unread_count(db, user.id)
    return NotificationsResponse(
        notifications=[NotificationOut.model_validate(n) for n in notifs],
        unread_count=unread,
    )


@router.post("/read-all", response_model=NotificationsResponse)
async def mark_all_read(db: DbDep, user: CurrentUser):
    await db.execute(
        update(Notification)
        .where(Notification.user_id == user.id, Notification.read == False)  # noqa: E712
        .values(read=True)
    )
    await db.commit()
    result = await db.execute(
        select(Notification)
        .where(Notification.user_id == user.id)
        .order_by(Notification.created_at.desc())
        .limit(20)
    )
    notifs = result.scalars().all()
    return NotificationsResponse(
        notifications=[NotificationOut.model_validate(n) for n in notifs],
        unread_count=0,
    )


@router.post("/{notification_id}/read", response_model=NotificationOut)
async def mark_one_read(notification_id: int, db: DbDep, user: CurrentUser):
    result = await db.execute(
        select(Notification).where(
            Notification.id == notification_id,
            Notification.user_id == user.id,
        )
    )
    notif = result.scalar_one_or_none()
    if not notif:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Notification not found")
    notif.read = True
    await db.commit()
    await db.refresh(notif)
    return NotificationOut.model_validate(notif)
