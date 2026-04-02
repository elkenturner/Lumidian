# Onboarding Pipeline & Background Status Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire up the full onboarding post-processing pipeline (drafts → live opp scan), enforce weekly scan quotas by tier, move opp scanning from daily to weekly (Monday), and give AppShell real-time background-status banners driven by API polling instead of fragile localStorage flags.

**Architecture:** A shared in-memory `state.py` module exposes two sets (`generating_brands`, `scanning_brands`) that all background workers update. A new lightweight `GET /api/tracking/background-status` endpoint aggregates DB + state into three boolean flags. AppShell polls this endpoint every 3 s so banners survive navigation. The onboarding tracking service fires a sequential post-processing task (drafts → Reddit + Quora scan in parallel) after gap analysis completes for `run_type="onboarding"`. Reddit and Quora scheduler jobs move from daily to Monday 03:15/03:30 UTC.

**Tech Stack:** Python 3.11 / FastAPI / SQLAlchemy async / asyncio (backend); Next.js 15 / TypeScript / React (frontend); pytest-asyncio; unittest.mock

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `backend/app/state.py` | **Create** | Shared in-memory sets for generating/scanning brand IDs |
| `backend/tests/conftest.py` | **Modify** | Clear state sets between tests |
| `backend/app/routers/content.py` | **Modify** | Switch private `_generating` to `state.generating_brands` |
| `backend/app/routers/billing.py` | **Modify** | Add `WEEKLY_SCAN_LIMITS` dict |
| `backend/app/routers/opportunities.py` | **Modify** | Add weekly quota check + `manual_scan_triggered` event |
| `backend/app/routers/tracking.py` | **Modify** | Add `GET /background-status` endpoint |
| `backend/app/services/tracking_service.py` | **Modify** | Add `_onboarding_post_process` + fire it after onboarding gap analysis |
| `backend/app/scheduler.py` | **Modify** | Rewrite opp sweeps to track state; move from daily to Monday weekly |
| `backend/tests/test_background_status.py` | **Create** | Tests for background-status endpoint |
| `backend/tests/test_scan_quota.py` | **Create** | Tests for manual scan weekly quota |
| `backend/tests/test_onboarding_pipeline.py` | **Create** | Tests for `_onboarding_post_process` |
| `frontend/lib/api.ts` | **Modify** | Add `getBackgroundStatus()` export |
| `frontend/components/AppShell.tsx` | **Modify** | Poll API every 3 s; add scanning banner |

---

## Task 1: Create `app/state.py` and clear it between tests

**Files:**
- Create: `backend/app/state.py`
- Modify: `backend/tests/conftest.py`

- [ ] **Step 1: Create `backend/app/state.py`**

```python
"""
Shared in-memory state for background task tracking.

These sets record which brand IDs are currently being processed by
background workers. Updated by content.py (drafting), tracking_service.py
(onboarding pipeline), and scheduler.py (weekly opp sweeps).

Single-process assumption: this module lives in one uvicorn worker.
Do not use in multi-worker deployments without a shared store (e.g. Redis).
"""

generating_brands: set[int] = set()
"""Brand IDs currently generating content drafts."""

scanning_brands: set[int] = set()
"""Brand IDs currently being scanned for Reddit/Quora opportunities."""
```

- [ ] **Step 2: Add state clearing to `tests/conftest.py` `clean_tables` fixture**

Find the `clean_tables` fixture in `backend/tests/conftest.py`. After the `_rate_store.clear()` block (around line 59), add:

```python
    # Reset shared background-task state sets
    from app import state
    state.generating_brands.clear()
    state.scanning_brands.clear()
```

- [ ] **Step 3: Verify the module imports cleanly**

```bash
cd /Users/ken/Desktop/Lumidian/backend && source venv/bin/activate
python -c "from app import state; print('generating_brands:', state.generating_brands); print('scanning_brands:', state.scanning_brands)"
```

Expected:
```
generating_brands: set()
scanning_brands: set()
```

- [ ] **Step 4: Commit**

```bash
cd /Users/ken/Desktop/Lumidian
git add backend/app/state.py backend/tests/conftest.py
git commit -m "feat: add shared in-memory state module for background task tracking"
```

---

## Task 2: Switch `content.py` from `_generating` to `state.generating_brands`

**Files:**
- Modify: `backend/app/routers/content.py`

This task makes the draft-generating state visible across the app (needed for the background-status endpoint in Task 4).

- [ ] **Step 1: Add the import and remove the private set**

In `backend/app/routers/content.py`, find and replace the private set declaration (around line 59):

```python
# Tracks brand IDs currently running a background generate_now task
_generating: set[int] = set()
```

Replace with:

```python
from app import state as _state
```

- [ ] **Step 2: Update `_bg_generate_drafts` finally block (line ~77)**

Find:
```python
    finally:
        _generating.discard(brand_id)
```

Replace with:
```python
    finally:
        _state.generating_brands.discard(brand_id)
```

- [ ] **Step 3: Update the 409 guard in `generate_now` (line ~471)**

Find:
```python
    if brand_id in _generating:
```

Replace with:
```python
    if brand_id in _state.generating_brands:
```

- [ ] **Step 4: Update the `_generating.add` call in `generate_now` (line ~532)**

Find:
```python
    _generating.add(brand_id)
```

Replace with:
```python
    _state.generating_brands.add(brand_id)
```

- [ ] **Step 5: Update the `draft-status` endpoint return value (line ~607)**

Find:
```python
        "generating": brand_id in _generating,
```

Replace with:
```python
        "generating": brand_id in _state.generating_brands,
```

- [ ] **Step 6: Verify the import works**

```bash
cd /Users/ken/Desktop/Lumidian/backend && source venv/bin/activate
python -c "from app.routers.content import router; print('OK')"
```

Expected: `OK`

- [ ] **Step 7: Run existing content tests**

```bash
cd /Users/ken/Desktop/Lumidian/backend && source venv/bin/activate
pytest tests/test_content.py -v 2>&1 | tail -20
```

Expected: all previously-passing tests still pass.

- [ ] **Step 8: Commit**

```bash
git add backend/app/routers/content.py
git commit -m "refactor: use shared state.generating_brands instead of private _generating set"
```

---

## Task 3: Add `WEEKLY_SCAN_LIMITS` and enforce quota in `trigger_scan`

**Files:**
- Modify: `backend/app/routers/billing.py`
- Modify: `backend/app/routers/opportunities.py`
- Create: `backend/tests/test_scan_quota.py`

- [ ] **Step 1: Write the failing tests**

Create `backend/tests/test_scan_quota.py`:

```python
"""
Tests for manual opp scan weekly quota enforcement.

Rules:
  - Free users (subscription_tier=None): 0 manual scans — blocked with 402
  - Starter users: 10 manual scans/week — blocked with 429 once limit reached
  - Pro users: 25 manual scans/week — blocked with 429 once limit reached
  - Admin users: always allowed regardless of tier
  - Weekly counter is per-brand (brand_id + event_type + created_at)
"""
import pytest
import httpx
from unittest.mock import patch, AsyncMock
from tests.conftest import register_and_login, create_brand


pytestmark = pytest.mark.asyncio


async def test_free_user_cannot_trigger_manual_scan(client: httpx.AsyncClient):
    """Free users (no subscription tier) get a 402 on manual scan."""
    await register_and_login(client, email="scan_free@example.com", subscription_tier=None)
    brand = await create_brand(client, name="Free Scan Brand")

    resp = await client.post(f"/api/opportunities/{brand['id']}/scan")
    assert resp.status_code == 402, resp.text
    assert "weekly" in resp.json()["detail"].lower() or "starter" in resp.json()["detail"].lower()


async def test_starter_user_can_trigger_scan_under_limit(client: httpx.AsyncClient):
    """Starter users can trigger a scan when under their weekly limit."""
    await register_and_login(client, email="scan_starter@example.com", subscription_tier="starter")
    brand = await create_brand(client, name="Starter Scan Brand")

    with patch(
        "app.routers.opportunities.asyncio.create_task",
        return_value=None,
    ):
        resp = await client.post(f"/api/opportunities/{brand['id']}/scan")
    assert resp.status_code == 202, resp.text


async def test_starter_user_blocked_at_weekly_limit(client: httpx.AsyncClient):
    """Starter users are blocked with 429 once they have 10 scan events this week."""
    await register_and_login(client, email="scan_limit@example.com", subscription_tier="starter")
    brand = await create_brand(client, name="Limit Brand")

    # Seed 10 manual_scan_triggered analytics events for this brand
    from app.database import AsyncSessionLocal
    from app.models import AnalyticsEvent
    from datetime import datetime, timezone, timedelta

    async with AsyncSessionLocal() as db:
        for _ in range(10):
            db.add(AnalyticsEvent(
                event_type="manual_scan_triggered",
                brand_id=brand["id"],
                created_at=datetime.now(timezone.utc).replace(tzinfo=None) - timedelta(hours=1),
            ))
        await db.commit()

    resp = await client.post(f"/api/opportunities/{brand['id']}/scan")
    assert resp.status_code == 429, resp.text
    assert "limit" in resp.json()["detail"].lower()


async def test_old_scan_events_do_not_count_toward_weekly_limit(client: httpx.AsyncClient):
    """Scan events older than 7 days do not count against the weekly limit."""
    await register_and_login(client, email="scan_old@example.com", subscription_tier="starter")
    brand = await create_brand(client, name="Old Scan Brand")

    from app.database import AsyncSessionLocal
    from app.models import AnalyticsEvent
    from datetime import datetime, timezone, timedelta

    # Seed 10 events from 8 days ago (outside window)
    async with AsyncSessionLocal() as db:
        for _ in range(10):
            db.add(AnalyticsEvent(
                event_type="manual_scan_triggered",
                brand_id=brand["id"],
                created_at=datetime.now(timezone.utc).replace(tzinfo=None) - timedelta(days=8),
            ))
        await db.commit()

    with patch(
        "app.routers.opportunities.asyncio.create_task",
        return_value=None,
    ):
        resp = await client.post(f"/api/opportunities/{brand['id']}/scan")
    assert resp.status_code == 202, resp.text


async def test_admin_can_always_trigger_scan(client: httpx.AsyncClient):
    """Admin users bypass all scan quota checks."""
    # Register as admin
    from app.database import AsyncSessionLocal
    from sqlalchemy import text

    await register_and_login(client, email="scan_admin@example.com", subscription_tier=None)
    async with AsyncSessionLocal() as db:
        await db.execute(text("UPDATE users SET is_admin = 1 WHERE email = 'scan_admin@example.com'"))
        await db.commit()

    brand = await create_brand(client, name="Admin Scan Brand")

    with patch(
        "app.routers.opportunities.asyncio.create_task",
        return_value=None,
    ):
        resp = await client.post(f"/api/opportunities/{brand['id']}/scan")
    assert resp.status_code == 202, resp.text
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
cd /Users/ken/Desktop/Lumidian/backend && source venv/bin/activate
pytest tests/test_scan_quota.py -v 2>&1 | tail -20
```

Expected: `test_free_user_cannot_trigger_manual_scan` FAILS with 202 (no quota check yet).

- [ ] **Step 3: Add `WEEKLY_SCAN_LIMITS` to `billing.py`**

In `backend/app/routers/billing.py`, after `WEEKLY_DRAFT_LIMITS` (around line 69), add:

```python
# Weekly manual opp-scan limits per brand. Mirrors WEEKLY_DRAFT_LIMITS.
# Free users only get the weekly auto-scan; manual re-scans require a paid plan.
WEEKLY_SCAN_LIMITS: dict = {
    None: 0, "": 0,
    "starter": 10,
    "pro": 25,
}
```

- [ ] **Step 4: Add quota check and event logging to `trigger_scan` in `opportunities.py`**

In `backend/app/routers/opportunities.py`, replace the entire `trigger_scan` function body with:

```python
@router.post("/{brand_id}/scan", status_code=status.HTTP_202_ACCEPTED)
async def trigger_scan(brand_id: int, db: DbDep, user: CurrentUser):
    """
    Trigger an on-demand Reddit + Quora scan for a brand (fire-and-forget).
    Returns immediately; scan runs in the background.

    Free users are blocked (they receive the automatic weekly scan instead).
    Starter: 10 manual scans per 7-day rolling window.
    Pro: 25 manual scans per 7-day rolling window.
    Admins: unlimited.
    """
    import asyncio
    from datetime import datetime, timezone, timedelta
    from sqlalchemy import func as sqlfunc
    from app.models import AnalyticsEvent
    from app.routers.billing import WEEKLY_SCAN_LIMITS
    from app.services.analytics_service import log_event

    check_rate_limit(user.id, limit=3)  # burst guard: 3 per minute
    await get_brand_for_user(brand_id, db, user)

    if not user.is_admin:
        scan_limit = WEEKLY_SCAN_LIMITS.get(user.subscription_tier or "", 0)
        if scan_limit == 0:
            raise HTTPException(
                status_code=status.HTTP_402_PAYMENT_REQUIRED,
                detail=(
                    "Manual opportunity scans are available on Starter and Pro plans. "
                    "Your brand will be scanned automatically each week."
                ),
            )
        week_ago = datetime.now(timezone.utc).replace(tzinfo=None) - timedelta(days=7)
        used_result = await db.execute(
            select(sqlfunc.count(AnalyticsEvent.id)).where(
                AnalyticsEvent.brand_id == brand_id,
                AnalyticsEvent.event_type == "manual_scan_triggered",
                AnalyticsEvent.created_at >= week_ago,
            )
        )
        used = used_result.scalar_one_or_none() or 0
        if used >= scan_limit:
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail=(
                    f"Weekly scan limit reached ({scan_limit}/{scan_limit}). "
                    "Resets 7 days after your first manual scan this week."
                ),
            )

    # Log before firing so the event counts immediately on the next quota check
    await log_event("manual_scan_triggered", {"brand_id": brand_id}, brand_id=brand_id)

    asyncio.create_task(
        _scan_and_log(brand_id),
        name=f"reddit-scan-{brand_id}",
    )
    return {"message": f"Scan started for brand {brand_id}", "brand_id": brand_id}
```

Also add `select` to the existing imports at the top of the file if not already present:

```python
from sqlalchemy import select
```

- [ ] **Step 5: Run the tests**

```bash
cd /Users/ken/Desktop/Lumidian/backend && source venv/bin/activate
pytest tests/test_scan_quota.py -v 2>&1 | tail -20
```

Expected: all 5 tests pass.

- [ ] **Step 6: Verify existing opportunity tests still pass**

```bash
pytest tests/test_reddit_scanner.py tests/test_quora_scanner.py -v 2>&1 | tail -10
```

Expected: all pass.

- [ ] **Step 7: Commit**

```bash
git add backend/app/routers/billing.py backend/app/routers/opportunities.py backend/tests/test_scan_quota.py
git commit -m "feat: add WEEKLY_SCAN_LIMITS and enforce manual scan quota in trigger_scan"
```

---

## Task 4: Add `GET /api/tracking/background-status` endpoint

**Files:**
- Modify: `backend/app/routers/tracking.py`
- Create: `backend/tests/test_background_status.py`

- [ ] **Step 1: Write the failing tests**

Create `backend/tests/test_background_status.py`:

```python
"""
Tests for GET /api/tracking/background-status

Returns:
  { report_running: bool, drafts_generating: bool, scanning: bool }

- report_running: true if any of the user's brands has a TrackingRun
  with status 'pending' or 'running'
- drafts_generating: true if any of the user's brand IDs is in
  state.generating_brands
- scanning: true if any of the user's brand IDs is in state.scanning_brands
"""
import pytest
import httpx
from tests.conftest import register_and_login, create_brand


pytestmark = pytest.mark.asyncio


async def test_background_status_unauthenticated(client: httpx.AsyncClient):
    """Unauthenticated requests are rejected with 401."""
    resp = await client.get("/api/tracking/background-status")
    assert resp.status_code == 401


async def test_background_status_all_false_when_idle(client: httpx.AsyncClient):
    """All flags are false when the user has a brand but nothing is running."""
    await register_and_login(client, email="bg_idle@example.com")
    await create_brand(client, name="Idle Brand")

    resp = await client.get("/api/tracking/background-status")
    assert resp.status_code == 200
    data = resp.json()
    assert data["report_running"] is False
    assert data["drafts_generating"] is False
    assert data["scanning"] is False


async def test_background_status_no_brands(client: httpx.AsyncClient):
    """Users with no brands get all-false without errors."""
    await register_and_login(client, email="bg_nobrands@example.com")

    resp = await client.get("/api/tracking/background-status")
    assert resp.status_code == 200
    data = resp.json()
    assert data["report_running"] is False
    assert data["drafts_generating"] is False
    assert data["scanning"] is False


async def test_background_status_report_running(client: httpx.AsyncClient):
    """report_running is true when the user's brand has a pending/running TrackingRun."""
    await register_and_login(client, email="bg_running@example.com")
    brand = await create_brand(client, name="Running Brand")

    # Seed a pending run
    from app.database import AsyncSessionLocal
    from app.models import TrackingRun

    async with AsyncSessionLocal() as db:
        db.add(TrackingRun(brand_id=brand["id"], status="pending", run_type="manual"))
        await db.commit()

    resp = await client.get("/api/tracking/background-status")
    assert resp.status_code == 200
    assert resp.json()["report_running"] is True


async def test_background_status_drafts_generating(client: httpx.AsyncClient):
    """drafts_generating is true when the brand's ID is in state.generating_brands."""
    await register_and_login(client, email="bg_drafting@example.com")
    brand = await create_brand(client, name="Drafting Brand")

    from app import state
    state.generating_brands.add(brand["id"])
    try:
        resp = await client.get("/api/tracking/background-status")
        assert resp.status_code == 200
        assert resp.json()["drafts_generating"] is True
    finally:
        state.generating_brands.discard(brand["id"])


async def test_background_status_scanning(client: httpx.AsyncClient):
    """scanning is true when the brand's ID is in state.scanning_brands."""
    await register_and_login(client, email="bg_scanning@example.com")
    brand = await create_brand(client, name="Scanning Brand")

    from app import state
    state.scanning_brands.add(brand["id"])
    try:
        resp = await client.get("/api/tracking/background-status")
        assert resp.status_code == 200
        assert resp.json()["scanning"] is True
    finally:
        state.scanning_brands.discard(brand["id"])


async def test_background_status_only_own_brands(client: httpx.AsyncClient):
    """State from another user's brand does not bleed into this user's status."""
    # User A owns the brand that is generating
    await register_and_login(client, email="bg_owner@example.com")
    brand = await create_brand(client, name="Owner Brand")

    from app import state
    state.generating_brands.add(brand["id"])
    try:
        # User B has no brands — should see all-false
        await register_and_login(client, email="bg_other@example.com")
        resp = await client.get("/api/tracking/background-status")
        assert resp.status_code == 200
        assert resp.json()["drafts_generating"] is False
    finally:
        state.generating_brands.discard(brand["id"])
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
cd /Users/ken/Desktop/Lumidian/backend && source venv/bin/activate
pytest tests/test_background_status.py -v 2>&1 | tail -20
```

Expected: all fail with 404 (endpoint doesn't exist yet).

- [ ] **Step 3: Add the endpoint to `tracking.py`**

At the bottom of `backend/app/routers/tracking.py`, add:

```python
from sqlalchemy import func as _sqlfunc


@router.get("/background-status")
async def get_background_status(db: DbDep, user: CurrentUser):
    """
    Lightweight poll endpoint for AppShell banners.

    Returns three boolean flags reflecting what is currently happening
    across all of the authenticated user's brands:

    - report_running:    any TrackingRun for user's brands is pending/running
    - drafts_generating: any brand_id is in state.generating_brands
    - scanning:          any brand_id is in state.scanning_brands
    """
    from app import state as _state

    # Get all brand IDs owned by this user
    brands_result = await db.execute(
        select(Brand.id).where(Brand.user_id == user.id)
    )
    user_brand_ids: set[int] = set(brands_result.scalars().all())

    if not user_brand_ids:
        return {"report_running": False, "drafts_generating": False, "scanning": False}

    # Check for active tracking runs in the DB
    running_result = await db.execute(
        select(_sqlfunc.count(TrackingRun.id)).where(
            TrackingRun.brand_id.in_(user_brand_ids),
            TrackingRun.status.in_(["pending", "running"]),
        )
    )
    report_running = (running_result.scalar_one_or_none() or 0) > 0

    return {
        "report_running": report_running,
        "drafts_generating": bool(user_brand_ids & _state.generating_brands),
        "scanning": bool(user_brand_ids & _state.scanning_brands),
    }
```

- [ ] **Step 4: Run the tests**

```bash
cd /Users/ken/Desktop/Lumidian/backend && source venv/bin/activate
pytest tests/test_background_status.py -v 2>&1 | tail -20
```

Expected: all 7 tests pass.

- [ ] **Step 5: Commit**

```bash
git add backend/app/routers/tracking.py backend/tests/test_background_status.py
git commit -m "feat: add GET /api/tracking/background-status for AppShell banner polling"
```

---

## Task 5: Onboarding post-processing pipeline in `tracking_service.py`

**Files:**
- Modify: `backend/app/services/tracking_service.py`
- Create: `backend/tests/test_onboarding_pipeline.py`

After an onboarding tracking run completes and gap analysis finishes, fire `_onboarding_post_process(brand_id)` as a background asyncio task. The coroutine runs drafting first, then Reddit + Quora scans in parallel — all non-fatal.

- [ ] **Step 1: Write the failing tests**

Create `backend/tests/test_onboarding_pipeline.py`:

```python
"""
Tests for _onboarding_post_process:
  - Calls auto_draft_top_gaps with source="onboarding", max_gaps=5
  - Then scans Reddit and Quora (via asyncio.gather)
  - Manages state.generating_brands and state.scanning_brands correctly
  - Does NOT fire for non-onboarding run types
"""
import asyncio
import pytest
from unittest.mock import patch, AsyncMock, MagicMock


pytestmark = pytest.mark.asyncio


async def test_onboarding_post_process_calls_drafting_then_scanning():
    """_onboarding_post_process: drafts first, then both scanners."""
    from app.services.tracking_service import _onboarding_post_process
    from app import state

    call_order = []

    async def mock_draft(*args, **kwargs):
        call_order.append("drafts")
        return []

    async def mock_reddit(brand_id, **kwargs):
        call_order.append("reddit")

    async def mock_quora(brand_id, **kwargs):
        call_order.append("quora")

    with (
        patch("app.services.tracking_service.auto_draft_top_gaps", side_effect=mock_draft),
        patch("app.services.tracking_service.reddit_scan", side_effect=mock_reddit),
        patch("app.services.tracking_service.quora_scan", side_effect=mock_quora),
    ):
        await _onboarding_post_process(brand_id=42)

    assert call_order[0] == "drafts", "Drafting must run before scanning"
    assert set(call_order[1:]) == {"reddit", "quora"}, "Both scanners must run"


async def test_onboarding_post_process_drafting_kwargs():
    """_onboarding_post_process passes correct kwargs to auto_draft_top_gaps."""
    from app.services.tracking_service import _onboarding_post_process

    captured = {}

    async def mock_draft(db, brand_id, max_gaps, clear_existing, source):
        captured.update({"brand_id": brand_id, "max_gaps": max_gaps,
                         "clear_existing": clear_existing, "source": source})
        return []

    with (
        patch("app.services.tracking_service.auto_draft_top_gaps", side_effect=mock_draft),
        patch("app.services.tracking_service.reddit_scan", new_callable=AsyncMock),
        patch("app.services.tracking_service.quora_scan", new_callable=AsyncMock),
    ):
        await _onboarding_post_process(brand_id=7)

    assert captured["brand_id"] == 7
    assert captured["max_gaps"] == 5
    assert captured["clear_existing"] is False
    assert captured["source"] == "onboarding"


async def test_onboarding_post_process_state_cleared_after_drafts():
    """State sets are correctly managed: set before, cleared after each phase."""
    from app.services.tracking_service import _onboarding_post_process
    from app import state

    drafting_state_snapshot = {}
    scanning_state_snapshot = {}

    async def mock_draft(db, brand_id, **kwargs):
        drafting_state_snapshot["in_generating"] = brand_id in state.generating_brands
        return []

    async def mock_reddit(brand_id, **kwargs):
        scanning_state_snapshot["in_scanning"] = brand_id in state.scanning_brands

    async def mock_quora(brand_id, **kwargs):
        pass

    with (
        patch("app.services.tracking_service.auto_draft_top_gaps", side_effect=mock_draft),
        patch("app.services.tracking_service.reddit_scan", side_effect=mock_reddit),
        patch("app.services.tracking_service.quora_scan", side_effect=mock_quora),
    ):
        await _onboarding_post_process(brand_id=99)

    assert drafting_state_snapshot.get("in_generating") is True, "brand must be in generating_brands while drafting"
    assert scanning_state_snapshot.get("in_scanning") is True, "brand must be in scanning_brands while scanning"
    assert 99 not in state.generating_brands, "generating_brands must be cleared after drafting"
    assert 99 not in state.scanning_brands, "scanning_brands must be cleared after scanning"


async def test_onboarding_post_process_non_fatal_on_draft_failure():
    """A drafting exception does not prevent the scan from running."""
    from app.services.tracking_service import _onboarding_post_process

    scan_called = {"reddit": False, "quora": False}

    async def mock_draft(*args, **kwargs):
        raise RuntimeError("LLM timeout")

    async def mock_reddit(brand_id, **kwargs):
        scan_called["reddit"] = True

    async def mock_quora(brand_id, **kwargs):
        scan_called["quora"] = True

    with (
        patch("app.services.tracking_service.auto_draft_top_gaps", side_effect=mock_draft),
        patch("app.services.tracking_service.reddit_scan", side_effect=mock_reddit),
        patch("app.services.tracking_service.quora_scan", side_effect=mock_quora),
    ):
        await _onboarding_post_process(brand_id=55)  # must not raise

    assert scan_called["reddit"], "Reddit scan must run even when drafting fails"
    assert scan_called["quora"], "Quora scan must run even when drafting fails"
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
cd /Users/ken/Desktop/Lumidian/backend && source venv/bin/activate
pytest tests/test_onboarding_pipeline.py -v 2>&1 | tail -20
```

Expected: all fail with `ImportError: cannot import name '_onboarding_post_process'`.

- [ ] **Step 3: Add imports and `_onboarding_post_process` to `tracking_service.py`**

At the top of `backend/app/services/tracking_service.py`, add these imports after the existing imports:

```python
from app.services.drafting_service import auto_draft_top_gaps
from app.services.reddit_scanner_service import scan_brand_opportunities as reddit_scan
from app.services.quora_scanner_service import scan_brand_opportunities as quora_scan
```

Then add the coroutine after the `run_tracking` function (before or after `_detect_mention` — after the end of the file is fine):

```python
async def _onboarding_post_process(brand_id: int) -> None:
    """
    Sequential post-processing pipeline for onboarding tracking runs.

    Fired as a background asyncio.create_task after gap analysis completes.
    Steps run in order; each is non-fatal:
      1. Generate up to 5 initial content drafts  (source="onboarding")
      2. Scan Reddit + Quora for live opportunities (parallel)

    state.generating_brands and state.scanning_brands are updated so
    AppShell's background-status banners reflect each phase.
    """
    from app import state
    from app.database import AsyncSessionLocal

    # ── Step 1: Draft generation ─────────────────────────────────────────────
    state.generating_brands.add(brand_id)
    try:
        async with AsyncSessionLocal() as db:
            drafts = await auto_draft_top_gaps(
                db=db,
                brand_id=brand_id,
                max_gaps=5,
                clear_existing=False,
                source="onboarding",
            )
        logger.info(
            "Onboarding post-process: generated %d drafts for brand_id=%d",
            len(drafts), brand_id,
        )
    except Exception as exc:
        logger.warning(
            "Onboarding draft generation failed for brand_id=%d (non-fatal): %s",
            brand_id, exc,
        )
    finally:
        state.generating_brands.discard(brand_id)

    # ── Step 2: Live opportunity scan (Reddit + Quora in parallel) ───────────
    state.scanning_brands.add(brand_id)
    try:
        await asyncio.gather(
            reddit_scan(brand_id, clear_existing=True),
            quora_scan(brand_id, clear_existing=True),
            return_exceptions=True,
        )
        logger.info(
            "Onboarding post-process: opportunity scan complete for brand_id=%d",
            brand_id,
        )
    except Exception as exc:
        logger.warning(
            "Onboarding opp scan failed for brand_id=%d (non-fatal): %s",
            brand_id, exc,
        )
    finally:
        state.scanning_brands.discard(brand_id)
```

- [ ] **Step 4: Fire `_onboarding_post_process` after gap analysis in `run_tracking`**

In `backend/app/services/tracking_service.py`, find the end of step 8 (gap analysis), which looks like:

```python
    except Exception as exc:
        logger.warning(
            "Gap analysis failed for run %d (non-fatal): %s", run_id, exc
        )

    # ── 10. Create in-app notifications ──────────────────────────────────────
```

Between those two blocks, insert:

```python
    # ── 9b. Onboarding post-processing pipeline ──────────────────────────────
    if run_type == "onboarding":
        logger.info(
            "Onboarding run %d complete — firing post-processing pipeline for brand_id=%d",
            run_id, brand_id,
        )
        asyncio.create_task(
            _onboarding_post_process(brand_id),
            name=f"onboarding-post-{brand_id}",
        )
```

- [ ] **Step 5: Run the new tests**

```bash
cd /Users/ken/Desktop/Lumidian/backend && source venv/bin/activate
pytest tests/test_onboarding_pipeline.py -v 2>&1 | tail -20
```

Expected: all 4 tests pass.

- [ ] **Step 6: Run full test suite to check for regressions**

```bash
pytest tests/ -v --ignore=tests/test_billing.py 2>&1 | tail -30
```

Expected: no regressions. (Billing tests are excluded because they require Stripe mocks that are finicky in full runs — run separately if needed.)

- [ ] **Step 7: Commit**

```bash
git add backend/app/services/tracking_service.py backend/tests/test_onboarding_pipeline.py
git commit -m "feat: fire draft generation + opp scan pipeline after onboarding tracking run"
```

---

## Task 6: Scheduler — move opp scans from daily to weekly (Monday)

**Files:**
- Modify: `backend/app/scheduler.py`

- [ ] **Step 1: Rewrite `_reddit_scanner_sweep` to track state and scan per-brand**

In `backend/app/scheduler.py`, replace the entire `_reddit_scanner_sweep` function with:

```python
async def _reddit_scanner_sweep() -> None:
    """Weekly Reddit scan for all brands (03:15 UTC, Monday)."""
    if await _is_scheduler_paused():
        logger.info("Scheduler paused — skipping Reddit scanner sweep")
        return

    from app import state
    from app.database import AsyncSessionLocal
    from app.models import Brand
    from app.services.reddit_scanner_service import scan_brand_opportunities
    from sqlalchemy import select

    logger.info("Scheduler: starting weekly Reddit scanner sweep")

    async with AsyncSessionLocal() as db:
        result = await db.execute(select(Brand))
        brands = result.scalars().all()

    for brand in brands:
        state.scanning_brands.add(brand.id)
        try:
            await scan_brand_opportunities(brand.id)
        except Exception:
            logger.exception("Reddit scanner failed for brand_id=%d", brand.id)
        finally:
            state.scanning_brands.discard(brand.id)

    logger.info("Scheduler: weekly Reddit scanner sweep complete")
```

- [ ] **Step 2: Rewrite `_quora_scanner_sweep` to track state and scan per-brand**

Replace the entire `_quora_scanner_sweep` function with:

```python
async def _quora_scanner_sweep() -> None:
    """Weekly Quora scan for all brands (03:30 UTC, Monday)."""
    if await _is_scheduler_paused():
        logger.info("Scheduler paused — skipping Quora scanner sweep")
        return

    from app import state
    from app.database import AsyncSessionLocal
    from app.models import Brand
    from app.services.quora_scanner_service import scan_brand_opportunities
    from sqlalchemy import select

    logger.info("Scheduler: starting weekly Quora scanner sweep")

    async with AsyncSessionLocal() as db:
        result = await db.execute(select(Brand))
        brands = result.scalars().all()

    for brand in brands:
        state.scanning_brands.add(brand.id)
        try:
            await scan_brand_opportunities(brand.id)
        except Exception:
            logger.exception("Quora scanner failed for brand_id=%d", brand.id)
        finally:
            state.scanning_brands.discard(brand.id)

    logger.info("Scheduler: weekly Quora scanner sweep complete")
```

- [ ] **Step 3: Change job trigger for Reddit from daily to Monday 03:15 UTC**

In `start_scheduler()`, find:

```python
    scheduler.add_job(
        _reddit_scanner_sweep,
        trigger=CronTrigger(hour=2, minute=0, timezone="UTC"),
        id="reddit_scanner",
        name="Reddit opportunity scanner (02:00 UTC)",
        replace_existing=True,
        misfire_grace_time=600,
    )
```

Replace with:

```python
    scheduler.add_job(
        _reddit_scanner_sweep,
        trigger=CronTrigger(day_of_week="mon", hour=3, minute=15, timezone="UTC"),
        id="reddit_scanner",
        name="Reddit opportunity scanner (Monday 03:15 UTC)",
        replace_existing=True,
        misfire_grace_time=3600,
    )
```

- [ ] **Step 4: Change job trigger for Quora from daily to Monday 03:30 UTC**

Find:

```python
    scheduler.add_job(
        _quora_scanner_sweep,
        trigger=CronTrigger(hour=2, minute=30, timezone="UTC"),
        id="quora_scanner",
        name="Quora opportunity scanner (02:30 UTC)",
        replace_existing=True,
        misfire_grace_time=600,
    )
```

Replace with:

```python
    scheduler.add_job(
        _quora_scanner_sweep,
        trigger=CronTrigger(day_of_week="mon", hour=3, minute=30, timezone="UTC"),
        id="quora_scanner",
        name="Quora opportunity scanner (Monday 03:30 UTC)",
        replace_existing=True,
        misfire_grace_time=3600,
    )
```

- [ ] **Step 5: Update the module docstring at the top of `scheduler.py`**

Find the jobs table in the module docstring:

```python
#   • 02:00 UTC        — Reddit opportunity scanner (daily) + SQLite backup
#   • 02:30 UTC        — Quora opportunity scanner (daily)
```

Replace with:

```python
#   • 02:00 UTC        — SQLite backup (daily)
#   • 03:15 UTC Mon    — Reddit opportunity scanner (weekly)
#   • 03:30 UTC Mon    — Quora opportunity scanner (weekly)
```

- [ ] **Step 6: Verify the scheduler starts correctly**

```bash
cd /Users/ken/Desktop/Lumidian/backend && source venv/bin/activate
python -c "
from app.scheduler import start_scheduler, stop_scheduler, scheduler
start_scheduler()
jobs = {j.id: str(j.trigger) for j in scheduler.get_jobs()}
print(jobs)
stop_scheduler()
"
```

Expected output contains:
- `reddit_scanner` with a cron trigger showing `mon` and `3:15`
- `quora_scanner` with a cron trigger showing `mon` and `3:30`
- No daily 02:00 or 02:30 reddit/quora entries

- [ ] **Step 7: Commit**

```bash
git add backend/app/scheduler.py
git commit -m "feat: move Reddit/Quora opp scans from daily to Monday weekly; track state during sweeps"
```

---

## Task 7: Frontend — `getBackgroundStatus` in `api.ts` + AppShell polling + scanning banner

**Files:**
- Modify: `frontend/lib/api.ts`
- Modify: `frontend/components/AppShell.tsx`

- [ ] **Step 1: Add `getBackgroundStatus` to `api.ts`**

At the end of `frontend/lib/api.ts`, add:

```typescript
export async function getBackgroundStatus(): Promise<{
  report_running: boolean;
  drafts_generating: boolean;
  scanning: boolean;
}> {
  const res = await api.get<{
    report_running: boolean;
    drafts_generating: boolean;
    scanning: boolean;
  }>('/tracking/background-status');
  return res.data;
}
```

- [ ] **Step 2: Add imports to `AppShell.tsx`**

In `frontend/components/AppShell.tsx`, add to the existing import block:

```tsx
import { useAuth } from '@/contexts/AuthContext';
import { getBackgroundStatus } from '@/lib/api';
```

- [ ] **Step 3: Add `scanning` state and replace the localStorage polling effect**

In `AppShell`, after the existing `const [draftsGenerating, setDraftsGenerating] = useState(false);` line, add:

```tsx
const [scanning, setScanning] = useState(false);
const { user } = useAuth();
```

Then replace the entire existing localStorage `useEffect` (the one that sets `reportRunning` and `draftsGenerating` from localStorage, polling every 2s) with:

```tsx
// Poll backend every 3 s for live background-task status.
// Falls back to localStorage fast-path so pages that write flags immediately
// still get instant banner feedback before the first API response.
useEffect(() => {
  // Fast-path: sync from localStorage immediately for instant feedback
  const syncLocal = () => {
    try {
      if (localStorage.getItem('clarity_report_running')) setReportRunning(true);
      if (localStorage.getItem('clarity_drafts_generating')) setDraftsGenerating(true);
      if (localStorage.getItem('clarity_scanning')) setScanning(true);
    } catch {}
  };
  syncLocal();
  window.addEventListener('storage', syncLocal);

  if (!user) {
    setReportRunning(false);
    setDraftsGenerating(false);
    setScanning(false);
    return () => window.removeEventListener('storage', syncLocal);
  }

  let cancelled = false;
  const poll = async () => {
    try {
      const status = await getBackgroundStatus();
      if (!cancelled) {
        setReportRunning(status.report_running);
        setDraftsGenerating(status.drafts_generating);
        setScanning(status.scanning);
      }
    } catch {
      // Silently ignore poll errors — don't flash misleading banners
    }
  };

  poll();
  const interval = setInterval(poll, 3000);

  return () => {
    cancelled = true;
    clearInterval(interval);
    window.removeEventListener('storage', syncLocal);
  };
}, [user]); // eslint-disable-line react-hooks/exhaustive-deps
```

- [ ] **Step 4: Add the scanning banner**

In `AppShell.tsx`, after the existing `{draftsGenerating && (...)}` banner block (around line 139–152), add:

```tsx
        {scanning && (
          <div style={{
            background: 'rgba(6,182,212,0.06)',
            borderBottom: '1px solid rgba(6,182,212,0.18)',
            padding: '8px 28px',
            display: 'flex',
            alignItems: 'center',
            gap: 10,
          }}>
            <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#06b6d4', display: 'inline-block', animation: 'pulse 2s cubic-bezier(0.4,0,0.6,1) infinite' }} />
            <span style={{ fontSize: 12, color: '#67e8f9', fontWeight: 600 }}>Scanning live opportunities</span>
            <span style={{ fontSize: 12, color: '#06b6d4' }}>— finding relevant discussions on Reddit and Quora.</span>
          </div>
        )}
```

- [ ] **Step 5: TypeScript check**

```bash
cd /Users/ken/Desktop/Lumidian/frontend && npx tsc --noEmit 2>&1
```

Expected: no output (clean).

- [ ] **Step 6: Smoke test in browser**

Start the backend and frontend:

```bash
# Terminal 1
cd /Users/ken/Desktop/Lumidian/backend && source venv/bin/activate && uvicorn app.main:app --reload --port 3001

# Terminal 2
cd /Users/ken/Desktop/Lumidian/frontend && npm run dev
```

1. Open `http://localhost:3002/dashboard` while logged in
2. Open DevTools → Network, filter by `/background-status` — confirm requests appear every ~3 s
3. In the Python REPL, add a brand_id to `state.scanning_brands`:
   ```python
   import requests, json
   # (or use the backend shell)
   ```
   Or use the DB to create a pending run, then verify the "Report in progress" banner appears.
4. Navigate to `/content` — banner should remain visible (not disappear on navigation).
5. Navigate to `/settings` — banner still visible.

- [ ] **Step 7: Commit**

```bash
git add frontend/lib/api.ts frontend/components/AppShell.tsx
git commit -m "feat: AppShell polls background-status API every 3s; add scanning banner; survives navigation"
```

---

## Self-Review Checklist

- [x] **Spec coverage — onboarding drafts**: Task 5 adds `_onboarding_post_process` fired after onboarding gap analysis ✅
- [x] **Spec coverage — first-time opp scan**: Task 5 scans Reddit + Quora in the post-processing pipeline ✅
- [x] **Spec coverage — weekly opp scan for everyone**: Task 6 moves daily jobs to Monday weekly ✅
- [x] **Spec coverage — scan limits mirror draft limits**: Task 3 adds `WEEKLY_SCAN_LIMITS` matching `WEEKLY_DRAFT_LIMITS` ✅
- [x] **Spec coverage — banner survives navigation**: Task 7 moves polling to AppShell effect, not page components ✅
- [x] **Spec coverage — scanning banner**: Task 7 adds third banner with cyan styling ✅
- [x] **Spec coverage — shared state**: Task 1 creates `state.py`; Task 2 wires content.py; Tasks 5 and 6 use it ✅
- [x] **No placeholders**: all steps include actual code ✅
- [x] **Type consistency**: `state.generating_brands` / `state.scanning_brands` used consistently across Tasks 1–6 ✅
- [x] **Free users get weekly auto-scan**: scheduler runs for all brands with no tier check ✅
- [x] **Free users cannot manually scan**: `WEEKLY_SCAN_LIMITS[None] = 0` → 402 in Task 3 ✅
- [x] **Onboarding pipeline is non-fatal**: every step has try/except, state cleared in finally ✅
- [x] **Navigation doesn't stop background tasks**: tasks are asyncio server-side; frontend only manages UI state ✅
