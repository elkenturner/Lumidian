# Manual-Only Opportunity Scanning — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove all scheduled opportunity scans and make scanning fully on-demand, with free users getting 2 manual scans/week (previously blocked).

**Architecture:** Two files change. Scheduler loses 4 sweep functions + 4 cron registrations. Opportunities router updates the free-tier scan limit from 0 to 2 and rewrites the 402 error message. Onboarding scan in `tracking_service.py` is untouched.

**Tech Stack:** Python/FastAPI, APScheduler, SQLAlchemy

---

### Task 1: Remove scheduled scanner sweep functions from scheduler

**Files:**
- Modify: `backend/app/scheduler.py:159-304` (delete 4 sweep functions)
- Modify: `backend/app/scheduler.py:650-684` (delete 4 cron job registrations)

- [ ] **Step 1: Delete the 4 scanner sweep functions**

Remove the entire block from line 159 (`async def _reddit_scanner_sweep`) through line 304 (end of `_x_scanner_sweep`). These are:
- `_reddit_scanner_sweep()` (lines 159-192)
- `_quora_scanner_sweep()` (lines 195-228)
- `_linkedin_scanner_sweep()` (lines 231-266)
- `_x_scanner_sweep()` (lines 269-304)

- [ ] **Step 2: Delete the 4 cron job registrations**

Remove the 4 `scheduler.add_job(...)` blocks that register these sweeps. They are consecutive blocks starting after the morning tracking sweep registration and ending before the `_website_context_refresh_sweep` registration. The blocks to remove:

```python
    scheduler.add_job(
        _reddit_scanner_sweep,
        trigger=CronTrigger(day_of_week="mon", hour=3, minute=15, timezone="UTC"),
        id="reddit_scanner",
        name="Reddit opportunity scanner (Monday 03:15 UTC)",
        replace_existing=True,
        misfire_grace_time=3600,
    )

    scheduler.add_job(
        _quora_scanner_sweep,
        trigger=CronTrigger(day_of_week="mon", hour=3, minute=30, timezone="UTC"),
        id="quora_scanner",
        name="Quora opportunity scanner (Monday 03:30 UTC)",
        replace_existing=True,
        misfire_grace_time=3600,
    )

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

- [ ] **Step 3: Verify scheduler still loads**

Run: `cd backend && source venv/bin/activate && python -c "from app.scheduler import start_scheduler; print('OK')"`

Expected: `OK` (no import errors)

- [ ] **Step 4: Commit**

```bash
git add backend/app/scheduler.py
git commit -m "feat: remove scheduled opportunity scanner cron jobs

Scanning is now fully manual/on-demand. Onboarding scan in
tracking_service.py is preserved."
```

---

### Task 2: Update free-tier scan limit and error messaging

**Files:**
- Modify: `backend/app/routers/billing.py:65-70` (update `WEEKLY_SCAN_LIMITS`)
- Modify: `backend/app/routers/opportunities.py:252-286` (update docstring + error message)

- [ ] **Step 1: Update `WEEKLY_SCAN_LIMITS` in billing.py**

Change the free-tier limits from 0 to 2 and update the comment:

Old:
```python
# Weekly manual opp-scan limits per brand.
# Free users only get the weekly auto-scan; manual re-scans require a paid plan.
WEEKLY_SCAN_LIMITS: dict = {
    None: 0, "": 0,
    "starter": 10,
    "pro": 25,
}
```

New:
```python
# Weekly manual opp-scan limits per brand (on-demand only, no auto-scans).
WEEKLY_SCAN_LIMITS: dict = {
    None: 2, "": 2,
    "starter": 10,
    "pro": 25,
}
```

- [ ] **Step 2: Update `trigger_scan` docstring and error message**

The old docstring and 402 block reference auto-scans and block free users. Update both.

Old docstring (lines 254-261):
```python
    """
    Trigger an on-demand opportunity scan for a brand (fire-and-forget).
    Returns immediately; scan runs in the background.

    Free users are blocked (they receive the automatic weekly scan instead).
    Starter: 10 manual scans per 7-day rolling window.
    Pro: 25 manual scans per 7-day rolling window.
    Admins: unlimited.
    """
```

New docstring:
```python
    """
    Trigger an on-demand opportunity scan for a brand (fire-and-forget).
    Returns immediately; scan runs in the background.

    Free: 2 scans per 7-day rolling window.
    Starter: 10 scans per 7-day rolling window.
    Pro: 25 scans per 7-day rolling window.
    Admins: unlimited.
    """
```

Old 402 block (lines 279-286) — this code path fires when `scan_limit == 0`, which no longer happens for free users. However, keep it as a defensive guard but update the message:

```python
        if scan_limit == 0:
            raise HTTPException(
                status_code=status.HTTP_402_PAYMENT_REQUIRED,
                detail=(
                    "Manual opportunity scans are available on Starter and Pro plans. "
                    "Your brand will be scanned automatically each week."
                ),
            )
```

New:
```python
        if scan_limit == 0:
            raise HTTPException(
                status_code=status.HTTP_402_PAYMENT_REQUIRED,
                detail="Opportunity scanning is not available for your current plan.",
            )
```

- [ ] **Step 3: Verify the router loads**

Run: `cd backend && source venv/bin/activate && python -c "from app.routers.opportunities import router; print('OK')"`

Expected: `OK`

- [ ] **Step 4: Commit**

```bash
git add backend/app/routers/billing.py backend/app/routers/opportunities.py
git commit -m "feat: allow free users 2 manual opportunity scans/week

Update WEEKLY_SCAN_LIMITS to give free tier 2 scans/week instead
of 0. Remove references to auto-scanning in docstrings/messages."
```
