# Agency Cockpit — Playbook Redesign

**Date:** 2026-05-22
**Status:** Approved (brainstorming session with Ken)
**Branch (suggested):** `feat/agency-cockpit-playbook`

---

## Motivation

The agency cockpit (`/agency/clients/[id]`) is meant to be Ken's operating tool for delivering on retainer clients. Today it has three structural problems:

1. **Peec coupling** — the data model and clients table still carry a `peec_dashboard_url` column even though tracking has been pulled in-house. Dead surface area.
2. **Useless "Today" page** — `/agency` renders a `MyQueueSection` (drafts + tasks) that's redundant with what already appears inside each client cockpit, and the underlying `AgencyTask` flow was deprecated in the 2026-05-21 cleanup.
3. **Procedure isn't expressed in the UI** — the agency runs a standard procedure (kickoff → SOW → initial audit → strategy → execution loop with Wikipedia plan + site plan one-offs → monthly reports), but the cockpit doesn't show where a client is in that procedure. The current "Next-step shelf" only inspects drafts + tracking staleness; it has no concept of launch milestones or one-off engagements. Customer-facing deliverables (audit doc, SOW, kickoff doc, plans, reports) live in a separate Documents tab disconnected from the step they document.

We want the cockpit to **be** the procedure — a manual checklist Ken ticks through, with the matching customer-facing document a button-click away from each step, built from live data.

## Goals

- Manual checklist (per Ken's choice over auto-derivation) that records progress through the standard procedure.
- Every customer-facing deliverable generates inline from the step it belongs to, pulling live data.
- Two new deliverables added to fill known gaps: `wikipedia_plan` and `site_plan`.
- Drop the Peec column and the Today page entirely.
- Move document creation out of the global `/agency/documents` surface; documents are created per-client, retrieved per-client.

## Non-goals

- No change to Prospects (`/agency/prospects`), Settings, Tracking widget internals, Audit summary card internals, Brand tab internals, or the global SaaS app.
- No automatic stage inference. Ken explicitly chose manual checklist (Option B from brainstorming).
- No new tables for tasks/activity/queue. Those tables stay (data preservation); only their endpoints are removed.

## Approach (selected: B from brainstorming)

Replace the 5-tab cockpit (Pipeline / Tracking / Audit / Brand / Documents) with a 4-tab cockpit (**Playbook** default / Tracking / Audit / Brand). The Playbook tab is a vertical checklist split into two sections: **Launch** (one-time milestones) and **Engagements** (parallel ongoing work — weekly execution, Wikipedia plan, site plan, reports). Each step carries its own "Generate doc" button so deliverables live next to the step they document.

---

## Data model

### New table — `agency_client_milestones`

```python
class AgencyClientMilestone(Base):
    __tablename__ = "agency_client_milestones"

    id:              int       # pk
    agency_client_id: int      # fk → agency_clients(id), ON DELETE CASCADE, indexed
    kind:            str       # 'kickoff' | 'sow' | 'initial_audit'
                               # | 'strategy_locked' | 'wikipedia_plan' | 'site_plan'
    status:          str       # 'not_started' | 'in_progress' | 'done' | 'skipped'
                               # (default 'not_started')
    started_at:      datetime | None
    target_at:       datetime | None
    completed_at:    datetime | None
    completed_by:    int      | None   # fk → users(id)
    notes:           str      | None

    UNIQUE(agency_client_id, kind)
```

Launch kinds (`kickoff`, `sow`, `initial_audit`, `strategy_locked`) only use `status` + `completed_at` + `completed_by` + `notes`; date fields stay null.

Engagement kinds (`wikipedia_plan`, `site_plan`) use `started_at` + `target_at` + `completed_at` + `status` + `notes` to support the "started X, target Y, in progress" pattern with overdue detection.

Recurring state is **not** persisted here:

- **Weekly execution** state derives from `ContentDraft` rows + the latest `TrackingRun` for the brand (same logic the current `computeNextStep` function uses).
- **Weekly / monthly reports** derive from existing `ClientDocument` rows of kinds `agency_weekly_report` and `monthly_report` — "last generated" is just the most recent row.

### Drops

- `AgencyClient.peec_dashboard_url` column.
- The following dead endpoints (and their schemas):
  - `GET /api/agency/today`
  - `GET /api/agency/my-queue`
  - `PATCH /api/agency/drafts/{draft_id}/assign`
  - `GET /api/agency/clients/{id}/tasks`
  - `POST /api/agency/clients/{id}/tasks`
  - `PATCH /api/agency/tasks/{task_id}`
  - `DELETE /api/agency/tasks/{task_id}`
  - `GET /api/agency/activity/recent`
  - `GET /api/agency/documents/recent`

Tables `agency_tasks` and `client_activity_events` are kept. Only the routes go.

### Migrations (append to `database.py:run_migrations()`)

```sql
CREATE TABLE IF NOT EXISTS agency_client_milestones (
    id INTEGER PRIMARY KEY,
    agency_client_id INTEGER NOT NULL
        REFERENCES agency_clients(id) ON DELETE CASCADE,
    kind VARCHAR(32) NOT NULL,
    status VARCHAR(16) NOT NULL DEFAULT 'not_started',
    started_at DATETIME,
    target_at DATETIME,
    completed_at DATETIME,
    completed_by INTEGER REFERENCES users(id),
    notes TEXT,
    UNIQUE(agency_client_id, kind)
);
CREATE INDEX IF NOT EXISTS ix_agency_client_milestones_client
    ON agency_client_milestones(agency_client_id);

ALTER TABLE agency_clients DROP COLUMN peec_dashboard_url;
```

The `DROP COLUMN` is wrapped in a `try/except` (matching the existing migration pattern) so older SQLite instances don't break startup. Pydantic schemas drop `peec_dashboard_url` in lockstep so the column simply disappears from create/update/out shapes.

---

## API surface

### New endpoints

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/agency/clients/{client_id}/milestones` | Return all 6 milestones for the client. Auto-insert `not_started` rows for any kind that doesn't yet exist, so the response always has length 6. |
| `PATCH` | `/api/agency/clients/{client_id}/milestones/{kind}` | Update `status` / `started_at` / `target_at` / `notes`. When `status` flips to `done`, server auto-sets `completed_at = now()` and `completed_by = current_user.id`. When status flips away from `done`, server clears both. |

Both gated by `require_client_access` (existing per-client authorization dep — admins bypass, assigned staff allowed, others 403).

`AgencyClientMilestoneOut` response shape includes `completed_by_name` (joined from `users`) so the UI doesn't need a second roundtrip to render "completed by Ken".

### Endpoints retained, unchanged

- `POST /api/agency/clients/{client_id}/documents` — generates a document of any registered `kind`. Reused for `wikipedia_plan` and `site_plan` once they're added to the registry. No new doc-generation endpoint.
- `GET /api/agency/clients/{client_id}/documents` — list for the per-client documents history.
- `GET /api/agency/documents/{document_id}/pdf` — PDF download.

---

## Document templates

Both new templates follow the existing `document_engine/` registry pattern (a `Template` instance with a `render()` function, registered in `registry.py`).

### `wikipedia_plan.py` — kind `wikipedia_plan`

Pulls from `WikipediaScan` + `WikipediaCandidate` + `BrandProfile` for the client's brand.

Sections:

1. **Where Wikipedia fits in your AI visibility** — ~120-word boilerplate on Wikipedia as a Tier-1 citation source for ChatGPT / Perplexity / Gemini.
2. **Scan results** — `prompts_searched`, `total_candidates_found`, `candidates_persisted`, `completed_at` from the most recent `WikipediaScan` for the brand.
3. **Recommended targets** — `WikipediaCandidate` rows where `status in ('new', 'drafted')`, ordered by `legitimacy_score` desc, top N. For each: title, URL, score + reasoning, suggested section, current status.
4. **Approach** — neutral-tone narrative. **Conditional LLM rewrite**: if `BrandProfile.publications` is empty, call Claude Haiku to fill in a plausible approach. If populated, use a deterministic templated paragraph that names the publications.
5. **Timeline** — references the milestone's `target_at` if set; otherwise "TBD".

Stub case (no completed scan for the brand): render a short doc explaining the prerequisite ("Run a Wikipedia scan first; we'll have a real plan within 48 hours") with a link to `/wiki/{brand_id}`. The doc generates successfully — it just guides Ken to the prerequisite.

### `site_plan.py` — kind `site_plan`

Pulls from the most recent **completed** `WebsiteAudit` + its `WebsiteAuditFinding` and `WebsiteAuditRecommendation` rows.

Sections:

1. **Current site grade** — overall score + per-category scores (bot access / content / schema / technical), render mode, audit date.
2. **Top fixes** — top 10 `WebsiteAuditRecommendation` rows ordered by `priority_score` desc. For each: title, category, effort, expected impact, affected page or "Site-wide", and the rec body. **No code blocks / paste-ready artifacts** — those stay internal to the Site Audit surface.
3. **llms.txt status** — present + valid / present + needs fixes / missing.
4. **robots.txt — AI bot access** — quoted block + verdict (e.g., "Currently allows GPTBot, ClaudeBot, PerplexityBot").
5. **Timeline** — references the milestone's `target_at` if set; otherwise "TBD".

**No LLM call.** The audit's recommendations were already LLM-rewritten when they were generated; the template is pure assembly. No appendix of artifacts (Ken's explicit call — keep paste-ready JSON-LD / llms.txt / robots snippets internal).

Stub case (no completed audit for the brand): render a short doc explaining the prerequisite with a link to `/site-audit/{brand_id}`.

### Registry wiring

`backend/app/services/document_engine/registry.py`:

```python
TEMPLATES: dict[str, Template] = {
    "audit_initial":        audit_initial.TEMPLATE,
    "sow":                  sow.TEMPLATE,
    "kickoff_checklist":    kickoff_checklist.TEMPLATE,
    "monthly_report":       monthly_report.TEMPLATE,
    "agency_weekly_report": agency_weekly_report.TEMPLATE,
    "wikipedia_plan":       wikipedia_plan.TEMPLATE,   # new
    "site_plan":            site_plan.TEMPLATE,        # new
}
```

PDF rendering uses the existing `pdf_renderer.py` markdown pipeline — no changes.

---

## Cockpit layout

### Tab list

5 tabs → 4 tabs:

- **Playbook** (default)
- **Tracking**
- **Audit**
- **Brand**

Old Pipeline and Documents tabs are removed; their content folds into the Playbook tab and the Brand tab respectively.

### Header (unchanged)

Client name · status chip · retainer chip · contact popover · `Video studio →` link · `Copy review link` button.

The current `ClientNextStepShelf` between header and tabs is **removed** — its single-action surface is replaced by the richer Playbook Weekly execution panel.

### Playbook tab body

```
─── Launch ──────────────────────────────────────────────────────
 [✓]  Kickoff             completed 2026-04-12 by Ken            [Generate doc] [↺ undo]
 [✓]  SOW                 completed 2026-04-15 by Ken            [Generate doc] [↺ undo]
 [○]  Initial audit       not started                            [Generate doc] [Mark done]
 [○]  Strategy locked     not started                            [Open Brand → Prompts] [Mark done]

─── Engagements ────────────────────────────────────────────────
 Weekly execution                            (active — 3 items need you)
   • 3 drafts ready for review               [Open Pipeline ↓]
   • 1 approved draft to send to client      [Send drafts]
   • Tracking last ran 18 days ago           [Run tracking now]
   ▾ Pipeline drawer (drafts table inline; only opens when clicked)

 Wikipedia plan                              started 2026-04-20 · target 2026-05-20 · in progress
   12 candidates · 4 drafted · 1 submitted
   [Generate Wikipedia plan doc] [Open Wikipedia surface] [Mark complete]

 Site plan                                   not started
   [Generate site plan doc] [Open Site Audit] [Mark started]

 Reports
   Weekly · last 2026-05-15 by Ken           [Generate this week's report]
   Monthly · last 2026-04-30 by Ken          [Generate this month's report]
```

**Launch rows.** Each is one row: a tick toggle, label, last-completed metadata, and 2 buttons. The "Generate doc" button is always present; clicking it generates the matching template (`kickoff_checklist`, `sow`, `audit_initial`, none for `strategy_locked`) and opens the result in the existing `DocumentViewer`. The "Mark done" / "↺ undo" button toggles `status` between `not_started` and `done` via the PATCH endpoint.

For `strategy_locked`, the secondary button links to `Brand → Prompts` (since there's no doc template — strategy is captured by the prompts + competitors themselves).

**Weekly execution panel.** `computeNextStep` returns a single discriminated action; the Playbook surface needs to show all relevant actions at once. So we keep the underlying *counting* (`NextStepDraftCounts` + `computeDaysStaleTracking`) but **drop** the single-action selection. The panel renders each candidate row independently, showing it only when the corresponding count is non-zero:

- drafts ready for review (count, button to expand the Pipeline drawer)
- approved drafts to send to client (count, button opens `SendDraftsToClientModal`)
- tracking staleness (days since last run, button = `RunTrackingButton`)

The Pipeline drawer opens inline below the Weekly execution panel — it embeds the existing `ClientPipelineTab` component verbatim. No new pipeline component is written; we just relocate the existing one.

**Wikipedia plan / Site plan panels.** Each shows the milestone's `started_at` / `target_at` / `status`, plus a small live-data summary block (Wikipedia: candidate counts from `WikipediaCandidate`; Site plan: top-recommendation count + audit score from `WebsiteAudit`). Three actions: generate the matching doc, open the underlying SaaS surface (`/wiki/{brand_id}` or `/site-audit/{brand_id}`), and a status toggle (`Mark started` / `Mark complete`).

**Reports panel.** Two rows: weekly and monthly. Each shows the most recent `ClientDocument` of that kind ("last generated 2026-05-15 by Ken") and a generate button. The weekly generator is the existing `agencyGenerateWeeklyReport`; the monthly hits the same `POST /clients/{id}/documents` endpoint with `kind='monthly_report'`.

### Other tabs

- **Tracking** — unchanged. `RunTrackingButton` + `LumidianTrackingWidget` + `PromptScoresPanel`.
- **Audit** — unchanged. `AuditSummaryCard`.
- **Brand** — `ClientStaffPanel` + `ClientBrandTab` + a new **Documents history** section at the bottom. The history is a read-only list of all `ClientDocument` rows for this client (reuses the existing `DocumentList` component), so docs generated from anywhere in the Playbook can be re-opened later.

---

## Frontend changes

### New components

| File | Purpose |
|---|---|
| `frontend/components/agency/PlaybookTab.tsx` | Top-level orchestrator. Fetches milestones, drafts, latest run, latest weekly + monthly doc; composes the section components below. |
| `frontend/components/agency/PlaybookLaunchRow.tsx` | One launch milestone row (tick + label + metadata + 2 buttons). Generic over the 4 launch kinds. |
| `frontend/components/agency/PlaybookEngagement.tsx` | One engagement panel (Wikipedia plan / Site plan). Generic — takes a kind + a "summary fetcher" + a deep-link URL. |
| `frontend/components/agency/PlaybookWeeklyExecution.tsx` | Multi-row weekly state panel; embeds the Pipeline drawer. Replaces the single-action `ClientNextStepShelf`. |
| `frontend/components/agency/PlaybookReports.tsx` | Two-row weekly / monthly report panel. |

### Changed components

| File | Change |
|---|---|
| `frontend/components/agency/ClientCockpit.tsx` | Tab list rewritten to 4 tabs; `ClientNextStepShelf` removed; Pipeline + Documents tab contents folded into Playbook; default tab is `playbook`. |
| `frontend/components/agency/ClientBrandTab.tsx` | Append read-only Documents history section using existing `DocumentList`. |
| `frontend/components/agency/AgencySidebar.tsx` | Drop the `Today` and `Documents` nav entries. Order: Clients (home) · Prospects · Settings. |
| `frontend/app/agency/clients/page.tsx` | Drop the Peec column from the clients table. |
| `frontend/lib/api.ts` | Drop `agencyMyQueue` / `MyQueueResponse` / `MyQueueDraft` / `agencyRecentDocuments` / `AgencyDocumentWithClient` / `peec_dashboard_url` from `AgencyClient` types. Add `agencyListMilestones`, `agencyUpdateMilestone`, `AgencyClientMilestone` type, `MilestoneKind` literal union. |

### Deleted files

- `frontend/app/agency/page.tsx` — Today page. Replaced by a redirect to `/agency/clients`.
- `frontend/app/agency/documents/page.tsx` — global Documents page.
- `frontend/components/agency/MyQueueSection.tsx`
- `frontend/components/agency/ClientNextStepShelf.tsx`
- `frontend/components/agency/GenerateForAnyClientModal.tsx`

### Routes

- `/agency` → replace `app/agency/page.tsx` with a component that immediately calls `redirect('/agency/clients')` from `next/navigation` (server-side redirect on hit). Old bookmarks to `/agency` end up on `/agency/clients`.
- `/agency/documents` → 404 (file deleted).
- `/agency/clients/[id]` → defaults to `?tab=playbook`. Existing `?tab=pipeline` and `?tab=documents` URLs server-side redirect to `?tab=playbook` so external links don't 404.

---

## Failure modes

- **`wikipedia_plan` with no scan** — render a stub doc telling Ken to run a scan; include the deep link. Document is still saved so Ken can find it later.
- **`site_plan` with no completed audit** — same pattern.
- **Milestone PATCH races** — last write wins. Two staff updating the same client milestone at once is rare enough that we don't add optimistic concurrency; the second write just overwrites. If a UI conflict ever shows up we add an `updated_at` check.
- **LLM call in `wikipedia_plan`** — wrapped in try/except. On failure, fall back to the deterministic templated paragraph (the same one we'd use if publications were populated). Doc generation never blocks on LLM availability.
- **Peec column drop on older SQLite** — `ALTER TABLE ... DROP COLUMN` wrapped in try/except per existing migration pattern. If the drop fails the column stays; the schemas already ignore it, so the orphan column is harmless.

---

## Testing

### Backend

**New: `backend/tests/test_agency_milestones.py`** — ~8 tests:

1. First GET auto-creates 6 milestones with status `not_started`.
2. PATCH `status='done'` auto-sets `completed_at` + `completed_by`.
3. PATCH `status='done'` then `status='in_progress'` clears `completed_at` + `completed_by`.
4. PATCH on an engagement kind accepts `started_at` + `target_at`.
5. Unknown `kind` in the URL returns 422 (validated against the kind enum).
6. Unassigned non-admin staff hitting GET or PATCH returns 403 (uses existing `require_client_access`).
7. Admin bypass works on both endpoints.
8. Auto-created rows are cleaned by the existing `truncate_tables` test fixture without leaking between tests (add `agency_client_milestones` to the truncation list in `conftest.py`).

**New: `backend/tests/test_agency_document_templates.py`** — ~6 tests:

1. `wikipedia_plan` renders when a completed scan + candidates exist (asserts core sections appear, no LLM call mocked needed when publications populated).
2. `wikipedia_plan` stub-renders with guidance message when no scan exists.
3. `wikipedia_plan` triggers LLM call when `BrandProfile.publications` is empty (mock `llm_service`).
4. `wikipedia_plan` falls back to deterministic paragraph when LLM call raises.
5. `site_plan` renders when a completed audit + recommendations exist (asserts top fixes appear, asserts **no** fenced code blocks in the output).
6. `site_plan` stub-renders when no completed audit exists.

**Updates to existing tests:**

- `test_agency_client_access.py` — remove `peec_dashboard_url` assertions; add 2 cases hitting the milestone endpoints to confirm the assignment check.
- Any test that creates a client with `peec_dashboard_url=...` — strip the field. Grep target: `backend/tests/test_agency*.py`.
- Tests for the removed endpoints (`/today`, `/my-queue`, `/tasks/*`, `/activity/recent`, `/documents/recent`) — delete.

### Frontend

No frontend tests exist in this repo. Verification is `tsc --noEmit` clean plus a manual smoke pass:

1. `/agency` redirects to `/agency/clients`.
2. `/agency/clients` table has no Peec column.
3. Client cockpit opens on Playbook by default.
4. Tick a launch milestone; reload; tick persists; "completed by Ken" appears.
5. Generate `kickoff_checklist`, `sow`, `audit_initial`, `wikipedia_plan`, `site_plan`, `monthly_report`, `agency_weekly_report` from the Playbook tab; each opens in the DocumentViewer; PDF download works.
6. Set a `target_at` on Wikipedia plan; reload; date persists; overdue styling triggers when target is in the past.
7. Pipeline drawer opens inline below Weekly execution; all existing draft actions work.
8. Brand tab shows the previously generated docs in the history section.
9. `/agency/documents` URL 404s.
10. Old `?tab=pipeline` and `?tab=documents` URLs redirect to `?tab=playbook`.

---

## Out-of-scope (explicit)

- Auto-derivation of milestone status. Ken explicitly chose manual.
- New tables for tasks / activity / queue — the existing tables stay; only their routes go.
- Customer-facing artifact appendix in `site_plan` — paste-ready artifacts stay internal.
- Multi-staff concurrency safety on milestone PATCH — last write wins is acceptable.
- Prospects flow changes.
- Global SaaS app changes outside of removing the `peec_dashboard_url` from `AgencyClient`.

---

## Verification before completion

Before declaring this done:

- `pytest backend/tests/test_agency*.py` green, including the new `test_agency_milestones.py` and `test_agency_document_templates.py`.
- `cd frontend && npx tsc --noEmit` clean.
- `cd frontend && npm run build` clean.
- Manual smoke pass items 1–10 above each visibly pass in the browser.
- Updated `CURRENT_STATE.md` with the work summary.
