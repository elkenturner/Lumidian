# Opportunity Relevance Overhaul + Regenerate UX Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix irrelevant Reddit/Quora opportunities via smarter search queries + reweighted scoring + Claude Haiku gate; rename "Generate"→"Regenerate" buttons; add Quora to the scan trigger; show a helpful message when no content gaps exist yet.

**Architecture:** Four backend changes (reddit scorer, reddit query builder, haiku gate, quora scorer + scan trigger) and two frontend changes (button labels, error message). All scanner changes run in the background so latency of the Haiku gate is irrelevant.

**Tech Stack:** Python/FastAPI, SQLAlchemy async, Anthropic SDK (claude-haiku-4-5-20251001), Next.js/TypeScript

---

## File Map

| File | What changes |
|------|-------------|
| `backend/app/services/reddit_scanner_service.py` | New `QUERY_STOP`, `_PHRASE_TERMS`, `_build_search_query()`, `_haiku_relevance_check()`; `_score_thread` formula + threshold; `scan_brand_opportunities` uses new query builder + two-phase loop + Haiku gate |
| `backend/app/services/quora_scanner_service.py` | `_MIN_SCORE` 40→55; min matches 2→3 |
| `backend/app/routers/opportunities.py` | `_scan_and_log` adds Quora scan via `asyncio.gather` |
| `frontend/app/content/page.tsx` | Rename buttons; "no gaps" error message |
| `frontend/components/content/ContentTabPanels.tsx` | Rename empty-state button |
| `backend/tests/test_reddit_scanner.py` | Update tests for new scoring weights, min matches, Haiku gate mock |
| `backend/tests/test_quora_scanner.py` | Update tests for new threshold + min matches |

---

### Task 1: Update `_score_thread` — reweight formula + raise threshold + min matches

**Files:**
- Modify: `backend/app/services/reddit_scanner_service.py:244-246,268,447`
- Test: `backend/tests/test_reddit_scanner.py`

- [ ] **Step 1: Write failing tests for new scoring behavior**

Add these tests at the bottom of `backend/tests/test_reddit_scanner.py`:

```python
# ── New scoring formula tests ─────────────────────────────────────────────────

def test_engagement_weight_reduced():
    """High-engagement irrelevant post should NOT score >= 65 with new formula."""
    # "capital raise platform service" are now generic — only 1 specific word matches
    title = "one year thoughts on my journey"
    prompt = "what is the best reg a+ capital raise platform advisory service"
    # This used to score high due to engagement weight; with new formula it should score 0
    score = _score_thread(title, "", prompt, _ts(1), num_comments=500, brand_name="CapCo")
    assert score == 0.0

def test_high_relevance_post_passes_new_threshold():
    """Highly relevant post (3+ matches, high relevance) scores >= 65."""
    title = "how to choose a reg a+ advisory platform for capital raises"
    prompt = "what is the best reg a+ advisory platform for capital raises"
    score = _score_thread(title, "", prompt, _ts(3), num_comments=10, brand_name="CapCo")
    assert score >= 65.0

def test_two_matches_now_scores_zero():
    """Post with exactly 2 keyword matches returns 0 under new min-matches=3 rule."""
    # Prompt has many keywords; post only shares 2
    title = "advisory platform review"
    prompt = "what is the best reg a+ advisory platform for direct listings and capital"
    # After stop word removal, prompt has: reg, advisory, platform, direct, listings, capital (6 words)
    # title matches: advisory (1), platform (1) — only 2 matches
    score = _score_thread(title, "", prompt, _ts(1), num_comments=50, brand_name="CapCo")
    assert score == 0.0
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd backend && source venv/bin/activate && pytest tests/test_reddit_scanner.py::test_engagement_weight_reduced tests/test_reddit_scanner.py::test_high_relevance_post_passes_new_threshold tests/test_reddit_scanner.py::test_two_matches_now_scores_zero -v
```

Expected: 3 failures (function exists but formula/threshold not updated yet)

- [ ] **Step 3: Update `_score_thread` in reddit_scanner_service.py**

Find the block at lines ~244–246 and ~268 and ~447. Make these three changes:

Change 1 — minimum matches (line ~245):
```python
# Before:
    if relevance < 0.45 or matches < 2:
# After:
    if relevance < 0.45 or matches < 3:
```

Change 2 — scoring formula (line ~268):
```python
# Before:
    score = relevance * 50.0 + recency * 20.0 + engagement * 20.0 + brand_bonus
# After:
    score = relevance * 70.0 + recency * 20.0 + engagement * 10.0 + brand_bonus
```

Change 3 — storage threshold (line ~447):
```python
# Before:
            if score < 55.0:
# After:
            if score < 65.0:
```

- [ ] **Step 4: Update existing test docstring (matches < 2 → < 3)**

In `backend/tests/test_reddit_scanner.py`, find:

```python
def test_low_relevance_scores_zero():
    """Post that shares fewer than 2 prompt words returns 0."""
```

Change to:

```python
def test_low_relevance_scores_zero():
    """Post that shares fewer than 3 prompt words returns 0."""
```

- [ ] **Step 5: Run all reddit scanner unit tests**

```bash
cd backend && source venv/bin/activate && pytest tests/test_reddit_scanner.py -v -k "not asyncio"
```

Expected: all unit tests pass (including the 3 new ones). Integration tests will be fixed in Task 3.

- [ ] **Step 6: Commit**

```bash
git add backend/app/services/reddit_scanner_service.py backend/tests/test_reddit_scanner.py
git commit -m "feat: reweight reddit scoring formula, raise threshold to 65, require 3+ matches"
```

---

### Task 2: Add `_build_search_query` + use it in scanner

**Files:**
- Modify: `backend/app/services/reddit_scanner_service.py` (top of file + scan loop)
- Test: `backend/tests/test_reddit_scanner.py`

- [ ] **Step 1: Write failing tests for `_build_search_query`**

Add to `backend/tests/test_reddit_scanner.py` (after the imports, import the new function):

```python
from app.services.reddit_scanner_service import (
    _is_blocked_subreddit,
    _score_thread,
    _build_search_query,
)
```

Then add tests:

```python
# ── _build_search_query ───────────────────────────────────────────────────────

def test_build_search_query_quotes_reg_a_plus():
    """'Reg A+' in prompt → quoted phrase in query."""
    q = _build_search_query("what service will help me raise capital using Reg A+")
    assert '"reg a+"' in q.lower()

def test_build_search_query_strips_generic_finance_words():
    """Generic words like 'capital', 'raise', 'service' don't appear bare."""
    q = _build_search_query("what service will help me raise capital using Reg A+")
    bare_words = q.lower().split()
    # These generic words must not appear as standalone unquoted terms
    for word in ("capital", "raise", "service", "help"):
        assert word not in bare_words, f"'{word}' leaked into query: {q}"

def test_build_search_query_returns_nonempty():
    """Always returns something even for generic prompts."""
    q = _build_search_query("what is the best way to do things")
    assert len(q.strip()) > 0

def test_build_search_query_extracts_specific_words():
    """Specific domain words survive after stop-word removal."""
    q = _build_search_query("how do companies complete a direct listing on NYSE")
    assert any(w in q.lower() for w in ("direct", "listing", "nyse", "companies"))
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd backend && source venv/bin/activate && pytest tests/test_reddit_scanner.py::test_build_search_query_quotes_reg_a_plus tests/test_reddit_scanner.py::test_build_search_query_strips_generic_finance_words tests/test_reddit_scanner.py::test_build_search_query_returns_nonempty tests/test_reddit_scanner.py::test_build_search_query_extracts_specific_words -v
```

Expected: ImportError or NameError — `_build_search_query` does not exist yet.

- [ ] **Step 3: Add `QUERY_STOP`, `_PHRASE_TERMS`, and `_build_search_query` to reddit_scanner_service.py**

Add this block immediately after the `_STOP` definition (around line 91), before `_FICTION_SUBS`:

```python
# ── Query-time stop words (too generic to make a good Reddit search query) ────
# These words appear in completely unrelated contexts and flood results.
# Distinct from _STOP (scoring-time): a word can be scored but not searched.
QUERY_STOP: frozenset[str] = frozenset({
    "capital", "raise", "raises", "raised", "service", "services",
    "platform", "platforms", "advisory", "advisor", "advisors",
    "company", "companies", "business", "businesses",
    "fund", "funds", "funding", "help", "best", "top",
    "use", "using", "used", "invest", "investor", "investors",
    "market", "markets", "money", "growth", "scale",
    "solution", "solutions", "provider", "providers",
    "startup", "startups", "enterprise", "product", "products",
    "strategy", "strategies", "need", "needs", "want", "wants",
    "find", "choose", "choosing", "getting", "making",
})

# Multi-word regulatory/technical terms to search as quoted phrases.
# Presence of these in a post is a near-perfect relevance signal.
_PHRASE_TERMS: list[str] = [
    "reg a+", "reg d", "reg s", "regulation a", "regulation d", "regulation s",
    "capital raise", "securities offering", "direct listing",
    "crowdfunding", "equity crowdfunding", "investor relations",
    "accredited investor", "accredited investors",
    "venture capital", "private equity", "angel investor",
    "initial public offering", "ipo", "spac", "reverse merger",
]


def _build_search_query(prompt_text: str) -> str:
    """
    Extract the most search-effective terms from a prompt.

    - Detects multi-word regulatory/technical phrases and quotes them for exact match.
    - Strips generic finance/SaaS words (QUERY_STOP) that cause false-positive results.
    - Returns top-3 remaining specific keywords joined with spaces.
    - Falls back to raw prompt text if nothing survives filtering.
    """
    lower = prompt_text.lower()

    # Detect and quote multi-word technical phrases first
    quoted: list[str] = []
    for phrase in _PHRASE_TERMS:
        if phrase in lower:
            quoted.append(f'"{phrase}"')

    # Extract remaining single keywords (not in either stop set, length > 3)
    clean = re.sub(r"[^a-z0-9\s]", " ", lower)
    words = [
        w for w in clean.split()
        if w not in _STOP and w not in QUERY_STOP and len(w) > 3
    ]

    # Compose: up to 2 quoted phrases + enough single words to reach 3 terms total
    parts = quoted[:2] + words[:max(0, 3 - len(quoted[:2]))]

    return " ".join(parts) if parts else prompt_text
```

- [ ] **Step 4: Update `scan_brand_opportunities` to use `_build_search_query` for prompt queries**

Find the query-building block in `scan_brand_opportunities` (around line 384):

```python
# Before:
        queries: list[tuple[str, int | None]] = [
            (prompt.text, prompt.id) for prompt in prompts[:6]
        ]
        queries.append((brand.name, None))  # brand-name query has no associated prompt
```

Change to:

```python
# After:
        queries: list[tuple[str, int | None]] = [
            (_build_search_query(prompt.text), prompt.id) for prompt in prompts[:6]
        ]
        queries.append((brand.name, None))  # brand-name query: already specific, no extraction
```

- [ ] **Step 5: Run new unit tests**

```bash
cd backend && source venv/bin/activate && pytest tests/test_reddit_scanner.py::test_build_search_query_quotes_reg_a_plus tests/test_reddit_scanner.py::test_build_search_query_strips_generic_finance_words tests/test_reddit_scanner.py::test_build_search_query_returns_nonempty tests/test_reddit_scanner.py::test_build_search_query_extracts_specific_words -v
```

Expected: all 4 pass.

- [ ] **Step 6: Run full unit test suite (non-async)**

```bash
cd backend && source venv/bin/activate && pytest tests/test_reddit_scanner.py -v -k "not asyncio"
```

Expected: all pass.

- [ ] **Step 7: Commit**

```bash
git add backend/app/services/reddit_scanner_service.py backend/tests/test_reddit_scanner.py
git commit -m "feat: add _build_search_query with phrase detection and generic stop words"
```

---

### Task 3: Add `_haiku_relevance_check` + integrate into scanner

**Files:**
- Modify: `backend/app/services/reddit_scanner_service.py`
- Test: `backend/tests/test_reddit_scanner.py`

- [ ] **Step 1: Write failing tests for `_haiku_relevance_check`**

Add import to top of `backend/tests/test_reddit_scanner.py`:

```python
from app.services.reddit_scanner_service import (
    _is_blocked_subreddit,
    _score_thread,
    _build_search_query,
    _haiku_relevance_check,
)
```

Add tests:

```python
# ── _haiku_relevance_check ────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_haiku_check_returns_list_same_length():
    """Returns a boolean list of same length as input."""
    from unittest.mock import AsyncMock, patch, MagicMock
    candidates = [
        {"title": "How to raise capital via Reg A+", "subreddit": "startups", "body_preview": ""},
        {"title": "My cat is sick", "subreddit": "cats", "body_preview": ""},
    ]
    mock_msg = MagicMock()
    mock_msg.content = [MagicMock(text="YES")]
    with patch("anthropic.AsyncAnthropic") as mock_cls:
        mock_client = AsyncMock()
        mock_cls.return_value = mock_client
        mock_client.messages.create = AsyncMock(return_value=mock_msg)
        with patch.dict("os.environ", {"ANTHROPIC_API_KEY": "test-key"}):
            result = await _haiku_relevance_check("CapCo", "Reg A+ advisory", candidates)
    assert len(result) == 2
    assert all(isinstance(r, bool) for r in result)

@pytest.mark.asyncio
async def test_haiku_check_fails_open_on_api_error():
    """If Anthropic API raises, candidate is kept (True), not silently dropped."""
    candidates = [{"title": "Test post", "subreddit": "test", "body_preview": ""}]
    with patch("anthropic.AsyncAnthropic") as mock_cls:
        mock_client = AsyncMock()
        mock_cls.return_value = mock_client
        mock_client.messages.create = AsyncMock(side_effect=Exception("API down"))
        with patch.dict("os.environ", {"ANTHROPIC_API_KEY": "test-key"}):
            result = await _haiku_relevance_check("CapCo", "Reg A+ advisory", candidates)
    assert result == [True]

@pytest.mark.asyncio
async def test_haiku_check_no_api_key_fails_open():
    """Missing ANTHROPIC_API_KEY returns all True (fail open)."""
    candidates = [{"title": "Test", "subreddit": "test", "body_preview": ""}]
    with patch.dict("os.environ", {}, clear=True):
        import os
        os.environ.pop("ANTHROPIC_API_KEY", None)
        result = await _haiku_relevance_check("CapCo", "Reg A+ advisory", candidates)
    assert result == [True]
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd backend && source venv/bin/activate && pytest tests/test_reddit_scanner.py::test_haiku_check_returns_list_same_length tests/test_reddit_scanner.py::test_haiku_check_fails_open_on_api_error tests/test_reddit_scanner.py::test_haiku_check_no_api_key_fails_open -v
```

Expected: ImportError — `_haiku_relevance_check` not defined yet.

- [ ] **Step 3: Add `_haiku_relevance_check` to reddit_scanner_service.py**

Add this function immediately after `_build_search_query` (before `_fetch`):

```python
async def _haiku_relevance_check(
    brand_name: str,
    brand_description: str,
    candidates: list[dict],
) -> list[bool]:
    """
    Ask Claude Haiku whether each candidate is a genuine content opportunity.
    candidates: list of {title, subreddit, body_preview}
    Returns a list of booleans (True = keep). Fails open on any error.
    """
    import os
    import anthropic

    if not candidates:
        return []

    api_key = os.getenv("ANTHROPIC_API_KEY", "")
    if not api_key:
        logger.debug("haiku_relevance_check: no ANTHROPIC_API_KEY, failing open")
        return [True] * len(candidates)

    client = anthropic.AsyncAnthropic(api_key=api_key)
    results: list[bool] = []

    for c in candidates:
        prompt = (
            f"Brand: {brand_name}\n"
            f"What they do: {brand_description}\n\n"
            f"Reddit post title: {c['title']}\n"
            f"Subreddit: r/{c.get('subreddit', '')}\n"
            f"Post preview: {c.get('body_preview', '')[:300]}\n\n"
            "Is this a genuine opportunity for this brand to contribute expert value "
            "as a reply or comment? Answer only YES or NO."
        )
        try:
            msg = await client.messages.create(
                model="claude-haiku-4-5-20251001",
                max_tokens=5,
                messages=[{"role": "user", "content": prompt}],
            )
            text = msg.content[0].text if msg.content else ""
            results.append("YES" in text.upper())
        except Exception as exc:
            logger.debug("haiku_relevance_check: API error for candidate %r: %s", c.get("title"), exc)
            results.append(True)  # fail open

    return results
```

- [ ] **Step 4: Integrate Haiku gate into `scan_brand_opportunities`**

The current scan loop scores and immediately writes to DB. Restructure it into two phases: score all → haiku gate → store approved.

Find the section in `scan_brand_opportunities` that starts after deduplication (around the `# Score and store` comment) and ends before `db.commit()`. Replace it with this two-phase approach:

```python
        # ── Phase 1: score all candidates ─────────────────────────────────────
        default_prompt_text = prompts[0].text if prompts else ""

        # Get brand description for Haiku gate
        from app.models import BrandProfile
        profile_result = await db.execute(
            select(BrandProfile).where(BrandProfile.brand_id == brand_id)
        )
        profile = profile_result.scalar_one_or_none()
        brand_description = (
            (profile.company_description if profile and profile.company_description else None)
            or brand.website_url
            or brand.name
        )

        scored: list[dict] = []  # candidates that pass keyword scoring

        for post, prompt_id in deduped:
            permalink = post.get("permalink", "")
            if not permalink:
                continue
            thread_url = f"https://www.reddit.com{permalink}"
            if thread_url in existing_urls:
                continue

            title = post.get("title", "")
            if not title:
                continue

            subreddit_name = post.get("subreddit", "")
            if _is_blocked_subreddit(subreddit_name):
                continue

            body = post.get("selftext", "")
            created_utc = float(post.get("created_utc", 0))
            num_comments = int(post.get("num_comments", 0))

            scoring_prompt = next(
                (p.text for p in prompts if p.id == prompt_id),
                default_prompt_text,
            )

            score = _score_thread(
                title, body, scoring_prompt, created_utc,
                num_comments=num_comments,
                brand_name=brand.name,
                subreddit=subreddit_name,
            )
            if score < 65.0:
                continue

            scored.append({
                "title": title,
                "subreddit": subreddit_name,
                "body_preview": body[:300] if body else "",
                "thread_url": thread_url,
                "score": score,
                "prompt_id": prompt_id,
                "created_utc": created_utc,
                "num_comments": num_comments,
                "body": body,
            })

        # ── Phase 2: Haiku relevance gate ──────────────────────────────────────
        haiku_decisions = await _haiku_relevance_check(
            brand.name, brand_description, scored
        )

        # ── Phase 3: Store approved candidates ────────────────────────────────
        for cand, keep in zip(scored, haiku_decisions):
            if not keep:
                logger.debug(
                    "haiku_relevance_check: rejected %r in r/%s",
                    cand["title"][:60], cand["subreddit"],
                )
                continue

            posted_dt = (
                datetime.fromtimestamp(cand["created_utc"], tz=timezone.utc).replace(tzinfo=None)
                if cand["created_utc"] else None
            )

            opp = ContentOpportunity(
                brand_id=brand_id,
                platform="reddit",
                thread_url=cand["thread_url"],
                thread_title=cand["title"][:500],
                subreddit=cand["subreddit"][:100],
                body_preview=cand["body_preview"] if cand["body_preview"] else None,
                posted_at=posted_dt,
                relevance_score=cand["score"],
                prompt_id=cand["prompt_id"],
                status="new",
            )
            db.add(opp)
            existing_urls.add(cand["thread_url"])
            new_count += 1
```

Remove the old scoring loop (the `for post, prompt_id in deduped:` block that was there before).

- [ ] **Step 5: Update integration tests to mock the Haiku gate**

The existing integration tests `test_blocked_subreddit_not_stored`, `test_relevant_post_stored`, `test_deduplication`, `test_works_with_no_industry_match` all call `scan_brand_opportunities` directly. They need to mock `_haiku_relevance_check` so no real API call is made.

Update each `with patch.object(...)` block to also mock the haiku function. For each test that expects `count >= 1`, mock haiku to return `[True]`. For tests that expect `count == 0` (like `test_blocked_subreddit_not_stored`), the haiku gate never runs because the post is filtered earlier.

**`test_relevant_post_stored`** — update:
```python
@pytest.mark.asyncio
async def test_relevant_post_stored(tmp_db):
    """A relevant, unblocked post must be stored as a ContentOpportunity."""
    from app.services import reddit_scanner_service

    relevant_post = _make_post(
        "/r/SaaS/comments/xyz/post/",
        "what is the best project management saas tool for remote teams",
        subreddit="SaaS",
        num_comments=15,
    )

    async def fake_fetch(url: str):
        return _reddit_response(relevant_post)

    brand_id = await tmp_db.create_brand_with_prompt(
        name="Acme", prompt="what is the best project management saas tool"
    )

    with patch.object(reddit_scanner_service, "_fetch", side_effect=fake_fetch), \
         patch.object(reddit_scanner_service, "_haiku_relevance_check", return_value=[True]), \
         patch("asyncio.sleep"):
        count = await reddit_scanner_service.scan_brand_opportunities(brand_id)

    assert count >= 1
```

**`test_deduplication`** — update similarly (add `_haiku_relevance_check` mock returning `[True]`):
```python
    with patch.object(reddit_scanner_service, "_fetch", side_effect=fake_fetch), \
         patch.object(reddit_scanner_service, "_haiku_relevance_check", return_value=[True]), \
         patch("asyncio.sleep"):
        count = await reddit_scanner_service.scan_brand_opportunities(brand_id)
```

**`test_works_with_no_industry_match`** — update similarly.

**`test_scan_uses_prompt_text_as_search_query`** and **`test_brand_name_is_also_searched`** — these only check URLs, not stored count. Add haiku mock as well:
```python
    with patch.object(reddit_scanner_service, "_fetch", side_effect=fake_fetch), \
         patch.object(reddit_scanner_service, "_haiku_relevance_check", return_value=[]), \
         patch("asyncio.sleep"):
```

Add new test for Haiku rejection:
```python
@pytest.mark.asyncio
async def test_haiku_rejected_post_not_stored(tmp_db):
    """A post that passes keyword scoring but fails haiku gate is NOT stored."""
    from app.services import reddit_scanner_service

    post = _make_post(
        "/r/SaaS/comments/abc/post/",
        "what is the best project management saas tool for remote teams",
        subreddit="SaaS",
        num_comments=15,
    )

    async def fake_fetch(url: str):
        return _reddit_response(post)

    brand_id = await tmp_db.create_brand_with_prompt(
        name="Acme", prompt="what is the best project management saas tool"
    )

    with patch.object(reddit_scanner_service, "_fetch", side_effect=fake_fetch), \
         patch.object(reddit_scanner_service, "_haiku_relevance_check", return_value=[False]), \
         patch("asyncio.sleep"):
        count = await reddit_scanner_service.scan_brand_opportunities(brand_id)

    assert count == 0
```

- [ ] **Step 6: Run the haiku unit tests**

```bash
cd backend && source venv/bin/activate && pytest tests/test_reddit_scanner.py::test_haiku_check_returns_list_same_length tests/test_reddit_scanner.py::test_haiku_check_fails_open_on_api_error tests/test_reddit_scanner.py::test_haiku_check_no_api_key_fails_open -v
```

Expected: all 3 pass.

- [ ] **Step 7: Run full reddit scanner test suite**

```bash
cd backend && source venv/bin/activate && pytest tests/test_reddit_scanner.py -v
```

Expected: all tests pass.

- [ ] **Step 8: Commit**

```bash
git add backend/app/services/reddit_scanner_service.py backend/tests/test_reddit_scanner.py
git commit -m "feat: add haiku relevance gate to reddit scanner; restructure scan loop to two phases"
```

---

### Task 4: Tighten Quora scanner threshold + min matches

**Files:**
- Modify: `backend/app/services/quora_scanner_service.py:23,107`
- Test: `backend/tests/test_quora_scanner.py`

- [ ] **Step 1: Write failing tests for new Quora thresholds**

Add to `backend/tests/test_quora_scanner.py`:

```python
# ── New threshold tests ───────────────────────────────────────────────────────

def test_score_question_two_matches_returns_zero():
    """Exactly 2 keyword matches now returns 0 (new minimum is 3)."""
    # prompt has many keywords; question only shares 2
    score = _score_question(
        title="advisory platform review",
        snippet="short snippet here",
        prompt_text="what is the best reg a+ advisory platform for direct listings and capital raise",
    )
    assert score == 0.0

def test_score_question_three_matches_nonzero():
    """3 keyword matches returns nonzero score."""
    score = _score_question(
        title="how to use reg a+ advisory platform for capital raise",
        snippet="guide for raising capital",
        prompt_text="what is the best reg a+ advisory platform for capital raise",
    )
    assert score > 0.0
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd backend && source venv/bin/activate && pytest tests/test_quora_scanner.py::test_score_question_two_matches_returns_zero tests/test_quora_scanner.py::test_score_question_three_matches_nonzero -v
```

Expected: `test_score_question_two_matches_returns_zero` fails (currently 2 matches returns nonzero).

- [ ] **Step 3: Update `_MIN_SCORE` and min matches in quora_scanner_service.py**

Change 1 — `_MIN_SCORE` at line 23:
```python
# Before:
_MIN_SCORE = 40.0
# After:
_MIN_SCORE = 55.0
```

Change 2 — minimum matches in `_score_question` at line ~107:
```python
# Before:
    if matches < 2:
# After:
    if matches < 3:
```

- [ ] **Step 4: Run Quora scanner tests**

```bash
cd backend && source venv/bin/activate && pytest tests/test_quora_scanner.py -v
```

Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/quora_scanner_service.py backend/tests/test_quora_scanner.py
git commit -m "feat: raise quora scanner threshold to 55, require 3+ keyword matches"
```

---

### Task 5: Add Quora scan to the opportunities scan trigger

**Files:**
- Modify: `backend/app/routers/opportunities.py:137-168`
- Test: `backend/tests/test_content.py` (add integration test for the scan endpoint)

- [ ] **Step 1: Write a failing test**

Add to `backend/tests/test_content.py` (at the bottom, after existing tests).
Test `_scan_and_log` directly (avoids background-task timing issues):

```python
# ── Scan trigger includes Quora ───────────────────────────────────────────────

@pytest.mark.asyncio
async def test_scan_log_calls_both_reddit_and_quora():
    """_scan_and_log must call both Reddit and Quora scan_brand_opportunities."""
    from unittest.mock import AsyncMock, patch
    from app.routers.opportunities import _scan_and_log

    with patch("app.services.reddit_scanner_service.scan_brand_opportunities", new_callable=AsyncMock) as mock_reddit, \
         patch("app.services.quora_scanner_service.scan_brand_opportunities", new_callable=AsyncMock) as mock_quora, \
         patch("app.services.analytics_service.log_event", new_callable=AsyncMock):
        await _scan_and_log(brand_id=99)

    mock_reddit.assert_called_once_with(99, clear_existing=True)
    mock_quora.assert_called_once_with(99, clear_existing=True)
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd backend && source venv/bin/activate && pytest tests/test_content.py::test_scan_log_calls_both_reddit_and_quora -v
```

Expected: FAIL — `mock_quora` not called (Quora scan not in `_scan_and_log` yet).

- [ ] **Step 3: Update `opportunities.py` to import and run both scanners**

Replace the entire `_scan_and_log` function:

```python
async def _scan_and_log(brand_id: int) -> None:
    """Run Reddit AND Quora scanners in parallel, then log the scan_completed event."""
    from app.services import reddit_scanner_service, quora_scanner_service
    from app.services.analytics_service import log_event
    from app.database import AsyncSessionLocal

    try:
        import asyncio
        await asyncio.gather(
            reddit_scanner_service.scan_brand_opportunities(brand_id, clear_existing=True),
            quora_scanner_service.scan_brand_opportunities(brand_id, clear_existing=True),
        )
    except Exception:
        logger.exception("_scan_and_log: scanner error for brand_id=%d", brand_id)

    # Count opportunities found in the last few minutes for analytics
    try:
        from datetime import datetime, timezone, timedelta
        cutoff = datetime.now(timezone.utc).replace(tzinfo=None) - timedelta(minutes=10)
        async with AsyncSessionLocal() as db:
            from app.models import ContentOpportunity
            from sqlalchemy import select as _select
            result = await db.execute(
                _select(ContentOpportunity).where(
                    ContentOpportunity.brand_id == brand_id,
                    ContentOpportunity.created_at >= cutoff,
                )
            )
            new_opps = list(result.scalars().all())
            subreddits = list({o.subreddit for o in new_opps if o.subreddit})
        await log_event(
            "reddit_scan_completed",
            {"opportunities_found": len(new_opps), "subreddits_scanned": subreddits},
            brand_id=brand_id,
        )
    except Exception:
        pass
```

Also add the logger import at the top of the function scope if not present. Check that `logger = logging.getLogger(__name__)` exists in `opportunities.py` — if not, add it after the imports.

- [ ] **Step 4: Run the test**

```bash
cd backend && source venv/bin/activate && pytest tests/test_content.py::test_scan_trigger_runs_both_reddit_and_quora -v
```

Expected: PASS.

- [ ] **Step 5: Run full test suite**

```bash
cd backend && source venv/bin/activate && pytest tests/ -v --tb=short 2>&1 | tail -30
```

Expected: all existing tests pass, no regressions.

- [ ] **Step 6: Commit**

```bash
git add backend/app/routers/opportunities.py backend/tests/test_content.py
git commit -m "feat: scan trigger now runs Reddit and Quora scanners in parallel"
```

---

### Task 6: Frontend — rename draft button, ADD scan button, "no gaps" error message

**Files:**
- Modify: `frontend/app/content/page.tsx`
- Modify: `frontend/components/content/ContentTabPanels.tsx`

> **Important context:** There is NO existing scan trigger button in `content/page.tsx`. The right panel only has a passive `"Opportunity scan: {last_scan_at}"` text display around line 2658. This task must ADD a new "Regenerate Live Opportunities" button there, plus import `triggerScan` and add a `scanning` state variable. The "Generate Drafts Now" → "Regenerate Drafts" rename is straightforward.

- [ ] **Step 1: Add `triggerScan` import + `scanning` state in `frontend/app/content/page.tsx`**

Add `triggerScan` to the existing `@/lib/api` import block (around line 30):

```tsx
// Before:
import {
  getBrand,
  getDrafts,
  updateDraft,
  deleteDraft,
  generateDraft,
  getOpportunities,
  dismissOpportunity,
  draftOpportunity,
  generateNow,
  getDraftStatus,
  getBrandProfile,
  getContentSettings,
  updateContentSettings,
  getDraftAttributions,
  getQuoraQuestions,
// After:
import {
  getBrand,
  getDrafts,
  updateDraft,
  deleteDraft,
  generateDraft,
  getOpportunities,
  dismissOpportunity,
  draftOpportunity,
  generateNow,
  getDraftStatus,
  getBrandProfile,
  getContentSettings,
  updateContentSettings,
  getDraftAttributions,
  getQuoraQuestions,
  triggerScan,
```

Then add a `scanning` state variable near the other boolean state declarations (search for `const [generating, setGenerating]`):

```tsx
// Find this line:
  const [generating, setGenerating] = useState(false);
// Add after it:
  const [scanning, setScanning] = useState(false);
```

- [ ] **Step 2: Add `handleScanNow` handler in `frontend/app/content/page.tsx`**

Find `handleGenerateNow` function. Add the scan handler just before or after it:

```tsx
  const handleScanNow = useCallback(async () => {
    if (!selectedBrandId || scanning) return;
    setScanning(true);
    try {
      await triggerScan(selectedBrandId);
      // Refresh opportunities after triggering scan
      const ops = await getOpportunities(selectedBrandId);
      setOpportunities(ops);
    } catch (err: unknown) {
      console.error('Scan trigger failed:', err);
    } finally {
      setScanning(false);
    }
  }, [selectedBrandId, scanning]);
```

- [ ] **Step 3: Replace passive "Opportunity scan" display with a button**

Find the passive display around line 2658:

```tsx
// Before:
                <div className="border-t border-[rgba(255,255,255,0.06)] pt-2.5">
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-[#475569]">Opportunity scan</span>
                    <span className="text-xs text-[#475569]">
                      {draftStatus?.last_scan_at
                        ? relativeTime(draftStatus.last_scan_at)
                        : 'Daily'}
                    </span>
                  </div>
                </div>
// After:
                <div className="border-t border-[rgba(255,255,255,0.06)] pt-2.5 space-y-2">
                  <button
                    onClick={handleScanNow}
                    disabled={scanning || !selectedBrandId}
                    className="w-full flex items-center justify-center gap-2 px-4 py-2 rounded-lg bg-[rgba(99,102,241,0.12)] hover:bg-[rgba(99,102,241,0.22)] border border-[rgba(99,102,241,0.30)] text-[#818CF8] text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
                  >
                    {scanning ? (
                      <><Loader2 className="w-4 h-4 animate-spin" /> Scanning…</>
                    ) : (
                      <><RefreshCw className="w-4 h-4" /> Regenerate Live Opportunities</>
                    )}
                  </button>
                  <p className="text-[11px] text-[#475569] text-center">
                    {draftStatus?.last_scan_at
                      ? `Last scan: ${relativeTime(draftStatus.last_scan_at)}`
                      : 'Replaces all opportunities with a fresh scan'}
                  </p>
                </div>
```

- [ ] **Step 4: Rename draft button in `frontend/app/content/page.tsx`**

Find the "Generate Drafts Now" label in the right-panel button (search for `Generate Drafts Now`):

```tsx
// Before:
          {generating ? 'Generating…' : 'Generate Drafts Now'}
// After:
          {generating ? 'Generating…' : 'Regenerate Drafts'}
```

Find the helper text below the draft button (search for `Fills drafts to 20`):

```tsx
// Before:
            {generating ? 'This takes ~20 seconds — drafts will all appear when ready' : 'Fills drafts to 20 and scans for new opportunities'}
// After:
            {generating ? 'This takes ~20 seconds — drafts will all appear when ready' : 'Replaces all existing drafts with a fresh set of up to 20'}
```

- [ ] **Step 5: Improve "no content gaps" error message in `handleGenerateNow`**

Find the catch block in `handleGenerateNow`:

```tsx
  } catch (err: unknown) {
    const raw = parseApiError(err, 'Draft generation failed.');
    const msg = raw.toLowerCase().includes('no content gaps')
      ? 'No content gaps found yet. Run a tracking scan first to identify gaps, then try again.'
      : raw;
    setGenerateError(msg);
  } finally {
```

- [ ] **Step 6: Rename empty-state button in `frontend/components/content/ContentTabPanels.tsx`**

Find the empty-state button in `DraftsPanel` (search for `Generate Drafts Now`):

```tsx
// Before:
                  {generating ? 'Generating…' : 'Generate Drafts Now'}
// After:
                  {generating ? 'Generating…' : 'Regenerate Drafts'}
```

Find the description text (search for `Use "Generate Drafts Now"`):

```tsx
// Before:
          description={platformFilter !== 'all' ? 'Try switching to "All" or generate new drafts.' : 'Use "Generate Drafts Now" or request a custom draft to get started.'}
// After:
          description={platformFilter !== 'all' ? 'Try switching to "All" or generate new drafts.' : 'Use "Regenerate Drafts" or request a custom draft to get started.'}
```

- [ ] **Step 7: Verify no TypeScript errors**

```bash
cd frontend && npm run build 2>&1 | tail -20
```

Expected: build succeeds with no errors.

- [ ] **Step 8: Commit**

```bash
git add frontend/app/content/page.tsx frontend/components/content/ContentTabPanels.tsx
git commit -m "feat: add Regenerate Live Opportunities button; rename Generate to Regenerate; show helpful no-gaps error"
```

---

## Verification

After all tasks complete, verify end-to-end:

```bash
# Backend tests
cd backend && source venv/bin/activate && pytest tests/test_reddit_scanner.py tests/test_quora_scanner.py tests/test_content.py -v

# Frontend build
cd frontend && npm run build
```

The full test suite should show no regressions:
```bash
cd backend && source venv/bin/activate && pytest tests/ --tb=short 2>&1 | tail -5
```
Expected: all tests pass.
