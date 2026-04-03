# Brand Tiers, Banners & Onboarding Pipeline Design

**Date:** 2026-04-02  
**Status:** Approved  
**Goal:** Fix the onboarding pipeline to trigger correctly on brand creation, ensure banners reflect all background operations accurately, implement proper brand tier limits, and add pause functionality for expired/lapsed subscriptions.

---

## 1. Brand Types & Prompt Limits

### Brand Types

| Type | Max Prompts | Expires | Functionality |
|------|-------------|---------|---------------|
| `pitch` | 10 | 30 days → paused (read-only) | Limited: 1 run/day, 1 draft/week, 1 scan/week + auto weekly refresh |
| `standard` | 25 | Never | Full tier limits |
| `pro` | 100 | Never | Full tier limits (Pro users only) |

### Tier Brand Limits

| Tier | Full Brands | Pitch Brands | Can Create |
|------|-------------|--------------|------------|
| Trial (no subscription) | 0 | 1 | pitch only |
| Standard | 1 | 1 | standard, pitch |
| Pro | 2 | 3 | pro, standard, pitch |

**Note:** Pro users can create standard brands, but it counts toward their 2-brand limit. Pro brands offer 100 prompts vs 25 for standard.

---

## 2. Pause Behavior

### When Brands Pause

A brand becomes **paused (read-only)** when:
1. **Pitch brand expires** — 30 days after creation (`pitch_expires_at <= now`)
2. **Subscription lapses** — user's payment fails or subscription is canceled
3. **Downgrade** — Pro user downgrades to Standard (pro brands pause)

### Paused Brand Behavior

| Action | Allowed |
|--------|---------|
| View dashboard, results, drafts, opportunities | Yes |
| Trigger tracking runs | No |
| Generate drafts | No |
| Trigger scans | No |
| Edit brand settings | No |
| Delete brand | Yes |

### Scheduler Behavior

All scheduled jobs (morning sweep, auto-draft, Reddit/Quora scans) **skip paused brands**.

---

## 3. Onboarding Pipeline & First-Run Detection

### Problem (Current)

The frontend calls `triggerRun(brandId)` which creates a `run_type='manual'` run. The post-processing pipeline (`_onboarding_post_process`) only fires when `run_type='onboarding'`, so **brand creation never triggers draft generation or opportunity scanning**.

### Solution

Backend auto-detects first run:

```python
# In POST /api/tracking/run/{brand_id}
completed_runs = await db.execute(
    select(func.count(TrackingRun.id))
    .where(TrackingRun.brand_id == brand_id, TrackingRun.status == 'completed')
)
is_first_run = completed_runs.scalar_one() == 0

run_type = 'onboarding' if is_first_run else 'manual'
```

### Pipeline Sequence

When `run_type='onboarding'`, after tracking run completes:

```
1. Tracking run completes (gap analysis done)
   State: report_running = False

2. _onboarding_post_process(brand_id) fires:
   
   a. state.generating_brands.add(brand_id)
      Banner: "Drafts generating"
   
   b. Generate up to 5 drafts via auto_draft_top_gaps()
   
   c. state.generating_brands.discard(brand_id)
   
   d. state.scanning_brands.add(brand_id)
      Banner: "Scanning live opportunities"
   
   e. Scan Reddit + Quora in parallel
   
   f. state.scanning_brands.discard(brand_id)
```

### Resilience

- Runs as detached `asyncio.create_task` — user navigation doesn't affect it
- Each phase wrapped in `try/finally` to ensure state cleanup
- Phases are non-fatal — if drafts fail, scanning still runs

---

## 4. Banner System & State Management

### Backend State Sources

`GET /api/tracking/background-status` returns:

```json
{
  "report_running": boolean,    // TrackingRun pending/running for user's brands
  "drafts_generating": boolean, // brand_id in state.generating_brands  
  "scanning": boolean           // brand_id in state.scanning_brands
}
```

### State Updates by Action

| Action | Sets State | Clears State |
|--------|-----------|--------------|
| Manual run triggered | DB: TrackingRun status=pending/running | DB: status=completed/failed |
| Onboarding drafts | `state.generating_brands.add()` | `finally: .discard()` |
| Onboarding scan | `state.scanning_brands.add()` | `finally: .discard()` |
| Manual "Generate Now" | `state.generating_brands.add()` | `finally: .discard()` |
| **Manual "Scan Now"** | `state.scanning_brands.add()` | `finally: .discard()` |
| Scheduled scans | `state.scanning_brands.add()` | `finally: .discard()` |

**Fix needed:** Manual scans (`trigger_scan` in opportunities.py) don't currently update `state.scanning_brands`.

### Frontend (AppShell)

- Poll `/api/tracking/background-status` every 3s (existing)
- API response is source of truth
- localStorage fast-path for instant feedback (optional optimization)

### Banner Display

```
report_running=true    → "Report in progress — querying AI models with your prompts..."
drafts_generating=true → "Drafts generating — writing new content drafts for your top visibility gaps..."
scanning=true          → "Scanning live opportunities — finding relevant discussions on Reddit and Quora..."
```

---

## 5. Pitch Brand Limits

### Manual Action Limits (All Tiers)

| Action | Limit | Window |
|--------|-------|--------|
| Manual tracking runs | 1 | per day |
| Manual drafts | 1 | per week |
| Manual scans | 1 | per week |

These limits apply to **all pitch brands regardless of the user's subscription tier**.

### Weekly Auto-Refresh

All brands (including pitch) receive automatic weekly refresh via scheduler:
- **Monday 03:00 UTC** — Auto-draft sweep
- **Monday 03:15 UTC** — Reddit scanner sweep  
- **Monday 03:30 UTC** — Quora scanner sweep

---

## 6. Upgrade & Downgrade Flows

### Trial → Standard (Payment)

1. Trial user's pitch brand remains as pitch (still expires, limited functionality)
2. User can now create 1 standard brand with full functionality
3. Pitch brand continues its 30-day lifecycle

### Standard → Pro (Upgrade)

1. Existing standard brands **auto-upgrade to pro** (prompt limit increases to 100)
2. User can now create pro brands and additional pitch brands

```python
# In Stripe webhook (subscription upgraded to pro)
await db.execute(
    update(Brand)
    .where(Brand.user_id == user.id, Brand.brand_type == 'standard')
    .values(brand_type='pro', prompt_limit=100)
)
```

### Pro → Standard (Downgrade)

1. All pro brands become **paused**
2. User must delete pro brands or keep them read-only
3. Standard brands remain active

### Subscription Lapsed (Any Tier)

1. **All brands become paused** (read-only)
2. Data preserved
3. Resume when subscription is renewed

---

## 7. Implementation Summary

### Backend Files

| File | Changes |
|------|---------|
| `app/models.py` | Add `Brand.prompt_limit: int`, `Brand.is_paused: bool` (or derive from state) |
| `app/routers/billing.py` | Update `BRAND_LIMITS`, add `WEEKLY_SCAN_LIMITS_PITCH=1`, add `PROMPT_LIMITS` dict, add `DAILY_RUN_LIMITS_PITCH=1` |
| `app/routers/brands.py` | Validate `brand_type` vs tier, set `prompt_limit` on creation, enforce prompt limit on add prompt |
| `app/routers/tracking.py` | Auto-detect first run → `run_type='onboarding'`; add `require_brand_active()` check |
| `app/routers/opportunities.py` | Add `state.scanning_brands` tracking to `trigger_scan`; add pitch scan limit (1/week); add `require_brand_active()` check |
| `app/routers/content.py` | Add `require_brand_active()` check to draft endpoints |
| `app/services/tracking_service.py` | Verify `_onboarding_post_process` fires correctly (already implemented) |
| `app/scheduler.py` | Skip paused brands in all sweeps |
| `app/routers/billing.py` (webhook) | Handle upgrade (auto-upgrade brands), downgrade (pause pro brands), lapsed (pause all) |

### Frontend Files

| File | Changes |
|------|---------|
| `components/AppShell.tsx` | Remove localStorage dependency for scanning; API polling is sufficient |
| Brand creation UI | Add brand type selector (`pitch`/`standard`/`pro`); gate `pro` for non-Pro users |
| Dashboard/Content pages | Show "paused" state for read-only brands; disable action buttons |

### New Tests

| File | Coverage |
|------|----------|
| `tests/test_first_run_pipeline.py` | First run triggers onboarding pipeline; subsequent runs don't |
| `tests/test_brand_pause.py` | Paused brands block writes, allow reads |
| `tests/test_pitch_limits.py` | 1 run/day, 1 draft/week, 1 scan/week for pitch brands |
| `tests/test_upgrade_downgrade.py` | Standard→Pro auto-upgrades brands; downgrade pauses |
| `tests/test_banner_state.py` | Manual scans update scanning state; all banners reflect correct state |

---

## 8. Migration Notes

### Database Migration

```sql
-- Add new columns
ALTER TABLE brands ADD COLUMN prompt_limit INTEGER DEFAULT 25;
ALTER TABLE brands ADD COLUMN is_paused BOOLEAN DEFAULT FALSE;

-- Backfill prompt_limit based on existing brand_type
UPDATE brands SET prompt_limit = 10 WHERE brand_type = 'pitch';
UPDATE brands SET prompt_limit = 25 WHERE brand_type = 'standard' OR brand_type = 'basic';
UPDATE brands SET prompt_limit = 100 WHERE brand_type = 'pro' OR brand_type = 'premium';

-- Rename old tier values if needed
UPDATE brands SET brand_type = 'standard' WHERE brand_type = 'basic';
UPDATE brands SET brand_type = 'pro' WHERE brand_type = 'premium';
```

### Backward Compatibility

- Existing `brand.tier` field (basic/standard/premium for query runs) can be deprecated or mapped
- Frontend should handle both old and new values during transition

### Field Clarification

The codebase has two similar fields — avoid confusion:

| Field | Values | Purpose |
|-------|--------|---------|
| `brand.tier` | basic/standard/premium | Controls **runs per prompt** (5/10/20). Legacy field, may deprecate. |
| `brand_type` | pitch/standard/pro | Controls **brand category**, prompt limits, functionality limits. This spec's focus. |

Going forward, `brand_type` is the primary classification. Consider deprecating `brand.tier` or deriving it from `brand_type` (e.g., pitch→basic, standard→standard, pro→premium).
