# Agency Portal Shell + Review Portal v1 — Design

**Date:** 2026-05-11
**Status:** Approved verbally. Author: Claude Code session with Ken.
**Supersedes parts of:** `2026-05-05-agency-portal-mvp-design.md` (the MVP shell — this spec restructures it).

---

## Context

Ken runs a small AI visibility agency on top of Lumidian. He has at least one active client. Current weekly workflow:

1. Generate content drafts (currently Reddit / Quora / Medium)
2. Email a Google Doc to the client
3. Client reviews + emails it back
4. Ken posts manually throughout the week

Pain points (in priority order Ken called out):
- **Drafting** — quality / time
- **Client review loop** — Google Doc + email is friction
- **Posting** — manual on N platforms

He's planning to add LinkedIn, X, the client's blog, an AI YouTube pipeline, and a website AIO audit over time. He's **not** doing auto-posting (one-click-assist for Reddit/Quora is enough). He's **dropping Peec** and using Lumidian's own tracking instead.

This spec designs the **UI shell** to fit all of that — current and future — plus ships the **client review portal** as the first concrete feature occupying it.

## Goals

1. Replace the current 3-tab client detail with a 4-tab structure that holds today's features and tomorrow's.
2. Add a global sidebar with sections for cross-client work (Calendar, Opportunities, Performance, Documents, Settings) — most as routed stubs that future specs fill in.
3. Replace the Peec link on the Overview tab with a Lumidian tracking widget pulled from the existing data.
4. Ship a public, no-login client review portal at `/review/{token}` so the Google Doc loop dies.

## Non-Goals

- Auto-posting on LinkedIn / X / Medium (Ken explicitly does not want this in v1).
- A read-only client-facing dashboard (visibility scores, posted content). Possible v1.1; out of scope here.
- Building out the AIO audit, YouTube pipeline, document generation, or scheduling features — only their UI placeholders ship in this spec.
- Migrating away from `agency_clients.peec_dashboard_url` schema field (kept nullable for legacy).

---

## Information Architecture

### Global sidebar (`/agency/*`)

| Item | Route | Status this spec ships |
|---|---|---|
| Today | `/agency` | Existing screen, expanded (see below) |
| Clients | `/agency/clients` | Existing |
| Calendar | `/agency/calendar` | **Stub** — empty page with "Coming soon" |
| Opportunities | `/agency/opportunities` | **Stub** |
| Performance | `/agency/performance` | **Stub** |
| Documents | `/agency/documents` | **Stub** |
| Settings | `/agency/settings` | **Stub** |
| (footer) Lumidian app | `/dashboard` | Existing toggle |
| (footer) Admin | `/admin` | Existing, admin only |

Stubs render a single-line "Coming in v1.1" placeholder so the nav structure is real and the route resolves. Each stub becomes its own future spec.

### Per-client tabs (`/agency/clients/[id]`)

Current 3 tabs (Overview / Brand & Prompts / Pipeline) compress into 4:

| Tab | Contents this spec | Future fits here |
|---|---|---|
| **Overview** | Retainer, contacts, status buttons, **review-link URL with copy + regenerate**, **Lumidian tracking widget** (last run overall score + 4-model breakdown + last-8-runs sparkline), recent activity feed (last 10 events) | Client comments / unread indicator |
| **Strategy** | Brand profile (existing), prompts (existing), content gaps panel (read existing data) | AIO website audit, internal notes |
| **Content** | Pipeline (existing kanban; statuses extended — see below), this-client review-link summary | Calendar (this client), opportunities filtered to this client, YouTube queue |
| **Reports** | Monthly report list, on-demand "Generate report" button (stub for now), per-client performance summary | Generated documents (audit, SOW), advanced attribution |

### Public surface (no login)

- `/review/{token}` — single-page list of drafts in `awaiting_client` status for one client. Per-draft inline approve / edit / reject.

### Client detail tab map

```
Overview     → "what is this client to me right now?"
Strategy     → "what do they care about + how do we talk about them?"
Content      → "what are we shipping?"
Reports      → "what did we ship + what moved?"
```

This maps to a natural workflow: orient → plan → execute → measure.

---

## Pipeline Status Model

Currently `ContentDraft.status` is `draft / approved / posted` (with `dismissed`). For the agency review loop we need the client's role visible.

**New status flow:**

```
draft → awaiting_client → approved → posted
                       ↘ changes_requested → draft (with client_feedback)
                       ↘ rejected (terminal, with client_feedback)
```

- `draft` — Ken is still working on it (existing)
- `awaiting_client` — ready for client review; appears on review-link page (NEW)
- `changes_requested` — client asked for edits; back in Ken's queue with `client_feedback` text attached (NEW)
- `approved` — client approved; ready for Ken to post (existing, semantics extended)
- `rejected` — client killed it (NEW, distinct from existing staff-driven `dismissed`)
- `posted` — Ken marked posted (existing)
- `dismissed` — staff dismissed (existing, unchanged — used when Ken kills a draft before sending)

### Schema change

Add to `ContentDraft`:

- `client_feedback` (Text, nullable) — the client's edit suggestion or rejection reason
- `client_reviewed_at` (DateTime, nullable) — when client took action

The `status` field is already a free-text VARCHAR(50) so no enum migration needed. New status values are valid in the existing column.

### Pipeline kanban columns (Content tab)

```
[ Draft ] [ Awaiting client ] [ Changes requested ] [ Approved ] [ Posted ]
```

`Rejected` drafts hide by default (toggleable filter).

---

## Client Review Portal

### URL

`https://lumidian.ai/review/{token}` (and `localhost:3002/review/{token}` in dev). The page is part of the existing Next.js frontend, **not** authenticated, gated only by token validity.

### Token model

A new `ClientReviewLink` table:

| Column | Type | Notes |
|---|---|---|
| `id` | int PK | |
| `agency_client_id` | FK AgencyClient unique | one active link per client |
| `token` | str unique indexed | URL-safe random, 32+ chars |
| `created_at` | datetime | |
| `revoked_at` | datetime nullable | when regenerated, old link invalidated |

Regenerating a link: revoke the old row (`revoked_at = now`), insert a new one. Old URLs return 404. No expiry by default — Ken regenerates if it leaks.

Token validation: lookup by token, ensure `revoked_at IS NULL`. Return the `agency_client_id`.

### What the page shows

For the resolved client:
- Header: client name, subtitle "Drafts pending your review — managed by Lumidian Agency"
- For each draft in `awaiting_client` status:
  - Title, platform tag, created date
  - Full draft body (rendered as markdown)
  - 3 buttons: **Approve**, **Request changes**, **Reject**
  - "Request changes" expands a textarea for `client_feedback`
  - "Reject" requires a reason (textarea)

After action:
- Approve → `status = approved`, `client_reviewed_at = now`. Card shows "Approved" badge, stays visible for 24h then disappears.
- Request changes → `status = changes_requested`, `client_feedback = text`, `client_reviewed_at = now`. Card removed from list.
- Reject → `status = rejected`, `client_feedback = reason`, `client_reviewed_at = now`. Removed from list.

Empty state: "Nothing pending right now. Come back when Ken sends you a new batch."

### Rate limiting

Per-token: max 100 actions per hour (prevents abuse if a token leaks before regeneration). Implement using existing `rate_limits` table.

### Backend endpoints (new, public — no auth)

All under a new public router `app/routers/review_public.py`:

- `GET  /api/public/review/{token}` — returns client name + array of pending drafts (id, title, platform, content_text, created_at)
- `POST /api/public/review/{token}/draft/{draft_id}/approve` — sets status, returns 204
- `POST /api/public/review/{token}/draft/{draft_id}/request-changes` — body: `{feedback: str}` (required, 1-2000 chars)
- `POST /api/public/review/{token}/draft/{draft_id}/reject` — body: `{reason: str}` (required, 1-2000 chars)

Each endpoint:
1. Resolve token → agency_client_id (404 if invalid/revoked)
2. Look up draft, verify it belongs to the client's brand AND is in `awaiting_client` status (404 / 409 otherwise)
3. Apply state change

### Backend endpoints (staff — agency router)

Under existing `/api/agency`:

- `POST /api/agency/clients/{id}/review-link` — generate or rotate the client's review link, returns `{token, url}`
- `GET  /api/agency/clients/{id}/review-link` — fetch the current active link, or `null` if none generated yet
- `PATCH /api/agency/drafts/{draft_id}/status` — staff-only state transitions (e.g., promote `draft → awaiting_client` to send to client, or `approved → posted` after Ken posts)

### Notification

When the client approves / requests changes / rejects, write a row to the existing `Notification` table for each agency staff member, type `draft_reviewed`, with link to `/agency/clients/{id}` and a body like *"Acme approved 'Why X matters in Y'"*. Surfaces on Today screen via existing notifications system.

---

## Lumidian Tracking Widget (Overview tab)

Replaces the Peec link section. Pulls from existing `TrackingRun` + `RunModelScore` tables:

- Latest completed run's `overall_score` (large number, e.g. 67%)
- 4 mini-bars: ChatGPT / Claude / Perplexity / Gemini scores from latest `RunModelScore` rows
- Sparkline of last 8 completed runs' `overall_score`
- Link "Open in Lumidian" → `/dashboard?brand={brand_id}` so Ken can dive into the full SaaS view if needed
- Empty state if no runs yet: "No tracking data yet. Run the first scan from Lumidian."

No new endpoints needed — the agency Overview tab can call the existing `/api/dashboard/...` endpoints scoped by `brand_id`.

---

## Today Screen Expansion

Currently shows: drafts to review (just count + list), placeholders for "Scheduled this week" and "Recent activity."

New layout — three real columns:

| Column | Source |
|---|---|
| **Awaiting your review** | All drafts in `draft` or `changes_requested` status across all agency-client brands |
| **Awaiting client review** | All drafts in `awaiting_client` status (with elapsed time since sent) |
| **Approved + ready to post** | All drafts in `approved` status |

Bottom section: "Recent client actions" — last 10 review actions across all clients (approved / requested-changes / rejected), 24h window.

---

## Data Flow Summary

```
[Ken] generates draft in Lumidian agency UI (existing drafting service)
   ↓ status = draft
[Ken] clicks "Send to client review" on a single draft (batch send is a future enhancement)
   ↓ status = awaiting_client
[Client] opens /review/{token}, takes action
   ↓ status = approved / changes_requested / rejected
[Ken] sees notification on Today screen, posts approved drafts manually
   ↓ status = posted (existing flow)
[Lumidian tracker] runs scheduled visibility scans
   ↓ Overview widget + Performance tab + monthly reports show the lift
```

---

## Out of Scope (becomes future specs)

- **Multi-platform posting (auto)** — Ken doesn't want this; not even stubbed.
- **Calendar view** — stub only this spec.
- **Documents/template engine** — stub only this spec.
- **AIO website audit** — stub only.
- **YouTube AI video pipeline** — stub only.
- **Performance/attribution per agency client** — stub only.
- **Client communication beyond review** (chat, comments, files) — out of scope.
- **Client-facing read-only dashboard** — possible v1.1.

---

## Migration Notes

- `ContentDraft` adds two nullable columns: `client_feedback`, `client_reviewed_at`. Idempotent ALTER TABLE.
- New `client_review_links` table (CREATE TABLE IF NOT EXISTS).
- New `awaiting_client`, `changes_requested`, `rejected` values appear in `ContentDraft.status` (no schema change — already free-text VARCHAR).
- Existing draft.status code paths must accept the new values without breaking. Audit `routers/content.py` for switch/match on status; mostly a UI display question.

## Risks

- **Token leak** — anyone with the URL can review. Mitigation: regenerate-on-demand button on Overview tab, no PII beyond client name on the page.
- **Status value sprawl** — using free-text status fields invites drift. Mitigation: define an enum in `app/models.py` (string values only) and import where needed.
- **Notifications spam** — if a batch of 20 drafts gets approved, that's 20 notifications. Ship one-event-per-action in v1; if it becomes noisy, add a 5-min collapse window in v1.1 ("Acme approved 20 drafts").
