# Pro-Only Claude Live Search + Remove LIVE/INDEX Framing

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Gate Claude as a visibility-tracker to the Pro tier only (with live `web_search_20250305`), remove Claude from all cheaper tiers, and eliminate every trace of the now-obsolete LIVE vs INDEX framing.

**Architecture:**
- Replace `models_for_brand_type(brand_type)` with `models_for_tier(brand_type, tier)` so the model list depends on both the brand type and the user's subscription tier.
- `_query_claude` always calls with the `web_search_20250305` tool; the function is only reached when the tier filter allows it (Pro), so no per-call gating is required inside the function.
- Strip URL citations from Claude search responses before mention detection, matching the existing ChatGPT search path via `_strip_url_citations`.
- Delete dead constants (`LIVE_MODELS`, `INDEX_MODELS`, `_PITCH_EXCLUDED_MODELS`) and the `_query_claude` callers that used them.
- Rename the misleading `is_pro` tracking variable to `is_paid` (that's what it actually represents — Perplexity/ChatGPT upgrade gate).
- Frontend: rewrite the methodology page, landing page chart, and methodology callout to drop the Live/Index dichotomy. Use the `impeccable` and `emil-design-eng` skills for design.

**Tech Stack:** Python 3.11 + FastAPI + SQLAlchemy (async), Anthropic Python SDK ≥0.39, Next.js 15 + React 18 + TypeScript (strict), Tailwind CSS.

**Final tier → model mapping:**

| Tier key (DB)   | UI name  | Models queried                                                         |
|-----------------|----------|------------------------------------------------------------------------|
| `None` (+ pitch)| Free     | Perplexity (sonar), Gemini Flash                                       |
| `basic`         | Starter  | ChatGPT search, Perplexity sonar, Gemini Flash                         |
| `starter`       | Growth   | ChatGPT search, Perplexity sonar-pro, Gemini Flash                     |
| `pro`           | Pro      | ChatGPT search, **Claude Haiku + web_search_20250305**, sonar-pro, Gemini Flash |

---

## Files Touched

### Backend
- Modify: `backend/app/services/llm_service.py` — gut LIVE/INDEX, add tier filter, rewrite `_query_claude` with tool use.
- Modify: `backend/app/services/tracking_service.py` — pass tier to filter, rename `is_pro` → `is_paid`.
- Modify: `backend/app/routers/tracking.py` — update two prompt-run code paths (around line 371 and 718).
- Modify: `backend/app/database.py` — update the stale-run threshold model count calc (line 437-438).
- Modify: `backend/tests/test_cost_accuracy_overhaul.py` — update tests for new filter signature; add tier-gating tests.
- Modify: `backend/tests/test_tracking_service_unit.py` — add Claude-search invocation test.

### Frontend
- Modify: `frontend/app/methodology/page.tsx` — full rewrite of the Live Search / AI Index sections.
- Modify: `frontend/components/dashboard/MethodologyCallout.tsx` — drop Live/Index split, unify.
- Modify: `frontend/app/page.tsx` — replace the "Live vs Index" decorative card on the landing page.

### Docs
- Modify: `CLAUDE.md` — update "LLM Model Categories" and "Tier-Based Query Counts" sections.

---

## Task 1: Add tier-aware model filter and delete LIVE/INDEX dead code

**Files:**
- Modify: `backend/app/services/llm_service.py:100-116,425-437`
- Test: `backend/tests/test_cost_accuracy_overhaul.py:254-278`

- [ ] **Step 1.1: Write failing tests for the new `models_for_tier` signature**

Replace the four existing `test_models_for_brand_type_*` tests in `backend/tests/test_cost_accuracy_overhaul.py` (lines 257-278) with:

```python
def test_models_for_tier_free_pitch_brand_excludes_chatgpt_and_claude():
    models = llm_service.models_for_tier("pitch", None)
    assert "chatgpt" not in models
    assert "claude" not in models
    assert "perplexity" in models
    assert "gemini" in models


def test_models_for_tier_free_standard_brand_excludes_chatgpt_and_claude():
    # Defensive: even a non-pitch brand under a free account should not hit paid models.
    models = llm_service.models_for_tier("standard", None)
    assert "chatgpt" not in models
    assert "claude" not in models


def test_models_for_tier_starter_gets_chatgpt_no_claude():
    models = llm_service.models_for_tier("standard", "basic")
    assert "chatgpt" in models
    assert "claude" not in models
    assert "perplexity" in models
    assert "gemini" in models


def test_models_for_tier_growth_gets_chatgpt_no_claude():
    models = llm_service.models_for_tier("standard", "starter")
    assert "chatgpt" in models
    assert "claude" not in models


def test_models_for_tier_pro_gets_all_four_including_claude():
    models = llm_service.models_for_tier("standard", "pro")
    assert set(models) == {"chatgpt", "claude", "perplexity", "gemini"}


def test_models_for_tier_pitch_on_pro_account_stays_free():
    # brand_type="pitch" ALWAYS means free tier semantics, regardless of user sub.
    models = llm_service.models_for_tier("pitch", "pro")
    assert "chatgpt" not in models
    assert "claude" not in models


def test_models_for_tier_unknown_tier_defaults_to_free():
    models = llm_service.models_for_tier("standard", "something-weird")
    assert "chatgpt" not in models
    assert "claude" not in models
```

Also delete the old `test_models_for_brand_type_*` assertions — the function no longer exists.

- [ ] **Step 1.2: Run tests — confirm they fail**

```bash
cd backend && source venv/bin/activate && pytest tests/test_cost_accuracy_overhaul.py -k "models_for_tier" -v
```

Expected: FAIL with `AttributeError: module 'app.services.llm_service' has no attribute 'models_for_tier'`.

- [ ] **Step 1.3: Delete the LIVE/INDEX constants and old pitch-exclusion machinery**

In `backend/app/services/llm_service.py`, delete lines 100-104 (the `LIVE_MODELS`/`INDEX_MODELS` block and its comment). Also update the `_MODEL_VERSIONS` comment (lines 106-110) to drop the LIVE/INDEX mention — it's now meaningless:

```python
# Model versions per subscription tier. Paid tiers get upgraded ChatGPT (web
# search) and Perplexity (sonar-pro). Claude and Gemini use the same version
# across tiers; Claude is only queried on Pro (see models_for_tier).
_MODEL_VERSIONS: dict[str, dict[str, str]] = {
    "chatgpt":    {"default": "gpt-4.1-mini",              "pro": "gpt-4o-mini-search-preview"},
    "claude":     {"default": "claude-haiku-4-5-20251001",  "pro": "claude-haiku-4-5-20251001"},
    "perplexity": {"default": "sonar",                      "pro": "sonar-pro"},
    "gemini":     {"default": "gemini-2.5-flash",           "pro": "gemini-2.5-flash"},
}
```

Then in the "Public dispatcher" section (around line 427-437), replace:

```python
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

with:

```python
# Tier-based model gating.
# Free / pitch: Perplexity + Gemini only (web-native, no paid API cost).
# Paid non-pro (Starter, Growth): + ChatGPT search.
# Pro: + Claude Haiku with live web_search_20250305 tool.
_FREE_MODELS: tuple[str, ...] = ("perplexity", "gemini")
_PAID_NON_PRO_MODELS: tuple[str, ...] = ("chatgpt", "perplexity", "gemini")
_PRO_MODELS: tuple[str, ...] = ("chatgpt", "claude", "perplexity", "gemini")


def models_for_tier(brand_type: str, tier: str | None) -> list[str]:
    """Return the model list this (brand_type, subscription tier) combo is allowed to query.

    - brand_type="pitch" always means free-tier semantics, regardless of the user's subscription
      (pitch brands are temporary free-trial objects; they auto-upgrade on subscribe).
    - tier is the internal subscription_tier string: None, "basic" (Starter), "starter" (Growth),
      or "pro".
    """
    if brand_type == "pitch" or tier is None:
        return list(_FREE_MODELS)
    if tier in ("basic", "starter"):
        return list(_PAID_NON_PRO_MODELS)
    if tier == "pro":
        return list(_PRO_MODELS)
    # Unknown tier — be conservative, treat as free.
    return list(_FREE_MODELS)
```

- [ ] **Step 1.4: Run the tests — confirm they pass**

```bash
cd backend && source venv/bin/activate && pytest tests/test_cost_accuracy_overhaul.py -k "models_for_tier" -v
```

Expected: all 7 tests PASS.

- [ ] **Step 1.5: Commit**

```bash
git add backend/app/services/llm_service.py backend/tests/test_cost_accuracy_overhaul.py
git commit -m "refactor(llm): replace brand-type filter with tier-aware models_for_tier; delete LIVE/INDEX dead code"
```

---

## Task 2: Wire `models_for_tier` through all callers

**Files:**
- Modify: `backend/app/services/tracking_service.py:29,208-216`
- Modify: `backend/app/routers/tracking.py:332,371,394,715,718,736`
- Modify: `backend/app/database.py:435-445`

- [ ] **Step 2.1: Update `tracking_service.py` — pass tier to filter and rename is_pro → is_paid**

In `backend/app/services/tracking_service.py`:

Line 29 (import):
```python
from app.services.llm_service import RUNS_PER_PROMPT, SUPPORTED_MODELS, models_for_tier, query_model
```

Lines 196-217 (variable declaration + model selection):
```python
    brand_name: str = ""
    is_paid: bool = False   # True for any paid tier (Starter/Growth/Pro) — gates ChatGPT search + sonar-pro
    prompt_data: list[tuple[int, str]] = []  # (prompt_id, prompt_text)
    run_id: int = 0

    async with AsyncSessionLocal() as db:
        # ── 1. Load brand ────────────────────────────────────────────────────
        brand_result = await db.execute(select(Brand).where(Brand.id == brand_id))
        brand: Brand | None = brand_result.scalar_one_or_none()
        if brand is None:
            raise ValueError(f"Brand {brand_id} not found")

        brand_name = str(brand.name)
        brand_type = str(brand.brand_type or "standard")

        # Load user subscription tier for model selection
        from app.models import User
        user_result = await db.execute(select(User).where(User.id == brand.user_id))
        user = user_result.scalar_one_or_none()
        tier = user.subscription_tier if user else None
        is_paid = tier in ("basic", "starter", "pro")

        active_models = models_for_tier(brand_type, tier)
```

Line 262 (query_model call) — replace `pro=is_pro` with `pro=is_paid`:
```python
            result = await query_model(model, prompt_text, brand_name, pro=is_paid, cancel_event=cancel_evt)
```

- [ ] **Step 2.2: Update `tracking.py` router — both prompt-run paths**

In `backend/app/routers/tracking.py`, there are two places that build model lists for single-prompt runs. Read the file first to confirm exact lines, then update.

Around line 332-394 (first prompt-run handler):
```python
    from app.services.llm_service import RUNS_PER_PROMPT, models_for_tier, query_model
    # ... (a bit later)
    tier = current_user.subscription_tier
    active_models = models_for_tier(brand_type, tier)
    is_paid = tier in ("basic", "starter", "pro")
```

Line 394 — replace `pro=is_pro` with `pro=is_paid`:
```python
            result = await query_model(model, prompt_text, brand_name, pro=is_paid, cancel_event=cancel_evt)
```

Around line 715-736 (second prompt-run handler):
```python
    from app.services.llm_service import RUNS_PER_PROMPT, models_for_tier, query_model
    # ... (a bit later)
    tier = current_user.subscription_tier
    active_models = models_for_tier(brand_type, tier)
    is_paid = tier in ("basic", "starter", "pro")
```

Line 736:
```python
            result = await query_model(model, prompt_text, brand_name, pro=is_paid)
```

Note: if either handler currently derives `is_pro` with different logic (e.g. from a brand admin check), preserve the existing semantics — only rename and add the `tier` variable.

- [ ] **Step 2.3: Update `database.py` — stale run threshold calc**

In `backend/app/database.py`, lines 435-445:

```python
        from app.services.llm_service import RUNS_PER_PROMPT, models_for_tier
        # Load brand + user tier to compute the correct model count for this run
        tier = None
        if brand and brand.user_id:
            user = await session.get(User, brand.user_id)
            tier = user.subscription_tier if user else None
        model_count = len(models_for_tier(brand.brand_type, tier)) if brand else 4
```

Read the surrounding code first to verify `User` is already imported at that scope (it probably isn't — add the import at the top of the function if needed).

- [ ] **Step 2.4: Run the full test suite — confirm nothing else broke**

```bash
cd backend && source venv/bin/activate && pytest tests/ -x --ignore=tests/test_first_run_pipeline.py
```

Expected: all tests PASS except for any Claude-specific cases we'll add in Task 3.

(If `test_first_run_pipeline.py` requires live API keys, leave it for manual verification.)

- [ ] **Step 2.5: Commit**

```bash
git add backend/app/services/tracking_service.py backend/app/routers/tracking.py backend/app/database.py
git commit -m "refactor(tracking): pass subscription tier to models_for_tier; rename is_pro -> is_paid"
```

---

## Task 3: Claude web search + citation stripping

**Files:**
- Modify: `backend/app/services/llm_service.py:231-267`
- Test: `backend/tests/test_tracking_service_unit.py`

- [ ] **Step 3.1: Write failing test for Claude web search invocation**

Append this test to `backend/tests/test_tracking_service_unit.py` (use existing imports; add `anthropic` and any mocks needed):

```python
import asyncio
from unittest.mock import AsyncMock, MagicMock, patch

import pytest


class _MockClaudeTextBlock:
    def __init__(self, text):
        self.type = "text"
        self.text = text


class _MockClaudeMessage:
    def __init__(self, text):
        self.content = [_MockClaudeTextBlock(text)]


@pytest.mark.asyncio
async def test_query_claude_uses_web_search_tool_and_strips_urls_before_mention_check():
    """Claude tracker queries must include web_search_20250305 and must not be tricked
    by brand-name-in-URL false positives (e.g. 'brand.com' in a citation footer)."""
    from app.services import llm_service

    captured_kwargs: dict = {}

    async def fake_create(**kwargs):
        captured_kwargs.update(kwargs)
        # Response contains brand only inside a URL citation — mention should be False after stripping.
        return _MockClaudeMessage(
            "Top options include Nike and Adidas. See more at https://stripe.com for payment details. [1]"
        )

    fake_client = MagicMock()
    fake_client.messages.create = fake_create

    with patch.object(llm_service, "ANTHROPIC_API_KEY", "test-key"), \
         patch("anthropic.AsyncAnthropic", return_value=fake_client):
        result = await llm_service._query_claude(
            prompt="best running shoes?",
            brand_name="Stripe",
            model_version="claude-haiku-4-5-20251001",
        )

    # 1) The tool must be on the request
    tools = captured_kwargs.get("tools") or []
    assert any(t.get("type") == "web_search_20250305" for t in tools), \
        f"Claude request missing web_search_20250305 tool: tools={tools}"

    # 2) The original response text is preserved for the transcript
    assert "stripe.com" in result["response_text"]

    # 3) Mention detection must ignore the URL — "Stripe" is only in the citation
    assert result["mentioned"] is False, \
        "Brand in URL citation should NOT count as a mention after stripping"


@pytest.mark.asyncio
async def test_query_claude_detects_mention_in_visible_text():
    from app.services import llm_service

    async def fake_create(**kwargs):
        return _MockClaudeMessage("I recommend Stripe for online payments.")

    fake_client = MagicMock()
    fake_client.messages.create = fake_create

    with patch.object(llm_service, "ANTHROPIC_API_KEY", "test-key"), \
         patch("anthropic.AsyncAnthropic", return_value=fake_client):
        result = await llm_service._query_claude(
            prompt="payment processors?",
            brand_name="Stripe",
            model_version="claude-haiku-4-5-20251001",
        )

    assert result["mentioned"] is True
    assert "Stripe" in result["response_text"]
```

- [ ] **Step 3.2: Run the tests — confirm they fail**

```bash
cd backend && source venv/bin/activate && pytest tests/test_tracking_service_unit.py -k "query_claude" -v
```

Expected: FAIL — the current `_query_claude` doesn't pass `tools` and doesn't strip URLs.

- [ ] **Step 3.3: Rewrite `_query_claude` to use web_search_20250305 + citation stripping**

Replace the entire `_query_claude` function in `backend/app/services/llm_service.py` (lines 231-267) with:

```python
# ── Claude ────────────────────────────────────────────────────────────────────

# Claude web search tool spec (Anthropic server-side tool).
# Docs: https://docs.anthropic.com/en/docs/build-with-claude/tool-use/web-search-tool
# max_uses=3 caps search calls per request to bound cost (search = $10/1k queries).
_CLAUDE_SEARCH_TOOL: dict = {
    "type": "web_search_20250305",
    "name": "web_search",
    "max_uses": 3,
}


def _extract_claude_text(response) -> str:
    """Concatenate all text blocks from a Claude response, skipping tool-use blocks.

    Tool-use responses include interleaved `server_tool_use` and `web_search_tool_result`
    blocks; we want only the model's prose. Blocks without a `text` attribute are ignored.
    """
    parts: list[str] = []
    for block in response.content or []:
        block_type = getattr(block, "type", None)
        if block_type == "text":
            text = getattr(block, "text", None)
            if text:
                parts.append(text)
    return "".join(parts)


async def _query_claude(prompt: str, brand_name: str, model_version: str = "claude-haiku-4-5-20251001") -> dict:
    """Query Claude with the web_search tool enabled.

    Only called for Pro-tier tracking (see models_for_tier), so search is always on.
    URL citations are stripped before mention detection to avoid false positives
    from brand names appearing in citation URLs.
    """
    if not ANTHROPIC_API_KEY:
        return _api_key_placeholder("claude")
    start = time.monotonic()
    try:
        import anthropic

        client = anthropic.AsyncAnthropic(api_key=ANTHROPIC_API_KEY)
        async with _CLAUDE_SEM:
            response = await client.messages.create(
                model=model_version,
                max_tokens=2048,  # search responses are longer than plain answers
                tools=[_CLAUDE_SEARCH_TOOL],
                messages=[{"role": "user", "content": prompt}],
            )
        latency_ms = int((time.monotonic() - start) * 1000)
        text = _extract_claude_text(response)
        if not text:
            logger.warning(
                "[claude] API returned no text blocks for prompt %r", prompt[:100]
            )
            return _build_result(
                None, brand_name, latency_ms,
                error="Empty response from Claude API",
            )
        # Strip URL/citation noise BEFORE mention check so brand names hidden
        # in citation URLs do not produce false positives. Keep original text
        # in response_text so the user-facing transcript retains citations.
        cleaned = _strip_url_citations(text)
        mentioned = _mentioned(brand_name, cleaned)
        return {
            "response_text": text,
            "mentioned": mentioned,
            "latency_ms": latency_ms,
            "error": None,
        }
    except Exception as exc:
        latency_ms = int((time.monotonic() - start) * 1000)
        logger.error("[claude] API error for prompt %r: %s", prompt[:100], exc)
        body = getattr(exc, "response", None)
        if body is not None:
            try:
                logger.error("[claude] API error body: %s", body.text)
            except Exception:
                pass
        return _build_result(None, brand_name, latency_ms, error=str(exc))
```

- [ ] **Step 3.4: Run the tests — confirm they pass**

```bash
cd backend && source venv/bin/activate && pytest tests/test_tracking_service_unit.py -k "query_claude" -v
```

Expected: both new tests PASS.

- [ ] **Step 3.5: Run the full suite to catch regressions**

```bash
cd backend && source venv/bin/activate && pytest tests/ -x --ignore=tests/test_first_run_pipeline.py
```

Expected: all PASS.

- [ ] **Step 3.6: Commit**

```bash
git add backend/app/services/llm_service.py backend/tests/test_tracking_service_unit.py
git commit -m "feat(llm): add Claude web_search_20250305 tool + URL citation stripping (Pro-only path)"
```

---

## Task 4: Update CLAUDE.md documentation

**Files:**
- Modify: `CLAUDE.md` — "LLM providers" line and "LLM Model Categories" section

- [ ] **Step 4.1: Update the stack description**

Find this line (around line 176):
```
- **LLM providers:** OpenAI (gpt-4.1-mini default, gpt-4o-mini-search-preview for paid subscribers), Anthropic (claude-haiku-4-5-20251001), Google GenAI (gemini-2.5-flash for all tiers), Perplexity (sonar default, sonar-pro for paid subscribers)
```

Replace with:
```
- **LLM providers:** OpenAI (gpt-4.1-mini default, gpt-4o-mini-search-preview for paid subscribers), Anthropic (claude-haiku-4-5-20251001 with web_search_20250305 — Pro tier only), Google GenAI (gemini-2.5-flash for all tiers), Perplexity (sonar default, sonar-pro for paid subscribers)
```

- [ ] **Step 4.2: Replace "LLM Model Categories" section**

Find (around line 207):
```
### LLM Model Categories
- **LIVE_MODELS** (Perplexity, Gemini) — query the live web; changes reflected within days
- **INDEX_MODELS** (ChatGPT, Claude) — static training data; changes slowly
- Perplexity: limited to 2 concurrent requests via `asyncio.Semaphore(2)` to avoid 429s
```

Replace with:
```
### LLM Model Selection
All four models query the live web:
- **ChatGPT** (`gpt-4o-mini-search-preview`, paid tiers only) — OpenAI native web search
- **Claude** (`claude-haiku-4-5-20251001` + `web_search_20250305` tool, Pro tier only) — Anthropic server-side web search
- **Perplexity** (`sonar` free, `sonar-pro` paid) — search-native model
- **Gemini** (`gemini-2.5-flash` with `google_search` grounding tool) — Google search grounding

Per-tier model lists are computed by `models_for_tier(brand_type, tier)` in `llm_service.py`.

Concurrency guards: Perplexity `Semaphore(2)`, Claude `Semaphore(3)`, Gemini `Semaphore(2)`.
```

- [ ] **Step 4.3: Update the "Tier-Based Query Counts" section**

Find (around line 218):
```
### Tier-Based Query Counts
| Tier | Runs per prompt per model |
|------|--------------------------|
| basic | 3 |
| standard | 3 |
| premium | 3 |
```

Replace with:
```
### Tier-Based Query Counts
All tiers use 3 runs per prompt per model (see `RUNS_PER_PROMPT` in `llm_service.py`).

### Tier-Based Model Lists
| Internal tier | UI name  | Models queried                                                |
|---------------|----------|---------------------------------------------------------------|
| `None`        | Free     | Perplexity, Gemini                                            |
| `basic`       | Starter  | ChatGPT search, Perplexity, Gemini                            |
| `starter`     | Growth   | ChatGPT search, Perplexity (sonar-pro), Gemini                |
| `pro`         | Pro      | ChatGPT search, Claude + web_search, Perplexity (sonar-pro), Gemini |

Pitch brands (`brand_type='pitch'`) always receive the Free list regardless of subscription.
```

- [ ] **Step 4.4: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: replace LIVE/INDEX model framing with tier-based model selection"
```

---

## Task 5: Frontend — MethodologyCallout component rewrite

> **Design skills required:** Invoke `impeccable` for the craft principles and `emil-design-eng` for interaction/animation polish BEFORE editing the component. Do not add any other frontend design libraries or patterns.

**Files:**
- Modify: `frontend/components/dashboard/MethodologyCallout.tsx`

- [ ] **Step 5.1: Read the full component**

```bash
# Read the whole file first — don't eyeball lines 80-83 in isolation.
```

Use the `Read` tool on `frontend/components/dashboard/MethodologyCallout.tsx` (full file).

- [ ] **Step 5.2: Invoke the design skills**

Invoke `Skill` with `impeccable` and separately with `emil-design-eng` to load their guidance. Apply their principles: no AI-slop copy, real information density, specific typography, restrained motion.

- [ ] **Step 5.3: Rewrite the Live Search / AI Index split**

In `MethodologyCallout.tsx`, find the explanatory block around lines 80-83 containing `"Live Search"` and `"AI Index"` (the `<span className="text-[var(--text-secondary)] font-medium">Live Search</span>` and `AI Index` spans).

Replace the two-part explanation with a single unified paragraph. Example copy (adapt per impeccable voice — don't copy-paste blindly):

```tsx
<p className="text-sm text-[var(--text-secondary)] leading-relaxed">
  We ask {' '}
  <span className="text-[var(--text-secondary)] font-medium">4 AI assistants</span>{' '}
  the questions your customers actually ask — each with live web search on — and measure how often they mention your brand.
</p>
```

Preserve the surrounding component structure (the card wrapper, icons, any animation). Match existing typography tokens (`text-[var(--text-secondary)]`, etc.) — don't introduce new colors or fonts.

- [ ] **Step 5.4: Verify the build passes**

```bash
cd frontend && npm run build
```

Expected: clean build, no TypeScript errors.

- [ ] **Step 5.5: Manual visual check**

Start the dev server and open the dashboard to confirm the component renders cleanly and is visually cohesive with the surrounding cards.

```bash
cd frontend && npm run dev  # port 3002 per memory
```

Then load the dashboard in the browser and inspect the MethodologyCallout area.

- [ ] **Step 5.6: Commit**

```bash
git add frontend/components/dashboard/MethodologyCallout.tsx
git commit -m "design(dashboard): unify MethodologyCallout copy around live AI search"
```

---

## Task 6: Frontend — Landing page "Live vs Index" decorative card

> **Design skills required:** Same as Task 5 — `impeccable` + `emil-design-eng` only.

**Files:**
- Modify: `frontend/app/page.tsx:556-557,646-680`

- [ ] **Step 6.1: Read the full page**

Read `frontend/app/page.tsx` in full (or the relevant sections around 540-700). Understand the surrounding decorative card's role — it's a visual summary element on the landing page marketing surface.

- [ ] **Step 6.2: Invoke the design skills**

Invoke `Skill` with `impeccable` and `emil-design-eng` for principles applied to this decorative element.

- [ ] **Step 6.3: Decide: replace or remove**

The "Live vs Index" card shows two counters (72% Live Search, 61% AI Index) with progress bars. Since the split no longer exists, either:

- **Option A (preferred):** Replace with a single "Brand visibility" counter animating up to a representative number (e.g. 78%). Keep the card shape, typography, and motion consistent with neighbor cards. Drop the `liveVal`/`indexVal` `useCountUp` pair and replace with a single value.
- **Option B:** Replace with a 4-model stack (ChatGPT, Claude, Perplexity, Gemini) showing a shared visibility score. Higher information density but more visual noise on a landing page.

Pick **Option A** unless `impeccable` + `emil` guidance steers otherwise. Update both the `useCountUp` hooks (lines 556-557) and the JSX block (lines 646-680).

Example replacement JSX (adapt to match neighboring card conventions):

```tsx
{/* Visibility summary */}
<div /* ...existing wrapper classes... */>
  <p className="text-xs font-semibold text-[#64748b] uppercase tracking-wider mb-3">
    Brand Visibility
  </p>
  <div ref={visibilityRef}>
    <div className="flex items-center justify-between mb-1">
      <span className="text-xs text-[#94a3b8]">Across 4 AI assistants</span>
      <span className="text-xs font-bold text-[#22c55e]">{visibilityVal}%</span>
    </div>
    <div className="h-2 bg-[#0f1a2e] rounded-full overflow-hidden">
      <div
        className="h-full bg-gradient-to-r from-[#22c55e] to-[#84cc16] transition-all duration-[1400ms] ease-out"
        style={{ width: `${visibilityVal}%` }}
      />
    </div>
  </div>
</div>
```

And replace the two hook calls:

```tsx
const { ref: visibilityRef, value: visibilityVal } = useCountUp(78, 1400);
```

- [ ] **Step 6.4: Ensure no other references to `liveVal`, `indexVal`, `liveRef`, `indexRef` remain**

Search the file to make sure the removed hooks have no other call sites.

- [ ] **Step 6.5: Build and visual check**

```bash
cd frontend && npm run build
```

Then `npm run dev`, load `/`, scroll to the decorative card, verify animation runs smoothly and no layout shift.

- [ ] **Step 6.6: Commit**

```bash
git add frontend/app/page.tsx
git commit -m "design(landing): replace Live/Index decorative card with unified visibility counter"
```

---

## Task 7: Frontend — Methodology page full rewrite

> **Design skills required:** `impeccable` + `emil-design-eng`. The methodology page is the primary trust surface — this rewrite must be crisp and specific. No generic copy, no buzzwords, no emoji.

**Files:**
- Modify: `frontend/app/methodology/page.tsx`

- [ ] **Step 7.1: Read the full page + invoke design skills**

Read `frontend/app/methodology/page.tsx` in full. Invoke `Skill` with `impeccable` and with `emil-design-eng`.

- [ ] **Step 7.2: Rewrite "Two types of AI visibility" section (lines ~65-153)**

The current section has two side-by-side cards ("Live Search" vs "AI Index"). Replace with a single section titled, e.g., **"How we measure visibility"** with four model cards (one per provider) instead. Each card shows:

- Model name (ChatGPT / Claude / Perplexity / Gemini)
- A one-line specific description of what each does (e.g. "OpenAI's native web search; checks the live web for every query.")
- A tier badge showing who gets it (Free / Paid / Pro-only)

Example card (adapt styling to match the current card visual system):

```tsx
<article className="rounded-2xl border border-[var(--card-border)] bg-[var(--card-bg)] p-6">
  <div className="flex items-center justify-between mb-3">
    <h3 className="text-sm font-semibold text-[var(--text-primary)]">Claude</h3>
    <span className="text-[10px] font-medium uppercase tracking-wider text-[var(--accent)] border border-[var(--accent)] rounded px-1.5 py-0.5">
      Pro only
    </span>
  </div>
  <p className="text-sm text-[var(--text-secondary)] leading-relaxed">
    Anthropic's Haiku 4.5 with live web search. Searches up to 3 times per query to find current context before answering.
  </p>
</article>
```

Use a 4-column grid on desktop, 2-column on tablet, 1-column on mobile. Match the rhythm of existing methodology sections.

- [ ] **Step 7.3: Rewrite "What moves your score" section (lines ~380-462)**

The current section splits into "Live Search factors" and "AI Index factors". Replace with a single unified list titled, e.g., **"What moves your score"**. Suggested items (trim/rewrite to be specific):

1. **Fresh web content** — Reddit threads, Quora answers, recent articles that include your brand in answering the prompt.
2. **Authority on high-signal sources** — Wikipedia, major publications, subreddits each model weights highly.
3. **Repeat mentions across independent sources** — a single Reddit post may get cited; three independent posts is much harder for a model to ignore.
4. **Prompt-term match** — whether the prompt's keywords appear near your brand in the page text.

No "flywheel" callout — delete lines 443-462 entirely.

- [ ] **Step 7.4: Rewrite any per-tier model display**

Find the "3 runs per prompt per model" note (around lines 283-299). Keep the runs note, but add a tier/model visibility table right beneath it:

```tsx
<table className="w-full text-sm mt-4">
  <thead>
    <tr className="border-b border-[var(--card-border)]">
      <th className="text-left font-medium text-[var(--text-secondary)] py-2">Tier</th>
      <th className="text-left font-medium text-[var(--text-secondary)] py-2">Models</th>
    </tr>
  </thead>
  <tbody className="text-[var(--text-primary)]">
    <tr className="border-b border-[var(--card-border)]">
      <td className="py-2 font-medium">Free</td>
      <td className="py-2">Perplexity, Gemini</td>
    </tr>
    <tr className="border-b border-[var(--card-border)]">
      <td className="py-2 font-medium">Starter</td>
      <td className="py-2">ChatGPT, Perplexity, Gemini</td>
    </tr>
    <tr className="border-b border-[var(--card-border)]">
      <td className="py-2 font-medium">Growth</td>
      <td className="py-2">ChatGPT, Perplexity (pro), Gemini</td>
    </tr>
    <tr>
      <td className="py-2 font-medium">Pro</td>
      <td className="py-2">ChatGPT, Claude, Perplexity (pro), Gemini</td>
    </tr>
  </tbody>
</table>
```

- [ ] **Step 7.5: Search the full page for any stale "Live Search" / "AI Index" / "training data" / "flywheel" strings**

Use `Grep` on `frontend/app/methodology/page.tsx` for those terms and excise every remaining mention. Nothing should reference the old dichotomy after this task.

- [ ] **Step 7.6: Build + manual visual check**

```bash
cd frontend && npm run build
```

Then:
```bash
cd frontend && npm run dev
```

Load `/methodology`, scroll through every section, confirm rhythm is consistent with the rest of the site and no ghost references remain.

- [ ] **Step 7.7: Commit**

```bash
git add frontend/app/methodology/page.tsx
git commit -m "design(methodology): rewrite around 4-model live-search architecture; drop Live/Index framing"
```

---

## Task 8: End-to-end verification

**Files:** None — this is a verification-only task.

- [ ] **Step 8.1: Run the full backend test suite**

```bash
cd backend && source venv/bin/activate && pytest tests/ -v
```

Expected: all pass (excluding any pre-existing skips or live-API gated tests).

- [ ] **Step 8.2: Run the frontend build**

```bash
cd frontend && npm run build
```

Expected: clean build. No TypeScript errors, no unused imports.

- [ ] **Step 8.3: Manual smoke test — Pro account**

With the backend running on port 3001 and frontend on port 3002 (per memory), log in as `ken@lumidian.ai` (the account where we just set `subscription_tier = 'pro'` in prod).

Trigger a tracking run on the `spotitearly` brand or any Pro-owned brand. Watch the backend logs for:

```
[chatgpt] querying model_version=gpt-4o-mini-search-preview is_search=True
```

AND verify a Claude query is attempted (no `[claude] ...` log yet — add one at the start of `_query_claude` if helpful during smoke test, but revert before final commit).

When the run completes, verify in the UI that all four models (ChatGPT, Claude, Perplexity, Gemini) appear in the per-model breakdown.

- [ ] **Step 8.4: Manual smoke test — Starter/Growth (non-Pro paid) account**

Either switch the admin account's tier to `basic` temporarily (via SQL) or use a test account. Trigger a run. Verify:
- 3 models queried: ChatGPT, Perplexity, Gemini
- No Claude rows in `QueryResult`
- UI does not show a Claude column (components should render only models present in the data)

Restore the original tier afterward.

- [ ] **Step 8.5: Manual smoke test — Free account**

Using a free-trial account (or temporarily setting `subscription_tier = None`), trigger a tracking run. Verify:
- 2 models queried: Perplexity, Gemini
- No ChatGPT or Claude rows
- UI renders cleanly without the missing columns looking broken

- [ ] **Step 8.6: Frontend pages visual sweep**

Open each of: `/` (landing), `/dashboard`, `/methodology`. Confirm zero stale references to "Live Search", "AI Index", "training data", "flywheel". Screenshot any section where the visual rhythm feels off and iterate before merging.

- [ ] **Step 8.7: Final commit (if any fixes found in 8.3-8.6)**

```bash
git add <files>
git commit -m "fix: address smoke test findings"
```

- [ ] **Step 8.8: Merge review gate**

Per memory (`feedback_branch_review.md`): do not merge to main unilaterally. Push the branch and ask the user to review before merging. On approval, merging to main auto-pushes to origin (per `feedback_merge_auto_pushes.md`), which triggers Railway auto-deploy.

---

## Self-Review Checklist (done during plan authoring)

- [x] **Spec coverage:** user said (1) remove Claude from all tiers except Pro, (2) Pro gets Claude live web search, (3) all paid tiers keep ChatGPT web search, (4) remove LIVE vs INDEX everywhere, (5) use superpowers + impeccable + emil for frontend. All 5 covered in Tasks 1-7.
- [x] **Placeholder scan:** No TBDs, no "similar to Task N", every code block has real content.
- [x] **Type consistency:** `models_for_tier(brand_type, tier)` signature used consistently across Tasks 1-2. `is_paid` replaces `is_pro` consistently. `_CLAUDE_SEARCH_TOOL` dict used in Task 3.
- [x] **Risk: Claude drafting paths unaffected.** Drafting uses `call_claude` from `drafting/client.py` — separate from `_query_claude` in the tracker. No changes needed there.
- [x] **Risk: Frontend MODEL_CONFIG/MODEL_ORDER.** `frontend/lib/constants/models.ts` still includes `'claude'` — that's fine because UI components render only models that appear in the run's `QueryResult` data; absent Claude in Starter/Growth data means absent Claude in their UI.
- [x] **Cost awareness:** Claude web search at ~$0.031/query means ~$112/mo per Pro brand at 20 prompts × 3 runs × 2 sweeps × 30 days. Acceptable per user's approval. Monitor after rollout.

---

## Execution Handoff

**Plan complete and saved to `docs/superpowers/plans/2026-04-21-pro-only-claude-live-search.md`.** Two execution options:

1. **Subagent-Driven (recommended)** — dispatch a fresh subagent per task, review between tasks, fast iteration. Uses `superpowers:subagent-driven-development`.
2. **Inline Execution** — execute tasks in this session using `superpowers:executing-plans`, batch execution with checkpoints.

Which approach?
