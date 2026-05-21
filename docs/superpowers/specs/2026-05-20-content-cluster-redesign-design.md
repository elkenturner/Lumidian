# Content Cluster Redesign — Design Doc

**Date:** 2026-05-20
**Status:** Spec — awaiting implementation plan
**Author:** Ken (via brainstorming session)

## Context

Content Clusters shipped to `main` on 2026-05-12 (see `CURRENT_STATE.md`). They replaced per-prompt one-off drafts with a 5-piece coordinated structure (linkedin, medium, reddit, quora, x) generated from a persisted `ContentBrief`. The feature is stable and deployed but two things consistently feel weak:

1. **"Cross-affirming" between pieces is largely aspirational.** Pieces are generated in parallel from a shared brief, but each piece sees only the *names* of its sibling platforms — never their text. The prompt template invites the model to make semantic references ("we dug deeper on Medium") that the model has no way to ground in reality. The brief gives coordination on positioning and language but no actual cross-affirmation.
2. **Cluster pieces have a dual home.** Pieces live both inside their cluster and in the generic `/content/[brandId]` Drafts tab. After posting they stay in Drafts. This makes it feel like pieces "leave" the cluster, even though the data model already ties them via `cluster_id`.

This redesign fixes both at the architecture level — and, since "cross-affirming" is the wrong target for an AIO-optimized product, simplifies rather than complicates the system.

## Strategy decision

The goal of Lumidian is **AI visibility** — winning retrieval in ChatGPT, Claude, Perplexity, Gemini. With that lens, the right citation strategy is unambiguous:

**Each piece should mainly cite strong off-site third-party authority. Cluster pieces should reference each other only as soft, deterministic "further reading," never as evidence.**

Why:
- AI retrievers weight independent corroboration. A piece grounded in NYT + Reuters + a .gov stat is a strong retrieval candidate. A piece that grounds claims by linking to a sibling piece (which links back) is pattern-matched as a promotional loop and discounted.
- Wikipedia forbids self-citation chains outright. Third-party reliable sources only.
- Reddit and Quora are hostile to self-promotion; heavy self-citation kills the AIO signal.
- Each piece must stand on its own as an "independent corroboration" of the same claim, not as one chapter of a coherent narrative arc with the others.

This decision is the foundation for everything below. It eliminates the need for sequential pillar-first generation or two-pass LLM weaving between siblings.

## Goals

1. Make each tracked prompt's cluster the **single home** for all content work on that prompt — drafting, editing, posting, attribution measurement, regeneration — forever.
2. Make every cluster **demonstrably grounded** in high-authority third-party sources, with a visible cluster-level source spine the user can audit.
3. Make piece coordination honest: shared brief + shared evidence pack + verbatim canonical phrasings. No pretense of LLM-driven cross-affirmation.
4. Make regeneration trustworthy: explicit regen scope (piece / pieces / brief+pieces), per-piece progress, real failure reasons, no silent `partial_failed`.

## Non-goals

- Sequential or two-pass LLM weaving between sibling pieces.
- Sibling-to-sibling quote validation.
- Replacing the legacy `_bg_generate_drafts` flow at the same time (Task 15 from the original cluster project stays deferred).
- Wikipedia surface redesign — stays as the current sibling route with its own workflow.
- SSE / websockets for live status (polling matches existing infra and is sufficient).
- Bulk "regenerate all clusters for a brand" action.
- Per-brand domain authority overrides (registry stays code-resident for v1).
- Side-by-side brief version diffs (history is read-only with revert only).
- Manual one-off draft creation (removed entirely).
- Tier-scaled brief LLM (still Haiku for all tiers in v1).

---

## Backend architecture

### Pipeline (per cluster regeneration)

```
1. Brief LLM call (Haiku)
   → produces brief: positioning, canonical_phrasings (verbatim required),
     key_claims, narrative_spine, tone_notes
   → persists as new ContentBrief row with incremented version

2. Evidence pack builder runs ONCE at cluster level (new):
   a. Serper query expansion: 3-5 queries derived from prompt + key_claims
   b. Aggregate and dedupe URLs across queries
   c. Authority tiering: classify each domain T1/T2/T3 via code-resident registry
   d. Rank: prefer T1, then T2, drop T3 below quality threshold
   e. Cap pack at N=10 sources
   f. Gate: if pack has < 2 T1 sources OR < 4 (T1+T2) total,
      mark cluster `briefing_failed` with reason. Stop.
   g. Persist as ContentEvidencePack row + ContentClusterSource rows

3. Pieces generate IN PARALLEL (asyncio.gather) from
   (brief + same evidence pack):
   a. Writer prompt includes pack as [S1]..[SN] with tier annotation
   b. Prompt requires verbatim inclusion of canonical_phrasings
   c. Writer emits draft with [Sn] markers

4. Citation critic pass (Pro tier only):
   For each draft, LLM compares each [Sn] marker against the actual
   source snippet. Drops or repositions markers that don't support
   the claim they back. Records notes for the UI's "Critic notes" panel.

5. Platform-native citation rendering:
   - Medium / Quora:   numbered footer
   - LinkedIn:         end-of-post "Sources" block (numbered)
   - Reddit:           conversational woven references at end
                       ("More on this: nytimes.com — title, reuters.com — title")
   - X:                strip; optional single shortened pillar URL only
   - Wikipedia:        <ref>{{cite web}}</ref> inline

6. Asymmetric cluster reference (post-gen, deterministic, no LLM):
   - LinkedIn, Reddit, Quora, X (only if pillar/Medium URL exists):
     append "Further reading on Medium: <url>" idiomatically formatted
     for the platform
   - Medium and Wikipedia: nothing appended

7. Persist citations as ContentDraftCitation rows.
   Update ContentClusterSource.times_cited counters.
```

### Source quality layers

| Layer | What it does | Applies to |
|---|---|---|
| **L1: Shared cluster pack** | Build one evidence pack at cluster level. Dedup. Cap at N. Every piece draws from the same pack. | All tiers, all clusters. |
| **L2: Authority tiering** | Score each source's domain into T1 (NYT/Reuters/.gov/.edu/peer-reviewed), T2 (trade press, recognized industry pubs), T3 (everything else). Brief gates if pack has <2 T1 or <4 T1+T2. | All tiers, all clusters. |
| **L3: Citation critic** | LLM pass that validates each `[Sn]` marker actually supports the claim. Drops/repositions bad ones. | Pro tier only. |

### Cluster status state machine

```
pending
   ↓
briefing  ────►  briefing_failed   (insufficient T1 sources,
   ↓                                 brief LLM error, etc.)
   │                                 → user reviews reason
   │                                 → edits brief OR retries
   ↓
generating
   ↓
   ├──► ready                  (all 5 pieces wrote successfully)
   └──► generation_partial     (some pieces failed;
                                per-piece reason recorded)
```

`partial_failed` renamed to `generation_partial`. Each piece carries `failure_reason: str | None`.

### Regeneration semantics

Three distinct actions, surfaced separately in UI:

| Action | What runs | When to use |
|---|---|---|
| **Regenerate piece** | Reuse brief + pack. Re-run writer + critic + render for one platform. | A single piece looks off. |
| **Regenerate pieces** | Reuse brief + pack. Re-run writer + critic + render for all 5 platforms. | Brief is fine; pieces feel weak. |
| **Rebuild brief & pieces** | New brief → new evidence pack → full piece regen. | Prompt/positioning changed, or sources are stale. |

### Brief editing flow

1. Brief edits create a new `ContentBrief` row with incremented `version`. Old versions retained.
2. The cluster's `last_brief_id` only updates when pieces are actually generated from that brief.
3. UI distinguishes "current brief" (the one pieces were generated from) vs "draft brief" (an unsaved edit), with a banner.
4. Brief version history is collapsible read-only with a "revert to v3" action that loads brief content into the editor (does not auto-regenerate).
5. "Regenerate pieces" with a dirty draft brief saves the draft as a new version first, then regenerates.

### Polling & live status

- Cluster detail page polls `GET /api/clusters/{brand_id}/{cluster_id}/status` every 2s when status is `briefing` or `generating`.
- Lightweight payload: status + per-piece states.
- Polling stops on terminal status (`ready`, `briefing_failed`, `generation_partial`).
- Each piece has a micro-state during generation: `queued → writing → critic → rendering → done | failed`.

### Stale/stuck recovery

Clusters in `briefing` or `generating` older than 15min get auto-flipped to `briefing_failed` / `generation_partial` with reason `"timeout"` by extending the existing stuck-tracking-run APScheduler job.

### Concurrency / cost notes

- Old flow per regeneration: 5 Serper rounds + 5 writer calls + 0 critic calls.
- New flow per regeneration: 1 Serper round (3–5 expanded queries batched) + 5 writer calls + 5 critic calls (Pro tier only) + 1 brief call.
- Net: roughly same wall-clock, modestly more LLM cost on Pro (+5 critic calls), modestly less Serper cost on all tiers.

---

## Frontend architecture

### Route changes

| Before | After |
|---|---|
| `/content/[brandId]` with tabs (Clusters · Drafts · Opportunities · Gaps · Wikipedia) | `/content/[brandId]` — cluster list, single surface |
| `/content/[brandId]/cluster/[clusterId]` | unchanged (cluster detail) |
| Wikipedia as a tab on `/content/[brandId]` | `/content/[brandId]/wikipedia` as a separate sibling route |

The `Drafts`, `Opportunities`, `Gaps` tabs disappear from `/content/[brandId]`. Their underlying data (`ContentOpportunity`, `ContentGap`) is surfaced inline on the relevant cluster detail page in a collapsed "Inputs" zone. Wikipedia gets its own sibling route in the top nav (different model, different lifecycle).

### `/content/[brandId]` — cluster list

```
┌──────────────────────────────────────────────────────────────┐
│  Content · {Brand}                          [+ New cluster]  │
│  Subtitle: one cluster per tracked prompt                    │
├──────────────────────────────────────────────────────────────┤
│  Sort:  Visibility ↑   Last updated   Attribution impact     │
│  Filter: All · Needs attention · Ready · In progress · Failed│
├──────────────────────────────────────────────────────────────┤
│  ┌──── Cluster card ─────────────────────────────────────┐  │
│  │ "best CRM for solo founders"          [▼ 28% vis]    │  │
│  │ ────────────────────────────────────────────────────  │  │
│  │ Brief v3 · Pack 9 sources (4 T1, 5 T2) · Updated 2d   │  │
│  │ ◉ LinkedIn  draft   ◉ Medium  posted +4pp             │  │
│  │ ◉ Reddit    posted  ◉ Quora   approved                │  │
│  │ ◉ X         draft                                     │  │
│  │ [Open cluster]  [Regenerate ▾]                        │  │
│  └────────────────────────────────────────────────────────┘  │
│  ... (one card per tracked prompt)                          │
└──────────────────────────────────────────────────────────────┘
```

Default sort: visibility ascending (lowest needs work first). Filter set covers the common drill-downs. The card surfaces brief version, source pack health, per-piece status, attribution delta where measured.

### `/content/[brandId]/cluster/[clusterId]` — cluster detail

Three vertical zones, top to bottom:

```
ZONE 1 — BRIEF + SOURCE SPINE (side by side, collapsible)
  Left:  Brief v3 — positioning, canonical phrasings, claims,
         narrative spine, tone notes. [Edit] [History ▾]
  Right: Sources (9) — listed by tier (T1 first), each row shows
         domain, tier badge, "used by N pieces". [Refresh sources]

ZONE 2 — PIECES (5 cards in a responsive grid)
  Each card shows: platform, status (draft|approved|posted|failed),
  attribution delta (if posted), citation count, [View] [Copy]
  [Regenerate]. Click View opens a modal with rendered draft text
  + per-piece Citations sub-panel + Critic notes sub-panel
  (Pro tier only).

ZONE 3 — INPUTS (collapsed by default)
  ▶ Pillar candidate (own site) — propose/attached/rejected/none
  ▶ Opportunities for this prompt — N Reddit threads, N Quora questions
  ▶ Gap analysis — severity score, competitor mentions
```

### Key UX details

- **Source spine is first-class.** A user can click a source to see which pieces cite it. The cluster's source story lives in zone 1; per-piece citations live inside the View modal.
- **Per-piece attribution is inline.** No separate tracking tab. Hover for full `DraftAttribution` detail.
- **Piece View modal** shows: rendered platform-native text, "Citations" sub-panel (the actual `[Sn]` markers and what they back), "Critic notes" sub-panel on Pro tier.
- **Inputs zone collapsed by default** so the page doesn't feel cluttered.
- **No tabs anywhere.** The cluster is the unit of work.

### Empty / failure states

- **New brand, no clusters**: cluster list shows "We'll generate clusters for your N prompts" with a single "Generate all" button.
- **`briefing_failed`**: card shows red banner "Need at least 2 high-authority sources for this prompt — we found 1. Try editing the brief or regenerating."
- **`generation_partial`**: per-piece state visible on the card; user can regenerate just the failed pieces from the card.

---

## Data model deltas

Migrations added to `database.py:run_migrations()` per project convention.

### `ContentCluster` — modified

- `status` extended: add `briefing_failed`. Rename `partial_failed` → `generation_partial`.
- `failure_reason: str | None` — new field, populated when status is `*_failed` / `generation_partial`.

### `ContentBrief` — modified

- `evidence_pack_id: int | None` — FK to `ContentEvidencePack` (new). Brief and pack are versioned together.

### `ContentEvidencePack` — new table

```
id PK
cluster_id FK → ContentCluster
version INT (matches the brief version that created it)
sources JSON   # list of {url, domain, tier (T1/T2/T3), title, snippet, used_by_pieces: [platform]}
total_t1 INT
total_t2 INT
total_t3 INT
created_at
```

Rationale for a table (vs JSON blob on the brief): the source spine UI renders this independently, sources may be refreshed without rebuilding the brief, and we'll likely want cross-cluster source queries later.

### `ContentDraft` — modified

- `cluster_id` becomes **NOT NULL** (enforced at service + Pydantic layer; DB constraint deferred until follow-up cleanup migration to avoid breaking legacy `cluster_id=NULL` orphan posted drafts).
- `source` field: `"manual"` and `"onboarding"` become legal-but-deprecated. New drafts use `"cluster"` exclusively.
- `failure_reason: str | None` — new field.
- `generation_state: str` — new field, micro-state during a generation cycle (`queued | writing | critic | rendering | done | failed`). Reset to `done` on completion.

### `ContentDraftCitation` — unchanged structurally

Populated by the citation-critic pass on Pro tier (markers may be dropped or repositioned vs. what the writer emitted).

### `ContentClusterSource` — new table

```
id PK
cluster_id FK
evidence_pack_id FK
url
domain
tier   # T1/T2/T3
title
times_cited INT  # count across all pieces in this cluster
created_at
UNIQUE(cluster_id, url)
```

The source spine UI reads from this table.

### Domain authority registry — code-resident

- `backend/app/services/source_authority/registry.py` — `T1_DOMAINS: set[str]`, `T2_DOMAINS: set[str]` (~500 entries total).
- `classify_domain(domain: str) -> Literal["T1","T2","T3"]` — registry lookup first, then heuristics (`.gov`/`.edu` → T1, etc.).
- Version-controlled. Reviewed in PR. No admin UI for v1.

---

## Migration plan

Embedded in `run_migrations()`. Steps applied in order:

1. **`ContentCluster` schema**:
   - `ALTER TABLE content_clusters ADD COLUMN failure_reason TEXT`
   - `UPDATE content_clusters SET status='generation_partial' WHERE status='partial_failed'`

2. **`ContentBrief.evidence_pack_id`**:
   - `ALTER TABLE content_briefs ADD COLUMN evidence_pack_id INTEGER REFERENCES content_evidence_packs(id)`. NULL on existing rows.

3. **Create `content_evidence_packs` and `content_cluster_sources`** via `Base.metadata.create_all()` (already runs on startup before migrations).

4. **`ContentDraft` schema**:
   - `ALTER TABLE content_drafts ADD COLUMN failure_reason TEXT`
   - `ALTER TABLE content_drafts ADD COLUMN generation_state TEXT DEFAULT 'done'`
   - `cluster_id NOT NULL` enforcement: service + Pydantic layer only on this migration. DB constraint deferred to avoid breaking legacy orphan posted drafts.

5. **Legacy orphan posted drafts** (small set with `cluster_id=NULL` from the original cluster migration):
   - Stay in the DB.
   - `/content/[brandId]/archive` sub-route renders them read-only, accessed via a footer link on the cluster list ("View legacy posted drafts (N)").
   - Never appear in the cluster list or anywhere else.
   - No new orphan drafts can be created (service layer enforces `cluster_id`).

6. **Tab routes** (`Drafts`, `Opportunities`, `Gaps`):
   - Components remain (still used for inline panels) but unmount from the tab bar.
   - Direct deep-link visits redirect to the cluster list.

**No data loss anywhere. No backfills required.**

---

## Testing

- **Unit**: `tests/test_source_authority.py` (classification correctness, registry coverage spot checks).
- **Unit**: `tests/test_cluster_evidence.py` (dedup, tier gating, cap-at-N, gate-failure produces `briefing_failed`).
- **Unit**: `tests/test_citation_critic.py` (mocked LLM responses; dropped markers, repositioned markers, all-bad rejection).
- **Integration**: `tests/test_clusters.py` extended for renamed status (`generation_partial`) and new lifecycle (`briefing_failed`, `failure_reason`, per-piece micro-states).
- **Integration**: `tests/test_cluster_pipeline.py` — end-to-end regeneration with mocked Serper + mocked LLM, asserting pack is built once, shared across pieces, and gates correctly.
- **Multi-tenancy**: ownership isolation tests extended to `ContentEvidencePack`, `ContentClusterSource`.
- **Frontend**: no test infra exists; manual QA notes in PR.

---

## Rollout

- Single deploy. No feature flag (clusters are already the live surface; this is a refinement).
- Backend changes ship together with frontend changes to avoid intermediate dual-home state.
- Existing clusters keep their data; the next regeneration on each cluster builds the new evidence pack and populates the new tables.
- Until a cluster is regenerated post-deploy, the source spine UI will show "Sources from before this redesign aren't tracked at the cluster level — regenerate to populate." This is acceptable; no user-visible breakage.

---

## Open questions for the plan

None blocking. The implementation plan should decide:
- Exact T1/T2 domain registry seeding strategy (initial list compiled from where? CSV in repo, or curated by hand?).
- Concrete prompt template for the citation critic LLM.
- Whether `_RECS`-style template literal phrases for the "Further reading on Medium" insertion are platform-tested in the writing-style audit.

## Deferred follow-ups (not in this spec)

- Apply the L3 citation critic to the existing Wikipedia surface's draft generation flow. (Wikipedia bans bad citations outright and benefits from this even more than cluster pieces — but the Wikipedia surface is a separate workflow with its own redesign history, so we keep this out of scope and tackle it as a follow-up.)
- Migrate the legacy `_bg_generate_drafts` onboarding flow to use the new pipeline. (Task 15 from the original cluster project.)
- Tier-scaled brief LLM (Pro gets a stronger brief model).
- Bulk "regenerate all clusters" action.
- Per-brand domain authority overrides + admin UI for the registry.
- Side-by-side diff between brief versions.
