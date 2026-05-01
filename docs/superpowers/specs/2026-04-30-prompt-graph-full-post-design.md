# Prompt-Impact Graph: Show Full Posted Draft

**Status:** Approved
**Date:** 2026-04-30
**Owner:** Ken
**Scope:** Single-PR fix to the prompt-details chart so users can read the full posted draft when they click a marker.

## Problem

The `PromptImpactTimeline` chart on the prompt-detail view shows a diamond marker on the day a draft was posted. Clicking the marker opens a panel below the chart listing each posted draft (platform, date, delta). To actually read the post body, the user has to click a *second* affordance (a chevron on each row) — and even then the body is silently truncated to 1000 characters by the backend (`backend/app/routers/results.py:627`).

Symptoms users report:

1. They click the marker, see only platform + date + delta, and don't realize a body is hidden behind a chevron.
2. When they do find the chevron, long posts (Medium articles, multi-paragraph Reddit posts) are cut off mid-sentence with no indication of truncation.
3. There is no link to the live post on Reddit / Quora / Medium even when the user supplied a URL via "Mark as Posted".

## Goal

When the user clicks a marker tied to a single posted draft, the full untruncated body is visible immediately, with a link to the live post when one exists. No second chevron click. (Markers that bundle multiple posts on one day keep their current collapsed-by-default behavior so the panel doesn't render several walls of text at once.) No new chart visualizations, no attribution overlays — just close the loop on what was already half-built.

## Non-goals

- Visualizing visibility-impact bands, before/after shading, or attribution markers on the chart itself. (The data exists in `ContentAttribution` and `DraftAttribution` but rendering it is a separate design.)
- Renaming the `content_preview` field to `content_full`. The field already exists across backend, schema, and frontend — a rename would be a drive-by churn.
- Rich preview of the post on the marker hover tooltip.
- Modifying how multi-platform attribution is calculated.

## Design

### Backend changes

**File:** `backend/app/routers/results.py` (around line 615–630, inside the per-prompt-detail endpoint that builds `PromptDraftSnapshot` objects).

1. **Uncap the content body.** Replace `content_preview=d.content_text[:1000] if d.content_text else ""` with `content_preview=d.content_text or ""`. The endpoint returns 1–3 snapshots per prompt in typical usage, so payload bloat is bounded — even a 5,000-word Medium article is well under 50 kB.
2. **Add `post_url`.** LEFT JOIN `ContentPost` on `ContentPost.draft_id == ContentDraft.id` and surface `ContentPost.post_url` on the snapshot. Most drafts will have one `ContentPost` row when the user hits "Mark as Posted"; if multiple exist (rare — re-posts), take the most recent by `posted_at`. Null is acceptable (manual mark-as-posted does not require a URL).

**File:** `backend/app/schemas.py` — `PromptDraftSnapshot` schema gains:

```python
post_url: str | None = None
```

Field stays named `content_preview` to avoid a wider rename. A short comment in the schema documents that this is the full body, not a preview.

### Frontend changes

**File:** `frontend/components/PromptImpactTimeline.tsx`

1. **Auto-expand single-draft case.** `DraftExpansionRow` currently calls `useState(false)`. Change the initial value so that when the parent panel contains a single draft, the row is expanded by default. The chevron remains as a collapse affordance. For multi-draft panels (`expandedDraft.drafts.length > 1`), keep the current collapsed-by-default behavior so the panel doesn't dump several walls of text at once.
2. **Constrain body height with internal scroll.** Wrap the `<p>` rendering `draft.content_preview` in a container with `max-h-96 overflow-y-auto` so a long Medium article scrolls inside the panel rather than pushing the chart off-screen. Existing styles (`bg-[rgba(255,255,255,0.02)]`, padding) carry over to the wrapper.
3. **Add "View on [platform]" link.** When `draft.post_url` is non-null, render a small inline link in the row header (next to the platform/date/delta row), using the `ExternalLink` lucide icon. Match the visual pattern from `DraftCard.tsx:275-286` for consistency.

**File:** `frontend/lib/api.ts` — TypeScript `PromptDraftSnapshot` type gains optional `post_url?: string | null`.

### Data flow (end to end)

```
[click marker]
  → expandedDraft state set to { drafts: PromptDraftSnapshot[] }
  → panel renders, with rows auto-expanded if single
  → row shows: platform • date • delta • [View on platform ↗]
  → expanded body shows full content_text in a max-h-96 scrollable area
```

### Edge cases

| Case | Behavior |
|---|---|
| `content_text` is empty/null | Existing `&& draft.content_preview` guard at line 529 keeps the body container hidden. Header row still renders. |
| No `ContentPost` row (legacy "marked posted" entries) | `post_url` is null; "View on …" link is not rendered. Body still expands. |
| Multiple `ContentPost` rows for one draft | Backend selects the most recent by `posted_at`. |
| Very long content (10k+ chars) | Renders inside `max-h-96 overflow-y-auto`. Chart layout is unaffected. |
| Multiple drafts posted on the same date | Panel header reads "N Posted Drafts". Rows stay collapsed-by-default. User clicks a chevron to expand any individual row. |

### Risk

- Payload size: a single prompt with three Medium articles posted could push ~15 kB of body text into the response. Acceptable — the response already carries score history and run metadata of similar size, and this endpoint is only hit on demand.
- Frontend regression: auto-expand behavior changes the initial render of the panel. Smoke check: click a marker that has one draft (auto-expands), click a marker that has two drafts (collapsed), confirm collapse-back works in both cases.

## Verification (manual)

After the change is deployed locally:

1. Open the prompt-detail page for a prompt that has at least one posted draft.
2. Click the diamond marker — the panel below the chart shows the platform/date/delta row *with the body already visible* and (if a URL was supplied) a "View on [platform] ↗" link.
3. The body container scrolls internally if content is long; the chart does not move.
4. Click the chevron — body collapses; click again — re-expands.
5. For a marker tied to multiple drafts on the same day, the panel opens with rows collapsed (existing behavior preserved).
6. Click "View on …" — opens the live post in a new tab.

No automated tests today (frontend has none per `CLAUDE.md`). Backend change is small enough that the smoke check above plus a quick sanity read of the `/results/{brand}/prompt/{prompt}/detail` JSON response is sufficient.

## Out-of-scope follow-ups

- Render before/after visibility bands on the chart using `ContentAttribution.visibility_before` / `visibility_after`.
- Add a hover tooltip on the diamond showing the post title before the user clicks.
- Rename `content_preview` → `content_full` everywhere as a cleanup pass.
