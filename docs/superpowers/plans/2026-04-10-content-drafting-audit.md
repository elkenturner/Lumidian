# Content Drafting Audit Fixes — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix LinkedIn/X draft generation, add stale opportunity filtering with recency sort, and rename the DraftAttribution table to resolve naming confusion.

**Architecture:** Four independent backend fixes — no frontend changes. Fix 1 is a one-line semantic fix. Fix 2 modifies the opportunity listing query and adds a Python-side blended sort. Fix 3 renames an ORM table with a migration. Fix 4 updates the test truncation list.

**Tech Stack:** Python 3.11, FastAPI, SQLAlchemy 2.0 (async), SQLite, pytest

---

### Task 1: Fix LinkedIn/X platform resolution in auto-draft

**Files:**
- Modify: `backend/app/services/drafting_service.py:978-981`
- Test: `backend/tests/test_platform_specs.py`

- [ ] **Step 1: Write a failing test for resolve_platform_key in enabled_platforms**

Add to `backend/tests/test_platform_specs.py`:

```python
from app.services.drafting.platforms import resolve_platform_key


def test_resolve_platform_key_maps_base_names():
    assert resolve_platform_key("linkedin") == "linkedin_article"
    assert resolve_platform_key("x") == "x_thread"


def test_resolve_platform_key_passes_through_variants():
    assert resolve_platform_key("reddit") == "reddit"
    assert resolve_platform_key("quora") == "quora"
    assert resolve_platform_key("medium") == "medium"
    assert resolve_platform_key("wikipedia") == "wikipedia"
    assert resolve_platform_key("linkedin_article") == "linkedin_article"
    assert resolve_platform_key("x_post") == "x_post"


def test_resolved_base_names_are_in_content_platforms():
    """Verifies that after resolution, base names like 'linkedin' and 'x'
    land in CONTENT_PLATFORMS — the bug that caused silent filtering."""
    assert resolve_platform_key("linkedin") in CONTENT_PLATFORMS
    assert resolve_platform_key("x") in CONTENT_PLATFORMS
```

- [ ] **Step 2: Run tests to verify they pass (these test the existing helper, not the bug)**

Run: `cd backend && python -m pytest tests/test_platform_specs.py -v`

Expected: All new tests PASS (the `resolve_platform_key` function itself works; the bug is that it's not called).

- [ ] **Step 3: Fix the enabled_platforms list comprehension**

In `backend/app/services/drafting_service.py`, replace lines 978-981:

```python
    enabled_platforms = [
        s.platform for s in enabled_settings
        if s.platform in CONTENT_PLATFORMS
    ]
```

With:

```python
    enabled_platforms = [
        resolve_platform_key(s.platform) for s in enabled_settings
        if resolve_platform_key(s.platform) in CONTENT_PLATFORMS
    ]
```

`resolve_platform_key` is already imported at line 58.

- [ ] **Step 4: Run all existing tests to verify no regressions**

Run: `cd backend && python -m pytest tests/test_platform_specs.py tests/test_drafting_service.py tests/test_content.py -v`

Expected: All PASS.

- [ ] **Step 5: Commit**

```bash
cd backend
git add app/services/drafting_service.py tests/test_platform_specs.py
git commit -m "fix: wire resolve_platform_key into auto-draft platform selection

LinkedIn/X base names ('linkedin', 'x') from BrandContentSettings were
silently dropped because they didn't match CONTENT_PLATFORMS variant names.
Now maps through resolve_platform_key() before the membership check.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

### Task 2: Add 90-day cutoff and recency-blended sort to opportunity listing

**Files:**
- Modify: `backend/app/routers/opportunities.py:58-90`
- Test: `backend/tests/test_opportunities.py` (create new)

- [ ] **Step 1: Write failing tests for stale filtering and blended sort**

Create `backend/tests/test_opportunities.py`:

```python
"""
Tests for opportunity listing: staleness filtering and recency-blended sort.
"""
from datetime import UTC, datetime, timedelta
from unittest.mock import AsyncMock, patch

import httpx
import pytest

from tests.conftest import create_brand, register_and_login

pytestmark = pytest.mark.asyncio


async def _seed_opportunity(db, brand_id: int, platform: str, relevance: float,
                            posted_at: datetime, prompt_id: int | None = None,
                            status: str = "new"):
    """Insert a ContentOpportunity directly into the DB."""
    from app.models import ContentOpportunity
    opp = ContentOpportunity(
        brand_id=brand_id,
        platform=platform,
        thread_url=f"https://example.com/{platform}/{relevance}",
        thread_title=f"Test {platform} opportunity",
        relevance_score=relevance,
        posted_at=posted_at,
        prompt_id=prompt_id,
        status=status,
    )
    db.add(opp)
    await db.commit()
    await db.refresh(opp)
    return opp


async def test_opportunities_excludes_older_than_90_days(client: httpx.AsyncClient, db_session):
    """Opportunities posted more than 90 days ago should not appear."""
    tokens = await register_and_login(client, email="stale@example.com")
    brand = await create_brand(client, name="Stale Test Brand")
    brand_id = brand["id"]

    now = datetime.now(UTC).replace(tzinfo=None)
    # One fresh (5 days old), one stale (100 days old)
    await _seed_opportunity(db_session, brand_id, "reddit", 80.0, now - timedelta(days=5))
    await _seed_opportunity(db_session, brand_id, "quora", 90.0, now - timedelta(days=100))

    resp = await client.get(f"/api/opportunities/{brand_id}")
    assert resp.status_code == 200
    opps = resp.json()
    assert len(opps) == 1
    assert opps[0]["platform"] == "reddit"


async def test_opportunities_recency_boosts_fresh_over_stale(client: httpx.AsyncClient, db_session):
    """A moderately relevant fresh opportunity should rank above a highly relevant old one."""
    tokens = await register_and_login(client, email="recency@example.com")
    brand = await create_brand(client, name="Recency Test Brand")
    brand_id = brand["id"]

    now = datetime.now(UTC).replace(tzinfo=None)
    # Old high-relevance: 80 * 0.7 + 20 * 0.3 = 62
    await _seed_opportunity(db_session, brand_id, "quora", 80.0, now - timedelta(days=80))
    # Fresh moderate-relevance: 60 * 0.7 + 100 * 0.3 = 72
    await _seed_opportunity(db_session, brand_id, "reddit", 60.0, now - timedelta(days=2))

    resp = await client.get(f"/api/opportunities/{brand_id}")
    assert resp.status_code == 200
    opps = resp.json()
    # Both on different platforms so interleaving puts one of each, but
    # with only 2 items the first should be the fresh one (higher blended score)
    assert len(opps) == 2
    assert opps[0]["platform"] == "reddit"


async def test_opportunities_90_day_boundary(client: httpx.AsyncClient, db_session):
    """Opportunity at exactly 89 days should appear, 91 days should not."""
    tokens = await register_and_login(client, email="boundary@example.com")
    brand = await create_brand(client, name="Boundary Test Brand")
    brand_id = brand["id"]

    now = datetime.now(UTC).replace(tzinfo=None)
    await _seed_opportunity(db_session, brand_id, "reddit", 70.0, now - timedelta(days=89))
    await _seed_opportunity(db_session, brand_id, "quora", 70.0, now - timedelta(days=91))

    resp = await client.get(f"/api/opportunities/{brand_id}")
    assert resp.status_code == 200
    opps = resp.json()
    assert len(opps) == 1
    assert opps[0]["platform"] == "reddit"
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd backend && python -m pytest tests/test_opportunities.py -v`

Expected: FAIL — no age filtering exists yet, stale opportunities still returned and sort order is pure relevance.

- [ ] **Step 3: Implement the 90-day cutoff and blended sort**

In `backend/app/routers/opportunities.py`, make these changes:

First, update the imports at the top (line 20-22):

```python
from datetime import UTC, datetime, timedelta

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
```

Then add the blended score helper after `_enrich_opportunity` (after line 55):

```python
def _blended_score(opp: ContentOpportunity) -> float:
    """Blend relevance (70%) with recency (30%) for sort ordering."""
    rel = opp.relevance_score or 0
    posted = opp.posted_at or opp.created_at
    now = datetime.now(UTC).replace(tzinfo=None)
    age_days = (now - posted).days if posted else 90
    if age_days <= 7:
        recency = 100
    elif age_days <= 30:
        recency = 70
    elif age_days <= 60:
        recency = 40
    else:
        recency = 20
    return rel * 0.7 + recency * 0.3
```

Then modify `list_opportunities` (lines 69-83). Replace:

```python
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
```

With:

```python
    cutoff = datetime.now(UTC).replace(tzinfo=None) - timedelta(days=90)

    stmt = (
        select(ContentOpportunity)
        .where(ContentOpportunity.brand_id == brand_id)
        .where(
            func.coalesce(ContentOpportunity.posted_at, ContentOpportunity.created_at) >= cutoff
        )
    )
    if opp_status is not None:
        stmt = stmt.where(ContentOpportunity.status == opp_status)
    else:
        stmt = stmt.where(ContentOpportunity.status == "new")

    result = await db.execute(stmt)
    all_opps = list(result.scalars().all())

    # Sort by blended relevance + recency score (Python-side, small dataset)
    all_opps.sort(key=_blended_score, reverse=True)
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd backend && python -m pytest tests/test_opportunities.py -v`

Expected: All 3 tests PASS.

- [ ] **Step 5: Run full test suite for regressions**

Run: `cd backend && python -m pytest tests/ -v`

Expected: All PASS.

- [ ] **Step 6: Commit**

```bash
cd backend
git add app/routers/opportunities.py tests/test_opportunities.py
git commit -m "fix: add 90-day cutoff and recency-blended sort for opportunities

Stale opportunities (especially Quora) were persisting indefinitely.
Now filters out anything older than 90 days and sorts by a 70/30
relevance/recency blend so fresh threads rank above old high-relevance ones.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

### Task 3: Rename DraftAttribution table to draft_attributions

**Files:**
- Modify: `backend/app/models.py:495`
- Modify: `backend/app/database.py:309` (add migration before closing bracket)
- Test: `backend/tests/test_content.py`

- [ ] **Step 1: Write a failing test that the table name is correct**

Add to the bottom of `backend/tests/test_content.py`:

```python
def test_draft_attribution_table_name():
    """DraftAttribution must use 'draft_attributions' table, not 'content_attributions'."""
    from app.models import DraftAttribution
    assert DraftAttribution.__tablename__ == "draft_attributions"
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd backend && python -m pytest tests/test_content.py::test_draft_attribution_table_name -v`

Expected: FAIL — `AssertionError: assert 'content_attributions' == 'draft_attributions'`

- [ ] **Step 3: Rename the table in the ORM model**

In `backend/app/models.py`, replace line 495:

```python
    __tablename__ = "content_attributions"
```

With:

```python
    __tablename__ = "draft_attributions"
```

- [ ] **Step 4: Add the database migration**

In `backend/app/database.py`, add this entry at the end of the `migrations` list (before the closing `]` at line 310):

```python
        # 2026-04-10: Rename DraftAttribution table to avoid confusion with ContentAttribution
        "ALTER TABLE content_attributions RENAME TO draft_attributions",
```

- [ ] **Step 5: Run the table name test to verify it passes**

Run: `cd backend && python -m pytest tests/test_content.py::test_draft_attribution_table_name -v`

Expected: PASS.

- [ ] **Step 6: Run full test suite for regressions**

Run: `cd backend && python -m pytest tests/ -v`

Expected: All PASS.

- [ ] **Step 7: Commit**

```bash
cd backend
git add app/models.py app/database.py
git commit -m "fix: rename DraftAttribution table from content_attributions to draft_attributions

Resolves naming confusion with the ContentAttribution model which maps to
the content_attribution (singular) table. Migration renames existing table.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

### Task 4: Add draft_attributions to test truncation list

**Files:**
- Modify: `backend/tests/conftest.py:72`

- [ ] **Step 1: Add draft_attributions to the truncation list**

In `backend/tests/conftest.py`, replace line 72:

```python
            "analytics_events", "content_attribution", "content_posts",
```

With:

```python
            "analytics_events", "draft_attributions", "content_attribution", "content_posts",
```

`"draft_attributions"` is added before `"content_attribution"` since draft_attributions has no FK dependency on content_attribution, but placing it early ensures it's cleared before tables it references (content_drafts, brands) are cleared later in the list.

- [ ] **Step 2: Run full test suite to verify no regressions**

Run: `cd backend && python -m pytest tests/ -v`

Expected: All PASS.

- [ ] **Step 3: Commit**

```bash
cd backend
git add tests/conftest.py
git commit -m "fix: add draft_attributions to test truncation list

DraftAttribution rows were not being cleaned between tests. Now properly
truncated alongside other content tables.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

### Task 5: Final integration verification

- [ ] **Step 1: Run the full test suite**

Run: `cd backend && python -m pytest tests/ -v`

Expected: All PASS. No regressions across all test files.

- [ ] **Step 2: Verify the application starts cleanly**

Run: `cd backend && source venv/bin/activate && timeout 5 python -c "from app.main import app; print('App loaded OK')" || true`

Expected: `App loaded OK` — verifies imports and model registration work.

- [ ] **Step 3: Spot-check the migration runs without error**

Run:
```bash
cd backend && source venv/bin/activate && python -c "
import asyncio
from app.database import run_migrations
asyncio.run(run_migrations())
print('Migrations OK')
"
```

Expected: `Migrations OK` — the rename migration either succeeds or is silently skipped (table already renamed or doesn't exist yet).
