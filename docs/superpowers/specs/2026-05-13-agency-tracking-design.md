# Agency Tracking — In-Cockpit Trigger + Weekly Cadence — Design

**Date:** 2026-05-13
**Status:** Approved (autonomous mode). Sub-project F of the agency-portal-OS roadmap.

---

## Context

Agency cockpit shows the latest tracking score but staff can't trigger a new run from inside the agency portal — they have to bounce to the SaaS `/dashboard`. Plus, agency-tier brands need a different cadence than SaaS brands: a weekly comprehensive run (Sunday night) rather than the standard daily morning sweep that runs the SaaS catalogue.

## Goals

1. New backend endpoint `POST /api/agency/clients/{client_id}/tracking/run` — trigger a tracking run on demand, bypasses SaaS subscription gating, gated by `require_agency_staff`.
2. New scheduler job: every Sunday at 02:00 UTC, kick off a tracking run for every `brand_type='agency'` brand.
3. "Run tracking now" button in the cockpit Tracking section.
4. Extend `LumidianTrackingWidget` (or add a sibling component) with a per-prompt breakdown — which prompts are doing best/worst — so staff can see which prompts to drop or rework.
5. Stop scheduling agency brands in the existing daily morning sweep (avoid double-running).

## Non-Goals

- Backend schema changes.
- Comprehensive report generation (that's sub-project G — uses the data this produces).
- Live-streaming run status to the cockpit (post-run, the widget will refetch).
- Custom cadence per agency brand (all agency brands share the Sunday cadence in v1).

## Backend

### 1. Skip agency brands in the daily morning sweep

In `backend/app/scheduler.py`, `_run_all_brands(...)`, add a filter: skip brands with `brand_type='agency'`. They have their own Sunday cadence and shouldn't run on the daily SaaS sweep.

```python
for brand in brands:
    if brand.brand_type == "agency":
        continue
    # … existing checks (paused etc.) and run dispatch …
```

### 2. New scheduler job: weekly agency sweep

In `backend/app/scheduler.py`, add a new async function near `_run_all_brands`:

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
        # Join Brand → AgencyClient and skip churned/paused clients
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

In `start_scheduler()`, register it:

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

Note: `_safe_run` already accepts an arbitrary `schedule_slot` string. Passing `"weekly"` means the existing tracking pipeline records this run with `schedule_slot='weekly'`. Existing UI doesn't filter on slot so no other changes needed.

### 3. New on-demand trigger endpoint

Append to `backend/app/routers/agency.py`:

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
    client = await db.get(AgencyClient, client_id)
    if client is None:
        raise HTTPException(status_code=404, detail="Client not found")
    brand_q = await db.execute(select(Brand).where(Brand.agency_client_id == client_id).limit(1))
    brand = brand_q.scalar_one_or_none()
    if brand is None or brand.brand_type != "agency":
        raise HTTPException(status_code=400, detail="Brand is not agency-tier")

    from app.services.tracking_service import run_tracking
    import asyncio as _asyncio
    # Fire-and-forget; the existing tracking pipeline handles its own DB session
    _asyncio.create_task(
        run_tracking(brand_id=brand.id, run_type="manual", schedule_slot=None),
        name=f"agency-manual-{brand.id}",
    )
    return {"detail": "Tracking run started", "brand_id": brand.id}
```

The existing `run_tracking()` function is the same one called by the scheduler. No new tracking logic — just a different surface.

### 4. Tests

`backend/tests/test_agency_tracking.py`:
- Trigger endpoint returns 202 for an agency-tier client
- Trigger endpoint returns 400 when brand isn't agency-tier
- Trigger endpoint returns 404 when client missing
- (Don't test the actual tracking — that's covered by existing tracking tests)

The scheduler job's actual behavior is exercised in production. No unit test for the cron registration itself.

## Frontend

### 1. API client method

In `frontend/lib/api.ts`:

```typescript
export async function agencyTriggerTracking(clientId: number): Promise<void> {
  await api.post(`/agency/clients/${clientId}/tracking/run`);
}
```

### 2. "Run tracking now" button on cockpit

In `frontend/components/agency/ClientCockpit.tsx`, find the Tracking section header. Currently:

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
    <RunTrackingButton clientId={client.id} onTriggered={() => setTrackingRefreshKey((k) => k + 1)} />
  </div>
  <LumidianTrackingWidget key={trackingRefreshKey} brandId={client.brand_id} />
  <PromptScoresPanel brandId={client.brand_id} />
</section>
```

Add `const [trackingRefreshKey, setTrackingRefreshKey] = useState(0);` to the component state.

The widget already takes `brandId` and refetches on mount — adding `key` causes a remount when triggered. The new `RunTrackingButton` is a small component; `PromptScoresPanel` is new and shows per-prompt breakdown.

### 3. RunTrackingButton component

New `frontend/components/agency/RunTrackingButton.tsx`:

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
      // Refresh the widget after a short delay; tracking takes a moment
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

### 4. PromptScoresPanel component

New `frontend/components/agency/PromptScoresPanel.tsx`:

Fetches `/api/results/{brand_id}/prompts/overview` (existing endpoint), renders a compact list of prompts with their current scores, color-coded.

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

### 5. API client additions (if needed)

If `getPromptsOverview(brandId)` doesn't already exist in `frontend/lib/api.ts`, add it:

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
  return dedupedGet<PromptsOverviewResponse>(`/results/${brandId}/prompts/overview`);
}
```

Check first — this may already exist.

## Testing

Backend:
- `POST /api/agency/clients/{id}/tracking/run` → 202 with brand_id
- Same on non-agency-tier client → 400
- Same on missing client → 404
- Scheduler job exists with id `weekly_agency_sweep` after `start_scheduler()` is called

Frontend: type-check + manual smoke.

## Risks

- **Tracking run takes 1-3 minutes.** UI shows "Tracking started…" message but doesn't block. Refetch after 90s via setTimeout in `RunTrackingButton`. Good enough for v1.
- **Sunday-only cadence may not catch up if missed.** APScheduler `misfire_grace_time=3600` allows up to 1 hour late. If the server is down >1hr at the trigger window, the run skips that week. Acceptable.
- **Existing daily sweep was running agency brands too.** Fix in §1 prevents double-spend on LLM calls.

## Out of scope

- "Comprehensive weekly report" generation — sub-project G uses this data.
- Live progress UI for the tracking run — too much for v1; the widget refetches after 90s.
- Configurable cadence per brand — defer.
