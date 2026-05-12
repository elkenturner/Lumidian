"""
Competitive Gap metric — pure read-side aggregation over existing
TrackingRun / QueryResult / Competitor rows.

Headline = brand_visibility_pct − mean(competitor_visibility_pct), computed over
the selected window. Trend = the same gap_pp computed per UTC day.

Spec: docs/superpowers/specs/2026-05-12-competitive-gap-design.md
"""
from __future__ import annotations

import re
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


def _normalize(text: str) -> str:
    """Lowercase + strip non-alphanumeric (mirrors tracking_service brand detection)."""
    return re.sub(r"[^a-z0-9]", "", text.lower())


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
