"""
Analytics router — internal summary endpoint.

Routes
------
GET /api/analytics/summary  — aggregate stats for internal use
"""
from __future__ import annotations

import json
import logging
from typing import Annotated, Optional

from fastapi import APIRouter, Depends
from sqlalchemy import select, func, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models import TrackingRun, ContentDraft, AnalyticsEvent, Prompt

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/analytics", tags=["analytics"])

DbDep = Annotated[AsyncSession, Depends(get_db)]


@router.get("/summary")
async def get_analytics_summary(db: DbDep):
    """
    Internal analytics summary. No auth required — deploy behind firewall or
    add auth dependency before exposing publicly.
    """

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

    top_prompt: Optional[dict] = None
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
