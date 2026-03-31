# Universal Reddit Scanner Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace hardcoded industry/subreddit mapping in `reddit_scanner_service.py` with direct Reddit global search by prompt text, making the scanner work for any brand.

**Architecture:** Remove `_INDUSTRY_MAP`, `_DETECTION_RULES`, `_detect_industries()`, `_relevant_subreddits()`, `get_relevant_subreddits()`, `_promo_class()`, and related constants. Replace with `_BLOCKED_SUBS` + `_is_blocked_subreddit()`. Update `_score_thread()` to use comment count and graduated recency. Rewrite the scan loop to issue one global Reddit search per prompt text plus one for the brand name — no subreddit pre-selection.

**Tech Stack:** Python 3.11, httpx (async), Reddit public JSON API (`/search.json`), pytest + unittest.mock

---

## File Map

- **Modify:** `backend/app/services/reddit_scanner_service.py`
  - Delete: `_INDUSTRY_MAP`, `_DETECTION_RULES`, `_detect_industries()`, `_relevant_subreddits()`, `get_relevant_subreddits()`, `_promo_class()`, `_PROMO_RESTRICTED_SUBS`, `_ALLOWED_SIGNALS`, `_RESTRICTED_SIGNALS`
  - Add: `_BLOCKED_SUBS`, `_is_blocked_subreddit()`
  - Update: `_score_thread()` — replace `upvotes` param with `num_comments`, add `brand_name` param, fix recency, add brand-mention bonus
  - Update: `scan_brand_opportunities()` — remove industry-map block, replace subreddit loop with global search per prompt + brand name query
- **Create:** `backend/tests/test_reddit_scanner.py`

---

### Task 1: Tests for `_is_blocked_subreddit` and updated `_score_thread`

**Files:**
- Create: `backend/tests/test_reddit_scanner.py`

These tests are written against the NEW signatures/behaviour. They will fail until Task 2 is done.

- [ ] **Step 1: Create the test file**

```python
# backend/tests/test_reddit_scanner.py
import math
import time
import pytest
from app.services.reddit_scanner_service import (
    _is_blocked_subreddit,
    _score_thread,
)


# ── _is_blocked_subreddit ─────────────────────────────────────────────────────

def test_blocked_medical_sub():
    assert _is_blocked_subreddit("depression") is True

def test_blocked_nsfw_signal_in_name():
    assert _is_blocked_subreddit("nsfw_something") is True

def test_blocked_news_mega_sub():
    assert _is_blocked_subreddit("worldnews") is True

def test_blocked_askreddit():
    assert _is_blocked_subreddit("askreddit") is True

def test_unblocked_saas_sub():
    assert _is_blocked_subreddit("SaaS") is False

def test_unblocked_fitness_sub():
    assert _is_blocked_subreddit("fitness") is False

def test_blocked_case_insensitive():
    assert _is_blocked_subreddit("Depression") is True


# ── _score_thread recency ─────────────────────────────────────────────────────

def _ts(days_ago: float) -> float:
    return time.time() - days_ago * 86400


def test_score_recent_post_higher_than_old():
    title = "how does machine learning detect patterns in data"
    prompt = "how does machine learning detect patterns"
    score_new = _score_thread(title, "", prompt, _ts(3), num_comments=5, brand_name="Acme")
    score_old = _score_thread(title, "", prompt, _ts(75), num_comments=5, brand_name="Acme")
    assert score_new > score_old

def test_score_old_post_not_zero():
    """No hard age cutoff — old evergreen threads still get a score if relevant."""
    title = "comparing saas tools for project management workflow"
    prompt = "comparing saas tools for project management"
    score = _score_thread(title, "", prompt, _ts(100), num_comments=50, brand_name="Acme")
    # Should not be zero (relevance + engagement carry it)
    assert score > 0


# ── _score_thread engagement ──────────────────────────────────────────────────

def test_score_more_comments_higher():
    title = "what are the best tools for tracking brand visibility online"
    prompt = "what are the best tools for tracking brand visibility"
    score_busy = _score_thread(title, "", prompt, _ts(10), num_comments=100, brand_name="Acme")
    score_quiet = _score_thread(title, "", prompt, _ts(10), num_comments=1, brand_name="Acme")
    assert score_busy > score_quiet

def test_score_zero_comments_not_filtered():
    """0-comment posts pass scoring — first-mover opportunity."""
    title = "what are the best tools for tracking brand visibility online"
    prompt = "what are the best tools for tracking brand visibility"
    score = _score_thread(title, "", prompt, _ts(2), num_comments=0, brand_name="Acme")
    # Relevance + recency alone should push it above 0
    assert score > 0


# ── _score_thread brand mention bonus ─────────────────────────────────────────

def test_brand_mention_in_title_scores_higher():
    title_with = "acme is one of the best tools for tracking brand visibility online"
    title_without = "what are the best tools for tracking brand visibility online"
    prompt = "what are the best tools for tracking brand visibility"
    ts = _ts(5)
    score_with = _score_thread(title_with, "", prompt, ts, num_comments=10, brand_name="Acme")
    score_without = _score_thread(title_without, "", prompt, ts, num_comments=10, brand_name="Acme")
    assert score_with > score_without

def test_brand_mention_in_body_scores_higher():
    title = "what are the best tools for tracking brand visibility online"
    body_with = "I've been using Acme for a few months"
    body_without = ""
    prompt = "what are the best tools for tracking brand visibility"
    ts = _ts(5)
    score_with = _score_thread(title, body_with, prompt, ts, num_comments=10, brand_name="Acme")
    score_without = _score_thread(title, body_without, prompt, ts, num_comments=10, brand_name="Acme")
    assert score_with > score_without


# ── _score_thread existing filters still work ─────────────────────────────────

def test_fiction_sub_scores_zero():
    title = "how does machine learning detect patterns"
    score = _score_thread(title, "", "machine learning detect patterns", _ts(1),
                          num_comments=10, brand_name="Acme", subreddit="nosleep")
    assert score == 0.0

def test_spam_title_scores_zero():
    title = "Top 10 Best SaaS Tools for 2025"
    score = _score_thread(title, "", "saas tools for project management", _ts(1),
                          num_comments=10, brand_name="Acme")
    assert score == 0.0

def test_low_relevance_scores_zero():
    """Post that shares fewer than 2 prompt words returns 0."""
    title = "cats and dogs are great pets"
    score = _score_thread(title, "", "what saas tools help with brand tracking analytics", _ts(1),
                          num_comments=20, brand_name="Acme")
    assert score == 0.0
```

- [ ] **Step 2: Run tests — confirm they all fail with ImportError or AttributeError**

```bash
cd backend && source venv/bin/activate
pytest tests/test_reddit_scanner.py -v 2>&1 | head -40
```

Expected: ERRORS — `_is_blocked_subreddit` not importable yet, `_score_thread` missing `num_comments`/`brand_name` params.

- [ ] **Step 3: Commit failing tests**

```bash
git add backend/tests/test_reddit_scanner.py
git commit -m "test: failing tests for universal reddit scanner"
```

---

### Task 2: Replace industry mapping; update `_is_blocked_subreddit` and `_score_thread`

**Files:**
- Modify: `backend/app/services/reddit_scanner_service.py`

- [ ] **Step 1: Delete the industry-mapping block (lines 29–254)**

Open `backend/app/services/reddit_scanner_service.py`. Delete everything from `_INDUSTRY_MAP: dict[str, list[str]] = {` through the end of `get_relevant_subreddits()` — that is, the following blocks in order:
- `_INDUSTRY_MAP` dict
- `_DETECTION_RULES` list
- `_detect_industries()` function
- `_PROMO_RESTRICTED_SUBS` frozenset
- `_RESTRICTED_SIGNALS` tuple
- `_ALLOWED_SIGNALS` tuple
- `_promo_class()` function
- `_relevant_subreddits()` function
- `get_relevant_subreddits()` function

After deletion, the file should jump straight from the module docstring + imports to `_STOP`, `_FICTION_SUBS`, etc.

- [ ] **Step 2: Add `_BLOCKED_SUBS` and `_is_blocked_subreddit()` immediately after the imports block**

Insert after `logger = logging.getLogger(__name__)` and before `_REDDIT_BASE`:

```python
# ── Blocked subreddits ────────────────────────────────────────────────────────
# Posts from these communities are filtered out regardless of relevance score.
# Covers: medical/mental-health support, relationship advice, news mega-subs,
# legal advice, generic catch-alls, and fiction/NSFW communities.

_BLOCKED_SUBS: frozenset[str] = frozenset({
    # Medical / mental health support
    "cancer", "depression", "anxiety", "bipolar", "ptsd", "addiction",
    "chronicpain", "grief", "survivorsofabuse", "mentalhealth", "suicidewatch",
    "askdocs", "medical", "medicaladvice", "nursing", "pharmacy",
    "mentalhealth", "canceremotionalsupport", "breastcancer", "prostatecancer",
    "lungcancer", "leukemia", "chronicillness", "invisibleillness",
    # Relationship / personal advice
    "relationships", "relationship_advice", "amitheasshole", "tifu",
    "confessions", "legaladvice", "legaladviceuk", "legaladviceeurope",
    "offmychest", "trueoffmychest", "rant",
    # News / politics / mega-subs
    "worldnews", "news", "politics", "conspiracy", "nottheonion",
    "askreddit", "todayilearned", "explainlikeimfive", "changemyview",
    "nostupidquestions", "iama", "casualconversation",
    # Generic / low-signal
    "mildlyinteresting", "interestingasfuck", "damnthatsinteresting",
    "facepalm", "therewasanattempt", "nextfuckinglevel",
})

# Signal words in subreddit *names* that indicate NSFW/harmful content
_BLOCKED_SUB_SIGNALS: tuple[str, ...] = (
    "nsfw", "porn", "gore", "xxx", "nude", "fetish", "crisis",
    "selfharm", "suicide", "rape", "abuse",
)


def _is_blocked_subreddit(subreddit: str) -> bool:
    """Return True if this subreddit should be excluded from opportunities."""
    lower = subreddit.lower()
    if lower in _BLOCKED_SUBS:
        return True
    return any(sig in lower for sig in _BLOCKED_SUB_SIGNALS)
```

- [ ] **Step 3: Update `_score_thread` signature and body**

Replace the existing `_score_thread` function (from `def _score_thread(` through `return round(score * 100.0, 1)`) with:

```python
def _score_thread(
    title: str,
    body: str,
    prompt_text: str,
    created_utc: float,
    num_comments: int = 0,
    brand_name: str = "",
    subreddit: str = "",
) -> float:
    # Fiction / entertainment subs are never valid opportunities
    if subreddit.lower() in _FICTION_SUBS:
        return 0.0

    # SEO link-farm / promotional subreddits
    if _SPAM_SUB_RE.search(subreddit):
        return 0.0

    # Listicle / promotional spam titles
    if _SPAM_TITLE_RE.search(title):
        return 0.0

    # Personal support stories aren't actionable content opportunities
    if _is_personal_story(title, body):
        return 0.0

    combined = (title + " " + body).lower()
    clean_prompt = re.sub(r"[^a-z0-9\s]", "", prompt_text.lower())
    prompt_words = {w for w in clean_prompt.split() if w not in _STOP and len(w) > 2}

    if not prompt_words:
        return 0.0

    # Whole-word matching to avoid false substring hits (e.g. "can" in "scanner")
    matches = sum(
        1 for w in prompt_words
        if re.search(r"\b" + re.escape(w) + r"\b", combined)
    )
    relevance = min(1.0, matches / len(prompt_words))

    # Hard minimum: at least 45% keyword overlap AND at least 2 matches
    if relevance < 0.45 or matches < 2:
        return 0.0

    # Recency — graduated, no hard cutoff (old evergreen threads still score)
    now_ts = datetime.now(timezone.utc).timestamp()
    age_days = (now_ts - created_utc) / 86400
    if age_days <= 7:
        recency = 1.0
    elif age_days <= 30:
        recency = 0.7
    elif age_days <= 60:
        recency = 0.4
    elif age_days <= 90:
        recency = 0.2
    else:
        recency = 0.05  # Very old but not zero — evergreen threads still have value

    # Engagement — log scale on comment count (saturates at ~200 comments)
    import math
    engagement = min(1.0, math.log10(num_comments + 1) / math.log10(201)) if num_comments >= 0 else 0.0

    # Brand mention bonus
    brand_bonus = 10.0 if brand_name and brand_name.lower() in combined else 0.0

    score = relevance * 50.0 + recency * 20.0 + engagement * 20.0 + brand_bonus
    return round(min(score, 100.0), 1)
```

- [ ] **Step 4: Run tests — confirm `_is_blocked_subreddit` and `_score_thread` tests pass**

```bash
pytest tests/test_reddit_scanner.py -v -k "blocked or score"
```

Expected: all 14 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/reddit_scanner_service.py
git commit -m "refactor: replace industry map with _BLOCKED_SUBS; update _score_thread to use comments + graduated recency"
```

---

### Task 3: Rewrite `scan_brand_opportunities` loop

**Files:**
- Modify: `backend/app/services/reddit_scanner_service.py` — `scan_brand_opportunities()` function

- [ ] **Step 1: Write tests for the scan loop**

Add to `backend/tests/test_reddit_scanner.py`:

```python
import asyncio
from unittest.mock import AsyncMock, patch


def _make_post(permalink, title, subreddit="SaaS", created_utc=None, num_comments=5, selftext=""):
    return {
        "permalink": permalink,
        "title": title,
        "subreddit": subreddit,
        "created_utc": created_utc or (time.time() - 86400),
        "num_comments": num_comments,
        "selftext": selftext,
        "score": 10,
    }


def _reddit_response(*posts):
    """Wrap posts in the Reddit listing envelope."""
    return {"data": {"children": [{"data": p} for p in posts]}}


@pytest.mark.asyncio
async def test_scan_uses_prompt_text_as_search_query(tmp_db):
    """Global search URL must contain the prompt text."""
    from app.services import reddit_scanner_service

    fetched_urls: list[str] = []

    async def fake_fetch(url: str):
        fetched_urls.append(url)
        return _reddit_response()

    brand_id = await tmp_db.create_brand_with_prompt(
        name="Acme", prompt="what is the best project management saas tool"
    )

    with patch.object(reddit_scanner_service, "_fetch", side_effect=fake_fetch):
        await reddit_scanner_service.scan_brand_opportunities(brand_id)

    assert any("project+management" in u or "project%20management" in u for u in fetched_urls), \
        f"No query contained prompt text. URLs: {fetched_urls}"
    # Global search (no restrict_sr) must be used
    assert any("reddit.com/search.json" in u for u in fetched_urls)


@pytest.mark.asyncio
async def test_brand_name_is_also_searched(tmp_db):
    """Brand name must appear as a separate search query."""
    from app.services import reddit_scanner_service

    fetched_urls: list[str] = []

    async def fake_fetch(url: str):
        fetched_urls.append(url)
        return _reddit_response()

    brand_id = await tmp_db.create_brand_with_prompt(
        name="Rhythm", prompt="what is the best project management saas tool"
    )

    with patch.object(reddit_scanner_service, "_fetch", side_effect=fake_fetch):
        await reddit_scanner_service.scan_brand_opportunities(brand_id)

    assert any("Rhythm" in u or "rhythm" in u.lower() for u in fetched_urls), \
        f"Brand name not in any URL. URLs: {fetched_urls}"


@pytest.mark.asyncio
async def test_blocked_subreddit_not_stored(tmp_db):
    """Posts from blocked subreddits must not be stored."""
    from app.services import reddit_scanner_service

    relevant_post = _make_post(
        "/r/depression/comments/abc/post/",
        "what is the best project management saas tool for teams",
        subreddit="depression",
        num_comments=10,
    )

    async def fake_fetch(url: str):
        return _reddit_response(relevant_post)

    brand_id = await tmp_db.create_brand_with_prompt(
        name="Acme", prompt="what is the best project management saas tool"
    )

    with patch.object(reddit_scanner_service, "_fetch", side_effect=fake_fetch):
        count = await reddit_scanner_service.scan_brand_opportunities(brand_id)

    assert count == 0


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

    with patch.object(reddit_scanner_service, "_fetch", side_effect=fake_fetch):
        count = await reddit_scanner_service.scan_brand_opportunities(brand_id)

    assert count >= 1


@pytest.mark.asyncio
async def test_deduplication(tmp_db):
    """Same URL returned by two queries is stored only once."""
    from app.services import reddit_scanner_service

    post = _make_post(
        "/r/SaaS/comments/xyz/post/",
        "what is the best project management saas tool for remote teams",
        subreddit="SaaS",
        num_comments=15,
    )

    async def fake_fetch(url: str):
        return _reddit_response(post)

    brand_id = await tmp_db.create_brand_with_prompt(
        name="Acme", prompt="what is the best project management saas tool"
    )

    with patch.object(reddit_scanner_service, "_fetch", side_effect=fake_fetch):
        count = await reddit_scanner_service.scan_brand_opportunities(brand_id)

    # Multiple queries all return the same URL — should store it once
    assert count == 1


@pytest.mark.asyncio
async def test_works_with_no_industry_match(tmp_db):
    """A brand in an unmapped industry (e.g. music) must not return 0 due to missing subreddits."""
    from app.services import reddit_scanner_service

    post = _make_post(
        "/r/WeAreTheMusicMakers/comments/abc/post/",
        "best tools for tracking music streaming royalties and visibility analytics",
        subreddit="WeAreTheMusicMakers",
        num_comments=8,
    )

    async def fake_fetch(url: str):
        return _reddit_response(post)

    brand_id = await tmp_db.create_brand_with_prompt(
        name="Rhythm",
        prompt="best tools for tracking music streaming royalties and visibility analytics",
    )

    with patch.object(reddit_scanner_service, "_fetch", side_effect=fake_fetch):
        count = await reddit_scanner_service.scan_brand_opportunities(brand_id)

    # Must not skip due to missing industry — should attempt scan and find the post
    assert count >= 1
```

- [ ] **Step 2: Add `tmp_db` fixture to `tests/conftest.py`**

Open `backend/tests/conftest.py` and add this fixture after the existing `db` fixture:

```python
class _TmpDb:
    """Minimal async helper for reddit scanner integration tests."""

    async def create_brand_with_prompt(self, name: str, prompt: str) -> int:
        from app.models import Brand, Prompt, User
        from app.database import AsyncSessionLocal
        import secrets
        async with AsyncSessionLocal() as session:
            user = User(
                email=f"test_{secrets.token_hex(4)}@example.com",
                password_hash="x",
                email_verified=1,
            )
            session.add(user)
            await session.flush()
            brand = Brand(name=name, slug=f"{name.lower()}-{secrets.token_hex(4)}", user_id=user.id)
            session.add(brand)
            await session.flush()
            p = Prompt(brand_id=brand.id, text=prompt)
            session.add(p)
            await session.commit()
            return brand.id


@pytest.fixture
def tmp_db():
    return _TmpDb()
```

- [ ] **Step 3: Run the new integration tests — confirm they fail for the right reason**

```bash
pytest tests/test_reddit_scanner.py -v -k "scan" 2>&1 | head -50
```

Expected: Tests fail because `scan_brand_opportunities` still uses the industry-map path and returns 0 for unrecognised industries, OR fails import. The `test_works_with_no_industry_match` test must fail.

- [ ] **Step 4: Rewrite the search section of `scan_brand_opportunities`**

In `scan_brand_opportunities`, replace the block from `prompt_texts = [p.text for p in prompts]` through `if not subreddits: ... return 0` (and the related logging) with:

```python
        prompt_texts = [p.text for p in prompts]

        logger.info(
            "Reddit scanner: brand=%r prompts=%d",
            brand.name, len(prompts),
        )
```

Then replace the inner per-prompt loop (from `for prompt in prompts[:5]:` through the end of the nested for-loop that adds `opp` to the session) with:

```python
        # Build search queries: one per prompt + one for the brand name itself
        queries: list[tuple[str, int | None]] = [
            (prompt.text, prompt.id) for prompt in prompts[:6]
        ]
        queries.append((brand.name, None))  # brand-name query has no associated prompt

        all_candidates: list[tuple[dict, int | None]] = []  # (post_data, prompt_id)

        for query_text, prompt_id in queries:
            q = urllib.parse.quote(query_text)
            url = (
                f"{_REDDIT_BASE}/search.json"
                f"?q={q}&sort=relevance&t=month&limit=25&type=link"
            )
            data = await _fetch(url)
            for post in _extract_posts(data):
                all_candidates.append((post, prompt_id))
            await asyncio.sleep(1.0)

        # Deduplicate by permalink across all queries
        seen_permalinks: set[str] = set()
        deduped: list[tuple[dict, int | None]] = []
        for post, prompt_id in all_candidates:
            pl = post.get("permalink", "")
            if pl and pl not in seen_permalinks:
                seen_permalinks.add(pl)
                deduped.append((post, prompt_id))

        # Score and store
        # Use first prompt text as the scoring reference for brand-name query results
        default_prompt_text = prompts[0].text if prompts else ""

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

            # For brand-name query results use first prompt as scoring reference
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
            if score < 55.0:
                continue

            posted_dt = (
                datetime.fromtimestamp(created_utc, tz=timezone.utc).replace(tzinfo=None)
                if created_utc else None
            )

            opp = ContentOpportunity(
                brand_id=brand_id,
                platform="reddit",
                thread_url=thread_url,
                thread_title=title[:500],
                subreddit=subreddit_name[:100],
                body_preview=body[:500] if body else None,
                posted_at=posted_dt,
                relevance_score=score,
                prompt_id=prompt_id,
                status="new",
            )
            db.add(opp)
            existing_urls.add(thread_url)
            new_count += 1
```

- [ ] **Step 5: Remove the now-unused `month_ago_ts` variable**

Find and delete this line (it was the old age cutoff):
```python
        month_ago_ts = datetime.now(timezone.utc).timestamp() - 30 * 86400
```

- [ ] **Step 6: Remove `Optional` import if no longer needed**

Check the top of the file — `Optional` was used only by `_relevant_subreddits`. If it no longer appears elsewhere, remove it from the `from typing import Optional` import (or remove the import line entirely if it was the only imported name).

- [ ] **Step 7: Run all scanner tests**

```bash
pytest tests/test_reddit_scanner.py -v
```

Expected: all tests PASS.

- [ ] **Step 8: Run the full test suite to check for regressions**

```bash
pytest tests/ -v --tb=short 2>&1 | tail -30
```

Expected: existing tests unaffected (the public API of `scan_brand_opportunities` and `scan_all_brands` is unchanged).

- [ ] **Step 9: Commit**

```bash
git add backend/app/services/reddit_scanner_service.py backend/tests/test_reddit_scanner.py backend/tests/conftest.py
git commit -m "feat: universal reddit scanner — replace industry map with direct global search"
```
