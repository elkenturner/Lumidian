# Cluster Lifecycle Flow — Design Doc

**Date:** 2026-06-28
**Status:** Spec — awaiting implementation plan
**Author:** Ken (via brainstorming session)

## Context

Content Clusters shipped (see `2026-05-20-content-cluster-redesign-design.md`) but the live experience on prod is opaque for the one real customer (Manhattan Street Capital, brand_id=2, Growth tier). Inspection of `/data/lumidian.db` surfaced concrete failure modes that all trace back to one missing concept: a cluster has no lifecycle. It's a draft pool that gets wiped on regen, with no notion of "shipped" vs "in-progress" content and no protection for posted work.

Specifically, MSC's view shows:

- **13 tracked prompts → 10 cluster cards.** Three pitch-typed prompts (ids 14, 19, 20) have no `ContentCluster` row. The page only renders existing clusters; orphan prompts vanish silently with no "create" affordance.
- **Inconsistent platform coverage with no explanation.** Reddit and Quora are disabled in `BrandContentSettings` (rows updated 2026-05-14). `_enabled_platforms()` honors that, so most clusters come back 3-up (linkedin/medium/x). Clusters 1 and 8 have 5-up coverage because per-piece regen (which doesn't check `BrandContentSettings`) was run on them later. Result: identical-looking cards with different platform sets, zero UI signal.
- **Cluster 4 has duplicate LinkedIn drafts** (ids 336 + 337, 13s apart). Pre-regen `delete(ContentDraft).where(cluster_id=...)` is not serialized; two parallel rebuild calls each delete-then-insert and leave doubles.
- **Headline "AI visibility lift" is dead on every card** (`—`) because `cluster_delta` only sums `DraftAttribution` rows for cluster-sourced posted drafts, and zero cluster drafts have been posted. Meanwhile MSC has 12 posted drafts outside clusters (Wikipedia + Quora + LinkedIn) with real attribution:
  - Prompt 70 → Wikipedia post → **+88.89 pts**
  - Prompt 79 → Wikipedia + Quora → **+22.22 pts**
  - Prompt 19 → **−11.11 pts** (regression, no alert)
  - Prompt 20 → **−22.22 pts** (regression, no alert)
- **Regen is unlimited** with no caps anywhere. Brief LLM + evidence pack + N writer pipelines per click, no metering.
- **Posted drafts are destroyed on cluster regen.** `regenerate_cluster` runs `delete(ContentDraft).where(ContentDraft.cluster_id == X)` with no status filter. `DraftAttribution.draft_id` is `ondelete="CASCADE"`. A posted draft with a live URL on LinkedIn and accumulating lift data gets nuked along with everything else. The post stays live in the real world; Lumidian permanently forgets it.
- **"(untitled)" everywhere.** ~13 of 35 cluster drafts have title "(untitled)" because short-form platforms (x, reddit, quora) fall back to that string.

The brainstorming session settled on a model that addresses all of this at the architecture level rather than patching symptoms.

## Strategy decision

**A cluster is a long-lived workspace tied to one tracked prompt.** It owns two pools that coexist forever:

- **Posted pool** — immutable historical record. Each row is a fact about something MSC published. We never mutate or delete these rows after the post transition.
- **Working pool** — mutable, at most one row per platform per cluster. Represents the current draft the customer is considering posting. Regen replaces in place.

**One prompt = one cluster card, always.** Every tracked prompt gets an eagerly-created `ContentCluster` shell on prompt creation. Orphan prompts (no working drafts yet) show a `pending` shell with a "Generate" CTA, not an absence.

**Lift attribution is keyed on `prompt_id`, not on cluster-sourced draft ids.** Any posted draft for that prompt — cluster-sourced, legacy gap-driven, Wikipedia surface — contributes to the cluster's lift number. This makes the cluster surface a real performance dashboard for work the customer has actually done, instead of an isolated draft pool that ignores the rest of the system.

**Per-piece posting with a visible completion meter, no atomic-publish gate.** The customer posts each piece on their own schedule. The cluster card displays coverage facts plainly ("2 of 3 enabled platforms posted") and a one-liner reminder that lift only counts what's posted. No fabricated stats, no blocked buttons.

This decision is the foundation for everything below.

## Goals

1. Make every tracked prompt have exactly one cluster card, always — no orphan prompts and no platform-count drift between cards.
2. Make posted drafts inviolable. No code path may mutate or delete a draft whose `status = 'posted'`.
3. Make lift on the cluster surface reflect every posted draft for that prompt, including legacy and Wikipedia posts that pre-date the cluster system.
4. Make the customer's current cluster state legible at a glance — two halves of a progress bar (posted ↔ working) replace the opaque `Ready`/`Partial` enum.
5. Make regeneration semantics sharp: three actions, each with a precise scope, none touching posted drafts.

## Non-goals

- Regen rate limiting or per-tier caps (deferred; no usage signal justifies it yet).
- Brief version history UI (`ContentBrief.version` is already stored; surface only if asked).
- A working-draft attempts stack or history (replace-in-place only).
- A "no longer live" archive toggle on posted drafts (let score decay speak for itself).
- Adding Wikipedia to the cluster working pool (Wikipedia keeps its own legitimacy-gated surface).
- Reconciling the legacy `/content` Drafts page with the cluster surface (separate scope).
- Sequential/two-pass LLM cross-affirmation between sibling pieces (already settled against in `2026-05-20-content-cluster-redesign-design.md`).
- Removing the redundant `Rewrite all posts` action if it overlaps too much with `Rebuild` — covered in implementation plan, not here.

## Conceptual model

### The two pools

| Pool | Mutability | Cardinality | Lifetime |
|---|---|---|---|
| **Posted** | Immutable after transition | Many rows per (cluster, platform) over time (v1, v2, …) | Forever |
| **Working** | Mutable, replace-in-place | At most one per (cluster, platform) | Until posted or until regenerated |

A `ContentDraft` row belongs to the posted pool iff `status = 'posted'`; otherwise it's in the working pool. There is no separate table — the existing `content_drafts` table holds both, distinguished by status.

**Invariant:** at most one `ContentDraft` row per `(cluster_id, platform)` with `status IN ('draft', 'approved', 'failed')`. Enforced via a partial unique index. Posted drafts have no uniqueness constraint — multiple posted versions of the same platform are expected over time.

### One prompt = one cluster

Every tracked prompt has a `ContentCluster` row. On `Prompt` insert (any code path — onboarding, manual prompt add, prompt regeneration), we eagerly create a shell cluster with `status='pending'`, no working drafts, no brief. The "Generate cluster" CTA on the page is what runs `regenerate_cluster(rebuild_brief=True)` for the first time.

This makes the cluster grid trivially correct: the count of cluster cards always equals the count of tracked prompts. The 3 orphan prompts for MSC get backfilled by the migration.

### Composed status, not a single enum

The cluster page no longer shows a single status label like "Ready" or "Partial." It shows two facts side by side, both derived live from row state:

```
○○○○○  0 of 5 posts live    │ 5 drafts to review
●●○○○  2 of 5 posts live    │ 3 drafts to review
●●●●●  5 of 5 posts live    │ —                       (lift: +12.4 pts)
●●●●●  5 of 5 posts live    │ drafting v2…           (lift: +12.4 pts)
○○○○○  0 of 5 posts live    │ generating…
○○○○○  0 of 5 posts live    │ — (Generate cluster)
```

The dotted half is **posted-pool coverage** for this prompt (counts every posted draft for `prompt_id`, including Wikipedia and legacy). The solid half is **working-pool state** (count of working drafts, or in-flight generation status, or empty with a CTA).

The denominator on the dotted half is **enabled platforms** (`BrandContentSettings.enabled = 1`), so disabled platforms never inflate the bar. Disabled platforms render in the working-pool grid as muted slots with an inline "Disabled — enable in Settings" link scoped to the brand.

### Coverage nudge, not gate

When the posted pool is partial (≥1 but < full coverage), the card displays one factual line: *"Lift only counts what's posted. Publish the remaining platforms to capture full impact."* No fabricated percentage. No disabled buttons. The customer can take whatever pace suits them.

### Wikipedia integration

Wikipedia stays out of the working pool (its drafts come from the Wikipedia surface with its own legitimacy gate). But posted Wikipedia drafts for the prompt **do** appear in the posted-pool count and in the lift number. The cluster page renders them as a separate strip: *"+1 Wikipedia post (from Wiki surface) — posted 2026-04-29 → +88pts."* Read-only on the cluster page; clicking it links to the Wikipedia surface.

### "Push v2" affirmative

When the cluster is fully live (posted-pool coverage = enabled-platform count), the cluster card shows an affirmative CTA: *"Live and measuring lift. Push v2 for this prompt? [Generate]"* This runs `regenerate_cluster(rebuild_brief=True)`, which populates the working pool without touching the posted pool. The customer's next round flows naturally.

## Data model changes

### `ContentDraft` (no schema change beyond a partial unique index)

Add a partial unique index enforcing one working draft per (cluster, platform):

```sql
CREATE UNIQUE INDEX uq_cluster_platform_working
  ON content_drafts(cluster_id, platform)
  WHERE status IN ('draft', 'approved', 'failed') AND cluster_id IS NOT NULL;
```

SQLite supports partial indexes (`WHERE` clauses in `CREATE INDEX`) since 3.8.0. Embedded in `database.py:run_migrations()` as a new step at the bottom per the project convention.

### `ContentDraft.brief_version` (new column, nullable int)

Snapshot of `ContentBrief.version` at the moment of posting. Lets the cluster page show "this post was generated from brief v3" for each posted draft, so the customer can see strategy evolution. Working drafts leave this `NULL`; on the posting transition we copy the current `cluster.last_brief_id`'s `version`.

### `ContentDraft.posted_url` (new column, nullable string, max 1024)

URL pasted by the customer when marking posted. Today `ContentPost.post_url` exists for some posted-draft variants but the cluster posting flow doesn't reliably write it. Storing it on `ContentDraft` directly removes the indirection and makes the posted pool self-describing.

### `ContentCluster` (no new columns)

Existing `status` field stays but its valid values are tightened: `pending`, `briefing`, `briefing_failed`, `generating`, `generation_partial`, `ready`. The legacy `partial_failed` value is dropped (already marked as legacy in the FE `STATUS_LABEL` map). The cluster card no longer surfaces `status` as a user-facing label — it's an internal field driving the in-flight chip on the working-pool side of the progress bar.

### Migration: eager cluster creation for orphan prompts

Add a migration step that, for every `Prompt` without a corresponding `ContentCluster`, inserts a shell cluster (`status='pending'`, `pillar_mode='none'`, `version=0`). For MSC this backfills 3 clusters (prompts 14, 19, 20).

### Migration: backfill `posted_url` from `ContentPost.post_url`

Best-effort: for every `ContentDraft` with `status='posted'`, copy the most recent `ContentPost.post_url` for that draft into the new `posted_url` column. Drafts without a `ContentPost` row keep `posted_url = NULL`.

### Migration: no backfill of `brief_version` for historical posted drafts

For pre-existing posted drafts, `brief_version` stays `NULL`. The cluster page shows "Generated from earlier brief" instead of a version number in that case. Not worth reconstructing historical brief versions.

## Regen semantics

Three actions. Each has a single sentence of explanation in the UI tooltip; no ambiguity about what gets touched.

| Action | What it does | What it touches | What it never touches |
|---|---|---|---|
| **Regenerate piece** (per platform) | Rewrites the working draft for that platform from the current brief + current evidence pack. | The single working draft row for (cluster, platform). UPSERT keyed on the partial unique index. | Brief, evidence pack, any posted draft, any other platform. |
| **Rewrite all posts** | Rewrites every working draft from the current brief + current evidence pack. | All working drafts for the cluster. Posted drafts untouched. | Brief, evidence pack, posted drafts. |
| **Rebuild cluster** | New brief LLM call, new evidence pack, rewrites every working draft. | Brief (new row, `version++`, `last_brief_id` advances), evidence pack (new), all working drafts. | Posted drafts. |

The bug-fix that drops out of this table:

```python
# clustering_service.regenerate_cluster, line 433 — was:
await db.execute(delete(ContentDraft).where(ContentDraft.cluster_id == cluster.id))

# becomes:
await db.execute(
    delete(ContentDraft).where(
        ContentDraft.cluster_id == cluster.id,
        ContentDraft.status.in_(["draft", "approved", "failed"]),
    )
)
```

The `regenerate_piece` path UPSERTs against the partial unique index (insert with `ON CONFLICT(cluster_id, platform) WHERE status IN ('draft', 'approved', 'failed') DO UPDATE …`). This kills the cluster-4-style duplicate-LinkedIn race — two parallel regen calls now serialize on the unique constraint instead of both inserting.

`BrandContentSettings.enabled` is honored consistently across all three actions, including per-piece regen. `regenerate_piece` gains the same `_enabled_platforms` check and 400s if asked to regenerate a disabled platform.

## Posting transition

The customer pastes a URL into the working-draft slot and clicks "Mark posted." Atomically:

1. `ContentDraft.status: 'draft' → 'posted'`
2. `ContentDraft.posted_at = now()`
3. `ContentDraft.posted_url = <pasted url>`
4. `ContentDraft.brief_version = <current brief version>`
5. New `DraftAttribution` row inserted with `score_at_posting = <current prompt visibility>`, `current_score = score_at_posting`, `delta = 0`, `runs_since_posting = 0`.

The partial unique index now lets a new working draft be created for that platform without conflict (the posted row no longer matches the index's `WHERE` clause). The cluster-detail page's platform slot renders: *"LinkedIn — posted 2026-06-28 → tracking lift. Generate new draft?"* The "Generate new draft" link runs per-piece regen.

There is no "approve" intermediate state in this flow — that field existed for an automation that no longer runs. The cluster posting transition jumps `draft → posted` directly.

## Lift attribution

### The headline number

**Cluster lift = `current_prompt_visibility − score_at_first_posted_draft_for_prompt`.**

Computed live in `routers/clusters.py`:

```python
first_post = (await db.execute(
    select(DraftAttribution)
    .join(ContentDraft, ContentDraft.id == DraftAttribution.draft_id)
    .where(ContentDraft.prompt_id == cluster.prompt_id)
    .order_by(DraftAttribution.id)  # earliest
)).scalars().first()

cluster_lift = (current_visibility - first_post.score_at_posting) if first_post else None
```

Crucially this query joins on `prompt_id`, not on `cluster_id`. Every posted draft for the prompt counts — cluster-sourced, legacy gap-driven, Wikipedia surface. This is the one-line fix that turns cluster 5's card from `—` to `+88pts` for MSC on next page load.

### Why not sum per-row deltas?

If MSC posts LinkedIn in March (+5pts), then Medium in April (+3pts more), then Wikipedia in June (+10pts more), the per-row deltas are each measured against their own `score_at_posting`. Summing them double-counts: the Medium row's baseline already includes the LinkedIn lift, the Wikipedia row's baseline already includes both prior lifts. The honest answer is `current − first_baseline = 18pts`, which is what the cluster lift formula returns.

### Per-post deltas stay, as secondary

Each `DraftAttribution` row still tracks its own delta, surfaced on the cluster page as a per-post breakdown ("LinkedIn post → +3.2pts since posted; Wikipedia post → +10.1pts since posted"). Useful diagnostic; not the headline.

### Regressions

When `cluster_lift` is negative (the score has dropped below the first-post baseline), the cluster card colors it red and the page surfaces a one-line alert: *"Lift turned negative since 2026-04-29. A recent post may have been reverted or competitor content gained ground."* No alert email in this scope — surface only. MSC has two such prompts today (19, 20).

### What we deliberately do NOT do

- No `is_live` toggle on posted drafts. If the customer takes a post down IRL, the score will degrade naturally and the cluster lift will move; that's signal enough at this stage.
- No reattribution if `prompt.text` is edited. Lift continues to accrue against the original prompt_id; the editorial decision to reword a prompt doesn't reset measurement.

## UI surfacing

### Cluster grid (`/content/[brandId]`)

- One card per tracked prompt. Orphan prompts render a pending shell with a "Generate cluster" CTA.
- Card layout: prompt text, composed progress bar (posted ↔ working), cluster lift number, partial-coverage one-liner if applicable, "Push v2" CTA if fully live.
- Status enum chip removed from the card.
- Sort/filter controls stay, but the "Failed" filter is renamed "Needs regeneration" and matches `status IN ('briefing_failed', 'generation_partial')`.

### Cluster detail (`/content/[brandId]/cluster/[clusterId]`)

- Header: prompt text, composed progress bar, cluster lift, last-updated date.
- **Working pool grid**: one card per enabled platform. Posted slots show "Posted [date] → +Xpts. Generate new draft?" Disabled slots show muted "Disabled — enable in Settings" with brand-scoped link.
- **Posted history strip** (new, below working pool): chronological list of all posted drafts for the prompt, including Wikipedia. Each entry: platform chip, posted date, posted URL link, per-post delta, brief version. Read-only.
- The existing Brief and Sources panels stay where they are (Zone 2). Out of scope to reorder for this design.
- The "Push v2" CTA on the detail page is the same `Rebuild cluster` button, just relabeled when the cluster is fully live.

### Per-piece short-form titles

When `extract_title_and_body` returns no title (x, reddit, quora), fall back in this order:
1. First sentence of body, trimmed to 80 chars.
2. `"<Platform> draft for <prompt text>"` (e.g., "X draft for How to raise up to $75M…"), trimmed to 80 chars.

Never `"(untitled)"`. This is a one-function change in `_generate_piece_text`.

## Migration plan

Per project convention, embedded in `database.py:run_migrations()` as new steps at the bottom — never modify existing steps. Steps in order:

1. `ALTER TABLE content_drafts ADD COLUMN brief_version INTEGER NULL;`
2. `ALTER TABLE content_drafts ADD COLUMN posted_url VARCHAR(1024) NULL;`
3a. Pre-flight dedupe of working drafts (described above).
3b. Delete working drafts on currently-disabled platforms (described above).
3c. `CREATE UNIQUE INDEX IF NOT EXISTS uq_cluster_platform_working ON content_drafts(cluster_id, platform) WHERE status IN ('draft', 'approved', 'failed') AND cluster_id IS NOT NULL;`
4. Backfill `posted_url` from latest `ContentPost.post_url` per draft.
5. For every `Prompt` without a `ContentCluster`, insert a shell cluster (`status='pending'`, `pillar_mode='none'`, `version=0`, `created_at=now()`).
6. For every `ContentCluster` with `status='partial_failed'`, set `status='generation_partial'` (drop the legacy value).

Step 3 may fail on first run if existing data violates the new constraint (e.g., cluster 4's duplicate LinkedIn working drafts). Pre-flight (run as step 3a before step 3): for each `(cluster_id, platform)` with multiple working drafts, keep the row with the highest `id` (last inserted) and delete the rest. Step 3b: delete working drafts whose `platform` is currently disabled in `BrandContentSettings` for the cluster's brand — these are stale slots from when the platform was enabled and would otherwise render as orphans. Posted drafts on disabled platforms stay (they're historical facts and still contribute to lift). These are the only destructive migration steps and never touch posted drafts.

## Testing

New tests in `backend/tests/test_clusters.py` (create if not present):

- **Eager cluster creation**: creating a `Prompt` results in a `ContentCluster` shell row. Direct DB assertion.
- **Posted draft inviolability**: post a draft, then run each of the three regen actions, then assert the posted draft row is unchanged and its `DraftAttribution` row survived.
- **Partial unique index**: attempting to insert a second working draft for (cluster, platform) when one already exists raises `IntegrityError`. Attempting to insert a second *posted* draft succeeds.
- **Cluster lift via prompt_id**: post a draft outside the cluster (cluster_id=NULL) for the same prompt; assert the cluster's lift number reflects it.
- **Disabled platform regen rejected**: per-piece regen for a platform with `BrandContentSettings.enabled=0` returns 400.
- **Posting transition**: marking a draft posted writes posted_url, brief_version, posted_at, and creates DraftAttribution with correct score_at_posting.
- **Title fallback**: a generated short-form draft never has `title = '(untitled)'`.

Multi-tenancy isolation tests (other user's cluster invisible) already exist in the broader test suite — covered by existing fixtures, no new tests needed.

## Out of scope (explicit)

- Regen rate limiting or tier-based caps.
- Brief version history UI panel.
- Working-draft attempts stack / history.
- "No longer live" archive toggle on posted drafts.
- Adding Wikipedia to the cluster working pool.
- Reconciling legacy `/content` Drafts page with the cluster surface.
- Email alerts for negative cluster lift (UI surface only).
- Reattribution when `prompt.text` is edited.
- Removing the redundant `Rewrite all posts` action (decision deferred to implementation).
