"""
RVI (Relative Visibility Index) — pure read-side aggregation over existing
TrackingRun / QueryResult / Competitor rows. Replaces the Competitive Gap metric.

    RVI = brand visibility ÷ mean(peer-pool visibility), over contested prompts.

A ratio (not a pp-difference) so category-wide citation shifts cancel out.
Prompts are auto-classified per window:
  contested — ≥1 peer-pool competitor mention (denominator > 0 by construction)
  owned     — brand registers, no peer does (shown as a state, never a ratio)
  unclaimed — nobody registers (excluded, surfaced as a count)

Peer pool = competitors with in_peer_pool=True; exclusions (out-of-weight-class
incumbents) are surfaced by name so the methodological choice stays visible.

Spec: docs/superpowers/specs/2026-07-05-rvi-design.md
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


def _confidence(sample_count: int) -> str:
    if sample_count >= 100:
        return "high"
    if sample_count >= 20:
        return "medium"
    return "low"


# ── Main orchestrator ────────────────────────────────────────────────────────

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Competitor, Prompt, QueryResult, TrackingRun
from app.schemas import (
    RVIContestedPrompt,
    RVIExcludedCompetitor,
    RVIOwnedPrompt,
    RVIPeerStat,
    RVIResponse,
    RVITrendPoint,
)


def _classify_prompts(
    rows: list[QueryResult],
    pool: list[Competitor],
) -> tuple[set[int], set[int], set[int], dict[int, list[QueryResult]]]:
    """
    Partition prompt_ids into (contested, owned, unclaimed) for one window,
    and return the per-prompt row grouping used downstream.

    contested — ≥1 peer-pool mention on the prompt's rows
    owned     — brand mentioned ≥1 time, zero peer-pool mentions
    unclaimed — neither registers
    """
    by_prompt: dict[int, list[QueryResult]] = defaultdict(list)
    for qr in rows:
        by_prompt[qr.prompt_id].append(qr)

    contested: set[int] = set()
    owned: set[int] = set()
    unclaimed: set[int] = set()
    for prompt_id, prompt_rows in by_prompt.items():
        peer_hit = any(
            _mention_matches(qr.response_text, c.name)
            for qr in prompt_rows
            for c in pool
        )
        if peer_hit:
            contested.add(prompt_id)
        elif any(qr.mentioned for qr in prompt_rows):
            owned.add(prompt_id)
        else:
            unclaimed.add(prompt_id)
    return contested, owned, unclaimed, dict(by_prompt)


def _brand_pct(rows: list[QueryResult]) -> float:
    return sum(1 for qr in rows if qr.mentioned) / len(rows) * 100.0


def _peer_pcts(rows: list[QueryResult], pool: list[Competitor]) -> dict[int, float]:
    return {
        c.id: sum(1 for qr in rows if _mention_matches(qr.response_text, c.name)) / len(rows) * 100.0
        for c in pool
    }


def _window_rvi(rows: list[QueryResult], pool: list[Competitor]) -> float | None:
    """RVI over one window's contested rows. None if the set is empty."""
    if not rows or not pool:
        return None
    peer_avg = sum(_peer_pcts(rows, pool).values()) / len(pool)
    if peer_avg == 0:
        return None  # unreachable for contested rows by construction; guard anyway
    return _brand_pct(rows) / peer_avg


def _empty_response(
    brand_id: int,
    window: str,
    *,
    has_peers: bool,
    peers: list[RVIPeerStat],
    excluded: list[RVIExcludedCompetitor],
) -> RVIResponse:
    return RVIResponse(
        brand_id=brand_id,
        window=window,
        has_peers=has_peers,
        has_data=False,
        rvi=None,
        rvi_delta=None,
        brand_pct=None,
        peer_avg_pct=None,
        contested_prompt_count=0,
        owned_prompt_count=0,
        unclaimed_prompt_count=0,
        sample_count=0,
        confidence="low",
        trend=[],
        peers=peers,
        excluded=excluded,
        owned_prompts=[],
        contested_prompts=[],
    )


async def compute_rvi(
    *,
    brand_id: int,
    window: str,
    db: AsyncSession,
) -> RVIResponse:
    """Read-side aggregation. See spec for the full algorithm."""
    start, end, prior_start, prior_end = _resolve_window(window)

    # Competitors → pool / excluded
    comp_rows = await db.execute(
        select(Competitor).where(Competitor.brand_id == brand_id)
    )
    competitors = list(comp_rows.scalars().all())
    pool = [c for c in competitors if c.in_peer_pool]
    excluded = [
        RVIExcludedCompetitor(competitor_id=c.id, name=c.name)
        for c in competitors
        if not c.in_peer_pool
    ]
    has_peers = len(pool) > 0

    # Prompt texts (for drawer payloads)
    prompt_rows = await db.execute(select(Prompt).where(Prompt.brand_id == brand_id))
    prompt_text = {p.id: p.text for p in prompt_rows.scalars().all()}

    def _idle_peers() -> list[RVIPeerStat]:
        return [
            RVIPeerStat(competitor_id=c.id, name=c.name, in_peer_pool=True, pct=None, prompt_hits=0)
            for c in pool
        ]

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
        return _empty_response(
            brand_id, window, has_peers=has_peers, peers=_idle_peers(), excluded=excluded
        )

    run_completed: dict[int, datetime] = {
        r.id: _as_naive_utc(r.completed_at) for r in runs if r.completed_at is not None
    }

    # Query results (errors excluded), partitioned into current / prior windows
    qr_rows = await db.execute(
        select(QueryResult).where(
            QueryResult.tracking_run_id.in_(list(run_completed.keys())),
            QueryResult.error.is_(None),
        )
    )
    current_rows: list[tuple[QueryResult, datetime]] = []
    prior_rows: list[QueryResult] = []
    for qr in qr_rows.scalars().all():
        when = run_completed.get(qr.tracking_run_id)
        if when is None:
            continue
        if start <= when <= end:
            current_rows.append((qr, when))
        elif prior_start <= when < prior_end:
            prior_rows.append(qr)

    if not current_rows:
        return _empty_response(
            brand_id, window, has_peers=has_peers, peers=_idle_peers(), excluded=excluded
        )

    cur_qrs = [qr for qr, _ in current_rows]
    contested_ids, owned_ids, unclaimed_ids, by_prompt = _classify_prompts(cur_qrs, pool)

    # ── Contested aggregate (current window) ────────────────────────────────
    contested_qrs = [qr for qr in cur_qrs if qr.prompt_id in contested_ids]
    rvi = _window_rvi(contested_qrs, pool)
    brand_pct = _brand_pct(contested_qrs) if contested_qrs else None
    peer_pcts = _peer_pcts(contested_qrs, pool) if contested_qrs else {}
    peer_avg_pct = (sum(peer_pcts.values()) / len(pool)) if contested_qrs and pool else None

    # ── Delta vs prior window (classified independently) ────────────────────
    rvi_delta: float | None = None
    if rvi is not None and prior_rows:
        prior_contested_ids, _, _, _ = _classify_prompts(prior_rows, pool)
        prior_contested = [qr for qr in prior_rows if qr.prompt_id in prior_contested_ids]
        prior_rvi = _window_rvi(prior_contested, pool)
        if prior_rvi is not None:
            rvi_delta = rvi - prior_rvi

    # ── Daily trend over the FIXED current contested set ────────────────────
    # Reusing the window-level classification keeps the sparkline from
    # flickering as prompts flip category day to day; days where no peer
    # registers on those prompts yield no point (denominator would be 0).
    trend: list[RVITrendPoint] = []
    contested_dated = [(qr, when) for qr, when in current_rows if qr.prompt_id in contested_ids]
    for day in sorted(_per_day_buckets(contested_dated).keys()):
        day_qrs = _per_day_buckets(contested_dated)[day]
        day_rvi = _window_rvi(day_qrs, pool)
        if day_rvi is not None:
            trend.append(RVITrendPoint(date=day.isoformat(), rvi=round(day_rvi, 3)))

    # ── Per-peer stats over the contested set ────────────────────────────────
    peers = [
        RVIPeerStat(
            competitor_id=c.id,
            name=c.name,
            in_peer_pool=True,
            pct=round(peer_pcts[c.id], 2) if c.id in peer_pcts else None,
            prompt_hits=sum(
                1
                for pid in contested_ids
                if any(_mention_matches(qr.response_text, c.name) for qr in by_prompt[pid])
            ),
        )
        for c in pool
    ]

    # ── Per-prompt payloads (drawer) ─────────────────────────────────────────
    contested_prompts: list[RVIContestedPrompt] = []
    for pid in sorted(contested_ids):
        rows = by_prompt[pid]
        p_brand = _brand_pct(rows)
        p_peer_avg = sum(_peer_pcts(rows, pool).values()) / len(pool)
        contested_prompts.append(RVIContestedPrompt(
            prompt_id=pid,
            text=prompt_text.get(pid, ""),
            brand_pct=round(p_brand, 2),
            peer_avg_pct=round(p_peer_avg, 2),
            rvi=round(p_brand / p_peer_avg, 3),
        ))
    contested_prompts.sort(key=lambda p: p.rvi)

    owned_prompts = [
        RVIOwnedPrompt(
            prompt_id=pid,
            text=prompt_text.get(pid, ""),
            brand_pct=round(_brand_pct(by_prompt[pid]), 2),
        )
        for pid in sorted(owned_ids)
    ]

    return RVIResponse(
        brand_id=brand_id,
        window=window,
        has_peers=has_peers,
        has_data=True,
        rvi=round(rvi, 3) if rvi is not None else None,
        rvi_delta=round(rvi_delta, 3) if rvi_delta is not None else None,
        brand_pct=round(brand_pct, 2) if brand_pct is not None else None,
        peer_avg_pct=round(peer_avg_pct, 2) if peer_avg_pct is not None else None,
        contested_prompt_count=len(contested_ids),
        owned_prompt_count=len(owned_ids),
        unclaimed_prompt_count=len(unclaimed_ids),
        sample_count=len(contested_qrs),
        confidence=_confidence(len(contested_qrs)),
        trend=trend,
        peers=peers,
        excluded=excluded,
        owned_prompts=owned_prompts,
        contested_prompts=contested_prompts,
    )
