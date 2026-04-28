"""
Settings router — system-wide configuration.

Routes
------
GET  /api/settings/scheduler  — return current scheduler status (active / paused)
POST /api/settings/scheduler  — pause or resume the scheduler
GET  /api/settings/api-keys   — which LLM API keys are configured (bool per key)
"""
from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.dependencies import CurrentUser
from app.models import SystemSetting, utcnow

import os

router = APIRouter(prefix="/settings", tags=["settings"])

DbDep = Annotated[AsyncSession, Depends(get_db)]

_PAUSED_KEY = "scheduler_paused"


class SchedulerStatusResponse(BaseModel):
    paused: bool
    status: str  # "active" | "paused"


class SchedulerPauseRequest(BaseModel):
    paused: bool


async def _get_paused(db: AsyncSession) -> bool:
    result = await db.execute(
        select(SystemSetting).where(SystemSetting.key == _PAUSED_KEY)
    )
    setting = result.scalar_one_or_none()
    return setting is not None and setting.value == "true"


@router.get("/scheduler", response_model=SchedulerStatusResponse)
async def get_scheduler_status(db: DbDep, user: CurrentUser):
    """Return whether the automatic tracking scheduler is currently paused."""
    paused = await _get_paused(db)
    return SchedulerStatusResponse(
        paused=paused,
        status="paused" if paused else "active",
    )


@router.post("/scheduler", response_model=SchedulerStatusResponse)
async def set_scheduler_status(body: SchedulerPauseRequest, db: DbDep, user: CurrentUser):
    """Pause or resume the automatic tracking scheduler (admin only)."""
    if not user.is_admin:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Admin access required")
    result = await db.execute(
        select(SystemSetting).where(SystemSetting.key == _PAUSED_KEY)
    )
    setting = result.scalar_one_or_none()

    new_value = "true" if body.paused else "false"
    if setting is None:
        setting = SystemSetting(key=_PAUSED_KEY, value=new_value, updated_at=utcnow())
        db.add(setting)
    else:
        setting.value = new_value
        setting.updated_at = utcnow()

    await db.commit()
    return SchedulerStatusResponse(
        paused=body.paused,
        status="paused" if body.paused else "active",
    )


# ── API key status ────────────────────────────────────────────────────────────

@router.get("/api-keys")
async def get_api_key_status(user: CurrentUser):
    """
    Return which LLM API keys are configured (True/False, never the values).
    """
    return {
        "openai": bool(os.getenv("OPENAI_API_KEY", "").strip()),
        "anthropic": bool(os.getenv("ANTHROPIC_API_KEY", "").strip()),
        "perplexity": bool(os.getenv("PERPLEXITY_API_KEY", "").strip()),
        "gemini": bool(os.getenv("GEMINI_API_KEY", "").strip()),
    }
