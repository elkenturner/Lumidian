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


# ── Phase 1.3: stale-run estimator local tier_runs dict 5 -> 3 ────────────────

from app import database as db_module


def test_database_local_tier_runs_dict_uses_three():
    """The estimator inside fail_stale_runs_for_brand must mirror TIER_RUNS."""
    src = inspect.getsource(db_module.fail_stale_runs_for_brand)
    matches = re.findall(r"tier_runs\s*=\s*\{([^}]+)\}", src)
    assert matches, "Could not locate tier_runs literal in fail_stale_runs_for_brand"
    nums = re.findall(r":\s*(\d+)", matches[0])
    assert nums and all(n == "3" for n in nums), f"tier_runs has non-3 values: {nums}"


# ── Phase 2: gemini-2.5-pro killed ────────────────────────────────────────────

def test_gemini_uses_flash_for_default_and_pro():
    versions = llm_service._MODEL_VERSIONS["gemini"]
    assert versions["default"] == "gemini-2.5-flash"
    assert versions["pro"] == "gemini-2.5-flash", (
        "Pro tier must NOT use gemini-2.5-pro — experiment showed zero accuracy "
        "uplift and 2.8x latency. Spec decision #1."
    )


def test_get_model_version_for_gemini_pro_returns_flash():
    assert llm_service._get_model_version("gemini", pro=True) == "gemini-2.5-flash"
    assert llm_service._get_model_version("gemini", pro=False) == "gemini-2.5-flash"


def test_gemini_pro_timeout_constant_removed():
    assert not hasattr(llm_service, "_GEMINI_PRO_TIMEOUT"), (
        "Dead constant — Pro variant of Gemini was killed in Phase 2.1"
    )


def test_fallback_models_does_not_reference_gemini_pro():
    src = inspect.getsource(llm_service._with_retry)
    assert "gemini-2.5-pro" not in src, (
        "_FALLBACK_MODELS still references killed gemini-2.5-pro"
    )


# ── Phase 3: ChatGPT search for paid; skip for pitch ──────────────────────────

def test_chatgpt_pro_variant_uses_search_model():
    versions = llm_service._MODEL_VERSIONS["chatgpt"]
    assert versions["default"] == "gpt-4.1-mini"
    assert versions["pro"] == "gpt-4o-mini-search-preview", (
        "Pro tier ChatGPT must use the OpenAI native web-search model "
        "(spec decision #3)"
    )


def test_get_model_version_for_chatgpt_pro_returns_search_variant():
    assert llm_service._get_model_version("chatgpt", pro=True) == "gpt-4o-mini-search-preview"
    assert llm_service._get_model_version("chatgpt", pro=False) == "gpt-4.1-mini"
