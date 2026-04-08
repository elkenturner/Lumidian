# Live Opportunities: Quora Date Fix & Platform Balance

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix Quora opportunities showing no dates and dominating the feed over Reddit results.

**Architecture:** Three targeted fixes — (1) pass the `date` field through from Serper.dev results, (2) add recency weighting to Quora scoring to match Reddit's formula, (3) fix the lead cap to sort by actual post date. No frontend changes needed.

**Tech Stack:** Python, FastAPI, SQLAlchemy, pytest

---

## File Map

| File | Action | Responsibility |
|------|--------|---------------|
| `backend/app/services/quora_search_service.py` | Modify lines 131-135 | Pass `date` field through from Serper.dev organic results |
| `backend/app/services/quora_scanner_service.py` | Modify lines 81-110, 188-203, 229-253 | Add recency to scoring, reorder date parse before score, fix lead cap sort |
| `backend/tests/test_quora_scanner.py` | Modify existing + add new tests | Cover date passthrough, recency scoring, lead cap behavior |

---

### Task 1: Fix Quora date field passthrough

The `search_quora_questions()` function in `quora_search_service.py` extracts `title`, `url`, `snippet` from Serper.dev organic results but drops the `date` field. The scanner calls `q.get("date")` which always returns `None`. This is why all 150 Quora opportunities in the DB have `posted_at = NULL`.

**Files:**
- Modify: `backend/app/services/quora_search_service.py:131-135`
- Test: `backend/tests/test_quora_scanner.py`

- [ ] **Step 1: Write failing test for date passthrough**

Add to `backend/tests/test_quora_scanner.py`:

```python
def test_search_quora_passes_date_field():
    """search_quora_questions must include the 'date' field from Serper results."""
    from unittest.mock import patch, MagicMock
    import app.services.quora_search_service as svc

    fake_response = MagicMock()
    fake_response.status_code = 200
    fake_response.json.return_value = {
        "organic": [
            {
                "link": "https://www.quora.com/What-is-the-best-SaaS-tool",
                "title": "What is the best SaaS tool - Quora",
                "snippet": "some snippet",
                "date": "3 days ago",
            }
        ]
    }
    fake_response.raise_for_status = MagicMock()

    with patch.dict("os.environ", {"SERPER_API_KEY": "fake-key"}), \
         patch("httpx.Client") as mock_client:
        mock_client.return_value.__enter__ = MagicMock(return_value=MagicMock(
            post=MagicMock(return_value=fake_response)
        ))
        mock_client.return_value.__exit__ = MagicMock(return_value=False)
        results = svc.search_quora_questions("saas tool", num_results=5)

    assert len(results) >= 1
    assert "date" in results[0]
    assert results[0]["date"] == "3 days ago"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && python -m pytest tests/test_quora_scanner.py::test_search_quora_passes_date_field -v`
Expected: FAIL — `assert "date" in results[0]` because the field is not passed through.

- [ ] **Step 3: Fix the passthrough**

In `backend/app/services/quora_search_service.py`, change the `results.append(...)` block (lines 131-135):

```python
# OLD (lines 131-135):
        results.append({
            'title': _clean_title(title),
            'url': url,
            'snippet': snippet,
        })

# NEW:
        results.append({
            'title': _clean_title(title),
            'url': url,
            'snippet': snippet,
            'date': item.get('date', ''),
        })
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && python -m pytest tests/test_quora_scanner.py::test_search_quora_passes_date_field -v`
Expected: PASS

- [ ] **Step 5: Run full test suite to check for regressions**

Run: `cd backend && python -m pytest tests/test_quora_scanner.py -v`
Expected: All tests PASS (existing tests don't depend on the absence of `date`).

- [ ] **Step 6: Commit**

```bash
git add backend/app/services/quora_search_service.py backend/tests/test_quora_scanner.py
git commit -m "fix: pass date field through from Serper.dev results in Quora search"
```

---

### Task 2: Add recency weighting to Quora scoring

Currently `_score_question` returns `keyword_overlap * 100` — pure relevance with zero recency factor. A 5-year-old Quora question scores identically to one posted today. Reddit's `_score_thread` uses `relevance * 70 + recency * 20 + engagement * 10`. Quora has no engagement data, so we use `relevance * 70 + recency * 30`.

**Files:**
- Modify: `backend/app/services/quora_scanner_service.py:81-110`
- Test: `backend/tests/test_quora_scanner.py`

- [ ] **Step 1: Write failing tests for recency scoring**

Add to `backend/tests/test_quora_scanner.py`:

```python
from datetime import UTC, datetime, timedelta


def test_score_recent_question_higher_than_old():
    """A recent question should score higher than an identical old one."""
    recent = datetime.now(UTC).replace(tzinfo=None) - timedelta(days=2)
    old = datetime.now(UTC).replace(tzinfo=None) - timedelta(days=120)
    score_recent = _score_question(
        "What is the best project management saas tool for teams",
        "project management saas tool remote teams",
        "what is the best project management saas tool",
        posted_at=recent,
    )
    score_old = _score_question(
        "What is the best project management saas tool for teams",
        "project management saas tool remote teams",
        "what is the best project management saas tool",
        posted_at=old,
    )
    assert score_recent > score_old


def test_score_no_date_assumes_moderately_old():
    """When posted_at is None (date unknown), score uses a penalty but not zero."""
    score_with_date = _score_question(
        "What is the best project management saas tool for teams",
        "project management saas tool remote teams",
        "what is the best project management saas tool",
        posted_at=datetime.now(UTC).replace(tzinfo=None) - timedelta(days=5),
    )
    score_no_date = _score_question(
        "What is the best project management saas tool for teams",
        "project management saas tool remote teams",
        "what is the best project management saas tool",
        posted_at=None,
    )
    assert score_no_date > 0
    assert score_with_date > score_no_date


def test_score_old_question_not_zero():
    """Very old questions still get a non-zero score if relevant (evergreen content)."""
    old = datetime.now(UTC).replace(tzinfo=None) - timedelta(days=365)
    score = _score_question(
        "What is the best project management saas tool for teams",
        "project management saas tool remote teams",
        "what is the best project management saas tool",
        posted_at=old,
    )
    assert score > 0
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && python -m pytest tests/test_quora_scanner.py::test_score_recent_question_higher_than_old tests/test_quora_scanner.py::test_score_no_date_assumes_moderately_old tests/test_quora_scanner.py::test_score_old_question_not_zero -v`
Expected: FAIL — `_score_question` doesn't accept `posted_at` parameter.

- [ ] **Step 3: Implement recency-weighted scoring**

Replace `_score_question` in `backend/app/services/quora_scanner_service.py` (lines 81-110):

```python
def _score_question(
    title: str,
    snippet: str,
    prompt_text: str,
    posted_at: datetime | None = None,
) -> float:
    """Relevance + recency score for a Quora question, aligned with Reddit scoring."""
    import re

    _STOP = frozenset("""
        a an the is are was were be to of and or in on at for with by from
        this that these those it its i we you they he she my your our their
        do does did can could would should may might will what which who when
        where why how have has had been being about up out some any all also
        just now get more most very really quite too so then than
    """.split())

    def keywords(text: str) -> set[str]:
        words = re.sub(r"[^a-z0-9\s]", "", text.lower()).split()
        return {w for w in words if w not in _STOP and len(w) > 2}

    prompt_kw = keywords(prompt_text)
    if not prompt_kw:
        return 0.0

    combined = title + " " + snippet
    q_kw = keywords(combined)
    matches = len(prompt_kw & q_kw)
    relevance = min(1.0, matches / len(prompt_kw))

    # Need at least 2 keyword matches
    if matches < 2:
        return 0.0

    # Recency — graduated, matching Reddit's approach
    if posted_at is not None:
        age_days = (datetime.now(UTC).replace(tzinfo=None) - posted_at).total_seconds() / 86400
    else:
        age_days = 180  # Unknown date → assume moderately old

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
```

- [ ] **Step 4: Update existing tests that assert exact scores**

The test `test_score_question_two_matches_returns_score` expects 25.0 (old formula: `0.25 * 100`). New formula with no date: `0.25 * 70 + 0.05 * 30 = 19.0`. Update the assertion:

In `backend/tests/test_quora_scanner.py`, find and update:

```python
# OLD:
def test_score_question_two_matches_returns_score():
    """2 keyword matches returns a score (minimum threshold is 2)."""
    score = _score_question(
        title="advisory platform review",
        snippet="short snippet here",
        prompt_text="what is the best reg a+ advisory platform for direct listings and capital raise",
    )
    assert score == 25.0

# NEW:
def test_score_question_two_matches_returns_score():
    """2 keyword matches returns a score (minimum threshold is 2)."""
    score = _score_question(
        title="advisory platform review",
        snippet="short snippet here",
        prompt_text="what is the best reg a+ advisory platform for direct listings and capital raise",
    )
    assert score == 19.0  # relevance=0.25 * 70 + recency=0.05 * 30 (no date → old)
```

Also update `test_score_high_overlap` which asserts `>= 40.0` — this should still pass since high overlap with no date gives `~71.5` minimum, but verify.

- [ ] **Step 5: Run all scoring tests**

Run: `cd backend && python -m pytest tests/test_quora_scanner.py -k "score" -v`
Expected: All PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/app/services/quora_scanner_service.py backend/tests/test_quora_scanner.py
git commit -m "fix: add recency weighting to Quora scoring to match Reddit formula"
```

---

### Task 3: Reorder scanner to parse date before scoring

Currently `scan_brand_opportunities` calls `_score_question(title, snippet, prompt.text)` on line 199, then parses the date on line 203. Now that `_score_question` accepts `posted_at`, the date must be parsed first and passed to the scorer.

**Files:**
- Modify: `backend/app/services/quora_scanner_service.py:188-220`
- Test: `backend/tests/test_quora_scanner.py`

- [ ] **Step 1: Write failing test that verifies recent questions score higher in scan results**

Add to `backend/tests/test_quora_scanner.py`:

```python
@pytest.mark.asyncio
async def test_scan_recent_question_scores_higher(tmp_db):
    """A question with a recent date should get a higher relevance_score than one without."""
    from sqlalchemy import select
    from app.database import AsyncSessionLocal
    from app.models import ContentOpportunity
    from app.services import quora_scanner_service

    brand_id = await tmp_db.create_brand_with_prompt(
        name="RecencyTest",
        prompt="what is the best project management saas tool",
    )
    questions = [
        {
            "url": "https://www.quora.com/What-is-the-best-project-management-saas-tool-recent",
            "title": "What is the best project management saas tool for teams",
            "snippet": "project management saas tool remote teams",
            "date": "2 days ago",
        },
        {
            "url": "https://www.quora.com/What-is-the-best-project-management-saas-tool-old",
            "title": "What is the best project management saas tool for teams",
            "snippet": "project management saas tool remote teams",
            "date": "",
        },
    ]
    with patch("app.services.quora_search_service.search_quora_questions", return_value=questions):
        await quora_scanner_service.scan_brand_opportunities(brand_id)

    async with AsyncSessionLocal() as db:
        result = await db.execute(
            select(ContentOpportunity).where(
                ContentOpportunity.brand_id == brand_id,
                ContentOpportunity.platform == "quora",
            )
        )
        opps = {o.thread_url: o for o in result.scalars().all()}

    recent = opps["https://www.quora.com/What-is-the-best-project-management-saas-tool-recent"]
    old = opps["https://www.quora.com/What-is-the-best-project-management-saas-tool-old"]
    assert recent.relevance_score > old.relevance_score
    assert recent.posted_at is not None
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && python -m pytest tests/test_quora_scanner.py::test_scan_recent_question_scores_higher -v`
Expected: FAIL — both questions get the same score because date isn't passed to `_score_question`.

- [ ] **Step 3: Reorder the scanner loop**

In `backend/app/services/quora_scanner_service.py`, replace lines 189-219 (the `for q in questions:` loop):

```python
            for q in questions:
                url: str = q.get("url", "")
                title: str = q.get("title", "")
                snippet: str = q.get("snippet", "")

                if not url or not title:
                    continue
                if url in existing_urls:
                    continue

                posted_at = _parse_serper_date(q.get("date"))

                score = _score_question(title, snippet, prompt.text, posted_at=posted_at)
                if score < _MIN_SCORE:
                    continue

                opp = ContentOpportunity(
                    brand_id=brand_id,
                    platform="quora",
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
```

Key change: `_parse_serper_date` moved ABOVE `_score_question`, and `posted_at` is passed to the scorer.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && python -m pytest tests/test_quora_scanner.py::test_scan_recent_question_scores_higher -v`
Expected: PASS

- [ ] **Step 5: Run full Quora test suite**

Run: `cd backend && python -m pytest tests/test_quora_scanner.py -v`
Expected: All PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/app/services/quora_scanner_service.py backend/tests/test_quora_scanner.py
git commit -m "fix: parse Quora date before scoring so recency affects relevance"
```

---

### Task 4: Fix lead cap to sort fresh slots by posted_at

The Quora lead cap reserves 10 "fresh" slots sorted by `created_at` (DB insertion time). This should sort by `posted_at` (actual question date) so truly recent questions are preserved. Falls back to `created_at` when `posted_at` is `None`.

**Files:**
- Modify: `backend/app/services/quora_scanner_service.py:229-253`

- [ ] **Step 1: Fix the fresh-slot sort key**

In `backend/app/services/quora_scanner_service.py`, find the lead cap section (around line 243-246) and change the sort key:

```python
# OLD (line 243):
            by_recency = sorted(remaining, key=lambda o: o.created_at, reverse=True)

# NEW:
            by_recency = sorted(
                remaining,
                key=lambda o: o.posted_at or o.created_at,
                reverse=True,
            )
```

- [ ] **Step 2: Run full Quora test suite**

Run: `cd backend && python -m pytest tests/test_quora_scanner.py -v`
Expected: All PASS.

- [ ] **Step 3: Commit**

```bash
git add backend/app/services/quora_scanner_service.py
git commit -m "fix: sort Quora fresh lead slots by posted_at instead of created_at"
```

---

### Task 5: Final integration verification

- [ ] **Step 1: Run full backend test suite**

Run: `cd backend && python -m pytest tests/ -v`
Expected: All PASS, no regressions.

- [ ] **Step 2: Verify scoring alignment**

Confirm the two scoring formulas are now structurally aligned:

| Factor | Reddit `_score_thread` | Quora `_score_question` |
|--------|----------------------|------------------------|
| Relevance | `relevance * 70` | `relevance * 70` |
| Recency | `recency * 20` | `recency * 30` |
| Engagement | `engagement * 10` | N/A (no data) |
| Brand bonus | `+10` if mentioned | N/A |

Both produce scores in the 0-100 range with the same relevance weight.
Quora gives 30% to recency (vs Reddit's 20%) because it lacks engagement data.

- [ ] **Step 3: Commit all work**

If any uncommitted changes remain, commit them.
