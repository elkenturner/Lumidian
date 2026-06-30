# Cluster Platform View-Filter + Prompt-Driven List — Design

**Date:** 2026-06-28
**Status:** Approved (design), pending implementation plan
**Surface:** Content clusters (`/content/[brandId]` and `/content/[brandId]/cluster/[clusterId]`)

## Problem

Two adjustments to the content-cluster surface:

1. **Prompt-driven list.** Today the cluster list only shows prompts a user has already generated a cluster for, because a `ContentCluster` row exists only after generation. Users want to see *all* tracked prompts and generate clusters from there.
2. **Platform view-filter.** Users want a switcher to turn platforms on/off across all clusters, **hiding them from view only** — not stopping generation, not deleting anything.

## Background — how clusters work today

- **One cluster per prompt:** `ContentCluster.prompt_id` is a unique FK. Clusters are **not** auto-created; a row exists only after a user triggers generation.
- **Creation triggers:** "Generate now" (background loop over top prompts) or per-prompt "Regenerate cluster" → `POST /clusters/{brand}/by-prompt/{prompt}/regenerate`.
- **Pipeline:** briefing (`ContentBrief`) → evidence pack → parallel per-platform generation → finalize.
- **Platforms (fixed constant):** `("linkedin", "medium", "reddit", "quora", "x")` in `clustering_service.py:39`. Wikipedia is handled on its own surface, not in clusters.
- **Existing platform flag:** `BrandContentSettings.enabled` (per brand, per platform) controls **generation** — `_enabled_platforms()` filters which platforms get pieces. Surfaced as toggles in the legacy `ContentHub.tsx`. This is a *generation* control and is **distinct** from the new view-filter.

## Decisions

| Question | Decision |
|----------|----------|
| Switcher behavior | **View-only hide.** Pieces still generate for every platform; toggling off collapses those cards across cluster views. Pure render filter. |
| Cluster creation model | **Prompt-list-driven, lazy creation.** No materialized empty clusters, no migration. Cluster rows created on first generation (current backend behavior). |
| Filter state persistence | **localStorage**, keyed by brand. Per-browser; does not sync across devices/teammates (acceptable for a view preference). |

## Design

### 1. Prompt-driven cluster list (`frontend/app/content/[brandId]/page.tsx`)

- Page fetches the brand's **tracked prompts** *and* its **clusters**.
- Render is a left-join keyed on prompt:
  - Prompt **with** a cluster → existing cluster card (pieces, status, visibility, lift).
  - Prompt **without** a cluster → row with a **"Generate cluster"** action.
- "Generate cluster" calls the existing `POST /clusters/{brand}/by-prompt/{prompt}/regenerate`. Row transitions into the live-generating state (existing status polling).
- **No backend change, no new DB rows, no auto-create job, no migration.**
- *Open point for planning:* confirm whether prompts are already fetchable on this page; if not, wire in the existing brand/prompts API call.

### 2. Platform view-filter switcher

- A **Platforms** control on the cluster list page, placed alongside the existing filter/sort row.
- Toggles for the 5 cluster platforms: LinkedIn, Medium, Reddit, Quora, X. (Wikipedia excluded — not part of cluster views.)
- State: a set of **hidden** platforms in `localStorage`, keyed `cluster-hidden-platforms:{brandId}`.
- Exposed via a small shared hook, e.g. `useHiddenPlatforms(brandId)`, so list and detail views read/write the same state and stay in sync.
- **Pure render filter:**
  - **List view:** omit hidden platforms' piece badges from each cluster card.
  - **Detail view** (`cluster/[clusterId]/page.tsx`): omit hidden platforms' `PieceCard`s from the Posts zone.
- Nothing regenerates, nothing is deleted, `BrandContentSettings` flags untouched. Toggle on → cards reappear instantly.
- Include a short label clarifying scope, e.g. "Show/hide — doesn't affect generation."

### 3. Out of scope

- The legacy `ContentHub.tsx` `BrandContentSettings.enabled` toggles (generation control) are untouched and remain a separate concept.
- No backend changes of any kind.
- No cross-device/teammate sync of the view preference.

## Testing

- No frontend test suite exists; verification is manual:
  - Toggle a platform off → its badges (list) and `PieceCard` (detail) disappear in both views.
  - Reload → preference persists (localStorage).
  - Toggle on → cards reappear; no regeneration occurred.
  - Generating a cluster from a prompt with no cluster works and respects the view filter.
  - Confirm generation behavior is unchanged (disabled-in-view platforms still produce pieces).

## Open points to resolve during planning

1. Exact placement and visual treatment of the switcher (chips vs. toggle row vs. dropdown).
2. Whether the cluster list page already has prompts available client-side, or needs an added fetch.
