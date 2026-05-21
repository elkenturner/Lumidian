# Agency Portal Cleanup — Design

**Date:** 2026-05-20
**Surface:** `/agency/*` (staff-only routes inside the main Next.js frontend)
**Goal:** Replace the cluttered cockpit + redundant Today layout with a guided, step-by-step flow.

## Problem

The agency portal has accreted clutter:

- The per-client cockpit (`/agency/clients/[id]`) crams **8 stacked sections** (Tracking, Pipeline, Brand, Documents, Audit, Video, Tasks, Activity) under a fake sticky in-page anchor nav, plus a right-side rail with three unrelated panels (Review Link, Quick Actions, Recent client actions). Nothing tells the operator what to do next.
- The Today page (`/agency`) shows "Your queue" *plus* three columns (Awaiting review / With client / Ready to post) that re-list the same drafts under different statuses. Two overlapping inventories.
- Four routes exist as dead "Coming soon" stubs (`/agency/calendar`, `/agency/opportunities`, `/agency/performance`, `/agency/settings`) — they have no sidebar entry and can't be navigated to.
- Two cockpit sections (Tasks, Activity) and the entire `Video` cockpit section are unused in Ken's actual workflow.
- The 4-pill always-on status row + inline retainer/contact info is visual noise.

The cumulative effect is a portal that *displays* information rather than *directs action*.

## Goal & Scope

**In scope:**

1. Restructure `/agency/clients/[id]` from an 8-section wall into a tabbed layout fronted by a "Next step" shelf.
2. Strip the Today page to a single "Your queue" section.
3. Delete dead routes (`calendar`, `opportunities`, `performance`).
4. Delete unused components (Tasks, Activity, right-side rail).
5. Tighten the client-page header.

**Out of scope:**

- Backend API removal. The `/api/agency/tasks/*`, `/api/agency/.../activity`, and `/api/agency/.../my-queue` endpoints stay (no DB migrations, no removed tables). If they become orphaned after frontend cleanup we deal with them in a follow-up.
- The Clients list table (`/agency/clients`) — already clean.
- The Documents index (`/agency/documents`) — already clean.
- The Video studio route (`/agency/clients/[id]/video`) — kept reachable via a small header link.
- Any redesign of the Pipeline, Tracking, Audit, Brand, or Documents sub-views themselves — they become tab bodies as-is.

## Design

### Sidebar (`AgencySidebar.tsx`)

Nav becomes: **Today / Clients / Documents / Settings**.

`Settings` is currently a `/agency/settings` stub. We add it to the nav (small "Settings" link near the bottom or in the main list) and leave the page minimal but real ("Coming soon" text is fine — it has a path back to it now). It's the only stub that survives.

Footer block (Lumidian app back link, Admin link for admins) is unchanged.

### Today page (`/agency/page.tsx`)

Replace the entire current body with:

```
┌─────────────────────────────────────────────┐
│ Today                                       │
│ {N} active clients · {M} items in your queue│
├─────────────────────────────────────────────┤
│ Your queue ({total})                        │
│   • [Task]  Title    · client · due label   │
│   • [Draft] Title    · status · platform    │
│   ...                                       │
└─────────────────────────────────────────────┘
```

- Reuse `MyQueueSection` as-is (drafts + tasks across clients).
- Drop the three columns (`drafts_to_review`, `awaiting_client`, `approved`). The `agencyToday()` call is no longer needed for rendering — we delete its use here. The endpoint itself stays.
- The summary line uses `MyQueueResponse.drafts.length + MyQueueResponse.tasks.length` for the count.

### Client cockpit (`/agency/clients/[id]`, component `ClientCockpit.tsx`)

#### Header row

One tight line:

```
← All clients
{Client name}                           [Video studio →] [Copy review link]
/{slug}                                 [💵 $X/mo] [status chip ▾] [👤 contact ▾]
```

- **Status chip** replaces the four always-on toggle pills. Click → dropdown with `onboarding / active / paused / churned`. Uses the same `STATUS_COLORS` palette already in `app/agency/clients/page.tsx` for visual consistency.
- **Contact popover** (icon button → small popover) holds `primary_contact_name` + `primary_contact_email`. Inline contact text is removed.
- **Retainer** stays as a small inline chip (`$X/mo` or hidden if null).
- **Video studio link** is a small text link (lucide `Video` icon + "Video studio") that navigates to `/agency/clients/{id}/video`. The standalone video page is untouched.
- **Copy review link** is a small button. Reuses the logic in `ReviewLinkSection.tsx` (provision-if-missing, copy URL to clipboard). `ReviewLinkSection` collapses to a thin button — we either inline it as a tiny `CopyReviewLinkButton` component in the header or shrink the existing one. The current full-card `ReviewLinkSection` is removed from the cockpit.

#### "Next step" shelf

Directly below the header, before the tabs. A single card surfacing **one** action — the highest-priority thing this client needs right now.

Priority order (top wins):

| # | Condition | Card content | CTA |
|---|-----------|--------------|-----|
| 1 | ≥1 draft with `status='draft'` | "{N} draft{s} ready for your review" | "Open Pipeline" → switches to Pipeline tab |
| 2 | ≥1 draft `status='approved'` and not yet sent to client | "{N} draft{s} approved — send to client review" | "Send drafts to client →" opens `SendDraftsToClientModal` |
| 3 | ≥1 draft `status='with_client'` older than 5 days | "{N} draft{s} pending client review for {Y} days" | "Copy nudge message" — uses `nudgeMessageText()` from `agency-helpers.ts` |
| 4 | ≥1 draft `status='client_approved'` not yet posted | "{N} draft{s} client-approved — mark posted" | "Open Pipeline" |
| 5 | Last `TrackingRun.completed_at` for this brand > 14 days ago (or null) | "Tracking hasn't run in {D} days" | "Run tracking" — calls existing `RunTrackingButton` action |
| 6 | Total drafts in flight (any non-terminal status) = 0 | "No drafts in flight" | "Generate drafts" — opens `GenerateDraftButton` flow |
| 7 | Else | "All caught up for {client.name}." | (none) |

The shelf is implemented as a new component `ClientNextStepShelf.tsx` that takes the client's pipeline summary + latest tracking-run timestamp as props. Both pieces are already loaded on the page: pipeline counts via `ClientPipelineTab`'s draft list, and tracking via `LumidianTrackingWidget`. We extract the "latest run" timestamp into a small data hook so the shelf can read it without re-fetching.

To avoid a layered data fetch: the cockpit page already fetches the client via `agencyGetClient(id)`. We add **one** extra call on mount — `agencyListDrafts(brand_id)` — to compute the shelf state (counts per draft status). The latest tracking run timestamp is read from the existing tracking-run list call inside `LumidianTrackingWidget`, lifted to the parent so both the widget and shelf use it (a 1-time `useEffect` in `ClientCockpit`, passed down).

#### Tabs

Five real tabs (radix tabs, same primitive used elsewhere in the app):

| Tab | Body component | Header right-side actions |
|-----|----------------|---------------------------|
| Pipeline (default) | `ClientPipelineTab` | `GenerateDraftButton`, "Send drafts to client" (moved here from rail) |
| Tracking | `LumidianTrackingWidget` + `PromptScoresPanel` | `RunTrackingButton` |
| Audit | `AuditSummaryCard` | (none) |
| Brand | `ClientBrandTab` | (none) |
| Documents | `DocumentList` + `GenerateDocumentButton` slot | "Generate weekly report" (moved here from the inline section header) |

- Default tab: **Pipeline**. URL query param `?tab=pipeline|tracking|audit|brand|documents` so deep links work.
- The sticky in-page anchor nav (`<nav>` with `<a href="#tracking">…</a>`) is removed entirely.
- The 8 `<section>` blocks stacked vertically are removed; their bodies become the tab panels listed above.
- The right-side rail (`ClientQuickActionsRail`) is removed; its actions are absorbed into the tabs / header as noted.

### Deletions

**Frontend components** (verify no remaining importers before deleting):

- `frontend/components/agency/ClientQuickActionsRail.tsx`
- `frontend/components/agency/TaskList.tsx`
- `frontend/components/agency/TaskRow.tsx`
- `frontend/components/agency/AssigneePicker.tsx`
- `frontend/components/agency/ActivityFeed.tsx`
- `frontend/components/agency/RecentActivitySection.tsx`
- `frontend/components/agency/activity-icons.tsx` (only used by `ClientQuickActionsRail` and `ActivityFeed`; verify no other importers)
- `frontend/components/agency/ReviewLinkSection.tsx` (replaced by a much smaller header button; verify no other importers)

**Frontend routes:**

- `frontend/app/agency/calendar/page.tsx`
- `frontend/app/agency/opportunities/page.tsx`
- `frontend/app/agency/performance/page.tsx`

**Frontend API methods in `lib/api.ts`** (delete only if the deleted components were the only callers — verify with grep):

- `agencyListActivity`, `agencyCreateNote`, `agencyUpdateNote`, `agencyDeleteNote`, `agencyListRecentActivity` — were these only used by `ActivityFeed` / `RecentActivitySection`? If yes, remove. If they have other callers, leave.
- `agencyListTasks`, `agencyCreateTask`, `agencyUpdateTask`, `agencyDeleteTask` — same check.
- `agencyToday`, `AgencyTodayResponse`, `AgencyTodayDraft` interfaces — Today page no longer uses these; remove if no other callers.

**Kept** (still used after redesign):

- `NudgePill.tsx` — still used inside `ClientPipelineTab.tsx`.
- `agency-helpers.ts` — still used inside `ClientPipelineTab.tsx` and the new shelf.
- `MyQueueSection.tsx` — Today's only section.
- All tab body components and their helpers.

### Backend

**No backend changes.** The `/api/agency/today`, `/api/agency/tasks/*`, and `/api/agency/.../activity` endpoints continue to exist; they're just no longer called by the frontend. If we want to garbage-collect them, that's a separate follow-up.

## Architecture & file plan

### New files

- `frontend/components/agency/ClientNextStepShelf.tsx` — pure presentational component, computes the shelf state from props and renders the priority-1 card.
- `frontend/components/agency/CopyReviewLinkButton.tsx` — small button version of the review-link provision/copy flow (extracted from `ReviewLinkSection`).

### Edited files

- `frontend/components/agency/AgencySidebar.tsx` — add Settings nav entry.
- `frontend/components/agency/ClientCockpit.tsx` — major restructure (header, shelf, tabs).
- `frontend/components/agency/ClientPipelineTab.tsx` — minor: absorb "Send drafts to client review" CTA into its header (was on the rail).
- `frontend/app/agency/page.tsx` — strip to just `MyQueueSection`.
- `frontend/lib/api.ts` — prune unused exports (see verification step).

### Deleted files (full list above)

## Data flow

The cockpit page (`/agency/clients/[id]/page.tsx`) fetches:

1. `agencyGetClient(id)` → client object (existing)
2. `agencyGetReviewLink(id).catch(null)` → review link URL (existing, used by shelf + header button)
3. `agencyListDrafts(brand_id)` → all drafts for shelf priority computation (new on this page; `ClientPipelineTab` was already calling this — we lift it up so both shelf and Pipeline share state via prop drilling, no second fetch)
4. `agencyListTrackingRuns(brand_id, limit=1)` → latest run timestamp for shelf (already called inside `LumidianTrackingWidget`; we lift the latest-run timestamp into `ClientCockpit` and pass down)

Net effect: same network footprint as today, possibly one fewer call because we deduplicate the drafts fetch between shelf and pipeline.

## Error handling

- Shelf gracefully degrades: if drafts fail to load, render `"All caught up for {client.name}."` rather than an error. The shelf is an affordance, not a critical UI.
- Tab default fallback: if `?tab=` is invalid, default to `pipeline`.
- Status chip dropdown surfaces the existing `agencyUpdateClient` error inline (same behavior as today).

## Testing

Frontend has no unit tests today; verification is by manual smoke. Smoke checklist for the implementer:

1. `/agency` shows only the queue, header, and summary line — no 3-column block.
2. Sidebar shows Today / Clients / Documents / Settings; Settings is reachable.
3. `/agency/calendar`, `/agency/opportunities`, `/agency/performance` 404 (deleted).
4. Open a client with pending drafts → Next-step shelf says "{N} drafts ready for your review", CTA opens Pipeline tab.
5. Open a client where all drafts are sent + tracking ran 20 days ago → shelf says "Tracking hasn't run in 20 days", CTA runs tracking.
6. Open a client with zero drafts → shelf says "No drafts in flight", CTA opens the generate-drafts modal.
7. Status chip dropdown updates client status (covers all 4 statuses).
8. Contact popover shows name + email; clicking outside dismisses.
9. "Video studio →" navigates to existing `/agency/clients/{id}/video` route.
10. "Copy review link" copies the review URL to clipboard.
11. Tab switching works via URL query param (deep link to `?tab=audit` opens Audit tab).
12. `npm run lint` clean.
13. `npm run build` clean.

Backend smoke: `pytest backend/tests/test_agency*.py` still green (no backend code touched, but verify nothing broke via import side-effects).

## Risks & mitigations

- **Risk:** Deleting `agency-todays`'s 3-column data path leaves `agencyToday()` as dead code. **Mitigation:** Verify no other caller before deletion; otherwise leave the function and remove only the Today-page call site.
- **Risk:** Status chip dropdown is a popover — needs accessible keyboard behavior. **Mitigation:** Use Radix `Select` or existing popover primitive — there are precedents elsewhere in the frontend (e.g., the prompt edit menus on `/tracker/[brandId]/profile`).
- **Risk:** Shelf priority-3 ("draft pending {Y} days") depends on a "sent to client at" timestamp on the draft. Need to confirm `ClientDraft` carries this. **Mitigation:** Read the `ClientPipelineTab.tsx` shape during implementation; if the timestamp isn't there, demote priority-3 to "any draft `status='with_client'`" without the day count, and file a follow-up.
- **Risk:** Five tabs is still a lot; could the layout feel narrow on mobile? **Mitigation:** Acceptable for V1 — the cockpit is a staff tool, not a customer page. Mobile responsiveness is best-effort.

## Implementation order

1. Sidebar — add Settings.
2. Today — strip to queue only; verify queue renders.
3. Delete dead stub routes.
4. Build `ClientNextStepShelf.tsx` + the lifted data flow (drafts + latest-run hooks).
5. Build `CopyReviewLinkButton.tsx`.
6. Restructure `ClientCockpit.tsx` — new header, shelf, tabs, default Pipeline.
7. Move "Send drafts to client review" into Pipeline tab header.
8. Delete now-orphan components + run grep to find any remaining importers.
9. Prune `lib/api.ts` exports made orphan by step 8.
10. Smoke checklist.
