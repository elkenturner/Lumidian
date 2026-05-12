# Competitive Gap Metric — Design Spec

**Date:** 2026-05-12
**Status:** Draft (awaiting Ken's review)
**Goal:** Add a new "Competitive Gap" metric to the dashboard that shows, at a glance, whether the brand is winning or losing the AI-visibility race vs its tracked competitors. Headline = current gap (your visibility minus competitor average, in percentage points). Trend chart = how that gap is moving over a user-selected window (7d / 30d / 90d). Click expands to a per-competitor breakdown.

---

## 1. Problem Statement

The dashboard's headline number today is the absolute Visibility Score (e.g., "42%"). That answers *"how visible am I right now?"* but not *"am I winning?"* — a 5pp visibility gain looks great in isolation, but if competitors gained 10pp in the same window, the brand is actually losing relative ground.

Share of Voice (SOV) gives one slice of competitive context (% of total mentions in the category) but flattens *direction* and *change over time* into a single static percentage. Users have to mentally subtract scores or eyeball the trend chart to figure out competitive momentum.

The Competitive Gap metric collapses both questions ("how far ahead/behind?" + "is the gap closing?") into one card. It uses only data the system already collects — no new LLM calls, no new tables, no new scheduled jobs.

---

## 2. What We're Building

A single new dashboard card, prominently placed alongside the Visibility Score on Row 1, plus a side drawer for drill-down:

1. **Collapsed card** — headline gap number, signed and color-coded; window toggle (7d/30d/90d); sparkline of the gap over the window; delta vs prior window; mini per-competitor preview line.
2. **Expanded drawer** — combined time-series chart (your visibility line + each competitor's line); sortable per-competitor table with sparklines and "Why are they ahead?" CTAs on rows where you're behind.
3. **Backend endpoint** — `GET /api/dashboard/{brand_id}/competitive-gap?window=7d|30d|90d` returns headline gap, trend points, and per-competitor breakdowns.
4. **Dashboard layout shift** — Row 1 becomes 2-col (Visibility Score | Competitive Gap); the existing right-column stack (Best Prompt / Sentiment / SOV) shifts down to Row 2.

Available to all tiers including Free and Pitch — uses only existing data, no incremental cost.

---

## 3. The Metric

### 3a. Definition

```
gap_pp = brand_visibility_pct − mean(competitor_visibility_pct)
```

Where `pp` = percentage points (the correct unit when subtracting two percentages).

- `brand_visibility_pct` = (queries where the brand is mentioned) / (total non-error queries) × 100, computed over the selected window.
- `competitor_visibility_pct` (per competitor) = (queries where competitor name is found in `QueryResult.response_text`) / (total non-error queries) × 100, computed over the same window.
- `mean(...)` = arithmetic mean across all currently-tracked competitors that *existed at the time of each bucket* (see Section 6 for the recently-added-competitor rule).

**Sign convention:** positive gap = brand is ahead; negative gap = brand is behind.

**Display:** `+12pp` (green) or `−5pp` (red); `0pp` shown in muted text.

### 3b. Time bucketing

Two computations from the same source data:

- **Window-aggregate** (drives the headline) — `brand_pct` and each `competitor_pct` computed over **all non-error queries in the window**, then `gap_pp = brand_pct − mean(competitor_pcts)`. Single stable number; one bad day doesn't swing it.
- **Per-day buckets** (drives the trend chart) — multiple runs on the same UTC day are averaged into a single trend point. A 7-day window yields at most 7 points; reads cleanly as a sparkline.

**Headline value** = window-aggregate `gap_pp`. **Headline delta** = headline gap minus the equivalent window-aggregate gap computed over the immediately prior window of the same length (e.g., for 7d: this 7d aggregate vs the prior 7d aggregate).

**Per-competitor table values** also use window-aggregate (so `competitor_pct`, `gap_pp`, and `delta_pp` shown in the table are mathematically consistent with the headline). The per-competitor sparkline uses per-day `gap_pp` for that competitor.

### 3c. Confidence

`sample_count` = total non-error queries analyzed in the window. Maps to:
- `<20` → `low`
- `20–99` → `medium`
- `≥100` → `high`

Mirrors the existing `score_confidence` thresholds in `dashboard.py`. Drawer surfaces a thin amber banner when `low`; the collapsed card never shows it (would clutter).

### 3d. Mention detection

Inherits the existing per-competitor mention logic in `dashboard.py:308–315`. **Improvement bundled with this work:** replace the naive `comp_lower in qr.response_text.lower()` substring check with a word-boundary match (regex `r"\b" + re.escape(name) + r"\b"`, compiled `re.IGNORECASE`) plus the same fuzzy-normalized fallback used for brand detection. `re.escape` is required for competitor names containing regex metacharacters (e.g., `C++`, `Notion.so`). Fixes the "Asana inside Casana" false-positive class.

Side effect: this fix also touches the SOV computation in the existing `/dashboard/{brand_id}/analytics` endpoint (same code path). Acceptable — see Section 10 rollout note.

---

## 4. Backend

### 4a. New endpoint

```
GET /api/dashboard/{brand_id}/competitive-gap?window=7d|30d|90d
```

- Default `window=7d`.
- Auth: existing `CurrentUser` dependency + `get_brand_for_user` ownership check.
- Lives in `app/routers/dashboard.py`.
- No new DB writes.

### 4b. Response schema

New Pydantic models in `app/schemas.py`:

```python
class CompetitiveGapTrendPoint(BaseModel):
    """Per-day point on the brand-level (aggregate) trend chart."""
    date: str                       # ISO YYYY-MM-DD (UTC day)
    gap_pp: float                   # brand_pct − comp_avg_pct that day
    brand_pct: float
    comp_avg_pct: float

class CompetitorTrendPoint(BaseModel):
    """Per-day point on a single competitor's trend (used for table sparkline)."""
    date: str                       # ISO YYYY-MM-DD (UTC day)
    gap_pp: float                   # brand_pct − competitor_pct that day

class CompetitorGapStat(BaseModel):
    competitor_id: int
    name: str
    competitor_pct: float           # window-aggregate
    gap_pp: float                   # window-aggregate brand_pct − competitor_pct (signed)
    delta_pp: float | None          # window-aggregate gap vs prior-window-aggregate gap
    trend: list[CompetitorTrendPoint]   # per-day gap_pp for this competitor's sparkline
    has_data: bool                  # false if competitor.created_at > window_end

class CompetitiveGapResponse(BaseModel):
    brand_id: int
    window: str                     # "7d" | "30d" | "90d"
    has_competitors: bool
    has_data: bool                  # at least one completed run in the window
    headline_gap_pp: float | None
    headline_delta_pp: float | None
    brand_visibility_pct: float | None
    competitor_avg_pct: float | None
    trend: list[CompetitiveGapTrendPoint]
    competitors: list[CompetitorGapStat]
    sample_count: int
    confidence: str                 # "low" | "medium" | "high"
```

### 4c. Service module

New file: `app/services/competitive_gap.py`. Pure aggregation. Public API:

```python
async def compute_competitive_gap(
    brand_id: int,
    window: Literal["7d", "30d", "90d"],
    db: AsyncSession,
) -> CompetitiveGapResponse: ...
```

Implementation outline:

1. Resolve `window` → `(window_start, window_end, prior_start, prior_end)` UTC datetimes.
2. Load `Brand` + `Competitor`s (filter by `brand_id`).
3. Load `TrackingRun`s where `status='completed'` and `completed_at >= prior_start` (covers both windows in one query).
4. Load `QueryResult` rows for those runs where `error IS NULL`. No row cap — the totals matter for accurate per-day pct calculation. (Sanity guard: if `len(rows) > 5000`, log a warning. Not expected in practice — 30 days × 4 models × ~10 prompts × 3 runs ≈ 3600 max.)
5. **Window-aggregate computation** (drives headline + per-competitor table):
   - `brand_pct = (rows in window where brand mentioned) / len(window_rows) × 100`
   - For each competitor: `competitor_pct = (rows in window where competitor matched, restricted to rows whose run day is on/after `competitor.created_at`) / (matching rows count) × 100`
   - `comp_avg_pct = mean(competitor_pcts of eligible competitors)`
   - `headline_gap_pp = brand_pct − comp_avg_pct`
6. **Per-day computation** (drives trend chart): group rows by UTC day; for each day compute `brand_pct`, per-competitor `comp_pct` (only for competitors that existed on/before that day), and `gap_pp = brand_pct − mean(eligible_comp_pcts)`. Days with zero rows are omitted.
7. **Prior-window aggregate** — repeat step 5 over the prior window. `headline_delta_pp = headline_gap_pp − prior_gap_pp` (if both exist; else `None`).
8. Per-competitor `CompetitorGapStat`: `competitor_pct` and `gap_pp` from the window aggregate (step 5); `delta_pp` from window aggregate vs prior-window aggregate; `trend` = per-day gap_pp for that competitor (from step 6); `has_data = competitor.created_at <= window_end`.
9. `confidence` from total `sample_count` over the current window.

Helper modules to factor out for testability:
- `_per_day_buckets(rows)` → `dict[date, list[QueryResult]]`
- `_mention_matches(text, name)` → bool (the word-boundary + fuzzy logic)
- `_resolve_window(window)` → `(start, end, prior_start, prior_end)`

### 4d. Frontend API client

Add to `frontend/lib/api.ts`:

```typescript
export type CompetitiveGapWindow = '7d' | '30d' | '90d';

export interface CompetitiveGapTrendPoint { /* matches schema */ }
export interface CompetitorGapStat { /* matches schema */ }
export interface CompetitiveGapResponse { /* matches schema */ }

export async function getCompetitiveGap(
  brandId: number,
  window: CompetitiveGapWindow = '7d',
): Promise<CompetitiveGapResponse> { ... }
```

The existing Axios GET deduper handles concurrent identical calls; toggling 7d→30d→7d is safe.

### 4e. No DB changes

No new tables. No migrations. No model changes. Pure read-side aggregation over `Brand`, `Competitor`, `TrackingRun`, `QueryResult`.

---

## 5. Frontend

### 5a. Dashboard layout shift

`app/dashboard/page.tsx` currently renders Row 1 as a 2-col grid with Visibility Score (left, full-height) and a stacked right column (Best Prompt + Sentiment in a 2-col mini-grid, with SOV below).

**New Row 1:** 2-col grid with Visibility Score (left) and Competitive Gap (right), equal width and height. The previous right column moves to Row 2:

| Row | Content (after change) |
|-----|------------------------|
| 1   | Visibility Score &#124; Competitive Gap |
| 2   | (Best Prompt + Sentiment) &#124; SOV |
| 3   | Avg Position &#124; Top Domains (unchanged) |
| 4   | Performance by Model (unchanged) |
| 5   | Sources you're missing from (unchanged) |
| 6   | Recent Conversations (unchanged) |

State for the window toggle (`'7d' | '30d' | '90d'`) and the fetched `CompetitiveGapResponse` is hoisted to `page.tsx` so the collapsed card and the drawer share a single source of truth. Drawer-open state also lives here.

### 5b. `CompetitiveGapCard.tsx` (collapsed)

New file: `frontend/components/dashboard/CompetitiveGapCard.tsx`.

Layout, top to bottom:

1. **Header row** — `Competitive Gap` title + `HelpTooltip` ("How far ahead or behind you are vs the average competitor — and whether the gap is closing.") + window-toggle pill buttons (`7d` `30d` `90d`) on the right; current selection in `var(--accent)`.
2. **Headline** — large bold signed number (`+12pp` or `−5pp`); color: `var(--success)` when positive, `var(--danger)` when negative, `var(--text-faint)` when zero. Sub-text `vs competitor avg` (or `vs {CompetitorName}` when there's exactly one competitor).
3. **Sparkline** — gap_pp over the window. Use Recharts (already a project dep), styled to match the existing `VisibilityChart` sparkline. Faint horizontal line at `0` to make ahead/behind visually obvious. Line color: green if slope is positive across the window, red if negative.
4. **Delta indicator** — `↑ +3pp this week` style, mirroring the Visibility Score's delta pattern. Reads from `headline_delta_pp`.
5. **Mini per-competitor line** — top 3 competitors by absolute `gap_pp`: `Notion +5pp · Linear +18pp · Asana −3pp` in compact muted text. If >3 competitors, append `…and N more`.
6. **Click affordance** — entire card is a `<button>`-like clickable region; cursor pointer; small `→` icon top-right; same hover treatment as other dashboard cards. Click opens the drawer.

States:
- **Loading** — skeleton placeholders (existing pattern).
- **No competitors** — body replaced with inline `Add competitors` CTA (same UX as current SOV card empty state). Window toggle hidden.
- **No completed runs at all** — `—` for the headline, sub-text "Run a report to see your competitive position."
- **Only 1 day of data** — headline shown, sparkline + delta hidden, sub-text "Trend appears after the next run."
- **Window has no data** (e.g., 7d toggle but only 30d-old runs) — `—` for headline, sub-text "No runs in this window — try 30d or 90d."

### 5c. `CompetitiveGapDrawer.tsx` (expanded)

New file: `frontend/components/dashboard/CompetitiveGapDrawer.tsx`. Right-side drawer using the Radix `Dialog` pattern already used for `CompetitorModal`. Mobile: slides from bottom, full-height.

**Header:** title `Competitive Gap — {Brand Name}`, repeated window toggle, close `X`. Window toggle here and on the card share state, so changing it in either place updates both.

**Body:**

1. **Headline strip** — repeats the big signed number, `Your visibility {brand_pct}% · Competitor average {comp_avg_pct}%`, and `↑ +3pp vs prior {window}`.
2. **Time-series chart** (`CompetitiveGapTrendChart.tsx`, factored out for isolation/testing) — single Recharts `LineChart`:
   - X-axis: dates over the selected window.
   - Y-axis: visibility %.
   - Your line: `var(--accent)`, 2px solid stroke, drawn last.
   - Competitor lines: muted palette (`#7c8aaa`, `#8a7ca5`, `#7ca58a`, `#a5917c`, `#7c9ba5`, `#a57c8a`, `#9a9a7c`, `#7c88a5` — same palette already used in the SOV card so colors match across the dashboard), 1px dashed stroke, cycling.
   - Legend below the chart, clickable to toggle individual competitor lines on/off.
   - Tooltip on hover shows that day's exact values for every visible series.
3. **Per-competitor table:**
   - Columns: Competitor &#124; You &#124; Them &#124; Gap &#124; Δ &#124; Sparkline
   - Default sort: largest absolute `gap_pp` first.
   - Sortable by header click.
   - Gap column color-coded (green positive, red negative).
   - On rows where `gap_pp < 0`: append an `AskCoachButton` (existing component) prefilled with `Why is {competitor} outperforming us in AI visibility over the last {window}?`
   - Recently-added competitors (`has_data === false`) show a single row with `—` for all numeric columns and a muted "Added recently — needs more data" note.
4. **Confidence banner** — thin amber bar at the top of the drawer when `confidence === 'low'`: "Based on {sample_count} queries — results stabilize after more runs." Hidden for medium/high.

No export, no share, no settings in v1.

### 5d. Files

| File | Change |
|------|--------|
| `frontend/components/dashboard/CompetitiveGapCard.tsx` | new |
| `frontend/components/dashboard/CompetitiveGapDrawer.tsx` | new |
| `frontend/components/dashboard/CompetitiveGapTrendChart.tsx` | new |
| `frontend/components/dashboard/index.ts` | export new components |
| `frontend/app/dashboard/page.tsx` | Row-1 layout shift; hoist window/data/drawer state; render card + drawer |
| `frontend/lib/api.ts` | add `getCompetitiveGap` + types |

---

## 6. Edge Cases

1. **Single competitor** — copy adapts: `vs {Name}` instead of `vs competitor avg`. Math is unchanged (mean of one value = that value). Card and drawer header both update.
2. **Recently-added competitor** — competitors are excluded from the `comp_avg_pct` for any per-day bucket where `Competitor.created_at > bucket_date`. They still appear in the per-competitor table with `has_data: false` and a "needs more data" note. Prevents a fresh competitor from artificially dragging the average down during their cold-start period.
3. **Competitor with zero mentions in window** — counted as `0%` and included in the average. Treated as real signal (we *did* check, they *weren't* there), not missing data.
4. **No competitors tracked** — collapsed card shows the `Add competitors` empty state (matches current SOV card UX). No drawer reachable. No backend errors.
5. **No completed runs** — headline `—`, sub-text "Run a report to see your competitive position." Drawer not openable.
6. **Single day of data** — headline shown, sparkline + delta hidden.
7. **Window has no data** — headline `—`, sub-text suggests trying a longer window.
8. **Negative gap with positive slope** — headline red, sparkline green. Correct (telling different stories) and reads naturally as "behind, but catching up."
9. **Mention false positives** — fixed by switching to word-boundary regex (Section 3d).

---

## 7. Tier Gating

**Available to all tiers including Free and Pitch.** The metric uses only data the system is already collecting — no new LLM calls, no incremental cost per query. SOV is similarly un-gated today; this should be too.

---

## 8. Out of Scope

- No new scheduled job, no caching layer, no precomputed table.
- No per-model breakdown of the gap (per-model already lives in the Performance by Model card).
- No CSV export, no inclusion in the PDF report (could be added later).
- No alerts/notifications (e.g., "gap dropped 10pp this week"). The existing visibility-drop alert pattern can be extended later if desired.
- No mention-detection improvements beyond the word-boundary fix on competitor matching.
- No "primary competitor" setting on the brand. Aggregate is mean-of-all; the per-competitor list shows individual numbers.
- No median/max alternative aggregations. Mean is locked in for v1.

---

## 9. Tests

Backend only (frontend has no test suite today). New file: `backend/tests/test_competitive_gap.py`.

**Service-level (`compute_competitive_gap`):**
- Mean math correctness: 3 competitors at known pcts → expected `comp_avg_pct` and `gap_pp`.
- Sign convention: brand ahead → positive; brand behind → negative; tied → zero.
- Per-day bucketing: 2 runs same UTC day → 1 trend point with averaged values.
- `headline_delta_pp` math: gap in current vs prior window of same length.
- Recently-added competitor exclusion (Section 6 case 2): competitor created mid-window, only contributes to days after its `created_at`.
- Single competitor copy: response works correctly with exactly 1 competitor.
- Empty competitor list: returns `has_competitors: false`, headline `None`.
- No completed runs: returns `has_data: false`.
- Confidence thresholds: 19 → low, 20 → medium, 99 → medium, 100 → high.
- Word-boundary mention detection: "Asana" does NOT match inside "Casana"; "Asana." (period boundary) DOES match.

**Endpoint-level (`GET /api/dashboard/{brand_id}/competitive-gap`):**
- 200 happy path with realistic fixture (brand + 3 competitors + several runs across multiple days).
- 200 with no competitors (verifies graceful empty-state shape).
- 200 with no completed runs.
- 401 unauthenticated.
- 403 wrong-owner (other user's brand).
- Default `window=7d` when query param omitted.
- Each `window` value (`7d`, `30d`, `90d`) returns appropriate trend length.
- Invalid `window` value (e.g., `5d`) returns 422.

Reuses the existing `tests/conftest.py` fixtures (`register_user`, `create_brand`, etc.). No new fixtures needed.

---

## 10. Rollout

Single PR. No feature flag. Risk profile:

- **Backend** — additive endpoint and service; no schema changes. Zero blast radius outside the new code path.
- **Frontend** — the dashboard layout shift is the riskiest piece. Mitigated by the fact that we're moving existing cards down a row, not removing them. Visual regression testing limited to manual check on the dashboard page.
- **Mention-detection word-boundary fix** — touches an existing code path (`dashboard.py` SOV/competitor counting). Could marginally change historical SOV percentages for users whose competitor names are substrings of other words. Acceptable: the new behavior is correct, the old behavior is a known false-positive.

---

## 11. Files Summary

**Backend (new):** `app/services/competitive_gap.py`, `tests/test_competitive_gap.py`
**Backend (modified):** `app/routers/dashboard.py`, `app/schemas.py`
**Frontend (new):** `components/dashboard/CompetitiveGapCard.tsx`, `components/dashboard/CompetitiveGapDrawer.tsx`, `components/dashboard/CompetitiveGapTrendChart.tsx`
**Frontend (modified):** `components/dashboard/index.ts`, `app/dashboard/page.tsx`, `lib/api.ts`

No DB migrations. No new env vars. No new dependencies (Recharts already installed).
