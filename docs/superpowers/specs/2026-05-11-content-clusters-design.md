# Content Clusters — Design

**Date:** 2026-05-11
**Status:** Approved (brainstorm phase complete)
**Owner:** Ken
**Related:** [Website AIO](./2026-05-11-website-aio-design.md), [Content Hub Cleanup](./2026-04-04-content-hub-cleanup-design.md), [Content Drafting Audit](./2026-04-10-content-drafting-audit-design.md)

---

## Problem

The current content hub generates one-off drafts per prompt × per platform. Each draft is independent — no shared narrative, no cross-citation, no coordination. AI engines reward topical authority and co-citation across a network of pieces; isolated drafts capture none of that signal. The hub is a list of drafts, not a content strategy.

The Wikipedia draft path is also actively harmful — Wikipedia requires neutral, citation-backed, non-promotional content and is incompatible with the marketing-driven draft generator. It currently produces drafts that would be rejected on Wikipedia and damage the brand's reputation if posted.

## Goals

1. Turn the 5 platform drafts (LinkedIn, Medium, Reddit, Quora, X) per prompt into a **cross-affirming cluster** with shared narrative, canonical phrasings, stats, and mutual references.
2. Persist a first-class **Brief** artifact that powers coherent generation and lets power users / agency operators steer cluster tone and content explicitly.
3. Reorganize the content hub UX around clusters as the primary unit while keeping opportunities and gaps untouched.
4. Carve Wikipedia out of the cluster system into a separate tab with a placeholder for future proper handling.
5. Optionally attach an own-site **pillar** page per cluster, only when its tone passes a non-promotional check.

## Non-goals

- Building the full Wikipedia editing workflow (placeholder tab only this iteration).
- Topic / multi-prompt clusters (cluster = one prompt for v1).
- A new cluster-level scoring metric. Visibility scoring stays at the prompt level; clusters render the prompt's existing score in context.
- Auto-launch / auto-post automation (manual-only posting per existing project memory).
- A separate cluster cap on top of existing draft caps.
- New top-level nav. `/content/[brandId]` stays where it is.

## Approach

For each tracked prompt, generate the 5 platform pieces as a **coordinated set** via a brief-first, parallel-pieces pipeline:

1. **Brief** — one LLM call produces a shared `ContentBrief` (positioning, key claims, canonical phrasings, stats, competitor context, narrative spine, tone notes) from BrandProfile + prompt + recent tracking run + site-audit data.
2. **Pieces** — 5 parallel per-platform generation calls, each given the brief plus a platform style guide and the titles of sibling pieces (so siblings can be name-dropped semantically).
3. **Pillar (optional)** — if the brand has a website and an own-site page targets this prompt (from site audit), tone-score the page. If non-promotional, propose it as the cluster pillar; user must explicitly accept. Never auto-attach.

Pieces cross-reference each other through:
- **Canonical phrasings repeated verbatim** across pieces (highest-leverage AIO lever).
- **Shared stats** used distinctly per platform.
- **Semantic name-drops** ("we also covered this on Medium"), no hard URLs — URLs aren't known at generation time.
- **Pillar URL** as the only hard link, when an accepted pillar exists.

Failure of any single piece-generation call lands the cluster in `partial_failed`; user retries just the failed pieces.

## Data Model

### New: `ContentCluster`

| Field | Type | Notes |
|---|---|---|
| `id` | int PK | |
| `brand_id` | int FK → brands.id | |
| `prompt_id` | int FK → prompts.id | **Unique** — one cluster per prompt |
| `status` | str | `pending` / `briefing` / `generating` / `ready` / `partial_failed` |
| `pillar_mode` | str | `none` / `proposed` / `attached` / `rejected_tone` (default `none`) |
| `pillar_url` | str | Nullable. Set when an own-site page is proposed or attached. |
| `last_brief_id` | int FK → content_briefs.id | Most recent brief used to generate pieces |
| `version` | int | Bumped on regenerate |
| `last_generated_at` | datetime | |
| `created_at` | datetime | |

### New: `ContentBrief`

| Field | Type | Notes |
|---|---|---|
| `id` | int PK | |
| `cluster_id` | int FK → content_clusters.id | |
| `version` | int | Briefs are versioned per cluster; new generations create a new row |
| `positioning` | text | The angle for this prompt |
| `key_claims` | JSON list[str] | 3–6 claims the cluster supports |
| `canonical_phrasings` | JSON list[str] | 3–5 short phrases that must appear verbatim across pieces |
| `stats` | JSON list[{label, value, source}] | 2–4 facts/numbers |
| `competitor_context` | JSON | `{top_competitors: [...], winning_patterns: "..."}` from recent tracking run |
| `narrative_spine` | text | The through-line |
| `tone_notes` | text | Pulled from BrandProfile (tone_of_voice, what_not_to_say, approved_language) |
| `created_at` | datetime | |
| `created_by` | str | `user:<id>` or `system` |

### Changed: `ContentDraft`

- Add `cluster_id` int FK → content_clusters.id, **nullable** (so existing drafts can be migrated incrementally and Wikipedia drafts can remain cluster-less).

### Unchanged

`ContentOpportunity`, `ContentGap`, `ContentPost`, `DraftAttribution`, `BrandContentSettings`, `BrandProfile` — no schema changes.

### Migration step

New `ALTER TABLE` block at the bottom of `database.py:run_migrations()`:

1. Create `content_clusters` table.
2. Create `content_briefs` table.
3. Add `cluster_id` column to `content_drafts`.
4. Backfill (one-time, idempotent): for each brand with drafts, group drafts by `prompt_id`; create a `ContentCluster` (status=`ready`, `pillar_mode=none`); synthesize a templated `ContentBrief` (no LLM call — just BrandProfile + prompt text into the brief fields so the cluster has a brief it can show); set `cluster_id` on the existing drafts. Wikipedia drafts skipped (left with `cluster_id` null; still accessible from the new Wikipedia tab).

## Generation Pipeline

Triggered by: onboarding-time draft generation, "Regenerate Drafts" button, or new "Refresh cluster" button on a cluster card.

```
1. Build inputs
   ├─ Prompt text
   ├─ BrandProfile (tone, what_not_to_say, approved_language, publications, key_stats)
   ├─ Recent TrackingRun for this prompt
   │   (top mentioned competitors, winning response patterns, brand's own score)
   └─ Site audit data (if available — own-site pages targeting this prompt)

2. Generate Brief  (1 LLM call)
   - Free / Starter → gpt-4o-mini
   - Growth / Pro   → claude-haiku-4-5-20251001
   → ContentBrief row written
   → Cluster status: briefing → ready (brief generated, pieces not yet)

3. Fan out 5 parallel piece-generation calls
   ├─ LinkedIn
   ├─ Medium
   ├─ Reddit
   ├─ Quora
   └─ X
   Each call gets: brief + platform style guide + list of sibling platforms
   (so the piece can say "we covered this on Medium" without knowing the
   sibling's title or URL, which don't exist at generation time).
   Reuses existing per-platform generation in drafting_service.py
   with tier-mapped models (unchanged).
   → 5 ContentDraft rows written with cluster_id set
   → Cluster status: generating → ready (or partial_failed)

4. Pillar check  (only if brand has website + site audit data exists)
   ├─ Pull own-site pages matched to this prompt from site audit
   ├─ Tone-score each candidate via 1 LLM call (promotional? neutral?)
   ├─ If a page passes the tone gate → cluster.pillar_mode='proposed', pillar_url set
   └─ User must accept the proposed pillar; never auto-attached
```

**Cost delta vs today:** today's "Regenerate Drafts" cost + 1 brief call + (optionally) 1 pillar tone-check call. Roughly 5–10% increase per cluster generation.

**Concurrency:** step 3 reuses today's `MAX_CONCURRENT` semaphore in `drafting_service.py`. No new concurrency knobs.

**Failure handling:** step 3 piece failures don't block the cluster. Cluster lands in `partial_failed` if any piece fails; user retries just the failed pieces via "Regenerate this piece" on the affected card.

**Brief editing:** brief is generated and pieces fan out immediately by default. Power-user path: an "Edit brief before generating pieces" toggle on the regenerate action that lets the user inspect/edit the brief before step 3 fires. Brief edits in-flight just update the row; subsequent piece regenerations use the latest brief.

## Cross-Citation Rules (baked into piece-generation prompts)

1. **Canonical phrasings appear verbatim.** Each piece must include at least 1, ideally 2 of the brief's canonical phrasings, written verbatim or near-verbatim.
2. **Shared stats, used distinctly.** Each piece weaves in 1–2 of the brief's stats, framed for the platform (LinkedIn: lead with stat; Reddit: drop casually mid-comment; Medium: back with context).
3. **Sibling name-drops, not hard links.** Pieces reference siblings semantically ("we dug deeper into this in a recent Medium piece"). No URLs at generation time. After a user posts a piece and pastes the live URL into Lumidian, the system may offer to backfill links into siblings (not in MVP scope).
4. **Pillar link is the only hard link.** If `pillar_mode='attached'`, each piece includes one outbound link to `pillar_url`, written in-context — not as a CTA.
5. **Tone separation enforced per platform.**
   - **LinkedIn:** professional, narrative POV, 1st person, 150–300 words.
   - **Medium:** essay form, headers, 800–1500 words, can cite siblings as "also covered…".
   - **Reddit:** conversational comment, no marketing register, brand mentioned as a fact, not a pitch.
   - **Quora:** answer form, direct, brand named at most once, must be useful even absent the brand.
   - **X:** thread (3–7 tweets) or single post, punchy, one canonical phrasing locked in.

**Anti-promotional rule (all platforms):** the brief must read like the brand is one source of truth among several, not the whole answer. Piece prompts explicitly forbid: opening with the brand name, CTAs, marketing voice. Voice target: a knowledgeable practitioner who happens to mention the brand as relevant.

## Pillar Workflow

Pillars are opt-in and tone-gated. Default state across all clusters is `pillar_mode='none'`.

**Proposal flow:**
1. After step 3 of the pipeline, if the brand has `website_url` set and at least one `WebsiteAuditPage` matches the prompt (via the existing page↔prompt linker from the Website AIO module), each candidate page is tone-scored via a single LLM call.
2. Pages that pass (non-promotional, informative voice) become eligible pillar candidates.
3. The highest-scoring candidate is surfaced on the cluster detail page as a proposed pillar card with the tone reasoning visible.
4. User clicks **Accept** → `pillar_mode='attached'`, `pillar_url` set, sibling pieces are regenerated to include a hard link to the pillar.
5. User clicks **Reject** → `pillar_mode='rejected_tone'`, no link. Subsequent cluster generations won't re-propose unless the page changes (tracked via `WebsiteAuditPage.id` reference).

**No own-site pillar generation in MVP.** We propose existing pages only. Generating new pillar pages on a brand's own domain is out of scope and would require a publishing integration the brand doesn't have today.

## UX

`/content/[brandId]` reorganizes around clusters but keeps existing tabs accessible.

**Tabs (left-to-right):** `Clusters` (default) · `Opportunities` · `Wikipedia` · `Gaps`.

**Clusters tab:**
- Top: brand selector, "Regenerate" button, draft-status meter (existing `getDraftStatus` endpoint).
- Body: one cluster card per prompt, sorted by prompt visibility score ascending (lowest-visibility floats to top).
- Each cluster card shows: prompt text, current visibility score, cluster status, piece chips with per-piece status (draft / approved / posted), trend delta if pieces have been posted, action buttons (View cluster, Regenerate, View brief).

**Cluster detail (`/content/[brandId]/cluster/[clusterId]`):**
- Brief panel collapsed at top; expand to view/edit. "Edit brief" requires confirmation since piece coherence depends on it.
- 5 piece cards in a row (LinkedIn, Medium, Reddit, Quora, X), each editable inline like today's drafts. Buttons: Approve, Regenerate (single piece), Mark posted, Delete.
- Pillar card (when present): own-site page metadata, tone-score reasoning, Accept / Reject buttons.

**Opportunities tab:** unchanged from today.

**Wikipedia tab:** placeholder for this build. Shows a list of Wikipedia-relevant topics for the brand (derived from BrandProfile + tracked prompts) with a "Wikipedia requires different handling — proper workflow coming soon" card. Legacy Wikipedia drafts (cluster-less after migration) are listed here so they remain accessible.

**Gaps tab:** unchanged from today. (Future iteration: clicking a gap could spawn a cluster — not in MVP.)

**Sidebar / nav:** no changes.

## Scoring

No new scoring math. Cluster "visibility" = the prompt's existing per-prompt visibility (computed from `QueryResult` rows for that prompt across models). Trend lines, deltas, and `DraftAttribution` continue to work unchanged — they're just rendered inside the cluster card.

Optional additive (deferred): a `clusters_with_lift` dashboard metric counting clusters where any draft has been posted AND the cluster's prompt visibility went up since posting. Useful for agency reporting. Not in MVP.

## Interaction with `BrandContentSettings`

`BrandContentSettings` (per-brand, per-platform enabled flag) is respected. A cluster only generates pieces for platforms where `enabled=True` for that brand. If LinkedIn is disabled for the brand, the cluster has 4 pieces instead of 5. Cluster status reaches `ready` once all *enabled* platforms have pieces. Disabling a platform after pieces are already generated does not delete those pieces; it just stops them from being regenerated on next cluster refresh.

## Tier Caps

Existing draft caps (`TIER_DRAFT_CAPS`, `TIER_SCHEDULED_CAPS` in `content.py` / `drafting_service.py`) stay as-is — a 5-piece cluster counts as 5 drafts against the cap.

**LLM tier mapping for the new brief step:**
- Free / Starter → `gpt-4o-mini`
- Growth / Pro → `claude-haiku-4-5-20251001`

Piece-generation tier mapping (unchanged from today's `drafting_service.py`).

**Pillar tone-check call** uses `gpt-4o-mini` regardless of tier (it's a single cheap classification).

No new env vars; no new tier columns.

## Wikipedia (out of scope, but stated for clarity)

Wikipedia is removed from the cluster platform set in this build. Existing Wikipedia drafts are preserved (cluster-less) and shown under the new Wikipedia tab. No new Wikipedia generation occurs as part of cluster regeneration. The proper Wikipedia workflow (neutral encyclopedic voice, citation requirements, no first-person, suggested edits not drafts) is a separate future project.

## Migration

One-time, idempotent backfill run after deploy:

1. Skip brands with no `ContentDraft` rows.
2. For each brand, group drafts by `prompt_id`, excluding Wikipedia drafts.
3. Per group: create a `ContentCluster` (status=`ready`, `pillar_mode=none`); synthesize a templated `ContentBrief` (no LLM call); set `cluster_id` on each draft in the group.
4. Wikipedia drafts: `cluster_id` stays null; surfaced from the new Wikipedia tab.

Existing drafts retain their content. Users see clusters immediately with a "Regenerate to upgrade this cluster" hint on each card so they can opt into LLM-generated briefs at their pace.

## Backend Surface

New router endpoints under `/api/content/clusters/*`:

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/content/clusters/{brand_id}` | List clusters for a brand with summary stats |
| GET | `/api/content/clusters/{brand_id}/{cluster_id}` | Cluster detail (brief + pieces + pillar) |
| POST | `/api/content/clusters/{brand_id}/{cluster_id}/regenerate` | Regenerate brief + all pieces |
| POST | `/api/content/clusters/{brand_id}/{cluster_id}/regenerate-piece` | Regenerate one piece (body: `{platform}`) |
| PATCH | `/api/content/clusters/{brand_id}/{cluster_id}/brief` | Edit brief in place |
| POST | `/api/content/clusters/{brand_id}/{cluster_id}/pillar/accept` | Accept proposed pillar |
| POST | `/api/content/clusters/{brand_id}/{cluster_id}/pillar/reject` | Reject proposed pillar |

Existing `/api/content/*` endpoints unchanged. Existing `generateNow` / `generateDraft` paths now route through the cluster pipeline internally.

New service module `app/services/clustering_service.py` owns:
- `build_brief(brand, prompt) -> ContentBrief`
- `generate_pieces(cluster, brief) -> list[ContentDraft]`
- `propose_pillar(cluster) -> Optional[PillarCandidate]`
- `regenerate_cluster(cluster) -> ContentCluster`

`drafting_service.py` keeps per-platform piece generation primitives; `clustering_service.py` orchestrates.

## Frontend Surface

- `lib/api.ts`: new `clusters` group (`getClusters`, `getCluster`, `regenerateCluster`, `regeneratePiece`, `editBrief`, `acceptPillar`, `rejectPillar`).
- `app/content/[brandId]/page.tsx`: refactored into a tabbed layout with Clusters as default tab.
- `app/content/[brandId]/cluster/[clusterId]/page.tsx`: new route for cluster detail.
- `components/content/cluster/*`: new component group — `ClusterCard`, `ClusterDetailView`, `BriefPanel`, `PieceCard`, `PillarCard`.
- Wikipedia tab: lightweight component listing topics + legacy drafts. No editing surface.

## Risks & Open Questions

- **Brief-driven coherence vs. platform authenticity tradeoff.** Heavy use of canonical phrasings can cross over into formulaic / templated reads, which AI engines and humans both detect. Piece-generation prompts must enforce variation in framing while preserving phrasing — this is the main quality risk and worth manual review on the first cohort of clusters.
- **Pillar tone-scoring reliability.** The tone gate is LLM-based and will occasionally misclassify. Surface the reasoning to the user so they can override.
- **Backfill brief quality.** Migrated clusters have a templated brief, not an LLM-generated one. The hint to "Regenerate to upgrade" addresses this, but some users won't act on it and will see weak briefs if they open the brief panel. Acceptable for v1.
- **Wikipedia tab is intentionally thin.** Some users may have invested in Wikipedia drafts. We preserve them but stop generating new ones until the proper workflow lands. This is the right call (existing Wiki drafts shouldn't be posted as-is anyway).

## Out of Scope (parked for future)

- Wikipedia workflow proper.
- Multi-prompt / topic clusters.
- Spawning a cluster from a gap.
- Auto-backfill of sibling hard links after the user posts a piece and pastes the URL.
- Auto-posting / scheduling.
- Cluster-level scoring metric beyond the prompt's existing score.
- New pillar pages generated for the brand's own site (vs. proposing existing pages).
