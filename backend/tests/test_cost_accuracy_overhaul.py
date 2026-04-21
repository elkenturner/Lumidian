"""
Behavior tests for the 2026-04-20 cost/accuracy overhaul.
Each test pins ONE behavior change from the spec.
"""
from __future__ import annotations

import inspect
import re

import pytest

from app.services import llm_service
from app.services import tracking_service as ts


# ── Phase 1: runs per prompt = 3 ──────────────────────────────────────────────

def test_tier_runs_is_three_for_every_tier():
    assert llm_service.TIER_RUNS == {"basic": 3, "standard": 3, "premium": 3}


# ── Phase 1.2: drop-alert threshold 10 -> 15 ──────────────────────────────────

def test_scheduler_alert_drop_pct_is_fifteen():
    from app import scheduler as sched
    src = inspect.getsource(sched.alert_visibility_drops) if hasattr(sched, "alert_visibility_drops") else inspect.getsource(sched)
    matches = re.findall(r"ALERT_DROP_PCT\s*=\s*([\d.]+)", src)
    assert matches, "ALERT_DROP_PCT constant not found"
    assert all(float(m) == 15.0 for m in matches), f"ALERT_DROP_PCT not 15.0: {matches}"


def test_tracking_service_in_app_drop_threshold_is_fifteen():
    """The literal `>= 15.0` must appear in tracking_service near the visibility_drop notification."""
    src = inspect.getsource(ts.run_tracking)
    assert "visibility_drop" in src
    matches = re.findall(r"drop\s*>=\s*([\d.]+)", src)
    assert matches, "Could not find `drop >= N` comparison"
    assert all(float(m) == 15.0 for m in matches), (
        f"Drop threshold(s) not 15.0: {matches}"
    )
