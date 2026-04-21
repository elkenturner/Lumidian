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


def test_strip_url_citations_removes_full_urls():
    raw = "The best widget is from Acme Inc. See https://acme.com/about for more."
    cleaned = llm_service._strip_url_citations(raw)
    assert "https://acme.com/about" not in cleaned
    assert "Acme Inc" in cleaned


def test_strip_url_citations_removes_markdown_links():
    raw = "Check out ([Stripe](https://stripe.com/docs)) for payments."
    cleaned = llm_service._strip_url_citations(raw)
    assert "stripe.com" not in cleaned.lower()
    assert "Stripe" in cleaned  # the visible link text survives


def test_strip_url_citations_removes_bracket_refs():
    raw = "Use Webflow [1] or Framer [2] for design[3]."
    cleaned = llm_service._strip_url_citations(raw)
    assert "[1]" not in cleaned
    assert "[2]" not in cleaned
    assert "[3]" not in cleaned
    assert "Webflow" in cleaned and "Framer" in cleaned


def test_strip_url_citations_prevents_false_positive_brand_match():
    """Citation-only mentions of a brand domain MUST NOT count as a brand mention."""
    raw = (
        "I recommend Notion and Coda for note-taking. "
        "Sources: https://stripe.com/blog/payments-overview"
    )
    cleaned = llm_service._strip_url_citations(raw)
    assert "stripe" not in cleaned.lower()


# ── Phase 3.3: _query_chatgpt search variant ──────────────────────────────────

from unittest.mock import AsyncMock, MagicMock, patch


def _mock_openai_response(content: str):
    msg = MagicMock()
    msg.message = MagicMock()
    msg.message.content = content
    resp = MagicMock()
    resp.choices = [msg]
    return resp


@pytest.mark.asyncio
async def test_query_chatgpt_search_variant_uses_web_search_options():
    """Pro/search model call must include web_search_options={}."""
    fake_response = _mock_openai_response("Acme is great. https://acme.com")

    with patch.object(llm_service, "OPENAI_API_KEY", "sk-test"):
        with patch("openai.AsyncOpenAI") as mock_cls:
            client = mock_cls.return_value
            client.chat.completions.create = AsyncMock(return_value=fake_response)

            result = await llm_service._query_chatgpt(
                "is acme good?", "Acme", model_version="gpt-4o-mini-search-preview"
            )

    create_kwargs = client.chat.completions.create.await_args.kwargs
    assert create_kwargs["model"] == "gpt-4o-mini-search-preview"
    assert "web_search_options" in create_kwargs
    assert create_kwargs["web_search_options"] == {}
    # Non-search params that the preview model rejects must be absent
    assert "temperature" not in create_kwargs
    assert result["mentioned"] is True


@pytest.mark.asyncio
async def test_query_chatgpt_default_variant_does_not_send_web_search_options():
    """Default (non-search) model must NOT pass web_search_options."""
    fake_response = _mock_openai_response("Plain text response about Acme.")
    with patch.object(llm_service, "OPENAI_API_KEY", "sk-test"):
        with patch("openai.AsyncOpenAI") as mock_cls:
            client = mock_cls.return_value
            client.chat.completions.create = AsyncMock(return_value=fake_response)

            await llm_service._query_chatgpt(
                "test", "Acme", model_version="gpt-4.1-mini"
            )

    create_kwargs = client.chat.completions.create.await_args.kwargs
    assert "web_search_options" not in create_kwargs


@pytest.mark.asyncio
async def test_query_chatgpt_strips_citations_before_mention_check():
    """A brand whose name appears ONLY inside a citation URL must NOT count."""
    fake_response = _mock_openai_response(
        "I recommend Notion and Coda. Sources: https://stripe.com/blog"
    )
    with patch.object(llm_service, "OPENAI_API_KEY", "sk-test"):
        with patch("openai.AsyncOpenAI") as mock_cls:
            client = mock_cls.return_value
            client.chat.completions.create = AsyncMock(return_value=fake_response)

            result = await llm_service._query_chatgpt(
                "best note-taking?", "Stripe", model_version="gpt-4o-mini-search-preview"
            )

    assert result["mentioned"] is False, (
        "Stripe appeared only in a citation URL — must be stripped before mention check"
    )


@pytest.mark.asyncio
async def test_query_chatgpt_search_variant_uses_higher_token_cap():
    """Search responses include long citation footers — token cap must be bumped."""
    fake_response = _mock_openai_response("ok")
    with patch.object(llm_service, "OPENAI_API_KEY", "sk-test"):
        with patch("openai.AsyncOpenAI") as mock_cls:
            client = mock_cls.return_value
            client.chat.completions.create = AsyncMock(return_value=fake_response)

            await llm_service._query_chatgpt(
                "test", "Acme", model_version="gpt-4o-mini-search-preview"
            )

    create_kwargs = client.chat.completions.create.await_args.kwargs
    assert create_kwargs["max_completion_tokens"] >= 2048


def test_tracking_service_detect_mention_strips_citations():
    from app.services.tracking_service import _detect_mention as _ts_detect_mention
    response = "Try Notion. Sources: https://stripe.com/blog"
    assert _ts_detect_mention("Stripe", response, error=None, model="chatgpt") is False


# ── Phase 3.4: pitch brands skip ChatGPT ──────────────────────────────────────

def test_supported_models_includes_chatgpt():
    assert "chatgpt" in llm_service.SUPPORTED_MODELS


def test_models_for_brand_type_excludes_chatgpt_for_pitch():
    models = llm_service.models_for_brand_type("pitch")
    assert "chatgpt" not in models
    assert set(models) == {"claude", "perplexity", "gemini"}


def test_models_for_brand_type_includes_chatgpt_for_standard():
    models = llm_service.models_for_brand_type("standard")
    assert set(models) == {"chatgpt", "claude", "perplexity", "gemini"}


def test_models_for_brand_type_includes_chatgpt_for_pro():
    models = llm_service.models_for_brand_type("pro")
    assert set(models) == {"chatgpt", "claude", "perplexity", "gemini"}


def test_models_for_brand_type_unknown_defaults_to_full_list():
    models = llm_service.models_for_brand_type("something-weird")
    assert set(models) == {"chatgpt", "claude", "perplexity", "gemini"}


# ── Phase 4: avg-of-per-model overall score ───────────────────────────────────


def test_compute_overall_score_avg_of_per_model():
    stats = {
        "chatgpt":    {"total_queries": 9, "total_mentions": 3},
        "claude":     {"total_queries": 9, "total_mentions": 0},
        "perplexity": {"total_queries": 9, "total_mentions": 6},
        "gemini":     {"total_queries": 9, "total_mentions": 9},
    }
    # Avg = (33.33 + 0 + 66.67 + 100) / 4 = 50.0
    assert ts._compute_overall_score(stats) == pytest.approx(50.0, abs=0.05)


def test_compute_overall_score_skips_zero_query_models():
    stats = {
        "chatgpt":    {"total_queries": 0, "total_mentions": 0},
        "claude":     {"total_queries": 6, "total_mentions": 3},
        "perplexity": {"total_queries": 6, "total_mentions": 3},
        "gemini":     {"total_queries": 6, "total_mentions": 3},
    }
    assert ts._compute_overall_score(stats) == pytest.approx(50.0)


def test_compute_overall_score_returns_zero_for_all_zero():
    stats = {
        "chatgpt": {"total_queries": 0, "total_mentions": 0},
        "claude":  {"total_queries": 0, "total_mentions": 0},
    }
    assert ts._compute_overall_score(stats) == 0.0


def test_compute_overall_score_does_not_double_count_old_formula():
    """Regression: old denominator-weighted formula would give 23.08% here."""
    stats = {
        "chatgpt":    {"total_queries": 30, "total_mentions": 0},
        "claude":     {"total_queries": 3,  "total_mentions": 3},
        "perplexity": {"total_queries": 3,  "total_mentions": 3},
        "gemini":     {"total_queries": 3,  "total_mentions": 3},
    }
    # Old formula: 9 / 39 = 23.08%
    # Avg formula: (0 + 100 + 100 + 100) / 4 = 75.0%
    assert ts._compute_overall_score(stats) == pytest.approx(75.0)


# ── Phase 5: Pro prompt cap 100 -> 30 ─────────────────────────────────────────

from app.routers import billing as billing_module


def test_pro_tier_limit_is_thirty():
    assert billing_module.TIER_LIMITS["pro"] == 30


def test_pro_prompt_limit_is_thirty():
    assert billing_module.PROMPT_LIMITS["pro"] == 30


def test_other_tier_limits_unchanged():
    assert billing_module.TIER_LIMITS["basic"] == 15
    assert billing_module.TIER_LIMITS["starter"] == 25
    assert billing_module.PROMPT_LIMITS["pitch"] == 10
    assert billing_module.PROMPT_LIMITS["standard"] == 25


@pytest.mark.asyncio
async def test_run_tracking_skips_chatgpt_for_pitch_brand(monkeypatch):
    """End-to-end: pitch brand should query 3 models, not 4."""
    from app.database import AsyncSessionLocal
    from app.models import Brand, Prompt, User

    async with AsyncSessionLocal() as db:
        u = User(email="pitch_e2e@test.com", name="t", subscription_tier=None,
                email_verified=1)
        db.add(u)
        await db.commit()
        await db.refresh(u)
        b = Brand(name="PitchBrand", slug="pitchbrand-e2e", user_id=u.id,
                  tier="basic", brand_type="pitch")
        db.add(b)
        await db.commit()
        await db.refresh(b)
        p = Prompt(brand_id=b.id, text="any prompt", prompt_type="pitch")
        db.add(p)
        await db.commit()
        brand_id = b.id

    call_log: list[str] = []

    async def fake_query_model(model, prompt, brand_name, pro=False, cancel_event=None):
        call_log.append(model)
        return {"response_text": f"text-from-{model}", "mentioned": False,
                "latency_ms": 1, "error": None}

    monkeypatch.setattr("app.services.tracking_service.query_model", fake_query_model)

    from app.services.tracking_service import run_tracking
    await run_tracking(brand_id, run_type="manual")

    assert "chatgpt" not in call_log, "Pitch brands must skip ChatGPT"
    # 3 models * 3 runs * 1 prompt = 9 calls
    assert len(call_log) == 9, f"Expected 9 calls (3 models × 3 runs), got {len(call_log)}"
