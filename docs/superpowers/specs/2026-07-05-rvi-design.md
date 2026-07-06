# RVI (Relative Visibility Index) — Design

**Date:** 2026-07-05
**Status:** Approved direction (Approach A — clean swap). Replaces the Competitive Gap metric everywhere.

## Problem

The Competitive Gap card reports `brand% − peer_avg%` in percentage points. That difference is
not invariant to category-wide citation shifts: when an LLM provider reshuffles citations and
everyone's raw visibility halves, the pp-gap shrinks and the card reports "improvement" when
nothing changed competitively. It also blends contested prompts with owned-territory prompts
(where no peer registers), silently deflating the peer average. Users find the card convoluted.

## Metric definition

**RVI = brand visibility ÷ mean(peer-pool visibility), computed over contested prompts only.**

- **Peer pool** — competitors with `in_peer_pool = true` (new column, default true). Users may
  exclude out-of-weight-class incumbents (the "GRAIL exclusion"). Exclusions are always named
  in the UI — a visible methodological choice, never a buried one.
- **Contested prompt** — a prompt with ≥1 peer-pool competitor mention within the window.
  This definition structurally prevents division by zero: the contested peer average is > 0
  by construction.
- **Owned prompt** — brand mentioned ≥1 time in window, zero peer-pool mentions. Never shown
  as a ratio; shown as a defended-territory state ("N prompts owned — no peer registers").
- **Unclaimed prompt** — neither brand nor any peer registers. Excluded from both segments,
  surfaced only as a count.
- Reading: 1.0 = cited at the peer rate; below 1.0 = trailing; above = leading.
- Classification is automatic per window from mention data (no manual tagging). Each window
  (current, prior, per-day trend) is classified independently — EXCEPT the per-day trend,
  which reuses the current window's contested set so the sparkline doesn't flicker as
  prompts flip category day to day.
- Delta = current-window RVI − prior-window RVI (same length window immediately before).
- Confidence = existing thresholds (low <20, medium <100, high ≥100) applied to the contested
  sample count.
- Mention detection reuses `_mention_matches` (word-boundary + fuzzy normalized) for peers and
  `QueryResult.mentioned` for the brand — same as competitive gap did.
- All timestamps coerced via `_as_naive_utc` (carried over from the tz-aware fix).

## Backend

- **Model/migration:** `Competitor.in_peer_pool: bool = mapped_column(Boolean, default=True,
  nullable=False)` + `ALTER TABLE competitors ADD COLUMN in_peer_pool BOOLEAN NOT NULL DEFAULT 1`
  appended to `run_migrations()`.
- **Service:** new `app/services/rvi.py`. Absorbs `_resolve_window`, `_mention_matches`,
  `_normalize`, `_as_naive_utc`, `_per_day_buckets`, `_confidence` from `competitive_gap.py`,
  which is **deleted**. `app/routers/dashboard.py` updates its `_mention_matches` import.
  Entry point: `compute_rvi(brand_id, window, db) -> RVIResponse`.
- **Endpoints:**
  - `GET /api/dashboard/{brand_id}/rvi?window=7d|30d|90d` (replaces `/competitive-gap`,
    which is removed).
  - `PATCH /api/brands/{brand_id}/competitors/{competitor_id}` body `{in_peer_pool: bool}` —
    new; competitor create/list responses gain `in_peer_pool`.
- **Response schema (`RVIResponse`):**
  ```
  brand_id, window, has_peers, has_data,
  rvi: float|null, rvi_delta: float|null,
  brand_pct: float|null, peer_avg_pct: float|null,        # contested set
  contested_prompt_count, owned_prompt_count, unclaimed_prompt_count,
  sample_count, confidence,
  trend: [{date, rvi}],                                    # daily, fixed contested set
  peers: [{competitor_id, name, in_peer_pool, pct, prompt_hits}],  # pool members' pct over contested set
  excluded: [{competitor_id, name}],
  owned_prompts: [{prompt_id, text, brand_pct}],           # for the drawer
  contested_prompts: [{prompt_id, text, brand_pct, peer_avg_pct, rvi}]  # for the drawer
  ```
- **Edge states:** no competitors → `has_peers=false` (dashboard shows existing combined CTA);
  competitors exist but all excluded → `has_peers=false` + `excluded` non-empty (card explains);
  no runs / no results in window → `has_data=false`; no contested prompts → `rvi=null` with
  owned counts populated (card shows "no peer registers anywhere you track" dominance state).

## Frontend

- **`RVICard`** (replaces `CompetitiveGapCard` in dashboard row 1, `lg:col-span-2`):
  - Title "Relative Visibility" + HelpTooltip explaining the index and pool. Window toggles
    7d/30d/90d (existing pattern).
  - Headline: large `0.36×` (tabular-nums; success ≥1.0, danger <1.0, faint null) with the
    plain-English subline: "Cited at 36% of your peers' rate on contested prompts". The
    sentence is the product; the index is the compact form.
  - Delta line vs prior window (`↓0.20 vs prior 7d`).
  - Sparkline of daily RVI with a reference line at 1.0 (Recharts, matches existing card).
  - Owned-territory strip: `Owns N prompts — no peer registers` (success accent) when N > 0.
  - Footnote: `Peers: Freenome, Delfi · GRAIL excluded` (names truncated gracefully).
  - Fallback card on failed fetch (never `null` — grid must not collapse), loading skeleton,
    and the edge states above. Click opens the drawer.
- **`RVIDrawer`** (replaces `CompetitiveGapDrawer` + `CompetitiveGapTrendChart`):
  - Full trend chart with 1.0 reference line.
  - Peer list: each pool member with visibility bar vs brand, and an include/exclude toggle
    (calls the PATCH endpoint, refetches). Excluded competitors listed dimmed below.
  - Contested prompt table: prompt text, brand%, peer avg%, per-prompt RVI.
  - Owned prompt list: prompt text + brand%.
- **`lib/api.ts`:** `RVIResponse`/`RVIWindow` types, `getRVI()`, `setCompetitorPeerPool()`;
  `CompetitiveGap*` types and `getCompetitiveGap` removed.
- Visual language: existing `.card` utilities + CSS tokens; no new paradigms.

## Testing

- Service: worked example from the spec discussion (7.4/13.2 → 0.56), segmentation
  (contested/owned/unclaimed), pool exclusion changes the denominator, per-window independent
  classification, fixed-set daily trend, delta, tz-aware timestamp tolerance (regression
  carried over), no-peers/no-data/all-owned edges.
- Endpoints: auth, ownership isolation, window validation, response shape, PATCH toggle
  (ownership + effect on subsequent RVI).
- Old `tests/test_competitive_gap.py` deleted; still-relevant helper tests move to
  `tests/test_rvi.py`.

## Out of scope

- Manual prompt tagging / overrides (auto-only for v1).
- RVI in PDF reports, notifications, or trends page.
- Any change to the SOV card or the hero visibility score (absolute visibility stays the
  dashboard headline; RVI complements it).
