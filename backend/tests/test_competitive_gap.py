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
