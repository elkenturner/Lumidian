"""
Analytics router — internal summary endpoint.

Routes
------
GET /api/analytics/summary  — aggregate stats for internal use
"""
from __future__ import annotations

import json
import logging
from datetime import UTC, datetime
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.dependencies import CurrentUser
from app.models import AnalyticsEvent, Brand, ContentDraft, Prompt, TrackingRun, User

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/analytics", tags=["analytics"])

DbDep = Annotated[AsyncSession, Depends(get_db)]


@router.get("/summary")
async def get_analytics_summary(db: DbDep, user: CurrentUser):
    """Internal analytics summary — admin only."""
    if not user.is_admin:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Admin access required")

    # ── Tracking ──────────────────────────────────────────────────────────────

    runs_result = await db.execute(
        select(
            func.count(TrackingRun.id).label("total"),
            func.avg(TrackingRun.overall_score).label("avg_score"),
        ).where(
            TrackingRun.status == "completed",
            TrackingRun.overall_score.isnot(None),
        )
    )
    runs_row = runs_result.one()
    total_runs = runs_row.total or 0
    avg_visibility_score = round(runs_row.avg_score, 2) if runs_row.avg_score is not None else None

    # ── Drafts ────────────────────────────────────────────────────────────────

    drafts_result = await db.execute(
        select(
            ContentDraft.status,
            func.count(ContentDraft.id).label("cnt"),
        ).group_by(ContentDraft.status)
    )
    status_counts: dict[str, int] = {}
    for row in drafts_result.all():
        status_counts[row.status] = row.cnt

    total_drafts_created = sum(status_counts.values())
    total_drafts_approved = status_counts.get("approved", 0)
    total_drafts_posted = status_counts.get("posted", 0)

    # dismissed drafts come from event log (records deleted on dismiss)
    dismissed_result = await db.execute(
        select(func.count(AnalyticsEvent.id)).where(
            AnalyticsEvent.event_type == "draft_dismissed"
        )
    )
    total_drafts_dismissed = dismissed_result.scalar_one() or 0

    # ── Most used platform ────────────────────────────────────────────────────

    platform_result = await db.execute(
        select(
            ContentDraft.platform,
            func.count(ContentDraft.id).label("cnt"),
        ).group_by(ContentDraft.platform).order_by(text("cnt DESC")).limit(1)
    )
    platform_row = platform_result.one_or_none()
    most_used_platform = platform_row.platform if platform_row else None

    # ── Avg time to approve ───────────────────────────────────────────────────

    tta_result = await db.execute(
        select(func.avg(ContentDraft.time_to_approve_seconds)).where(
            ContentDraft.time_to_approve_seconds.isnot(None)
        )
    )
    avg_time_to_approve = tta_result.scalar_one()
    if avg_time_to_approve is not None:
        avg_time_to_approve = round(avg_time_to_approve, 1)

    # ── Top performing prompt (by visibility gain) ────────────────────────────

    top_prompt: dict | None = None
    try:
        vc_result = await db.execute(
            select(AnalyticsEvent).where(AnalyticsEvent.event_type == "visibility_changed")
        )
        vc_events = vc_result.scalars().all()

        prompt_delta: dict[int, float] = {}
        for ev in vc_events:
            if not ev.data:
                continue
            try:
                d = json.loads(ev.data)
                pid = d.get("prompt_id")
                delta = d.get("delta", 0.0)
                if pid is not None:
                    prompt_delta[pid] = prompt_delta.get(pid, 0.0) + delta
            except Exception:
                continue

        if prompt_delta:
            best_pid = max(prompt_delta, key=lambda k: prompt_delta[k])
            best_delta = round(prompt_delta[best_pid], 2)
            prompt_row = await db.get(Prompt, best_pid)
            top_prompt = {
                "prompt_id": best_pid,
                "prompt_text": prompt_row.text if prompt_row else None,
                "total_visibility_gain": best_delta,
            }
    except Exception as exc:
        logger.warning("top_performing_prompt calculation failed: %s", exc)

    return {
        "total_runs_completed": total_runs,
        "avg_visibility_score": avg_visibility_score,
        "total_drafts_created": total_drafts_created,
        "total_drafts_approved": total_drafts_approved,
        "total_drafts_dismissed": total_drafts_dismissed,
        "total_drafts_posted": total_drafts_posted,
        "most_used_platform": most_used_platform,
        "avg_time_to_approve_seconds": avg_time_to_approve,
        "top_performing_prompt": top_prompt,
    }


# ── Admin: all users ──────────────────────────────────────────────────────────

@router.get("/admin/users")
async def admin_list_users(db: DbDep, user: CurrentUser):
    """Return all users with brand count and last active. Admin only."""
    if not user.is_admin:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Admin access required")

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

@router.post("/admin/users/{user_id}/pause")
async def admin_pause_user(user_id: int, db: DbDep, user: CurrentUser):
    """Pause or unpause a user account. Admin only. Cannot pause another admin."""
    if not user.is_admin:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Admin access required")

    target = await db.get(User, user_id)
    if not target:
        raise HTTPException(status_code=404, detail="User not found")
    # Admins can pause their own account, but not other admins
    if target.is_admin and target.id != user.id:
        raise HTTPException(status_code=400, detail="Cannot pause another admin account")

    target.is_paused = not getattr(target, "is_paused", False)
    target.updated_at = target.updated_at  # trigger onupdate
    from app.models import utcnow as _utcnow
    target.updated_at = _utcnow()
    await db.commit()
    action = "paused" if target.is_paused else "unpaused"
    logger.info("Admin %s %s user %s (%s)", user.email, action, target.email, user_id)
    return {"user_id": user_id, "is_paused": target.is_paused, "action": action}


# ── Admin: remove a user account ──────────────────────────────────────────────

@router.delete("/admin/users/{user_id}")
async def admin_remove_user(user_id: int, db: DbDep, user: CurrentUser):
    """Permanently delete a user and all their data. Admin only. Cannot delete another admin."""
    if not user.is_admin:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Admin access required")
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

@router.get("/admin/runs")
async def admin_list_runs(db: DbDep, user: CurrentUser):
    """Return all tracking runs across all users. Admin only."""
    if not user.is_admin:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Admin access required")

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

@router.get("/admin/stats")
async def admin_system_stats(db: DbDep, user: CurrentUser):
    """Return high-level system counts. Admin only."""
    if not user.is_admin:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Admin access required")

    from datetime import datetime

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

@router.post("/admin/trigger-run/{brand_id}", status_code=status.HTTP_202_ACCEPTED)
async def admin_trigger_run(brand_id: int, db: DbDep, user: CurrentUser):
    """Manually trigger a tracking run for any brand. Admin only."""
    if not user.is_admin:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Admin access required")

    brand = await db.get(Brand, brand_id)
    if not brand:
        raise HTTPException(status_code=404, detail=f"Brand {brand_id} not found")

    import asyncio

    from app.models import TrackingRun as TR

    run = TR(brand_id=brand_id, status="pending", run_type="manual")
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

@router.get("/admin/logs")
async def admin_get_logs(user: CurrentUser, lines: int = 100):
    """Return the last N lines of the rotating log file. Admin only."""
    if not user.is_admin:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Admin access required")

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

@router.post("/admin/generate-draft/{brand_id}", status_code=status.HTTP_202_ACCEPTED)
async def admin_generate_draft(brand_id: int, db: DbDep, user: CurrentUser):
    """Run gap analysis and generate drafts for any brand. Admin only."""
    if not user.is_admin:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Admin access required")

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
