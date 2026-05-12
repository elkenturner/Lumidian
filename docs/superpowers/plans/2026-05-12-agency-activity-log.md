# Agency Client Activity Log + Notes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the per-client activity log (system-emitted events + author-managed notes) that powers the Overview-tab feed and the Today-screen recent-activity section, and serves as the foundation for future Documents / Performance sub-projects.

**Architecture:** One new SQLAlchemy model `ClientActivityEvent` backed by a single table. A `services/agency_activity.py` module exposes one helper `emit_event()` that callers invoke inside their existing DB transactions. The agency router and review-public router are modified to call `emit_event()` at 8 emission points. Five new endpoints expose feeds + note CRUD. Frontend gains two components — `ActivityFeed` (per-client, with composer + edit/delete) and `RecentActivitySection` (cross-client read-only) — wired into the existing Overview tab and Today page.

**Tech Stack:** FastAPI 0.115, SQLAlchemy 2.0 async, SQLite (dev) / Postgres (prod), pytest. Next.js 16, React 18, TypeScript, Tailwind.

**Spec:** `docs/superpowers/specs/2026-05-12-agency-activity-log-design.md`

---

## File Structure

### Backend

- **Modify:** `backend/app/models.py` — remove the unused `ClientNote` class; add `ClientActivityEvent` class.
- **Modify:** `backend/app/database.py` — append migration: create `client_activity_events` table, two indexes, drop `client_notes` table.
- **Modify:** `backend/app/schemas.py` — add Pydantic schemas for activity events + note bodies.
- **Create:** `backend/app/services/agency_activity.py` — `emit_event()` helper, event-type constants.
- **Modify:** `backend/app/routers/agency.py` — integrate `emit_event` into 5 existing handlers; add 5 new activity endpoints.
- **Modify:** `backend/app/routers/review_public.py` — integrate `emit_event` into 3 existing handlers.
- **Modify:** `backend/tests/conftest.py` — add `client_activity_events` to truncation list; remove `client_notes`.
- **Create:** `backend/tests/test_agency_activity.py` — tests for the new endpoints + emission.

### Frontend

- **Modify:** `frontend/lib/api.ts` — types + methods for activity feed, post/edit/delete note, recent activity.
- **Create:** `frontend/components/agency/activity-icons.tsx` — small helper exporting `iconForEventType(type)` and `labelForEventType(type)`.
- **Create:** `frontend/components/agency/ActivityFeed.tsx` — per-client feed with composer, edit/delete.
- **Create:** `frontend/components/agency/RecentActivitySection.tsx` — cross-client recent feed (Today screen).
- **Modify:** `frontend/components/agency/ClientOverviewTab.tsx` — append `<ActivityFeed clientId={client.id} />` at bottom.
- **Modify:** `frontend/app/agency/page.tsx` — append `<RecentActivitySection />` as 4th section.

---

## Task 1: Backend model + migration

**Files:**
- Modify: `backend/app/models.py`
- Modify: `backend/app/database.py`

- [ ] **Step 1: Remove unused `ClientNote` class from `models.py`**

In `backend/app/models.py`, find the `ClientNote` class (around line 700) and delete the entire class definition. Confirm no other reference to `ClientNote` exists in `backend/app/` via:

```bash
grep -rn "ClientNote" /Users/ken/Desktop/Lumidian/backend/app
```

Expected: no matches (only the class definition itself was a reference).

- [ ] **Step 2: Add `ClientActivityEvent` class to `models.py`**

Append at the end of `backend/app/models.py`:

```python
class ClientActivityEvent(Base):
    __tablename__ = "client_activity_events"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    agency_client_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("agency_clients.id", ondelete="CASCADE"), nullable=False, index=True
    )
    event_type: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    actor_user_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    body: Mapped[str] = mapped_column(Text, nullable=False)
    payload: Mapped[str | None] = mapped_column(Text, nullable=True)
    related_draft_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("content_drafts.id", ondelete="SET NULL"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, index=True)
    updated_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
```

- [ ] **Step 3: Append migrations in `database.py`**

In `backend/app/database.py`, find the `migrations` list and append at the bottom (just before the closing `]`):

```python
        # 2026-05-12: Agency activity log + notes (sub-project A)
        "DROP TABLE IF EXISTS client_notes",
        """CREATE TABLE IF NOT EXISTS client_activity_events (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            agency_client_id INTEGER NOT NULL REFERENCES agency_clients(id) ON DELETE CASCADE,
            event_type TEXT NOT NULL,
            actor_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
            body TEXT NOT NULL,
            payload TEXT,
            related_draft_id INTEGER REFERENCES content_drafts(id) ON DELETE SET NULL,
            created_at DATETIME,
            updated_at DATETIME
        )""",
        "CREATE INDEX IF NOT EXISTS idx_client_activity_events_client_created ON client_activity_events(agency_client_id, created_at DESC)",
        "CREATE INDEX IF NOT EXISTS idx_client_activity_events_recent ON client_activity_events(created_at DESC)",
```

- [ ] **Step 4: Verify migrations apply**

```bash
cd /Users/ken/Desktop/Lumidian/backend
source venv/bin/activate
python -c "import asyncio; from app.database import create_tables, run_migrations
async def m():
    await create_tables()
    await run_migrations()
    print('OK')
asyncio.run(m())"
```

Expected: prints `OK` with no OperationalError surfaced.

- [ ] **Step 5: Commit**

```bash
git add backend/app/models.py backend/app/database.py
git commit -m "feat(backend): activity event model, drop unused client_notes"
```

---

## Task 2: Pydantic schemas

**Files:**
- Modify: `backend/app/schemas.py`

- [ ] **Step 1: Append schemas to `schemas.py`**

Add at the bottom of `backend/app/schemas.py`:

```python
# ── Agency activity log (2026-05-12) ─────────────────────────────────────────


class ActivityEventOut(BaseModel):
    id: int
    agency_client_id: int
    event_type: str
    actor_user_id: int | None
    actor_name: str | None
    body: str
    payload: dict | None
    related_draft_id: int | None
    created_at: datetime
    updated_at: datetime | None

    model_config = ConfigDict(from_attributes=True)


class ActivityEventWithClientOut(ActivityEventOut):
    client_id: int
    client_name: str


class NoteCreate(BaseModel):
    body: str = Field(min_length=1, max_length=10000)


class NoteUpdate(BaseModel):
    body: str = Field(min_length=1, max_length=10000)
```

- [ ] **Step 2: Verify imports**

```bash
cd /Users/ken/Desktop/Lumidian/backend
source venv/bin/activate
python -c "from app import schemas; print(schemas.ActivityEventOut, schemas.NoteCreate)"
```

Expected: prints two class repr lines, no ImportError.

- [ ] **Step 3: Commit**

```bash
git add backend/app/schemas.py
git commit -m "feat(backend): activity event + note schemas"
```

---

## Task 3: `emit_event` service helper

**Files:**
- Create: `backend/app/services/agency_activity.py`

- [ ] **Step 1: Create the helper module**

```python
"""Centralized helper for emitting client activity events.

Callers invoke emit_event() inside their existing DB transaction; the helper
adds the row to the session but does NOT commit. The caller's commit makes
the state mutation and the event row atomic.
"""
from __future__ import annotations

import json
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from app.models import ClientActivityEvent


# Event type constants — keep in sync with frontend activity-icons.tsx
EVENT_NOTE = "note"
EVENT_CLIENT_CREATED = "client_created"
EVENT_CLIENT_STATUS_CHANGED = "client_status_changed"
EVENT_DRAFT_SENT_TO_CLIENT = "draft_sent_to_client"
EVENT_DRAFT_MARKED_POSTED = "draft_marked_posted"
EVENT_REVIEW_LINK_GENERATED = "review_link_generated"
EVENT_REVIEW_LINK_ROTATED = "review_link_rotated"
EVENT_CLIENT_APPROVED = "client_approved"
EVENT_CLIENT_CHANGES_REQUESTED = "client_changes_requested"
EVENT_CLIENT_REJECTED = "client_rejected"


def _encode_payload(payload: dict[str, Any] | None) -> str | None:
    if payload is None:
        return None
    return json.dumps(payload, separators=(",", ":"), default=str)


async def emit_event(
    db: AsyncSession,
    *,
    agency_client_id: int,
    event_type: str,
    body: str,
    actor_user_id: int | None = None,
    payload: dict[str, Any] | None = None,
    related_draft_id: int | None = None,
) -> ClientActivityEvent:
    """Insert an event row. Caller is responsible for commit()."""
    event = ClientActivityEvent(
        agency_client_id=agency_client_id,
        event_type=event_type,
        actor_user_id=actor_user_id,
        body=body,
        payload=_encode_payload(payload),
        related_draft_id=related_draft_id,
    )
    db.add(event)
    return event
```

- [ ] **Step 2: Verify import**

```bash
cd /Users/ken/Desktop/Lumidian/backend
source venv/bin/activate
python -c "from app.services.agency_activity import emit_event, EVENT_NOTE; print('OK')"
```

Expected: prints `OK`.

- [ ] **Step 3: Commit**

```bash
git add backend/app/services/agency_activity.py
git commit -m "feat(backend): emit_event helper + event type constants"
```

---

## Task 4: Activity endpoints (feed, note CRUD, recent)

**Files:**
- Modify: `backend/app/routers/agency.py`

- [ ] **Step 1: Add imports at top of file**

In `backend/app/routers/agency.py`, add to the existing import block (alphabetize with existing imports):

```python
import json
from typing import Optional
```

```python
from app.models import (
    AgencyClient,
    Brand,
    ClientActivityEvent,
    ClientReviewLink,
    ContentDraft,
    User,
)
from app.schemas import (
    ActivityEventOut,
    ActivityEventWithClientOut,
    AgencyClientCreate,
    AgencyClientOut,
    AgencyClientUpdate,
    DraftAssignIn,
    DraftStatusUpdateIn,
    NoteCreate,
    NoteUpdate,
    ReviewLinkOut,
    TodayDraftOut,
    TodayOut,
)
from app.services.agency_activity import emit_event, EVENT_NOTE
```

(Merge these with the existing import lines — do not duplicate `from app.models import (...)`. Just add the new symbols to the existing tuple. Same for schemas.)

- [ ] **Step 2: Add helper to convert event ORM → response model**

Append to `backend/app/routers/agency.py` after the existing helpers (around the bottom of the file, before the existing endpoint definitions if the helpers are grouped there; otherwise just before the new endpoint definitions):

```python
async def _event_to_out(db: AsyncSession, event: ClientActivityEvent) -> ActivityEventOut:
    actor_name: str | None = None
    if event.actor_user_id is not None:
        actor = await db.get(User, event.actor_user_id)
        actor_name = (actor.name or actor.email) if actor else None
    payload_obj: dict | None = None
    if event.payload:
        try:
            payload_obj = json.loads(event.payload)
        except json.JSONDecodeError:
            payload_obj = None
    return ActivityEventOut(
        id=event.id,
        agency_client_id=event.agency_client_id,
        event_type=event.event_type,
        actor_user_id=event.actor_user_id,
        actor_name=actor_name,
        body=event.body,
        payload=payload_obj,
        related_draft_id=event.related_draft_id,
        created_at=event.created_at,
        updated_at=event.updated_at,
    )
```

- [ ] **Step 3: Add the 5 new endpoints**

Append at the bottom of `backend/app/routers/agency.py`:

```python
@router.get("/clients/{client_id}/activity", response_model=list[ActivityEventOut])
async def list_client_activity(
    client_id: int,
    limit: int = 50,
    before: int | None = None,
    db: AsyncSession = Depends(get_db),
    _user: User = Depends(require_agency_staff),
):
    client = await db.get(AgencyClient, client_id)
    if client is None:
        raise HTTPException(status_code=404, detail="Client not found")
    limit = max(1, min(limit, 100))
    stmt = (
        select(ClientActivityEvent)
        .where(ClientActivityEvent.agency_client_id == client_id)
        .order_by(ClientActivityEvent.id.desc())
        .limit(limit)
    )
    if before is not None:
        stmt = stmt.where(ClientActivityEvent.id < before)
    rows = (await db.execute(stmt)).scalars().all()
    return [await _event_to_out(db, e) for e in rows]


@router.post("/clients/{client_id}/activity/note", response_model=ActivityEventOut, status_code=http_status.HTTP_201_CREATED)
async def post_note(
    client_id: int,
    body: NoteCreate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_agency_staff),
):
    client = await db.get(AgencyClient, client_id)
    if client is None:
        raise HTTPException(status_code=404, detail="Client not found")
    event = await emit_event(
        db,
        agency_client_id=client_id,
        event_type=EVENT_NOTE,
        body=body.body,
        actor_user_id=user.id,
    )
    await db.commit()
    await db.refresh(event)
    return await _event_to_out(db, event)


@router.patch("/activity/{event_id}/note", response_model=ActivityEventOut)
async def edit_note(
    event_id: int,
    body: NoteUpdate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_agency_staff),
):
    event = await db.get(ClientActivityEvent, event_id)
    if event is None or event.event_type != EVENT_NOTE:
        raise HTTPException(status_code=404, detail="Note not found")
    if event.actor_user_id != user.id and not user.is_admin:
        raise HTTPException(status_code=http_status.HTTP_403_FORBIDDEN, detail="Not the author")
    event.body = body.body
    event.updated_at = datetime.utcnow()
    await db.commit()
    await db.refresh(event)
    return await _event_to_out(db, event)


@router.delete("/activity/{event_id}/note", status_code=http_status.HTTP_204_NO_CONTENT)
async def delete_note(
    event_id: int,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_agency_staff),
):
    event = await db.get(ClientActivityEvent, event_id)
    if event is None or event.event_type != EVENT_NOTE:
        raise HTTPException(status_code=404, detail="Note not found")
    if event.actor_user_id != user.id and not user.is_admin:
        raise HTTPException(status_code=http_status.HTTP_403_FORBIDDEN, detail="Not the author")
    await db.delete(event)
    await db.commit()


@router.get("/activity/recent", response_model=list[ActivityEventWithClientOut])
async def list_recent_activity(
    limit: int = 10,
    db: AsyncSession = Depends(get_db),
    _user: User = Depends(require_agency_staff),
):
    from datetime import timedelta

    limit = max(1, min(limit, 50))
    cutoff = datetime.utcnow() - timedelta(days=7)
    stmt = (
        select(ClientActivityEvent, AgencyClient)
        .join(AgencyClient, AgencyClient.id == ClientActivityEvent.agency_client_id)
        .where(ClientActivityEvent.created_at >= cutoff)
        .order_by(ClientActivityEvent.id.desc())
        .limit(limit)
    )
    rows = (await db.execute(stmt)).all()
    results: list[ActivityEventWithClientOut] = []
    for event, ac in rows:
        base = await _event_to_out(db, event)
        results.append(
            ActivityEventWithClientOut(
                **base.model_dump(),
                client_id=ac.id,
                client_name=ac.name,
            )
        )
    return results
```

- [ ] **Step 4: Verify the routes exist**

```bash
cd /Users/ken/Desktop/Lumidian/backend
source venv/bin/activate
python -c "from app.main import app
paths = [str(getattr(r, 'path', '')) for r in app.routes]
for p in paths:
    if '/activity' in p:
        print(p)"
```

Expected output (order may vary):
```
/api/agency/clients/{client_id}/activity
/api/agency/clients/{client_id}/activity/note
/api/agency/activity/{event_id}/note
/api/agency/activity/{event_id}/note
/api/agency/activity/recent
```

(Five routes — the `/note` route appears twice because PATCH and DELETE share it.)

- [ ] **Step 5: Commit**

```bash
git add backend/app/routers/agency.py
git commit -m "feat(backend): activity feed + note CRUD + recent activity endpoints"
```

---

## Task 5: Integrate `emit_event` into existing handlers

**Files:**
- Modify: `backend/app/routers/agency.py`
- Modify: `backend/app/routers/review_public.py`

- [ ] **Step 1: Emit `client_created` in `agency.py:create_client`**

In `backend/app/routers/agency.py`, find the existing `create_client` function. Just before the final `await db.commit()`, insert:

```python
    await emit_event(
        db,
        agency_client_id=client.id,
        event_type="client_created",
        body=f"Created client {client.name}",
        actor_user_id=user.id,
    )
```

- [ ] **Step 2: Emit `client_status_changed` in `agency.py:update_client`**

In `agency.py:update_client`, change the status-tracking logic. Replace the existing body (the line `for field, value in body.model_dump(exclude_unset=True).items()` and the lines after it that mutate the client) so that the status transition is captured:

```python
    prev_status = client.status
    for field, value in body.model_dump(exclude_unset=True).items():
        setattr(client, field, value)
    if body.status == "active" and client.retainer_started_at is None:
        client.retainer_started_at = datetime.utcnow()
    if body.status is not None and body.status != prev_status:
        await emit_event(
            db,
            agency_client_id=client.id,
            event_type="client_status_changed",
            body=f"Status changed: {prev_status} → {body.status}",
            actor_user_id=_user.id,
            payload={"prev": prev_status, "next": body.status},
        )
    await db.commit()
```

Note: the existing dependency is named `_user` (underscore-prefixed) — change it to `user` and remove the underscore so it can be referenced. Update the dependency line from `_user: User = Depends(require_agency_staff)` to `user: User = Depends(require_agency_staff)`. Then use `user.id` instead of `_user.id`.

- [ ] **Step 3: Emit `review_link_generated` / `review_link_rotated` in `agency.py:rotate_review_link`**

In `agency.py:rotate_review_link`, find the loop that revokes existing active links. Track whether any were revoked, and emit one of two event types after committing the new link.

Replace the body around the `for old in existing_q.scalars().all(): old.revoked_at = datetime.utcnow()` block + new_link creation with:

```python
    existing_links = existing_q.scalars().all()
    had_prior_link = len(existing_links) > 0
    for old in existing_links:
        old.revoked_at = datetime.utcnow()
    new_link = ClientReviewLink(
        agency_client_id=client_id,
        token=secrets.token_urlsafe(32),
    )
    db.add(new_link)
    event_type = "review_link_rotated" if had_prior_link else "review_link_generated"
    body_text = "Rotated client review link" if had_prior_link else "Generated client review link"
    await emit_event(
        db,
        agency_client_id=client_id,
        event_type=event_type,
        body=body_text,
        actor_user_id=_user.id,
    )
    await db.commit()
    await db.refresh(new_link)
```

Like Step 2, rename `_user` to `user` in the function signature so it can be referenced. (Or keep `_user` and just use `_user.id`. Either is fine — pick one, be consistent within the function.)

- [ ] **Step 4: Emit `draft_sent_to_client` / `draft_marked_posted` in `agency.py:update_draft_status`**

In `agency.py:update_draft_status`, modify the function to emit when the status transitions to one of the two interesting target states. Replace the body after the `draft.status = body.status` line with:

```python
    prev_status = draft.status if draft else None
    draft.status = body.status
    if body.status == "approved" and draft.approved_at is None:
        draft.approved_at = datetime.utcnow()
    if body.status == "posted" and draft.posted_at is None:
        draft.posted_at = datetime.utcnow()

    # Fetch the brand to find the agency_client_id for the event
    brand = await db.get(Brand, draft.brand_id)
    if brand and brand.agency_client_id is not None:
        title_label = draft.title or f"Draft #{draft.id}"
        if body.status == "awaiting_client" and prev_status != "awaiting_client":
            await emit_event(
                db,
                agency_client_id=brand.agency_client_id,
                event_type="draft_sent_to_client",
                body=f"Sent '{title_label}' to client review",
                actor_user_id=user.id,
                related_draft_id=draft.id,
            )
        elif body.status == "posted" and prev_status != "posted":
            await emit_event(
                db,
                agency_client_id=brand.agency_client_id,
                event_type="draft_marked_posted",
                body=f"Marked '{title_label}' as posted",
                actor_user_id=user.id,
                related_draft_id=draft.id,
            )
    await db.commit()
```

NOTE: the existing handler dependency is `_user: User = Depends(require_agency_staff)`. Rename to `user: User = Depends(require_agency_staff)` here.

`prev_status = draft.status if draft else None` — this captures the status BEFORE the assignment. The line `draft.status = body.status` is from the existing code; ensure `prev_status` is captured **before** that line, not after. The replacement above shows the correct ordering.

- [ ] **Step 5: Emit `client_approved` / `client_changes_requested` / `client_rejected` in `review_public.py`**

In `backend/app/routers/review_public.py`, add at the top of the file (with existing imports):

```python
from app.services.agency_activity import emit_event
```

Then modify the three handlers (`approve_draft`, `request_changes`, `reject_draft`) to call `emit_event` immediately before the existing `await db.commit()`:

In `approve_draft`:
```python
    title_label = draft.title or f"Draft #{draft.id}"
    await emit_event(
        db,
        agency_client_id=client_id,
        event_type="client_approved",
        body=f"Client approved '{title_label}'",
        related_draft_id=draft.id,
    )
    await db.commit()
```

In `request_changes`:
```python
    title_label = draft.title or f"Draft #{draft.id}"
    await emit_event(
        db,
        agency_client_id=client_id,
        event_type="client_changes_requested",
        body=f"Client requested changes on '{title_label}'",
        payload={"feedback": body.feedback},
        related_draft_id=draft.id,
    )
    await db.commit()
```

In `reject_draft`:
```python
    title_label = draft.title or f"Draft #{draft.id}"
    await emit_event(
        db,
        agency_client_id=client_id,
        event_type="client_rejected",
        body=f"Client rejected '{title_label}'",
        payload={"reason": body.reason},
        related_draft_id=draft.id,
    )
    await db.commit()
```

Each replaces the existing `await db.commit()` line. The existing Notification-row inserts (added in the previous task) still happen — those stay; we ADD the activity event alongside.

- [ ] **Step 6: Verify the existing test suites still pass**

```bash
cd /Users/ken/Desktop/Lumidian/backend
source venv/bin/activate
pytest tests/test_agency.py tests/test_review_public.py -v --timeout=60
```

Expected: all 18 existing tests still PASS. If any test fails because it now expects an extra row in `client_activity_events`, that's fine — fix the test (or let Task 6 cover it).

- [ ] **Step 7: Commit**

```bash
git add backend/app/routers/agency.py backend/app/routers/review_public.py
git commit -m "feat(backend): wire emit_event into 8 agency handlers"
```

---

## Task 6: Backend tests

**Files:**
- Modify: `backend/tests/conftest.py`
- Create: `backend/tests/test_agency_activity.py`

- [ ] **Step 1: Update truncation list in `conftest.py`**

In `backend/tests/conftest.py`, find the truncation list (around line 109). Remove `"client_notes"` and add `"client_activity_events"` in alphabetical position with the other agency tables.

Find:
```python
            "client_notes", "client_review_links", "agency_staff",
```

Replace with:
```python
            "client_activity_events", "client_review_links", "agency_staff",
```

- [ ] **Step 2: Create `backend/tests/test_agency_activity.py`**

```python
"""Tests for the agency client activity log + notes."""
from __future__ import annotations

import pytest
from sqlalchemy import func, select

from app.database import AsyncSessionLocal
from app.models import AgencyClient, AgencyStaff, Brand, ClientActivityEvent, ClientReviewLink, ContentDraft, User
from tests.conftest import register_and_login


async def _make_agency_user(client, email: str = "act@example.com") -> None:
    from sqlalchemy import update
    await register_and_login(client, email=email)
    async with AsyncSessionLocal() as db:
        await db.execute(update(User).where(User.email == email).values(is_agency_staff=True))
        await db.commit()


async def _create_client_via_api(client, name: str = "ActCo") -> tuple[int, int]:
    resp = await client.post("/api/agency/clients", json={"name": name})
    assert resp.status_code == 201, resp.text
    body = resp.json()
    return body["id"], body["brand_id"]


@pytest.mark.asyncio
async def test_create_client_emits_event(client, db_session):
    await _make_agency_user(client)
    cid, _ = await _create_client_via_api(client)
    count = (await db_session.execute(
        select(func.count(ClientActivityEvent.id))
        .where(ClientActivityEvent.agency_client_id == cid, ClientActivityEvent.event_type == "client_created")
    )).scalar_one()
    assert count == 1


@pytest.mark.asyncio
async def test_status_change_emits_event(client, db_session):
    await _make_agency_user(client)
    cid, _ = await _create_client_via_api(client)
    resp = await client.patch(f"/api/agency/clients/{cid}", json={"status": "active"})
    assert resp.status_code == 200
    events = (await db_session.execute(
        select(ClientActivityEvent).where(
            ClientActivityEvent.agency_client_id == cid,
            ClientActivityEvent.event_type == "client_status_changed",
        )
    )).scalars().all()
    assert len(events) == 1
    assert "onboarding" in events[0].body and "active" in events[0].body


@pytest.mark.asyncio
async def test_status_unchanged_does_not_emit(client, db_session):
    await _make_agency_user(client)
    cid, _ = await _create_client_via_api(client)
    # Patch without status field
    resp = await client.patch(f"/api/agency/clients/{cid}", json={"retainer_amount_usd": 2500})
    assert resp.status_code == 200
    count = (await db_session.execute(
        select(func.count(ClientActivityEvent.id)).where(
            ClientActivityEvent.agency_client_id == cid,
            ClientActivityEvent.event_type == "client_status_changed",
        )
    )).scalar_one()
    assert count == 0


@pytest.mark.asyncio
async def test_generate_review_link_emits_generated_then_rotated(client, db_session):
    await _make_agency_user(client)
    cid, _ = await _create_client_via_api(client)
    await client.post(f"/api/agency/clients/{cid}/review-link")
    await client.post(f"/api/agency/clients/{cid}/review-link")
    types = [e.event_type for e in (await db_session.execute(
        select(ClientActivityEvent).where(
            ClientActivityEvent.agency_client_id == cid,
            ClientActivityEvent.event_type.in_(("review_link_generated", "review_link_rotated")),
        ).order_by(ClientActivityEvent.id.asc())
    )).scalars().all()]
    assert types == ["review_link_generated", "review_link_rotated"]


@pytest.mark.asyncio
async def test_draft_sent_to_client_emits_event(client, db_session):
    await _make_agency_user(client)
    cid, brand_id = await _create_client_via_api(client)
    draft = ContentDraft(brand_id=brand_id, platform="medium", content_text="x", status="draft", title="Hello")
    db_session.add(draft)
    await db_session.commit()
    await db_session.refresh(draft)
    resp = await client.patch(f"/api/agency/drafts/{draft.id}/status", json={"status": "awaiting_client"})
    assert resp.status_code == 204
    events = (await db_session.execute(
        select(ClientActivityEvent).where(
            ClientActivityEvent.event_type == "draft_sent_to_client",
            ClientActivityEvent.related_draft_id == draft.id,
        )
    )).scalars().all()
    assert len(events) == 1
    assert "Hello" in events[0].body


@pytest.mark.asyncio
async def test_post_note_creates_event(client, db_session):
    await _make_agency_user(client)
    cid, _ = await _create_client_via_api(client)
    resp = await client.post(
        f"/api/agency/clients/{cid}/activity/note",
        json={"body": "Client wants to focus on B2B SaaS"},
    )
    assert resp.status_code == 201
    out = resp.json()
    assert out["event_type"] == "note"
    assert out["body"] == "Client wants to focus on B2B SaaS"
    assert out["actor_user_id"] is not None


@pytest.mark.asyncio
async def test_note_create_validates_length(client):
    await _make_agency_user(client)
    cid, _ = await _create_client_via_api(client)
    resp = await client.post(f"/api/agency/clients/{cid}/activity/note", json={"body": ""})
    assert resp.status_code == 422


@pytest.mark.asyncio
async def test_edit_note_author_only(client, db_session):
    await _make_agency_user(client, email="author@example.com")
    cid, _ = await _create_client_via_api(client)
    post = await client.post(f"/api/agency/clients/{cid}/activity/note", json={"body": "Original"})
    event_id = post.json()["id"]

    edit = await client.patch(f"/api/agency/activity/{event_id}/note", json={"body": "Edited"})
    assert edit.status_code == 200
    assert edit.json()["body"] == "Edited"
    assert edit.json()["updated_at"] is not None


@pytest.mark.asyncio
async def test_edit_non_note_event_404(client, db_session):
    await _make_agency_user(client)
    cid, _ = await _create_client_via_api(client)
    # The client_created event was emitted; try to PATCH it as if it were a note
    sys_event = (await db_session.execute(
        select(ClientActivityEvent).where(
            ClientActivityEvent.agency_client_id == cid,
            ClientActivityEvent.event_type == "client_created",
        )
    )).scalar_one()
    resp = await client.patch(f"/api/agency/activity/{sys_event.id}/note", json={"body": "nope"})
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_delete_note(client, db_session):
    await _make_agency_user(client)
    cid, _ = await _create_client_via_api(client)
    post = await client.post(f"/api/agency/clients/{cid}/activity/note", json={"body": "Delete me"})
    event_id = post.json()["id"]
    resp = await client.delete(f"/api/agency/activity/{event_id}/note")
    assert resp.status_code == 204

    refreshed = await db_session.get(ClientActivityEvent, event_id)
    assert refreshed is None


@pytest.mark.asyncio
async def test_list_activity_paginates(client, db_session):
    await _make_agency_user(client)
    cid, _ = await _create_client_via_api(client)
    # Post 5 notes (plus the client_created from creation = 6 events)
    for i in range(5):
        await client.post(f"/api/agency/clients/{cid}/activity/note", json={"body": f"Note {i}"})

    first = await client.get(f"/api/agency/clients/{cid}/activity?limit=3")
    assert first.status_code == 200
    page1 = first.json()
    assert len(page1) == 3
    # Order: newest first
    assert page1[0]["body"] == "Note 4"

    last_id = page1[-1]["id"]
    second = await client.get(f"/api/agency/clients/{cid}/activity?limit=10&before={last_id}")
    assert second.status_code == 200
    page2 = second.json()
    # Remaining: Note 1, Note 0, client_created = 3
    assert len(page2) == 3
    assert page2[-1]["event_type"] == "client_created"


@pytest.mark.asyncio
async def test_recent_activity_includes_client_name(client, db_session):
    await _make_agency_user(client)
    cid, _ = await _create_client_via_api(client, name="RecentCo")
    await client.post(f"/api/agency/clients/{cid}/activity/note", json={"body": "A note"})

    resp = await client.get("/api/agency/activity/recent?limit=5")
    assert resp.status_code == 200
    events = resp.json()
    assert len(events) >= 1
    # Most recent first
    note_event = events[0]
    assert note_event["client_id"] == cid
    assert note_event["client_name"] == "RecentCo"
    assert note_event["event_type"] == "note"


@pytest.mark.asyncio
async def test_public_review_approve_emits_activity_event(client, db_session):
    from app.database import AsyncSessionLocal as Sess

    await _make_agency_user(client)
    cid, brand_id = await _create_client_via_api(client)
    # Create a token + a draft in awaiting_client status directly
    async with Sess() as db:
        link = ClientReviewLink(agency_client_id=cid, token="acttest-approve")
        db.add(link)
        draft = ContentDraft(
            brand_id=brand_id, platform="medium",
            content_text="x", status="awaiting_client", title="Pub-approve",
        )
        db.add(draft)
        await db.commit()
        draft_id = draft.id

    resp = await client.post(f"/api/public/review/acttest-approve/draft/{draft_id}/approve")
    assert resp.status_code == 204
    events = (await db_session.execute(
        select(ClientActivityEvent).where(
            ClientActivityEvent.event_type == "client_approved",
            ClientActivityEvent.related_draft_id == draft_id,
        )
    )).scalars().all()
    assert len(events) == 1
    assert events[0].actor_user_id is None  # client action — no actor
```

- [ ] **Step 3: Run tests**

```bash
cd /Users/ken/Desktop/Lumidian/backend
source venv/bin/activate
pytest tests/test_agency_activity.py tests/test_agency.py tests/test_review_public.py -v --timeout=60
```

Expected: all tests PASS (13 new in test_agency_activity.py + 10 in test_agency.py + 8 in test_review_public.py = 31 total).

If existing tests fail (e.g., a count assertion that no longer matches because notes/events were emitted as a side effect), update the test to account for the new event row OR scope the assertion more narrowly (e.g., filter by event_type).

- [ ] **Step 4: Commit**

```bash
git add backend/tests/conftest.py backend/tests/test_agency_activity.py
git commit -m "test(backend): activity log + note CRUD + emission integration"
```

---

## Task 7: Frontend API client additions

**Files:**
- Modify: `frontend/lib/api.ts`

- [ ] **Step 1: Append types and methods**

At the end of the agency portal section in `frontend/lib/api.ts` (after the last `public*` function), add:

```typescript
// ── Agency activity log (2026-05-12) ─────────────────────────────────────────

export type ActivityEventType =
  | 'note'
  | 'client_created'
  | 'client_status_changed'
  | 'draft_sent_to_client'
  | 'draft_marked_posted'
  | 'review_link_generated'
  | 'review_link_rotated'
  | 'client_approved'
  | 'client_changes_requested'
  | 'client_rejected';

export interface ActivityEvent {
  id: number;
  agency_client_id: number;
  event_type: ActivityEventType | string;
  actor_user_id: number | null;
  actor_name: string | null;
  body: string;
  payload: Record<string, unknown> | null;
  related_draft_id: number | null;
  created_at: string;
  updated_at: string | null;
}

export interface ActivityEventWithClient extends ActivityEvent {
  client_id: number;
  client_name: string;
}

export async function agencyListActivity(
  clientId: number,
  opts: { limit?: number; before?: number } = {},
): Promise<ActivityEvent[]> {
  const params: Record<string, number> = {};
  if (opts.limit !== undefined) params.limit = opts.limit;
  if (opts.before !== undefined) params.before = opts.before;
  const res = await api.get<ActivityEvent[]>(`/agency/clients/${clientId}/activity`, { params });
  return res.data;
}

export async function agencyPostNote(clientId: number, body: string): Promise<ActivityEvent> {
  const res = await api.post<ActivityEvent>(`/agency/clients/${clientId}/activity/note`, { body });
  return res.data;
}

export async function agencyEditNote(eventId: number, body: string): Promise<ActivityEvent> {
  const res = await api.patch<ActivityEvent>(`/agency/activity/${eventId}/note`, { body });
  return res.data;
}

export async function agencyDeleteNote(eventId: number): Promise<void> {
  await api.delete(`/agency/activity/${eventId}/note`);
}

export async function agencyRecentActivity(limit = 10): Promise<ActivityEventWithClient[]> {
  const res = await api.get<ActivityEventWithClient[]>(`/agency/activity/recent`, {
    params: { limit },
  });
  return res.data;
}
```

- [ ] **Step 2: Type-check**

```bash
cd /Users/ken/Desktop/Lumidian/frontend
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add frontend/lib/api.ts
git commit -m "feat(frontend): agency activity log API methods"
```

---

## Task 8: Activity icons helper

**Files:**
- Create: `frontend/components/agency/activity-icons.tsx`

- [ ] **Step 1: Create the helper**

```tsx
import {
  StickyNote,
  UserPlus,
  RefreshCw,
  Send,
  Globe,
  Link2,
  Check,
  MessageSquare,
  XCircle,
  Circle,
} from 'lucide-react';
import type { ComponentType, SVGProps } from 'react';

type Icon = ComponentType<SVGProps<SVGSVGElement>>;

const ICONS: Record<string, Icon> = {
  note: StickyNote,
  client_created: UserPlus,
  client_status_changed: RefreshCw,
  draft_sent_to_client: Send,
  draft_marked_posted: Globe,
  review_link_generated: Link2,
  review_link_rotated: Link2,
  client_approved: Check,
  client_changes_requested: MessageSquare,
  client_rejected: XCircle,
};

export function iconForEventType(type: string): Icon {
  return ICONS[type] ?? Circle;
}
```

- [ ] **Step 2: Type-check**

```bash
cd /Users/ken/Desktop/Lumidian/frontend
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add frontend/components/agency/activity-icons.tsx
git commit -m "feat(frontend): event-type → icon mapping"
```

---

## Task 9: ActivityFeed component (per-client)

**Files:**
- Create: `frontend/components/agency/ActivityFeed.tsx`

- [ ] **Step 1: Create the component**

```tsx
'use client';

import { useEffect, useState } from 'react';
import {
  agencyDeleteNote,
  agencyEditNote,
  agencyListActivity,
  agencyPostNote,
  type ActivityEvent,
} from '@/lib/api';
import { useAuth } from '@/contexts/AuthContext';
import { iconForEventType } from './activity-icons';

interface Props {
  clientId: number;
}

const PAGE_SIZE = 50;

function timeAgo(iso: string): string {
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  if (diff < 60) return `${Math.floor(diff)}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

interface NoteEditorProps {
  initialBody: string;
  onSave: (body: string) => Promise<void>;
  onCancel: () => void;
}

function NoteEditor({ initialBody, onSave, onCancel }: NoteEditorProps) {
  const [text, setText] = useState(initialBody);
  const [busy, setBusy] = useState(false);
  return (
    <div className="space-y-2">
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={3}
        className="w-full rounded-md border border-[var(--border-default)] bg-[var(--bg-raised)] px-3 py-2 text-sm"
      />
      <div className="flex gap-2">
        <button
          onClick={async () => {
            if (!text.trim()) return;
            setBusy(true);
            try { await onSave(text.trim()); } finally { setBusy(false); }
          }}
          disabled={busy || !text.trim()}
          className="rounded-md bg-[var(--bg-elevated)] px-3 py-1.5 text-xs font-medium text-[var(--text-primary)] hover:bg-[var(--bg-card)] disabled:opacity-50"
        >
          Save
        </button>
        <button
          onClick={onCancel}
          disabled={busy}
          className="rounded-md border border-[var(--border-default)] px-3 py-1.5 text-xs text-[var(--text-secondary)]"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

export function ActivityFeed({ clientId }: Props) {
  const { user } = useAuth();
  const [events, setEvents] = useState<ActivityEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [composer, setComposer] = useState('');
  const [posting, setPosting] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = async (before?: number) => {
    try {
      const next = await agencyListActivity(clientId, { limit: PAGE_SIZE, before });
      setEvents((prev) => (before === undefined ? next : [...prev, ...next]));
      setHasMore(next.length === PAGE_SIZE);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load activity');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    setLoading(true);
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId]);

  const postNote = async () => {
    if (!composer.trim()) return;
    setPosting(true);
    setError(null);
    try {
      const created = await agencyPostNote(clientId, composer.trim());
      setEvents((prev) => [created, ...prev]);
      setComposer('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to post note');
    } finally {
      setPosting(false);
    }
  };

  const saveEdit = async (eventId: number, body: string) => {
    try {
      const updated = await agencyEditNote(eventId, body);
      setEvents((prev) => prev.map((e) => (e.id === eventId ? updated : e)));
      setEditingId(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save edit');
    }
  };

  const deleteNote = async (eventId: number) => {
    try {
      await agencyDeleteNote(eventId);
      setEvents((prev) => prev.filter((e) => e.id !== eventId));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to delete note');
    }
  };

  return (
    <section className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-card)] p-5">
      <h3 className="mb-4 text-sm font-medium text-[var(--text-secondary)]">Activity & notes</h3>

      <div className="mb-4 space-y-2">
        <textarea
          value={composer}
          onChange={(e) => setComposer(e.target.value)}
          placeholder="Add a note…"
          rows={2}
          className="w-full rounded-md border border-[var(--border-default)] bg-[var(--bg-raised)] px-3 py-2 text-sm"
        />
        <div className="flex justify-end">
          <button
            onClick={postNote}
            disabled={posting || !composer.trim()}
            className="rounded-md bg-[var(--bg-elevated)] px-3 py-1.5 text-xs font-medium text-[var(--text-primary)] hover:bg-[var(--bg-card)] disabled:opacity-50"
          >
            {posting ? 'Posting…' : 'Post note'}
          </button>
        </div>
      </div>

      {error && <p className="mb-3 text-sm text-red-400">{error}</p>}

      {loading && <p className="text-sm text-[var(--text-muted)]">Loading…</p>}

      {!loading && events.length === 0 && (
        <p className="text-sm text-[var(--text-muted)]">No activity yet. Post the first note above.</p>
      )}

      <ul className="space-y-3">
        {events.map((event) => {
          const Icon = iconForEventType(event.event_type);
          const isOwnNote =
            event.event_type === 'note' && user?.id != null && event.actor_user_id === user.id;
          const isEditing = editingId === event.id;
          return (
            <li
              key={event.id}
              className="flex gap-3 rounded-md border border-[var(--border-subtle)] bg-[var(--bg-raised)] p-3 text-sm"
            >
              <div className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-[var(--bg-elevated)] text-[var(--text-secondary)]">
                <Icon width={14} height={14} />
              </div>
              <div className="flex-1 min-w-0">
                {isEditing ? (
                  <NoteEditor
                    initialBody={event.body}
                    onSave={(body) => saveEdit(event.id, body)}
                    onCancel={() => setEditingId(null)}
                  />
                ) : (
                  <p className="whitespace-pre-wrap text-[var(--text-primary)]">{event.body}</p>
                )}
                <div className="mt-1 flex items-center gap-2 text-xs text-[var(--text-muted)]">
                  <span>{event.actor_name ?? 'Lumidian'}</span>
                  <span>·</span>
                  <span>{timeAgo(event.created_at)}</span>
                  {event.updated_at && <span>· edited</span>}
                  {isOwnNote && !isEditing && (
                    <>
                      <span>·</span>
                      <button onClick={() => setEditingId(event.id)} className="hover:underline">
                        Edit
                      </button>
                      <span>·</span>
                      <button onClick={() => deleteNote(event.id)} className="hover:underline">
                        Delete
                      </button>
                    </>
                  )}
                </div>
              </div>
            </li>
          );
        })}
      </ul>

      {hasMore && (
        <div className="mt-3 flex justify-center">
          <button
            onClick={() => load(events[events.length - 1]?.id)}
            className="rounded-md border border-[var(--border-default)] px-3 py-1.5 text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-raised)]"
          >
            Load older
          </button>
        </div>
      )}
    </section>
  );
}
```

- [ ] **Step 2: Type-check**

```bash
cd /Users/ken/Desktop/Lumidian/frontend
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add frontend/components/agency/ActivityFeed.tsx
git commit -m "feat(frontend): ActivityFeed component with composer + edit/delete"
```

---

## Task 10: Wire ActivityFeed into Overview tab

**Files:**
- Modify: `frontend/components/agency/ClientOverviewTab.tsx`

- [ ] **Step 1: Import + render the component**

At the top of `frontend/components/agency/ClientOverviewTab.tsx`, add the import:

```tsx
import { ActivityFeed } from './ActivityFeed';
```

At the bottom of the component's returned JSX (just before the final closing `</div>` and just after the `{error && ...}` line), add:

```tsx
      <ActivityFeed clientId={client.id} />
```

So the final JSX structure is:

```
<div className="space-y-6 text-[var(--text-primary)]">
  ... existing status section ...
  ... existing tracking widget + review link grid ...
  ... existing retainer / started / primary contact grid ...
  {error && <p ...>{error}</p>}
  <ActivityFeed clientId={client.id} />
</div>
```

- [ ] **Step 2: Type-check**

```bash
cd /Users/ken/Desktop/Lumidian/frontend
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add frontend/components/agency/ClientOverviewTab.tsx
git commit -m "feat(frontend): show ActivityFeed on client Overview tab"
```

---

## Task 11: RecentActivitySection + wire into Today screen

**Files:**
- Create: `frontend/components/agency/RecentActivitySection.tsx`
- Modify: `frontend/app/agency/page.tsx`

- [ ] **Step 1: Create the component**

```tsx
'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { agencyRecentActivity, type ActivityEventWithClient } from '@/lib/api';
import { iconForEventType } from './activity-icons';

function timeAgo(iso: string): string {
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  if (diff < 60) return `${Math.floor(diff)}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

export function RecentActivitySection() {
  const [events, setEvents] = useState<ActivityEventWithClient[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    agencyRecentActivity(10)
      .then(setEvents)
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load'))
      .finally(() => setLoading(false));
  }, []);

  return (
    <section className="mt-6 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-card)] p-5">
      <h2 className="mb-3 text-sm font-medium text-[var(--text-secondary)]">
        Recent activity across clients
      </h2>
      {loading && <p className="text-sm text-[var(--text-muted)]">Loading…</p>}
      {error && <p className="text-sm text-red-400">{error}</p>}
      {!loading && events.length === 0 && (
        <p className="text-sm text-[var(--text-muted)]">Nothing in the last 7 days.</p>
      )}
      <ul className="space-y-2">
        {events.map((e) => {
          const Icon = iconForEventType(e.event_type);
          return (
            <li
              key={e.id}
              className="flex items-start gap-3 rounded-md border border-[var(--border-subtle)] bg-[var(--bg-raised)] p-3 text-sm"
            >
              <div className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-[var(--bg-elevated)] text-[var(--text-secondary)]">
                <Icon width={14} height={14} />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[var(--text-primary)]">{e.body}</p>
                <div className="mt-1 flex items-center gap-2 text-xs text-[var(--text-muted)]">
                  <Link
                    href={`/agency/clients/${e.client_id}`}
                    className="underline-offset-2 hover:underline"
                  >
                    {e.client_name}
                  </Link>
                  <span>·</span>
                  <span>{timeAgo(e.created_at)}</span>
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
```

- [ ] **Step 2: Import + render in `app/agency/page.tsx`**

Edit `frontend/app/agency/page.tsx`. At the top, add the import:

```tsx
import { RecentActivitySection } from '@/components/agency/RecentActivitySection';
```

Just before the final closing `</div>` of the page component (after the 3-column grid section), add:

```tsx
      <RecentActivitySection />
```

So the structure becomes:

```
<div className="p-8 text-[var(--text-primary)]">
  ... header ...
  <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
    ... 3 columns ...
  </div>
  <RecentActivitySection />
</div>
```

- [ ] **Step 3: Type-check**

```bash
cd /Users/ken/Desktop/Lumidian/frontend
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add frontend/components/agency/RecentActivitySection.tsx frontend/app/agency/page.tsx
git commit -m "feat(frontend): cross-client recent activity on Today screen"
```

---

## Task 12: End-to-end smoke test

**Files:** None — verification only.

- [ ] **Step 1: Start dev servers**

Terminal 1:
```bash
cd /Users/ken/Desktop/Lumidian/backend
source venv/bin/activate
uvicorn app.main:app --reload --port 3001
```

Terminal 2:
```bash
cd /Users/ken/Desktop/Lumidian/frontend
npm run dev -- -p 3002
```

Watch backend logs for the new migration applying:
```
Migration applied: CREATE TABLE IF NOT EXISTS client_activity_events ...
Migration applied: DROP TABLE IF EXISTS client_notes
```

- [ ] **Step 2: Browser walkthrough**

1. Log in at `http://localhost:3002/login` as `ken@lumidian.ai`.
2. Visit `http://localhost:3002/agency`.
3. Today screen should show the existing 3 columns AND a new "Recent activity across clients" section at the bottom.
4. Click Clients → create a new test client. After creating, the Today screen's recent activity section should now show "Created client X".
5. Click into that client → Overview tab → scroll to bottom. The Activity feed should appear with the `client_created` event already listed.
6. Type a note in the composer and hit Post note. The note appears at the top of the feed, attributed to you, with Edit / Delete affordances.
7. Click Edit → change text → Save. The note updates and shows "edited".
8. Click Delete on the note → it disappears.
9. Change client status from onboarding → active. A new `client_status_changed` event appears at the top of the feed.
10. Generate a review link. A `review_link_generated` event appears. Rotate it. A `review_link_rotated` event appears.
11. Go to Today again. The recent activity section reflects the new events with the client's name as a link.

If all 11 steps pass, sub-project A is functional end-to-end.

- [ ] **Step 3: Stop dev servers**

Ctrl+C in both terminals. No commit (manual verification only).

---

## Self-Review Notes

**Spec coverage:**
- New table + indexes → Task 1 ✓
- `client_notes` drop → Task 1 ✓
- Pydantic schemas → Task 2 ✓
- emit_event helper → Task 3 ✓
- 5 endpoints (feed, post/edit/delete note, recent) → Task 4 ✓
- 8 integration points (4 in agency.py + 3 in review_public.py + 1 manual via note POST already in Task 4) → Task 5 ✓
- Backend tests covering note CRUD + emission + pagination + recent endpoint → Task 6 ✓
- Frontend API methods → Task 7 ✓
- Activity icons helper → Task 8 ✓
- ActivityFeed component → Task 9 ✓
- Overview tab wiring → Task 10 ✓
- RecentActivitySection + Today wiring → Task 11 ✓
- E2E smoke → Task 12 ✓

**Notes:**
- Recent activity endpoint returns events from last 7 days only; this is enforced in Task 4 Step 3 via the cutoff filter — confirmed in the spec ("limit to 10 in UI, 7-day window").
- The `_user` → `user` rename in Task 5 Steps 2, 3, 4 is necessary so the actor_id can be passed into emit_event. Existing tests don't care about the parameter name.
- Markdown rendering is intentionally NOT in this plan — body renders as plaintext with `whitespace-pre-wrap` (preserves line breaks). The spec explicitly allowed this fallback.
