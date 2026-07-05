"""
Competitive Gap metric — pure read-side aggregation over existing
TrackingRun / QueryResult / Competitor rows.

Headline = brand_visibility_pct − mean(competitor_visibility_pct), computed over
the selected window. Trend = the same gap_pp computed per UTC day.

Spec: docs/superpowers/specs/2026-05-12-competitive-gap-design.md
"""
from __future__ import annotations

import re
from collections import defaultdict
from datetime import UTC, date as Date, datetime, timedelta
from typing import Literal, TypeVar

WindowLiteral = Literal["7d", "30d", "90d"]

_WINDOW_DAYS: dict[str, int] = {"7d": 7, "30d": 30, "90d": 90}


def _resolve_window(
    window: WindowLiteral,
    now: datetime | None = None,
) -> tuple[datetime, datetime, datetime, datetime]:
    """
    Return (start, end, prior_start, prior_end) as naive UTC datetimes.

    `end` is `now` (default: utcnow). `start` is `end - window`. The prior
    window is the same length immediately before. All TrackingRun.completed_at
    values are naive UTC, so we strip tzinfo for direct comparison.
    """
    if window not in _WINDOW_DAYS:
        raise ValueError(f"Invalid window '{window}'; expected one of {list(_WINDOW_DAYS)}")
    days = _WINDOW_DAYS[window]
    end_aware = now or datetime.now(UTC)
    end = end_aware.astimezone(UTC).replace(tzinfo=None)
    start = end - timedelta(days=days)
    prior_end = start
    prior_start = start - timedelta(days=days)
    return start, end, prior_start, prior_end


def _normalize(text: str) -> str:
    """Lowercase + strip non-alphanumeric (mirrors tracking_service brand detection)."""
    return re.sub(r"[^a-z0-9]", "", text.lower())


def _as_naive_utc(dt: datetime) -> datetime:
    """
    Coerce a datetime to naive UTC. App code writes naive UTC, but rows seeded
    by external scripts can carry '+00:00'-suffixed strings that SQLAlchemy's
    SQLite dialect parses back as tz-aware — comparing those against our naive
    window bounds raises TypeError.
    """
    if dt.tzinfo is None:
        return dt
    return dt.astimezone(UTC).replace(tzinfo=None)


def _mention_matches(text: str | None, name: str) -> bool:
    """
    True if `name` appears in `text` as a word-bounded match (case-insensitive)
    or via alphanumeric-normalized substring (handles spacing/punctuation
    variants like 'SpotItEarly' for 'Spot it Early').

    `re.escape(name)` guards against names containing regex metacharacters
    (e.g., 'C++', 'Notion.so').

    The fuzzy fallback is only engaged when `name` itself contains non-word
    characters (spaces, `+`, `.`, etc.) — this prevents pure-word names like
    "Asana" from falsely matching as a substring inside "Casana".
    """
    if not text:
        return False
    pattern = re.compile(rf"\b{re.escape(name)}\b", re.IGNORECASE)
    if pattern.search(text):
        return True
    # Only fall back to normalized substring when name contains non-word chars;
    # otherwise word-boundary regex is the authoritative gate.
    if not re.search(r"\W", name):
        return False
    name_norm = _normalize(name)
    return bool(name_norm) and name_norm in _normalize(text)


T = TypeVar("T")


def _per_day_buckets(rows: list[tuple[T, datetime]]) -> dict[Date, list[T]]:
    """
    Group `(payload, when)` tuples by `when.date()`. Returned dict maps each
    UTC day (date) to the list of payloads that fell on it.
    """
    buckets: dict[Date, list[T]] = defaultdict(list)
    for payload, when in rows:
        buckets[when.date()].append(payload)
    return dict(buckets)


# ── Main orchestrator ────────────────────────────────────────────────────────

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Brand, Competitor, QueryResult, TrackingRun
from app.schemas import (
    CompetitiveGapResponse,
    CompetitiveGapTrendPoint,
    CompetitorGapStat,
    CompetitorTrendPoint,
)


def _confidence(sample_count: int) -> str:
    if sample_count >= 100:
        return "high"
    if sample_count >= 20:
        return "medium"
    return "low"


def _empty_response(brand_id: int, window: str, has_competitors: bool) -> CompetitiveGapResponse:
    return CompetitiveGapResponse(
        brand_id=brand_id,
        window=window,
        has_competitors=has_competitors,
        has_data=False,
        headline_gap_pp=None,
        headline_delta_pp=None,
        brand_visibility_pct=None,
        competitor_avg_pct=None,
        trend=[],
        competitors=[],
        sample_count=0,
        confidence="low",
    )


async def compute_competitive_gap(
    *,
    brand_id: int,
    window: str,
    db: AsyncSession,
) -> CompetitiveGapResponse:
    """Read-side aggregation. See spec §4c for full algorithm."""
    start, end, prior_start, prior_end = _resolve_window(window)

    # Brand
    brand_row = await db.execute(select(Brand).where(Brand.id == brand_id))
    brand = brand_row.scalar_one()

    # Competitors
    comp_rows = await db.execute(
        select(Competitor).where(Competitor.brand_id == brand_id)
    )
    competitors = list(comp_rows.scalars().all())
    has_competitors = len(competitors) > 0
    comp_created: dict[int, datetime] = {c.id: _as_naive_utc(c.created_at) for c in competitors}

    # Runs covering both windows
    run_rows = await db.execute(
        select(TrackingRun).where(
            TrackingRun.brand_id == brand_id,
            TrackingRun.status == "completed",
            TrackingRun.completed_at >= prior_start,
            TrackingRun.completed_at <= end,
        )
    )
    runs = list(run_rows.scalars().all())
    if not runs:
        return _empty_response(brand_id, window, has_competitors)

    run_ids = [r.id for r in runs]
    run_completed: dict[int, datetime] = {
        r.id: _as_naive_utc(r.completed_at) for r in runs if r.completed_at is not None
    }

    # Query results (filter errors out)
    qr_rows = await db.execute(
        select(QueryResult).where(
            QueryResult.tracking_run_id.in_(run_ids),
            QueryResult.error.is_(None),
        )
    )
    query_results = list(qr_rows.scalars().all())
    if not query_results:
        return _empty_response(brand_id, window, has_competitors)

    # Pair each row with its run's completed_at; partition into current/prior windows
    current_rows: list[tuple[QueryResult, datetime]] = []
    prior_rows: list[tuple[QueryResult, datetime]] = []
    for qr in query_results:
        when = run_completed.get(qr.tracking_run_id)
        if when is None:
            continue
        if start <= when <= end:
            current_rows.append((qr, when))
        elif prior_start <= when < prior_end:
            prior_rows.append((qr, when))

    if not current_rows:
        return _empty_response(brand_id, window, has_competitors)

    # ── Window-aggregate (current) ──────────────────────────────────────────
    cur_qrs = [qr for qr, _ in current_rows]
    cur_total = len(cur_qrs)
    brand_pct = sum(1 for qr in cur_qrs if qr.mentioned) / cur_total * 100.0

    def _comp_pct(qrs: list[QueryResult], comp: Competitor) -> float:
        if not qrs:
            return 0.0
        hits = sum(1 for qr in qrs if _mention_matches(qr.response_text, comp.name))
        return hits / len(qrs) * 100.0

    eligible_competitors = [c for c in competitors if comp_created[c.id] <= end]
    competitor_pcts = {c.id: _comp_pct(cur_qrs, c) for c in eligible_competitors}
    if eligible_competitors:
        comp_avg_pct = sum(competitor_pcts.values()) / len(eligible_competitors)
        headline_gap_pp: float | None = brand_pct - comp_avg_pct
    else:
        comp_avg_pct = 0.0
        headline_gap_pp = None  # no competitors to compare against

    # ── Window-aggregate (prior) for delta ──────────────────────────────────
    headline_delta_pp: float | None = None
    if prior_rows and eligible_competitors:
        prior_qrs = [qr for qr, _ in prior_rows]
        prior_brand_pct = sum(1 for qr in prior_qrs if qr.mentioned) / len(prior_qrs) * 100.0
        prior_eligible = [c for c in eligible_competitors if comp_created[c.id] <= prior_end]
        if prior_eligible:
            prior_comp_pcts = [_comp_pct(prior_qrs, c) for c in prior_eligible]
            prior_avg = sum(prior_comp_pcts) / len(prior_eligible)
            prior_gap = prior_brand_pct - prior_avg
            if headline_gap_pp is not None:
                headline_delta_pp = headline_gap_pp - prior_gap

    # ── Per-day trend ───────────────────────────────────────────────────────
    day_buckets = _per_day_buckets(current_rows)
    trend: list[CompetitiveGapTrendPoint] = []
    per_competitor_daily: dict[int, list[CompetitorTrendPoint]] = {c.id: [] for c in competitors}

    for day in sorted(day_buckets.keys()):
        day_qrs = day_buckets[day]
        if not day_qrs:
            continue
        day_total = len(day_qrs)
        day_brand_pct = sum(1 for qr in day_qrs if qr.mentioned) / day_total * 100.0
        day_eligible = [c for c in competitors if comp_created[c.id].date() <= day]
        if day_eligible:
            day_comp_pcts = {c.id: _comp_pct(day_qrs, c) for c in day_eligible}
            day_comp_avg = sum(day_comp_pcts.values()) / len(day_eligible)
            day_gap = day_brand_pct - day_comp_avg
        else:
            day_comp_pcts = {}
            day_comp_avg = 0.0
            day_gap = day_brand_pct  # no eligible competitors that day

        trend.append(CompetitiveGapTrendPoint(
            date=day.isoformat(),
            gap_pp=round(day_gap, 2),
            brand_pct=round(day_brand_pct, 2),
            comp_avg_pct=round(day_comp_avg, 2),
        ))

        for c in competitors:
            if c.id not in day_comp_pcts:
                continue
            per_competitor_daily[c.id].append(CompetitorTrendPoint(
                date=day.isoformat(),
                gap_pp=round(day_brand_pct - day_comp_pcts[c.id], 2),
            ))

    # ── Per-competitor stats ────────────────────────────────────────────────
    comp_stats: list[CompetitorGapStat] = []
    for c in competitors:
        eligible_now = comp_created[c.id] <= end
        if not eligible_now:
            comp_stats.append(CompetitorGapStat(
                competitor_id=c.id,
                name=c.name,
                competitor_pct=0.0,
                gap_pp=0.0,
                delta_pp=None,
                trend=[],
                has_data=False,
            ))
            continue
        c_pct = competitor_pcts.get(c.id, 0.0)
        c_gap = brand_pct - c_pct
        # Per-competitor delta: same window-aggregate trick
        c_delta: float | None = None
        if prior_rows and comp_created[c.id] <= prior_end:
            prior_qrs = [qr for qr, _ in prior_rows]
            prior_brand_pct = sum(1 for qr in prior_qrs if qr.mentioned) / len(prior_qrs) * 100.0 if prior_qrs else 0.0
            prior_c_pct = _comp_pct(prior_qrs, c)
            c_delta = c_gap - (prior_brand_pct - prior_c_pct)
        comp_stats.append(CompetitorGapStat(
            competitor_id=c.id,
            name=c.name,
            competitor_pct=round(c_pct, 2),
            gap_pp=round(c_gap, 2),
            delta_pp=round(c_delta, 2) if c_delta is not None else None,
            trend=per_competitor_daily.get(c.id, []),
            has_data=True,
        ))

    return CompetitiveGapResponse(
        brand_id=brand_id,
        window=window,
        has_competitors=has_competitors,
        has_data=True,
        headline_gap_pp=round(headline_gap_pp, 2) if headline_gap_pp is not None else None,
        headline_delta_pp=round(headline_delta_pp, 2) if headline_delta_pp is not None else None,
        brand_visibility_pct=round(brand_pct, 2),
        competitor_avg_pct=round(comp_avg_pct, 2) if eligible_competitors else None,
        trend=trend,
        competitors=comp_stats,
        sample_count=cur_total,
        confidence=_confidence(cur_total),
    )
