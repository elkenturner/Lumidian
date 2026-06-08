"""Monthly client report template."""
from __future__ import annotations

from datetime import datetime, timedelta
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import AgencyClient, Brand, ClientActivityEvent, ContentDraft, TrackingRun
from app.services.document_engine.registry import Template, register


SECTION_MAP: dict[str, str] = {
    "summary": "summary",
    "visibility change": "visibility",
    "content shipped": "content",
    "notable activity": "activity",
    "next month": "next_month",
}


async def fetch_data(db: AsyncSession, client: AgencyClient) -> dict[str, Any]:
    brand_q = await db.execute(select(Brand).where(Brand.agency_client_id == client.id).limit(1))
    brand = brand_q.scalar_one_or_none()
    now = datetime.utcnow()
    month_start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    last_month_start = (month_start - timedelta(days=1)).replace(day=1)

    this_run = None
    last_run = None
    drafts_by_platform: dict[str, int] = {}
    drafts_posted_this_month = 0
    activity: list[dict] = []
    if brand is not None:
        r_q = await db.execute(
            select(TrackingRun)
            .where(TrackingRun.brand_id == brand.id, TrackingRun.status == "completed", TrackingRun.completed_at >= month_start)
            .order_by(TrackingRun.completed_at.desc())
            .limit(1)
        )
        this_run = r_q.scalar_one_or_none()
        l_q = await db.execute(
            select(TrackingRun)
            .where(
                TrackingRun.brand_id == brand.id,
                TrackingRun.status == "completed",
                TrackingRun.completed_at < month_start,
                TrackingRun.completed_at >= last_month_start,
            )
            .order_by(TrackingRun.completed_at.desc())
            .limit(1)
        )
        last_run = l_q.scalar_one_or_none()
        d_q = await db.execute(
            select(ContentDraft.platform, func.count(ContentDraft.id))
            .where(
                ContentDraft.brand_id == brand.id,
                ContentDraft.status == "posted",
                ContentDraft.posted_at >= month_start,
            )
            .group_by(ContentDraft.platform)
        )
        for platform, count in d_q.all():
            drafts_by_platform[platform] = count
        drafts_posted_this_month = sum(drafts_by_platform.values())

    a_q = await db.execute(
        select(ClientActivityEvent)
        .where(
            ClientActivityEvent.agency_client_id == client.id,
            ClientActivityEvent.created_at >= month_start,
        )
        .order_by(ClientActivityEvent.created_at.asc())
        .limit(50)
    )
    activity = [
        {"event_type": e.event_type, "body": e.body, "at": e.created_at.isoformat()}
        for e in a_q.scalars().all()
    ]

    return {
        "client": {"name": client.name},
        "period": {"start": month_start.isoformat(), "end": now.isoformat(), "label": now.strftime("%B %Y")},
        "this_month_run": (
            {"overall_score": this_run.overall_score, "total_queries": this_run.total_queries}
            if this_run else None
        ),
        "last_month_run": (
            {"overall_score": last_run.overall_score, "total_queries": last_run.total_queries}
            if last_run else None
        ),
        "drafts_posted_this_month": drafts_posted_this_month,
        "drafts_by_platform": drafts_by_platform,
        "activity_events_count": len(activity),
        "activity_sample": activity[:20],
        "has_data": bool(this_run or drafts_posted_this_month or activity),
    }


SYSTEM_PROMPT = """You are writing a monthly client report for an AI visibility agency.
Output professional markdown with these sections:

# Monthly Report — {client.name} — {period.label}

## Summary
(2-3 sentences — what changed this month, in plain English)

## Visibility Change
(If both this-month and last-month runs exist: compare scores, note direction. If only one exists, state baseline. If neither, "Tracking baseline not yet established.")

## Content Shipped
(Group by platform with counts; if zero, say "No content posted this month")

## Notable Activity
(Pull 3-5 highlights from the activity sample — client approvals, drafts sent, etc.)

## Next Month
(2-3 specific recommendations for the coming month)

Keep tight, factual, no fluff.
"""


from pydantic import BaseModel, Field
from app.services.document_engine.charts.visibility_over_time import render_visibility_over_time
from app.services.document_engine.charts.model_mix import render_model_mix


class MonthlyReportOutput(BaseModel):
    executive_summary: str = Field(..., description="2-3 sentence summary of the month")
    month_over_month: str = Field(..., description="1-2 paragraphs comparing this month to last month")
    content_velocity: str | None = Field(None, description="One paragraph on volume and platform mix; null if no drafts posted")
    highlights: list[str] = Field(default_factory=list, description="3-5 noteworthy events this month")
    next_month: list[str] = Field(default_factory=list, description="2-3 priorities for the coming month")


REQUIRED_FIELDS = (
    "client.name",
    "this_month_run.overall_score",
)


async def _chart_visibility_over_time(db, client, data) -> bytes:
    """Last 90 days of completed tracking runs for a monthly view."""
    from sqlalchemy import select
    from datetime import datetime, timedelta
    from datetime import date as _date
    from app.models import Brand
    brand_q = await db.execute(select(Brand).where(Brand.agency_client_id == client.id).limit(1))
    brand = brand_q.scalar_one_or_none()
    points: list[tuple[_date, float]] = []
    if brand is not None:
        since = datetime.utcnow() - timedelta(days=90)
        runs_q = await db.execute(
            select(TrackingRun)
            .where(
                TrackingRun.brand_id == brand.id,
                TrackingRun.status == "completed",
                TrackingRun.completed_at >= since,
            )
            .order_by(TrackingRun.completed_at.asc())
        )
        for r in runs_q.scalars().all():
            if r.completed_at and r.overall_score is not None:
                points.append((r.completed_at.date(), float(r.overall_score)))
    return render_visibility_over_time(points)


async def _chart_drafts_by_platform_mix(db, client, data) -> bytes:
    """Reuse the donut chart for drafts-by-platform breakdown.
    Actual key from fetch_data: 'drafts_by_platform' (dict[str, int]).
    """
    raw = data.get("drafts_by_platform") or {}
    scores = {k: float(v) for k, v in raw.items() if v}
    return render_model_mix(scores)  # same shape; donut is general


register(
    Template(
        kind="monthly_report",
        name="Monthly report",
        description="Auto-assembled summary of this month's work + visibility change",
        title_factory=lambda c: f"Monthly report — {c.name} — {datetime.utcnow().strftime('%b %Y')}",
        fetch_data=fetch_data,
        system_prompt=SYSTEM_PROMPT,
        user_prompt_template="Report data:\n```json\n{data_json}\n```",
        max_tokens=3000,
        required_fields=REQUIRED_FIELDS,
        output_schema=MonthlyReportOutput,
        typst_template="monthly_report.typ",
        chart_calls=(_chart_visibility_over_time, _chart_drafts_by_platform_mix),
    )
)
