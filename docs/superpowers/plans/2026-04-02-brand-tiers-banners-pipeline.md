# Brand Tiers, Banners & Onboarding Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the onboarding pipeline to auto-trigger on first run, ensure banners reflect all background operations, implement proper brand tier limits with pause functionality.

**Architecture:** Backend auto-detects first-ever tracking run and triggers the full onboarding pipeline (drafts + scans). All state flows through `state.py` sets and the `/background-status` API. Brands pause when expired or subscription lapses, blocking writes but allowing reads.

**Tech Stack:** Python 3.11 / FastAPI / SQLAlchemy async / asyncio (backend); Next.js 15 / TypeScript / React (frontend); pytest-asyncio

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `backend/app/models.py` | Modify | Add `Brand.prompt_limit`, update `brand_type` choices |
| `backend/app/routers/billing.py` | Modify | Add new limit constants, update `BRAND_LIMITS` |
| `backend/app/routers/brands.py` | Modify | Validate `brand_type` vs tier, enforce prompt limits |
| `backend/app/routers/tracking.py` | Modify | Auto-detect first run → onboarding; add pause check |
| `backend/app/routers/opportunities.py` | Modify | Add `state.scanning_brands` tracking; pitch scan limit; pause check |
| `backend/app/routers/content.py` | Modify | Add pause check to write endpoints |
| `backend/app/scheduler.py` | Modify | Skip paused brands in all sweeps |
| `backend/app/dependencies.py` | Modify | Add `require_brand_active()` helper |
| `backend/tests/test_first_run_pipeline.py` | Create | Test first run triggers onboarding pipeline |
| `backend/tests/test_brand_pause.py` | Create | Test paused brands block writes, allow reads |
| `backend/tests/test_pitch_limits.py` | Create | Test pitch brand manual action limits |
| `backend/tests/test_banner_state.py` | Create | Test manual scans update scanning state |
| `frontend/components/AppShell.tsx` | Modify | Clean up localStorage fallback |

---

## Task 1: Add `prompt_limit` column to Brand model

**Files:**
- Modify: `backend/app/models.py`
- Modify: `backend/app/database.py`

- [ ] **Step 1: Add `prompt_limit` column to Brand model**

In `backend/app/models.py`, find the `Brand` class and add the new column after `pitch_expires_at`:

```python
    prompt_limit: Mapped[int] = mapped_column(Integer, default=25)
```

- [ ] **Step 2: Add migration in `database.py`**

In `backend/app/database.py`, find `run_migrations()` and add at the end of the migrations list:

```python
    # 2026-04-02: Add prompt_limit column to brands
    try:
        await conn.execute(text(
            "ALTER TABLE brands ADD COLUMN prompt_limit INTEGER DEFAULT 25"
        ))
    except Exception:
        pass  # Column already exists
```

- [ ] **Step 3: Verify migration runs cleanly**

```bash
cd /Users/ken/Desktop/Lumidian/backend && source venv/bin/activate
python -c "from app.database import AsyncSessionLocal; import asyncio; asyncio.run(AsyncSessionLocal())"
```

Expected: No errors

- [ ] **Step 4: Commit**

```bash
cd /Users/ken/Desktop/Lumidian
git add backend/app/models.py backend/app/database.py
git commit -m "feat: add prompt_limit column to Brand model"
```

---

## Task 2: Add brand tier limit constants

**Files:**
- Modify: `backend/app/routers/billing.py`

- [ ] **Step 1: Add new constants after existing limit dicts**

In `backend/app/routers/billing.py`, find `WEEKLY_SCAN_LIMITS` (around line 72) and add these new constants after it:

```python
# Prompt limits per brand type
PROMPT_LIMITS: dict[str, int] = {
    "pitch": 10,
    "standard": 25,
    "pro": 100,
}

# Brand type limits per subscription tier: {tier: {brand_type: max_count}}
BRAND_TYPE_LIMITS: dict = {
    None: {"pitch": 1, "standard": 0, "pro": 0},
    "": {"pitch": 1, "standard": 0, "pro": 0},
    "starter": {"pitch": 1, "standard": 1, "pro": 0},
    "pro": {"pitch": 3, "standard": 0, "pro": 2},  # Pro users create pro brands, not standard
}

# Daily manual run limit for pitch brands (all tiers)
DAILY_RUN_LIMITS_PITCH: int = 1

# Weekly manual scan limit for pitch brands (all tiers)
WEEKLY_SCAN_LIMITS_PITCH: int = 1
```

- [ ] **Step 2: Verify import works**

```bash
cd /Users/ken/Desktop/Lumidian/backend && source venv/bin/activate
python -c "from app.routers.billing import PROMPT_LIMITS, BRAND_TYPE_LIMITS, DAILY_RUN_LIMITS_PITCH, WEEKLY_SCAN_LIMITS_PITCH; print('OK')"
```

Expected: `OK`

- [ ] **Step 3: Commit**

```bash
git add backend/app/routers/billing.py
git commit -m "feat: add brand tier limit constants"
```

---

## Task 3: Add `require_brand_active()` dependency

**Files:**
- Modify: `backend/app/dependencies.py`
- Create: `backend/tests/test_brand_pause.py`

- [ ] **Step 1: Write the failing test**

Create `backend/tests/test_brand_pause.py`:

```python
"""Tests for brand pause functionality."""
import pytest
from datetime import datetime, timezone, timedelta
from httpx import AsyncClient

from tests.conftest import register_and_login, create_brand


@pytest.mark.asyncio
async def test_paused_pitch_brand_blocks_run(client: AsyncClient):
    """Expired pitch brand should block tracking runs."""
    token = await register_and_login(client, "pause@test.com", "password123")
    headers = {"Authorization": f"Bearer {token}"}
    
    # Create a pitch brand
    brand_resp = await client.post(
        "/api/brands",
        json={"name": "PausedBrand", "tier": "basic", "brand_type": "pitch", "prompts": ["test prompt"]},
        headers=headers,
    )
    assert brand_resp.status_code == 201
    brand_id = brand_resp.json()["id"]
    
    # Manually expire the brand by setting pitch_expires_at in the past
    from app.database import AsyncSessionLocal
    from app.models import Brand
    async with AsyncSessionLocal() as db:
        brand = await db.get(Brand, brand_id)
        brand.pitch_expires_at = datetime.now(timezone.utc).replace(tzinfo=None) - timedelta(days=1)
        await db.commit()
    
    # Attempt to trigger a run — should be blocked
    run_resp = await client.post(f"/api/tracking/run/{brand_id}", headers=headers)
    assert run_resp.status_code == 403
    assert "paused" in run_resp.json()["detail"].lower()


@pytest.mark.asyncio
async def test_paused_brand_allows_read(client: AsyncClient):
    """Paused brand should still allow reading data."""
    token = await register_and_login(client, "pauseread@test.com", "password123")
    headers = {"Authorization": f"Bearer {token}"}
    
    # Create a pitch brand
    brand_resp = await client.post(
        "/api/brands",
        json={"name": "ReadableBrand", "tier": "basic", "brand_type": "pitch", "prompts": ["test prompt"]},
        headers=headers,
    )
    assert brand_resp.status_code == 201
    brand_id = brand_resp.json()["id"]
    
    # Expire the brand
    from app.database import AsyncSessionLocal
    from app.models import Brand
    async with AsyncSessionLocal() as db:
        brand = await db.get(Brand, brand_id)
        brand.pitch_expires_at = datetime.now(timezone.utc).replace(tzinfo=None) - timedelta(days=1)
        await db.commit()
    
    # Reading brand should still work
    get_resp = await client.get(f"/api/brands/{brand_id}", headers=headers)
    assert get_resp.status_code == 200
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd /Users/ken/Desktop/Lumidian/backend && source venv/bin/activate
pytest tests/test_brand_pause.py -v 2>&1 | tail -30
```

Expected: FAIL (require_brand_active not implemented yet)

- [ ] **Step 3: Implement `require_brand_active()` in dependencies.py**

In `backend/app/dependencies.py`, add after the existing imports and before the rate limit code:

```python
from datetime import datetime, timezone


def is_brand_paused(brand, user) -> bool:
    """
    Check if a brand is paused (read-only).
    
    A brand is paused when:
    1. It's a pitch brand and pitch_expires_at has passed
    2. User's subscription has lapsed (not active/trialing)
    """
    # Check pitch brand expiry
    if getattr(brand, "brand_type", "standard") == "pitch":
        expires_at = getattr(brand, "pitch_expires_at", None)
        if expires_at:
            now = datetime.now(timezone.utc).replace(tzinfo=None)
            if expires_at <= now:
                return True
    
    # Check subscription status
    sub_status = getattr(user, "subscription_status", None)
    if sub_status and sub_status not in ("active", "trialing", None):
        return True
    
    return False


def require_brand_active(brand, user):
    """
    Raise 403 if the brand is paused.
    Call this in endpoints that modify brand data (runs, drafts, scans).
    """
    from fastapi import HTTPException, status
    
    if is_brand_paused(brand, user):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Brand is paused. Renew your subscription or upgrade to continue.",
        )
```

- [ ] **Step 4: Add pause check to tracking.py trigger_run**

In `backend/app/routers/tracking.py`, find the `trigger_run` function. After the line `await get_brand_for_user(brand_id, db, user)` (around line 43), add:

```python
    # Check if brand is paused
    brand_result = await db.execute(select(Brand).where(Brand.id == brand_id))
    brand = brand_result.scalar_one()
    from app.dependencies import require_brand_active
    require_brand_active(brand, user)
```

- [ ] **Step 5: Run test to verify it passes**

```bash
cd /Users/ken/Desktop/Lumidian/backend && source venv/bin/activate
pytest tests/test_brand_pause.py -v
```

Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add backend/app/dependencies.py backend/app/routers/tracking.py backend/tests/test_brand_pause.py
git commit -m "feat: add require_brand_active() to block writes on paused brands"
```

---

## Task 4: Add pause checks to content and opportunities routers

**Files:**
- Modify: `backend/app/routers/content.py`
- Modify: `backend/app/routers/opportunities.py`

- [ ] **Step 1: Add pause check to content.py create_draft**

In `backend/app/routers/content.py`, find the `create_draft` function. After `brand = await get_brand_for_user(brand_id, db, user)` (around line 213), add:

```python
    from app.dependencies import require_brand_active
    require_brand_active(brand, user)
```

- [ ] **Step 2: Add pause check to content.py generate_now**

In the same file, find `generate_now` function. After `brand = await get_brand_for_user(brand_id, db, user)` (around line 473), add:

```python
    from app.dependencies import require_brand_active
    require_brand_active(brand, user)
```

- [ ] **Step 3: Add pause check to content.py create_gap_draft**

In the same file, find `create_gap_draft` function. After `brand = await get_brand_for_user(brand_id, db, user)` (around line 610), add:

```python
    from app.dependencies import require_brand_active
    require_brand_active(brand, user)
```

- [ ] **Step 4: Add pause check to opportunities.py trigger_scan**

In `backend/app/routers/opportunities.py`, find `trigger_scan` function. After `await get_brand_for_user(brand_id, db, user)` (around line 198), add:

```python
    # Check if brand is paused
    brand_result = await db.execute(select(Brand).where(Brand.id == brand_id))
    brand = brand_result.scalar_one()
    from app.dependencies import require_brand_active
    require_brand_active(brand, user)
```

- [ ] **Step 5: Add pause check to opportunities.py draft_opportunity**

In the same file, find `draft_opportunity` function. After `await get_brand_for_user(opp.brand_id, db, user)` (around line 119), add:

```python
    # Check if brand is paused
    brand_result = await db.execute(select(Brand).where(Brand.id == opp.brand_id))
    brand = brand_result.scalar_one()
    from app.dependencies import require_brand_active
    require_brand_active(brand, user)
```

- [ ] **Step 6: Run existing tests to verify no regressions**

```bash
cd /Users/ken/Desktop/Lumidian/backend && source venv/bin/activate
pytest tests/test_content.py tests/test_brand_pause.py -v 2>&1 | tail -30
```

Expected: All tests pass

- [ ] **Step 7: Commit**

```bash
git add backend/app/routers/content.py backend/app/routers/opportunities.py
git commit -m "feat: add pause checks to content and opportunities endpoints"
```

---

## Task 5: Skip paused brands in scheduler sweeps

**Files:**
- Modify: `backend/app/scheduler.py`

- [ ] **Step 1: Add pause check helper at top of scheduler.py**

In `backend/app/scheduler.py`, after the imports (around line 9), add:

```python
from datetime import datetime, timezone


def _is_brand_paused(brand) -> bool:
    """Check if a brand should be skipped in scheduled sweeps."""
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    
    # Skip expired pitch brands
    if brand.brand_type == "pitch" and brand.pitch_expires_at and brand.pitch_expires_at <= now:
        return True
    
    return False
```

- [ ] **Step 2: Update `_run_all_brands` to use the helper**

In `_run_all_brands` function, replace the existing pitch expiry check (around lines 70-77):

```python
        # Skip pitch brands that have expired (cleanup job handles deletion)
        if brand.brand_type == "pitch" and brand.pitch_expires_at and brand.pitch_expires_at <= now:
            logger.info(
                "Scheduler: skipping expired pitch brand %d (%s) [%s]",
                brand.id, brand.name, schedule_slot,
            )
            continue
```

With:

```python
        # Skip paused brands
        if _is_brand_paused(brand):
            logger.info(
                "Scheduler: skipping paused brand %d (%s) [%s]",
                brand.id, brand.name, schedule_slot,
            )
            continue
```

- [ ] **Step 3: Update `_auto_draft_sweep` to use the helper**

In `_auto_draft_sweep` function, replace the existing pitch expiry check (around lines 199-205):

```python
        # Skip pitch brands that have expired
        if brand.brand_type == "pitch" and brand.pitch_expires_at and brand.pitch_expires_at <= now_utc:
            logger.info(
                "Scheduler: skipping expired pitch brand %d (%s) in auto-draft sweep",
                brand.id, brand.name,
            )
            continue
```

With:

```python
        # Skip paused brands
        if _is_brand_paused(brand):
            logger.info(
                "Scheduler: skipping paused brand %d (%s) in auto-draft sweep",
                brand.id, brand.name,
            )
            continue
```

- [ ] **Step 4: Add pause check to `_reddit_scanner_sweep`**

In `_reddit_scanner_sweep` function, after the `for brand in brands:` line (around line 132), add:

```python
        if _is_brand_paused(brand):
            logger.info("Scheduler: skipping paused brand %d in Reddit sweep", brand.id)
            continue
```

- [ ] **Step 5: Add pause check to `_quora_scanner_sweep`**

In `_quora_scanner_sweep` function, after the `for brand in brands:` line (around line 162), add:

```python
        if _is_brand_paused(brand):
            logger.info("Scheduler: skipping paused brand %d in Quora sweep", brand.id)
            continue
```

- [ ] **Step 6: Verify scheduler imports cleanly**

```bash
cd /Users/ken/Desktop/Lumidian/backend && source venv/bin/activate
python -c "from app.scheduler import start_scheduler; print('OK')"
```

Expected: `OK`

- [ ] **Step 7: Commit**

```bash
git add backend/app/scheduler.py
git commit -m "feat: skip paused brands in all scheduler sweeps"
```

---

## Task 6: Auto-detect first run and trigger onboarding pipeline

**Files:**
- Modify: `backend/app/routers/tracking.py`
- Create: `backend/tests/test_first_run_pipeline.py`

- [ ] **Step 1: Write the failing test**

Create `backend/tests/test_first_run_pipeline.py`:

```python
"""Tests for first-run detection and onboarding pipeline."""
import pytest
from unittest.mock import patch, AsyncMock
from httpx import AsyncClient

from tests.conftest import register_and_login


@pytest.mark.asyncio
async def test_first_run_triggers_onboarding_pipeline(client: AsyncClient):
    """First tracking run for a brand should trigger the onboarding post-process."""
    token = await register_and_login(client, "firstrun@test.com", "password123")
    headers = {"Authorization": f"Bearer {token}"}
    
    # Create a brand with prompts
    brand_resp = await client.post(
        "/api/brands",
        json={"name": "FirstRunBrand", "tier": "basic", "brand_type": "pitch", "prompts": ["What is FirstRunBrand?"]},
        headers=headers,
    )
    assert brand_resp.status_code == 201
    brand_id = brand_resp.json()["id"]
    
    # Mock the onboarding post-process to verify it gets called
    with patch("app.routers.tracking._execute_run_with_id") as mock_execute:
        mock_execute.return_value = None
        
        # Trigger first run
        run_resp = await client.post(f"/api/tracking/run/{brand_id}", headers=headers)
        assert run_resp.status_code == 202
        
        # Verify the run was created with is_first_run=True marker
        # (we'll check this via the run_type stored)
        from app.database import AsyncSessionLocal
        from app.models import TrackingRun
        async with AsyncSessionLocal() as db:
            run = await db.get(TrackingRun, run_resp.json()["run_id"])
            # First run should be marked as onboarding type
            assert run.run_type == "onboarding"


@pytest.mark.asyncio
async def test_second_run_is_manual_not_onboarding(client: AsyncClient):
    """Second tracking run should be manual type, not onboarding."""
    token = await register_and_login(client, "secondrun@test.com", "password123")
    headers = {"Authorization": f"Bearer {token}"}
    
    # Create brand
    brand_resp = await client.post(
        "/api/brands",
        json={"name": "SecondRunBrand", "tier": "basic", "brand_type": "pitch", "prompts": ["test"]},
        headers=headers,
    )
    brand_id = brand_resp.json()["id"]
    
    # Create a completed run in the DB to simulate first run already happened
    from app.database import AsyncSessionLocal
    from app.models import TrackingRun
    from datetime import datetime, timezone
    async with AsyncSessionLocal() as db:
        existing_run = TrackingRun(
            brand_id=brand_id,
            status="completed",
            run_type="onboarding",
            completed_at=datetime.now(timezone.utc).replace(tzinfo=None),
        )
        db.add(existing_run)
        await db.commit()
    
    with patch("app.routers.tracking._execute_run_with_id") as mock_execute:
        mock_execute.return_value = None
        
        # Trigger second run
        run_resp = await client.post(f"/api/tracking/run/{brand_id}", headers=headers)
        assert run_resp.status_code == 202
        
        # Verify this run is manual, not onboarding
        async with AsyncSessionLocal() as db:
            run = await db.get(TrackingRun, run_resp.json()["run_id"])
            assert run.run_type == "manual"
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd /Users/ken/Desktop/Lumidian/backend && source venv/bin/activate
pytest tests/test_first_run_pipeline.py::test_first_run_triggers_onboarding_pipeline -v 2>&1 | tail -20
```

Expected: FAIL (run_type is "manual" not "onboarding")

- [ ] **Step 3: Implement first-run detection in trigger_run**

In `backend/app/routers/tracking.py`, find the `trigger_run` function. Replace the TrackingRun creation block (around lines 71-80):

```python
    # Pre-create the TrackingRun record so we can return its ID immediately.
    tracking_run = TrackingRun(
        brand_id=brand_id,
        status="pending",
        run_type="manual",
    )
```

With:

```python
    # Detect if this is the brand's first-ever run (triggers onboarding pipeline)
    from sqlalchemy import func as sqlfunc
    completed_runs_result = await db.execute(
        select(sqlfunc.count(TrackingRun.id)).where(
            TrackingRun.brand_id == brand_id,
            TrackingRun.status == "completed",
        )
    )
    is_first_run = (completed_runs_result.scalar_one() or 0) == 0
    run_type = "onboarding" if is_first_run else "manual"
    
    # Pre-create the TrackingRun record so we can return its ID immediately.
    tracking_run = TrackingRun(
        brand_id=brand_id,
        status="pending",
        run_type=run_type,
    )
```

- [ ] **Step 4: Update `_execute_run_with_id` to fire onboarding post-process**

In the same file, find `_execute_run_with_id` function. At the very end of the function (after the gap analysis block, around line 471), add:

```python
    # Fire onboarding post-process pipeline for first-time runs
    async with AsyncSessionLocal() as check_db:
        run_check = await check_db.get(TrackingRun, run_id)
        if run_check and run_check.run_type == "onboarding":
            logger.info(
                "First run %d complete — firing onboarding post-process for brand_id=%d",
                run_id, brand_id,
            )
            from app.services.tracking_service import _onboarding_post_process
            asyncio.create_task(
                _onboarding_post_process(brand_id),
                name=f"onboarding-post-{brand_id}",
            )
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
cd /Users/ken/Desktop/Lumidian/backend && source venv/bin/activate
pytest tests/test_first_run_pipeline.py -v
```

Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add backend/app/routers/tracking.py backend/tests/test_first_run_pipeline.py
git commit -m "feat: auto-detect first run and trigger onboarding pipeline"
```

---

## Task 7: Add scanning state to manual scans

**Files:**
- Modify: `backend/app/routers/opportunities.py`
- Create: `backend/tests/test_banner_state.py`

- [ ] **Step 1: Write the failing test**

Create `backend/tests/test_banner_state.py`:

```python
"""Tests for banner state management."""
import pytest
from httpx import AsyncClient
from unittest.mock import patch

from tests.conftest import register_and_login


@pytest.mark.asyncio
async def test_manual_scan_sets_scanning_state(client: AsyncClient):
    """Manual scan should add brand to state.scanning_brands."""
    token = await register_and_login(client, "scanstate@test.com", "password123", tier="starter")
    headers = {"Authorization": f"Bearer {token}"}
    
    # Create a brand
    brand_resp = await client.post(
        "/api/brands",
        json={"name": "ScanStateBrand", "tier": "basic", "brand_type": "standard", "prompts": ["test"]},
        headers=headers,
    )
    assert brand_resp.status_code == 201
    brand_id = brand_resp.json()["id"]
    
    from app import state
    
    # Clear any existing state
    state.scanning_brands.clear()
    
    # Mock the actual scan to be instant and check state during execution
    scanning_during_call = []
    
    async def mock_scan_and_log(bid):
        scanning_during_call.append(bid in state.scanning_brands)
        # State should be set before scan runs
    
    with patch("app.routers.opportunities._scan_and_log", side_effect=mock_scan_and_log):
        scan_resp = await client.post(f"/api/opportunities/{brand_id}/scan", headers=headers)
        assert scan_resp.status_code == 202
    
    # Give the async task a moment to start
    import asyncio
    await asyncio.sleep(0.1)
    
    # The scan should have seen the brand in scanning_brands
    assert len(scanning_during_call) > 0, "Mock scan was not called"
    assert scanning_during_call[0] is True, "Brand was not in scanning_brands during scan"


@pytest.mark.asyncio
async def test_background_status_reflects_scanning(client: AsyncClient):
    """Background status API should reflect scanning state."""
    token = await register_and_login(client, "bgstatus@test.com", "password123")
    headers = {"Authorization": f"Bearer {token}"}
    
    # Create a brand
    brand_resp = await client.post(
        "/api/brands",
        json={"name": "BgStatusBrand", "tier": "basic", "brand_type": "pitch", "prompts": ["test"]},
        headers=headers,
    )
    brand_id = brand_resp.json()["id"]
    
    from app import state
    
    # Initially, scanning should be false
    status_resp = await client.get("/api/tracking/background-status", headers=headers)
    assert status_resp.status_code == 200
    assert status_resp.json()["scanning"] is False
    
    # Manually add to scanning state
    state.scanning_brands.add(brand_id)
    
    # Now scanning should be true
    status_resp = await client.get("/api/tracking/background-status", headers=headers)
    assert status_resp.json()["scanning"] is True
    
    # Clean up
    state.scanning_brands.discard(brand_id)
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd /Users/ken/Desktop/Lumidian/backend && source venv/bin/activate
pytest tests/test_banner_state.py::test_manual_scan_sets_scanning_state -v 2>&1 | tail -20
```

Expected: FAIL (brand not in scanning_brands during scan)

- [ ] **Step 3: Update trigger_scan to set scanning state**

In `backend/app/routers/opportunities.py`, find the `trigger_scan` function. Replace the `asyncio.create_task` block at the end (around lines 231-235):

```python
    asyncio.create_task(
        _scan_and_log(brand_id),
        name=f"reddit-scan-{brand_id}",
    )
    return {"message": f"Scan started for brand {brand_id}", "brand_id": brand_id}
```

With:

```python
    from app import state as _state
    
    # Add to scanning state before starting
    _state.scanning_brands.add(brand_id)
    
    async def _scan_with_state_cleanup(bid: int):
        try:
            await _scan_and_log(bid)
        finally:
            _state.scanning_brands.discard(bid)
    
    asyncio.create_task(
        _scan_with_state_cleanup(brand_id),
        name=f"reddit-scan-{brand_id}",
    )
    return {"message": f"Scan started for brand {brand_id}", "brand_id": brand_id}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd /Users/ken/Desktop/Lumidian/backend && source venv/bin/activate
pytest tests/test_banner_state.py -v
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/app/routers/opportunities.py backend/tests/test_banner_state.py
git commit -m "feat: manual scans update scanning state for banner display"
```

---

## Task 8: Implement pitch brand manual limits

**Files:**
- Modify: `backend/app/routers/tracking.py`
- Modify: `backend/app/routers/opportunities.py`
- Create: `backend/tests/test_pitch_limits.py`

- [ ] **Step 1: Write the failing test for pitch run limits**

Create `backend/tests/test_pitch_limits.py`:

```python
"""Tests for pitch brand manual action limits."""
import pytest
from datetime import datetime, timezone, timedelta
from httpx import AsyncClient
from unittest.mock import patch

from tests.conftest import register_and_login


@pytest.mark.asyncio
async def test_pitch_brand_daily_run_limit(client: AsyncClient):
    """Pitch brand should be limited to 1 manual run per day."""
    token = await register_and_login(client, "pitchrun@test.com", "password123")
    headers = {"Authorization": f"Bearer {token}"}
    
    # Create a pitch brand
    brand_resp = await client.post(
        "/api/brands",
        json={"name": "PitchRunLimit", "tier": "basic", "brand_type": "pitch", "prompts": ["test"]},
        headers=headers,
    )
    brand_id = brand_resp.json()["id"]
    
    # Create a completed run from today to simulate first run already used
    from app.database import AsyncSessionLocal
    from app.models import TrackingRun
    async with AsyncSessionLocal() as db:
        today_run = TrackingRun(
            brand_id=brand_id,
            status="completed",
            run_type="manual",
            created_at=datetime.now(timezone.utc).replace(tzinfo=None),
            completed_at=datetime.now(timezone.utc).replace(tzinfo=None),
        )
        db.add(today_run)
        await db.commit()
    
    # Second run today should be blocked
    run_resp = await client.post(f"/api/tracking/run/{brand_id}", headers=headers)
    assert run_resp.status_code == 429
    assert "1" in run_resp.json()["detail"]  # mentions the limit


@pytest.mark.asyncio
async def test_pitch_brand_weekly_scan_limit(client: AsyncClient):
    """Pitch brand should be limited to 1 manual scan per week."""
    token = await register_and_login(client, "pitchscan@test.com", "password123", tier="starter")
    headers = {"Authorization": f"Bearer {token}"}
    
    # Create a pitch brand
    brand_resp = await client.post(
        "/api/brands",
        json={"name": "PitchScanLimit", "tier": "basic", "brand_type": "pitch", "prompts": ["test"]},
        headers=headers,
    )
    brand_id = brand_resp.json()["id"]
    
    # Create a scan event from this week
    from app.database import AsyncSessionLocal
    from app.models import AnalyticsEvent
    async with AsyncSessionLocal() as db:
        scan_event = AnalyticsEvent(
            event_type="manual_scan_triggered",
            brand_id=brand_id,
            data={"brand_id": brand_id},
            created_at=datetime.now(timezone.utc).replace(tzinfo=None),
        )
        db.add(scan_event)
        await db.commit()
    
    # Second scan this week should be blocked
    scan_resp = await client.post(f"/api/opportunities/{brand_id}/scan", headers=headers)
    assert scan_resp.status_code == 429
    assert "1" in scan_resp.json()["detail"]  # mentions the limit
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd /Users/ken/Desktop/Lumidian/backend && source venv/bin/activate
pytest tests/test_pitch_limits.py::test_pitch_brand_daily_run_limit -v 2>&1 | tail -20
```

Expected: FAIL (no pitch-specific limit enforced)

- [ ] **Step 3: Add pitch run limit to tracking.py**

In `backend/app/routers/tracking.py`, find the `trigger_run` function. After the existing daily run limit check (the `if daily_limit is not None:` block, around line 64), add:

```python
    # Pitch brands have stricter limits (1/day) regardless of tier
    if brand.brand_type == "pitch":
        from app.routers.billing import DAILY_RUN_LIMITS_PITCH
        from datetime import datetime, timezone
        today_start = datetime.now(timezone.utc).replace(
            hour=0, minute=0, second=0, microsecond=0, tzinfo=None
        )
        pitch_runs_result = await db.execute(
            select(func.count(TrackingRun.id)).where(
                TrackingRun.brand_id == brand_id,
                TrackingRun.run_type == "manual",
                TrackingRun.created_at >= today_start,
            )
        )
        pitch_runs_today = pitch_runs_result.scalar_one()
        if pitch_runs_today >= DAILY_RUN_LIMITS_PITCH:
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail=f"Pitch brands are limited to {DAILY_RUN_LIMITS_PITCH} manual run per day. Try again tomorrow.",
            )
```

Note: You'll need to add `from sqlalchemy import func` at the top if not already imported, and ensure `brand` is loaded before this check (we already load it for the pause check).

- [ ] **Step 4: Add pitch scan limit to opportunities.py**

In `backend/app/routers/opportunities.py`, find `trigger_scan`. After the existing weekly scan limit check (around line 226), add:

```python
    # Pitch brands have stricter limits (1/week) regardless of tier
    if brand.brand_type == "pitch":
        from app.routers.billing import WEEKLY_SCAN_LIMITS_PITCH
        pitch_scan_result = await db.execute(
            select(sqlfunc.count(AnalyticsEvent.id)).where(
                AnalyticsEvent.brand_id == brand_id,
                AnalyticsEvent.event_type == "manual_scan_triggered",
                AnalyticsEvent.created_at >= week_ago,
            )
        )
        pitch_scans = pitch_scan_result.scalar_one_or_none() or 0
        if pitch_scans >= WEEKLY_SCAN_LIMITS_PITCH:
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail=f"Pitch brands are limited to {WEEKLY_SCAN_LIMITS_PITCH} manual scan per week. Try again next week.",
            )
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
cd /Users/ken/Desktop/Lumidian/backend && source venv/bin/activate
pytest tests/test_pitch_limits.py -v
```

Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add backend/app/routers/tracking.py backend/app/routers/opportunities.py backend/tests/test_pitch_limits.py
git commit -m "feat: enforce pitch brand manual action limits (1 run/day, 1 scan/week)"
```

---

## Task 9: Validate brand_type on creation and enforce prompt limits

**Files:**
- Modify: `backend/app/routers/brands.py`

- [ ] **Step 1: Update brand creation to validate brand_type and set prompt_limit**

In `backend/app/routers/brands.py`, find the `create_brand` function. Replace the brand creation block (around lines 248-256):

```python
    brand = Brand(
        name=payload.name,
        slug=slug,
        tier=payload.tier,
        brand_type=payload.brand_type,
        pitch_expires_at=pitch_expires_at,
        user_id=user.id,
        website_url=payload.website_url,
    )
```

With:

```python
    from app.routers.billing import PROMPT_LIMITS, BRAND_TYPE_LIMITS
    
    # Validate brand_type is allowed for this tier
    tier_limits = BRAND_TYPE_LIMITS.get(user.subscription_tier, BRAND_TYPE_LIMITS[None])
    if payload.brand_type not in tier_limits or tier_limits[payload.brand_type] == 0:
        if payload.brand_type == "pro":
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Pro brands require a Pro subscription. Upgrade to create pro brands.",
            )
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"Your subscription does not allow creating {payload.brand_type} brands.",
        )
    
    # Set prompt limit based on brand type
    prompt_limit = PROMPT_LIMITS.get(payload.brand_type, 25)
    
    brand = Brand(
        name=payload.name,
        slug=slug,
        tier=payload.tier,
        brand_type=payload.brand_type,
        prompt_limit=prompt_limit,
        pitch_expires_at=pitch_expires_at,
        user_id=user.id,
        website_url=payload.website_url,
    )
```

- [ ] **Step 2: Enforce prompt limit when adding prompts**

In the same file, find the route for adding prompts (`@router.post("/{brand_id}/prompts"`). After loading the brand (around line 330), add:

```python
    # Check prompt limit
    from sqlalchemy import func as sqlfunc
    prompt_count_result = await db.execute(
        select(sqlfunc.count(Prompt.id)).where(Prompt.brand_id == brand_id)
    )
    current_count = prompt_count_result.scalar_one()
    limit = getattr(brand, "prompt_limit", 25)
    if current_count >= limit:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Prompt limit reached ({limit}). Delete a prompt or upgrade your brand type.",
        )
```

- [ ] **Step 3: Run existing brand tests**

```bash
cd /Users/ken/Desktop/Lumidian/backend && source venv/bin/activate
pytest tests/test_brands.py -v 2>&1 | tail -30
```

Expected: All tests pass

- [ ] **Step 4: Commit**

```bash
git add backend/app/routers/brands.py
git commit -m "feat: validate brand_type on creation and enforce prompt limits"
```

---

## Task 10: Clean up AppShell localStorage handling

**Files:**
- Modify: `frontend/components/AppShell.tsx`

- [ ] **Step 1: Simplify localStorage usage in AppShell**

In `frontend/components/AppShell.tsx`, the localStorage sync is currently used as a fast-path. The API polling every 3s is the source of truth. Update the `syncLocal` function (around lines 43-48) to only handle report_running and drafts_generating (which are written by other pages), but not scanning:

```typescript
    // Fast-path: sync from localStorage for instant feedback on report/drafts
    // (scanning state comes purely from API since no page writes it)
    const syncLocal = () => {
      try {
        if (localStorage.getItem('clarity_report_running')) setReportRunning(true);
        if (localStorage.getItem('clarity_drafts_generating')) setDraftsGenerating(true);
        // Note: scanning state comes from API only
      } catch {}
    };
```

- [ ] **Step 2: Verify frontend builds**

```bash
cd /Users/ken/Desktop/Lumidian/frontend && npm run build 2>&1 | tail -20
```

Expected: Build succeeds

- [ ] **Step 3: Commit**

```bash
git add frontend/components/AppShell.tsx
git commit -m "refactor: simplify AppShell localStorage handling for banner state"
```

---

## Task 11: Run full test suite and verify

**Files:**
- All test files

- [ ] **Step 1: Run all new tests**

```bash
cd /Users/ken/Desktop/Lumidian/backend && source venv/bin/activate
pytest tests/test_brand_pause.py tests/test_first_run_pipeline.py tests/test_banner_state.py tests/test_pitch_limits.py -v
```

Expected: All tests pass

- [ ] **Step 2: Run existing tests to verify no regressions**

```bash
cd /Users/ken/Desktop/Lumidian/backend && source venv/bin/activate
pytest tests/test_brands.py tests/test_tracking.py tests/test_content.py -v 2>&1 | tail -40
```

Expected: All tests pass

- [ ] **Step 3: Final commit for any fixes**

If any tests failed and were fixed:

```bash
git add -A
git commit -m "fix: address test failures from brand tiers implementation"
```

---

## Task 12: Handle subscription changes in Stripe webhook

**Files:**
- Modify: `backend/app/routers/billing.py`

- [ ] **Step 1: Find the webhook handler**

In `backend/app/routers/billing.py`, locate the Stripe webhook handler (search for `@router.post("/webhook")`).

- [ ] **Step 2: Add upgrade handling (Standard → Pro)**

In the webhook handler, find where subscription updates are processed (look for `customer.subscription.updated` or similar). Add logic to auto-upgrade brands:

```python
# Handle subscription tier upgrade (standard → pro)
if event_type == "customer.subscription.updated":
    subscription = event_data.get("object", {})
    # Get the price ID to determine new tier
    items = subscription.get("items", {}).get("data", [])
    if items:
        price_id = items[0].get("price", {}).get("id", "")
        new_tier = None
        if price_id == os.getenv("STRIPE_PRO_PRICE_ID"):
            new_tier = "pro"
        elif price_id == os.getenv("STRIPE_STARTER_PRICE_ID"):
            new_tier = "starter"
        
        if new_tier == "pro":
            # Auto-upgrade standard brands to pro
            customer_id = subscription.get("customer")
            async with AsyncSessionLocal() as db:
                user_result = await db.execute(
                    select(User).where(User.stripe_customer_id == customer_id)
                )
                user = user_result.scalar_one_or_none()
                if user:
                    await db.execute(
                        update(Brand)
                        .where(Brand.user_id == user.id, Brand.brand_type == "standard")
                        .values(brand_type="pro", prompt_limit=100)
                    )
                    await db.commit()
                    logger.info("Auto-upgraded standard brands to pro for user %d", user.id)
```

- [ ] **Step 3: Add downgrade/lapsed handling**

In the same webhook handler, add handling for subscription cancellation or payment failure:

```python
# Handle subscription lapsed/canceled
if event_type in ("customer.subscription.deleted", "invoice.payment_failed"):
    customer_id = event_data.get("object", {}).get("customer")
    if customer_id:
        async with AsyncSessionLocal() as db:
            user_result = await db.execute(
                select(User).where(User.stripe_customer_id == customer_id)
            )
            user = user_result.scalar_one_or_none()
            if user:
                # Update subscription status to trigger pause logic
                user.subscription_status = "past_due" if event_type == "invoice.payment_failed" else "canceled"
                await db.commit()
                logger.info("Subscription lapsed for user %d, brands will pause", user.id)
```

- [ ] **Step 4: Verify webhook handler imports**

Ensure these imports are at the top of the file:

```python
from sqlalchemy import update
from app.models import Brand
```

- [ ] **Step 5: Commit**

```bash
git add backend/app/routers/billing.py
git commit -m "feat: handle subscription upgrades/downgrades in Stripe webhook"
```

---

## Summary

This plan implements:

1. **Brand pause functionality** — expired pitch brands and lapsed subscriptions block writes
2. **First-run detection** — auto-triggers onboarding pipeline (drafts + scans)
3. **Banner state management** — manual scans now update `state.scanning_brands`
4. **Pitch brand limits** — 1 run/day, 1 draft/week (existing), 1 scan/week
5. **Brand type validation** — enforces tier-based brand creation rules
6. **Prompt limits** — per brand type (10/25/100)
7. **Subscription change handling** — auto-upgrade on Standard→Pro, pause on lapse

Not included (future work):
- Frontend brand type selector UI
- Dashboard/Content pages showing paused state visually
