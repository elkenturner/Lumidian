# Cost / Accuracy Overhaul Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cut LLM cost ~30–75% per tier while raising mention-detection accuracy on paid tiers, by killing dead-weight Pro variants of Gemini, switching ChatGPT to native web search for paid users, removing ChatGPT entirely for pitch (free trial) brands, halving runs-per-prompt, switching the overall-score formula to avg-of-per-model, and lowering the Pro prompt cap from 100 to 30.

**Architecture:** All changes are localized inside the existing services + routers. Three orchestrators (`tracking_service.run_tracking`, `tracking._do_run`, `tracking._do_prompt_run`) currently duplicate per-model aggregation logic — to keep this plan small we update each call site rather than refactor into a shared helper. New behavior is unit-testable through `app.services.llm_service.SUPPORTED_MODELS` filtering and a new pure helper `_compute_overall_score`. Existing Pro brands with >30 prompts are **grandfathered**: we do NOT delete prompts — the cap only blocks adding new ones.

**Tech Stack:** Python 3.11, FastAPI, SQLAlchemy 2.0 async, pytest-asyncio, Next.js 15, React 18, Tailwind. Uses the existing OpenAI SDK (`openai>=1.0`) for ChatGPT search variant.

**Source spec:** `docs/superpowers/specs/2026-04-20-cost-accuracy-decisions.md`

**Branch:** `cost-accuracy-overhaul` (already created, off `main`).

**Working directory:** `/Users/ken/Desktop/Lumidian`. Backend tests run from `/Users/ken/Desktop/Lumidian/backend` with `source venv/bin/activate` and `pytest`.

---

## File Manifest

**Modify (backend):**
- `backend/app/services/llm_service.py` — TIER_RUNS, _MODEL_VERSIONS, _query_chatgpt, citation stripping, fallback list, gemini timeout, max_completion_tokens
- `backend/app/services/tracking_service.py` — overall-score formula, pitch-brand model filter, propagate brand_type
- `backend/app/routers/tracking.py` — overall-score formula in manual + per-prompt runs, pitch-brand model filter
- `backend/app/routers/billing.py` — TIER_LIMITS["pro"] 100→30, PROMPT_LIMITS["pro"] 100→30
- `backend/app/database.py` — data-fix migration: lower Pro `prompt_limit` to 30 only for brands at the old default (100); fail_stale_runs_for_brand local tier_runs dict 5→3
- `backend/app/scheduler.py` — `ALERT_DROP_PCT` constant 10→15 + matching docstring

**Modify (frontend):**
- `frontend/app/page.tsx` — landing comparison table (`Prompts per brand` Pro 100→30; `AI models monitored` free 4→3)
- `frontend/app/settings/billing/page.tsx` — TIER_FEATURES Pro `100`→`30`, label text, current-plan summary line
- `frontend/app/methodology/page.tsx` — remove "Paid plans run each prompt more times per model" line; clarify the score formula caption
- `frontend/app/dashboard/page.tsx` — switch `liveScore` and `indexScore` from `sum(m)/sum(q)` to avg-of-per-model
- `frontend/components/dashboard/ModelBreakdownCard.tsx` (or its host on dashboard page) — render the locked ChatGPT card for pitch users
- `frontend/lib/constants/models.ts` — add `LOCKED_FOR_PITCH` set for the dashboard locked-card lookup

**Create:**
- `backend/tests/test_cost_accuracy_overhaul.py` — unit + integration tests for every behavior change in this plan
- (no new source files)

---

## Phase 1 — Reduce runs per prompt: 5 → 3

### Task 1.1: Update TIER_RUNS in llm_service.py

**Files:**
- Modify: `backend/app/services/llm_service.py:91-95`
- Test: `backend/tests/test_cost_accuracy_overhaul.py`

- [ ] **Step 1: Write the failing test**

Create `backend/tests/test_cost_accuracy_overhaul.py` (new file):

```python
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
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd /Users/ken/Desktop/Lumidian/backend && source venv/bin/activate && pytest tests/test_cost_accuracy_overhaul.py::test_tier_runs_is_three_for_every_tier -v
```
Expected: FAIL — actual values are all 5.

- [ ] **Step 3: Apply the change**

Edit `backend/app/services/llm_service.py` — replace lines 91-95:

```python
TIER_RUNS = {
    "basic": 3,
    "standard": 3,
    "premium": 3,
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
pytest tests/test_cost_accuracy_overhaul.py::test_tier_runs_is_three_for_every_tier -v
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/llm_service.py backend/tests/test_cost_accuracy_overhaul.py
git commit -m "feat(cost): reduce runs per prompt 5 -> 3 for all tiers"
```

---

### Task 1.2: Raise visibility-drop alert threshold 10pp → 15pp

Spec decision #2 bundles a noise-reduction change with the runs reduction. With 3 runs per prompt instead of 5, per-prompt scores move in larger increments (33% steps vs 20%) and aggregate run-to-run noise increases. The 10pp drop alert would fire too often; raise it to 15pp.

**Files:**
- Modify: `backend/app/services/tracking_service.py:571` (in-app `visibility_drop` notification trigger)
- Modify: `backend/app/scheduler.py:299` (daily 21:00 UTC email alert constant `ALERT_DROP_PCT`)
- Modify: `backend/app/scheduler.py:9` (the docstring that mentions "≥ 10 pts")

- [ ] **Step 1: Write the failing tests**

Add to `backend/tests/test_cost_accuracy_overhaul.py`:

```python
# ── Phase 1.2: drop-alert threshold 10 -> 15 ──────────────────────────────────

def test_scheduler_alert_drop_pct_is_fifteen():
    from app import scheduler as sched
    assert sched.ALERT_DROP_PCT == 15.0


def test_tracking_service_in_app_drop_threshold_is_fifteen():
    """The literal `>= 15.0` must appear in tracking_service near the visibility_drop notification."""
    src = inspect.getsource(ts.run_tracking)
    # The relevant line creates a Notification with type="visibility_drop"
    assert "visibility_drop" in src
    # Ensure the comparison uses 15.0 not 10.0
    # (Locate the block and check the comparison operand)
    import re
    matches = re.findall(r"drop\s*>=\s*([\d.]+)", src)
    assert matches, "Could not find `drop >= N` comparison"
    assert all(float(m) == 15.0 for m in matches), (
        f"Drop threshold(s) not 15.0: {matches}"
    )
```

- [ ] **Step 2: Run to verify failure**

```bash
pytest tests/test_cost_accuracy_overhaul.py -k "drop_threshold or alert_drop_pct" -v
```
Expected: 2 FAILs.

- [ ] **Step 3: Apply the changes**

(a) In `backend/app/services/tracking_service.py:571`, replace:

```python
                    if drop >= 10.0:
```

with:

```python
                    if drop >= 15.0:
```

(b) In `backend/app/scheduler.py:299`, replace:

```python
    ALERT_DROP_PCT = 10.0       # trigger when score drops ≥ 10 points
```

with:

```python
    ALERT_DROP_PCT = 15.0       # trigger when score drops ≥ 15 points (raised 2026-04-20 to compensate for finer 3-run granularity)
```

(c) In `backend/app/scheduler.py:9`, replace the line in the module docstring:

```python
  • 21:00 UTC        — Visibility drop alerts (email if score drops ≥ 10 pts vs previous run)
```

with:

```python
  • 21:00 UTC        — Visibility drop alerts (email if score drops ≥ 15 pts vs previous run)
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
pytest tests/test_cost_accuracy_overhaul.py -k "drop_threshold or alert_drop_pct" -v
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/tracking_service.py backend/app/scheduler.py backend/tests/test_cost_accuracy_overhaul.py
git commit -m "feat(alerts): raise visibility-drop threshold 10pp -> 15pp"
```

---

### Task 1.3: Sync the stale-run estimator's local TIER_RUNS dict

`database.fail_stale_runs_for_brand` defines its own local dict at line ~422. Leaving it at 5 makes the stale-run timeout 1.66× longer than reality.

**Files:**
- Modify: `backend/app/database.py:422`

- [ ] **Step 1: Write the failing test**

Add to `backend/tests/test_cost_accuracy_overhaul.py`:

```python
import inspect
import re

from app import database as db_module


def test_database_local_tier_runs_dict_uses_three():
    """The estimator inside fail_stale_runs_for_brand must mirror TIER_RUNS."""
    src = inspect.getsource(db_module.fail_stale_runs_for_brand)
    # Find every 'tier_runs = {...}' literal
    matches = re.findall(r"tier_runs\s*=\s*\{([^}]+)\}", src)
    assert matches, "Could not locate tier_runs literal in fail_stale_runs_for_brand"
    # Every numeric value in the literal must be 3
    nums = re.findall(r":\s*(\d+)", matches[0])
    assert nums and all(n == "3" for n in nums), f"tier_runs has non-3 values: {nums}"
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pytest tests/test_cost_accuracy_overhaul.py::test_database_local_tier_runs_dict_uses_three -v
```
Expected: FAIL.

- [ ] **Step 3: Apply the change**

In `backend/app/database.py`, replace the line currently reading:

```python
        tier_runs = {"basic": 5, "standard": 5, "premium": 5}
```

with:

```python
        tier_runs = {"basic": 3, "standard": 3, "premium": 3}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
pytest tests/test_cost_accuracy_overhaul.py::test_database_local_tier_runs_dict_uses_three -v
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/app/database.py backend/tests/test_cost_accuracy_overhaul.py
git commit -m "fix(stale-runs): sync local tier_runs estimator to 3 runs per prompt"
```

---

## Phase 2 — Kill gemini-2.5-pro

### Task 2.1: Use Flash for both default and pro Gemini variants

**Files:**
- Modify: `backend/app/services/llm_service.py:108-113` (the `_MODEL_VERSIONS` dict)

- [ ] **Step 1: Write the failing test**

Add to `backend/tests/test_cost_accuracy_overhaul.py`:

```python
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
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
pytest tests/test_cost_accuracy_overhaul.py -k "gemini" -v
```
Expected: 2 FAILs.

- [ ] **Step 3: Apply the change**

Edit `backend/app/services/llm_service.py` — replace the line in `_MODEL_VERSIONS`:

```python
    "gemini":     {"default": "gemini-2.5-flash",           "pro": "gemini-2.5-flash"},
```

(was: `"pro": "gemini-2.5-pro"`)

- [ ] **Step 4: Run tests to verify they pass**

```bash
pytest tests/test_cost_accuracy_overhaul.py -k "gemini" -v
```
Expected: PASS for both.

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/llm_service.py backend/tests/test_cost_accuracy_overhaul.py
git commit -m "feat(gemini): use Flash for all tiers (kill gemini-2.5-pro)"
```

---

### Task 2.2: Remove gemini-2.5-pro from fallback list and delete unused timeout

`_FALLBACK_MODELS` in `_with_retry` still references `gemini-2.5-pro` even though no caller will ever request it. The constant `_GEMINI_PRO_TIMEOUT` is also dead. Both should go to keep the file honest.

**Files:**
- Modify: `backend/app/services/llm_service.py:292-293` (delete `_GEMINI_PRO_TIMEOUT`)
- Modify: `backend/app/services/llm_service.py:300` (`timeout = _GEMINI_PRO_TIMEOUT if "pro" in model_version else _GEMINI_TIMEOUT` → just `_GEMINI_TIMEOUT`)
- Modify: `backend/app/services/llm_service.py:426-429` (`_FALLBACK_MODELS` — drop the gemini entry)

- [ ] **Step 1: Write the failing tests**

Add to `backend/tests/test_cost_accuracy_overhaul.py`:

```python
def test_gemini_pro_timeout_constant_removed():
    assert not hasattr(llm_service, "_GEMINI_PRO_TIMEOUT"), (
        "Dead constant — Pro variant of Gemini was killed in Phase 2.1"
    )


def test_fallback_models_does_not_reference_gemini_pro():
    src = inspect.getsource(llm_service._with_retry)
    assert "gemini-2.5-pro" not in src, (
        "_FALLBACK_MODELS still references killed gemini-2.5-pro"
    )
```

(Add `import inspect` at top of test file if not already present.)

- [ ] **Step 2: Run tests to verify they fail**

```bash
pytest tests/test_cost_accuracy_overhaul.py -k "fallback or pro_timeout" -v
```
Expected: 2 FAILs.

- [ ] **Step 3: Apply the change**

In `backend/app/services/llm_service.py`:

(a) Delete the `_GEMINI_PRO_TIMEOUT = 120.0` line (around line 293) and its preceding comment about Pro models.

(b) In `_query_gemini` (around line 300), replace:

```python
    timeout = _GEMINI_PRO_TIMEOUT if "pro" in model_version else _GEMINI_TIMEOUT
```

with:

```python
    timeout = _GEMINI_TIMEOUT
```

(c) In `_with_retry`, replace the `_FALLBACK_MODELS` block (around lines 426-429):

```python
    _FALLBACK_MODELS = {
        "sonar-pro": "sonar",
    }
```

(removed the gemini entry)

- [ ] **Step 4: Run tests to verify they pass**

```bash
pytest tests/test_cost_accuracy_overhaul.py -k "fallback or pro_timeout" -v
```
Expected: PASS for both.

- [ ] **Step 5: Run the full overhaul test file to make sure earlier tests still pass**

```bash
pytest tests/test_cost_accuracy_overhaul.py -v
```
Expected: ALL PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/app/services/llm_service.py backend/tests/test_cost_accuracy_overhaul.py
git commit -m "refactor(gemini): drop _GEMINI_PRO_TIMEOUT and pro fallback"
```

---

## Phase 3 — ChatGPT web search for paid tiers, skip for pitch

The cleanest cut is to make `_query_chatgpt` aware of "is this the search variant?", strip URL citations from the response **before** the brand-mention substring check, and bump `max_completion_tokens` only when the search variant is in use. Pitch-brand exclusion happens one level up in `tracking_service` / `tracking` by filtering `SUPPORTED_MODELS`.

### Task 3.1: Wire `gpt-4o-mini-search-preview` as the Pro ChatGPT variant

**Files:**
- Modify: `backend/app/services/llm_service.py:108-113` (`_MODEL_VERSIONS["chatgpt"]`)

- [ ] **Step 1: Write the failing test**

Add to `backend/tests/test_cost_accuracy_overhaul.py`:

```python
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
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
pytest tests/test_cost_accuracy_overhaul.py -k "chatgpt" -v
```
Expected: FAIL.

- [ ] **Step 3: Apply the change**

Edit the `chatgpt` row of `_MODEL_VERSIONS`:

```python
    "chatgpt":    {"default": "gpt-4.1-mini",              "pro": "gpt-4o-mini-search-preview"},
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
pytest tests/test_cost_accuracy_overhaul.py -k "chatgpt" -v
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/llm_service.py backend/tests/test_cost_accuracy_overhaul.py
git commit -m "feat(chatgpt): wire gpt-4o-mini-search-preview as Pro variant"
```

---

### Task 3.2: Add `_strip_url_citations` helper

OpenAI's `gpt-4o-mini-search-preview` returns answers that often end in a citation footer of bare URLs and bracketed reference markers (`([example.com](https://example.com))`, `[1]`, etc.). A naive substring check would match `Stripe` inside a citation URL like `https://stripe.com/blog/...` even when the answer text doesn't actually mention Stripe. We strip all URLs and bracketed citation markers BEFORE the mention-detection substring check. Plain text is preserved.

**Files:**
- Modify: `backend/app/services/llm_service.py` (add helper function, exact location: directly above the `_query_chatgpt` function, around line 144)

- [ ] **Step 1: Write the failing test**

Add to `backend/tests/test_cost_accuracy_overhaul.py`:

```python
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
    # 'stripe' should be GONE after stripping the URL
    assert "stripe" not in cleaned.lower()
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
pytest tests/test_cost_accuracy_overhaul.py -k "strip_url" -v
```
Expected: 4 FAILs (function does not exist).

- [ ] **Step 3: Implement the helper**

In `backend/app/services/llm_service.py`, add directly above `# ── ChatGPT ──...` (around line 144):

```python
import re

# Patterns for stripping citation noise from search-model responses.
# Applied BEFORE mention-detection so brand names hidden in URL hostnames
# (e.g. "stripe.com" in a footer) do not produce false-positive matches.
_URL_RE = re.compile(r"https?://\S+", re.IGNORECASE)
_BRACKET_REF_RE = re.compile(r"\[\d+\]")
_MD_LINK_RE = re.compile(r"\[([^\]]+)\]\([^)]+\)")  # [text](url) -> text


def _strip_url_citations(text: str) -> str:
    """
    Remove URLs, bracketed numeric refs, and markdown link targets so brand
    mention detection only sees the visible answer text.
    Markdown link text is preserved (so "[Stripe](https://stripe.com)" -> "Stripe").
    """
    if not text:
        return text
    # 1) Markdown links — keep the visible label, drop the URL
    text = _MD_LINK_RE.sub(r"\1", text)
    # 2) Bare URLs — drop entirely
    text = _URL_RE.sub("", text)
    # 3) Bracketed numeric citation markers like [1] [2] — drop
    text = _BRACKET_REF_RE.sub("", text)
    return text
```

(Note: a top-of-file `import re` already exists in `tracking_service.py` but not in `llm_service.py`. Add `import re` to the existing top-of-file imports in `llm_service.py` rather than the function-local position above. Place it alphabetically between `import random` and `import time`.)

- [ ] **Step 4: Run tests to verify they pass**

```bash
pytest tests/test_cost_accuracy_overhaul.py -k "strip_url" -v
```
Expected: 4 PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/llm_service.py backend/tests/test_cost_accuracy_overhaul.py
git commit -m "feat(chatgpt): add _strip_url_citations for search-model responses"
```

---

### Task 3.3: Use search API + apply citation stripping in `_query_chatgpt`

The OpenAI search variant accepts the same Chat Completions endpoint but does NOT support `temperature` and uses `web_search_options={}` rather than tools. Citations live inline in the message content; we strip them before the mention check.

**Files:**
- Modify: `backend/app/services/llm_service.py:146-179` (the entire `_query_chatgpt` function)

- [ ] **Step 1: Write the failing tests**

Add to `backend/tests/test_cost_accuracy_overhaul.py`:

```python
import asyncio
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
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
pytest tests/test_cost_accuracy_overhaul.py -k "query_chatgpt" -v
```
Expected: 4 FAILs.

- [ ] **Step 3: Replace `_query_chatgpt`**

In `backend/app/services/llm_service.py`, replace the existing `_query_chatgpt` function (currently lines 146-179) with:

```python
async def _query_chatgpt(prompt: str, brand_name: str, model_version: str = "gpt-4.1-mini") -> dict:
    if not OPENAI_API_KEY:
        return _api_key_placeholder("chatgpt")
    is_search = "search" in model_version
    start = time.monotonic()
    try:
        from openai import AsyncOpenAI

        client = AsyncOpenAI(api_key=OPENAI_API_KEY)
        # Search-preview models reject `temperature` and require `web_search_options`.
        # Search responses are longer because of citation footers, so bump the cap.
        kwargs: dict = {
            "model": model_version,
            "messages": [{"role": "user", "content": prompt}],
            "max_completion_tokens": 2048 if is_search else 1024,
        }
        if is_search:
            kwargs["web_search_options"] = {}
        response = await client.chat.completions.create(**kwargs)
        latency_ms = int((time.monotonic() - start) * 1000)
        text = response.choices[0].message.content
        if not text:
            logger.warning(
                "[chatgpt] API returned empty/null content for prompt %r", prompt[:100]
            )
            return _build_result(
                None, brand_name, latency_ms,
                error="Empty response from ChatGPT API",
            )
        # For search responses, strip URL/citation noise BEFORE the mention check
        # so a brand hidden inside a citation URL doesn't trigger a false positive.
        # We pass the cleaned text into _build_result for the substring check, but
        # store the ORIGINAL text in response_text so the user-facing transcript
        # still shows citations.
        if is_search:
            cleaned = _strip_url_citations(text)
            mentioned = _mentioned(brand_name, cleaned)
            return {
                "response_text": text,
                "mentioned": mentioned,
                "latency_ms": latency_ms,
                "error": None,
            }
        return _build_result(text, brand_name, latency_ms)
    except Exception as exc:
        latency_ms = int((time.monotonic() - start) * 1000)
        logger.error("[chatgpt] API error for prompt %r: %s", prompt[:100], exc)
        body = getattr(exc, "response", None)
        if body is not None:
            try:
                logger.error("[chatgpt] API error body: %s", body.text)
            except Exception:
                pass
        return _build_result(None, brand_name, latency_ms, error=str(exc))
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
pytest tests/test_cost_accuracy_overhaul.py -k "query_chatgpt" -v
```
Expected: 4 PASS.

- [ ] **Step 5: Verify the citation stripping ALSO applies to `tracking_service._detect_mention` callsite**

`tracking_service._detect_mention` re-runs its own substring + fuzzy match on `response_text`. For search responses it would re-introduce the false positive on the unstripped text. Add citation stripping there too:

In `backend/app/services/tracking_service.py`, modify `_detect_mention` (line 43) to strip citations from the response before the match. Test this by adding to `backend/tests/test_cost_accuracy_overhaul.py`:

```python
from app.services.tracking_service import _detect_mention as _ts_detect_mention


def test_tracking_service_detect_mention_strips_citations():
    response = "Try Notion. Sources: https://stripe.com/blog"
    assert _ts_detect_mention("Stripe", response, error=None, model="chatgpt") is False
```

Run: `pytest tests/test_cost_accuracy_overhaul.py::test_tracking_service_detect_mention_strips_citations -v`
Expected: FAIL.

Now apply the fix in `backend/app/services/tracking_service.py` — replace the body of `_detect_mention`:

```python
def _detect_mention(
    brand_name: str,
    response_text: str | None,
    error: str | None,
    model: str,
) -> bool:
    if not response_text or error == "api_key_not_configured":
        return False

    # Strip URL citations + bracketed refs before matching so brand names
    # appearing only inside footnote URLs don't trigger false positives.
    # Source-of-truth helper lives in llm_service to avoid duplication.
    from app.services.llm_service import _strip_url_citations
    cleaned = _strip_url_citations(response_text)

    brand_norm = _normalize(brand_name)
    response_norm = _normalize(cleaned)

    exact = brand_name.lower() in cleaned.lower()
    fuzzy = brand_norm in response_norm
    mentioned = exact or fuzzy

    logger.info(
        "[mention_detection] model=%s brand=%r brand_norm=%r "
        "exact=%s fuzzy=%s mentioned=%s | response_preview=%r",
        model, brand_name, brand_norm, exact, fuzzy, mentioned,
        cleaned[:200],
    )
    return mentioned
```

Re-run:

```bash
pytest tests/test_cost_accuracy_overhaul.py -k "detect_mention or query_chatgpt or strip_url" -v
```
Expected: ALL PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/app/services/llm_service.py backend/app/services/tracking_service.py backend/tests/test_cost_accuracy_overhaul.py
git commit -m "feat(chatgpt): use OpenAI web search + strip citations on mention check"
```

---

### Task 3.4: Skip ChatGPT for pitch brands (free trial)

Pitch brands have `brand.brand_type == "pitch"`. The existing run orchestrators iterate over `SUPPORTED_MODELS`. We add a small helper in `llm_service` and use it in all three orchestrators.

**Files:**
- Modify: `backend/app/services/llm_service.py` (add `models_for_brand_type()` helper near `SUPPORTED_MODELS`)
- Modify: `backend/app/services/tracking_service.py` (3 places: load `brand.brand_type`, use helper to build the task matrix, use helper when computing `model_stats`)
- Modify: `backend/app/routers/tracking.py` (similar in `_do_run` and `_do_prompt_run`)

- [ ] **Step 1: Write the failing test**

Add to `backend/tests/test_cost_accuracy_overhaul.py`:

```python
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
```

- [ ] **Step 2: Run to verify failures**

```bash
pytest tests/test_cost_accuracy_overhaul.py -k "models_for_brand_type or supported_models" -v
```
Expected: 4 FAILs (helper does not exist) + 1 PASS (the supported_models check still holds).

- [ ] **Step 3: Add the helper**

In `backend/app/services/llm_service.py`, immediately after the `SUPPORTED_MODELS` line:

```python
SUPPORTED_MODELS = list(_DISPATCHERS.keys())

# Brand-type → enabled model list.
# Pitch (free trial) brands get 3 models — ChatGPT search is gated as a
# paid-tier upgrade incentive (see spec decision #4).
_PITCH_EXCLUDED_MODELS: frozenset = frozenset({"chatgpt"})


def models_for_brand_type(brand_type: str) -> list[str]:
    """Return the model list this brand_type is allowed to query."""
    if brand_type == "pitch":
        return [m for m in SUPPORTED_MODELS if m not in _PITCH_EXCLUDED_MODELS]
    return list(SUPPORTED_MODELS)
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
pytest tests/test_cost_accuracy_overhaul.py -k "models_for_brand_type or supported_models" -v
```
Expected: ALL PASS.

- [ ] **Step 5: Wire the helper into `tracking_service.run_tracking`**

In `backend/app/services/tracking_service.py`:

(a) At top of file, change the import line:

```python
from app.services.llm_service import SUPPORTED_MODELS, TIER_RUNS, models_for_brand_type, query_model
```

(b) Inside the brand-loading block (around line 187-188), capture `brand_type`:

```python
        brand_name = str(brand.name)
        brand_tier = str(brand.tier)
        brand_type = str(brand.brand_type or "standard")
```

(c) Compute the active model list ONCE after the brand load:

```python
        active_models = models_for_brand_type(brand_type)
```

(d) Replace the task-matrix list comprehension (currently around line 263-268):

```python
    tasks = [
        _bounded_query(pid, ptext, model, run_number)
        for pid, ptext in prompt_data
        for model in active_models
        for run_number in range(1, runs_per_prompt + 1)
    ]
```

(e) Replace the per-model stats initializer (currently around line 299-302):

```python
            model_stats: dict[str, dict] = {
                m: {"total_queries": 0, "total_mentions": 0}
                for m in active_models
            }
```

(`brand_type` is a Python local — passed into `_bounded_query` is not needed since `active_models` already determines what fires.)

- [ ] **Step 6: Wire the helper into `routers/tracking.py` manual-run path**

In `backend/app/routers/tracking.py`:

(a) Top-of-file: add `models_for_brand_type` to the existing `from app.services.llm_service import ...` line.

(b) In `_do_run` (manual run, around line 357-368), capture brand_type next to brand_tier:

```python
        brand_name = str(brand.name)
        brand_tier = str(brand.tier)
        brand_type = str(brand.brand_type or "standard")
```

Then add right after the prompt loading:

```python
    active_models = models_for_brand_type(brand_type)
```

(c) Replace the task list comprehension at lines 403-408:

```python
    tasks = [
        _bounded_query(pid, ptext, model, rn)
        for pid, ptext in prompt_data
        for model in active_models
        for rn in range(1, runs_per_prompt + 1)
    ]
```

(d) Replace the model_stats initializer at line 428-430:

```python
            model_stats = {
                m: {"total_queries": 0, "total_mentions": 0} for m in active_models
            }
```

- [ ] **Step 7: Wire the helper into `routers/tracking.py` per-prompt-run path**

In the same file, find `_do_prompt_run` (the function that owns line 728+):

(a) When loading the brand for the per-prompt run, capture `brand_type`. The function pulls `brand_tier` from the brand load — add `brand_type` next to it (search for `brand_tier` near line 716).

(b) Replace the task list at lines 745-749 with the active-models version (same shape as above).

(c) Replace the model_stats initializer at line 775 with the active-models version.

- [ ] **Step 8: End-to-end pitch-skip test**

Add to `backend/tests/test_cost_accuracy_overhaul.py`:

```python
@pytest.mark.asyncio
async def test_run_tracking_skips_chatgpt_for_pitch_brand(monkeypatch):
    """End-to-end: pitch brand should query 3 models, not 4."""
    from app.database import AsyncSessionLocal
    from app.models import Brand, Prompt, QueryResult, User

    # Create a pitch brand with one prompt
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

    # Stub query_model so it returns a successful response per call (no real API)
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
```

- [ ] **Step 9: Run all Phase-3 tests**

```bash
pytest tests/test_cost_accuracy_overhaul.py -v
```
Expected: ALL PASS.

- [ ] **Step 10: Commit**

```bash
git add backend/app/services/llm_service.py backend/app/services/tracking_service.py backend/app/routers/tracking.py backend/tests/test_cost_accuracy_overhaul.py
git commit -m "feat(pitch): skip ChatGPT for pitch brands; use models_for_brand_type"
```

---

## Phase 4 — Avg-of-per-model overall score

Currently the overall score is `sum(mentions) / sum(queries) × 100`. With pitch brands at 3 models and paid at 4, this denominator-imbalance distorts comparisons. The new formula: **average of the per-model scores**, skipping models with zero queries.

### Task 4.1: Add `_compute_overall_score` helper in tracking_service

We put it in `tracking_service` rather than `llm_service` because it operates on `model_stats` which is a tracking concept.

**Files:**
- Modify: `backend/app/services/tracking_service.py` (add helper above `run_tracking`)

- [ ] **Step 1: Write the failing tests**

Add to `backend/tests/test_cost_accuracy_overhaul.py`:

```python
# ── Phase 4: avg-of-per-model overall score ───────────────────────────────────

from app.services import tracking_service as ts


def test_compute_overall_score_avg_of_per_model():
    stats = {
        "chatgpt":    {"total_queries": 9, "total_mentions": 3},   # 33.33%
        "claude":     {"total_queries": 9, "total_mentions": 0},   #  0%
        "perplexity": {"total_queries": 9, "total_mentions": 6},   # 66.67%
        "gemini":     {"total_queries": 9, "total_mentions": 9},   # 100%
    }
    # Avg = (33.33 + 0 + 66.67 + 100) / 4 = 50.0
    assert ts._compute_overall_score(stats) == pytest.approx(50.0, abs=0.05)


def test_compute_overall_score_skips_zero_query_models():
    stats = {
        "chatgpt":    {"total_queries": 0, "total_mentions": 0},   # SKIP
        "claude":     {"total_queries": 6, "total_mentions": 3},   # 50%
        "perplexity": {"total_queries": 6, "total_mentions": 3},   # 50%
        "gemini":     {"total_queries": 6, "total_mentions": 3},   # 50%
    }
    # Avg of 50, 50, 50 (chatgpt skipped because it had 0 queries — pitch brand)
    assert ts._compute_overall_score(stats) == pytest.approx(50.0)


def test_compute_overall_score_returns_zero_for_all_zero():
    stats = {
        "chatgpt":    {"total_queries": 0, "total_mentions": 0},
        "claude":     {"total_queries": 0, "total_mentions": 0},
    }
    assert ts._compute_overall_score(stats) == 0.0


def test_compute_overall_score_does_not_double_count_old_formula():
    """Regression: old formula on this data = 33.33%; new formula = 25.0%."""
    stats = {
        "chatgpt":    {"total_queries": 9, "total_mentions": 0},   # 0% — was diluting
        "claude":     {"total_queries": 9, "total_mentions": 0},   # 0%
        "perplexity": {"total_queries": 9, "total_mentions": 9},   # 100%
        "gemini":     {"total_queries": 9, "total_mentions": 0},   # 0%
    }
    # Old formula:  9 / 36 = 25.0   (wait — let's pick numbers where they differ)
    # Avg formula:  (0 + 0 + 100 + 0) / 4 = 25.0
    # They tie here; use a stronger asymmetric case:
    stats2 = {
        "chatgpt":    {"total_queries": 30, "total_mentions": 0},
        "claude":     {"total_queries": 3,  "total_mentions": 3},
        "perplexity": {"total_queries": 3,  "total_mentions": 3},
        "gemini":     {"total_queries": 3,  "total_mentions": 3},
    }
    # Old formula: 9 / 39 = 23.08%
    # Avg formula: (0 + 100 + 100 + 100) / 4 = 75.0%
    assert ts._compute_overall_score(stats2) == pytest.approx(75.0)
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
pytest tests/test_cost_accuracy_overhaul.py -k "compute_overall_score" -v
```
Expected: FAIL (helper doesn't exist).

- [ ] **Step 3: Implement the helper**

In `backend/app/services/tracking_service.py`, add immediately above `async def run_tracking`:

```python
def _compute_overall_score(model_stats: dict[str, dict]) -> float:
    """
    Avg-of-per-model overall score.

    Each model's score = mentions / queries × 100.  Models with 0 queries
    (e.g. ChatGPT for a pitch brand) are SKIPPED so they don't drag the
    average toward zero.  Returns 0.0 when no model has any queries.

    Spec: 2026-04-20-cost-accuracy-decisions.md, decision #5.
    """
    per_model_scores: list[float] = []
    for stats in model_stats.values():
        tq = stats.get("total_queries", 0)
        if tq <= 0:
            continue
        tm = stats.get("total_mentions", 0)
        per_model_scores.append(tm / tq * 100.0)
    if not per_model_scores:
        return 0.0
    return sum(per_model_scores) / len(per_model_scores)
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
pytest tests/test_cost_accuracy_overhaul.py -k "compute_overall_score" -v
```
Expected: ALL PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/tracking_service.py backend/tests/test_cost_accuracy_overhaul.py
git commit -m "feat(scoring): add _compute_overall_score helper (avg of per-model)"
```

---

### Task 4.2: Apply the helper to `tracking_service.run_tracking`

**Files:**
- Modify: `backend/app/services/tracking_service.py:329-333`

- [ ] **Step 1: Apply the change**

Replace the existing block at lines 329-333:

```python
            overall_score = (
                (overall_mentions / overall_queries * 100.0)
                if overall_queries > 0
                else 0.0
            )
```

with:

```python
            overall_score = _compute_overall_score(model_stats)
```

- [ ] **Step 2: Run all overhaul tests + the existing tracking-service unit tests**

```bash
pytest tests/test_cost_accuracy_overhaul.py tests/test_tracking_service_unit.py tests/test_tracking.py -v
```
Expected: ALL PASS. If any existing test asserts the old formula, update its expected value (and add a comment explaining why).

- [ ] **Step 3: Commit**

```bash
git add backend/app/services/tracking_service.py
git commit -m "feat(scoring): use avg-of-per-model overall score in run_tracking"
```

---

### Task 4.3: Apply the helper to `tracking._do_run` (manual runs)

**Files:**
- Modify: `backend/app/routers/tracking.py:454-458`

- [ ] **Step 1: Add an import**

At the top of `routers/tracking.py`, find the existing `from app.services.tracking_service import ...` line (or add one). Add:

```python
from app.services.tracking_service import _compute_overall_score
```

- [ ] **Step 2: Apply the change**

Replace lines 454-458:

```python
            overall_score = _compute_overall_score(model_stats)
```

- [ ] **Step 3: Run tests**

```bash
pytest tests/test_cost_accuracy_overhaul.py tests/test_tracking.py -v
```
Expected: ALL PASS.

- [ ] **Step 4: Commit**

```bash
git add backend/app/routers/tracking.py
git commit -m "feat(scoring): use avg-of-per-model in manual run handler"
```

---

### Task 4.4: Apply the helper to `tracking._do_prompt_run`

**Files:**
- Modify: `backend/app/routers/tracking.py:799`

- [ ] **Step 1: Apply the change**

Replace line 799:

```python
            overall_score = _compute_overall_score(model_stats)
```

(`_compute_overall_score` is already imported from Task 4.3.)

- [ ] **Step 2: Run tests**

```bash
pytest tests/test_cost_accuracy_overhaul.py tests/test_tracking.py -v
```
Expected: ALL PASS.

- [ ] **Step 3: Commit**

```bash
git add backend/app/routers/tracking.py
git commit -m "feat(scoring): use avg-of-per-model in prompt run handler"
```

---

## Phase 5 — Lower Pro prompt cap: 100 → 30

We **grandfather** existing brands. The cap only applies to NEW prompt creation, not to existing prompts. The data fix in `database.py` will set `prompt_limit = 30` only on Pro brands that currently have it at the default `100` AND have ≤30 prompts (so we never silently strip existing data).

### Task 5.1: Update `TIER_LIMITS` and `PROMPT_LIMITS` in billing.py

**Files:**
- Modify: `backend/app/routers/billing.py:49`
- Modify: `backend/app/routers/billing.py:97-101`

- [ ] **Step 1: Write the failing test**

Add to `backend/tests/test_cost_accuracy_overhaul.py`:

```python
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
```

- [ ] **Step 2: Run to verify failures**

```bash
pytest tests/test_cost_accuracy_overhaul.py -k "pro_tier_limit or pro_prompt_limit or other_tier_limits" -v
```
Expected: FAIL on the two `pro_*` tests, PASS on `other_tier_limits_unchanged`.

- [ ] **Step 3: Apply the change**

In `backend/app/routers/billing.py`:

(a) Replace line 49:

```python
TIER_LIMITS = {"basic": 15, "starter": 25, "pro": 30}
```

(b) Replace lines 97-101:

```python
PROMPT_LIMITS: dict[str, int] = {
    "pitch": 10,
    "standard": 25,
    "pro": 30,
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
pytest tests/test_cost_accuracy_overhaul.py -k "pro_tier_limit or pro_prompt_limit" -v
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/app/routers/billing.py backend/tests/test_cost_accuracy_overhaul.py
git commit -m "feat(billing): lower Pro prompt cap 100 -> 30"
```

---

### Task 5.2: Migration — grandfather existing Pro brands; lower default for fresh-state ones

`database.py:347-362` already has an idempotent block that "syncs brand types/limits with user tiers." It currently uses `100` for Pro brands. We need to:
1. Lower the default for Pro brands that currently have it at 100 AND ≤30 prompts (the "fresh-state" / over-allocated case).
2. NOT touch Pro brands with `prompt_limit > 30` AND prompt_count > 30 — those existing users keep their grandfathered allowance until they manually delete prompts down. (The frontend will still show "30/100 used — limit lowered to 30 going forward" for them — that part is in Phase 6.)

**Files:**
- Modify: `backend/app/database.py:352-356`

- [ ] **Step 1: Write the failing test**

Add to `backend/tests/test_cost_accuracy_overhaul.py`:

```python
@pytest.mark.asyncio
async def test_data_fix_lowers_pro_prompt_limit_for_brands_under_thirty(monkeypatch):
    """Pro brands with prompt_limit=100 and ≤30 prompts get lowered to 30."""
    from app.database import AsyncSessionLocal, run_migrations
    from app.models import Brand, Prompt, User
    from sqlalchemy import select

    async with AsyncSessionLocal() as db:
        u = User(email="pro_migration@test.com", subscription_tier="pro",
                email_verified=1)
        db.add(u)
        await db.commit()
        await db.refresh(u)
        # Brand at default 100 with only 5 prompts: should get lowered to 30
        small = Brand(name="Small", slug="small-pm", user_id=u.id,
                      brand_type="pro", prompt_limit=100)
        # Brand at 100 with 35 prompts: grandfathered, must NOT be lowered
        big = Brand(name="Big", slug="big-pm", user_id=u.id,
                    brand_type="pro", prompt_limit=100)
        db.add_all([small, big])
        await db.commit()
        await db.refresh(small)
        await db.refresh(big)
        for i in range(5):
            db.add(Prompt(brand_id=small.id, text=f"p{i}"))
        for i in range(35):
            db.add(Prompt(brand_id=big.id, text=f"p{i}"))
        await db.commit()
        small_id, big_id = small.id, big.id

    await run_migrations()

    async with AsyncSessionLocal() as db:
        small_after = await db.get(Brand, small_id)
        big_after = await db.get(Brand, big_id)
        assert small_after.prompt_limit == 30, (
            "Under-30-prompt Pro brand must be lowered to the new cap"
        )
        assert big_after.prompt_limit == 100, (
            "Over-30-prompt Pro brand must be grandfathered"
        )
```

- [ ] **Step 2: Run to verify failure**

```bash
pytest tests/test_cost_accuracy_overhaul.py -k "data_fix_lowers_pro_prompt_limit" -v
```
Expected: FAIL — `small.prompt_limit` is still 100 because the existing `UPDATE` keeps it there.

- [ ] **Step 3: Replace the data-fix block**

In `backend/app/database.py`, replace the block at lines 352-356:

```python
        await conn.execute(text("""
            UPDATE brands SET brand_type = 'pro', prompt_limit = 100
            WHERE (brand_type != 'pro' OR prompt_limit != 100)
              AND user_id IN (SELECT id FROM users WHERE subscription_tier = 'pro')
        """))
```

with:

```python
        # Sync Pro user brands to brand_type='pro'.  For prompt_limit:
        #  - Brand_type mismatch: forcibly set to 30 (new cap).
        #  - Brand at old default of 100 with ≤30 prompts: lower to 30.
        #  - Brand at 100 with >30 prompts: grandfather (leave at 100).
        await conn.execute(text("UPDATE brands SET brand_type = 'pro' "
            "WHERE brand_type != 'pro' AND user_id IN "
            "(SELECT id FROM users WHERE subscription_tier = 'pro')"))
        await conn.execute(text("""
            UPDATE brands SET prompt_limit = 30
            WHERE prompt_limit = 100
              AND user_id IN (SELECT id FROM users WHERE subscription_tier = 'pro')
              AND id NOT IN (
                SELECT brand_id FROM prompts
                GROUP BY brand_id HAVING COUNT(*) > 30
              )
        """))
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
pytest tests/test_cost_accuracy_overhaul.py -k "data_fix_lowers_pro_prompt_limit" -v
```
Expected: PASS.

- [ ] **Step 5: Run full overhaul test suite**

```bash
pytest tests/test_cost_accuracy_overhaul.py -v
```
Expected: ALL PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/app/database.py backend/tests/test_cost_accuracy_overhaul.py
git commit -m "feat(billing): grandfather existing Pro brands when lowering prompt cap"
```

---

## Phase 6 — Frontend updates

### Task 6.1: Landing page comparison table

**Files:**
- Modify: `frontend/app/page.tsx:209,211`

- [ ] **Step 1: Apply the changes**

In `frontend/app/page.tsx`, modify two rows of `COMPARISON_FEATURES`:

(a) Line 209 — change Pro `'100'` to `'30'`:

```tsx
  { label: 'Prompts per brand', free: '10', basic: '15', starter: '25', pro: '30' },
```

(b) Line 211 — pitch (free trial) now has 3 models, paid still 4 (with enhanced search on Pro):

```tsx
  { label: 'AI models monitored', free: '3', basic: '4', starter: '4', pro: '4 (enhanced search)' },
```

- [ ] **Step 2: Manual smoke test**

Start dev server:

```bash
cd /Users/ken/Desktop/Lumidian/frontend && npm run dev -- --port 3002
```

(Backend on 3001 is assumed already running. If not, start it: `cd /Users/ken/Desktop/Lumidian/backend && source venv/bin/activate && uvicorn app.main:app --reload --port 3001`)

Visit http://localhost:3002/ — scroll to the comparison table. Verify:
- "Prompts per brand" row shows 10 / 15 / 25 / 30
- "AI models monitored" row shows 3 / 4 / 4 / 4 (enhanced search)

- [ ] **Step 3: Commit**

```bash
git add frontend/app/page.tsx
git commit -m "feat(marketing): update landing comparison table for new caps"
```

---

### Task 6.2: Billing page tier features and current-plan summary

**Files:**
- Modify: `frontend/app/settings/billing/page.tsx:36, 310`

- [ ] **Step 1: Apply the changes**

(a) Line 36 — Pro feature list:

```tsx
    '30 tracked prompts per brand',
```

(b) Line 310 — current-plan one-liner. Replace:

```tsx
                  {currentTier === 'basic' ? '15 prompts per brand' : currentTier === 'starter' ? '25 prompts per brand' : currentTier === 'pro' ? '100 prompts per brand' : '10 prompts on free plan — upgrade for more'}
```

with:

```tsx
                  {currentTier === 'basic' ? '15 prompts per brand' : currentTier === 'starter' ? '25 prompts per brand' : currentTier === 'pro' ? '30 prompts per brand' : '10 prompts on free plan — upgrade for more'}
```

- [ ] **Step 2: Manual smoke test**

With the dev server running, log in as any Pro user and visit http://localhost:3002/settings/billing. Verify:
- Pro plan card lists "30 tracked prompts per brand"
- Current plan summary (if currently Pro) shows "30 prompts per brand"
- Free / Starter / Growth cards are unchanged

- [ ] **Step 3: Commit**

```bash
git add frontend/app/settings/billing/page.tsx
git commit -m "feat(billing-page): show new Pro 30-prompt cap"
```

---

### Task 6.3: Methodology page — fix runs-per-tier copy

The page currently says paid plans "run each prompt more times per model" — no longer true (all tiers run 3).

**Files:**
- Modify: `frontend/app/methodology/page.tsx:281-290` (the "Tier note" block)

- [ ] **Step 1: Apply the change**

Replace the entire "Tier note" block at lines 281-290:

```tsx
        {/* Tier note */}
        <div
          className="mt-6 rounded-lg px-4 py-3.5 border text-[13px] text-[var(--text-muted)] leading-relaxed"
          style={{
            background: 'var(--bg-raised)',
            borderColor: 'var(--border-subtle)',
          }}
        >
          <span className="text-[var(--text-secondary)] font-medium">3 runs per prompt per model.</span>{' '}
          Each prompt is sent to every supported model 3 times to smooth out
          response variation. Paid tiers add ChatGPT&apos;s native web search
          and Perplexity Sonar Pro for sharper, more current detection.
        </div>
```

- [ ] **Step 2: Manual smoke test**

Visit http://localhost:3002/methodology and find the "How we calculate scores" section. Verify the tier-note paragraph reads with the new copy.

- [ ] **Step 3: Commit**

```bash
git add frontend/app/methodology/page.tsx
git commit -m "feat(methodology): drop runs-per-tier copy; describe paid extras"
```

---

### Task 6.4: Methodology page — clarify the score formula

The formula caption (lines 247-252) shows "Score = (mentions / total queries) × 100" — this is now ONLY accurate for per-model scores. The OVERALL score is now an average of those.

**Files:**
- Modify: `frontend/app/methodology/page.tsx:230-253`

- [ ] **Step 1: Read the surrounding block to find the precise insertion point**

```bash
# (read in your editor, lines 226-260)
```

- [ ] **Step 2: Apply the change**

Find the existing formula display (the `<div>` ending around line 252 with `<span style={{ color: 'var(--accent-light)' }}>100</span>`). Immediately AFTER its closing `</div>`, add a small clarifier block:

```tsx
              <p className="mt-3 text-[12px] text-[var(--text-muted)] leading-relaxed">
                <span className="font-medium text-[var(--text-secondary)]">Per-model score</span>{' '}
                is calculated this way for each AI model individually. Your{' '}
                <span className="font-medium text-[var(--text-secondary)]">overall visibility score</span>{' '}
                is the average of every active model&apos;s score, so a model
                with no queries (e.g. ChatGPT on the free trial) doesn&apos;t
                drag the average down.
              </p>
```

- [ ] **Step 3: Manual smoke test**

Reload http://localhost:3002/methodology and verify the formula now has a sub-paragraph explaining per-model vs overall.

- [ ] **Step 4: Commit**

```bash
git add frontend/app/methodology/page.tsx
git commit -m "feat(methodology): clarify per-model vs overall score formula"
```

---

### Task 6.5: Locked ChatGPT card on the dashboard for pitch users

When a pitch (free trial) user looks at their dashboard, the model breakdown only contains 3 cards because we don't query ChatGPT for them. We add a locked, greyed-out 4th card so the user is reminded that ChatGPT is the upsell.

The dashboard reads `overview?.model_breakdown` which is shaped as `ModelStat[]`. Pitch users will get an array of length 3. We render a synthetic locked card whenever:
- the user's brand is pitch type, AND
- the model_breakdown array does not contain a `chatgpt` entry.

**Files:**
- Modify: `frontend/app/dashboard/page.tsx` (find the JSX block that renders the model breakdown — look for the `latestModelStats.map(...)` rendering)
- Add (small): a `LockedChatGPTCard` inline component inside the same file (no new file needed for one component used in one place)

- [ ] **Step 1: Locate the rendering block**

Run:

```bash
grep -n "latestModelStats" frontend/app/dashboard/page.tsx | head -10
```

Note the line numbers where `latestModelStats` is mapped to JSX elements.

- [ ] **Step 2: Add the helper above the component**

Near the existing helper utilities at the top of the file (above the `DashboardPage` component definition), add:

```tsx
// ── Locked ChatGPT teaser for pitch (free trial) users ───────────────────────
function LockedChatGPTCard() {
  return (
    <div
      className="rounded-xl p-5 border opacity-60 relative overflow-hidden"
      style={{
        background: 'var(--bg-raised)',
        borderColor: 'var(--border-subtle)',
      }}
    >
      <div className="absolute inset-0 backdrop-blur-[1px] pointer-events-none" />
      <div className="flex items-center gap-2.5 mb-2 relative">
        <div
          className="w-8 h-8 rounded-md flex items-center justify-center text-xs font-bold"
          style={{ background: 'var(--color-chatgpt-muted)', color: 'var(--color-chatgpt)' }}
        >
          G
        </div>
        <div className="flex-1">
          <div className="text-sm font-semibold text-[var(--text-secondary)]">ChatGPT</div>
          <div className="text-[11px] text-[var(--text-muted)]">Native web search · Paid plans</div>
        </div>
      </div>
      <div className="relative">
        <div className="text-[28px] font-bold text-[var(--text-muted)] tabular-nums">—</div>
        <a
          href="/settings/billing"
          className="mt-2 inline-block text-[12px] font-medium text-[var(--accent-light)] hover:underline"
        >
          Unlock ChatGPT search →
        </a>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Render it conditionally next to the model cards**

In the JSX where `latestModelStats.map(...)` produces the cards, append the locked card after the map IF the brand is pitch and ChatGPT is missing.

The `brandDetail` (or equivalent) on the dashboard exposes `brand_type`. Find the variable that holds it (likely `brandDetail?.brand?.brand_type` or `selectedBrand?.brand_type`). Then:

```tsx
{latestModelStats.map((stat) => (
  // ... existing card render
))}
{(brandDetail?.brand?.brand_type === 'pitch' || selectedBrand?.brand_type === 'pitch') &&
 !latestModelStats.some(s => s.model === 'chatgpt') && (
  <LockedChatGPTCard />
)}
```

(Use whichever brand-type accessor already exists in scope — verify by grepping `brand_type` in the file.)

- [ ] **Step 4: Manual smoke test**

(a) As a Pro user, dashboard should show 4 unlocked model cards including ChatGPT (NO locked card).
(b) As a free / pitch user (sign up fresh, use a non-paid account), dashboard should show 3 unlocked cards + 1 locked ChatGPT teaser. Click "Unlock ChatGPT search →" — should navigate to `/settings/billing`.

- [ ] **Step 5: Commit**

```bash
git add frontend/app/dashboard/page.tsx
git commit -m "feat(dashboard): show locked ChatGPT teaser for pitch users"
```

---

### Task 6.6: Frontend dashboard `liveScore` / `indexScore` switch to avg-of-per-model

These are derived on the client from `model_breakdown` using `sum(mentions) / sum(queries)`. To stay consistent with the new server-side overall-score formula, switch them to "average of per-model rates."

**Files:**
- Modify: `frontend/app/dashboard/page.tsx:440-453`

- [ ] **Step 1: Apply the change**

Replace the `liveScore` and `indexScore` IIFEs (lines 440-453) with:

```tsx
  const liveScore = (() => {
    const mods = latestModelBreakdown.filter(m => m.model === 'perplexity' || m.model === 'gemini');
    const active = mods.filter(m => m.total_queries > 0);
    if (!active.length) return null;
    const avg = active.reduce((s, m) => s + (m.total_mentions / m.total_queries), 0) / active.length;
    return Math.round(avg * 1000) / 10;
  })();
  const indexScore = (() => {
    const mods = latestModelBreakdown.filter(m => m.model === 'chatgpt' || m.model === 'claude');
    const active = mods.filter(m => m.total_queries > 0);
    if (!active.length) return null;
    const avg = active.reduce((s, m) => s + (m.total_mentions / m.total_queries), 0) / active.length;
    return Math.round(avg * 1000) / 10;
  })();
```

- [ ] **Step 2: Manual smoke test**

Pitch user dashboard: `indexScore` should reflect Claude alone (since chatgpt has 0 queries). Paid user: both ChatGPT and Claude contribute.

- [ ] **Step 3: Commit**

```bash
git add frontend/app/dashboard/page.tsx
git commit -m "feat(dashboard): switch live/index scores to avg-of-per-model"
```

---

## Phase 7 — Verification

### Task 7.1: Run the full backend test suite

- [ ] **Step 1: Run pytest**

```bash
cd /Users/ken/Desktop/Lumidian/backend && source venv/bin/activate && pytest -v 2>&1 | tail -100
```

Expected: ALL PASS. If any pre-existing test fails because it asserted the old overall-score formula, the old `gpt-4.1-mini` Pro variant, the 5-runs-per-prompt count, the 100-prompt Pro cap, or the gemini-pro fallback — update it to match the new behavior and add a one-line comment referencing this plan.

If a test fails for an unrelated reason, do NOT change it; investigate the actual breakage.

- [ ] **Step 2: Commit any test fixes**

```bash
git add backend/tests/
git commit -m "test: update existing tests for cost-accuracy overhaul"
```

(Skip if no fixes needed.)

---

### Task 7.2: Frontend lint + build sanity

- [ ] **Step 1: Lint**

```bash
cd /Users/ken/Desktop/Lumidian/frontend && npm run lint
```

Expected: no new errors.

- [ ] **Step 2: Production build**

```bash
npm run build
```

Expected: build succeeds.

- [ ] **Step 3: Commit lint fixes (if any)**

```bash
git add frontend/
git commit -m "fix(lint): address lint issues introduced by overhaul"
```

(Skip if no fixes needed.)

---

### Task 7.3: End-to-end manual smoke test

- [ ] **Step 1: Start both servers**

In two terminals:

```bash
cd /Users/ken/Desktop/Lumidian/backend && source venv/bin/activate && uvicorn app.main:app --reload --port 3001
```

```bash
cd /Users/ken/Desktop/Lumidian/frontend && npm run dev -- --port 3002
```

- [ ] **Step 2: Free user flow**

Sign up a fresh account → go through onboarding to create a pitch brand → trigger a tracking run from the dashboard. Watch the backend logs to confirm:
- Only 3 models fire (no `[chatgpt]` log lines)
- 3 runs per prompt per model
- No `gemini-2.5-pro` references

After the run completes, verify dashboard shows:
- 3 unlocked model cards + 1 locked ChatGPT teaser
- Overall visibility score is plausible (not skewed by the missing ChatGPT)

- [ ] **Step 3: Paid user flow**

Either upgrade the test account via Stripe test mode (use the customer portal) OR seed a Pro user via Railway CLI on production. Trigger a manual run. Confirm in backend logs:
- 4 models fire including `[chatgpt]` calls using `gpt-4o-mini-search-preview`
- Perplexity uses `sonar-pro`
- Gemini uses `gemini-2.5-flash` (NOT `pro`)
- 3 runs per prompt per model

- [ ] **Step 4: Pro prompt cap**

As the paid Pro user, navigate to the brand's prompt management. Verify:
- Limit displayed is "30/30" or similar — not "100"
- Adding a 31st prompt is blocked

- [ ] **Step 5: Report results to user**

Post a short summary in chat: which flows worked, what the new scores look like vs the previous run (if one was preserved), any anomalies you saw in the logs.

---

### Task 7.4: Push the branch

- [ ] **Step 1: Push**

```bash
cd /Users/ken/Desktop/Lumidian && git push -u origin cost-accuracy-overhaul
```

- [ ] **Step 2: Hand back to user for review**

Tell the user the branch is pushed and ready for review. Per `feedback_branch_review.md`: do NOT merge to `main` without explicit user approval.

---

## Plan Summary

| Phase | What | Files | Tests |
|-------|------|-------|-------|
| 1 | runs/prompt 5→3 + drop-alert threshold 10→15 | llm_service.py, database.py, tracking_service.py, scheduler.py | 4 |
| 2 | kill gemini-pro | llm_service.py | 4 |
| 3 | ChatGPT search + pitch skip + citation strip | llm_service.py, tracking_service.py, tracking.py | 13 |
| 4 | avg-of-per-model overall score | tracking_service.py, tracking.py | 4 |
| 5 | Pro cap 100→30 + grandfather | billing.py, database.py | 4 |
| 6 | frontend updates | page.tsx, settings/billing, methodology, dashboard | manual |
| 7 | verification | n/a | full suite + smoke |

**Items intentionally deferred from spec section D ("Sweep latency budget"):** tightening `_GEMINI_TIMEOUT` from 90s→60s and raising `MAX_CONCURRENT` from 10. Spec marked these as "could" / "may" rather than commitments — defer until we have post-rollout latency data to base the decision on.

Each phase commits independently and leaves the app in a working state. If you stop midway, the app still runs.
