"""
Admin router — consolidated admin-only endpoints.

Routes
------
GET    /api/admin/users                       — list all users
POST   /api/admin/users/{user_id}/pause       — pause/unpause a user
DELETE /api/admin/users/{user_id}             — permanently remove a user
GET    /api/admin/runs                        — list all tracking runs
GET    /api/admin/stats                       — high-level system counts
POST   /api/admin/trigger-run/{brand_id}      — trigger a run for any brand
GET    /api/admin/logs                        — tail the application log
POST   /api/admin/generate-draft/{brand_id}   — generate drafts for any brand
POST   /api/admin/reset-password              — reset any user's password
"""
from __future__ import annotations

import logging
from datetime import UTC, datetime
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.dependencies import CurrentUser
from app.models import Brand, ContentDraft, Prompt, TrackingRun, User, utcnow

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/admin", tags=["admin"])

DbDep = Annotated[AsyncSession, Depends(get_db)]


def _require_admin(user: User) -> None:
    """Raise HTTP 403 if the user is not an admin."""
    if not user.is_admin:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Admin access required")


# ── Admin: all users ──────────────────────────────────────────────────────────

@router.get("/users")
async def admin_list_users(db: DbDep, user: CurrentUser):
    """Return all users with brand count and last active. Admin only."""
    _require_admin(user)

    rows = await db.execute(
        select(
            User.id,
            User.email,
            User.name,
            User.subscription_tier,
            User.subscription_status,
            User.is_admin,
            User.created_at,
            func.count(Brand.id).label("brand_count"),
        )
        .outerjoin(Brand, Brand.user_id == User.id)
        .group_by(User.id)
        .order_by(User.created_at.desc())
    )
    user_rows = rows.all()

    # Fetch all brands grouped by user in one query
    if user_rows:
        user_ids = [r.id for r in user_rows]
        brands_result = await db.execute(
            select(Brand.id, Brand.user_id, Brand.name, Brand.brand_type)
            .where(Brand.user_id.in_(user_ids))
            .order_by(Brand.created_at.asc())
        )
        brands_by_user: dict = {}
        for b in brands_result.all():
            brands_by_user.setdefault(b.user_id, []).append({
                "id": b.id,
                "name": b.name,
                "brand_type": b.brand_type,
            })
    else:
        brands_by_user = {}

    # Batch-fetch last active time per user (avoids N+1 queries)
    last_active_map: dict[int, datetime | None] = {}
    if user_rows:
        la_result = await db.execute(
            select(Brand.user_id, func.max(TrackingRun.created_at).label("last_active"))
            .join(TrackingRun, TrackingRun.brand_id == Brand.id)
            .where(Brand.user_id.in_([r.id for r in user_rows]))
            .group_by(Brand.user_id)
        )
        for la_row in la_result.all():
            last_active_map[la_row.user_id] = la_row.last_active

    users_data = []
    for row in user_rows:
        last_active = last_active_map.get(row.id)
        user_brands = brands_by_user.get(row.id, [])
        users_data.append({
            "id": row.id,
            "email": row.email,
            "name": row.name,
            "subscription_tier": row.subscription_tier,
            "subscription_status": row.subscription_status,
            "is_admin": row.is_admin,
            "is_paused": bool(getattr(row, "is_paused", False)),
            "created_at": row.created_at.isoformat() if row.created_at else None,
            "brand_count": row.brand_count,
            "brands": user_brands,
            "last_active": last_active.isoformat() if last_active else None,
        })
    return users_data


# ── Admin: pause / unpause a user ─────────────────────────────────────────────

@router.post("/users/{user_id}/pause")
async def admin_pause_user(user_id: int, db: DbDep, user: CurrentUser):
    """Pause or unpause a user account. Admin only. Cannot pause another admin."""
    _require_admin(user)

    target = await db.get(User, user_id)
    if not target:
        raise HTTPException(status_code=404, detail="User not found")
    # Admins can pause their own account, but not other admins
    if target.is_admin and target.id != user.id:
        raise HTTPException(status_code=400, detail="Cannot pause another admin account")

    target.is_paused = not getattr(target, "is_paused", False)
    target.updated_at = utcnow()
    await db.commit()
    action = "paused" if target.is_paused else "unpaused"
    logger.info("Admin %s %s user %s (%s)", user.email, action, target.email, user_id)
    return {"user_id": user_id, "is_paused": target.is_paused, "action": action}


# ── Admin: remove a user account ──────────────────────────────────────────────

@router.delete("/users/{user_id}")
async def admin_remove_user(user_id: int, db: DbDep, user: CurrentUser):
    """Permanently delete a user and all their data. Admin only. Cannot delete another admin."""
    _require_admin(user)
    if user_id == user.id:
        raise HTTPException(status_code=400, detail="Cannot delete your own admin account")

    target = await db.get(User, user_id)
    if not target:
        raise HTTPException(status_code=404, detail="User not found")
    if target.is_admin:
        raise HTTPException(status_code=400, detail="Cannot delete an admin account")

    logger.warning("Admin %s deleting user %s (%d) and all their data", user.email, target.email, user_id)
    await db.delete(target)
    await db.commit()
    return {"user_id": user_id, "deleted": True}


# ── Admin: all tracking runs ──────────────────────────────────────────────────

@router.get("/runs")
async def admin_list_runs(db: DbDep, user: CurrentUser):
    """Return all tracking runs across all users. Admin only."""
    _require_admin(user)

    runs_result = await db.execute(
        select(TrackingRun, Brand.name.label("brand_name"), User.email.label("user_email"))
        .join(Brand, TrackingRun.brand_id == Brand.id)
        .outerjoin(User, Brand.user_id == User.id)
        .order_by(TrackingRun.created_at.desc())
        .limit(200)
    )
    rows = runs_result.all()
    return [
        {
            "id": r.TrackingRun.id,
            "brand_id": r.TrackingRun.brand_id,
            "brand_name": r.brand_name,
            "user_email": r.user_email,
            "status": r.TrackingRun.status,
            "run_type": r.TrackingRun.run_type,
            "overall_score": r.TrackingRun.overall_score,
            "total_queries": r.TrackingRun.total_queries,
            "total_mentions": r.TrackingRun.total_mentions,
            "created_at": r.TrackingRun.created_at.isoformat() if r.TrackingRun.created_at else None,
            "completed_at": r.TrackingRun.completed_at.isoformat() if r.TrackingRun.completed_at else None,
        }
        for r in rows
    ]


# ── Admin: system stats ────────────────────────────────────────────────────────

@router.get("/stats")
async def admin_system_stats(db: DbDep, user: CurrentUser):
    """Return high-level system counts. Admin only."""
    _require_admin(user)

    today_start = datetime.now(UTC).replace(hour=0, minute=0, second=0, microsecond=0, tzinfo=None)

    total_users = (await db.execute(select(func.count(User.id)))).scalar_one()
    total_brands = (await db.execute(select(func.count(Brand.id)))).scalar_one()
    total_prompts = (await db.execute(select(func.count(Prompt.id)))).scalar_one()
    total_drafts = (await db.execute(select(func.count(ContentDraft.id)))).scalar_one()
    runs_today = (
        await db.execute(
            select(func.count(TrackingRun.id)).where(
                TrackingRun.created_at >= today_start
            )
        )
    ).scalar_one()

    return {
        "total_users": total_users,
        "total_brands": total_brands,
        "total_prompts": total_prompts,
        "total_drafts": total_drafts,
        "runs_today": runs_today,
    }


# ── Admin: trigger run for any brand ─────────────────────────────────────────

@router.post("/trigger-run/{brand_id}", status_code=status.HTTP_202_ACCEPTED)
async def admin_trigger_run(brand_id: int, db: DbDep, user: CurrentUser):
    """Manually trigger a tracking run for any brand. Admin only."""
    _require_admin(user)

    brand = await db.get(Brand, brand_id)
    if not brand:
        raise HTTPException(status_code=404, detail=f"Brand {brand_id} not found")

    import asyncio

    run = TrackingRun(brand_id=brand_id, status="pending", run_type="manual")
    db.add(run)
    await db.commit()
    await db.refresh(run)

    async def _bg():
        from app.routers.tracking import _background_run_with_id
        try:
            await _background_run_with_id(run.id, brand_id)
        except Exception:
            logger.exception("Admin-triggered run failed for brand %d", brand_id)

    asyncio.create_task(_bg(), name=f"admin-run-{brand_id}-{run.id}")
    return {"run_id": run.id, "brand_id": brand_id, "status": "pending"}


# ── Admin: tail log file ──────────────────────────────────────────────────────

@router.get("/logs")
async def admin_get_logs(user: CurrentUser, lines: int = 100):
    """Return the last N lines of the rotating log file. Admin only."""
    _require_admin(user)

    from pathlib import Path

    log_file = Path(__file__).resolve().parent.parent.parent / "logs" / "app.log"
    if not log_file.exists():
        return {"lines": [], "file": str(log_file), "exists": False}

    try:
        with open(log_file, encoding="utf-8", errors="replace") as f:
            all_lines = f.readlines()
        tail = [line.rstrip("\n") for line in all_lines[-lines:]]
        return {"lines": tail, "file": str(log_file), "exists": True, "total_lines": len(all_lines)}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Could not read log file: {exc}")


# ── Admin: manually generate drafts for any brand ────────────────────────────

@router.post("/generate-draft/{brand_id}", status_code=status.HTTP_202_ACCEPTED)
async def admin_generate_draft(brand_id: int, db: DbDep, user: CurrentUser):
    """Run gap analysis and generate drafts for any brand. Admin only."""
    _require_admin(user)

    brand = await db.get(Brand, brand_id)
    if not brand:
        raise HTTPException(status_code=404, detail=f"Brand {brand_id} not found")

    import asyncio

    async def _bg():
        from app.database import AsyncSessionLocal
        from app.services.drafting_service import auto_draft_top_gaps
        try:
            async with AsyncSessionLocal() as bg_db:
                drafts = await auto_draft_top_gaps(
                    db=bg_db,
                    brand_id=brand_id,
                    max_gaps=5,
                    clear_existing=False,
                    source="manual",
                )
                logger.info("Admin generated %d draft(s) for brand %d", len(drafts), brand_id)
        except Exception:
            logger.exception("Admin draft generation failed for brand %d", brand_id)

    asyncio.create_task(_bg(), name=f"admin-draft-{brand_id}")
    return {"brand_id": brand_id, "status": "generating"}


# ── Admin: reset any user's password ──────────────────────────────────────────

class AdminResetPasswordRequest(BaseModel):
    email: str
    new_password: str


@router.post("/reset-password", status_code=status.HTTP_200_OK)
async def admin_reset_password(
    request: AdminResetPasswordRequest,
    db: DbDep,
    user: CurrentUser,
):
    """Admin-only: directly reset any user's password without a reset token."""
    _require_admin(user)

    # Import here to avoid circular import — admin.py → auth.py → admin.py
    from app.routers.auth import _validate_password, hash_password

    _validate_password(request.new_password)

    email = request.email.strip().lower()
    result = await db.execute(select(User).where(User.email == email))
    target = result.scalar_one_or_none()
    if not target:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")

    target.password_hash = hash_password(request.new_password)
    target.password_changed_at = datetime.now(UTC).replace(tzinfo=None)
    await db.commit()

    logger.info("Admin %s reset password for user %s", user.email, email)
    return {"message": f"Password reset successfully for {email}"}
