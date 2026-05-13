# Agency Tracking Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development.

**Goal:** Sub-project F — in-cockpit tracking trigger + weekly cadence for agency-tier brands + per-prompt scores panel.

**Architecture:** Backend: skip agency brands in the existing daily morning sweep; new weekly Sunday job for them; new `POST /api/agency/clients/{id}/tracking/run` on-demand endpoint. Frontend: `RunTrackingButton` + `PromptScoresPanel` components wired into the cockpit Tracking section.

**Tech Stack:** FastAPI, APScheduler, SQLAlchemy async, pytest. Next.js, React, Tailwind.

**Spec:** `docs/superpowers/specs/2026-05-13-agency-tracking-design.md`

---

## Task 1: Scheduler — skip agency in daily sweep + add weekly sweep

**Files:** Modify `backend/app/scheduler.py`

- [ ] **Step 1: Skip agency brands in `_run_all_brands`**

Find the loop in `_run_all_brands`:
```python
    for brand in brands:
        # Skip paused brands
        if _is_brand_paused(brand, paused_user_ids):
            logger.info(...)
            continue
```

Insert a check right BEFORE the existing paused check:
```python
    for brand in brands:
        if brand.brand_type == "agency":
            continue  # agency brands have their own weekly sweep
        # Skip paused brands
        if _is_brand_paused(brand, paused_user_ids):
            ...
```

- [ ] **Step 2: Add `_run_all_agency_brands` function near `_run_all_brands`**

Append (after `_run_all_brands`):

```python
async def _run_all_agency_brands() -> None:
    """Fetch agency-tier brands and trigger a tracking run for each. Runs weekly."""
    if await _is_scheduler_paused():
        logger.info("Scheduler paused — skipping weekly agency sweep")
        return

    from sqlalchemy import select
    from app.database import AsyncSessionLocal, cleanup_stale_runs
    from app.models import AgencyClient, Brand

    logger.info("Scheduler: starting weekly agency sweep")
    await cleanup_stale_runs()

    async with AsyncSessionLocal() as db:
        rows = await db.execute(
            select(Brand).join(
                AgencyClient, AgencyClient.id == Brand.agency_client_id
            ).where(
                Brand.brand_type == "agency",
                AgencyClient.status.in_(("onboarding", "active")),
            )
        )
        brands = rows.scalars().all()

    if not brands:
        logger.info("Scheduler: no agency brands, skipping weekly sweep")
        return

    for brand in brands:
        logger.info("Scheduler: queuing weekly tracking for agency brand %d (%s)", brand.id, brand.name)
        asyncio.create_task(
            _safe_run(brand.id, "weekly"),
            name=f"tracking-agency-{brand.id}",
        )
```

- [ ] **Step 3: Register the job in `start_scheduler`**

In `start_scheduler()`, append a new `add_job` call (after the existing 5 jobs, before `scheduler.start()`):

```python
    scheduler.add_job(
        _run_all_agency_brands,
        trigger=CronTrigger(day_of_week="sun", hour=2, minute=0, timezone="UTC"),
        id="weekly_agency_sweep",
        name="Weekly agency tracking sweep (Sunday 02:00 UTC)",
        replace_existing=True,
        misfire_grace_time=3600,
    )
```

- [ ] **Step 4: Verify the app boots and registers the job**

```bash
cd /Users/ken/Desktop/Lumidian/backend
source venv/bin/activate
python -c "
import asyncio
from app.scheduler import scheduler, start_scheduler, stop_scheduler
start_scheduler()
print([j.id for j in scheduler.get_jobs()])
stop_scheduler()
"
```

Expected: list includes `weekly_agency_sweep`.

- [ ] **Step 5: Commit**

```bash
git add backend/app/scheduler.py
git commit -m "feat(scheduler): weekly agency sweep + skip agency brands in daily sweep"
```

---

## Task 2: Agency tracking trigger endpoint

**Files:** Modify `backend/app/routers/agency.py`

- [ ] **Step 1: Append the endpoint at the bottom of `agency.py`**

```python
@router.post(
    "/clients/{client_id}/tracking/run",
    status_code=http_status.HTTP_202_ACCEPTED,
)
async def agency_trigger_tracking(
    client_id: int,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_agency_staff),
):
    """Kick off a tracking run for an agency client's brand. Bypasses SaaS tier checks."""
    import asyncio as _asyncio

    client = await db.get(AgencyClient, client_id)
    if client is None:
        raise HTTPException(status_code=404, detail="Client not found")
    brand_q = await db.execute(select(Brand).where(Brand.agency_client_id == client_id).limit(1))
    brand = brand_q.scalar_one_or_none()
    if brand is None or brand.brand_type != "agency":
        raise HTTPException(status_code=400, detail="Brand is not agency-tier")

    from app.services.tracking_service import run_tracking

    _asyncio.create_task(
        run_tracking(brand_id=brand.id, run_type="manual", schedule_slot=None),
        name=f"agency-manual-{brand.id}",
    )
    return {"detail": "Tracking run started", "brand_id": brand.id}
```

- [ ] **Step 2: Verify the route**

```bash
cd /Users/ken/Desktop/Lumidian/backend
source venv/bin/activate
python -c "from app.main import app
for r in app.routes:
    p = str(getattr(r, 'path', ''))
    if 'tracking/run' in p and '/agency' in p:
        print(p)"
```

Expected: prints `/api/agency/clients/{client_id}/tracking/run`.

- [ ] **Step 3: Commit**

```bash
git add backend/app/routers/agency.py
git commit -m "feat(backend): agency on-demand tracking trigger endpoint"
```

---

## Task 3: Backend tests

**Files:** Create `backend/tests/test_agency_tracking.py`

- [ ] **Step 1: Create the test file**

```python
"""Tests for the agency tracking trigger endpoint."""
from __future__ import annotations

from unittest.mock import AsyncMock, patch

import pytest
from sqlalchemy import select, update

from app.database import AsyncSessionLocal
from app.models import AgencyStaff, Brand, User
from tests.conftest import register_and_login


async def _make_agency_user(client, email: str = "track@example.com") -> None:
    await register_and_login(client, email=email)
    async with AsyncSessionLocal() as db:
        await db.execute(update(User).where(User.email == email).values(is_agency_staff=True))
        user = (await db.execute(select(User).where(User.email == email))).scalar_one()
        existing = (
            await db.execute(select(AgencyStaff).where(AgencyStaff.user_id == user.id))
        ).scalar_one_or_none()
        if existing is None:
            db.add(AgencyStaff(user_id=user.id, role="owner", active=True))
        await db.commit()


async def _create_agency_client(client, name: str = "TrackCo") -> tuple[int, int]:
    resp = await client.post("/api/agency/clients", json={"name": name})
    assert resp.status_code == 201, resp.text
    body = resp.json()
    return body["id"], body["brand_id"]


@pytest.mark.asyncio
async def test_trigger_tracking_returns_202(client):
    await _make_agency_user(client)
    cid, brand_id = await _create_agency_client(client)
    # Don't actually run tracking — patch the symbol where the agency router imports it from
    with patch(
        "app.services.tracking_service.run_tracking",
        new=AsyncMock(return_value=1),
    ):
        resp = await client.post(f"/api/agency/clients/{cid}/tracking/run")
    assert resp.status_code == 202, resp.text
    body = resp.json()
    assert body["brand_id"] == brand_id


@pytest.mark.asyncio
async def test_trigger_tracking_rejects_non_agency_brand(client, db_session):
    await _make_agency_user(client)
    cid, brand_id = await _create_agency_client(client)
    # Flip brand_type back to standard
    await db_session.execute(update(Brand).where(Brand.id == brand_id).values(brand_type="standard"))
    await db_session.commit()
    resp = await client.post(f"/api/agency/clients/{cid}/tracking/run")
    assert resp.status_code == 400


@pytest.mark.asyncio
async def test_trigger_tracking_unknown_client_404(client):
    await _make_agency_user(client)
    resp = await client.post("/api/agency/clients/9999/tracking/run")
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_weekly_agency_sweep_is_registered():
    from app.scheduler import scheduler, start_scheduler, stop_scheduler

    start_scheduler()
    try:
        job_ids = {j.id for j in scheduler.get_jobs()}
        assert "weekly_agency_sweep" in job_ids
    finally:
        stop_scheduler()
```

- [ ] **Step 2: Run tests**

```bash
cd /Users/ken/Desktop/Lumidian/backend
source venv/bin/activate
pytest tests/test_agency_tracking.py -v --timeout=60
```

Expected: 4 tests PASS.

Also run the broader agency suite for regressions:
```bash
pytest tests/test_agency.py tests/test_agency_drafting.py tests/test_agency_documents.py tests/test_agency_tasks.py tests/test_agency_activity.py tests/test_review_public.py -v --timeout=60
```

Expected: all pass.

- [ ] **Step 3: Commit**

```bash
git add backend/tests/test_agency_tracking.py
git commit -m "test(backend): agency tracking trigger + weekly sweep registration"
```

---

## Task 4: Frontend API methods

**Files:** Modify `frontend/lib/api.ts`

- [ ] **Step 1: Check if `getPromptsOverview` already exists**

```bash
grep -n "getPromptsOverview\|PromptsOverviewResponse" /Users/ken/Desktop/Lumidian/frontend/lib/api.ts
```

If it exists, skip Step 2.

- [ ] **Step 2: If missing, add the prompts-overview type + fetcher**

Append to `frontend/lib/api.ts`:

```typescript
export interface PromptOverviewItem {
  prompt_id: number;
  prompt_text: string;
  current_overall: number;
  trend: string;
  sparkline: number[];
  model_scores: Record<string, number>;
  drafts_posted: number;
  last_draft_at: string | null;
  has_recent_content_event: boolean;
}

export interface PromptsOverviewResponse {
  prompts: PromptOverviewItem[];
}

export async function getPromptsOverview(brandId: number): Promise<PromptsOverviewResponse> {
  const res = await api.get<PromptsOverviewResponse>(`/results/${brandId}/prompts/overview`);
  return res.data;
}
```

- [ ] **Step 3: Add the trigger-tracking method**

Append to `frontend/lib/api.ts`:

```typescript
export async function agencyTriggerTracking(clientId: number): Promise<void> {
  await api.post(`/agency/clients/${clientId}/tracking/run`);
}
```

- [ ] **Step 4: TS check**

```bash
cd /Users/ken/Desktop/Lumidian/frontend
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add frontend/lib/api.ts
git commit -m "feat(frontend): agencyTriggerTracking + getPromptsOverview (if new)"
```

---

## Task 5: RunTrackingButton + PromptScoresPanel components

**Files:**
- Create: `frontend/components/agency/RunTrackingButton.tsx`
- Create: `frontend/components/agency/PromptScoresPanel.tsx`

- [ ] **Step 1: RunTrackingButton**

```tsx
'use client';

import { useState } from 'react';
import { Loader2, RefreshCw } from 'lucide-react';
import { agencyTriggerTracking } from '@/lib/api';

interface Props {
  clientId: number;
  onTriggered: () => void;
}

export function RunTrackingButton({ clientId, onTriggered }: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const run = async () => {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      await agencyTriggerTracking(clientId);
      setMessage('Tracking started. Scores will update in 1–3 minutes.');
      setTimeout(onTriggered, 90_000);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to start tracking');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex items-center gap-3">
      {message && <span className="text-xs text-[var(--text-muted)]">{message}</span>}
      {error && <span className="text-xs text-red-400">{error}</span>}
      <button
        onClick={run}
        disabled={busy}
        className="flex items-center gap-2 rounded-md border border-[var(--border-default)] bg-[var(--bg-elevated)] px-3 py-1.5 text-xs font-medium text-[var(--text-primary)] hover:bg-[var(--bg-card)] disabled:opacity-50"
      >
        {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
        {busy ? 'Starting…' : 'Run tracking now'}
      </button>
    </div>
  );
}
```

- [ ] **Step 2: PromptScoresPanel**

```tsx
'use client';

import { useEffect, useState } from 'react';
import { TrendingDown, TrendingUp, Minus } from 'lucide-react';
import { getPromptsOverview, type PromptsOverviewResponse } from '@/lib/api';

interface Props {
  brandId: number | null;
}

function trendIcon(trend: string) {
  if (trend === 'up') return <TrendingUp className="h-3 w-3 text-emerald-400" />;
  if (trend === 'down') return <TrendingDown className="h-3 w-3 text-rose-400" />;
  return <Minus className="h-3 w-3 text-[var(--text-muted)]" />;
}

function scoreColor(score: number): string {
  if (score >= 70) return 'text-emerald-300';
  if (score >= 40) return 'text-amber-300';
  return 'text-rose-300';
}

export function PromptScoresPanel({ brandId }: Props) {
  const [data, setData] = useState<PromptsOverviewResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (brandId == null) return;
    getPromptsOverview(brandId)
      .then(setData)
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load prompts'));
  }, [brandId]);

  if (brandId == null) return null;
  if (error) return <p className="mt-4 text-sm text-red-400">{error}</p>;
  if (!data) return <p className="mt-4 text-sm text-[var(--text-muted)]">Loading prompts…</p>;
  if (data.prompts.length === 0) {
    return (
      <p className="mt-4 text-sm text-[var(--text-muted)]">
        No tracked prompts yet. Add prompts in the Brand & prompts section.
      </p>
    );
  }

  const sorted = [...data.prompts].sort((a, b) => a.current_overall - b.current_overall);

  return (
    <section className="mt-4 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-card)] p-5">
      <h3 className="mb-3 text-sm font-medium text-[var(--text-secondary)]">
        Per-prompt scores (worst → best)
      </h3>
      <ul className="space-y-1.5">
        {sorted.map((p) => (
          <li key={p.prompt_id} className="flex items-center gap-3 text-sm">
            <span className={`w-12 font-mono font-medium ${scoreColor(p.current_overall)}`}>
              {Math.round(p.current_overall)}%
            </span>
            <span className="shrink-0">{trendIcon(p.trend)}</span>
            <span className="flex-1 truncate text-[var(--text-primary)]" title={p.prompt_text}>
              {p.prompt_text}
            </span>
            <span className="text-xs text-[var(--text-muted)]">
              {p.drafts_posted > 0 ? `${p.drafts_posted} posted` : '—'}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
```

- [ ] **Step 3: TS check**

```bash
cd /Users/ken/Desktop/Lumidian/frontend
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add frontend/components/agency/RunTrackingButton.tsx frontend/components/agency/PromptScoresPanel.tsx
git commit -m "feat(frontend): RunTrackingButton + PromptScoresPanel"
```

---

## Task 6: Wire into ClientCockpit

**Files:** Modify `frontend/components/agency/ClientCockpit.tsx`

- [ ] **Step 1: Add imports + state**

In `frontend/components/agency/ClientCockpit.tsx`:

1. Add imports:
```tsx
import { PromptScoresPanel } from './PromptScoresPanel';
import { RunTrackingButton } from './RunTrackingButton';
```

2. Add state in the component body (near the other useState calls):
```tsx
const [trackingRefreshKey, setTrackingRefreshKey] = useState(0);
```

- [ ] **Step 2: Replace the Tracking section**

Find the existing Tracking section:
```tsx
<section id="tracking" className="scroll-mt-24">
  <h2 className="mb-3 text-sm font-medium text-[var(--text-secondary)]">Tracking</h2>
  <LumidianTrackingWidget brandId={client.brand_id} />
</section>
```

Replace with:
```tsx
<section id="tracking" className="scroll-mt-24">
  <div className="mb-3 flex items-center justify-between">
    <h2 className="text-sm font-medium text-[var(--text-secondary)]">Tracking</h2>
    <RunTrackingButton
      clientId={client.id}
      onTriggered={() => setTrackingRefreshKey((k) => k + 1)}
    />
  </div>
  <LumidianTrackingWidget key={trackingRefreshKey} brandId={client.brand_id} />
  <PromptScoresPanel brandId={client.brand_id} />
</section>
```

- [ ] **Step 3: TS check**

```bash
cd /Users/ken/Desktop/Lumidian/frontend
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add frontend/components/agency/ClientCockpit.tsx
git commit -m "feat(frontend): wire RunTrackingButton + PromptScoresPanel into cockpit"
```

---

## Task 7: Smoke

**Files:** None — verification only.

- [ ] **Step 1: API smoke**

Start backend, hit the trigger endpoint, verify 202 returned + scheduler shows job:

```bash
cd /Users/ken/Desktop/Lumidian/backend && source venv/bin/activate && nohup uvicorn app.main:app --port 3001 > /tmp/f-be.log 2>&1 &
sleep 6
python <<'PY'
import asyncio, httpx
async def m():
    async with httpx.AsyncClient(base_url="http://localhost:3001", timeout=30.0) as c:
        r = await c.post("/api/auth/login", json={"email": "ken@lumidian.ai", "password": "bat422Tuw!"})
        cookie = r.cookies
        r = await c.post("/api/agency/clients", cookies=cookie, json={"name": "F-Smoke"})
        cid = r.json()["id"]
        # Trigger
        r = await c.post(f"/api/agency/clients/{cid}/tracking/run", cookies=cookie)
        print(f"trigger: {r.status_code} {r.text[:120]}")
        # Cleanup
        await c.delete(f"/api/agency/clients/{cid}", cookies=cookie)
asyncio.run(m())
PY
grep "weekly_agency_sweep\|Scheduler started" /tmp/f-be.log | head -5
pkill -f "uvicorn app.main:app --port 3001" 2>/dev/null
```

Expected:
- trigger: 202 with `{"detail":"Tracking run started","brand_id":N}`
- Scheduler logs include `weekly_agency_sweep` in the job list

No commit. Manual verification only.

---

## Self-Review

- Spec §1 (skip agency in daily sweep): Task 1 Step 1 ✓
- Spec §2 (weekly job): Task 1 Steps 2-3 ✓
- Spec §3 (trigger endpoint): Task 2 ✓
- Spec §4 tests: Task 3 ✓
- Spec frontend (API methods): Task 4 ✓
- Spec frontend (button + panel): Task 5 ✓
- Spec frontend (cockpit wiring): Task 6 ✓
- All code blocks complete. No placeholders.
