# Content Tab Collapse + Cluster UX Pass — Design

**Date:** 2026-05-22
**Surface:** `/content/[brandId]` (self-serve SaaS — not `/agency/*`)
**Goal:** Make the cluster the only durable unit of marketing content, retire vestigial flat-list tabs, and clean up the cluster page itself.

## Problem

The cluster system shipped 2026-05-12 as the new primary unit of content, but the surface around it still reflects the pre-cluster world:

- `/content/[brandId]` has four primary tabs — **Clusters · Visibility Opportunities · Content Drafts (Queue + Scheduled) · Posted** — three of which are flat lists of the same `ContentDraft` rows that already live inside clusters.
- Cluster-generated drafts and legacy `_bg_generate_drafts` drafts both flow into the same flat Drafts / Scheduled / Posted lists. Users see the same piece in two places (inside its cluster *and* in the Drafts queue), which makes the cluster look like one of several views rather than *the* view.
- The Posted tab does carry one piece of unique value — `DraftAttribution.delta` ("did this post move visibility?") — that the cluster surface does not yet expose. Killing Posted naively loses this.
- Legacy `cluster_id=NULL` posted drafts exist (retained at the 2026-05-12 clean-slate migration). They have no cluster to belong to.
- Inside a cluster (`/content/[brandId]/cluster/[clusterId]`) the page leads with **Brief → Pillar → Pieces**. Pieces are the action; brief is the *why*. The order inverts user intent. PillarCard renders even when there's no candidate, adding noise. The cluster card's headline % is the *prompt's* visibility — it conflates the cluster's contribution with everything else.

Net effect: the cluster is the right primitive, but the surface around it doesn't let it carry its full weight.

## Goal & Scope

**In scope:**

1. Collapse `/content/[brandId]` to two primary tabs: **Clusters** and **Visibility Opportunities**. Retire Drafts (Queue + Scheduled) and Posted.
2. Add an **Impact strip** above the cluster grid on the Clusters tab — cross-cluster top-delta pieces, plus a home for legacy `cluster_id=NULL` posts.
3. Cluster card: replace the prompt-visibility headline with a real cluster-effect signal; move cluster-wide regenerate into a kebab menu.
4. Cluster detail page: pieces first, brief collapsible below, PillarCard hidden unless relevant; per-piece status + attribution chip.
5. Route every newly-created non-opportunity draft through clusters (auto-create cluster for prompt if none exists). Eliminate orphan non-opportunity drafts.
6. Delete the now-unused flat-list components: `DraftsPanel`, `ScheduledPanel`, `PostedPanel`, `ContentTabPanels` glue, and their helpers if exclusively used by them.

**Out of scope:**

- **Visibility Opportunities tab is untouched.** Same data, same components, same workflow. It remains a separate top-level tab on `/content/[brandId]`.
- **Wikipedia surface** (`/wiki/[brandId]`) — unchanged.
- **Site Audit surface** (`/site-audit/*`) — unchanged.
- **Agency cockpit** (`/agency/clients/[id]`) — its content rendering uses different components and is not in scope.
- **Cluster brief / pillar generation logic** — no changes to `clustering_service.py` or `cluster_pillar.py`. Only the surface around them changes.
- **Backend `getDrafts(brand_id, undefined, 'posted')` endpoint** stays — it's reused by the Impact strip.
- **Removing the `cluster_id`-nullable column** — drafts created from opportunities legitimately still have `cluster_id=NULL`; the column stays nullable.

## Design

### Tab structure

| Today | New |
|---|---|
| Clusters · Visibility Opportunities · Content Drafts (Queue+Scheduled) · Posted | **Clusters · Visibility Opportunities** |

`PrimaryTab` in `ContentHub.tsx:99` becomes `'clusters' | 'opportunities'`. The `content_drafts` and `posted` cases, the `activeSubTab` state, and the `QueueTab` type are removed.

URL-tab sync (`ContentHub.tsx:1479`) is simplified: `?tab=opportunities` selects Opportunities; anything else selects Clusters. `?tab=drafts`, `?tab=scheduled`, `?tab=saved`, `?tab=posted` redirect-equivalent to Clusters (silently — no broken state).

### `/content/[brandId]` Clusters tab — new layout

```
┌──────────────────────────────────────────────────────┐
│ [Brand picker]                       [Generate all]  │
├──────────────────────────────────────────────────────┤
│ Impact                                               │
│   • +12pp  LinkedIn piece · "How we ..."  · 4d ago   │
│   • +8pp   Medium piece   · "The case ..." · 6d ago  │
│   • +3pp   Reddit piece   · "We tried..."  · 9d ago  │
│   ─── Legacy ─────────────────────────────────────── │
│   • (no delta) Quora post · "What's the…"  · pre-mig │
│   See all posted →                                   │
├──────────────────────────────────────────────────────┤
│ Clusters (N)                                         │
│   [ClusterCard]  [ClusterCard]  [ClusterCard] ...    │
└──────────────────────────────────────────────────────┘
```

### Impact strip (new component: `components/content/ImpactStrip.tsx`)

- Renders inside the Clusters tab body, above the cluster grid.
- Data source: `getDrafts(brandId, undefined, 'posted')` joined with `getDraftAttributions(brandId)` (existing API).
- Sort: posted drafts where the most recent `DraftAttribution.delta` is non-null, ordered by `delta DESC`. Show top 5.
- Each row:
  - `+Npp` delta chip (green if ≥0, red if <0, muted "—" if not yet measured).
  - Platform badge + short title (fallback to "{Platform} piece") + truncated prompt text as subtitle.
  - Relative posted-at date.
  - `Jump to cluster →` link if `draft.cluster_id` is set; otherwise a small "Legacy" tag and no link.
- Legacy block: posted drafts with `cluster_id=NULL` shown below the live rows under a small `─── Legacy ───` divider. Capped at 3 rows; "See all posted" link expands a modal listing the rest.
- Empty state: "No measured impact yet — post a piece and we'll track lift here after the next tracking run."
- `See all posted →` link in the footer opens a modal (`PostedHistoryModal`) listing every posted draft for the brand, scrollable, the same row shape, sorted by posted-at DESC. This is the resilient long-tail history view, replacing the old Posted tab. Modal also handles deletion (uses existing `handleDelete`).

### ClusterCard (`components/content/cluster/ClusterCard.tsx`) — changes

- **Headline number changes meaning.** Today line 36–41 reads `Math.round(cluster.visibility_pct)` — the *prompt's* current visibility. Replace with **cluster delta**: sum of `DraftAttribution.delta` across this cluster's posted pieces. Label "Cluster lift" instead of "%". Tone: green if positive, neutral if zero, red if negative, muted "—" if no posted pieces yet.
- **Sub-line:** `Posted X of 5`, where `X` counts pieces with `status='posted'`. The lift number is the headline; the sub-line is just the posted-count breakdown — keeping them separate avoids confusion about "since when."
- **Regenerate button** (currently a primary button at line 108) moves into a kebab menu (3-dot icon) in the card header. Per-piece regenerate (on PieceCard inside the cluster detail page) is the primary action; cluster-wide regen is the rare action.
- Visual: keep the card layout otherwise; the piece chip row stays.

Backend exposure for cluster delta: extend `ContentClusterSummary` (returned by `GET /api/clusters/{brand_id}`) with `cluster_delta: float | None` and `posted_count: int`. Computed inline in the service from the cluster's drafts' `DraftAttribution` rows.

### Cluster detail page (`app/content/[brandId]/cluster/[clusterId]/page.tsx`) — reordering

Today (lines 144–174):

```
1. Header (prompt, visibility %)
2. BriefPanel  ← always expanded
3. PillarCard  ← always rendered
4. Pieces grid
```

New order:

```
1. Header (prompt + cluster lift)
2. Pieces grid                  ← primary
3. BriefPanel                    ← collapsed by default, click to expand
4. PillarCard                    ← only renders when candidate exists or pillar attached
```

- Header right-side number: same `cluster_delta` chip as ClusterCard, not the prompt-visibility number.
- BriefPanel gets a collapsed/expanded prop (default collapsed). Internal layout of BriefPanel is unchanged; we just wrap it in a `<details>` or a controlled disclosure with a chevron header.
- PillarCard: render only when `cluster.pillar_mode !== 'none'` OR `candidate !== null`. The `proposeClusterPillar` fetch in `page.tsx:42` stays the same; we just don't render the empty card.

### PieceCard (`components/content/cluster/PieceCard.tsx`) — chip + thread suggestions

- **Status + attribution chip** in the card header:
  - `Drafted` (neutral) — `status='draft'`.
  - `Approved` (yellow) — `status='approved'`.
  - `Posted +Npp` (green) — `status='posted'` with measured `DraftAttribution.delta ≥ 0`.
  - `Posted -Npp` (red) — `status='posted'` with measured delta < 0.
  - `Posted, no lift yet` (muted) — `status='posted'` with no attribution row yet (post is fresher than the last tracking run).
  - `Failed` (red) — `status='failed'`.
- **No "threads to reply to" subsection** — Opportunities stays its own tab. Confirmed out of scope.
- Per-piece regenerate stays prominently in the card (no change to placement).

### Routing every non-opportunity draft through clusters

The legacy creation flow (`backend/app/services/drafting_service.py:_bg_generate_drafts` and its callers in `routers/content.py`) currently writes `ContentDraft` rows directly with `cluster_id=NULL`. Three real callers today:

1. **Onboarding** (`routers/content.py` — onboarding fan-out).
2. **"Regenerate Drafts" button** (`POST /api/content/{brand_id}/generate-now`).
3. **"Request a new draft"** (`POST /api/content/{brand_id}/generate` with platform + prompt).

Each of these call paths is rewired to delegate to the cluster pipeline rather than write `ContentDraft` directly. This is the real "Task 15" work the 2026-05-12 decision deferred, scoped to just these three callers.

**New helper:** `services/clustering_service.py:ensure_cluster_for_prompt(brand_id, prompt_id) -> ContentCluster`.
- If a `ContentCluster` row exists for `(brand_id, prompt_id)`, return it.
- Else create one with `status='pending'`, no brief yet, and return it.
- Does **not** auto-generate the brief or any pieces — only callers decide to do that next.

**Caller changes:**

- **Onboarding** — instead of fanning out individual draft creations, enumerate prompts and call the existing `POST /api/clusters/{brand_id}/generate` (or its service-layer function) per prompt. This is the "real" Task 15 work, but scoped only to the onboarding path. Result: every prompt gets a cluster with brief + 5 pieces. No flat drafts created.
- **"Regenerate Drafts" button** — same: iterate prompts, call cluster-regen per prompt. The UI button becomes "Generate all clusters" (label change in `DraftsPanel.tsx` removal + replacement entry point on the Clusters tab header).
- **"Request a new draft" (custom)** — modal stays; on submit, call `ensure_cluster_for_prompt(brand_id, prompt_id)` then the existing cluster-piece-regen endpoint for the chosen platform. The draft created is attached to that cluster.

**Opportunity-driven drafts** (`POST /api/opportunities/{opportunity_id}/draft`) — **no change**. These continue to write `ContentDraft` rows with `opportunity_id` set, `cluster_id=NULL`. They render inside the Opportunities tab as today (the existing `OpportunitiesPanel` handles preview/approve/post inside the opportunity card itself — no separate tab needed for these drafts).

### Component cleanup

Delete:
- `frontend/components/content/DraftsPanel.tsx`
- `frontend/components/content/ScheduledPanel.tsx`
- `frontend/components/content/PostedPanel.tsx`
- `frontend/components/content/ContentTabPanels.tsx`
- `frontend/components/content/cards/DraftCard.tsx` if not referenced from clusters (verify — `DraftCard` may still be needed elsewhere; check before deleting).
- `frontend/components/content/cards/ScheduledCard.tsx`
- `frontend/components/content/cards/PostedCard.tsx`
- `frontend/components/content/cards/WikipediaDraftCard.tsx` if not referenced from the Wikipedia surface — verify first.

Add:
- `frontend/components/content/ImpactStrip.tsx`
- `frontend/components/content/PostedHistoryModal.tsx`

Edit:
- `frontend/components/content/ContentHub.tsx` — remove `content_drafts` + `posted` tab cases, remove `activeSubTab` state, remove the `QueueTab` union, remove all draft-list / posted-list rendering, mount `ImpactStrip` above the cluster grid in the Clusters tab body. Trim the `PRIMARY_TABS` array to two entries.
- `frontend/components/content/cluster/ClusterCard.tsx` — headline + sub-line changes; regen→kebab.
- `frontend/app/content/[brandId]/cluster/[clusterId]/page.tsx` — reorder sections, collapse Brief, conditionally render Pillar.
- `frontend/components/content/cluster/PieceCard.tsx` — status + attribution chip.
- `frontend/lib/api.ts` — add `cluster_delta` and `posted_count` to `ContentClusterSummary` type.
- `backend/app/services/clustering_service.py` — add `ensure_cluster_for_prompt`; extend `ContentClusterSummary` projection with `cluster_delta` and `posted_count`.
- `backend/app/schemas.py` — extend `ContentClusterSummary` schema with the two new fields.
- `backend/app/routers/content.py` — rewire onboarding, generate-now, and custom-draft endpoints through clusters.

### Data model

- No new tables.
- No new columns.
- No data migration required. Existing posted drafts with `cluster_id=NULL` are surfaced in the Impact strip's Legacy section. New non-opportunity drafts created after this ships will all have `cluster_id` set.

### URL-param compatibility

`?tab=drafts | scheduled | saved | posted` URLs from bookmarks or external links no-op-fall-back to the Clusters tab (no redirect; silent). The `?tab=opportunities` URL keeps working. No 404s, no console errors.

## Testing

**Backend:**
- New test: `ensure_cluster_for_prompt` returns existing cluster if one exists for `(brand_id, prompt_id)`; creates a new pending one otherwise.
- New test: `ContentClusterSummary` includes `cluster_delta` and `posted_count` populated correctly (mix of posted/draft pieces with and without attribution).
- New test: legacy callers (`/generate-now`, `/generate`, onboarding) produce drafts with `cluster_id` set.
- Regression: existing cluster tests stay green (`test_clusters.py` and friends).
- Regression: opportunity-driven draft flow still creates `cluster_id=NULL` drafts (no change). Verify with existing opportunity tests.

**Frontend:**
- No frontend tests exist in the repo per CLAUDE.md — manual browser smoke instead. Verify:
  - `/content/{brandId}` shows two tabs only.
  - Impact strip renders with real data, legacy posts in Legacy block, "See all posted" modal works.
  - ClusterCard headline shows cluster lift (not prompt visibility).
  - Cluster detail page: pieces first, brief collapsed by default, pillar hidden if no candidate.
  - PieceCard chip shows the right state for each draft status × attribution combination.
  - `?tab=drafts` URL silently falls back to Clusters.
  - "Generate all clusters" button on Clusters tab fans out per-prompt cluster generation.
  - Onboarding flow for a fresh brand creates clusters (not flat drafts).
  - Opportunity → Draft flow still works; the drafted reply appears inside the opportunity card.

## Risks & Mitigations

- **Risk:** Routing onboarding through cluster pipeline is slower than the legacy parallel-draft fan-out (cluster pipeline runs brief generation first, then 5 pieces in parallel). **Mitigation:** Onboarding already runs in a background task; total wall-clock is similar (brief + pieces parallel ≈ legacy fan-out). No user-visible regression expected.
- **Risk:** Some posted drafts in the wild already have `cluster_id` set but the cluster row was deleted (or never existed). **Mitigation:** Impact strip's "Jump to cluster" guards against missing cluster — if `getCluster` 404s, fall back to no link (treat as Legacy).
- **Risk:** Deleting `DraftCard.tsx` etc. breaks imports we didn't notice. **Mitigation:** Grep before delete; rely on `tsc --noEmit` after changes.
- **Risk:** Users who bookmarked `?tab=posted` lose their entry point. **Mitigation:** Silent fall-back to Clusters tab — they land somewhere sensible and the Impact strip exposes the data they were after.

## Open questions

None. Locked in via brainstorming session 2026-05-22.
