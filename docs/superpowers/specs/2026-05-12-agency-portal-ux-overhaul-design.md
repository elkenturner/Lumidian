# Agency Portal UX Overhaul — Design

**Date:** 2026-05-12
**Status:** Approved verbally. Builds on shell + activity log + tasks + documents (all live in prod).

---

## Context

The first wave of agency-portal work shipped the structural pieces: shell, activity log, tasks, document engine. Using it for real exposed friction:

1. **Two sidebars compete.** Main Lumidian nav (Dashboard / Reports / Content / Settings / Account / Agency / Admin) renders alongside the agency sidebar.
2. **The review link is buried.** Three clicks deep (sidebar → client → Overview tab → section).
3. **"Send to client review" is not obvious.** The button exists on each draft card but doesn't read as an important action.
4. **Today screen is too dense.** Three buckets + Your queue + Recent activity = visual noise.
5. **Stub pages waste nav.** Calendar / Opportunities / Performance / Settings are placeholders.
6. **Per-client tabs hide stuff.** Switching tabs to find one piece of info adds friction.
7. **Doc generation is per-client-only.** Should be possible from a global place too.
8. **Peec references linger** despite tracking living in Lumidian.
9. **No nudge for stale drafts.** Drafts can rot in `awaiting_client` indefinitely.
10. **No pre-filled "send to client" copy.** Ken writes the same Slack/email message every week.

This spec collapses the portal into a single-cockpit-per-client model with a quick-actions rail, drops stub clutter, scrubs Peec, and adds opt-in "nudge" + pre-filled send copy.

## Goals

1. One sidebar on `/agency/*`. Hide the outer Lumidian shell.
2. Trim global nav to live items only: Today / Clients / Documents. Drop Calendar / Opportunities / Performance / Settings from the sidebar.
3. Replace the per-client 4-tab page with a single scrolling cockpit page + sticky right rail.
4. Compress Pipeline kanban from 5 columns to 3.
5. Surface the review link on the right rail of every client's cockpit + on the Clients table (one-click copy).
6. Pre-filled "send to client" message dialog when batch-sending drafts.
7. Stale-draft nudge pill on Today + cockpit when a draft has been with the client >3 days.
8. Global Documents page gets a "Generate" picker (client + template).
9. Remove Peec from the New Client dialog and all surfacing copy.
10. Drop Recent Activity from Today (per-client activity stays on the cockpit).

## Non-Goals

- Backend schema changes (the existing models already support everything).
- Auto-posting or auto-scheduling (Ken explicitly doesn't want this).
- Public review page enhancements (deferred — separate sub-project).
- Pre-built nudge auto-send (we draft text; Ken still sends it manually).
- Quick-switcher (Cmd+K) — deferred until 3+ clients exist.
- Monthly-report batch generation — deferred.

---

## 1. Global layout — single sidebar on `/agency/*`

When the user is anywhere under `/agency/*`, hide the main Lumidian `<Sidebar>` (the one with Dashboard / Reports / etc.). Render only the `<AgencySidebar>` plus the main content area.

**Implementation:** The existing `AppShell` (or whatever the global layout wrapper is) currently always renders the main `<Sidebar>`. We detect the `/agency` path prefix in `AppShell` and conditionally render only the children (no sidebar). The agency layout then provides its own.

The current "Lumidian app" link at the bottom of the agency sidebar still works to get back to `/dashboard`.

**Trim agency sidebar nav to:**
- Today
- Clients
- Documents

Footer (unchanged): Lumidian app, Admin (if `is_admin`).

The four stub routes (`/agency/calendar`, `/agency/opportunities`, `/agency/performance`, `/agency/settings`) stay accessible via direct URL for forward-compat but disappear from nav.

## 2. Per-client cockpit page — replace tabs

Replace the 4-tab structure (`Overview / Strategy / Content / Reports`) with a single scrolling page split into two columns:

**Left column (main content, ~70% width, scrolls):**

Top-of-page header: client name, slug, status pills (clickable to change status), retainer line.

Then stacked cards in order:

1. **Tracking** — Lumidian visibility widget (latest run + 4-LLM bars + sparkline). Existing component, no changes.
2. **Pipeline** — 3-column kanban (see §3). Inline "Send all drafts to client" button at the top.
3. **Brand profile + prompts** — existing components (`ClientBrandTab` content), inline-displayed not behind a tab.
4. **Documents** — list + "Generate" picker. Existing per-client documents UI inlined.
5. **Tasks** — existing `TaskList` from sub-project B.
6. **Activity** — existing per-client `ActivityFeed`.

Each card has an anchor link in the top-of-page nav (sticky strip): `Tracking · Pipeline · Brand · Documents · Tasks · Activity`. Click jumps to anchor.

**Right column (sticky rail, ~30% width, stays in viewport):**

1. **Review link** card (always at top). Shows: URL in code box, Copy, Rotate. "Open page" link (opens in new tab).
2. **Quick actions:**
   - **Send drafts to client review** — opens a modal listing drafts in `draft` or `changes_requested` status; user picks which to send; on submit, batch-transitions them to `awaiting_client` AND opens a "Copy this message" textarea with pre-filled text (see §5).
   - **Generate document** — dropdown of 4 templates → fire request → opens viewer (existing flow).
3. **Recent client actions** — last 5 events filtered to `client_*` event types only (client_approved / changes_requested / rejected). Compact list, no composer. Full activity stays in the left-column Activity card.

**Why a sticky rail instead of more tabs:** the review link and the "Send drafts" action are the most-used affordances. They should never require scrolling. Documents generation is also frequent — same logic.

**Mobile (<768px):** rail moves below the main column. Standard responsive flow.

## 3. Pipeline kanban — 3 columns

Compress the existing 5 columns:

| Column | Includes | Notes |
|---|---|---|
| **Drafting** | `draft`, `changes_requested` | Show `changes_requested` items with an amber "changes requested" sub-badge under the title |
| **With client** | `awaiting_client` | If draft has been in this status >3 days (using `client_reviewed_at IS NULL` + comparing created_at, or use `updated_at` if available), show a "Nudge?" pill |
| **Done** | `approved`, `posted` | Show `approved` with a "Ready to post" green badge; `posted` with a gray "Posted" badge |

`rejected` hidden by default; toggle: "Show rejected".

Per-card actions stay the same:
- Drafting → "Send to client review" button (now individual draft-level button; bulk version on the right rail)
- Done(approved) → "Mark as posted"
- Assignee picker (compact)

## 4. Today screen redesign

Drop "Recent activity across clients." Keep:

1. **Your queue** (top) — existing `MyQueueSection` (your tasks + drafts assigned to you).
2. **Across-client status** — 3-column grid:
   - **Awaiting your review** (status `draft` or `changes_requested`, any client)
   - **With client** (`awaiting_client`, any client) — each row shows the client name as a link, draft title/platform, age. If >3 days, "Nudge?" pill.
   - **Ready to post** (`approved`, any client)

Empty state for the grid: friendly message like "Nothing in flight. Generate some drafts on a client's cockpit."

## 5. "Send drafts to client review" flow

**Trigger:** "Send drafts to client" button on the cockpit's right rail.

**Modal:**
- Title: "Send drafts to {client_name} for review"
- Body: checkbox list of every draft in `draft` or `changes_requested` status for this client. Pre-checked. User can uncheck individuals.
- "Send N drafts" submit button.

**On submit:**
1. Backend: PATCH each draft's status → `awaiting_client` (existing endpoint, looped client-side). Emits `draft_sent_to_client` event per draft.
2. Modal switches to a "Now send this to your client" view with:
   - A pre-filled textarea:
     > Hey {primary_contact_name || "there"},
     >
     > I've got {N} new piece{s} for your review. Take a look and approve, request changes, or reject inline:
     >
     > {review_link_url}
     >
     > Quick turnaround appreciated — happy to iterate.
   - "Copy message" button.
   - "Open review link" button (opens the public URL so Ken can sanity-check what the client sees).
   - "Done" closes the modal.

If no review link exists yet, the modal generates one automatically before showing the message.

## 6. Documents — global generation

`/agency/documents`:

Top of page: a "Generate document" button → modal with two pickers:
1. Client (search-filtered dropdown from `agencyListClients`).
2. Template (one of the 4 registered templates).

Submit → calls existing `agencyGenerateDocument(clientId, kind)` → on 201, opens DocumentViewer with the result.

The existing per-client documents list stays in each client's cockpit (Documents card). Newly-generated docs appear in both the global list and the per-client list.

**Drop the per-client "Reports" tab as a separate concept.** All document UI now lives in either the cockpit Documents card or the global Documents page.

## 7. Peec scrub

- `NewClientDialog.tsx`: remove the "Peec dashboard URL" field. Don't send it on create.
- `ClientOverviewTab.tsx`: already removed in earlier wave — no work needed.
- Schema: keep `agency_clients.peec_dashboard_url` column for now (no migration churn).
- Any remaining copy referencing Peec: scrub.
- Update the placeholder text in `ClientReviewLink` and elsewhere: "Tracking lives in Lumidian directly — no external integration needed."

## 8. Stale-draft "Nudge?" pill

A draft is considered "stale" if `status == 'awaiting_client'` AND age (time since the most recent `client_*` action OR the `draft_sent_to_client` event, whichever is later) > 3 days. Easiest implementation: use `updated_at` on `ContentDraft` as the proxy for "time since last status change," compute age in the frontend.

Render the pill:
- Cockpit Pipeline "With client" column — on the draft card.
- Today's "With client" section — on the row.

Clicking the pill: copies the pre-filled nudge message to clipboard. Nudge text:
> Hey {primary_contact_name || "quick ping"}, the drafts at {link} are still waiting on your review — let me know if you need anything from me to help wrap them up.

## 9. Component / file changes

### Modify

- `frontend/components/AppShell.tsx` (or the equivalent layout wrapper): hide outer Sidebar when pathname starts with `/agency`.
- `frontend/components/agency/AgencySidebar.tsx`: remove 4 stub nav items.
- `frontend/components/agency/NewClientDialog.tsx`: remove Peec dashboard URL field.
- `frontend/app/agency/page.tsx` (Today): remove `RecentActivitySection`; redesign as Your queue + 3-column grid with Nudge pills.
- `frontend/components/agency/ClientPipelineTab.tsx`: compress to 3 columns; add `changes_requested` sub-badge inside Drafting column; add Nudge pill in "With client" column.
- `frontend/app/agency/clients/[id]/page.tsx`: replace tabbed page with single cockpit layout (two-column).
- `frontend/app/agency/documents/page.tsx`: add "Generate document" button + modal with client+template pickers.

### Create

- `frontend/components/agency/ClientCockpit.tsx` — the new top-level page component for `/agency/clients/[id]`.
- `frontend/components/agency/ClientQuickActionsRail.tsx` — the sticky right rail.
- `frontend/components/agency/SendDraftsToClientModal.tsx` — the batch-send flow with pre-filled message.
- `frontend/components/agency/NudgePill.tsx` — small reusable pill component.
- `frontend/components/agency/GenerateForAnyClientModal.tsx` — global doc gen modal (client picker + template picker).

### Delete (or repurpose)

- The 4 tab wrappers (`ClientOverviewTab`, `ClientStrategyTab`, `ClientContentTab`, `ClientReportsTab`) — inline their contents into the cockpit. The underlying sub-components (`LumidianTrackingWidget`, `ClientBrandTab` for brand+prompts, `ClientPipelineTab`, `TaskList`, `ActivityFeed`, `DocumentList`, `GenerateDocumentButton`, `ReviewLinkSection`) stay and are referenced by the cockpit.

### Backend changes

**None.** All UI changes use existing endpoints. The stale-draft computation is done in the frontend from `updated_at`.

(Optional later: a backend `is_stale: bool` flag on draft responses; out of scope for v1.)

## 10. Routing summary (no changes to URL structure, just nav/UI)

| Route | Now | After |
|---|---|---|
| `/agency` | Today, 3 cross-client cols + Recent Activity + Your queue | Today, Your queue + 3 cross-client cols + Nudge pills (no Recent Activity) |
| `/agency/clients` | List | Unchanged |
| `/agency/clients/[id]` | 4 tabs | Single cockpit + sticky rail |
| `/agency/calendar` | Stub | Stays accessible, removed from nav |
| `/agency/opportunities` | Stub | Stays accessible, removed from nav |
| `/agency/performance` | Stub | Stays accessible, removed from nav |
| `/agency/documents` | Cross-client list | + "Generate document" button (modal w/ client + template pickers) |
| `/agency/settings` | Stub | Stays accessible, removed from nav |

## 11. Testing

- No backend test changes (no backend changes).
- Frontend smoke via Playwright covers: outer-sidebar hidden on `/agency`, cockpit renders all sections, right-rail is sticky, "Send drafts" modal opens + pre-filled message renders, "Generate document" from /documents creates a doc.

## Risks

- **Long cockpit page may feel overwhelming initially.** Mitigation: sticky anchor strip at top, each section collapsed to ~screen-height by default, scroll feels snappy.
- **Right rail on narrow screens.** Mitigation: stack below on <1024px viewports.
- **Existing users with bookmarked tab URLs.** None exist; tabs were query-less, so no breakage.

---

## Out of scope (deferred)

- Public review page extras (recent work panel, visibility score for the client to see)
- Cmd+K quick switcher
- Monthly-report batch generation
- Backend `is_stale` flag on draft responses
- Calendar / Opportunities / Performance / Settings real implementations
