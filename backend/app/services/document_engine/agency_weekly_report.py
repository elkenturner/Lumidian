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


SECTION_MAP: dict[str, str] = {
    "executive summary": "executive_summary",
    "visibility this week": "visibility",
    "per-prompt scorecard": "prompts",
    "competitor delta": "competitors",
    "content shipped": "content",
    "impact of posted content": "impact",
    "top gaps to close": "gaps",
    "next week": "next_week",
}


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


SYSTEM_PROMPT = """You are writing the weekly visibility report for an AI-visibility agency client.

Voice: Direct, declarative, dense. Senior consultant, not assistant. No hedging ("may," "could," "might," "potentially"). No throat-clearing. No AI-tells ("delve," "leverage," "robust," "comprehensive").

Plain language, not jargon. Forbidden: "indexing velocity," "attribution pipeline," "share-of-voice," "model index changes," "topical authority," "directional," "go-to-market." Say what you mean in everyday words.

Title-Case brand names. Source data may store competitor and brand names in lowercase (e.g., `startengine`, `wefunder`, `dalmoregroup`). In output: StartEngine, Wefunder, Republic, Dalmore Group, etc. Same rule for the client.

Numbers are exact from the data — don't round visibility scores. Don't invent prompts, competitors, drafts, or events that aren't in the data.

The output is structured fields. Empty list/string is the correct way to omit a section — do NOT write filler bullets like "No content posted this week." or "No active gaps detected." Leave them empty.

Per-field rules:

- **executive_summary**: 2 sentences. ≤ 40 words total. Lead with the actual score and the delta. Cite one driving prompt or model by name if it's the headline cause.
- **week_in_review**: 1 paragraph, ≤ 80 words. Cover overall score vs last week, per-model breakdown by name, and the single most material movement. No throat-clearing intro ("This week's visibility scan completed…").
- **per_prompt_callouts**: 3-5 bullets max. Each ≤ 22 words. Each names one prompt (quoted), the score change, and one specific implication or driver. No repetition across bullets.
- **competitor_delta**: 1 paragraph, ≤ 60 words. Cite each tracked competitor by name with their delta. State the relative position vs the client. Empty string if no competitors are tracked.
- **content_shipped**: bullets summarizing what got posted, grouped by platform with counts. EMPTY LIST when nothing was posted — do not write a "No content posted" placeholder.
- **top_gaps**: 3 bullets max. Each ≤ 25 words. Format: "<quoted prompt>" — gap score N.N — <one specific lever to pull>. Never list the same platform set across multiple bullets; consolidate or vary.
- **next_week**: 2-3 bullets max. Each ≤ 20 words. Imperative verb start (Publish, Audit, Pitch, Investigate). No nesting, no explanation clauses ("which will…", "in order to…"). Just the action.

If `last_week_run` is null: open executive_summary with "Baseline week — no prior data." and skip the delta language.
If `this_week_run` is null: executive_summary = "Tracking has not run yet this week." — leave most other fields empty.

"""


from datetime import date as _date
from pydantic import BaseModel, Field

from app.services.document_engine.charts.visibility_over_time import render_visibility_over_time
from app.services.document_engine.charts.model_mix import render_model_mix
from app.services.document_engine.charts.prompt_scorecard import render_prompt_scorecard
from app.services.document_engine.charts.competitor_compare import render_competitor_compare


class WeeklyReportOutput(BaseModel):
    executive_summary: str = Field(..., description="2-3 sentence headline of the week")
    week_in_review: str = Field(..., description="1-2 paragraph narrative on visibility this week")
    per_prompt_callouts: list[str] = Field(default_factory=list, description="3-5 specific prompt-level takeaways")
    competitor_delta: str | None = Field(None, description="One paragraph on competitor movement; null if no competitors tracked")
    content_shipped: list[str] = Field(default_factory=list, description="Bullets summarizing posted content by platform")
    top_gaps: list[str] = Field(default_factory=list, description="3 actionable next-step bullets per gap")
    next_week: list[str] = Field(default_factory=list, description="2-3 specific actions for next week")


REQUIRED_FIELDS = (
    "client.name",
    "this_week_run.overall_score",
)


# ───────────────────────────── chart adapters ──────────────────────────────

async def _chart_visibility_over_time(db, client, data) -> bytes:
    """Query the last 30 days of completed tracking runs and chart their overall_score."""
    from sqlalchemy import select
    from datetime import datetime, timedelta
    from app.models import Brand
    brand_q = await db.execute(select(Brand).where(Brand.agency_client_id == client.id).limit(1))
    brand = brand_q.scalar_one_or_none()
    points: list[tuple[_date, float]] = []
    if brand is not None:
        since = datetime.utcnow() - timedelta(days=30)
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


async def _chart_model_mix(db, client, data) -> bytes:
    """Build {model: score} dict from data['model_scores'].
    Actual keys from _model_scores(): 'model' and 'score'.
    """
    raw = data.get("model_scores") or []
    scores: dict[str, float] = {}
    for entry in raw:
        if isinstance(entry, dict) and entry.get("model"):
            scores[entry["model"]] = float(entry.get("score") or 0)
    return render_model_mix(scores)


async def _chart_prompt_scorecard(db, client, data) -> bytes:
    """Build [(prompt_text, {model: score})] from data['per_prompt'].
    Actual keys from _per_prompt_scorecard(): 'prompt_text', 'this_week_score'.
    No per-model breakdown available; uses 'overall' as the single axis.
    """
    rows: list[tuple[str, dict[str, float]]] = []
    for entry in data.get("per_prompt") or []:
        if isinstance(entry, dict):
            prompt_text = (entry.get("prompt_text") or "")[:60]
            score = entry.get("this_week_score")
            if prompt_text and score is not None:
                rows.append((prompt_text, {"this week": float(score)}))
    return render_prompt_scorecard(rows)


async def _chart_competitor_compare(db, client, data) -> bytes:
    """Build brand_score + {competitor_name: score} from data.
    Actual keys from _competitor_delta(): 'name', 'this_week_mentions'.
    """
    brand_score = float((data.get("this_week_run") or {}).get("overall_score") or 0)
    competitor_scores: dict[str, float] = {}
    for entry in data.get("competitors") or []:
        if isinstance(entry, dict):
            name = entry.get("name")
            mentions = entry.get("this_week_mentions")
            if name and mentions is not None:
                competitor_scores[name] = float(mentions)
    return render_competitor_compare(brand_score=brand_score, competitor_scores=competitor_scores)


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
        required_fields=REQUIRED_FIELDS,
        output_schema=WeeklyReportOutput,
        typst_template="weekly_report.typ",
        chart_calls=(
            _chart_visibility_over_time,
            _chart_model_mix,
            _chart_prompt_scorecard,
            _chart_competitor_compare,
        ),
    )
)
