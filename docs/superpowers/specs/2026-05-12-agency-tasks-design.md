# Agency Tasks + Assignments — Design

**Date:** 2026-05-12
**Status:** Approved (autonomous mode — Ken delegated). Sub-project B of the agency-portal-OS roadmap.

---

## Context

Sub-project A (activity log) shipped. Sub-project B gives the agency a **work-queue layer**: every meaningful unit of work is owned by someone with a deadline. Without this, when Ken hires a contractor they log in and have no idea what's on their plate.

The work currently consists of two kinds of units:

1. **Drafts** — already have `ContentDraft.assigned_to_user_id` from the MVP. The column exists but no UI surfaces it.
2. **Everything else** — "schedule call with Acme Tuesday," "ask client for stats for the LinkedIn post," "review their G2 listing." Currently lives in Ken's head or scattered tools.

This sub-project adds a generic `AgencyTask` model for #2, surfaces both kinds in a "Your queue" view on Today, and per-client in Strategy.

## Goals

1. New `AgencyTask` model + CRUD endpoints.
2. Reuse the existing `ContentDraft.assigned_to_user_id` field — wire a UI to assign drafts via the existing `PATCH /api/agency/drafts/{id}/assign` endpoint.
3. Today screen gains a "Your queue" section (top of page) combining drafts + tasks assigned to the current user, ordered by due_at then created_at.
4. Per-client task list inside the Strategy tab.
5. Activity log integration: emit `task_created`, `task_assigned`, `task_completed` events.

## Non-Goals

- Comments / discussion on tasks (notes already serve that purpose at the client level).
- Recurring tasks. Manually-created one-offs only.
- Calendar view of tasks (sub-project D will cover scheduling visualizations).
- Sub-tasks / dependencies.
- Time tracking.

## Data Model

### New table: `agency_tasks`

| Column | Type | Notes |
|---|---|---|
| `id` | int PK | autoincrement |
| `agency_client_id` | int FK → `agency_clients(id)` ON DELETE CASCADE | indexed |
| `title` | varchar(255) not null | |
| `description` | text nullable | |
| `status` | varchar(32) not null default 'open' | one of `open`, `in_progress`, `done` |
| `assigned_to_user_id` | int FK → `users(id)` ON DELETE SET NULL, nullable | |
| `due_at` | datetime nullable | |
| `created_by_user_id` | int FK → `users(id)` ON DELETE SET NULL, nullable | |
| `created_at` | datetime indexed | |
| `updated_at` | datetime nullable | |
| `completed_at` | datetime nullable | set when status transitions to done |

Indexes:
- `idx_agency_tasks_client_status` on `(agency_client_id, status, due_at)` — per-client lists
- `idx_agency_tasks_assigned` on `(assigned_to_user_id, status, due_at)` — "Your queue"

### Reused fields

- `ContentDraft.assigned_to_user_id` — already exists; this sub-project surfaces it in UI but does not change the schema.

## Backend API (under `/api/agency`)

| Method | Path | Purpose |
|---|---|---|
| GET | `/clients/{client_id}/tasks?status=&assigned_to=` | List a client's tasks, filterable |
| POST | `/clients/{client_id}/tasks` | Create. Body: `{title, description?, due_at?, assigned_to_user_id?}` |
| PATCH | `/tasks/{task_id}` | Update. Body: any subset of `{title, description, status, due_at, assigned_to_user_id}` |
| DELETE | `/tasks/{task_id}` | Delete a task (hard delete) |
| GET | `/my-queue` | Drafts + tasks assigned to current user. Returns `{drafts: [...], tasks: [...]}`. Drafts filtered to statuses `draft`, `changes_requested`, `approved` (the ones an agent needs to act on). |
| GET | `/staff` | List active agency staff users (for assignment dropdowns). Returns `[{id, name, email}, ...]` |

All require `require_agency_staff`.

### Pydantic schemas

- `AgencyTaskOut` — id, agency_client_id, title, description, status, assigned_to_user_id, assigned_to_name, due_at, created_by_user_id, created_at, updated_at, completed_at
- `AgencyTaskCreate` — title (1-255), description (optional), due_at (optional), assigned_to_user_id (optional)
- `AgencyTaskUpdate` — all fields optional, status validated against the enum
- `MyQueueOut` — `{drafts: [MyQueueDraft], tasks: [AgencyTaskOut]}`. `MyQueueDraft` adds `client_name` + `agency_client_id` for navigation.
- `AgencyStaffOut` — `{id: int, name: str | None, email: str}`

### Activity emissions

- On task create → `task_created` with body `f"Created task '{title}'"`, `related_draft_id=None`. Payload includes `{task_id}`.
- On task update where `assigned_to_user_id` changed → `task_assigned` with body `f"Assigned task '{title}' to {assignee_name or 'unassigned'}"`. Payload includes `{task_id, prev_assignee_id, next_assignee_id}`.
- On task status transition to `done` → `task_completed`.

Extend `services/agency_activity.py` event constants:

```python
EVENT_TASK_CREATED = "task_created"
EVENT_TASK_ASSIGNED = "task_assigned"
EVENT_TASK_COMPLETED = "task_completed"
```

## Frontend

### Components

- `frontend/components/agency/TaskList.tsx` — per-client list with inline composer + edit/delete per row. Accepts `{ clientId, staff }`.
- `frontend/components/agency/TaskRow.tsx` — single task row (extracted from TaskList for testability). Renders title, due date, status pill, assignee, expand for description, edit/delete.
- `frontend/components/agency/AssigneePicker.tsx` — small dropdown that lists staff + "Unassigned"; reused in TaskList AND in the Pipeline kanban for drafts.
- `frontend/components/agency/MyQueueSection.tsx` — the new "Your queue" section on the Today screen.

### Wiring

- **Today screen** (`frontend/app/agency/page.tsx`): `<MyQueueSection />` renders at the TOP of the page (before the existing 3-bucket grid), so the contractor sees their own work first. The existing 3-bucket cross-client view stays — it's the "cockpit" for Ken.
- **Strategy tab** (`frontend/components/agency/ClientStrategyTab.tsx`): add a `<TaskList clientId={...} staff={...}>` section above the existing "Coming soon" placeholder.
- **Pipeline kanban** (`frontend/components/agency/ClientPipelineTab.tsx`): on each draft card, add an `<AssigneePicker>` showing the current assignee, with a dropdown to change. Calls existing `PATCH /api/agency/drafts/{id}/assign`.

### Activity-icons update

Add to `frontend/components/agency/activity-icons.tsx`:
- `task_created` — `ListPlus`
- `task_assigned` — `UserCircle`
- `task_completed` — `CheckCircle2`

### Status pills

| Status | Color (Tailwind) |
|---|---|
| open | bg-slate-500/20 text-slate-300 |
| in_progress | bg-amber-500/20 text-amber-300 |
| done | bg-emerald-500/20 text-emerald-300 |

## Data Flow

```
[Ken] creates a task on a client → emits task_created event
       ↓
[Task lands in Strategy tab + in any assignee's "Your queue"]
       ↓
[Contractor opens Today, sees task in "Your queue"]
       ↓
[Contractor clicks status pill → in_progress, then done]
       ↓
[task_completed event emitted on done → visible in activity feed and Today's recent activity]
```

For drafts, the existing flow stays: drafts get created via the existing content pipeline (Lumidian SaaS or upstream tooling), then surface in Pipeline. Adding an assignee on a draft card emits no event in v1 (the activity log doesn't need to know — the change is reflected immediately in the assignee's Today queue).

## Testing

Backend (`tests/test_agency_tasks.py`):
- Create task → row exists with status open, assignee correct, activity event emitted
- Update task title → row updated, no activity event
- Update task assignee → row updated, task_assigned event emitted with prev/next in payload
- Update task status to done → completed_at populated, task_completed event emitted
- Update task back to in_progress → completed_at cleared (or preserved? — pick: cleared, since it's no longer done)
- Delete task → row gone
- `GET /my-queue` returns drafts + tasks assigned to caller; drafts only in actionable statuses
- `GET /staff` returns active staff users

Frontend: smoke via Playwright at the end.

## Risks / Edge Cases

- **Task without assignee** — supported (`assigned_to_user_id` nullable). Surfaces only in per-client list, not in any "Your queue."
- **Overdue tasks** — UI shows due_at in red if past. No notifications in v1.
- **Deleted user** — `ON DELETE SET NULL` on the FK; task displays "Unassigned" gracefully.
- **Draft assignee changes** — no activity event; intentional (low-signal).

## Out of Scope (future iterations)

- Recurring tasks
- Sub-tasks / dependencies
- Comments on tasks
- Bulk task operations
- Drag-to-reorder priority
- Time tracking
- Calendar view (sub-project D)
