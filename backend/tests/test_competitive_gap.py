"""
Tests for the Competitive Gap metric (service + endpoint).
"""
from datetime import UTC, datetime, timedelta

import httpx
import pytest

pytestmark = pytest.mark.asyncio


# ── _resolve_window ──────────────────────────────────────────────────────────

def test_resolve_window_7d():
    from app.services.competitive_gap import _resolve_window

    now = datetime(2026, 5, 12, 14, 0, 0, tzinfo=UTC)
    start, end, prior_start, prior_end = _resolve_window("7d", now=now)

    # Naive UTC datetimes (matches TrackingRun.completed_at storage)
    assert start.tzinfo is None
    assert end.tzinfo is None
    assert end == datetime(2026, 5, 12, 14, 0, 0)
    assert start == end - timedelta(days=7)
    assert prior_end == start
    assert prior_start == start - timedelta(days=7)


def test_resolve_window_30d():
    from app.services.competitive_gap import _resolve_window

    now = datetime(2026, 5, 12, 14, 0, 0, tzinfo=UTC)
    start, end, prior_start, prior_end = _resolve_window("30d", now=now)

    assert (end - start) == timedelta(days=30)
    assert (prior_end - prior_start) == timedelta(days=30)
    assert prior_end == start


def test_resolve_window_90d():
    from app.services.competitive_gap import _resolve_window

    now = datetime(2026, 5, 12, 14, 0, 0, tzinfo=UTC)
    start, end, prior_start, prior_end = _resolve_window("90d", now=now)

    assert (end - start) == timedelta(days=90)


def test_resolve_window_invalid_raises():
    from app.services.competitive_gap import _resolve_window

    with pytest.raises(ValueError):
        _resolve_window("5d")


# ── _mention_matches ─────────────────────────────────────────────────────────

def test_mention_matches_exact():
    from app.services.competitive_gap import _mention_matches
    assert _mention_matches("I love Notion for notes.", "Notion") is True


def test_mention_matches_case_insensitive():
    from app.services.competitive_gap import _mention_matches
    assert _mention_matches("notion is great", "Notion") is True


def test_mention_matches_word_boundary_no_substring_false_positive():
    """Asana must NOT match inside Casana."""
    from app.services.competitive_gap import _mention_matches
    assert _mention_matches("Casana raised a Series A.", "Asana") is False


def test_mention_matches_punctuation_boundary():
    """Trailing punctuation should still count as a match."""
    from app.services.competitive_gap import _mention_matches
    assert _mention_matches("Try Asana. It's great.", "Asana") is True


def test_mention_matches_regex_metachars_escaped():
    """Names with regex metacharacters must not blow up."""
    from app.services.competitive_gap import _mention_matches
    assert _mention_matches("We use C++ heavily.", "C++") is True
    assert _mention_matches("See notion.so for docs.", "Notion.so") is True


def test_mention_matches_fuzzy_normalized():
    """When word-boundary fails, fall back to alphanumeric-normalized substring
    (mirrors brand detection in tracking_service)."""
    from app.services.competitive_gap import _mention_matches
    # "SpotItEarly" should match "Spot it Early" via the fuzzy path
    assert _mention_matches("Check out SpotItEarly today.", "Spot it Early") is True


def test_mention_matches_empty_text_returns_false():
    from app.services.competitive_gap import _mention_matches
    assert _mention_matches("", "Notion") is False
    assert _mention_matches(None, "Notion") is False


# ── _per_day_buckets ─────────────────────────────────────────────────────────

def test_per_day_buckets_groups_by_utc_date():
    from datetime import date, datetime
    from app.services.competitive_gap import _per_day_buckets

    rows = [
        ("rowA", datetime(2026, 5, 10, 9, 0)),
        ("rowB", datetime(2026, 5, 10, 23, 30)),
        ("rowC", datetime(2026, 5, 11, 8, 0)),
    ]
    out = _per_day_buckets(rows)

    assert set(out.keys()) == {date(2026, 5, 10), date(2026, 5, 11)}
    assert len(out[date(2026, 5, 10)]) == 2
    assert len(out[date(2026, 5, 11)]) == 1


def test_per_day_buckets_empty_input_returns_empty_dict():
    from app.services.competitive_gap import _per_day_buckets
    assert _per_day_buckets([]) == {}
