"""
Competitive Gap metric — pure read-side aggregation over existing
TrackingRun / QueryResult / Competitor rows.

Headline = brand_visibility_pct − mean(competitor_visibility_pct), computed over
the selected window. Trend = the same gap_pp computed per UTC day.

Spec: docs/superpowers/specs/2026-05-12-competitive-gap-design.md
"""
from __future__ import annotations

from datetime import UTC, datetime, timedelta
from typing import Literal

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
