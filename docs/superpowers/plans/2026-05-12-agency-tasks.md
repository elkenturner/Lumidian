# Agency Tasks + Assignments Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development.

**Goal:** Add a generic `AgencyTask` model + endpoints, surface the existing `ContentDraft.assigned_to_user_id` field in UI, and ship a "Your queue" view on Today plus a per-client task list in Strategy.

**Architecture:** New table `agency_tasks` with CRUD endpoints; activity events emitted on create/assign/complete via the existing `emit_event` helper. Frontend gets four new components (TaskRow, TaskList, AssigneePicker, MyQueueSection) wired into Today, Strategy tab, and the Pipeline kanban draft cards.

**Tech Stack:** FastAPI 0.115, SQLAlchemy 2.0 async, pytest. Next.js 16, React 18, TypeScript, Tailwind, Radix UI.

**Spec:** `docs/superpowers/specs/2026-05-12-agency-tasks-design.md`

---

## File Structure

### Backend

- **Modify:** `backend/app/models.py` — add `AgencyTask` class.
- **Modify:** `backend/app/database.py` — append migrations.
- **Modify:** `backend/app/schemas.py` — task in/out schemas, MyQueueOut, AgencyStaffOut.
- **Modify:** `backend/app/services/agency_activity.py` — add 3 event-type constants.
- **Modify:** `backend/app/routers/agency.py` — 6 new endpoints (list/create/update/delete tasks + my-queue + staff).
- **Modify:** `backend/tests/conftest.py` — add `agency_tasks` to truncation list.
- **Create:** `backend/tests/test_agency_tasks.py`.

### Frontend

- **Modify:** `frontend/lib/api.ts` — types + 7 new functions.
- **Modify:** `frontend/components/agency/activity-icons.tsx` — 3 new icons.
- **Create:** `frontend/components/agency/AssigneePicker.tsx`.
- **Create:** `frontend/components/agency/TaskRow.tsx`.
- **Create:** `frontend/components/agency/TaskList.tsx`.
- **Create:** `frontend/components/agency/MyQueueSection.tsx`.
- **Modify:** `frontend/components/agency/ClientStrategyTab.tsx` — embed `<TaskList>`.
- **Modify:** `frontend/components/agency/ClientPipelineTab.tsx` — embed `<AssigneePicker>` on each draft card.
- **Modify:** `frontend/app/agency/page.tsx` — embed `<MyQueueSection>` at top.

---

## Task 1: Backend model + migration

**Files:**
- Modify: `backend/app/models.py`
- Modify: `backend/app/database.py`

- [ ] **Step 1: Append `AgencyTask` class to `models.py`**

```python
class AgencyTask(Base):
    __tablename__ = "agency_tasks"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    agency_client_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("agency_clients.id", ondelete="CASCADE"), nullable=False, index=True
    )
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="open")
    assigned_to_user_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True
    )
    due_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    created_by_user_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, index=True)
    updated_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
```

- [ ] **Step 2: Append migrations in `database.py`**

```python
        # 2026-05-12: Agency tasks (sub-project B)
        """CREATE TABLE IF NOT EXISTS agency_tasks (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            agency_client_id INTEGER NOT NULL REFERENCES agency_clients(id) ON DELETE CASCADE,
            title TEXT NOT NULL,
            description TEXT,
            status TEXT NOT NULL DEFAULT 'open',
            assigned_to_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
            due_at DATETIME,
            created_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
            created_at DATETIME,
            updated_at DATETIME,
            completed_at DATETIME
        )""",
        "CREATE INDEX IF NOT EXISTS idx_agency_tasks_client_status ON agency_tasks(agency_client_id, status, due_at)",
        "CREATE INDEX IF NOT EXISTS idx_agency_tasks_assigned ON agency_tasks(assigned_to_user_id, status, due_at)",
```

- [ ] **Step 3: Verify migrations**

```bash
cd /Users/ken/Desktop/Lumidian/backend
source venv/bin/activate
python -c "import asyncio; from app.database import create_tables, run_migrations
async def m():
    await create_tables(); await run_migrations(); print('OK')
asyncio.run(m())"
```

Expected: `OK`.

- [ ] **Step 4: Commit**

```bash
git add backend/app/models.py backend/app/database.py
git commit -m "feat(backend): AgencyTask model + migrations"
```

---

## Task 2: Schemas + event constants

**Files:**
- Modify: `backend/app/schemas.py`
- Modify: `backend/app/services/agency_activity.py`

- [ ] **Step 1: Append schemas**

In `backend/app/schemas.py` at the bottom:

```python
# ── Agency tasks (sub-project B, 2026-05-12) ─────────────────────────────────


_TASK_STATUSES = {"open", "in_progress", "done"}


class AgencyTaskCreate(BaseModel):
    title: str = Field(min_length=1, max_length=255)
    description: str | None = None
    due_at: datetime | None = None
    assigned_to_user_id: int | None = None


class AgencyTaskUpdate(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=255)
    description: str | None = None
    status: str | None = None
    due_at: datetime | None = None
    assigned_to_user_id: int | None = None

    @field_validator("status")
    @classmethod
    def validate_status(cls, v: str | None) -> str | None:
        if v is None:
            return v
        if v not in _TASK_STATUSES:
            raise ValueError(f"status must be one of {sorted(_TASK_STATUSES)}")
        return v


class AgencyTaskOut(BaseModel):
    id: int
    agency_client_id: int
    title: str
    description: str | None
    status: str
    assigned_to_user_id: int | None
    assigned_to_name: str | None
    due_at: datetime | None
    created_by_user_id: int | None
    created_at: datetime
    updated_at: datetime | None
    completed_at: datetime | None

    model_config = ConfigDict(from_attributes=True)


class MyQueueDraft(BaseModel):
    draft_id: int
    title: str | None
    platform: str
    status: str
    client_id: int
    client_name: str
    created_at: datetime


class MyQueueOut(BaseModel):
    drafts: list[MyQueueDraft]
    tasks: list[AgencyTaskOut]


class AgencyStaffOut(BaseModel):
    id: int
    name: str | None
    email: str

    model_config = ConfigDict(from_attributes=True)
```

If `field_validator` isn't already imported at the top of `schemas.py`, add it to the pydantic import line.

- [ ] **Step 2: Add event constants to `agency_activity.py`**

Append to `backend/app/services/agency_activity.py` after the existing event-type constants:

```python
EVENT_TASK_CREATED = "task_created"
EVENT_TASK_ASSIGNED = "task_assigned"
EVENT_TASK_COMPLETED = "task_completed"
```

- [ ] **Step 3: Verify imports**

```bash
cd /Users/ken/Desktop/Lumidian/backend
source venv/bin/activate
python -c "from app.schemas import AgencyTaskCreate, AgencyTaskOut, MyQueueOut, AgencyStaffOut; from app.services.agency_activity import EVENT_TASK_CREATED; print('OK')"
```

Expected: `OK`.

- [ ] **Step 4: Commit**

```bash
git add backend/app/schemas.py backend/app/services/agency_activity.py
git commit -m "feat(backend): task schemas + 3 new event constants"
```

---

## Task 3: Tasks router (6 endpoints)

**Files:**
- Modify: `backend/app/routers/agency.py`

- [ ] **Step 1: Update imports**

Add to existing imports in `backend/app/routers/agency.py`:

```python
from app.models import AgencyTask  # add to existing app.models import tuple
from app.schemas import (
    AgencyStaffOut,
    AgencyTaskCreate,
    AgencyTaskOut,
    AgencyTaskUpdate,
    MyQueueDraft,
    MyQueueOut,
)  # add to existing app.schemas import tuple
from app.services.agency_activity import (
    EVENT_TASK_ASSIGNED,
    EVENT_TASK_COMPLETED,
    EVENT_TASK_CREATED,
)  # add to existing services.agency_activity import
```

Add to the existing `from app.models import AgencyStaff` (it should already be imported in agency.py — verify). If not, add `AgencyStaff` to the import tuple.

- [ ] **Step 2: Append helper**

Append in `agency.py`:

```python
async def _task_to_out(db: AsyncSession, task: AgencyTask) -> AgencyTaskOut:
    assignee_name: str | None = None
    if task.assigned_to_user_id is not None:
        u = await db.get(User, task.assigned_to_user_id)
        assignee_name = (u.name or u.email) if u else None
    return AgencyTaskOut(
        id=task.id,
        agency_client_id=task.agency_client_id,
        title=task.title,
        description=task.description,
        status=task.status,
        assigned_to_user_id=task.assigned_to_user_id,
        assigned_to_name=assignee_name,
        due_at=task.due_at,
        created_by_user_id=task.created_by_user_id,
        created_at=task.created_at,
        updated_at=task.updated_at,
        completed_at=task.completed_at,
    )
```

- [ ] **Step 3: Append the 6 endpoints**

```python
@router.get("/clients/{client_id}/tasks", response_model=list[AgencyTaskOut])
async def list_client_tasks(
    client_id: int,
    status: str | None = None,
    assigned_to: int | None = None,
    db: AsyncSession = Depends(get_db),
    _user: User = Depends(require_agency_staff),
):
    client = await db.get(AgencyClient, client_id)
    if client is None:
        raise HTTPException(status_code=404, detail="Client not found")
    stmt = select(AgencyTask).where(AgencyTask.agency_client_id == client_id)
    if status:
        stmt = stmt.where(AgencyTask.status == status)
    if assigned_to is not None:
        stmt = stmt.where(AgencyTask.assigned_to_user_id == assigned_to)
    stmt = stmt.order_by(AgencyTask.due_at.asc().nulls_last(), AgencyTask.created_at.asc())
    rows = (await db.execute(stmt)).scalars().all()
    return [await _task_to_out(db, t) for t in rows]


@router.post("/clients/{client_id}/tasks", response_model=AgencyTaskOut, status_code=http_status.HTTP_201_CREATED)
async def create_task(
    client_id: int,
    body: AgencyTaskCreate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_agency_staff),
):
    client = await db.get(AgencyClient, client_id)
    if client is None:
        raise HTTPException(status_code=404, detail="Client not found")
    task = AgencyTask(
        agency_client_id=client_id,
        title=body.title.strip(),
        description=body.description,
        status="open",
        assigned_to_user_id=body.assigned_to_user_id,
        due_at=body.due_at,
        created_by_user_id=user.id,
    )
    db.add(task)
    await db.flush()
    await emit_event(
        db,
        agency_client_id=client_id,
        event_type=EVENT_TASK_CREATED,
        body=f"Created task '{task.title}'",
        actor_user_id=user.id,
        payload={"task_id": task.id},
    )
    await db.commit()
    await db.refresh(task)
    return await _task_to_out(db, task)


@router.patch("/tasks/{task_id}", response_model=AgencyTaskOut)
async def update_task(
    task_id: int,
    body: AgencyTaskUpdate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_agency_staff),
):
    task = await db.get(AgencyTask, task_id)
    if task is None:
        raise HTTPException(status_code=404, detail="Task not found")
    prev_assignee = task.assigned_to_user_id
    prev_status = task.status
    data = body.model_dump(exclude_unset=True)
    for field, value in data.items():
        setattr(task, field, value)
    if "status" in data:
        if data["status"] == "done" and task.completed_at is None:
            task.completed_at = datetime.utcnow()
        elif data["status"] != "done":
            task.completed_at = None
    task.updated_at = datetime.utcnow()

    if "assigned_to_user_id" in data and data["assigned_to_user_id"] != prev_assignee:
        new_assignee_name: str | None = None
        if task.assigned_to_user_id is not None:
            u = await db.get(User, task.assigned_to_user_id)
            new_assignee_name = (u.name or u.email) if u else None
        await emit_event(
            db,
            agency_client_id=task.agency_client_id,
            event_type=EVENT_TASK_ASSIGNED,
            body=f"Assigned task '{task.title}' to {new_assignee_name or 'unassigned'}",
            actor_user_id=user.id,
            payload={"task_id": task.id, "prev_assignee_id": prev_assignee, "next_assignee_id": task.assigned_to_user_id},
        )
    if "status" in data and data["status"] == "done" and prev_status != "done":
        await emit_event(
            db,
            agency_client_id=task.agency_client_id,
            event_type=EVENT_TASK_COMPLETED,
            body=f"Completed task '{task.title}'",
            actor_user_id=user.id,
            payload={"task_id": task.id},
        )

    await db.commit()
    await db.refresh(task)
    return await _task_to_out(db, task)


@router.delete("/tasks/{task_id}", status_code=http_status.HTTP_204_NO_CONTENT)
async def delete_task(
    task_id: int,
    db: AsyncSession = Depends(get_db),
    _user: User = Depends(require_agency_staff),
):
    task = await db.get(AgencyTask, task_id)
    if task is None:
        raise HTTPException(status_code=404, detail="Task not found")
    await db.delete(task)
    await db.commit()


_ACTIONABLE_DRAFT_STATUSES = ("draft", "changes_requested", "approved")


@router.get("/my-queue", response_model=MyQueueOut)
async def my_queue(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_agency_staff),
):
    drafts_q = await db.execute(
        select(ContentDraft, Brand, AgencyClient)
        .join(Brand, Brand.id == ContentDraft.brand_id)
        .join(AgencyClient, AgencyClient.id == Brand.agency_client_id)
        .where(
            ContentDraft.assigned_to_user_id == user.id,
            ContentDraft.status.in_(_ACTIONABLE_DRAFT_STATUSES),
        )
        .order_by(ContentDraft.created_at.asc())
        .limit(100)
    )
    drafts = [
        MyQueueDraft(
            draft_id=d.id,
            title=getattr(d, "title", None),
            platform=d.platform,
            status=d.status,
            client_id=ac.id,
            client_name=ac.name,
            created_at=d.created_at,
        )
        for d, _b, ac in drafts_q.all()
    ]

    tasks_q = await db.execute(
        select(AgencyTask)
        .where(
            AgencyTask.assigned_to_user_id == user.id,
            AgencyTask.status != "done",
        )
        .order_by(AgencyTask.due_at.asc().nulls_last(), AgencyTask.created_at.asc())
        .limit(100)
    )
    tasks = [await _task_to_out(db, t) for t in tasks_q.scalars().all()]

    return MyQueueOut(drafts=drafts, tasks=tasks)


@router.get("/staff", response_model=list[AgencyStaffOut])
async def list_staff(
    db: AsyncSession = Depends(get_db),
    _user: User = Depends(require_agency_staff),
):
    rows = await db.execute(
        select(User)
        .join(AgencyStaff, AgencyStaff.user_id == User.id)
        .where(AgencyStaff.active == True)  # noqa: E712
        .order_by(User.email.asc())
    )
    users = rows.scalars().all()
    return [AgencyStaffOut(id=u.id, name=u.name, email=u.email) for u in users]
```

- [ ] **Step 4: Verify routes**

```bash
cd /Users/ken/Desktop/Lumidian/backend
source venv/bin/activate
python -c "from app.main import app
for r in app.routes:
    p = str(getattr(r, 'path', ''))
    if '/tasks' in p or '/my-queue' in p or '/staff' in p:
        print(p)"
```

Should print 5+ paths including `/api/agency/clients/{client_id}/tasks`, `/api/agency/tasks/{task_id}` (twice), `/api/agency/my-queue`, `/api/agency/staff`.

- [ ] **Step 5: Commit**

```bash
git add backend/app/routers/agency.py
git commit -m "feat(backend): task CRUD + my-queue + staff endpoints"
```

---

## Task 4: Backend tests

**Files:**
- Modify: `backend/tests/conftest.py` — add `"agency_tasks"` to truncation list (next to other agency tables).
- Create: `backend/tests/test_agency_tasks.py`

- [ ] **Step 1: Update conftest truncation list**

In `backend/tests/conftest.py`, find:
```python
            "client_activity_events", "client_review_links", "agency_staff",
```

Replace with:
```python
            "client_activity_events", "client_review_links", "agency_tasks", "agency_staff",
```

- [ ] **Step 2: Create the test file**

```python
"""Tests for agency task CRUD + my-queue + staff endpoints."""
from __future__ import annotations

import pytest
from sqlalchemy import select, update

from app.database import AsyncSessionLocal
from app.models import AgencyStaff, AgencyTask, Brand, ClientActivityEvent, ContentDraft, User
from tests.conftest import register_and_login


async def _make_agency_user(client, email: str = "tasks@example.com") -> None:
    await register_and_login(client, email=email)
    async with AsyncSessionLocal() as db:
        await db.execute(update(User).where(User.email == email).values(is_agency_staff=True))
        # Also create an AgencyStaff row so /staff returns this user
        user = (await db.execute(select(User).where(User.email == email))).scalar_one()
        existing = (await db.execute(select(AgencyStaff).where(AgencyStaff.user_id == user.id))).scalar_one_or_none()
        if existing is None:
            db.add(AgencyStaff(user_id=user.id, role="owner", active=True))
        await db.commit()


async def _create_client_via_api(client, name: str = "TaskCo") -> tuple[int, int]:
    resp = await client.post("/api/agency/clients", json={"name": name})
    assert resp.status_code == 201, resp.text
    body = resp.json()
    return body["id"], body["brand_id"]


@pytest.mark.asyncio
async def test_create_task_emits_event(client, db_session):
    await _make_agency_user(client)
    cid, _ = await _create_client_via_api(client)
    resp = await client.post(
        f"/api/agency/clients/{cid}/tasks",
        json={"title": "Call client about LinkedIn", "description": "Schedule for Tuesday"},
    )
    assert resp.status_code == 201, resp.text
    body = resp.json()
    assert body["title"] == "Call client about LinkedIn"
    assert body["status"] == "open"
    assert body["assigned_to_user_id"] is None
    assert body["created_by_user_id"] is not None

    events = (await db_session.execute(
        select(ClientActivityEvent).where(
            ClientActivityEvent.agency_client_id == cid,
            ClientActivityEvent.event_type == "task_created",
        )
    )).scalars().all()
    assert len(events) == 1


@pytest.mark.asyncio
async def test_update_task_title_no_event(client, db_session):
    await _make_agency_user(client)
    cid, _ = await _create_client_via_api(client)
    post = await client.post(f"/api/agency/clients/{cid}/tasks", json={"title": "A"})
    tid = post.json()["id"]
    resp = await client.patch(f"/api/agency/tasks/{tid}", json={"title": "B"})
    assert resp.status_code == 200
    assert resp.json()["title"] == "B"
    # No new event (only the original task_created)
    count = (await db_session.execute(
        select(ClientActivityEvent).where(ClientActivityEvent.agency_client_id == cid)
    )).scalars().all()
    event_types = [e.event_type for e in count]
    assert event_types.count("task_created") == 1
    assert "task_assigned" not in event_types
    assert "task_completed" not in event_types


@pytest.mark.asyncio
async def test_assign_task_emits_event(client, db_session):
    await _make_agency_user(client)
    cid, _ = await _create_client_via_api(client)
    me = (await db_session.execute(select(User).where(User.email == "tasks@example.com"))).scalar_one()
    post = await client.post(f"/api/agency/clients/{cid}/tasks", json={"title": "T"})
    tid = post.json()["id"]
    resp = await client.patch(f"/api/agency/tasks/{tid}", json={"assigned_to_user_id": me.id})
    assert resp.status_code == 200
    assert resp.json()["assigned_to_user_id"] == me.id
    assert resp.json()["assigned_to_name"] is not None

    events = (await db_session.execute(
        select(ClientActivityEvent).where(
            ClientActivityEvent.event_type == "task_assigned",
        )
    )).scalars().all()
    assert len(events) == 1


@pytest.mark.asyncio
async def test_complete_task_sets_completed_at(client, db_session):
    await _make_agency_user(client)
    cid, _ = await _create_client_via_api(client)
    post = await client.post(f"/api/agency/clients/{cid}/tasks", json={"title": "T"})
    tid = post.json()["id"]
    resp = await client.patch(f"/api/agency/tasks/{tid}", json={"status": "done"})
    assert resp.status_code == 200
    assert resp.json()["status"] == "done"
    assert resp.json()["completed_at"] is not None

    events = (await db_session.execute(
        select(ClientActivityEvent).where(ClientActivityEvent.event_type == "task_completed")
    )).scalars().all()
    assert len(events) == 1


@pytest.mark.asyncio
async def test_uncomplete_task_clears_completed_at(client, db_session):
    await _make_agency_user(client)
    cid, _ = await _create_client_via_api(client)
    post = await client.post(f"/api/agency/clients/{cid}/tasks", json={"title": "T"})
    tid = post.json()["id"]
    await client.patch(f"/api/agency/tasks/{tid}", json={"status": "done"})
    resp = await client.patch(f"/api/agency/tasks/{tid}", json={"status": "in_progress"})
    assert resp.status_code == 200
    assert resp.json()["status"] == "in_progress"
    assert resp.json()["completed_at"] is None


@pytest.mark.asyncio
async def test_invalid_status_returns_422(client):
    await _make_agency_user(client)
    cid, _ = await _create_client_via_api(client)
    post = await client.post(f"/api/agency/clients/{cid}/tasks", json={"title": "T"})
    tid = post.json()["id"]
    resp = await client.patch(f"/api/agency/tasks/{tid}", json={"status": "weird"})
    assert resp.status_code == 422


@pytest.mark.asyncio
async def test_delete_task(client, db_session):
    await _make_agency_user(client)
    cid, _ = await _create_client_via_api(client)
    post = await client.post(f"/api/agency/clients/{cid}/tasks", json={"title": "T"})
    tid = post.json()["id"]
    resp = await client.delete(f"/api/agency/tasks/{tid}")
    assert resp.status_code == 204
    refreshed = await db_session.get(AgencyTask, tid)
    assert refreshed is None


@pytest.mark.asyncio
async def test_my_queue_returns_drafts_and_tasks(client, db_session):
    await _make_agency_user(client)
    me = (await db_session.execute(select(User).where(User.email == "tasks@example.com"))).scalar_one()
    cid, brand_id = await _create_client_via_api(client)

    # Task assigned to me
    post = await client.post(f"/api/agency/clients/{cid}/tasks", json={"title": "Mine"})
    await client.patch(f"/api/agency/tasks/{post.json()['id']}", json={"assigned_to_user_id": me.id})

    # Task NOT assigned to me — shouldn't appear
    await client.post(f"/api/agency/clients/{cid}/tasks", json={"title": "Not mine"})

    # Draft assigned to me with actionable status
    draft = ContentDraft(brand_id=brand_id, platform="medium", content_text="x", status="draft", title="Mine draft", assigned_to_user_id=me.id)
    db_session.add(draft)
    # Draft assigned to me but in non-actionable status — shouldn't appear
    db_session.add(ContentDraft(brand_id=brand_id, platform="medium", content_text="x", status="posted", title="Posted", assigned_to_user_id=me.id))
    await db_session.commit()

    resp = await client.get("/api/agency/my-queue")
    assert resp.status_code == 200
    body = resp.json()
    task_titles = [t["title"] for t in body["tasks"]]
    draft_titles = [d["title"] for d in body["drafts"]]
    assert task_titles == ["Mine"]
    assert draft_titles == ["Mine draft"]


@pytest.mark.asyncio
async def test_staff_returns_active_agency_users(client):
    await _make_agency_user(client, email="staff1@example.com")
    resp = await client.get("/api/agency/staff")
    assert resp.status_code == 200
    users = resp.json()
    assert any(u["email"] == "staff1@example.com" for u in users)


@pytest.mark.asyncio
async def test_list_tasks_filters_and_orders(client):
    await _make_agency_user(client)
    cid, _ = await _create_client_via_api(client)
    await client.post(f"/api/agency/clients/{cid}/tasks", json={"title": "A"})
    second = await client.post(f"/api/agency/clients/{cid}/tasks", json={"title": "B"})
    await client.patch(f"/api/agency/tasks/{second.json()['id']}", json={"status": "done"})

    open_only = await client.get(f"/api/agency/clients/{cid}/tasks?status=open")
    assert [t["title"] for t in open_only.json()] == ["A"]

    done_only = await client.get(f"/api/agency/clients/{cid}/tasks?status=done")
    assert [t["title"] for t in done_only.json()] == ["B"]
```

- [ ] **Step 3: Run tests**

```bash
cd /Users/ken/Desktop/Lumidian/backend
source venv/bin/activate
pytest tests/test_agency_tasks.py tests/test_agency.py tests/test_review_public.py tests/test_agency_activity.py -v --timeout=60
```

Expected: all PASS — 10 new + 10 + 8 + 13 = 41 total.

- [ ] **Step 4: Commit**

```bash
git add backend/tests/test_agency_tasks.py backend/tests/conftest.py
git commit -m "test(backend): agency task CRUD + my-queue + staff"
```

---

## Task 5: Frontend API client + icons

**Files:**
- Modify: `frontend/lib/api.ts`
- Modify: `frontend/components/agency/activity-icons.tsx`

- [ ] **Step 1: Append to `lib/api.ts`**

```typescript
// ── Agency tasks (sub-project B, 2026-05-12) ─────────────────────────────────

export type TaskStatus = 'open' | 'in_progress' | 'done';

export interface AgencyTask {
  id: number;
  agency_client_id: number;
  title: string;
  description: string | null;
  status: TaskStatus;
  assigned_to_user_id: number | null;
  assigned_to_name: string | null;
  due_at: string | null;
  created_by_user_id: number | null;
  created_at: string;
  updated_at: string | null;
  completed_at: string | null;
}

export interface AgencyTaskCreate {
  title: string;
  description?: string;
  due_at?: string;
  assigned_to_user_id?: number | null;
}

export interface AgencyTaskUpdate {
  title?: string;
  description?: string | null;
  status?: TaskStatus;
  due_at?: string | null;
  assigned_to_user_id?: number | null;
}

export interface AgencyStaffMember {
  id: number;
  name: string | null;
  email: string;
}

export interface MyQueueDraft {
  draft_id: number;
  title: string | null;
  platform: string;
  status: string;
  client_id: number;
  client_name: string;
  created_at: string;
}

export interface MyQueueResponse {
  drafts: MyQueueDraft[];
  tasks: AgencyTask[];
}

export async function agencyListTasks(clientId: number, status?: TaskStatus): Promise<AgencyTask[]> {
  const params: Record<string, string> = {};
  if (status) params.status = status;
  const res = await api.get<AgencyTask[]>(`/agency/clients/${clientId}/tasks`, { params });
  return res.data;
}

export async function agencyCreateTask(clientId: number, body: AgencyTaskCreate): Promise<AgencyTask> {
  const res = await api.post<AgencyTask>(`/agency/clients/${clientId}/tasks`, body);
  return res.data;
}

export async function agencyUpdateTask(taskId: number, body: AgencyTaskUpdate): Promise<AgencyTask> {
  const res = await api.patch<AgencyTask>(`/agency/tasks/${taskId}`, body);
  return res.data;
}

export async function agencyDeleteTask(taskId: number): Promise<void> {
  await api.delete(`/agency/tasks/${taskId}`);
}

export async function agencyMyQueue(): Promise<MyQueueResponse> {
  const res = await api.get<MyQueueResponse>('/agency/my-queue');
  return res.data;
}

export async function agencyStaff(): Promise<AgencyStaffMember[]> {
  const res = await api.get<AgencyStaffMember[]>('/agency/staff');
  return res.data;
}
```

- [ ] **Step 2: Update `activity-icons.tsx`**

Add to the lucide-react imports: `ListPlus, UserCircle, CheckCircle2`.

Add to the `ICONS` map:
```typescript
  task_created: ListPlus,
  task_assigned: UserCircle,
  task_completed: CheckCircle2,
```

- [ ] **Step 3: Type-check**

```bash
cd /Users/ken/Desktop/Lumidian/frontend
npx tsc --noEmit
```

Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add frontend/lib/api.ts frontend/components/agency/activity-icons.tsx
git commit -m "feat(frontend): task API methods + 3 new event icons"
```

---

## Task 6: AssigneePicker + TaskRow + TaskList components

**Files:**
- Create: `frontend/components/agency/AssigneePicker.tsx`
- Create: `frontend/components/agency/TaskRow.tsx`
- Create: `frontend/components/agency/TaskList.tsx`

- [ ] **Step 1: AssigneePicker.tsx**

```tsx
'use client';

import { useEffect, useState } from 'react';
import { agencyStaff, type AgencyStaffMember } from '@/lib/api';

interface Props {
  value: number | null;
  onChange: (userId: number | null) => Promise<void> | void;
  compact?: boolean;
}

export function AssigneePicker({ value, onChange, compact }: Props) {
  const [staff, setStaff] = useState<AgencyStaffMember[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    agencyStaff().then(setStaff).catch(() => setStaff([]));
  }, []);

  const handle = async (next: number | null) => {
    setBusy(true);
    try { await onChange(next); } finally { setBusy(false); }
  };

  return (
    <select
      value={value ?? ''}
      onChange={(e) => handle(e.target.value === '' ? null : parseInt(e.target.value, 10))}
      disabled={busy}
      className={`rounded-md border border-[var(--border-default)] bg-[var(--bg-raised)] text-[var(--text-primary)] ${
        compact ? 'px-2 py-1 text-xs' : 'px-3 py-1.5 text-sm'
      } disabled:opacity-50`}
    >
      <option value="">Unassigned</option>
      {staff.map((s) => (
        <option key={s.id} value={s.id}>
          {s.name || s.email}
        </option>
      ))}
    </select>
  );
}
```

- [ ] **Step 2: TaskRow.tsx**

```tsx
'use client';

import { useState } from 'react';
import { agencyDeleteTask, agencyUpdateTask, type AgencyTask, type TaskStatus } from '@/lib/api';
import { AssigneePicker } from './AssigneePicker';

interface Props {
  task: AgencyTask;
  onChange: (next: AgencyTask) => void;
  onDelete: (id: number) => void;
}

const STATUS_PILL: Record<TaskStatus, string> = {
  open: 'bg-slate-500/20 text-slate-300',
  in_progress: 'bg-amber-500/20 text-amber-300',
  done: 'bg-emerald-500/20 text-emerald-300',
};

const STATUS_LABEL: Record<TaskStatus, string> = {
  open: 'Open',
  in_progress: 'In progress',
  done: 'Done',
};

function dueLabel(iso: string | null): { text: string; overdue: boolean } | null {
  if (!iso) return null;
  const normalized = /[Zz]|[+-]\d{2}:?\d{2}$/.test(iso) ? iso : iso + 'Z';
  const t = new Date(normalized).getTime();
  const now = Date.now();
  const overdue = t < now;
  const days = Math.round((t - now) / 86400000);
  let text: string;
  if (Math.abs(days) < 1) text = overdue ? 'Today (overdue)' : 'Today';
  else if (days > 0) text = `in ${days}d`;
  else text = `${Math.abs(days)}d overdue`;
  return { text, overdue };
}

export function TaskRow({ task, onChange, onDelete }: Props) {
  const [expanded, setExpanded] = useState(false);
  const due = dueLabel(task.due_at);

  const setStatus = async (status: TaskStatus) => {
    const next = await agencyUpdateTask(task.id, { status });
    onChange(next);
  };
  const setAssignee = async (userId: number | null) => {
    const next = await agencyUpdateTask(task.id, { assigned_to_user_id: userId });
    onChange(next);
  };
  const remove = async () => {
    if (!confirm('Delete this task?')) return;
    await agencyDeleteTask(task.id);
    onDelete(task.id);
  };

  return (
    <li className="rounded-md border border-[var(--border-subtle)] bg-[var(--bg-raised)] p-3 text-sm">
      <div className="flex items-start gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <button
              onClick={() => setExpanded((v) => !v)}
              className="text-left font-medium text-[var(--text-primary)] hover:underline"
            >
              {task.title}
            </button>
            <span className={`rounded-full px-2 py-0.5 text-xs ${STATUS_PILL[task.status]}`}>
              {STATUS_LABEL[task.status]}
            </span>
            {due && (
              <span className={`text-xs ${due.overdue ? 'text-red-400' : 'text-[var(--text-muted)]'}`}>
                {due.text}
              </span>
            )}
          </div>
          {expanded && task.description && (
            <p className="mt-2 whitespace-pre-wrap text-xs text-[var(--text-muted)]">
              {task.description}
            </p>
          )}
          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
            <AssigneePicker
              value={task.assigned_to_user_id}
              onChange={setAssignee}
              compact
            />
            <select
              value={task.status}
              onChange={(e) => setStatus(e.target.value as TaskStatus)}
              className="rounded-md border border-[var(--border-default)] bg-[var(--bg-raised)] px-2 py-1 text-xs text-[var(--text-primary)]"
            >
              <option value="open">Open</option>
              <option value="in_progress">In progress</option>
              <option value="done">Done</option>
            </select>
            <button onClick={remove} className="text-[var(--text-muted)] hover:text-red-400">
              Delete
            </button>
          </div>
        </div>
      </div>
    </li>
  );
}
```

- [ ] **Step 3: TaskList.tsx**

```tsx
'use client';

import { useEffect, useState } from 'react';
import { agencyCreateTask, agencyListTasks, type AgencyTask } from '@/lib/api';
import { TaskRow } from './TaskRow';

interface Props {
  clientId: number;
}

export function TaskList({ clientId }: Props) {
  const [tasks, setTasks] = useState<AgencyTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [newTitle, setNewTitle] = useState('');
  const [creating, setCreating] = useState(false);
  const [showDone, setShowDone] = useState(false);

  useEffect(() => {
    agencyListTasks(clientId)
      .then(setTasks)
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load tasks'))
      .finally(() => setLoading(false));
  }, [clientId]);

  const create = async () => {
    if (!newTitle.trim()) return;
    setCreating(true);
    try {
      const next = await agencyCreateTask(clientId, { title: newTitle.trim() });
      setTasks((prev) => [...prev, next]);
      setNewTitle('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to create task');
    } finally {
      setCreating(false);
    }
  };

  const visible = showDone ? tasks : tasks.filter((t) => t.status !== 'done');

  return (
    <section className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-card)] p-5">
      <div className="mb-4 flex items-center justify-between">
        <h3 className="text-sm font-medium text-[var(--text-secondary)]">Tasks</h3>
        <label className="flex items-center gap-2 text-xs text-[var(--text-muted)]">
          <input
            type="checkbox"
            checked={showDone}
            onChange={(e) => setShowDone(e.target.checked)}
          />
          Show completed
        </label>
      </div>

      <div className="mb-4 flex gap-2">
        <input
          value={newTitle}
          onChange={(e) => setNewTitle(e.target.value)}
          placeholder="New task…"
          onKeyDown={(e) => { if (e.key === 'Enter') create(); }}
          className="flex-1 rounded-md border border-[var(--border-default)] bg-[var(--bg-raised)] px-3 py-2 text-sm"
        />
        <button
          onClick={create}
          disabled={creating || !newTitle.trim()}
          className="rounded-md bg-[var(--bg-elevated)] px-3 py-2 text-xs font-medium text-[var(--text-primary)] hover:bg-[var(--bg-card)] disabled:opacity-50"
        >
          Add
        </button>
      </div>

      {loading && <p className="text-sm text-[var(--text-muted)]">Loading…</p>}
      {error && <p className="text-sm text-red-400">{error}</p>}
      {!loading && visible.length === 0 && (
        <p className="text-sm text-[var(--text-muted)]">
          {tasks.length === 0 ? 'No tasks yet. Add the first one above.' : 'No open tasks. Toggle "Show completed" to see done items.'}
        </p>
      )}

      <ul className="space-y-2">
        {visible.map((task) => (
          <TaskRow
            key={task.id}
            task={task}
            onChange={(next) => setTasks((prev) => prev.map((t) => (t.id === next.id ? next : t)))}
            onDelete={(id) => setTasks((prev) => prev.filter((t) => t.id !== id))}
          />
        ))}
      </ul>
    </section>
  );
}
```

- [ ] **Step 4: Type-check**

```bash
cd /Users/ken/Desktop/Lumidian/frontend
npx tsc --noEmit
```

Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add frontend/components/agency/AssigneePicker.tsx frontend/components/agency/TaskRow.tsx frontend/components/agency/TaskList.tsx
git commit -m "feat(frontend): AssigneePicker + TaskRow + TaskList components"
```

---

## Task 7: MyQueueSection + wire into Today + Strategy tab

**Files:**
- Create: `frontend/components/agency/MyQueueSection.tsx`
- Modify: `frontend/components/agency/ClientStrategyTab.tsx`
- Modify: `frontend/app/agency/page.tsx`

- [ ] **Step 1: MyQueueSection.tsx**

```tsx
'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { agencyMyQueue, type MyQueueResponse } from '@/lib/api';

function dueLabel(iso: string | null): string | null {
  if (!iso) return null;
  const normalized = /[Zz]|[+-]\d{2}:?\d{2}$/.test(iso) ? iso : iso + 'Z';
  const t = new Date(normalized).getTime();
  const now = Date.now();
  const days = Math.round((t - now) / 86400000);
  if (days < -1) return `${Math.abs(days)}d overdue`;
  if (days <= 0) return 'Today';
  if (days === 1) return 'Tomorrow';
  return `in ${days}d`;
}

export function MyQueueSection() {
  const [data, setData] = useState<MyQueueResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    agencyMyQueue().then(setData).catch((e) => setError(e instanceof Error ? e.message : 'Failed to load'));
  }, []);

  if (error) return null; // silent — Today still renders below
  if (!data) return null;

  const total = data.drafts.length + data.tasks.length;
  if (total === 0) return null;

  return (
    <section className="mb-6 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-card)] p-5">
      <h2 className="mb-3 text-sm font-medium text-[var(--text-secondary)]">
        Your queue ({total})
      </h2>
      <ul className="space-y-2">
        {data.tasks.map((t) => (
          <li key={`task-${t.id}`} className="flex items-start gap-3 rounded-md border border-[var(--border-subtle)] bg-[var(--bg-raised)] p-3 text-sm">
            <div className="flex-1 min-w-0">
              <Link href={`/agency/clients/${t.agency_client_id}`} className="font-medium text-[var(--text-primary)] hover:underline">
                {t.title}
              </Link>
              <div className="mt-1 text-xs text-[var(--text-muted)]">
                Task · {t.status === 'in_progress' ? 'In progress' : 'Open'}
                {dueLabel(t.due_at) && <> · {dueLabel(t.due_at)}</>}
              </div>
            </div>
          </li>
        ))}
        {data.drafts.map((d) => (
          <li key={`draft-${d.draft_id}`} className="flex items-start gap-3 rounded-md border border-[var(--border-subtle)] bg-[var(--bg-raised)] p-3 text-sm">
            <div className="flex-1 min-w-0">
              <Link href={`/agency/clients/${d.client_id}`} className="font-medium text-[var(--text-primary)] hover:underline">
                {d.title || `Draft #${d.draft_id}`}
              </Link>
              <div className="mt-1 text-xs text-[var(--text-muted)]">
                Draft · {d.status.replace('_', ' ')} · {d.platform} · {d.client_name}
              </div>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
```

- [ ] **Step 2: Wire `MyQueueSection` at top of `frontend/app/agency/page.tsx`**

Add the import at the top:
```tsx
import { MyQueueSection } from '@/components/agency/MyQueueSection';
```

Just AFTER the existing `<div className="mb-6">...</div>` (the header block with "Today" h1) and BEFORE the 3-column grid, insert:
```tsx
      <MyQueueSection />
```

So the structure becomes:
```
<div className="p-8 text-[var(--text-primary)]">
  ... header div ...
  <MyQueueSection />
  <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
    ... 3 columns ...
  </div>
  <RecentActivitySection />
</div>
```

- [ ] **Step 3: Wire `TaskList` into `ClientStrategyTab.tsx`**

Replace `frontend/components/agency/ClientStrategyTab.tsx` with:

```tsx
'use client';

import { ClientBrandTab } from './ClientBrandTab';
import { TaskList } from './TaskList';

interface Props {
  brandId: number | null;
  clientId: number;
}

export function ClientStrategyTab({ brandId, clientId }: Props) {
  return (
    <div className="space-y-6 text-[var(--text-primary)]">
      <TaskList clientId={clientId} />
      <ClientBrandTab brandId={brandId} />
      <div className="rounded-lg border border-dashed border-[var(--border-subtle)] p-6 text-sm text-[var(--text-muted)]">
        Content gaps and AIO website audit will live here. Coming soon.
      </div>
    </div>
  );
}
```

Now update `frontend/app/agency/clients/[id]/page.tsx` — find the line:
```tsx
        <Tabs.Content value="strategy">
          <ClientStrategyTab brandId={client.brand_id} />
        </Tabs.Content>
```
And replace with:
```tsx
        <Tabs.Content value="strategy">
          <ClientStrategyTab brandId={client.brand_id} clientId={client.id} />
        </Tabs.Content>
```

- [ ] **Step 4: Type-check**

```bash
cd /Users/ken/Desktop/Lumidian/frontend
npx tsc --noEmit
```

Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add frontend/components/agency/MyQueueSection.tsx frontend/components/agency/ClientStrategyTab.tsx frontend/app/agency/page.tsx frontend/app/agency/clients/[id]/page.tsx
git commit -m "feat(frontend): MyQueueSection on Today + TaskList in Strategy tab"
```

---

## Task 8: Wire AssigneePicker into Pipeline draft cards

**Files:**
- Modify: `frontend/components/agency/ClientPipelineTab.tsx`

- [ ] **Step 1: Add AssigneePicker to each draft card**

In `frontend/components/agency/ClientPipelineTab.tsx`:

1. Add import at top:
```tsx
import { agencyAssignDraft } from '@/lib/api';
import { AssigneePicker } from './AssigneePicker';
```

2. Inside each draft card `<li>`, find the existing `<DraftActions ... />` line. Just above it, add:

```tsx
                  <div className="mt-2">
                    <AssigneePicker
                      value={d.assigned_to_user_id ?? null}
                      onChange={async (userId) => {
                        await agencyAssignDraft(d.id, userId);
                        updateLocal(d.id, { assigned_to_user_id: userId });
                      }}
                      compact
                    />
                  </div>
```

This assumes `ContentDraft` has an `assigned_to_user_id` field. If the API client's `ContentDraft` type doesn't declare it, add it to the type in `frontend/lib/api.ts`. Verify before editing:

```bash
grep -n "assigned_to_user_id" /Users/ken/Desktop/Lumidian/frontend/lib/api.ts
```

If no match, find the `ContentDraft` interface (around lines 246-260) and add `assigned_to_user_id: number | null;` near the other optional fields.

3. Also update `updateLocal` to accept the new shape. The existing `updateLocal` already uses `Partial<...>` — should work as-is.

- [ ] **Step 2: Type-check**

```bash
cd /Users/ken/Desktop/Lumidian/frontend
npx tsc --noEmit
```

Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add frontend/components/agency/ClientPipelineTab.tsx frontend/lib/api.ts
git commit -m "feat(frontend): assignee picker on Pipeline draft cards"
```

---

## Task 9: End-to-end smoke test

**Files:** None — manual verification via Playwright.

- [ ] **Step 1: Start dev servers**

Terminal 1: `cd backend && source venv/bin/activate && uvicorn app.main:app --port 3001`
Terminal 2: `cd frontend && npm run dev -- -p 3002`

Wait for migrations: `Migration applied: CREATE TABLE IF NOT EXISTS agency_tasks ...`.

- [ ] **Step 2: Browser walkthrough**

1. Log in at `http://localhost:3002/login`.
2. Visit `http://localhost:3002/agency/clients` → create a client "Smoke B".
3. Click into the client → Strategy tab → Tasks section renders with empty state.
4. Add a task "Set up brand profile" → it appears with status pill "Open".
5. Click the assignee dropdown → assign to yourself.
6. Today screen now shows a "Your queue" section at the top with that task.
7. Back on Strategy tab → change status to "In progress", then "Done". Pill colors change.
8. Toggle "Show completed" — done task reappears.
9. Activity feed (Overview tab) shows `task_created`, `task_assigned`, `task_completed` events.
10. Delete the task — confirm modal, then it disappears.
11. Pipeline tab → if there's a draft, the AssigneePicker dropdown is on the card.

Stop dev servers when done.

---

## Self-Review

- Spec coverage: every requirement has a task ✓
- Type consistency: AgencyTaskOut field names match between backend schemas (Task 2), frontend types (Task 5), and component usage (Tasks 6/7) ✓
- Event constants: defined in Task 2, used in Task 3 ✓
- conftest update for `agency_tasks` truncation: Task 4 ✓
