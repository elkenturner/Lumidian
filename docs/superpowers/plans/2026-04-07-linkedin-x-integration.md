# LinkedIn & X Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add LinkedIn and X as full content platforms (opportunity scanning via Serper.dev, AI-drafted content, gap analysis) gated to Pro tier.

**Architecture:** Two new Serper-based scanner services follow the existing Quora scanner pattern. Six new platform specs slot into the existing drafting pipeline. Pro-only gating at the router/dependency layer. Balanced opportunity interleaving in the feed. No schema changes — existing models support arbitrary platform strings.

**Tech Stack:** Python/FastAPI (backend), Serper.dev API, Claude API (drafting), Next.js/React/Tailwind (frontend)

**Spec:** `docs/superpowers/specs/2026-04-07-linkedin-x-integration-design.md`

**Branch:** `feature/linkedin-x-integration` (create from main before starting)

---

## File Map

### New files
| File | Responsibility |
|------|---------------|
| `backend/app/services/serper_search_service.py` | Generic Serper.dev search (site-scoped) — shared by LinkedIn and X scanners |
| `backend/app/services/linkedin_scanner_service.py` | LinkedIn opportunity scanner |
| `backend/app/services/x_scanner_service.py` | X/Twitter opportunity scanner |
| `backend/tests/test_linkedin_scanner.py` | LinkedIn scanner unit + integration tests |
| `backend/tests/test_x_scanner.py` | X scanner unit + integration tests |
| `backend/tests/test_platform_specs.py` | Platform spec completeness tests |
| `backend/tests/test_pipeline_x.py` | X character enforcement + thread parsing tests |
| `backend/tests/test_pro_gate.py` | Pro-only platform gating tests |

### Modified files
| File | What changes |
|------|-------------|
| `backend/app/services/drafting/platforms.py` | Add 6 platform specs, update CONTENT_PLATFORMS, PLATFORM_MAX_TOKENS |
| `backend/app/services/drafting/prompts.py` | Add LinkedIn/X branches in `build_prompt()` |
| `backend/app/services/drafting/pipeline.py` | Add `enforce_x_char_limit()`, `parse_x_thread()`, update `extract_title_and_body()` |
| `backend/app/services/drafting/__init__.py` | Re-export new pipeline functions |
| `backend/app/services/drafting_service.py` | Platform mapping in `generate_gap_draft()` and `generate_opportunity_draft()` |
| `backend/app/services/gap_analysis_service.py` | Add linkedin/x to `PLATFORMS` |
| `backend/app/dependencies.py` | Add `PRO_ONLY_PLATFORMS`, `require_pro_for_platform()` |
| `backend/app/routers/opportunities.py` | Balanced interleaving, Pro gate on LinkedIn/X |
| `backend/app/routers/content.py` | Pro gate on LinkedIn/X draft generation |
| `backend/app/scheduler.py` | Add LinkedIn/X scanner jobs |
| `frontend/components/PlatformBadge.tsx` | Add LinkedIn/X styles and labels |
| `frontend/app/content/page.tsx` | Draft modal sub-selectors, X thread display, Pro lock UI |

---

## Task 1: Platform Specs

**Files:**
- Modify: `backend/app/services/drafting/platforms.py`
- Create: `backend/tests/test_platform_specs.py`

- [ ] **Step 1: Write tests for new platform specs**

Create `backend/tests/test_platform_specs.py`:

```python
"""Tests for LinkedIn and X platform spec completeness."""
from app.services.drafting.platforms import (
    ALL_PLATFORMS,
    CONTENT_PLATFORMS,
    PLATFORM_MAX_TOKENS,
    PLATFORM_SPECS,
)

REQUIRED_KEYS = {"format", "word_range", "tone", "rules", "posting_tip"}


def test_linkedin_article_spec_exists():
    assert "linkedin_article" in PLATFORM_SPECS
    spec = PLATFORM_SPECS["linkedin_article"]
    assert REQUIRED_KEYS.issubset(spec.keys())
    assert spec["format"] == "article"
    lo, hi = spec["word_range"]
    assert 400 <= lo <= 800 and 1000 <= hi <= 2000


def test_linkedin_post_spec_exists():
    assert "linkedin_post" in PLATFORM_SPECS
    spec = PLATFORM_SPECS["linkedin_post"]
    assert REQUIRED_KEYS.issubset(spec.keys())
    assert spec["format"] == "post"


def test_linkedin_reply_spec_exists():
    assert "linkedin_reply" in PLATFORM_SPECS
    spec = PLATFORM_SPECS["linkedin_reply"]
    assert REQUIRED_KEYS.issubset(spec.keys())
    assert spec["format"] == "reply"


def test_x_thread_spec_exists():
    assert "x_thread" in PLATFORM_SPECS
    spec = PLATFORM_SPECS["x_thread"]
    assert REQUIRED_KEYS.issubset(spec.keys())
    assert spec["format"] == "thread"


def test_x_post_spec_exists():
    assert "x_post" in PLATFORM_SPECS
    spec = PLATFORM_SPECS["x_post"]
    assert REQUIRED_KEYS.issubset(spec.keys())
    assert spec["format"] == "post"


def test_x_reply_spec_exists():
    assert "x_reply" in PLATFORM_SPECS
    spec = PLATFORM_SPECS["x_reply"]
    assert REQUIRED_KEYS.issubset(spec.keys())
    assert spec["format"] == "reply"


def test_content_platforms_includes_linkedin_and_x():
    assert "linkedin" in CONTENT_PLATFORMS
    assert "x" in CONTENT_PLATFORMS


def test_content_platforms_excludes_reply_variants():
    assert "linkedin_reply" not in CONTENT_PLATFORMS
    assert "x_reply" not in CONTENT_PLATFORMS
    assert "reddit_reply" not in CONTENT_PLATFORMS


def test_all_platforms_includes_reply_variants():
    assert "linkedin_reply" in ALL_PLATFORMS
    assert "x_reply" in ALL_PLATFORMS


def test_max_tokens_set_for_all_new_specs():
    for key in ("linkedin_article", "linkedin_post", "linkedin_reply",
                "x_thread", "x_post", "x_reply"):
        assert key in PLATFORM_MAX_TOKENS, f"Missing max_tokens for {key}"
        assert PLATFORM_MAX_TOKENS[key] > 0
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && python -m pytest tests/test_platform_specs.py -v`
Expected: FAIL — new specs don't exist yet.

- [ ] **Step 3: Add LinkedIn and X specs to platforms.py**

In `backend/app/services/drafting/platforms.py`, add these entries to `PLATFORM_SPECS` after the `"wikipedia"` entry:

```python
    "linkedin_article": {
        "format": "article",
        "word_range": (600, 1500),
        "tone": "long-form editorial, professional thought leadership — structured, authoritative, written by a respected industry voice",
        "rules": [
            "Open with a strong hook in the first 1-2 sentences — a surprising stat, a bold claim, or a direct answer to the target query",
            "Structure with short focused sections separated by blank lines — headers are acceptable on LinkedIn Articles",
            "The brand name must appear at least once, in a concrete context (a claim, an example, a data point) — not as a pitch",
            "Every major claim must be backed by specific data, examples, or evidence from the Brand Profile",
            "Where the Brand Profile includes publications, cite them naturally (e.g. 'A study published in...')",
            "End with a specific, actionable takeaway — not a generic conclusion",
            "No marketing language, no superlatives, no calls to action to 'follow' or 'like'",
            "1-3 relevant hashtags at the very end, on their own line",
            "Content must read as written by a knowledgeable industry professional, not by a brand spokesperson",
        ],
        "disclaimer": None,
        "posting_tip": "Publish as a LinkedIn Article (not a post) for Google indexation — articles are crawled by search engines.",
    },
    "linkedin_post": {
        "format": "post",
        "word_range": (80, 250),
        "tone": "professional but conversational — like a respected colleague sharing an insight",
        "rules": [
            "Open with a direct statement or insight — no 'I've been thinking about...' preamble",
            "Write in short paragraphs (1-3 sentences each) with line breaks between them — LinkedIn's feed rewards scannable formatting",
            "Brand mention only if it directly supports the point being made — never forced",
            "No clickbait hooks ('You won't believe...', 'Stop doing this...')",
            "No excessive emoji or formatting gimmicks",
            "1-3 relevant hashtags at the end",
            "Contractions are fine — sound like a person, not a press release",
            "No links unless essential to the point",
        ],
        "disclaimer": None,
        "posting_tip": "Post from your company's LinkedIn page or personal profile.",
    },
    "linkedin_reply": {
        "format": "reply",
        "word_range": (30, 100),
        "tone": "direct, professional, helpful — like replying to a colleague's post",
        "rules": [
            "1-4 sentences only — replies should be direct and add concrete value",
            "Address the specific point or question in the original post",
            "Brand mention only if it directly answers the question being asked",
            "No hedging, no preamble — get to the point immediately",
            "No hashtags in replies",
        ],
        "disclaimer": None,
        "posting_tip": "Reply directly to the original post.",
    },
    "x_thread": {
        "format": "thread",
        "word_range": (150, 500),
        "tone": "narrative, educational — each tweet stands alone but builds toward a point",
        "rules": [
            "Format each tweet on its own line, prefixed with 1/, 2/, etc.",
            "Each tweet must be under 280 characters — hard limit, no exceptions",
            "First tweet must hook — state a surprising fact, a bold claim, or a direct answer to the target query",
            "Each tweet should make sense on its own if read in isolation",
            "The brand name should appear naturally in one tweet (not the first) where it supports the argument",
            "Last tweet should deliver a concrete takeaway or insight — not a generic wrap-up",
            "0-1 hashtags total, in the last tweet only if natural",
            "No 'Thread:' or 'A thread' prefix — just start with the content",
            "Vary tweet length — mix short punchy tweets with longer substantive ones",
        ],
        "disclaimer": None,
        "posting_tip": "Post as a thread from your brand's X account.",
    },
    "x_post": {
        "format": "post",
        "word_range": (15, 65),
        "tone": "concise, punchy, conversational — like a smart person tweeting an insight",
        "rules": [
            "Must be under 280 characters — hard limit",
            "One clear idea per tweet — do not try to pack multiple points",
            "Brand mention only if it is the most natural way to make the point",
            "0-1 hashtags, only if genuinely relevant",
            "No thread numbering (this is a standalone tweet)",
            "Contractions, casual phrasing, and direct address are encouraged",
        ],
        "disclaimer": None,
        "posting_tip": "Post from your brand's X account.",
    },
    "x_reply": {
        "format": "reply",
        "word_range": (10, 50),
        "tone": "direct, helpful, brief — like replying to someone's tweet",
        "rules": [
            "Must be under 280 characters — hard limit",
            "1-2 sentences maximum — direct and to the point",
            "Answer the specific question or add to the specific discussion",
            "Brand mention only if it directly and obviously answers the question",
            "No hashtags in replies",
            "No hedging — be direct",
        ],
        "disclaimer": None,
        "posting_tip": "Reply directly to the tweet.",
    },
```

Update `PLATFORM_MAX_TOKENS`:

```python
PLATFORM_MAX_TOKENS: dict[str, int] = {
    "reddit": 1200,
    "quora": 1800,
    "medium": 3500,
    "wikipedia": 900,
    "linkedin_article": 3000,
    "linkedin_post": 800,
    "linkedin_reply": 400,
    "x_thread": 1500,
    "x_post": 300,
    "x_reply": 200,
}
```

Update the derived lists at the bottom of the file:

```python
ALL_PLATFORMS = list(PLATFORM_SPECS.keys())
CONTENT_PLATFORMS = [p for p in ALL_PLATFORMS if p not in ("reddit_reply", "linkedin_reply", "x_reply")]
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && python -m pytest tests/test_platform_specs.py -v`
Expected: All PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/drafting/platforms.py backend/tests/test_platform_specs.py
git commit -m "feat: add LinkedIn and X platform specs for drafting system"
```

---

## Task 2: X Character Enforcement & Thread Parsing

**Files:**
- Modify: `backend/app/services/drafting/pipeline.py`
- Modify: `backend/app/services/drafting/__init__.py`
- Create: `backend/tests/test_pipeline_x.py`

- [ ] **Step 1: Write tests for X pipeline functions**

Create `backend/tests/test_pipeline_x.py`:

```python
"""Tests for X-specific pipeline functions: character enforcement and thread parsing."""
from app.services.drafting.pipeline import enforce_x_char_limit, parse_x_thread


# ── enforce_x_char_limit ──────────────────────────────────────────────────────

def test_enforce_short_post_unchanged():
    text = "This is a short tweet."
    assert enforce_x_char_limit(text, "x_post") == text


def test_enforce_post_over_280_trimmed():
    text = "A" * 300
    result = enforce_x_char_limit(text, "x_post")
    assert len(result) <= 280


def test_enforce_post_trims_at_word_boundary():
    words = "word " * 60  # 300 chars
    result = enforce_x_char_limit(words.strip(), "x_post")
    assert len(result) <= 280
    assert not result.endswith(" ")


def test_enforce_thread_per_tweet_limit():
    raw = "1/ " + "A" * 300 + "\n2/ Short tweet here"
    result = enforce_x_char_limit(raw, "x_thread")
    tweets = parse_x_thread(result)
    for tweet in tweets:
        assert len(tweet) <= 280


def test_enforce_non_x_platform_unchanged():
    text = "A" * 500
    assert enforce_x_char_limit(text, "reddit") == text


def test_enforce_reply_over_280_trimmed():
    text = "B" * 300
    result = enforce_x_char_limit(text, "x_reply")
    assert len(result) <= 280


# ── parse_x_thread ────────────────────────────────────────────────────────────

def test_parse_thread_numbered():
    raw = "1/ First tweet\n2/ Second tweet\n3/ Third tweet"
    tweets = parse_x_thread(raw)
    assert len(tweets) == 3
    assert tweets[0] == "1/ First tweet"
    assert tweets[1] == "2/ Second tweet"
    assert tweets[2] == "3/ Third tweet"


def test_parse_thread_with_blank_lines():
    raw = "1/ First tweet\n\n2/ Second tweet\n\n3/ Third tweet"
    tweets = parse_x_thread(raw)
    assert len(tweets) == 3


def test_parse_thread_no_numbering_returns_whole():
    raw = "Just a single tweet with no numbering"
    tweets = parse_x_thread(raw)
    assert len(tweets) == 1
    assert tweets[0] == raw


def test_parse_thread_strips_whitespace():
    raw = "1/  First tweet with spaces  \n2/  Second tweet  "
    tweets = parse_x_thread(raw)
    assert tweets[0] == "1/ First tweet with spaces"
    assert tweets[1] == "2/ Second tweet"
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && python -m pytest tests/test_pipeline_x.py -v`
Expected: FAIL — functions don't exist yet.

- [ ] **Step 3: Implement pipeline functions**

Add to `backend/app/services/drafting/pipeline.py` at the end of the file:

```python
# ── X character enforcement ──────────────────────────────────────────────────

_X_CHAR_LIMIT = 280
_X_PLATFORMS = {"x_post", "x_reply", "x_thread"}
_THREAD_NUM_RE = _re.compile(r"^(\d+)/\s*")


def parse_x_thread(raw_text: str) -> list[str]:
    """
    Split raw thread output into individual tweets by N/ numbering.
    Returns a list of tweet strings. If no numbering is found, returns the
    whole text as a single-element list.
    """
    lines = raw_text.strip().splitlines()
    tweets: list[str] = []
    current: list[str] = []

    for line in lines:
        stripped = line.strip()
        if not stripped:
            continue
        if _THREAD_NUM_RE.match(stripped):
            if current:
                tweets.append(" ".join(current).strip())
                current = []
            # Normalize spacing after the number prefix
            normalized = _THREAD_NUM_RE.sub(
                lambda m: f"{m.group(1)}/ ", stripped
            )
            current.append(normalized.strip())
        else:
            current.append(stripped)

    if current:
        tweets.append(" ".join(current).strip())

    return tweets if tweets else [raw_text.strip()]


def _trim_to_limit(text: str, limit: int = _X_CHAR_LIMIT) -> str:
    """Trim text to fit within character limit at a word boundary."""
    if len(text) <= limit:
        return text
    # Leave room for ellipsis
    truncated = text[: limit - 3]
    last_space = truncated.rfind(" ")
    if last_space > limit // 2:
        truncated = truncated[:last_space]
    return truncated.rstrip() + "..."


def enforce_x_char_limit(text: str, platform: str) -> str:
    """
    Enforce the 280-character limit for X platforms.
    - x_post / x_reply: trim the whole text.
    - x_thread: parse into tweets, trim each individually, rejoin.
    - Other platforms: return unchanged.
    """
    if platform not in _X_PLATFORMS:
        return text

    if platform == "x_thread":
        tweets = parse_x_thread(text)
        trimmed = [_trim_to_limit(t) for t in tweets]
        return "\n".join(trimmed)

    return _trim_to_limit(text)
```

Update `extract_title_and_body` — add `linkedin_article` to `title_platforms`:

```python
def extract_title_and_body(raw_text: str, platform: str) -> tuple[str | None, str]:
    title_platforms = {"reddit", "medium", "linkedin_article"}
    # ... rest unchanged
```

- [ ] **Step 4: Update `__init__.py` re-exports**

In `backend/app/services/drafting/__init__.py`, add the new imports:

```python
from .pipeline import (
    clean_wiki_text,
    enforce_x_char_limit,
    estimate_visibility_impact,
    extract_title_and_body,
    parse_wikipedia_draft,
    parse_x_thread,
    remove_hedging,
)
```

And update `__all__`:

```python
__all__ = [
    "PLATFORM_SPECS", "ALL_PLATFORMS", "CONTENT_PLATFORMS", "PLATFORM_MAX_TOKENS",
    "classify_subreddit", "build_subreddit_strategy",
    "build_prompt", "build_wikipedia_prompt", "WIKIPEDIA_SYSTEM_PROMPT",
    "call_claude",
    "remove_hedging", "clean_wiki_text", "parse_wikipedia_draft",
    "extract_title_and_body", "estimate_visibility_impact",
    "enforce_x_char_limit", "parse_x_thread",
]
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd backend && python -m pytest tests/test_pipeline_x.py -v`
Expected: All PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/app/services/drafting/pipeline.py backend/app/services/drafting/__init__.py backend/tests/test_pipeline_x.py
git commit -m "feat: add X character enforcement and thread parsing to pipeline"
```

---

## Task 3: Prompt Builder — LinkedIn/X Branches

**Files:**
- Modify: `backend/app/services/drafting/prompts.py`

- [ ] **Step 1: Add LinkedIn/X branches to build_prompt()**

In `backend/app/services/drafting/prompts.py`, inside `build_prompt()`, find the `INSTRUCTIONS:` section at the end and update the output format block (item 3) to include LinkedIn and X:

```python
    return f"""You are a senior content strategist writing on behalf of a brand. Your goal is to create content that will cause AI systems (ChatGPT, Claude, Perplexity, Gemini) to mention "{brand_name}" when answering the exact query below.

...existing prompt body unchanged...

INSTRUCTIONS:
1. Identify what specific angle or information is MISSING from the current AI responses above.
2. Write content that fills that gap AND directly answers the target query using its exact language.
3. OUTPUT FORMAT — follow exactly:
   - Reddit post: Line 1 = post title (plain text, ≤120 chars, no trailing punctuation, no markdown). Blank line. Then the post body.
   - Medium article: Line 1 = article title (plain text, ≤120 chars, no trailing punctuation, no markdown). Blank line. Then the article body.
   - LinkedIn Article: Line 1 = article title (plain text, ≤120 chars, no trailing punctuation, no markdown). Blank line. Then the article body. Final line = 1-3 hashtags.
   - LinkedIn post: No title line — start directly with the content body. Final line = 1-3 hashtags.
   - LinkedIn reply: No title line — start directly with the reply. 1-4 sentences.
   - X thread: Each tweet on its own line, prefixed with 1/, 2/, etc. Each tweet under 280 characters. 3-7 tweets total.
   - X post: A single tweet under 280 characters. No title, no numbering.
   - X reply: A single reply tweet under 280 characters. No title, no numbering.
   - Quora answer, Wikipedia edit: no title line — start directly with the content.
4. Write the full content body.

⚠ OUTPUT THE CONTENT ONLY. Do not include any analysis, commentary, explanation, or notes about what the content does or why you wrote it. No separators followed by analysis sections. The output must be exactly what would be published — nothing more."""
```

- [ ] **Step 2: Run existing tests to verify nothing breaks**

Run: `cd backend && python -m pytest tests/ -v --timeout=30`
Expected: All existing tests still pass.

- [ ] **Step 3: Commit**

```bash
git add backend/app/services/drafting/prompts.py
git commit -m "feat: add LinkedIn and X output format instructions to prompt builder"
```

---

## Task 4: Pro-Only Gate

**Files:**
- Modify: `backend/app/dependencies.py`
- Create: `backend/tests/test_pro_gate.py`

- [ ] **Step 1: Write tests for the Pro gate**

Create `backend/tests/test_pro_gate.py`:

```python
"""Tests for Pro-only platform gating."""
import pytest
from fastapi import HTTPException

from app.dependencies import is_pro_only_platform, require_pro_for_platform


def test_linkedin_is_pro_only():
    assert is_pro_only_platform("linkedin") is True
    assert is_pro_only_platform("linkedin_article") is True
    assert is_pro_only_platform("linkedin_post") is True
    assert is_pro_only_platform("linkedin_reply") is True


def test_x_is_pro_only():
    assert is_pro_only_platform("x") is True
    assert is_pro_only_platform("x_thread") is True
    assert is_pro_only_platform("x_post") is True
    assert is_pro_only_platform("x_reply") is True


def test_existing_platforms_not_pro_only():
    assert is_pro_only_platform("reddit") is False
    assert is_pro_only_platform("quora") is False
    assert is_pro_only_platform("medium") is False
    assert is_pro_only_platform("wikipedia") is False
    assert is_pro_only_platform("reddit_reply") is False


class _FakeUser:
    def __init__(self, tier: str | None):
        self.subscription_tier = tier
        self.is_admin = False


class _FakeAdmin:
    def __init__(self):
        self.subscription_tier = None
        self.is_admin = True


def test_require_pro_allows_pro_user():
    user = _FakeUser("pro")
    require_pro_for_platform("linkedin", user)  # should not raise


def test_require_pro_blocks_starter_user():
    user = _FakeUser("starter")
    with pytest.raises(HTTPException) as exc_info:
        require_pro_for_platform("linkedin", user)
    assert exc_info.value.status_code == 403


def test_require_pro_blocks_free_user():
    user = _FakeUser(None)
    with pytest.raises(HTTPException) as exc_info:
        require_pro_for_platform("x_thread", user)
    assert exc_info.value.status_code == 403


def test_require_pro_allows_admin_bypass():
    admin = _FakeAdmin()
    require_pro_for_platform("linkedin_article", admin)  # should not raise


def test_require_pro_allows_non_pro_platform():
    user = _FakeUser("starter")
    require_pro_for_platform("reddit", user)  # should not raise


def test_require_pro_allows_non_pro_platform_free():
    user = _FakeUser(None)
    require_pro_for_platform("quora", user)  # should not raise
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && python -m pytest tests/test_pro_gate.py -v`
Expected: FAIL — functions don't exist yet.

- [ ] **Step 3: Implement the Pro gate**

In `backend/app/dependencies.py`, add at the top-level (after existing imports):

```python
PRO_ONLY_PLATFORMS: frozenset[str] = frozenset({
    "linkedin", "linkedin_article", "linkedin_post", "linkedin_reply",
    "x", "x_thread", "x_post", "x_reply",
})


def is_pro_only_platform(platform: str) -> bool:
    """Return True if the platform requires a Pro subscription."""
    return platform in PRO_ONLY_PLATFORMS


def require_pro_for_platform(platform: str, user) -> None:
    """Raise HTTP 403 if the platform is Pro-only and the user isn't Pro or admin."""
    if not is_pro_only_platform(platform):
        return
    if getattr(user, "is_admin", False):
        return
    if getattr(user, "subscription_tier", None) == "pro":
        return
    from fastapi import HTTPException, status
    raise HTTPException(
        status_code=status.HTTP_403_FORBIDDEN,
        detail=f"LinkedIn and X features require a Pro subscription.",
    )
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && python -m pytest tests/test_pro_gate.py -v`
Expected: All PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/app/dependencies.py backend/tests/test_pro_gate.py
git commit -m "feat: add Pro-only platform gating for LinkedIn and X"
```

---

## Task 5: Generic Serper Search Service

**Files:**
- Create: `backend/app/services/serper_search_service.py`

The LinkedIn and X scanners both use Serper with `site:` scoping. Rather than duplicating the HTTP/caching logic, extract a shared service.

- [ ] **Step 1: Create the shared Serper search service**

Create `backend/app/services/serper_search_service.py`:

```python
"""
Generic Serper.dev search — site-scoped.

Used by LinkedIn and X scanners. The Quora scanner has its own implementation
in quora_search_service.py (predates this module).

Environment variable required:
  SERPER_API_KEY — API key from https://serper.dev
"""
from __future__ import annotations

import logging
import os
import time

import httpx

logger = logging.getLogger(__name__)

_SERPER_URL = "https://google.serper.dev/search"

# In-process cache: (site, cache_key) -> (expires_at, results)
_cache: dict[tuple[str, int], tuple[float, list[dict]]] = {}
_CACHE_TTL = 86_400.0  # 24 hours

_STOP_WORDS = frozenset({
    'a', 'an', 'the', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
    'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
    'should', 'may', 'might', 'can', 'it', 'its', 'this', 'that', 'these',
    'those', 'in', 'on', 'at', 'to', 'for', 'of', 'with', 'by', 'from',
    'as', 'about', 'into', 'through', 'and', 'or', 'but', 'if', 'when',
    'where', 'what', 'which', 'who', 'how', 'why', 'not', 'no', 'so',
    'than', 'then', 'there', 'here', 'i', 'we', 'you', 'they', 'he', 'she',
    'my', 'your', 'our', 'their', 'me', 'him', 'her', 'us', 'them', 'just',
    'also', 'very', 'much', 'more', 'most', 'some', 'any', 'each', 'all',
})


def extract_keywords(prompt_text: str, max_words: int = 5) -> str:
    """Return the most meaningful terms from a prompt, stripping stop words."""
    words = [
        w.strip('.,!?;:"\'()[]{}').lower()
        for w in prompt_text.split()
    ]
    keywords = [w for w in words if w and w not in _STOP_WORDS and len(w) > 2]
    return " ".join(keywords[:max_words])


def invalidate_cache(site: str, key: int) -> None:
    """Remove a cached result so the next call fetches fresh data."""
    _cache.pop((site, key), None)


def search_site(
    site: str,
    query: str,
    num_results: int = 10,
    cache_key: int | None = None,
) -> list[dict]:
    """
    Search Google via Serper.dev scoped to a specific site.

    Args:
        site: Domain to scope the search to (e.g. "linkedin.com", "x.com")
        query: Keywords to search for
        num_results: Max results to return
        cache_key: Optional cache key (e.g. prompt_id) for 24h dedup

    Returns list of dicts: {title, url, snippet, date}
    """
    if cache_key is not None:
        entry = _cache.get((site, cache_key))
        if entry and time.monotonic() < entry[0]:
            logger.debug("serper_search: cache hit for site=%s key=%s", site, cache_key)
            return entry[1]

    api_key = os.getenv("SERPER_API_KEY", "").strip()
    if not api_key:
        logger.warning("serper_search: SERPER_API_KEY not configured — returning empty")
        return []

    try:
        with httpx.Client(timeout=8.0) as client:
            resp = client.post(
                _SERPER_URL,
                headers={
                    "X-API-KEY": api_key,
                    "Content-Type": "application/json",
                },
                json={"q": f"site:{site} {query}", "num": 20},
            )
            resp.raise_for_status()
            data = resp.json()
    except httpx.HTTPStatusError as exc:
        try:
            error_body = exc.response.json()
        except Exception:
            error_body = exc.response.text
        logger.error("serper_search: HTTP %s — %s", exc.response.status_code, error_body)
        return []
    except Exception as exc:
        logger.error("serper_search: request failed — %s", exc)
        return []

    items = data.get("organic", [])
    results: list[dict] = []

    for item in items:
        url: str = item.get("link", "")
        title: str = item.get("title", "")
        snippet: str = item.get("snippet", "")
        date: str = item.get("date", "")

        if not url or not title:
            continue

        results.append({
            "title": _clean_title(title, site),
            "url": url,
            "snippet": snippet,
            "date": date,
        })
        if len(results) >= num_results:
            break

    logger.info(
        "serper_search: %d results for site=%s query=%r (%d raw)",
        len(results), site, query, len(items),
    )

    if cache_key is not None:
        _cache[(site, cache_key)] = (time.monotonic() + _CACHE_TTL, results)

    return results


def _clean_title(title: str, site: str) -> str:
    """Strip common branding suffixes from search result titles."""
    suffixes = {
        "linkedin.com": (" | LinkedIn", " - LinkedIn", " — LinkedIn", " – LinkedIn"),
        "x.com": (" / X", " on X", " - X"),
        "twitter.com": (" / X", " on X", " - X"),
    }
    for suffix in suffixes.get(site, ()):
        if title.endswith(suffix):
            return title[: -len(suffix)].strip()
    return title.strip()
```

- [ ] **Step 2: Commit**

```bash
git add backend/app/services/serper_search_service.py
git commit -m "feat: add generic Serper search service for site-scoped searches"
```

---

## Task 6: LinkedIn Scanner Service

**Files:**
- Create: `backend/app/services/linkedin_scanner_service.py`
- Create: `backend/tests/test_linkedin_scanner.py`

- [ ] **Step 1: Write tests for LinkedIn scanner**

Create `backend/tests/test_linkedin_scanner.py`:

```python
"""
Tests for the LinkedIn scanner service.

Mock boundary: patch("app.services.serper_search_service.search_site", ...)
"""
from __future__ import annotations

from datetime import UTC, datetime, timedelta
from unittest.mock import patch

import pytest

from app.services.linkedin_scanner_service import (
    _is_valid_linkedin_url,
    _score_result,
)


# ── URL validation ─────────────────────────────────────────────────────────────

def test_valid_post_url():
    assert _is_valid_linkedin_url("https://www.linkedin.com/posts/john-doe_ai-activity-123") is True


def test_valid_pulse_url():
    assert _is_valid_linkedin_url("https://www.linkedin.com/pulse/future-of-ai-john-doe") is True


def test_valid_feed_update_url():
    assert _is_valid_linkedin_url("https://www.linkedin.com/feed/update/urn:li:activity:123") is True


def test_reject_job_url():
    assert _is_valid_linkedin_url("https://www.linkedin.com/jobs/view/123") is False


def test_reject_profile_url():
    assert _is_valid_linkedin_url("https://www.linkedin.com/in/john-doe") is False


def test_reject_company_about_url():
    assert _is_valid_linkedin_url("https://www.linkedin.com/company/acme/about") is False


def test_reject_non_linkedin_url():
    assert _is_valid_linkedin_url("https://www.example.com/posts/something") is False


# ── Scoring ──────────────────────────────────────────────────────────────────

def test_score_high_relevance_recent():
    recent = datetime.now(UTC).replace(tzinfo=None) - timedelta(days=3)
    score = _score_result(
        "What is the best project management saas tool for teams",
        "project management saas tool remote teams collaboration",
        "what is the best project management saas tool",
        posted_at=recent,
    )
    assert score >= 50.0


def test_score_low_overlap_returns_zero():
    score = _score_result(
        "How do cats sleep so much",
        "cats love napping in the sun",
        "what is the best project management saas tool",
    )
    assert score == 0.0


def test_score_no_date_penalized():
    score_with = _score_result(
        "Best project management saas tool for teams",
        "project management saas tool remote teams",
        "what is the best project management saas tool",
        posted_at=datetime.now(UTC).replace(tzinfo=None) - timedelta(days=5),
    )
    score_without = _score_result(
        "Best project management saas tool for teams",
        "project management saas tool remote teams",
        "what is the best project management saas tool",
        posted_at=None,
    )
    assert score_with > score_without
    assert score_without > 0


def test_score_old_not_zero():
    old = datetime.now(UTC).replace(tzinfo=None) - timedelta(days=200)
    score = _score_result(
        "Best project management saas tool for teams",
        "project management saas tool remote teams",
        "what is the best project management saas tool",
        posted_at=old,
    )
    assert score > 0


# ── Integration: scan_brand_opportunities ─────────────────────────────────────

@pytest.mark.asyncio
async def test_scan_nonexistent_brand_returns_zero():
    from app.services import linkedin_scanner_service
    with patch("app.services.serper_search_service.search_site", return_value=[]):
        count = await linkedin_scanner_service.scan_brand_opportunities(brand_id=99999)
    assert count == 0


@pytest.mark.asyncio
async def test_scan_stores_relevant_post(tmp_db):
    from app.services import linkedin_scanner_service
    brand_id = await tmp_db.create_brand_with_prompt(
        name="LinkedTest",
        prompt="what is the best project management saas tool",
    )
    results = [{
        "title": "Best project management saas tool for distributed teams",
        "url": "https://www.linkedin.com/posts/expert_best-project-management-saas-tool-activity-123",
        "snippet": "project management saas tool remote teams collaboration platform",
        "date": "3 days ago",
    }]
    with patch("app.services.serper_search_service.search_site", return_value=results):
        count = await linkedin_scanner_service.scan_brand_opportunities(brand_id)
    assert count >= 1


@pytest.mark.asyncio
async def test_scan_filters_irrelevant_post(tmp_db):
    from app.services import linkedin_scanner_service
    brand_id = await tmp_db.create_brand_with_prompt(
        name="LinkedFilter",
        prompt="what is the best project management saas tool",
    )
    results = [{
        "title": "How do cats sleep all day",
        "url": "https://www.linkedin.com/posts/cat-lover_cats-activity-999",
        "snippet": "cats love napping in the sun",
        "date": "",
    }]
    with patch("app.services.serper_search_service.search_site", return_value=results):
        count = await linkedin_scanner_service.scan_brand_opportunities(brand_id)
    assert count == 0


@pytest.mark.asyncio
async def test_scan_filters_job_urls(tmp_db):
    from app.services import linkedin_scanner_service
    brand_id = await tmp_db.create_brand_with_prompt(
        name="LinkedJobs",
        prompt="what is the best project management saas tool",
    )
    results = [{
        "title": "Project Management SaaS Tool Engineer",
        "url": "https://www.linkedin.com/jobs/view/project-management-saas-12345",
        "snippet": "project management saas tool remote teams",
        "date": "1 day ago",
    }]
    with patch("app.services.serper_search_service.search_site", return_value=results):
        count = await linkedin_scanner_service.scan_brand_opportunities(brand_id)
    assert count == 0


@pytest.mark.asyncio
async def test_scan_deduplication(tmp_db):
    from app.services import linkedin_scanner_service
    brand_id = await tmp_db.create_brand_with_prompt(
        name="LinkedDedup",
        prompt="what is the best project management saas tool",
    )
    result = [{
        "title": "Best project management saas tool for teams",
        "url": "https://www.linkedin.com/posts/expert_saas-tool-activity-123",
        "snippet": "project management saas tool remote teams",
        "date": "2 days ago",
    }]
    with patch("app.services.serper_search_service.search_site", return_value=result):
        await linkedin_scanner_service.scan_brand_opportunities(brand_id)
        count2 = await linkedin_scanner_service.scan_brand_opportunities(brand_id)
    assert count2 == 0
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && python -m pytest tests/test_linkedin_scanner.py -v`
Expected: FAIL — module doesn't exist.

- [ ] **Step 3: Implement LinkedIn scanner**

Create `backend/app/services/linkedin_scanner_service.py`:

```python
"""
LinkedIn Scanner Service

Scans LinkedIn for posts and articles related to each brand's tracked prompts
via Serper.dev and stores them as ContentOpportunity records.

Public API
----------
scan_brand_opportunities(brand_id, clear_existing) -> int
scan_all_brands() -> None
"""
from __future__ import annotations

import logging
import re
from datetime import UTC, datetime, timedelta

logger = logging.getLogger(__name__)

_MIN_SCORE = 45.0
_LEAD_CAP = 20

# URL patterns that indicate actual LinkedIn content (not profiles/jobs/company pages)
_VALID_PATH_PATTERNS = ("/posts/", "/pulse/", "/feed/update/")
_REJECT_PATH_PATTERNS = ("/jobs/", "/in/", "/company/", "/school/", "/events/", "/learning/")


def _is_valid_linkedin_url(url: str) -> bool:
    """Return True if this URL points to a LinkedIn post or article."""
    lower = url.lower()
    if "linkedin.com" not in lower:
        return False
    if any(pat in lower for pat in _REJECT_PATH_PATTERNS):
        return False
    return any(pat in lower for pat in _VALID_PATH_PATTERNS)


# ── Scoring ──────────────────────────────────────────────────────────────────

_STOP = frozenset("""
    a an the is are was were be to of and or in on at for with by from
    this that these those it its i we you they he she my your our their
    do does did can could would should may might will what which who when
    where why how have has had been being about up out some any all also
    just now get more most very really quite too so then than
""".split())


def _score_result(
    title: str,
    snippet: str,
    prompt_text: str,
    posted_at: datetime | None = None,
) -> float:
    """Relevance + recency score, matching Reddit/Quora scoring pattern."""
    clean_prompt = re.sub(r"[^a-z0-9\s]", "", prompt_text.lower())
    prompt_kw = {w for w in clean_prompt.split() if w not in _STOP and len(w) > 2}
    if not prompt_kw:
        return 0.0

    combined = (title + " " + snippet).lower()
    combined_kw = {w for w in re.sub(r"[^a-z0-9\s]", "", combined).split()
                   if w not in _STOP and len(w) > 2}
    matches = len(prompt_kw & combined_kw)
    relevance = min(1.0, matches / len(prompt_kw))

    if matches < 2:
        return 0.0

    # Recency — graduated, matching Reddit/Quora approach
    if posted_at is not None:
        age_days = (datetime.now(UTC).replace(tzinfo=None) - posted_at).total_seconds() / 86400
    else:
        age_days = 180

    if age_days <= 7:
        recency = 1.0
    elif age_days <= 30:
        recency = 0.7
    elif age_days <= 60:
        recency = 0.4
    elif age_days <= 90:
        recency = 0.2
    else:
        recency = 0.05

    score = relevance * 70.0 + recency * 30.0
    return round(min(score, 100.0), 1)


# ── Date parsing (reuse from Quora scanner) ──────────────────────────────────

def _parse_serper_date(date_str: str | None) -> datetime | None:
    """Parse Serper.dev date field into UTC-naive datetime."""
    from app.services.quora_scanner_service import _parse_serper_date as _impl
    return _impl(date_str)


# ── Scanner ──────────────────────────────────────────────────────────────────

async def scan_brand_opportunities(brand_id: int, clear_existing: bool = False) -> int:
    """
    Scan LinkedIn for relevant posts/articles for a single brand.
    Returns the number of new ContentOpportunity rows stored.
    """
    from sqlalchemy import delete as sql_delete
    from sqlalchemy import select

    from app.database import AsyncSessionLocal
    from app.models import Brand, ContentOpportunity, Prompt
    from app.services.serper_search_service import extract_keywords, search_site

    logger.info("LinkedIn scanner: brand_id=%d clear_existing=%s", brand_id, clear_existing)

    async with AsyncSessionLocal() as db:
        brand_row = await db.execute(select(Brand).where(Brand.id == brand_id))
        brand = brand_row.scalar_one_or_none()
        if brand is None:
            return 0

        prompts_row = await db.execute(select(Prompt).where(Prompt.brand_id == brand_id))
        prompts = list(prompts_row.scalars().all())
        if not prompts:
            logger.info("LinkedIn scanner: no prompts for brand_id=%d, skipping", brand_id)
            return 0

        if clear_existing:
            await db.execute(
                sql_delete(ContentOpportunity).where(
                    ContentOpportunity.brand_id == brand_id,
                    ContentOpportunity.platform == "linkedin",
                )
            )
            await db.commit()
            existing_urls: set[str] = set()
        else:
            cutoff = datetime.now(UTC).replace(tzinfo=None) - timedelta(days=14)
            old_row = await db.execute(
                select(ContentOpportunity).where(
                    ContentOpportunity.brand_id == brand_id,
                    ContentOpportunity.platform == "linkedin",
                    ContentOpportunity.created_at < cutoff,
                    ContentOpportunity.status == "new",
                )
            )
            for old_opp in old_row.scalars().all():
                await db.delete(old_opp)

            existing_row = await db.execute(
                select(ContentOpportunity.thread_url).where(
                    ContentOpportunity.brand_id == brand_id,
                    ContentOpportunity.platform == "linkedin",
                )
            )
            existing_urls = {r[0] for r in existing_row.all()}

        new_count = 0

        for prompt in prompts[:5]:
            query = extract_keywords(prompt.text, max_words=5)
            if not query:
                continue

            results = search_site(
                site="linkedin.com",
                query=query,
                num_results=10,
                cache_key=prompt.id,
            )

            for r in results:
                url = r.get("url", "")
                title = r.get("title", "")
                snippet = r.get("snippet", "")

                if not url or not title:
                    continue
                if url in existing_urls:
                    continue
                if not _is_valid_linkedin_url(url):
                    continue

                posted_at = _parse_serper_date(r.get("date"))
                score = _score_result(title, snippet, prompt.text, posted_at)
                if score < _MIN_SCORE:
                    continue

                opp = ContentOpportunity(
                    brand_id=brand_id,
                    platform="linkedin",
                    thread_url=url,
                    thread_title=title[:500],
                    subreddit=None,
                    body_preview=snippet[:500] if snippet else None,
                    posted_at=posted_at,
                    relevance_score=score,
                    prompt_id=prompt.id,
                    status="new",
                )
                db.add(opp)
                existing_urls.add(url)
                new_count += 1

        await db.commit()
        logger.info("LinkedIn scanner: %d new opportunities for brand_id=%d", new_count, brand_id)

        # Cap: anchor + fresh split (same as Quora)
        _ANCHOR = _LEAD_CAP // 2
        _FRESH = _LEAD_CAP - _ANCHOR

        all_new_result = await db.execute(
            select(ContentOpportunity).where(
                ContentOpportunity.brand_id == brand_id,
                ContentOpportunity.platform == "linkedin",
                ContentOpportunity.status == "new",
            )
        )
        all_new = list(all_new_result.scalars().all())
        if len(all_new) > _LEAD_CAP:
            by_relevance = sorted(all_new, key=lambda o: o.relevance_score, reverse=True)
            anchor_ids = {o.id for o in by_relevance[:_ANCHOR]}
            remaining = [o for o in by_relevance if o.id not in anchor_ids]
            by_recency = sorted(remaining, key=lambda o: o.posted_at or datetime.min, reverse=True)
            fresh_ids = {o.id for o in by_recency[:_FRESH]}
            keep_ids = anchor_ids | fresh_ids
            for opp_to_drop in all_new:
                if opp_to_drop.id not in keep_ids:
                    await db.delete(opp_to_drop)
            await db.commit()

        return new_count


async def scan_all_brands() -> None:
    """Run the LinkedIn scanner for every Pro-tier brand."""
    from sqlalchemy import select

    from app.database import AsyncSessionLocal
    from app.models import Brand, User

    logger.info("LinkedIn scanner: starting full sweep")
    async with AsyncSessionLocal() as db:
        result = await db.execute(
            select(Brand).join(User, Brand.user_id == User.id).where(
                User.subscription_tier == "pro",
            )
        )
        brands = result.scalars().all()

    for brand in brands:
        try:
            await scan_brand_opportunities(brand.id)
        except Exception:
            logger.exception("LinkedIn scanner failed for brand_id=%d", brand.id)

    logger.info("LinkedIn scanner: full sweep complete")
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && python -m pytest tests/test_linkedin_scanner.py -v`
Expected: All PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/linkedin_scanner_service.py backend/tests/test_linkedin_scanner.py
git commit -m "feat: add LinkedIn opportunity scanner service"
```

---

## Task 7: X Scanner Service

**Files:**
- Create: `backend/app/services/x_scanner_service.py`
- Create: `backend/tests/test_x_scanner.py`

- [ ] **Step 1: Write tests for X scanner**

Create `backend/tests/test_x_scanner.py`:

```python
"""
Tests for the X/Twitter scanner service.

Mock boundary: patch("app.services.serper_search_service.search_site", ...)
"""
from __future__ import annotations

from datetime import UTC, datetime, timedelta
from unittest.mock import patch

import pytest

from app.services.x_scanner_service import _is_valid_x_url, _score_result


# ── URL validation ─────────────────────────────────────────────────────────────

def test_valid_x_status_url():
    assert _is_valid_x_url("https://x.com/user/status/123456789") is True


def test_valid_twitter_status_url():
    assert _is_valid_x_url("https://twitter.com/user/status/123456789") is True


def test_reject_x_profile_url():
    assert _is_valid_x_url("https://x.com/username") is False


def test_reject_x_lists_url():
    assert _is_valid_x_url("https://x.com/i/lists/12345") is False


def test_reject_non_x_url():
    assert _is_valid_x_url("https://www.example.com/status/123") is False


def test_reject_media_only_short_snippet():
    """URLs with very short snippets are likely media-only tweets."""
    # This is tested at the scanner level, not URL validation
    pass


# ── Scoring ──────────────────────────────────────────────────────────────────

def test_score_high_relevance_recent():
    recent = datetime.now(UTC).replace(tzinfo=None) - timedelta(days=2)
    score = _score_result(
        "What is the best project management saas tool for teams",
        "project management saas tool remote teams collaboration",
        "what is the best project management saas tool",
        posted_at=recent,
    )
    assert score >= 50.0


def test_score_low_overlap_returns_zero():
    score = _score_result(
        "How do cats sleep so much",
        "cats love napping in the sun",
        "what is the best project management saas tool",
    )
    assert score == 0.0


def test_score_no_date_penalized():
    score_with = _score_result(
        "Best project management saas tool for teams",
        "project management saas tool remote teams",
        "what is the best project management saas tool",
        posted_at=datetime.now(UTC).replace(tzinfo=None) - timedelta(days=5),
    )
    score_without = _score_result(
        "Best project management saas tool for teams",
        "project management saas tool remote teams",
        "what is the best project management saas tool",
        posted_at=None,
    )
    assert score_with > score_without
    assert score_without > 0


# ── Integration ──────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_scan_nonexistent_brand_returns_zero():
    from app.services import x_scanner_service
    with patch("app.services.serper_search_service.search_site", return_value=[]):
        count = await x_scanner_service.scan_brand_opportunities(brand_id=99999)
    assert count == 0


@pytest.mark.asyncio
async def test_scan_stores_relevant_tweet(tmp_db):
    from app.services import x_scanner_service
    brand_id = await tmp_db.create_brand_with_prompt(
        name="XTest",
        prompt="what is the best project management saas tool",
    )
    results = [{
        "title": "Best project management saas tool for distributed teams",
        "url": "https://x.com/expert/status/123456789",
        "snippet": "project management saas tool remote teams collaboration platform workflow",
        "date": "2 days ago",
    }]
    with patch("app.services.serper_search_service.search_site", return_value=results):
        count = await x_scanner_service.scan_brand_opportunities(brand_id)
    assert count >= 1


@pytest.mark.asyncio
async def test_scan_filters_profile_urls(tmp_db):
    from app.services import x_scanner_service
    brand_id = await tmp_db.create_brand_with_prompt(
        name="XProfile",
        prompt="what is the best project management saas tool",
    )
    results = [{
        "title": "SaaS Expert - Project Management",
        "url": "https://x.com/saas_expert",
        "snippet": "project management saas tool expert",
        "date": "",
    }]
    with patch("app.services.serper_search_service.search_site", return_value=results):
        count = await x_scanner_service.scan_brand_opportunities(brand_id)
    assert count == 0


@pytest.mark.asyncio
async def test_scan_filters_short_snippets(tmp_db):
    from app.services import x_scanner_service
    brand_id = await tmp_db.create_brand_with_prompt(
        name="XMedia",
        prompt="what is the best project management saas tool",
    )
    results = [{
        "title": "pic related",
        "url": "https://x.com/user/status/999",
        "snippet": "pic",
        "date": "1 day ago",
    }]
    with patch("app.services.serper_search_service.search_site", return_value=results):
        count = await x_scanner_service.scan_brand_opportunities(brand_id)
    assert count == 0


@pytest.mark.asyncio
async def test_scan_deduplication(tmp_db):
    from app.services import x_scanner_service
    brand_id = await tmp_db.create_brand_with_prompt(
        name="XDedup",
        prompt="what is the best project management saas tool",
    )
    result = [{
        "title": "Best project management saas tool for teams",
        "url": "https://x.com/expert/status/123456789",
        "snippet": "project management saas tool remote teams collaboration",
        "date": "3 days ago",
    }]
    with patch("app.services.serper_search_service.search_site", return_value=result):
        await x_scanner_service.scan_brand_opportunities(brand_id)
        count2 = await x_scanner_service.scan_brand_opportunities(brand_id)
    assert count2 == 0
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && python -m pytest tests/test_x_scanner.py -v`
Expected: FAIL — module doesn't exist.

- [ ] **Step 3: Implement X scanner**

Create `backend/app/services/x_scanner_service.py`:

```python
"""
X (Twitter) Scanner Service

Scans X/Twitter for tweets and threads related to each brand's tracked prompts
via Serper.dev and stores them as ContentOpportunity records.

Public API
----------
scan_brand_opportunities(brand_id, clear_existing) -> int
scan_all_brands() -> None
"""
from __future__ import annotations

import logging
import re
from datetime import UTC, datetime, timedelta

logger = logging.getLogger(__name__)

_MIN_SCORE = 45.0
_LEAD_CAP = 20
_MIN_SNIPPET_LEN = 20  # reject media-only tweets with very short snippets


def _is_valid_x_url(url: str) -> bool:
    """Return True if this URL points to an actual tweet (not a profile/list page)."""
    lower = url.lower()
    if "x.com" not in lower and "twitter.com" not in lower:
        return False
    return "/status/" in lower


# ── Scoring ──────────────────────────────────────────────────────────────────

_STOP = frozenset("""
    a an the is are was were be to of and or in on at for with by from
    this that these those it its i we you they he she my your our their
    do does did can could would should may might will what which who when
    where why how have has had been being about up out some any all also
    just now get more most very really quite too so then than
""".split())


def _score_result(
    title: str,
    snippet: str,
    prompt_text: str,
    posted_at: datetime | None = None,
) -> float:
    """Relevance + recency score, matching Reddit/Quora/LinkedIn scoring pattern."""
    clean_prompt = re.sub(r"[^a-z0-9\s]", "", prompt_text.lower())
    prompt_kw = {w for w in clean_prompt.split() if w not in _STOP and len(w) > 2}
    if not prompt_kw:
        return 0.0

    combined = (title + " " + snippet).lower()
    combined_kw = {w for w in re.sub(r"[^a-z0-9\s]", "", combined).split()
                   if w not in _STOP and len(w) > 2}
    matches = len(prompt_kw & combined_kw)
    relevance = min(1.0, matches / len(prompt_kw))

    if matches < 2:
        return 0.0

    if posted_at is not None:
        age_days = (datetime.now(UTC).replace(tzinfo=None) - posted_at).total_seconds() / 86400
    else:
        age_days = 180

    if age_days <= 7:
        recency = 1.0
    elif age_days <= 30:
        recency = 0.7
    elif age_days <= 60:
        recency = 0.4
    elif age_days <= 90:
        recency = 0.2
    else:
        recency = 0.05

    score = relevance * 70.0 + recency * 30.0
    return round(min(score, 100.0), 1)


def _parse_serper_date(date_str: str | None) -> datetime | None:
    from app.services.quora_scanner_service import _parse_serper_date as _impl
    return _impl(date_str)


# ── Scanner ──────────────────────────────────────────────────────────────────

async def scan_brand_opportunities(brand_id: int, clear_existing: bool = False) -> int:
    """
    Scan X/Twitter for relevant tweets for a single brand.
    Returns the number of new ContentOpportunity rows stored.
    """
    from sqlalchemy import delete as sql_delete
    from sqlalchemy import select

    from app.database import AsyncSessionLocal
    from app.models import Brand, ContentOpportunity, Prompt
    from app.services.serper_search_service import extract_keywords, search_site

    logger.info("X scanner: brand_id=%d clear_existing=%s", brand_id, clear_existing)

    async with AsyncSessionLocal() as db:
        brand_row = await db.execute(select(Brand).where(Brand.id == brand_id))
        brand = brand_row.scalar_one_or_none()
        if brand is None:
            return 0

        prompts_row = await db.execute(select(Prompt).where(Prompt.brand_id == brand_id))
        prompts = list(prompts_row.scalars().all())
        if not prompts:
            logger.info("X scanner: no prompts for brand_id=%d, skipping", brand_id)
            return 0

        if clear_existing:
            await db.execute(
                sql_delete(ContentOpportunity).where(
                    ContentOpportunity.brand_id == brand_id,
                    ContentOpportunity.platform == "x",
                )
            )
            await db.commit()
            existing_urls: set[str] = set()
        else:
            cutoff = datetime.now(UTC).replace(tzinfo=None) - timedelta(days=14)
            old_row = await db.execute(
                select(ContentOpportunity).where(
                    ContentOpportunity.brand_id == brand_id,
                    ContentOpportunity.platform == "x",
                    ContentOpportunity.created_at < cutoff,
                    ContentOpportunity.status == "new",
                )
            )
            for old_opp in old_row.scalars().all():
                await db.delete(old_opp)

            existing_row = await db.execute(
                select(ContentOpportunity.thread_url).where(
                    ContentOpportunity.brand_id == brand_id,
                    ContentOpportunity.platform == "x",
                )
            )
            existing_urls = {r[0] for r in existing_row.all()}

        new_count = 0

        for prompt in prompts[:5]:
            query = extract_keywords(prompt.text, max_words=5)
            if not query:
                continue

            # Search both x.com and twitter.com (Serper may index either)
            all_results: list[dict] = []
            for site in ("x.com", "twitter.com"):
                results = search_site(
                    site=site,
                    query=query,
                    num_results=10,
                    cache_key=prompt.id,
                )
                all_results.extend(results)

            # Deduplicate by URL (x.com and twitter.com may return same tweet)
            seen_urls: set[str] = set()
            deduped: list[dict] = []
            for r in all_results:
                url = r.get("url", "")
                if url not in seen_urls:
                    seen_urls.add(url)
                    deduped.append(r)

            for r in deduped:
                url = r.get("url", "")
                title = r.get("title", "")
                snippet = r.get("snippet", "")

                if not url or not title:
                    continue
                if url in existing_urls:
                    continue
                if not _is_valid_x_url(url):
                    continue
                if len(snippet) < _MIN_SNIPPET_LEN:
                    continue

                posted_at = _parse_serper_date(r.get("date"))
                score = _score_result(title, snippet, prompt.text, posted_at)
                if score < _MIN_SCORE:
                    continue

                opp = ContentOpportunity(
                    brand_id=brand_id,
                    platform="x",
                    thread_url=url,
                    thread_title=title[:500],
                    subreddit=None,
                    body_preview=snippet[:500] if snippet else None,
                    posted_at=posted_at,
                    relevance_score=score,
                    prompt_id=prompt.id,
                    status="new",
                )
                db.add(opp)
                existing_urls.add(url)
                new_count += 1

        await db.commit()
        logger.info("X scanner: %d new opportunities for brand_id=%d", new_count, brand_id)

        # Cap: anchor + fresh split
        _ANCHOR = _LEAD_CAP // 2
        _FRESH = _LEAD_CAP - _ANCHOR

        all_new_result = await db.execute(
            select(ContentOpportunity).where(
                ContentOpportunity.brand_id == brand_id,
                ContentOpportunity.platform == "x",
                ContentOpportunity.status == "new",
            )
        )
        all_new = list(all_new_result.scalars().all())
        if len(all_new) > _LEAD_CAP:
            by_relevance = sorted(all_new, key=lambda o: o.relevance_score, reverse=True)
            anchor_ids = {o.id for o in by_relevance[:_ANCHOR]}
            remaining = [o for o in by_relevance if o.id not in anchor_ids]
            by_recency = sorted(remaining, key=lambda o: o.posted_at or datetime.min, reverse=True)
            fresh_ids = {o.id for o in by_recency[:_FRESH]}
            keep_ids = anchor_ids | fresh_ids
            for opp_to_drop in all_new:
                if opp_to_drop.id not in keep_ids:
                    await db.delete(opp_to_drop)
            await db.commit()

        return new_count


async def scan_all_brands() -> None:
    """Run the X scanner for every Pro-tier brand."""
    from sqlalchemy import select

    from app.database import AsyncSessionLocal
    from app.models import Brand, User

    logger.info("X scanner: starting full sweep")
    async with AsyncSessionLocal() as db:
        result = await db.execute(
            select(Brand).join(User, Brand.user_id == User.id).where(
                User.subscription_tier == "pro",
            )
        )
        brands = result.scalars().all()

    for brand in brands:
        try:
            await scan_brand_opportunities(brand.id)
        except Exception:
            logger.exception("X scanner failed for brand_id=%d", brand.id)

    logger.info("X scanner: full sweep complete")
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && python -m pytest tests/test_x_scanner.py -v`
Expected: All PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/x_scanner_service.py backend/tests/test_x_scanner.py
git commit -m "feat: add X/Twitter opportunity scanner service"
```

---

## Task 8: Gap Analysis + Drafting Service Updates

**Files:**
- Modify: `backend/app/services/gap_analysis_service.py`
- Modify: `backend/app/services/drafting_service.py`

- [ ] **Step 1: Update gap analysis PLATFORMS**

In `backend/app/services/gap_analysis_service.py`, change line 38:

```python
PLATFORMS = ["reddit", "quora", "medium", "wikipedia", "linkedin", "x"]
```

- [ ] **Step 2: Update drafting service platform mapping**

In `backend/app/services/drafting_service.py`, in `generate_gap_draft()`, after the existing platform-to-spec mapping for reddit/quora, add the LinkedIn/X mapping. Find the line `spec = PLATFORM_SPECS[platform]` (around line 581) and add this before it:

```python
    # Map base platform names to their gap-draft variants
    platform_key = platform
    if platform == "linkedin":
        platform_key = "linkedin_article"
    elif platform == "x":
        platform_key = "x_thread"

    spec = PLATFORM_SPECS[platform_key]
```

And update the `call_claude` and subsequent lines to use `platform_key`:

```python
    claude_prompt = build_prompt(
        brand_name=brand.name,
        platform=platform_key,
        prompt_text=prompt.text,
        ...
    )

    raw_text = await call_claude(claude_prompt, max_tokens=PLATFORM_MAX_TOKENS.get(platform_key, 2500))
```

In `generate_opportunity_draft()`, update the platform_key selection (around line 773):

```python
    # Select platform spec based on opportunity platform
    platform_key_map = {
        "reddit": "reddit_reply",
        "linkedin": "linkedin_reply",
        "x": "x_reply",
    }
    platform_key = platform_key_map.get(opp.platform, opp.platform)
    spec = PLATFORM_SPECS.get(platform_key, PLATFORM_SPECS["reddit_reply"])
    max_tokens = PLATFORM_MAX_TOKENS.get(platform_key, 600)
```

After `remove_hedging()`, add X character enforcement for X platforms:

```python
    raw_text = remove_hedging(raw_text)

    # Enforce X character limits
    from app.services.drafting import enforce_x_char_limit
    if opp.platform == "x" or platform_key.startswith("x_"):
        raw_text = enforce_x_char_limit(raw_text, platform_key)
```

Also add the same enforcement in `generate_gap_draft()` after `remove_hedging()`:

```python
    raw_text = remove_hedging(raw_text)

    # Enforce X character limits
    if platform_key.startswith("x_"):
        from app.services.drafting import enforce_x_char_limit
        raw_text = enforce_x_char_limit(raw_text, platform_key)
```

Update the haiku model selection for opportunity drafts to include LinkedIn/X replies:

```python
    _opp_model = (
        "claude-haiku-4-5-20251001" if platform_key in ("reddit_reply", "linkedin_reply", "x_reply")
        else "claude-sonnet-4-6"
    )
```

- [ ] **Step 3: Run existing tests to verify nothing breaks**

Run: `cd backend && python -m pytest tests/ -v --timeout=30`
Expected: All existing tests still pass.

- [ ] **Step 4: Commit**

```bash
git add backend/app/services/gap_analysis_service.py backend/app/services/drafting_service.py
git commit -m "feat: integrate LinkedIn/X into gap analysis and drafting service"
```

---

## Task 9: Router Updates — Opportunities + Content

**Files:**
- Modify: `backend/app/routers/opportunities.py`
- Modify: `backend/app/routers/content.py`

- [ ] **Step 1: Add Pro gate and balanced interleaving to opportunities router**

In `backend/app/routers/opportunities.py`, update the `list_opportunities` endpoint. Add the balanced interleaving logic and Pro gate:

```python
from app.dependencies import is_pro_only_platform

@router.get("/{brand_id}", response_model=list[dict])
async def list_opportunities(
    brand_id: int,
    db: DbDep,
    user: CurrentUser,
    opp_status: str | None = Query(None, alias="status", description="Filter by status: new, drafted, dismissed"),
    limit: int = Query(20, ge=1, le=200),
):
    """List content opportunities for a brand, balanced across platforms."""
    await get_brand_for_user(brand_id, db, user)

    stmt = (
        select(ContentOpportunity)
        .where(ContentOpportunity.brand_id == brand_id)
    )
    if opp_status is not None:
        stmt = stmt.where(ContentOpportunity.status == opp_status)
    else:
        stmt = stmt.where(ContentOpportunity.status == "new")

    stmt = stmt.order_by(
        ContentOpportunity.relevance_score.desc(),
        ContentOpportunity.created_at.desc(),
    )
    result = await db.execute(stmt)
    all_opps = list(result.scalars().all())

    # Filter out Pro-only platforms for non-Pro users
    user_tier = getattr(user, "subscription_tier", None)
    is_admin = getattr(user, "is_admin", False)
    if not is_admin and user_tier != "pro":
        all_opps = [o for o in all_opps if not is_pro_only_platform(o.platform)]

    # Balanced interleaving: distribute evenly across platforms
    from collections import defaultdict
    by_platform: dict[str, list] = defaultdict(list)
    for opp in all_opps:
        by_platform[opp.platform].append(opp)

    n_platforms = len(by_platform)
    if n_platforms == 0:
        interleaved = []
    else:
        per_platform = max(1, limit // n_platforms)
        interleaved = []
        # Round-robin across platforms
        platform_iters = {
            p: iter(opps[:per_platform + (limit % n_platforms)])  # slight overshoot to fill gaps
            for p, opps in by_platform.items()
        }
        exhausted = set()
        while len(interleaved) < limit and len(exhausted) < n_platforms:
            for p in list(by_platform.keys()):
                if p in exhausted:
                    continue
                try:
                    interleaved.append(next(platform_iters[p]))
                except StopIteration:
                    exhausted.add(p)
                if len(interleaved) >= limit:
                    break

    # Enrich with prompt text
    prompt_ids = list({o.prompt_id for o in interleaved if o.prompt_id})
    prompt_text_map: dict[int, str] = {}
    if prompt_ids:
        from app.models import Prompt
        prompt_result = await db.execute(
            select(Prompt).where(Prompt.id.in_(prompt_ids))
        )
        prompt_text_map = {p.id: p.text for p in prompt_result.scalars().all()}

    return [_enrich_opportunity(o, prompt_text_map) for o in interleaved]
```

Also add the Pro gate to `draft_opportunity` and `trigger_scan`:

In the `draft_opportunity` endpoint, add after loading the opportunity:

```python
    from app.dependencies import require_pro_for_platform
    require_pro_for_platform(opp.platform, user)
```

In the `trigger_scan` endpoint, add a platform parameter and Pro check. Update it to support LinkedIn/X scans:

```python
@router.post("/{brand_id}/scan", status_code=status.HTTP_202_ACCEPTED)
async def trigger_scan(
    brand_id: int,
    db: DbDep,
    user: CurrentUser,
    platform: str | None = Query(None, description="Platform to scan: reddit, quora, linkedin, x"),
):
    """Trigger an on-demand opportunity scan for a brand."""
    await get_brand_for_user(brand_id, db, user)

    if platform and platform in ("linkedin", "x"):
        from app.dependencies import require_pro_for_platform
        require_pro_for_platform(platform, user)

    # ... existing scan logic, extended to support linkedin/x ...
```

- [ ] **Step 2: Add Pro gate to content router**

In `backend/app/routers/content.py`, in the `create_draft` endpoint, add after the `check_rate_limit` call:

```python
    from app.dependencies import require_pro_for_platform
    require_pro_for_platform(request.platform, user)
```

- [ ] **Step 3: Run existing tests to verify nothing breaks**

Run: `cd backend && python -m pytest tests/ -v --timeout=30`
Expected: All existing tests still pass.

- [ ] **Step 4: Commit**

```bash
git add backend/app/routers/opportunities.py backend/app/routers/content.py
git commit -m "feat: add Pro gate and balanced interleaving to routers"
```

---

## Task 10: Scheduler Updates

**Files:**
- Modify: `backend/app/scheduler.py`

- [ ] **Step 1: Add LinkedIn and X scanner sweep functions**

In `backend/app/scheduler.py`, add after the `_quora_scanner_sweep` function:

```python
async def _linkedin_scanner_sweep() -> None:
    """Weekly LinkedIn scan for all Pro-tier brands (03:40 UTC, Monday)."""
    if await _is_scheduler_paused():
        logger.info("Scheduler paused — skipping LinkedIn scanner sweep")
        return

    from app.services.linkedin_scanner_service import scan_all_brands
    try:
        await scan_all_brands()
    except Exception:
        logger.exception("LinkedIn scanner sweep failed")


async def _x_scanner_sweep() -> None:
    """Weekly X/Twitter scan for all Pro-tier brands (03:50 UTC, Monday)."""
    if await _is_scheduler_paused():
        logger.info("Scheduler paused — skipping X scanner sweep")
        return

    from app.services.x_scanner_service import scan_all_brands
    try:
        await scan_all_brands()
    except Exception:
        logger.exception("X scanner sweep failed")
```

- [ ] **Step 2: Register the jobs**

In the `setup_scheduler()` function, add after the Quora scanner job registration:

```python
    scheduler.add_job(
        _linkedin_scanner_sweep,
        trigger=CronTrigger(day_of_week="mon", hour=3, minute=40, timezone="UTC"),
        id="linkedin_scanner",
        name="LinkedIn opportunity scanner (Monday 03:40 UTC)",
        replace_existing=True,
        misfire_grace_time=3600,
    )

    scheduler.add_job(
        _x_scanner_sweep,
        trigger=CronTrigger(day_of_week="mon", hour=3, minute=50, timezone="UTC"),
        id="x_scanner",
        name="X opportunity scanner (Monday 03:50 UTC)",
        replace_existing=True,
        misfire_grace_time=3600,
    )
```

Update the module docstring to include the new jobs.

- [ ] **Step 3: Commit**

```bash
git add backend/app/scheduler.py
git commit -m "feat: schedule LinkedIn and X scanner sweeps (Monday 03:40/03:50 UTC)"
```

---

## Task 11: Frontend — PlatformBadge + Content Page

**Files:**
- Modify: `frontend/components/PlatformBadge.tsx`
- Modify: `frontend/app/content/page.tsx`

- [ ] **Step 1: Update PlatformBadge**

In `frontend/components/PlatformBadge.tsx`, add LinkedIn and X to the style and label maps:

```typescript
const PLATFORM_STYLES: Record<string, { bg: string; text: string; border: string }> = {
  reddit:    { bg: 'rgba(194,91,52,0.12)',  text: '#c2713a', border: 'rgba(194,91,52,0.25)'  },
  quora:     { bg: 'rgba(179,43,39,0.10)',  text: '#b36461', border: 'rgba(179,43,39,0.22)'  },
  medium:    { bg: 'rgba(148,163,184,0.10)', text: 'var(--text-secondary)', border: 'rgba(148,163,184,0.18)' },
  wikipedia: { bg: 'rgba(45,157,147,0.10)', text: '#4aada4', border: 'rgba(45,157,147,0.22)' },
  linkedin:  { bg: 'rgba(10,102,194,0.12)', text: '#3b82f6', border: 'rgba(10,102,194,0.25)' },
  linkedin_article: { bg: 'rgba(10,102,194,0.12)', text: '#3b82f6', border: 'rgba(10,102,194,0.25)' },
  linkedin_post: { bg: 'rgba(10,102,194,0.12)', text: '#3b82f6', border: 'rgba(10,102,194,0.25)' },
  linkedin_reply: { bg: 'rgba(10,102,194,0.12)', text: '#3b82f6', border: 'rgba(10,102,194,0.25)' },
  x:         { bg: 'rgba(148,163,184,0.10)', text: 'var(--text-secondary)', border: 'rgba(148,163,184,0.18)' },
  x_thread:  { bg: 'rgba(148,163,184,0.10)', text: 'var(--text-secondary)', border: 'rgba(148,163,184,0.18)' },
  x_post:    { bg: 'rgba(148,163,184,0.10)', text: 'var(--text-secondary)', border: 'rgba(148,163,184,0.18)' },
  x_reply:   { bg: 'rgba(148,163,184,0.10)', text: 'var(--text-secondary)', border: 'rgba(148,163,184,0.18)' },
};

const PLATFORM_LABELS: Record<string, string> = {
  reddit: 'Reddit',
  quora: 'Quora',
  medium: 'Medium',
  wikipedia: 'Wikipedia',
  linkedin: 'LinkedIn',
  linkedin_article: 'LinkedIn Article',
  linkedin_post: 'LinkedIn Post',
  linkedin_reply: 'LinkedIn',
  x: 'X',
  x_thread: 'X Thread',
  x_post: 'X',
  x_reply: 'X',
};
```

- [ ] **Step 2: Update content page draft modal**

In `frontend/app/content/page.tsx`, update `DRAFT_PLATFORMS`:

```typescript
const DRAFT_PLATFORMS = ['reddit', 'quora', 'medium', 'wikipedia', 'linkedin', 'x'] as const;
```

In the `RequestDraftModal` component, add sub-selector state and the Pro gate UI. After the platform selection buttons, add:

```tsx
{/* LinkedIn sub-selector */}
{platform === 'linkedin' && (
  <div className="flex gap-2 mt-2">
    <button
      onClick={() => setSubPlatform('linkedin_article')}
      className={`px-3 py-1.5 text-xs rounded-lg border transition-colors ${
        subPlatform === 'linkedin_article'
          ? 'border-[var(--accent)] bg-[rgba(99,102,241,0.1)] text-[var(--accent)]'
          : 'border-[rgba(255,255,255,0.1)] text-[var(--text-muted)] hover:border-[rgba(255,255,255,0.2)]'
      }`}
    >
      Article
    </button>
    <button
      onClick={() => setSubPlatform('linkedin_post')}
      className={`px-3 py-1.5 text-xs rounded-lg border transition-colors ${
        subPlatform === 'linkedin_post'
          ? 'border-[var(--accent)] bg-[rgba(99,102,241,0.1)] text-[var(--accent)]'
          : 'border-[rgba(255,255,255,0.1)] text-[var(--text-muted)] hover:border-[rgba(255,255,255,0.2)]'
      }`}
    >
      Post
    </button>
  </div>
)}

{/* X sub-selector */}
{platform === 'x' && (
  <div className="flex gap-2 mt-2">
    <button
      onClick={() => setSubPlatform('x_thread')}
      className={`px-3 py-1.5 text-xs rounded-lg border transition-colors ${
        subPlatform === 'x_thread'
          ? 'border-[var(--accent)] bg-[rgba(99,102,241,0.1)] text-[var(--accent)]'
          : 'border-[rgba(255,255,255,0.1)] text-[var(--text-muted)] hover:border-[rgba(255,255,255,0.2)]'
      }`}
    >
      Thread
    </button>
    <button
      onClick={() => setSubPlatform('x_post')}
      className={`px-3 py-1.5 text-xs rounded-lg border transition-colors ${
        subPlatform === 'x_post'
          ? 'border-[var(--accent)] bg-[rgba(99,102,241,0.1)] text-[var(--accent)]'
          : 'border-[rgba(255,255,255,0.1)] text-[var(--text-muted)] hover:border-[rgba(255,255,255,0.2)]'
      }`}
    >
      Post
    </button>
  </div>
)}
```

Add state for subPlatform in the modal:

```typescript
const [subPlatform, setSubPlatform] = useState<string>('linkedin_article');
```

Update the platform selection handler to set defaults and show Pro lock:

```typescript
// When platform changes, set default sub-platform
useEffect(() => {
  if (platform === 'linkedin') setSubPlatform('linkedin_article');
  else if (platform === 'x') setSubPlatform('x_thread');
}, [platform]);
```

For the Pro lock, wrap LinkedIn/X buttons:

```tsx
{['linkedin', 'x'].includes(p) && user?.subscription_tier !== 'pro' && !user?.is_admin ? (
  <button
    key={p}
    disabled
    className="px-3 py-1.5 text-xs rounded-lg border border-[rgba(255,255,255,0.06)] text-[var(--text-faint)] opacity-50 cursor-not-allowed flex items-center gap-1.5"
  >
    {p === 'linkedin' ? 'LinkedIn' : 'X'}
    <span className="text-[9px] bg-[rgba(99,102,241,0.2)] text-[var(--accent)] px-1.5 py-0.5 rounded-full font-semibold">PRO</span>
  </button>
) : (
  // normal platform button
)}
```

When submitting the draft, use `subPlatform` for LinkedIn/X:

```typescript
const effectivePlatform = (platform === 'linkedin' || platform === 'x') ? subPlatform : platform;
// Pass effectivePlatform to the API call
```

- [ ] **Step 3: Add X thread display in draft cards**

For X thread drafts, split the content into tweets and display with character counts. In the draft card component, add a check:

```tsx
{(draft.platform === 'x_thread' || draft.platform === 'x') && draft.content_text?.match(/^\d+\/\s/) && (
  <div className="space-y-2 mt-2">
    {draft.content_text.split(/\n(?=\d+\/\s)/).map((tweet, i) => (
      <div key={i} className="flex items-start gap-2 bg-[rgba(255,255,255,0.02)] rounded-lg px-3 py-2 border border-[rgba(255,255,255,0.05)]">
        <span className="text-[10px] text-[var(--text-faint)] font-mono mt-0.5 flex-shrink-0">{i + 1}</span>
        <p className="text-xs text-[var(--text-secondary)] flex-1">{tweet.replace(/^\d+\/\s*/, '').trim()}</p>
        <span className={`text-[10px] flex-shrink-0 font-mono ${
          tweet.length <= 280 ? 'text-emerald-500' : 'text-red-400'
        }`}>
          {tweet.trim().length}
        </span>
      </div>
    ))}
  </div>
)}
```

- [ ] **Step 4: Build and verify**

Run: `cd frontend && npm run build`
Expected: Build succeeds with no type errors.

- [ ] **Step 5: Commit**

```bash
git add frontend/components/PlatformBadge.tsx frontend/app/content/page.tsx
git commit -m "feat: add LinkedIn and X to frontend platform badge and content page"
```

---

## Task 12: Content Settings — LinkedIn/X Toggles

**Files:**
- Modify: `frontend/app/content/page.tsx` (content settings section)
- Modify: `backend/app/routers/content.py` (settings endpoint Pro gate)

- [ ] **Step 1: Add Pro gate to content settings endpoint**

In the backend content settings update endpoint, add:

```python
    from app.dependencies import require_pro_for_platform
    if request.platform in ("linkedin", "x"):
        require_pro_for_platform(request.platform, user)
```

- [ ] **Step 2: Update frontend content settings toggles**

In the content settings section of the content page, add LinkedIn and X toggles alongside the existing platform toggles. For non-Pro users, render them as locked:

```tsx
{['reddit', 'quora', 'medium', 'wikipedia', 'linkedin', 'x'].map((p) => {
  const isPro = ['linkedin', 'x'].includes(p);
  const isLocked = isPro && user?.subscription_tier !== 'pro' && !user?.is_admin;

  return (
    <div key={p} className={`flex items-center justify-between py-2 ${isLocked ? 'opacity-50' : ''}`}>
      <div className="flex items-center gap-2">
        <PlatformBadge platform={p} size="sm" />
        {isLocked && (
          <span className="text-[9px] bg-[rgba(99,102,241,0.2)] text-[var(--accent)] px-1.5 py-0.5 rounded-full font-semibold">PRO</span>
        )}
      </div>
      <button
        disabled={isLocked}
        onClick={() => togglePlatform(p)}
        className={/* toggle switch styles */}
      >
        {/* toggle switch */}
      </button>
    </div>
  );
})}
```

- [ ] **Step 3: Build and verify**

Run: `cd frontend && npm run build`
Expected: Build succeeds.

- [ ] **Step 4: Commit**

```bash
git add frontend/app/content/page.tsx backend/app/routers/content.py
git commit -m "feat: add LinkedIn/X toggles to content settings with Pro gate"
```

---

## Task 13: Final Integration Verification

- [ ] **Step 1: Run full backend test suite**

Run: `cd backend && python -m pytest tests/ -v --timeout=30`
Expected: All tests pass (existing + new).

- [ ] **Step 2: Run frontend build**

Run: `cd frontend && npm run build`
Expected: Build succeeds.

- [ ] **Step 3: Run frontend lint**

Run: `cd frontend && npm run lint`
Expected: No errors.

- [ ] **Step 4: Manual smoke test checklist**

Start dev servers and verify:
- [ ] Pro user can see LinkedIn/X in the draft platform selector with sub-selectors
- [ ] Starter user sees LinkedIn/X as locked with Pro badge
- [ ] Pro user can generate a LinkedIn Article draft
- [ ] Pro user can generate an X Thread draft
- [ ] X Thread draft displays tweet-by-tweet with character counts
- [ ] Opportunity tab shows balanced feed across platforms (if opportunities exist)
- [ ] Content settings show LinkedIn/X toggles (locked for non-Pro)
- [ ] PlatformBadge renders correctly for LinkedIn and X drafts/opportunities

- [ ] **Step 5: Final commit**

```bash
git add -A
git commit -m "feat: LinkedIn and X integration — complete implementation"
```
