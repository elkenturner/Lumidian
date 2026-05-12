# Agency Client Activity Log + Notes — Design

**Date:** 2026-05-12
**Status:** Approved verbally. First of 7 sub-projects in the agency-portal-OS roadmap (see `2026-05-11-agency-portal-shell-design.md` for the surrounding shell).

---

## Context

The agency portal MVP shipped a 4-tab client detail (Overview / Strategy / Content / Reports) and 5 routed stubs (Calendar, Opportunities, Performance, Documents, Settings) inside the existing Lumidian Next.js app. To make this a real agency operating system for Ken + 1–2 contractors, the next foundational piece is a per-client activity log.

Without it:
- An employee opening a client has no idea what's happened recently
- Monthly reports have no timeline to assemble from
- Ken's notes about a client live in scattered places (Google Docs, email, head)

With it:
- Every meaningful agency action writes an immutable event
- Ken and contractors can drop notes inline, attributed and timestamped
- Future Documents engine reads the event stream to populate report timelines
- Today screen surfaces cross-client activity at a glance

This sub-project is **foundation** — most other sub-projects (Documents, Performance, Calendar) will read from or write to this stream.

## Goals

1. One append-only event table per agency client, keyed by `event_type`.
2. Notes are a special event type, editable and deletable by author only.
3. Centralized emission helper invoked from existing agency-portal code paths, plus a manual note endpoint.
4. Per-client activity feed on the Overview tab (composer + reverse-chronological list).
5. Cross-client "Recent activity" section on the Today screen.

## Non-Goals

- Notifications (already exist as a separate concern; events do not push notifications themselves).
- Lumidian-wide system events (tracking runs, opportunities, gaps). Those live in their own surfaces; only agency-portal-originated events land here.
- Attachments on notes (text/Markdown only in v1).
- Rich-text editor (plain textarea input; Markdown rendered on display).
- Filtering / search across the feed (chronological only in v1).
- Audit-grade immutability — notes are editable; only system events are immutable in v1. SOX-grade audit trail is out of scope.

## Data Model

### New table: `client_activity_events`

| Column | Type | Notes |
|---|---|---|
| `id` | int PK | autoincrement |
| `agency_client_id` | int FK → `agency_clients(id)` ON DELETE CASCADE | indexed |
| `event_type` | varchar(64) | one of the values below; indexed for `(agency_client_id, event_type)` |
| `actor_user_id` | int FK → `users(id)` ON DELETE SET NULL, nullable | null = system event (no human originator) |
| `body` | text not null | human-readable summary or full note body |
| `payload` | text nullable | optional JSON-encoded structured details |
| `related_draft_id` | int FK → `content_drafts(id)` ON DELETE SET NULL, nullable | so a row can link back to its draft |
| `created_at` | datetime indexed | |
| `updated_at` | datetime nullable | bumped only when a note's body is edited |

**Indexes:**
- `idx_client_activity_events_client_created` on `(agency_client_id, created_at DESC)` — primary read path (per-client feed)
- `idx_client_activity_events_recent` on `(created_at DESC)` — cross-client recent feed

### `event_type` values (v1)

| Value | When emitted | Body example | Payload |
|---|---|---|---|
| `note` | manual via API | "Client wants to focus on B2B SaaS positioning" | none |
| `client_created` | `agency.py:create_client` | "Created client Acme Co" | none |
| `client_status_changed` | `agency.py:update_client` when status changes | "Status changed: onboarding → active" | `{"prev": "onboarding", "next": "active"}` |
| `draft_sent_to_client` | `agency.py:update_draft_status` when transitioning to `awaiting_client` | "Sent 'Title' to client review" | none |
| `draft_marked_posted` | `agency.py:update_draft_status` when transitioning to `posted` | "Marked 'Title' as posted" | none |
| `review_link_generated` | `agency.py:rotate_review_link` (first link) | "Generated client review link" | none |
| `review_link_rotated` | `agency.py:rotate_review_link` (revokes prior) | "Rotated client review link" | none |
| `client_approved` | `review_public.py:approve_draft` | "Client approved 'Title'" | none |
| `client_changes_requested` | `review_public.py:request_changes` | "Client requested changes on 'Title'" | `{"feedback": "..."}` |
| `client_rejected` | `review_public.py:reject_draft` | "Client rejected 'Title'" | `{"reason": "..."}` |

Future event types (`document_generated`, etc.) will slot in without schema changes.

### Schema cleanup

The unused `client_notes` table (created in the agency portal MVP but never wired up) is dropped via a `DROP TABLE IF EXISTS` migration step. No data loss; table is empty.

## Centralized Emission Helper

New service module `backend/app/services/agency_activity.py`:

```python
async def emit_event(
    db: AsyncSession,
    *,
    agency_client_id: int,
    event_type: str,
    body: str,
    actor_user_id: int | None = None,
    payload: dict | None = None,
    related_draft_id: int | None = None,
) -> ClientActivityEvent:
    """Insert an event row. Caller is responsible for committing the transaction."""
```

- Caller `db.add()`s the returned object via the helper; the helper does not call `commit()`. This lets the caller bundle the event into the same transaction as the state mutation that triggered it.
- `body` is pre-formatted; the helper does not template. Keeps callers explicit and lets us change wording without service-layer migrations.
- `payload` is JSON-serialized to a `text` column at write time. No structural validation; payloads are loose per event type.

## Backend API

All under `/api/agency` (existing router):

| Method | Path | Purpose |
|---|---|---|
| GET | `/clients/{client_id}/activity?limit=50&before={event_id}` | Reverse-chronological feed for one client. Cursor pagination via `before` (return events with `id < before`). Default limit 50, max 100. |
| POST | `/clients/{client_id}/activity/note` | Body `{body: str}` (1–10000 chars). Creates a note event with current user as actor. Returns the event. |
| PATCH | `/activity/{event_id}/note` | Body `{body: str}`. Edits a note's body. 403 if event is not type `note`, or current user is not the author. Sets `updated_at`. |
| DELETE | `/activity/{event_id}/note` | Author-only delete. 403/404 same rules. Hard delete (no soft-delete column in v1). |
| GET | `/activity/recent?limit=10` | Cross-client feed, only events from last 7 days. Each event includes `client_id` + `client_name` for the Today screen. |

All endpoints require `is_agency_staff` (existing dependency).

### Pydantic schemas

- `ActivityEventOut` — id, agency_client_id, event_type, actor_user_id, actor_name (denormalized at read time), body, payload (parsed dict or None), related_draft_id, created_at, updated_at
- `ActivityEventWithClientOut` — extends `ActivityEventOut` with `client_id`, `client_name` for the recent feed
- `NoteCreate` — `{body: str = Field(min_length=1, max_length=10000)}`
- `NoteUpdate` — same shape

## Frontend

### `ActivityFeed` component (`frontend/components/agency/ActivityFeed.tsx`)

Takes props `{ clientId: number }`. Renders:
- A composer at top: textarea + "Post note" button. Submit POSTs the note, optimistic-prepends to local state.
- A list of events below: icon (per event_type) + body + relative timestamp + author name.
- Note rows owned by the current user show "Edit" + "Delete" affordances.
- Inline edit: clicking Edit swaps the body for a textarea + Save / Cancel buttons.
- "Load older" button at the bottom — fetches the next page via cursor.

Icons:
- `note` — pencil
- `client_*` (client_approved / changes / rejected) — check / arrow-left-right / x
- `draft_sent_to_client` — send
- `draft_marked_posted` — globe
- `review_link_*` — link
- `client_status_changed` / `client_created` — refresh / plus

Markdown is rendered for the body if a Markdown renderer is already available in the frontend; otherwise plaintext + preserved line breaks is acceptable for v1.

### `RecentActivitySection` component (`frontend/components/agency/RecentActivitySection.tsx`)

Takes no props. Calls `GET /activity/recent`. Renders the same icon + body + timestamp + client-name link. Read-only; no composer, no edit/delete.

### Wiring

**Client Overview tab** (`frontend/components/agency/ClientOverviewTab.tsx`): append `<ActivityFeed clientId={client.id} />` at the bottom, below the retainer/contact grid.

**Today screen** (`frontend/app/agency/page.tsx`): append a 4th section below the existing 3 columns containing `<RecentActivitySection />`. Heading: "Recent activity across clients".

## Data Flow

```
[Ken or contractor] takes action in /agency/*
   ↓
[Existing handler in agency.py or review_public.py] mutates state + calls emit_event()
   ↓
[agency_activity.emit_event()] adds ClientActivityEvent row in same DB transaction
   ↓
[Caller commits] both mutation + event row land atomically
   ↓
[ActivityFeed component] polls / refetches → renders new event
```

For client actions on the public review page (no auth), the actor is null (system event). The body wording is the only signal of who acted ("Client approved 'Title'").

## Testing

Backend (extends `tests/test_agency.py` + new `tests/test_agency_activity.py`):

- Create note → row exists with current user as actor, event_type `note`
- Edit note → updated_at bumped, body updated; non-author gets 403
- Delete note → row gone; non-author gets 403
- Patch + delete on non-note event types → 403
- GET feed paginates: 60 events, 50 returned first call, `before` cursor returns the rest
- Status change emits `client_status_changed` with payload
- Public review approve emits `client_approved` (actor null)
- Recent activity endpoint only returns last-7d events

Frontend: no test suite exists in this repo; smoke verification via Playwright.

## Risks / Edge Cases

- **High write volume on busy clients** — if a single status update triggers a cascade of state changes, multiple events fire. Mitigation: only emit one event per public-facing state transition (e.g., approve emits one event, not one-per-mutation). Acceptable to live with for v1.
- **Note edit race** — two staff edit the same note at once; last write wins. Acceptable for v1 (no contractors yet).
- **Payload schema drift** — JSON payloads are unvalidated. Mitigation: keep payload usage shallow (the frontend never deeply destructures); only `feedback` and `reason` strings rendered.
- **Event volume on the recent feed** — the cross-client feed could include hundreds of events per week. Mitigation: limit to 10 in UI, 7-day window. If this becomes noisy, drop low-signal events (e.g., `review_link_rotated`) from the recent feed query.

## Migration Notes

- `CREATE TABLE IF NOT EXISTS client_activity_events ...` — additive, no risk
- `DROP TABLE IF EXISTS client_notes` — removes the unused MVP table. Empty in prod (never wired up). Safe.
- Two indexes (`client_created`, `recent`) — created idempotently
