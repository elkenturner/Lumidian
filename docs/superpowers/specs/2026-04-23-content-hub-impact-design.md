# Content Hub Impact: Rename Scheduled → Saved, Make Posted Useful

**Date:** 2026-04-23
**Scope:** Frontend + targeted backend. Closes the loop between producing content and seeing its visibility impact without introducing a new chart.

---

## Problem

The Content Hub is a producer view — users write and approve drafts there — but the "did this content work?" story lives three clicks deep in the per-prompt detail page (`/tracker/[brandId]/prompt/[promptId]`) and is effectively invisible from the hub. Specifically:

1. **"Scheduled" is the wrong name.** Nothing auto-schedules; approved drafts just sit waiting for the user to post manually. The label causes repeated confusion.
2. **The Posted tab is inert.** Cards show textual attribution in a small footer, there's no delete button, and no way to navigate from a posted draft to the graph where its impact is actually visualized.
3. **Orphan drafts have no recovery path.** Drafts created from a custom topic (or from an unmatched opportunity) have `prompt_id=null` and can never appear on a prompt-specific graph. There's no UI to attach them after the fact.
4. **No "how this works" explanation.** Attribution uses non-obvious concepts (score at posting, runs since posting, confidence tiers, correlation vs causation) and nothing in the hub explains them.

## Goals

- Rename "Scheduled" → "Saved" everywhere it appears in the UI.
- Make Posted cards useful: whole-card click navigates to the targeting prompt's detail page with the relevant diamond marker highlighted.
- Let users delete posted drafts.
- Give orphan drafts a one-click "Attach to prompt" path at two moments: Mark-as-Posted and any time after.
- Surface a small at-a-glance summary of post-level impact at the top of the Posted tab.
- Add a clear in-product explanation of how impact attribution works.

## Non-Goals

- No brand-level aggregate chart in the content hub. The per-prompt timeline already answers this question with cleaner signal; duplicating it at coarser grain adds confusion and a bad empty state. Revisit once users have post density.
- No auto-attach without user confirmation. Silent fuzzy-matching is a mis-attribution risk.
- No editing or re-drafting posted content.
- No weekly digest / automated impact notifications.

## Current State

- **`ContentDraft` model** (`backend/app/models.py:324`) has `prompt_id: int | None` — already nullable. No migration needed.
- **`DraftAttribution` model** stores `score_at_posting`, `current_score`, `delta`, `runs_since_posting`. Populated by tracking runs. `score_at_posting` is recorded at post time by `update_draft` (`backend/app/routers/content.py:395–406`).
- **`DELETE /api/content/draft/{id}`** (`backend/app/routers/content.py:470`) already cascades to posts and attributions. No backend change to enable delete from Posted — just wire a frontend button.
- **`PUT /api/content/draft/{id}`** (`backend/app/routers/content.py:349`) currently accepts `title`, `content_text`, `status`, `platform_guidelines_applied` — **does not accept `prompt_id`** today. Needs extension.
- **`PromptDetailPage`** (`frontend/app/tracker/[brandId]/prompt/[promptId]/page.tsx`) already renders `PromptImpactTimeline`, which builds `markersByIndex` from `content_events` of type `draft_posted` and handles click-to-expand via `handleMarkerClick`. No deep-link param today.
- **Primary tabs** (`frontend/app/content/page.tsx:2133`): `Visibility Opportunities | Content Drafts (Queue · Scheduled) | Posted`. Sub-tab literal `'scheduled'` drives URL query state and internal naming.
- **Tier caps** come from `GET /api/content/{brand_id}/draft-status` with fields `scheduled_count`, `scheduled_cap`. Internal names stay unchanged.

## Design

### 1. Copy & IA: Rename Scheduled → Saved

Frontend copy change only. Backend field names, DB status values, and API response keys stay as-is for stability.

**Strings to update** (`frontend/app/content/page.tsx` and any other reference):

| Where | Old | New |
|---|---|---|
| Content Drafts sub-tab label | `Scheduled` | `Saved` |
| URL query param for sub-tab | `?tab=scheduled` | `?tab=saved` (accept both during grace period; internal state stays `scheduled`) |
| Help modal bullet | `Scheduled — approved drafts ready to post...` | `Saved — approved drafts ready to post...` |
| Toast / alert copy referencing "scheduled queue" | `Scheduled drafts queue is full...` | `Saved drafts queue is full...` (some already say Saved — finish the rename) |
| Tier cap label in draft-status UI | `{ label: 'Scheduled', count, cap }` | `{ label: 'Saved', count, cap }` |
| `ScheduledCard` component name | `ScheduledCard` | `SavedCard` |
| Any other user-facing mention of "scheduled" | — | "saved" |

**Kept as-is:** DB value `status='approved'`, API fields `scheduled_count`/`scheduled_cap`, backend var names. A follow-up internal rename is explicitly out of scope.

### 2. Posted tab restructure

Apply `impeccable` + `emil-design-eng` during the frontend implementation for polish (hover transitions, motion on the highlight pulse, card feel).

**Summary strip** (new component, above the card grid):

```
N posts · avg ±X.Xpp · best +Xpp (platform, prompt snippet)
M awaiting data · K unattached · [How impact works]
```

- All numbers computed client-side from the existing `postedItems` + `DraftAttribution` rows already fetched via `getDraftAttributions` (hub page already threads these through to each `PostedCard`).
- Gracefully degrades: `0 posts` shows a single muted line ("Posted drafts will appear here with their visibility impact").
- `[How impact works]` is a button that opens the explanation modal (see §6).

**`PostedCard` redesign:**

- **Whole card is a clickable anchor** when `prompt_id` is set → `/tracker/[brandId]/prompt/[promptId]?draft=<id>`. Uses `next/link` for prefetch. `cursor-pointer`, subtle hover elevation.
- **Visual hierarchy (top to bottom):**
  - Top row: platform badge + relative post date + (right-aligned) small icon buttons for Expand content and Delete.
  - **Attribution block — promoted to the card's visual anchor.** The existing `At posting → Now · delta · confidence tier` content moves from the footer into the main body, rendered larger and with more contrast. Awaiting-data state keeps its current muted treatment.
  - Title / content snippet below attribution (single line, truncated).
  - Inline content preview expands on Expand-button click (does not trigger the card-level navigation — use `e.stopPropagation`).
- **Orphan variant** (`prompt_id == null`): card is not clickable; shows a muted line `"No prompt attached — impact not trackable"` where the attribution block would be, plus an `Attach to prompt` button and a Delete button. No hover elevation.
- **Late-attach variant** (orphan that was attached later — detected via `score_at_posting == null` on the attribution but `prompt_id` now set): card is clickable as normal; attribution block renders `— · Now X% · Attached late — baseline unavailable` with the same tier treatment. Click-through still works.

**Layout:** existing card grid unchanged. Summary strip sits immediately above it inside the Posted tab panel.

### 3. Prompt detail page: diamond highlight on deep-link

**File:** `frontend/app/tracker/[brandId]/prompt/[promptId]/page.tsx`

- Import `useSearchParams` from `next/navigation`.
- Read `?draft=<id>` and pass as prop `highlightDraftId?: number` to `PromptImpactTimeline`.

**File:** `frontend/components/PromptImpactTimeline.tsx`

- Accept new optional prop `highlightDraftId?: number`.
- On mount (or when the prop changes), if `highlightDraftId` is set:
  1. Find the `dataIndex` that maps to that draft via `markersByIndex` (walk the existing map).
  2. **If the draft date falls outside the current `timeframe`**, auto-switch `timeframe` to `'all'` so the marker is visible. Run this before step 3.
  3. Call `handleMarkerClick(dataIndex)` to open the expansion panel (reuses existing logic, no new code path).
  4. Trigger a **one-shot pulse** on that diamond: render a ring/glow via a new `highlightIndex` prop passed to the `DraftMarkerLayer` `<Customized>` component. The pulse animation runs ~1.2s (one emit + fade, `emil-design-eng` easing — spring-like out-cubic). After the animation completes, clear the highlight (state flag) but keep the expansion panel open.
- If the draft-id is unknown (e.g., deleted before the user clicked through), no-op silently — existing page state stays intact.

### 4. Orphan matching at "Mark as Posted"

**Goal:** intercept the moment orphan state becomes permanent (post time) and give the user one easy chance to attach a prompt.

**Trigger:** Clicking "Mark as Posted" on a Saved draft with `prompt_id=null` AND the brand has at least one tracked prompt.

**UI:** small modal, rendered alongside existing modals in `ContentHubPage`.

- Title: "Attach to a tracked prompt before posting?"
- Body: one-sentence explanation (links to §6 modal for the full story).
- Top 3 tracked prompts ranked by text similarity (see §4a), each a selectable radio card with:
  - Prompt text
  - Relevance label: "Very relevant" / "Somewhat" / "Loose" — thresholded from the similarity score (see §4a)
- Primary button: "Attach and mark as posted"
- Secondary button: "Skip — post without attaching" (equal visual weight, not hidden)
- Escape / outside-click = Skip (same behavior)

**Flow:**
- **Attach + post:** single `PUT /api/content/draft/{id}` with `{ prompt_id: X, status: 'posted' }`. The handler sets `prompt_id` first, then applies the status transition so the existing `visibility_at_post` snapshot and `_create_draft_attribution` logic see a draft that already has a prompt attached. One round-trip, no sequencing race.
- **Skip:** current single-call flow unchanged (`{ status: 'posted' }`).

**Skip when modal doesn't open:**
- Brand has 0 tracked prompts.
- `prompt_id` is already set.

### 4a. Text similarity scoring

New helper in `backend/app/services/drafting_service.py` (existing module covers prompt-related helpers; co-locate). Function signature:

```python
def rank_prompts_by_similarity(
    draft_text: str,
    prompts: list[Prompt],
) -> list[tuple[Prompt, float]]:
    """Return prompts ranked by text similarity to draft_text, descending."""
```

**Algorithm:** token-overlap (Jaccard on case-folded alphanumeric tokens ≥3 chars, with a small stopword filter). Cheap, deterministic, no LLM call, no external deps. Returns the full list; caller takes top N.

**Thresholds** (applied by the caller, not by the scoring function):
- `score >= 0.35` → "Very relevant"
- `0.15 <= score < 0.35` → "Somewhat"
- `score < 0.15` → "Loose" (still shown if in top 3; or filtered if the top 3 are all `Loose` — then the modal explains no strong match found and still offers the list)

**New endpoint:** `POST /api/content/draft/{id}/prompt-suggestions` → returns top 3 `{ prompt_id, text, score, label }`. Read-only; no state change. Called when opening the orphan modal or the attach-to-prompt popover.

### 5. Attach-to-prompt on orphan Posted cards

For already-posted orphans (user skipped at post time, or the orphan predates this feature).

**UI:** button on orphan Posted cards → popover anchored to the card.

- Top 3 ranked prompts from the new endpoint (§4a), with relevance labels.
- Below the ranked top 3: a scrollable list of all tracked prompts (so the user can pick a non-top match if they know better).
- Primary action: "Attach" — makes a single `PUT /api/content/draft/{id}` call with `{ prompt_id: X }`.

**Backend:**

Extend `UpdateDraftRequest` (`backend/app/schemas.py:376`) to accept `prompt_id: int | None = None` and validate it belongs to a brand owned by the current user.

Extend `update_draft` handler (`backend/app/routers/content.py:349`):

- Accept `prompt_id` in the request body.
- If provided, verify `(prompt.brand_id == draft.brand_id)` and `(prompt.brand.user_id == current_user.id)`; else `400`.
- Assign to draft.
- Log `draft_prompt_attached` analytics event with `{ draft_id, prompt_id, late_attach: draft.status == 'posted' }`.

**Late-attach attribution handling:**

When `update_draft` receives a request that sets `prompt_id` on a draft whose `status` is already `'posted'`:

- **Do not** retroactively populate `score_at_posting`. The whole point of that field is "what was the score at the moment of posting" — we didn't record it, and fabricating it from the closest historical run is worse than honest omission.
- Check for an existing `DraftAttribution` row for this draft. If none exists, create one with `score_at_posting=NULL`, `current_score=NULL`, `delta=NULL`, `runs_since_posting=0`. (Either refactor `_create_draft_attribution` to accept an `allow_null_baseline=True` flag, or add a sibling `_create_late_attach_attribution` helper — the plan picks.)
- The existing tracking-run attribution update already handles null baselines correctly (`tracking_service.py:505–506` guards `delta = new_score - score_at_posting` behind `if attr.score_at_posting is not None`). `current_score` and `runs_since_posting` will update on future runs; `delta` stays `NULL`. No change needed in the tracking service.
- Frontend renders the delta cell as "—" with a tooltip pointing at the §6 explanation.

Posted-card UI for a late-attach draft (covered in §2): attribution block shows `— · Now X% · Attached late — baseline unavailable`. Card is still clickable through to the prompt detail page.

### 6. In-product explanation of how impact works

Currently nothing in the hub explains what the attribution numbers mean. Add a single reusable modal and surface it from two places.

**New component:** `ImpactExplainerModal` (frontend, reuses existing `HelpModal` base).

**Content sections:**

- **What "at posting → now" means.** "At posting" is the brand's overall visibility score at the moment you clicked Mark as Posted. "Now" is the most recent score. The delta is the difference — directional signal, not proof of causation.
- **Confidence tiers.** `Awaiting next report` (0 runs) / `Early data` (1–2 runs) / `Developing` (3–5 runs) / `Established` (6+ runs). More runs = more signal.
- **Correlation, not causation.** Visibility moves for many reasons beyond one piece of content. Treat the delta as a directional hint, not proof. Trends across multiple posts matter more than any single result.
- **Orphan drafts & late-attach.** Drafts without a tracked prompt can't be placed on a per-prompt graph. You can attach a prompt at post time or any time after. Late-attach drafts start tracking from the attach date — historical baseline is unavailable.
- **Where to dig deeper.** Click any posted card to jump to the targeting prompt's detail timeline, where the draft appears as a diamond marker you can click for a side-by-side of the response before and after.

**Surfaces (entry points):**

1. Summary-strip `[How impact works]` button at top of Posted tab (§2).
2. Small info icon beside the attribution block on individual Posted cards (§2), same modal.
3. Hub Help modal (`hubHelpOpen`) — existing bullet list — add one sentence: "Click any posted card to see its visibility impact on the prompt's timeline."

### 7. Delete from Posted

- Add trash icon to `PostedCard` footer. Simple confirm dialog (`confirm()` is acceptable; upgrade to the custom confirm modal used elsewhere if one is nearby).
- Calls existing `DELETE /api/content/draft/{id}`. No backend change.
- Log `draft_deleted_from_posted` event with `{ draft_id, had_attribution: bool, days_since_post }` for visibility into usage.
- On success, optimistically remove from `postedItems` and recompute the summary strip.

## Data & API Summary

| Change | Type | Files |
|---|---|---|
| Extend `UpdateDraftRequest` to accept `prompt_id` | Backend | `backend/app/schemas.py` |
| Validate + apply `prompt_id` in `update_draft` | Backend | `backend/app/routers/content.py` |
| Late-attach attribution branch (no baseline) | Backend | `backend/app/routers/content.py` (inside `update_draft`) |
| New endpoint `POST /api/content/draft/{id}/prompt-suggestions` | Backend | `backend/app/routers/content.py` |
| `rank_prompts_by_similarity` helper | Backend | `backend/app/services/drafting_service.py` |
| Rename Scheduled → Saved (copy) | Frontend | `frontend/app/content/page.tsx` |
| Posted tab summary strip | Frontend | `frontend/app/content/page.tsx` |
| `PostedCard` redesign (whole-card click, attribution promoted, delete, orphan variant) | Frontend | `frontend/app/content/page.tsx` |
| Mark-as-Posted orphan modal | Frontend | `frontend/app/content/page.tsx` |
| Attach-to-prompt popover for posted orphans | Frontend | `frontend/app/content/page.tsx` |
| `?draft=` param on `PromptDetailPage` | Frontend | `frontend/app/tracker/[brandId]/prompt/[promptId]/page.tsx` |
| `highlightDraftId` + pulse on `PromptImpactTimeline` | Frontend | `frontend/components/PromptImpactTimeline.tsx` |
| `ImpactExplainerModal` | Frontend | new file under `frontend/app/content/components/` |
| API typings + helpers for prompt suggestions, prompt attach | Frontend | `frontend/lib/api.ts` |

**No migrations.** `ContentDraft.prompt_id` is already nullable; `DraftAttribution` already supports null baseline fields.

## Testing

**Backend:**

- `update_draft` with valid `prompt_id` attaches; response reflects the change.
- `update_draft` with `prompt_id` for a prompt owned by a different user → 400.
- `update_draft` with `prompt_id` + `status='posted'` in the same call attaches and posts atomically; `visibility_at_post` is snapshotted.
- Late-attach (draft already posted, then `prompt_id` set) does not backfill `score_at_posting`; creates attribution row with null baseline.
- `POST /.../prompt-suggestions` returns top 3 ranked by similarity; labels map to the documented thresholds; orphan-only endpoint (works on any draft regardless of status).
- `DELETE /draft/{id}` on a posted draft cascades `DraftAttribution` and `ContentPost` rows (existing behavior — add an explicit test if not covered).
- `rank_prompts_by_similarity` unit tests: identical texts score 1.0, fully disjoint score 0.0, ordering is correct for mixed cases.

**Frontend (manual):**

- Scheduled → Saved rename visible in every listed surface.
- Posted card: whole-card click navigates to prompt detail with `?draft=<id>`; the matching diamond pulses once and the panel expands. Test with a draft outside the default 90d timeframe — page should auto-switch to `all`.
- Posted card: orphan variant shows the Attach button; attaching updates the card in place and enables the click-through.
- Mark-as-Posted orphan modal appears for orphans, does not appear for drafts with `prompt_id`, does not appear for brands with 0 tracked prompts. Skip works.
- Summary strip numbers match the cards below.
- Impact explainer modal opens from both the strip button and per-card info icon.
- Delete from Posted removes the card and decrements the summary count; attribution cascade verified via refresh.

## Implementation Notes

**Use `impeccable` and `emil-design-eng` for frontend polish:**

- Hover elevation on clickable Posted cards (subtle, not bouncy).
- Pulse animation on the highlighted diamond — one emit + fade, spring-eased, ~1.2s. No repeating loops; attention draw only.
- Modal transitions consistent with existing modals in the hub.
- Summary strip should read like a headline, not a dashboard — a single typographic line with clear separators.

**Follow existing patterns:**

- `useSearchParams` is used elsewhere (see `frontend/app/login/page.tsx` etc.).
- `PromptImpactTimeline` already uses `Customized` for the marker layer — extend that layer rather than adding parallel rendering.
- Keep all hub state in `ContentHubPage`; the new modals/popovers are locally-owned.

## Open Questions

None. All design decisions resolved during brainstorming.
