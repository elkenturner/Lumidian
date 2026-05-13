"""Weekly comprehensive report for agency-tier clients."""
from __future__ import annotations

from datetime import datetime, timedelta
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import (
    AgencyClient,
    Brand,
    ClientActivityEvent,
    Competitor,
    CompetitorMention,
    ContentDraft,
    ContentGap,
    DraftAttribution,
    Prompt,
    QueryResult,
    RunModelScore,
    TrackingRun,
)
from app.services.document_engine.registry import Template, register


def _period(now: datetime, week_start: datetime) -> dict[str, Any]:
    return {
        "start": week_start.isoformat(),
        "end": now.isoformat(),
        "label": f"Week of {week_start.strftime('%b %d, %Y')}",
    }


def _run_summary(run: TrackingRun | None) -> dict[str, Any] | None:
    if run is None:
        return None
    return {
        "overall_score": run.overall_score,
        "total_queries": run.total_queries,
        "total_mentions": run.total_mentions,
        "completed_at": run.completed_at.isoformat() if run.completed_at else None,
    }


async def _latest_completed_run(
    db: AsyncSession, brand_id: int, since: datetime, until: datetime
) -> TrackingRun | None:
    q = await db.execute(
        select(TrackingRun)
        .where(
            TrackingRun.brand_id == brand_id,
            TrackingRun.status == "completed",
            TrackingRun.completed_at >= since,
            TrackingRun.completed_at < until,
        )
        .order_by(TrackingRun.completed_at.desc())
        .limit(1)
    )
    return q.scalar_one_or_none()


async def _model_scores(db: AsyncSession, run: TrackingRun | None) -> list[dict[str, Any]]:
    if run is None:
        return []
    q = await db.execute(
        select(RunModelScore).where(RunModelScore.tracking_run_id == run.id)
    )
    return [
        {
            "model": s.model,
            "score": s.score,
            "total_queries": s.total_queries,
            "total_mentions": s.total_mentions,
        }
        for s in q.scalars().all()
    ]


async def _per_prompt_scorecard(
    db: AsyncSession,
    brand_id: int,
    this_run: TrackingRun | None,
    last_run: TrackingRun | None,
) -> list[dict[str, Any]]:
    p_q = await db.execute(select(Prompt).where(Prompt.brand_id == brand_id))
    prompts = p_q.scalars().all()
    if not prompts:
        return []

    async def _score(run_id: int | None, prompt_id: int) -> float | None:
        if run_id is None:
            return None
        total_q = await db.execute(
            select(func.count(QueryResult.id)).where(
                QueryResult.tracking_run_id == run_id,
                QueryResult.prompt_id == prompt_id,
                QueryResult.error.is_(None),
            )
        )
        total = total_q.scalar() or 0
        if total == 0:
            return None
        mentions_q = await db.execute(
            select(func.count(QueryResult.id)).where(
                QueryResult.tracking_run_id == run_id,
                QueryResult.prompt_id == prompt_id,
                QueryResult.error.is_(None),
                QueryResult.mentioned.is_(True),
            )
        )
        mentions = mentions_q.scalar() or 0
        return round((mentions / total) * 100.0, 1)

    rows: list[dict[str, Any]] = []
    for p in prompts:
        tw = await _score(this_run.id if this_run else None, p.id)
        lw = await _score(last_run.id if last_run else None, p.id)
        delta: float | None
        if tw is None or lw is None:
            delta = None
            trend = "unknown"
        else:
            delta = round(tw - lw, 1)
            if delta >= 5:
                trend = "up"
            elif delta <= -5:
                trend = "down"
            else:
                trend = "flat"
        rows.append(
            {
                "prompt_id": p.id,
                "prompt_text": p.text,
                "this_week_score": tw,
                "last_week_score": lw,
                "delta": delta,
                "trend": trend,
            }
        )
    rows.sort(key=lambda r: (r["this_week_score"] is None, r["this_week_score"] or 0))
    return rows


async def _competitor_delta(
    db: AsyncSession,
    brand_id: int,
    this_run: TrackingRun | None,
    last_run: TrackingRun | None,
) -> list[dict[str, Any]]:
    c_q = await db.execute(select(Competitor).where(Competitor.brand_id == brand_id))
    competitors = c_q.scalars().all()
    if not competitors:
        return []

    async def _count(run_id: int | None, competitor_id: int) -> int:
        if run_id is None:
            return 0
        q = await db.execute(
            select(func.count(CompetitorMention.id)).where(
                CompetitorMention.tracking_run_id == run_id,
                CompetitorMention.competitor_id == competitor_id,
                CompetitorMention.mentioned.is_(True),
            )
        )
        return q.scalar() or 0

    out: list[dict[str, Any]] = []
    for c in competitors:
        tw = await _count(this_run.id if this_run else None, c.id)
        lw = await _count(last_run.id if last_run else None, c.id)
        delta = tw - lw
        if delta > 0:
            direction = "up"
        elif delta < 0:
            direction = "down"
        else:
            direction = "flat"
        out.append(
            {
                "competitor_id": c.id,
                "name": c.name,
                "this_week_mentions": tw,
                "last_week_mentions": lw,
                "delta": delta,
                "direction": direction,
            }
        )
    out.sort(key=lambda r: -r["this_week_mentions"])
    return out


async def _content_shipped(
    db: AsyncSession, brand_id: int, week_start: datetime
) -> list[dict[str, Any]]:
    q = await db.execute(
        select(ContentDraft.platform, func.count(ContentDraft.id))
        .where(
            ContentDraft.brand_id == brand_id,
            ContentDraft.status == "posted",
            ContentDraft.posted_at >= week_start,
        )
        .group_by(ContentDraft.platform)
    )
    return [{"platform": p, "count": c} for (p, c) in q.all()]


async def _draft_attribution(
    db: AsyncSession, brand_id: int, week_start: datetime
) -> list[dict[str, Any]]:
    q = await db.execute(
        select(DraftAttribution, ContentDraft, Prompt)
        .join(ContentDraft, ContentDraft.id == DraftAttribution.draft_id)
        .join(Prompt, Prompt.id == DraftAttribution.prompt_id)
        .where(
            DraftAttribution.brand_id == brand_id,
            DraftAttribution.delta.isnot(None),
            ContentDraft.posted_at >= week_start - timedelta(days=30),
        )
        .order_by(DraftAttribution.delta.desc())
        .limit(5)
    )
    out: list[dict[str, Any]] = []
    for attr, draft, prompt in q.all():
        out.append(
            {
                "draft_id": draft.id,
                "platform": draft.platform,
                "prompt_text": prompt.text,
                "score_at_posting": attr.score_at_posting,
                "current_score": attr.current_score,
                "delta": attr.delta,
            }
        )
    return out


async def _top_gaps(
    db: AsyncSession, brand_id: int, limit: int = 3
) -> list[dict[str, Any]]:
    q = await db.execute(
        select(ContentGap, Prompt)
        .join(Prompt, Prompt.id == ContentGap.prompt_id)
        .where(ContentGap.brand_id == brand_id)
        .order_by(ContentGap.gap_score.desc())
        .limit(limit)
    )
    out: list[dict[str, Any]] = []
    for gap, prompt in q.all():
        out.append(
            {
                "prompt_text": prompt.text,
                "gap_score": gap.gap_score,
                "platforms_lacking": gap.platforms_lacking,
            }
        )
    return out


async def _activity_sample(
    db: AsyncSession, client_id: int, week_start: datetime
) -> list[dict[str, Any]]:
    q = await db.execute(
        select(ClientActivityEvent)
        .where(
            ClientActivityEvent.agency_client_id == client_id,
            ClientActivityEvent.created_at >= week_start,
        )
        .order_by(ClientActivityEvent.created_at.asc())
        .limit(30)
    )
    return [
        {"event_type": e.event_type, "body": e.body, "at": e.created_at.isoformat()}
        for e in q.scalars().all()
    ]


async def fetch_data(db: AsyncSession, client: AgencyClient) -> dict[str, Any]:
    brand_q = await db.execute(
        select(Brand).where(Brand.agency_client_id == client.id).limit(1)
    )
    brand = brand_q.scalar_one_or_none()
    now = datetime.utcnow()
    week_start = now - timedelta(days=7)
    prev_week_start = week_start - timedelta(days=7)

    if brand is None:
        return {
            "client": {"name": client.name},
            "period": _period(now, week_start),
            "this_week_run": None,
            "last_week_run": None,
            "model_scores": [],
            "per_prompt": [],
            "competitors": [],
            "content_shipped": [],
            "draft_attribution": [],
            "top_gaps": [],
            "activity_sample": [],
            "has_data": False,
        }

    this_run = await _latest_completed_run(db, brand.id, since=week_start, until=now)
    last_run = await _latest_completed_run(db, brand.id, since=prev_week_start, until=week_start)

    per_prompt = await _per_prompt_scorecard(db, brand.id, this_run, last_run)
    competitors = await _competitor_delta(db, brand.id, this_run, last_run)
    content = await _content_shipped(db, brand.id, week_start)
    attribution = await _draft_attribution(db, brand.id, week_start)
    gaps = await _top_gaps(db, brand.id, limit=3)
    activity = await _activity_sample(db, client.id, week_start)

    return {
        "client": {"name": client.name},
        "period": _period(now, week_start),
        "this_week_run": _run_summary(this_run),
        "last_week_run": _run_summary(last_run),
        "model_scores": await _model_scores(db, this_run),
        "per_prompt": per_prompt,
        "competitors": competitors,
        "content_shipped": content,
        "draft_attribution": attribution,
        "top_gaps": gaps,
        "activity_sample": activity,
        "has_data": bool(this_run or content or activity),
    }


SYSTEM_PROMPT = """You are writing a weekly comprehensive report for an AI visibility agency client.
Output professional markdown with these exact sections (in this order):

# Weekly Report — {client.name} — {period.label}

## Executive summary
(2-3 sentences — the headline of what happened this week.)

## Visibility this week
(Overall score this week vs last week, direction, per-model breakdown table.
If `last_week_run` is null: "Baseline week — no prior data to compare." If both null: "Tracking has not run yet this week.")

## Per-prompt scorecard
(Markdown table of prompts ordered worst → best for this week. Columns: Prompt | This week | Last week | Δ | Trend.
If a prompt has no data this week, show "—".)

## Competitor delta
(For each competitor: their this-week mention count vs last-week, direction. If no competitors tracked, say "No competitors tracked yet.")

## Content shipped
(Group by platform with counts. If zero, say "No content posted this week.")

## Impact of posted content
(For drafts with non-zero attribution delta this week, list 3-5 highest-delta items: platform + prompt + score lift. If empty, say "Not enough runs since posting to attribute impact yet.")

## Top gaps to close
(List the top 3 gap_score prompts. For each: prompt text + platforms_lacking. If none, say "No active gaps detected.")

## Next week
(2-3 specific, actionable recommendations based on the data above.)

Stay tight, factual, no fluff. Numbers should be exact from the data — don't round visibility scores. Don't invent prompts, competitors, or events that aren't in the data.
"""


register(
    Template(
        kind="agency_weekly_report",
        name="Weekly report (agency)",
        description="Comprehensive weekly recap: visibility, per-prompt scores, competitors, content, gaps.",
        title_factory=lambda c: f"Weekly report — {c.name} — week of {datetime.utcnow().strftime('%b %d, %Y')}",
        fetch_data=fetch_data,
        system_prompt=SYSTEM_PROMPT,
        user_prompt_template="Report data:\n```json\n{data_json}\n```",
        max_tokens=4000,
    )
)
