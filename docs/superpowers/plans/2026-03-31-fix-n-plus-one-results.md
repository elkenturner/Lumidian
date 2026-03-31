# Fix N+1 in Results & Reports Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix a broken attribute access in the PDF export endpoint and add regression test coverage for all results + reports endpoints.

**Architecture:** Two tasks. Task 1 adds `test_results.py` (results overview, trends, responses + a test that exposes the `reports.py` bug). Task 2 fixes the `reports.py` line-89 bug where `qr.prompt_text` accesses a non-existent column on `QueryResult` — it raises `AttributeError` every time the PDF export endpoint processes a run with query results. The `prompts` dict is already preloaded in a single query on line 70, so the fix is to remove the broken attribute access entirely.

**Tech Stack:** Python 3.11+, FastAPI, SQLAlchemy 2.0 async, pytest, pytest-asyncio, httpx.

---

## File Map

- **Create:** `backend/tests/test_results.py` — HTTP-level tests for `/api/results/{brand_id}/overview`, `/trends`, `/responses`, and `/api/reports/{brand_id}/export`
- **Modify:** `backend/app/routers/reports.py:89` — remove `qr.prompt_text or` (attribute does not exist on `QueryResult` model)

---

### Task 1: Add `test_results.py` — coverage for results and reports endpoints

**Files:**
- Create: `backend/tests/test_results.py`

**Setup pattern used in all tests:** Register+login via HTTP, create brand via HTTP, then insert `TrackingRun` + `QueryResult` + `RunModelScore` records directly via `db_session` fixture (because there's no way to trigger a real run in tests).

---

- [ ] **Step 1: Create `backend/tests/test_results.py` with all tests**

```python
"""
Tests for:
  GET /api/results/{brand_id}/overview    — latest run stats + model breakdown
  GET /api/results/{brand_id}/trends      — all completed runs
  GET /api/results/{brand_id}/responses   — paginated query results
  GET /api/reports/{brand_id}/export      — PDF download
"""
from __future__ import annotations

import pytest
import httpx
from sqlalchemy.ext.asyncio import AsyncSession
from tests.conftest import register_and_login, create_brand
from app.database import AsyncSessionLocal
from app.models import TrackingRun, QueryResult, RunModelScore


pytestmark = pytest.mark.asyncio


# ── Helpers ───────────────────────────────────────────────────────────────────

async def _insert_completed_run(
    brand_id: int,
    prompt_id: int,
    *,
    overall_score: float = 75.0,
    model: str = "chatgpt",
) -> int:
    """Insert a completed TrackingRun with one QueryResult and one RunModelScore.
    Returns the run id."""
    from datetime import datetime, timezone
    async with AsyncSessionLocal() as db:
        run = TrackingRun(
            brand_id=brand_id,
            status="completed",
            run_type="manual",
            overall_score=overall_score,
            total_queries=1,
            total_mentions=1,
            has_content_influence=False,
            created_at=datetime.now(timezone.utc).replace(tzinfo=None),
            completed_at=datetime.now(timezone.utc).replace(tzinfo=None),
        )
        db.add(run)
        await db.flush()

        qr = QueryResult(
            tracking_run_id=run.id,
            prompt_id=prompt_id,
            model=model,
            run_number=1,
            response_text="Lumidian is a great tool for AI visibility tracking.",
            mentioned=True,
        )
        db.add(qr)

        ms = RunModelScore(
            tracking_run_id=run.id,
            model=model,
            total_queries=1,
            total_mentions=1,
            score=overall_score,
        )
        db.add(ms)

        await db.commit()
        return run.id


# ── Overview ──────────────────────────────────────────────────────────────────

async def test_overview_no_runs(client: httpx.AsyncClient):
    """Overview returns nulls when no completed runs exist."""
    await register_and_login(client, email="ov_empty@example.com")
    brand = await create_brand(client, name="OV Empty Brand")
    resp = await client.get(f"/api/results/{brand['id']}/overview")
    assert resp.status_code == 200
    data = resp.json()
    assert data["brand_id"] == brand["id"]
    assert data["latest_run"] is None
    assert data["overall_score"] is None
    assert data["model_breakdown"] == []


async def test_overview_returns_latest_run(client: httpx.AsyncClient):
    """Overview returns score and model breakdown from the most recent completed run."""
    await register_and_login(client, email="ov_run@example.com")
    brand = await create_brand(
        client,
        name="OV Run Brand",
        prompts=["What is the best AI visibility tool?"],
    )
    prompt_id = brand["prompts"][0]["id"]
    await _insert_completed_run(brand["id"], prompt_id, overall_score=80.0)

    resp = await client.get(f"/api/results/{brand['id']}/overview")
    assert resp.status_code == 200
    data = resp.json()
    assert data["overall_score"] == pytest.approx(80.0, abs=0.1)
    assert data["latest_run"] is not None
    assert len(data["model_breakdown"]) == 1
    assert data["model_breakdown"][0]["score"] == pytest.approx(80.0, abs=0.1)


async def test_overview_access_control(client: httpx.AsyncClient):
    """User cannot see another user's brand overview."""
    await register_and_login(client, email="ov_owner@example.com")
    brand = await create_brand(client, name="OV Owner Brand")

    await register_and_login(client, email="ov_thief@example.com")
    resp = await client.get(f"/api/results/{brand['id']}/overview")
    assert resp.status_code == 403


# ── Trends ────────────────────────────────────────────────────────────────────

async def test_trends_empty(client: httpx.AsyncClient):
    """Trends returns empty list when no completed runs exist."""
    await register_and_login(client, email="tr_empty@example.com")
    brand = await create_brand(client, name="Trends Empty Brand")
    resp = await client.get(f"/api/results/{brand['id']}/trends")
    assert resp.status_code == 200
    data = resp.json()
    assert data["brand_id"] == brand["id"]
    assert data["trend_data"] == []


async def test_trends_returns_runs_in_order(client: httpx.AsyncClient):
    """Trends returns all completed runs, oldest first."""
    await register_and_login(client, email="tr_runs@example.com")
    brand = await create_brand(
        client,
        name="Trends Runs Brand",
        prompts=["Best AI visibility tools?"],
    )
    prompt_id = brand["prompts"][0]["id"]
    await _insert_completed_run(brand["id"], prompt_id, overall_score=50.0)
    await _insert_completed_run(brand["id"], prompt_id, overall_score=70.0)

    resp = await client.get(f"/api/results/{brand['id']}/trends")
    assert resp.status_code == 200
    data = resp.json()
    assert len(data["trend_data"]) == 2
    # Each point has model_scores populated
    for point in data["trend_data"]:
        assert "chatgpt" in point["model_scores"]


async def test_trends_access_control(client: httpx.AsyncClient):
    """User cannot see another user's brand trends."""
    await register_and_login(client, email="tr_owner@example.com")
    brand = await create_brand(client, name="Trends Owner Brand")

    await register_and_login(client, email="tr_thief@example.com")
    resp = await client.get(f"/api/results/{brand['id']}/trends")
    assert resp.status_code == 403


# ── Responses ─────────────────────────────────────────────────────────────────

async def test_responses_empty(client: httpx.AsyncClient):
    """Responses returns empty paginated list when no runs exist."""
    await register_and_login(client, email="resp_empty@example.com")
    brand = await create_brand(client, name="Resp Empty Brand")
    resp = await client.get(f"/api/results/{brand['id']}/responses")
    assert resp.status_code == 200
    data = resp.json()
    assert data["total"] == 0
    assert data["items"] == []


async def test_responses_returns_prompt_text(client: httpx.AsyncClient):
    """Responses includes prompt_text without triggering lazy loading."""
    await register_and_login(client, email="resp_data@example.com")
    brand = await create_brand(
        client,
        name="Resp Data Brand",
        prompts=["What is the best AI visibility tool?"],
    )
    prompt_id = brand["prompts"][0]["id"]
    await _insert_completed_run(brand["id"], prompt_id, overall_score=60.0)

    resp = await client.get(f"/api/results/{brand['id']}/responses")
    assert resp.status_code == 200
    data = resp.json()
    assert data["total"] == 1
    item = data["items"][0]
    assert item["prompt_text"] == "What is the best AI visibility tool?"
    assert item["mentioned"] is True


async def test_responses_filter_by_run_id(client: httpx.AsyncClient):
    """Responses filtered by run_id returns only results for that run."""
    await register_and_login(client, email="resp_filter@example.com")
    brand = await create_brand(
        client,
        name="Resp Filter Brand",
        prompts=["Best AI tool?"],
    )
    prompt_id = brand["prompts"][0]["id"]
    run_a = await _insert_completed_run(brand["id"], prompt_id, overall_score=40.0)
    await _insert_completed_run(brand["id"], prompt_id, overall_score=80.0)

    resp = await client.get(
        f"/api/results/{brand['id']}/responses",
        params={"run_id": run_a},
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["total"] == 1
    assert data["items"][0]["tracking_run_id"] == run_a


async def test_responses_access_control(client: httpx.AsyncClient):
    """User cannot see another user's brand responses."""
    await register_and_login(client, email="resp_owner@example.com")
    brand = await create_brand(client, name="Resp Owner Brand")

    await register_and_login(client, email="resp_thief@example.com")
    resp = await client.get(f"/api/results/{brand['id']}/responses")
    assert resp.status_code == 403


# ── PDF Export ────────────────────────────────────────────────────────────────

async def test_export_pdf_no_runs(client: httpx.AsyncClient):
    """PDF export with no runs returns a valid PDF (empty report)."""
    await register_and_login(client, email="pdf_empty@example.com")
    brand = await create_brand(client, name="PDF Empty Brand")
    resp = await client.get(f"/api/reports/{brand['id']}/export")
    assert resp.status_code == 200
    assert resp.headers["content-type"] == "application/pdf"
    assert resp.content[:4] == b"%PDF"


async def test_export_pdf_with_run(client: httpx.AsyncClient):
    """PDF export with completed run returns valid PDF.

    This test catches the qr.prompt_text AttributeError bug: accessing a
    non-existent column on QueryResult crashes the endpoint when iterating
    over query_results in the prompt-group loop.
    """
    await register_and_login(client, email="pdf_run@example.com")
    brand = await create_brand(
        client,
        name="PDF Run Brand",
        prompts=["What is the best AI visibility tool?"],
    )
    prompt_id = brand["prompts"][0]["id"]
    await _insert_completed_run(brand["id"], prompt_id, overall_score=65.0)

    resp = await client.get(f"/api/reports/{brand['id']}/export")
    assert resp.status_code == 200
    assert resp.headers["content-type"] == "application/pdf"
    assert resp.content[:4] == b"%PDF"


async def test_export_pdf_access_control(client: httpx.AsyncClient):
    """User cannot export another user's brand PDF."""
    await register_and_login(client, email="pdf_owner@example.com")
    brand = await create_brand(client, name="PDF Owner Brand")

    await register_and_login(client, email="pdf_thief@example.com")
    resp = await client.get(f"/api/reports/{brand['id']}/export")
    assert resp.status_code == 403
```

- [ ] **Step 2: Run the new tests to confirm they fail correctly**

```bash
cd /Users/ken/Desktop/Lumidian/backend && python3 -m pytest tests/test_results.py -v 2>&1 | tail -40
```

Expected: most tests pass, but `test_export_pdf_with_run` should **FAIL** with `AttributeError: 'QueryResult' object has no attribute 'prompt_text'` (or return 500). This confirms the bug exists.

If `test_export_pdf_with_run` **passes**, check what `qr.prompt_text` evaluates to — there may be no bug. In that case, skip Task 2 and commit.

- [ ] **Step 3: Commit the test file (before the fix)**

```bash
cd /Users/ken/Desktop/Lumidian && git add backend/tests/test_results.py && git commit -m "test: add test_results.py — overview, trends, responses, pdf export coverage"
```

---

### Task 2: Fix `qr.prompt_text` bug in `reports.py`

**Files:**
- Modify: `backend/app/routers/reports.py:89`

---

- [ ] **Step 1: Read `backend/app/routers/reports.py`**

Verify line 89 currently reads:
```python
groups[pid] = PGroup(pid, qr.prompt_text or prompts.get(pid, f"Prompt #{pid}"))
```

The `prompts` dict (built on line 70) is a `dict[int, str]` mapping `prompt_id → prompt_text` for all prompts belonging to this brand. Using it is both correct and already-optimized (single query).

- [ ] **Step 2: Fix line 89**

Change:
```python
            groups[pid] = PGroup(pid, qr.prompt_text or prompts.get(pid, f"Prompt #{pid}"))
```

To:
```python
            groups[pid] = PGroup(pid, prompts.get(pid, f"Prompt #{pid}"))
```

This removes the broken `qr.prompt_text` attribute access. The `prompts` dict is the correct data source — it was loaded in a single `SELECT * FROM prompts WHERE brand_id = ?` on line 69–70.

- [ ] **Step 3: Run the failing test to confirm it now passes**

```bash
cd /Users/ken/Desktop/Lumidian/backend && python3 -m pytest tests/test_results.py::test_export_pdf_with_run -v 2>&1
```

Expected: PASS.

- [ ] **Step 4: Run all results tests to confirm no regressions**

```bash
cd /Users/ken/Desktop/Lumidian/backend && python3 -m pytest tests/test_results.py -v 2>&1 | tail -30
```

Expected: all tests pass.

- [ ] **Step 5: Run full test suite to confirm no regressions**

```bash
cd /Users/ken/Desktop/Lumidian/backend && python3 -m pytest tests/ -q 2>&1 | tail -10
```

Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
cd /Users/ken/Desktop/Lumidian && git add backend/app/routers/reports.py && git commit -m "fix: remove qr.prompt_text (non-existent column) in PDF export — use preloaded prompts dict"
```

---

## Self-Review

**Spec coverage:**
- ✅ Bug in `reports.py` line 89 fixed
- ✅ Tests for all 3 results endpoints (overview, trends, responses)
- ✅ Test for PDF export endpoint
- ✅ Access control tests for all 4 endpoints
- ✅ TDD order: tests written first, bug fix second

**Placeholder scan:** No placeholders found.

**Type consistency:** `_insert_completed_run` returns `int` (run id). Used as `run_a` in filter test. Consistent.
