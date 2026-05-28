# Agency Cockpit Playbook Redesign — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the 5-tab agency client cockpit with a Playbook-as-primary 4-tab cockpit driven by a manual milestone checklist, add `wikipedia_plan` + `site_plan` document templates, and drop the Peec column / Today page / global Documents page.

**Architecture:** New `AgencyClientMilestone` table persisting 6 stage rows per client (`kickoff`, `sow`, `initial_audit`, `strategy_locked`, `wikipedia_plan`, `site_plan`). Two new GET/PATCH endpoints under `/api/agency/clients/{id}/milestones`. Two new document templates wired into the existing `document_engine/` registry; both call Claude Sonnet 4.6 via the existing generator with structured live data. Frontend collapses to 4 tabs; Playbook tab orchestrates 5 sub-panels (Launch / Weekly execution / Wikipedia plan / Site plan / Reports). Pipeline becomes an inline drawer; Documents history moves into Brand tab.

**Tech Stack:** FastAPI · SQLAlchemy 2.0 async · SQLite + aiosqlite · pytest · Next.js 15 · React 18 · TypeScript strict · Tailwind · Radix UI.

**Spec:** `docs/superpowers/specs/2026-05-22-agency-cockpit-playbook-redesign-design.md`

---

## File map

### Backend — created

- `backend/app/services/document_engine/wikipedia_plan.py` — new template, kind `wikipedia_plan`
- `backend/app/services/document_engine/site_plan.py` — new template, kind `site_plan`
- `backend/tests/test_agency_milestones.py` — 8 milestone tests
- `backend/tests/test_agency_document_templates.py` — 6 doc template tests

### Backend — modified

- `backend/app/models.py` — add `AgencyClientMilestone`; drop `peec_dashboard_url` column from `AgencyClient`
- `backend/app/database.py` — append migrations for new table + DROP COLUMN
- `backend/app/schemas.py` — add `AgencyClientMilestoneOut` + `AgencyClientMilestoneUpdate`; drop `peec_dashboard_url` from `AgencyClientCreate` / `AgencyClientUpdate` / `AgencyClientOut`
- `backend/app/routers/agency.py` — add 2 milestone endpoints, drop 9 dead endpoints, drop `peec_dashboard_url` from `_client_to_out` and `create_client`
- `backend/app/services/document_engine/__init__.py` — import the two new templates so `register()` fires at import time
- `backend/tests/conftest.py` — add `agency_client_milestones` to the truncation list
- `backend/tests/test_agency_client_access.py` — drop `peec_dashboard_url` references; add 2 milestone-endpoint authz cases
- Any `backend/tests/test_agency*.py` that uses `peec_dashboard_url=...` — strip the field

### Backend — deleted

- (No file deletions; only handlers/schemas removed in-place from `agency.py` / `schemas.py`)

### Frontend — created

- `frontend/components/agency/PlaybookTab.tsx` — orchestrator
- `frontend/components/agency/PlaybookLaunchRow.tsx` — one launch milestone row
- `frontend/components/agency/PlaybookEngagement.tsx` — one engagement panel
- `frontend/components/agency/PlaybookWeeklyExecution.tsx` — multi-row weekly state
- `frontend/components/agency/PlaybookReports.tsx` — weekly + monthly report rows

### Frontend — modified

- `frontend/components/agency/ClientCockpit.tsx` — 4 tabs, Playbook default, no Next-step shelf, no Pipeline/Documents tabs
- `frontend/components/agency/ClientBrandTab.tsx` — append read-only Documents history
- `frontend/components/agency/AgencySidebar.tsx` — drop Today + Documents nav entries
- `frontend/app/agency/clients/page.tsx` — drop Peec column
- `frontend/app/agency/page.tsx` — replace body with `redirect('/agency/clients')`
- `frontend/lib/api.ts` — drop dead exports, add milestone API, drop `peec_dashboard_url` from `AgencyClient` types

### Frontend — deleted

- `frontend/app/agency/documents/page.tsx`
- `frontend/components/agency/MyQueueSection.tsx`
- `frontend/components/agency/ClientNextStepShelf.tsx`
- `frontend/components/agency/GenerateForAnyClientModal.tsx`

### Docs

- `CURRENT_STATE.md` — update WIP + Recent Decisions + Recently Changed

---

## Phase 1 — Backend foundation

### Task 1: Add `AgencyClientMilestone` model and migration

**Files:**
- Modify: `backend/app/models.py` (append a class after `AgencyClientAssignment`)
- Modify: `backend/app/database.py` (append SQL strings to the `migrations` list around line 496)
- Test: `backend/tests/test_agency_milestones.py` (create)
- Modify: `backend/tests/conftest.py` (add table to truncation list)

- [ ] **Step 1.1: Write failing test for table existence + auto-create on GET**

Create `backend/tests/test_agency_milestones.py`:

```python
"""Tests for /api/agency/clients/{id}/milestones."""
from __future__ import annotations

import pytest
from httpx import AsyncClient

from tests.conftest import create_agency_client_for_admin


MILESTONE_KINDS = ["kickoff", "sow", "initial_audit", "strategy_locked", "wikipedia_plan", "site_plan"]


@pytest.mark.asyncio
async def test_list_milestones_autocreates_six_rows(client: AsyncClient, admin_headers):
    agency_client_id = await create_agency_client_for_admin(client, admin_headers, name="Acme")
    res = await client.get(f"/api/agency/clients/{agency_client_id}/milestones", headers=admin_headers)
    assert res.status_code == 200
    payload = res.json()
    assert len(payload) == 6
    kinds = sorted(m["kind"] for m in payload)
    assert kinds == sorted(MILESTONE_KINDS)
    for m in payload:
        assert m["status"] == "not_started"
        assert m["completed_at"] is None
        assert m["completed_by"] is None
        assert m["completed_by_name"] is None
        assert m["notes"] is None
```

You'll need a small helper in `tests/conftest.py` — check whether `create_agency_client_for_admin` already exists; if not, write it inline in this test file as:

```python
async def create_agency_client_for_admin(client, headers, *, name="Test client") -> int:
    res = await client.post("/api/agency/clients", json={"name": name}, headers=headers)
    assert res.status_code == 201, res.text
    return res.json()["id"]
```

(Inline is fine — keep tests self-contained.)

- [ ] **Step 1.2: Run the test to verify it fails**

```bash
cd backend && source venv/bin/activate
pytest tests/test_agency_milestones.py::test_list_milestones_autocreates_six_rows -v
```

Expected: FAIL — endpoint doesn't exist yet (404).

- [ ] **Step 1.3: Add `AgencyClientMilestone` ORM model**

In `backend/app/models.py`, append after `AgencyClientAssignment` class:

```python
class AgencyClientMilestone(Base):
    __tablename__ = "agency_client_milestones"
    __table_args__ = (
        UniqueConstraint("agency_client_id", "kind", name="uq_agency_client_milestones_client_kind"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    agency_client_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("agency_clients.id", ondelete="CASCADE"), nullable=False, index=True
    )
    kind: Mapped[str] = mapped_column(String(32), nullable=False)
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="not_started")
    started_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    target_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    completed_by: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
```

Ensure `UniqueConstraint` and `Text` are already imported at the top of `models.py`; add them if not.

- [ ] **Step 1.4: Add migration SQL**

In `backend/app/database.py`, append to the `migrations` list before `]` on line 497:

```python
        # 2026-05-26: Agency cockpit playbook redesign — milestone table
        """CREATE TABLE IF NOT EXISTS agency_client_milestones (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            agency_client_id INTEGER NOT NULL REFERENCES agency_clients(id) ON DELETE CASCADE,
            kind VARCHAR(32) NOT NULL,
            status VARCHAR(16) NOT NULL DEFAULT 'not_started',
            started_at DATETIME,
            target_at DATETIME,
            completed_at DATETIME,
            completed_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
            notes TEXT,
            UNIQUE(agency_client_id, kind)
        )""",
        "CREATE INDEX IF NOT EXISTS idx_agency_client_milestones_client ON agency_client_milestones(agency_client_id)",
```

- [ ] **Step 1.5: Add truncation entry to conftest**

In `backend/tests/conftest.py`, find the `TRUNCATE_TABLES` list (or wherever per-test cleanup happens). Add `"agency_client_milestones"` to the list. If the list is sorted, keep alphabetical.

- [ ] **Step 1.6: Run the failing test again — still fails on endpoint**

```bash
pytest tests/test_agency_milestones.py::test_list_milestones_autocreates_six_rows -v
```

Expected: still FAIL with 404. (Schema + endpoint come next.)

- [ ] **Step 1.7: Commit the model + migration**

```bash
git add backend/app/models.py backend/app/database.py backend/tests/test_agency_milestones.py backend/tests/conftest.py
git commit -m "feat(agency): AgencyClientMilestone model + migration + first failing test"
```

---

### Task 2: Milestone Pydantic schemas

**Files:**
- Modify: `backend/app/schemas.py` (append new classes)

- [ ] **Step 2.1: Add the two milestone schemas**

In `backend/app/schemas.py`, append after `AgencyClientOut`:

```python
MILESTONE_KINDS = (
    "kickoff",
    "sow",
    "initial_audit",
    "strategy_locked",
    "wikipedia_plan",
    "site_plan",
)
MILESTONE_STATUSES = ("not_started", "in_progress", "done", "skipped")


class AgencyClientMilestoneOut(BaseModel):
    id: int
    agency_client_id: int
    kind: str
    status: str
    started_at: datetime | None = None
    target_at: datetime | None = None
    completed_at: datetime | None = None
    completed_by: int | None = None
    completed_by_name: str | None = None
    notes: str | None = None

    model_config = ConfigDict(from_attributes=True)


class AgencyClientMilestoneUpdate(BaseModel):
    status: str | None = None
    started_at: datetime | None = None
    target_at: datetime | None = None
    notes: str | None = None
```

- [ ] **Step 2.2: Quick sanity check — schemas import cleanly**

```bash
cd backend && python -c "from app.schemas import AgencyClientMilestoneOut, AgencyClientMilestoneUpdate, MILESTONE_KINDS; print('ok')"
```

Expected: `ok`.

- [ ] **Step 2.3: Commit**

```bash
git add backend/app/schemas.py
git commit -m "feat(agency): milestone Pydantic schemas"
```

---

### Task 3: GET `/api/agency/clients/{id}/milestones` endpoint

**Files:**
- Modify: `backend/app/routers/agency.py` (append endpoint)
- Test: `backend/tests/test_agency_milestones.py` (reuse existing test)

- [ ] **Step 3.1: Add the endpoint**

In `backend/app/routers/agency.py`:

1. Add to the imports from `app.models`:
   `AgencyClientMilestone`
2. Add to the imports from `app.schemas`:
   `AgencyClientMilestoneOut`, `AgencyClientMilestoneUpdate`, `MILESTONE_KINDS`, `MILESTONE_STATUSES`
3. Append at the end of the file (above the file's last line):

```python
async def _milestone_to_out(db: AsyncSession, m: AgencyClientMilestone) -> AgencyClientMilestoneOut:
    completed_by_name: str | None = None
    if m.completed_by is not None:
        u = await db.execute(select(User.name, User.email).where(User.id == m.completed_by))
        row = u.first()
        if row is not None:
            completed_by_name = row.name or row.email
    return AgencyClientMilestoneOut(
        id=m.id,
        agency_client_id=m.agency_client_id,
        kind=m.kind,
        status=m.status,
        started_at=m.started_at,
        target_at=m.target_at,
        completed_at=m.completed_at,
        completed_by=m.completed_by,
        completed_by_name=completed_by_name,
        notes=m.notes,
    )


@router.get("/clients/{client_id}/milestones", response_model=list[AgencyClientMilestoneOut])
async def list_client_milestones(
    client_id: int,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_client_access),
) -> list[AgencyClientMilestoneOut]:
    existing_q = await db.execute(
        select(AgencyClientMilestone).where(AgencyClientMilestone.agency_client_id == client_id)
    )
    existing = {m.kind: m for m in existing_q.scalars().all()}

    created_any = False
    for kind in MILESTONE_KINDS:
        if kind not in existing:
            row = AgencyClientMilestone(agency_client_id=client_id, kind=kind, status="not_started")
            db.add(row)
            existing[kind] = row
            created_any = True
    if created_any:
        await db.commit()
        for kind in MILESTONE_KINDS:
            await db.refresh(existing[kind])

    out = []
    for kind in MILESTONE_KINDS:
        out.append(await _milestone_to_out(db, existing[kind]))
    return out
```

- [ ] **Step 3.2: Run the auto-create test**

```bash
pytest tests/test_agency_milestones.py::test_list_milestones_autocreates_six_rows -v
```

Expected: PASS.

- [ ] **Step 3.3: Add the per-client authz test**

Append to `backend/tests/test_agency_milestones.py`:

```python
@pytest.mark.asyncio
async def test_list_milestones_unassigned_staff_gets_403(
    client: AsyncClient, admin_headers, staff_headers_unassigned
):
    agency_client_id = await create_agency_client_for_admin(client, admin_headers, name="Acme")
    res = await client.get(
        f"/api/agency/clients/{agency_client_id}/milestones", headers=staff_headers_unassigned
    )
    assert res.status_code == 403


@pytest.mark.asyncio
async def test_list_milestones_admin_bypass(client: AsyncClient, admin_headers, second_admin_headers):
    agency_client_id = await create_agency_client_for_admin(client, admin_headers, name="Acme")
    res = await client.get(
        f"/api/agency/clients/{agency_client_id}/milestones", headers=second_admin_headers
    )
    assert res.status_code == 200
```

If `staff_headers_unassigned` / `second_admin_headers` fixtures don't already exist in `conftest.py`, model them on the patterns in `test_agency_client_access.py`. Read that file first:

```bash
sed -n '1,80p' backend/tests/test_agency_client_access.py
```

— it shows the existing pattern for spinning up a non-assigned staff user (via `register_user` + setting `is_agency_staff=True` on the user, or whatever helper the file uses). Reuse the same helper; do not invent a new auth mechanism.

- [ ] **Step 3.4: Run authz tests**

```bash
pytest tests/test_agency_milestones.py -v
```

Expected: 3 PASS.

- [ ] **Step 3.5: Commit**

```bash
git add backend/app/routers/agency.py backend/tests/test_agency_milestones.py
git commit -m "feat(agency): GET /clients/{id}/milestones with auto-create + authz tests"
```

---

### Task 4: PATCH `/api/agency/clients/{id}/milestones/{kind}` endpoint

**Files:**
- Modify: `backend/app/routers/agency.py`
- Test: `backend/tests/test_agency_milestones.py`

- [ ] **Step 4.1: Write failing test — PATCH sets completed_at + completed_by when status flips to done**

Append to `backend/tests/test_agency_milestones.py`:

```python
@pytest.mark.asyncio
async def test_patch_status_done_autosets_completed_fields(
    client: AsyncClient, admin_headers, admin_user_id
):
    agency_client_id = await create_agency_client_for_admin(client, admin_headers, name="Acme")
    # auto-create rows
    await client.get(f"/api/agency/clients/{agency_client_id}/milestones", headers=admin_headers)

    res = await client.patch(
        f"/api/agency/clients/{agency_client_id}/milestones/kickoff",
        json={"status": "done"},
        headers=admin_headers,
    )
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["status"] == "done"
    assert body["completed_at"] is not None
    assert body["completed_by"] == admin_user_id
```

If `admin_user_id` fixture doesn't exist, add it inline. Either fetch from `/api/auth/me` with `admin_headers`, or add a fixture that returns the seeded admin's id.

- [ ] **Step 4.2: Run the test — expect 404**

```bash
pytest tests/test_agency_milestones.py::test_patch_status_done_autosets_completed_fields -v
```

Expected: FAIL — 404 (endpoint doesn't exist).

- [ ] **Step 4.3: Implement PATCH endpoint**

Append to `backend/app/routers/agency.py`:

```python
@router.patch(
    "/clients/{client_id}/milestones/{kind}",
    response_model=AgencyClientMilestoneOut,
)
async def update_client_milestone(
    client_id: int,
    kind: str,
    body: AgencyClientMilestoneUpdate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_client_access),
) -> AgencyClientMilestoneOut:
    if kind not in MILESTONE_KINDS:
        raise HTTPException(status_code=422, detail=f"Unknown milestone kind: {kind}")
    if body.status is not None and body.status not in MILESTONE_STATUSES:
        raise HTTPException(status_code=422, detail=f"Unknown status: {body.status}")

    row_q = await db.execute(
        select(AgencyClientMilestone)
        .where(
            AgencyClientMilestone.agency_client_id == client_id,
            AgencyClientMilestone.kind == kind,
        )
    )
    row = row_q.scalar_one_or_none()
    if row is None:
        # Auto-create rather than 404 — same behavior as the GET endpoint
        row = AgencyClientMilestone(agency_client_id=client_id, kind=kind, status="not_started")
        db.add(row)
        await db.flush()

    prev_status = row.status
    if body.status is not None:
        row.status = body.status
        if body.status == "done" and prev_status != "done":
            row.completed_at = datetime.utcnow()
            row.completed_by = user.id
        elif body.status != "done" and prev_status == "done":
            row.completed_at = None
            row.completed_by = None
    if body.started_at is not None:
        row.started_at = body.started_at
    if body.target_at is not None:
        row.target_at = body.target_at
    if body.notes is not None:
        row.notes = body.notes

    await db.commit()
    await db.refresh(row)
    return await _milestone_to_out(db, row)
```

- [ ] **Step 4.4: Run the test — should pass**

```bash
pytest tests/test_agency_milestones.py::test_patch_status_done_autosets_completed_fields -v
```

Expected: PASS.

- [ ] **Step 4.5: Add remaining PATCH tests**

Append:

```python
@pytest.mark.asyncio
async def test_patch_status_unwind_done_clears_completed_fields(client: AsyncClient, admin_headers):
    agency_client_id = await create_agency_client_for_admin(client, admin_headers, name="Acme")
    await client.get(f"/api/agency/clients/{agency_client_id}/milestones", headers=admin_headers)

    await client.patch(
        f"/api/agency/clients/{agency_client_id}/milestones/sow",
        json={"status": "done"},
        headers=admin_headers,
    )
    res = await client.patch(
        f"/api/agency/clients/{agency_client_id}/milestones/sow",
        json={"status": "in_progress"},
        headers=admin_headers,
    )
    assert res.status_code == 200
    body = res.json()
    assert body["status"] == "in_progress"
    assert body["completed_at"] is None
    assert body["completed_by"] is None


@pytest.mark.asyncio
async def test_patch_engagement_dates(client: AsyncClient, admin_headers):
    agency_client_id = await create_agency_client_for_admin(client, admin_headers, name="Acme")
    await client.get(f"/api/agency/clients/{agency_client_id}/milestones", headers=admin_headers)

    res = await client.patch(
        f"/api/agency/clients/{agency_client_id}/milestones/wikipedia_plan",
        json={
            "status": "in_progress",
            "started_at": "2026-05-26T00:00:00",
            "target_at": "2026-06-26T00:00:00",
            "notes": "Targeting 8 articles",
        },
        headers=admin_headers,
    )
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["started_at"] is not None
    assert body["target_at"] is not None
    assert body["notes"] == "Targeting 8 articles"


@pytest.mark.asyncio
async def test_patch_unknown_kind_returns_422(client: AsyncClient, admin_headers):
    agency_client_id = await create_agency_client_for_admin(client, admin_headers, name="Acme")
    res = await client.patch(
        f"/api/agency/clients/{agency_client_id}/milestones/bogus_kind",
        json={"status": "done"},
        headers=admin_headers,
    )
    assert res.status_code == 422


@pytest.mark.asyncio
async def test_patch_unassigned_staff_gets_403(
    client: AsyncClient, admin_headers, staff_headers_unassigned
):
    agency_client_id = await create_agency_client_for_admin(client, admin_headers, name="Acme")
    res = await client.patch(
        f"/api/agency/clients/{agency_client_id}/milestones/kickoff",
        json={"status": "done"},
        headers=staff_headers_unassigned,
    )
    assert res.status_code == 403
```

- [ ] **Step 4.6: Run the full milestone test file**

```bash
pytest tests/test_agency_milestones.py -v
```

Expected: 7 PASS.

- [ ] **Step 4.7: Commit**

```bash
git add backend/app/routers/agency.py backend/tests/test_agency_milestones.py
git commit -m "feat(agency): PATCH /clients/{id}/milestones/{kind} with status lifecycle + tests"
```

---

### Task 5: Drop `peec_dashboard_url`

**Files:**
- Modify: `backend/app/models.py`
- Modify: `backend/app/database.py`
- Modify: `backend/app/schemas.py`
- Modify: `backend/app/routers/agency.py`
- Modify: `backend/tests/test_agency*.py` (any test referencing peec)

- [ ] **Step 5.1: Drop from ORM model**

In `backend/app/models.py`, delete line 778:

```python
    peec_dashboard_url: Mapped[str | None] = mapped_column(String(1024), nullable=True)
```

- [ ] **Step 5.2: Append DROP COLUMN migration**

In `backend/app/database.py`, append to the `migrations` list (after the milestone table SQL added in Task 1.4):

```python
        # 2026-05-26: Drop Peec column — tracking is in-house now
        "ALTER TABLE agency_clients DROP COLUMN peec_dashboard_url",
```

The wrapping `try/except OperationalError` already covers older SQLite that lacks `DROP COLUMN`. (Project SQLite is recent; this is just belt-and-suspenders.)

- [ ] **Step 5.3: Drop from schemas**

In `backend/app/schemas.py`, delete the `peec_dashboard_url: str | None = None` line from:
- `AgencyClientCreate` (line ~924)
- `AgencyClientUpdate` (line ~934)
- `AgencyClientOut` (line ~964)

- [ ] **Step 5.4: Drop from router**

In `backend/app/routers/agency.py`:
- In `_client_to_out` (line ~79), delete `peec_dashboard_url=client.peec_dashboard_url,`
- In `create_client` (line ~161), delete the `peec_dashboard_url=body.peec_dashboard_url,` argument (if present in the constructor call — grep for it):

```bash
grep -n peec backend/app/routers/agency.py
```

Delete every remaining reference.

- [ ] **Step 5.5: Clean up tests that reference peec**

```bash
grep -rn "peec_dashboard_url\|peec_url" backend/tests/
```

For each hit, delete the `peec_dashboard_url=...` field from the JSON body or assertion.

- [ ] **Step 5.6: Run full agency test suite**

```bash
pytest tests/test_agency*.py -v
```

Expected: all PASS. Investigate any failures — likely a missed peec reference.

- [ ] **Step 5.7: Commit**

```bash
git add backend/app/models.py backend/app/database.py backend/app/schemas.py backend/app/routers/agency.py backend/tests/
git commit -m "feat(agency): drop peec_dashboard_url — tracking handled in-house"
```

---

## Phase 2 — Document templates

### Task 6: `wikipedia_plan` template

**Files:**
- Create: `backend/app/services/document_engine/wikipedia_plan.py`
- Test: `backend/tests/test_agency_document_templates.py` (create)

- [ ] **Step 6.1: Read an existing template for the pattern**

```bash
sed -n '1,100p' backend/app/services/document_engine/audit_initial.py
```

Note: every template uses `fetch_data` (returns a dict of structured live data) + `system_prompt` (instructs Claude how to format) + `register(Template(...))` at module load. The generator calls Claude Sonnet 4.6 with the fetched data as a JSON blob.

- [ ] **Step 6.2: Write failing tests**

Create `backend/tests/test_agency_document_templates.py`:

```python
"""Tests for wikipedia_plan and site_plan document templates."""
from __future__ import annotations

import json
from datetime import datetime, timedelta
from unittest.mock import patch

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import AsyncSessionLocal
from app.models import (
    AgencyClient,
    Brand,
    BrandProfile,
    WebsiteAudit,
    WebsiteAuditRecommendation,
    WikipediaCandidate,
    WikipediaScan,
)
from app.services.document_engine import wikipedia_plan, site_plan
from app.services.document_engine.registry import get_template


@pytest.mark.asyncio
async def test_wikipedia_plan_registered():
    assert get_template("wikipedia_plan") is not None


@pytest.mark.asyncio
async def test_wikipedia_plan_fetch_data_with_scan(seeded_brand_with_wiki_scan):
    """fetch_data returns scan summary + candidate list when a scan exists."""
    client_id, brand_id = seeded_brand_with_wiki_scan
    async with AsyncSessionLocal() as db:
        client = await db.get(AgencyClient, client_id)
        template = get_template("wikipedia_plan")
        data = await template.fetch_data(db, client)
    assert data["scan"] is not None
    assert data["scan"]["candidates_persisted"] >= 1
    assert len(data["candidates"]) >= 1
    assert "client" in data
    assert "publications" in data


@pytest.mark.asyncio
async def test_wikipedia_plan_fetch_data_no_scan(seeded_agency_client_with_brand):
    """fetch_data returns a stub indicator when no scan exists."""
    client_id, _brand_id = seeded_agency_client_with_brand
    async with AsyncSessionLocal() as db:
        client = await db.get(AgencyClient, client_id)
        template = get_template("wikipedia_plan")
        data = await template.fetch_data(db, client)
    assert data["scan"] is None
    assert data["candidates"] == []
```

`seeded_brand_with_wiki_scan` and `seeded_agency_client_with_brand` are new fixtures — add them to `tests/conftest.py`:

```python
@pytest_asyncio.fixture
async def seeded_agency_client_with_brand(admin_headers, client) -> tuple[int, int]:
    """Returns (agency_client_id, brand_id)."""
    res = await client.post("/api/agency/clients", json={"name": "Acme"}, headers=admin_headers)
    assert res.status_code == 201
    cid = res.json()["id"]
    # The agency client creation flow also creates a Brand; fetch its id.
    bid = res.json().get("brand_id")
    if bid is None:
        # Fall back: query directly
        async with AsyncSessionLocal() as db:
            b = await db.execute(select(Brand).where(Brand.agency_client_id == cid).limit(1))
            bid = b.scalar_one().id
    return cid, bid


@pytest_asyncio.fixture
async def seeded_brand_with_wiki_scan(seeded_agency_client_with_brand) -> tuple[int, int]:
    cid, bid = seeded_agency_client_with_brand
    async with AsyncSessionLocal() as db:
        scan = WikipediaScan(
            brand_id=bid,
            status="completed",
            triggered_by=1,  # admin
            prompts_searched=5,
            total_candidates_found=12,
            candidates_persisted=4,
            started_at=datetime.utcnow() - timedelta(hours=2),
            completed_at=datetime.utcnow() - timedelta(hours=1),
        )
        db.add(scan)
        await db.flush()
        for i in range(2):
            cand = WikipediaCandidate(
                brand_id=bid,
                scan_id=scan.id,
                article_title=f"Article {i}",
                article_url=f"https://en.wikipedia.org/wiki/Article_{i}",
                pageid=1000 + i,
                article_summary="Summary",
                legitimacy_score=0.75,
                legitimacy_reasoning="Plausible fit",
                status="new",
                suggested_section="History",
            )
            db.add(cand)
        await db.commit()
    return cid, bid
```

Run the test:

```bash
pytest tests/test_agency_document_templates.py::test_wikipedia_plan_registered -v
```

Expected: FAIL — import error (`wikipedia_plan` module doesn't exist).

- [ ] **Step 6.3: Implement the template**

Create `backend/app/services/document_engine/wikipedia_plan.py`:

```python
"""Wikipedia plan template — surfaces scan + candidate data for a client deliverable."""
from __future__ import annotations

from datetime import datetime
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import (
    AgencyClient,
    Brand,
    BrandProfile,
    WikipediaCandidate,
    WikipediaScan,
)
from app.services.document_engine.registry import Template, register


async def fetch_data(db: AsyncSession, client: AgencyClient) -> dict[str, Any]:
    brand_q = await db.execute(select(Brand).where(Brand.agency_client_id == client.id).limit(1))
    brand = brand_q.scalar_one_or_none()

    scan_payload: dict | None = None
    candidates_payload: list[dict] = []
    publications: list[str] = []

    if brand is not None:
        prof_q = await db.execute(select(BrandProfile).where(BrandProfile.brand_id == brand.id))
        profile = prof_q.scalar_one_or_none()
        if profile and profile.publications:
            publications = [p.strip() for p in profile.publications.split(",") if p.strip()]

        scan_q = await db.execute(
            select(WikipediaScan)
            .where(WikipediaScan.brand_id == brand.id, WikipediaScan.status == "completed")
            .order_by(WikipediaScan.completed_at.desc())
            .limit(1)
        )
        scan = scan_q.scalar_one_or_none()
        if scan is not None:
            scan_payload = {
                "prompts_searched": scan.prompts_searched,
                "total_candidates_found": scan.total_candidates_found,
                "candidates_persisted": scan.candidates_persisted,
                "completed_at": scan.completed_at.isoformat() if scan.completed_at else None,
            }
            cands_q = await db.execute(
                select(WikipediaCandidate)
                .where(
                    WikipediaCandidate.brand_id == brand.id,
                    WikipediaCandidate.status.in_(("new", "drafted")),
                )
                .order_by(WikipediaCandidate.legitimacy_score.desc())
                .limit(10)
            )
            for c in cands_q.scalars().all():
                candidates_payload.append({
                    "title": c.article_title,
                    "url": c.article_url,
                    "legitimacy_score": c.legitimacy_score,
                    "legitimacy_reasoning": c.legitimacy_reasoning,
                    "suggested_section": c.suggested_section,
                    "status": c.status,
                })

    return {
        "client": {"name": client.name},
        "brand": {"name": brand.name, "website_url": brand.website_url} if brand else None,
        "publications": publications,
        "scan": scan_payload,
        "candidates": candidates_payload,
        "today": datetime.utcnow().strftime("%B %d, %Y"),
    }


SYSTEM_PROMPT = """You are drafting a Wikipedia visibility plan for an agency client. Output professional markdown.

Use these sections in this order:

# Wikipedia plan for {client.name}

## Why Wikipedia matters for AI visibility
Write ~120 words on how Wikipedia is a Tier-1 citation source for ChatGPT, Perplexity, and Gemini. Factual, no fluff.

## Scan results
If `scan` is null: say "We haven't run a Wikipedia scan yet for this brand. Once we do, this plan will list the specific articles we'll target." and stop here.
If `scan` is present: list prompts_searched, total_candidates_found, candidates_persisted, and completed_at.

## Recommended targets
For each candidate in `candidates`, render a sub-section: title, URL, legitimacy score + reasoning, suggested section, current status.
If candidates is empty, say "No qualifying candidates surfaced — see open questions below."

## Approach
Two paragraphs on the neutral-tone, citation-driven editing approach.
If `publications` is non-empty, mention them by name as the citation backbone.
If `publications` is empty, say "We'll cite from authoritative third-party sources (industry publications, peer-reviewed coverage, established news outlets)."

## Timeline
If a target month is known from the brief, mention it. Otherwise: "We'll work through the candidate list over the next 30 days."

Stay factual. Do not invent statistics or article titles not present in the data. Numbers must be exact.
"""


register(
    Template(
        kind="wikipedia_plan",
        name="Wikipedia plan",
        description="Customer-facing Wikipedia targeting plan with scan results and candidate articles.",
        title_factory=lambda c: f"Wikipedia plan — {c.name} — {datetime.utcnow().strftime('%b %Y')}",
        fetch_data=fetch_data,
        system_prompt=SYSTEM_PROMPT,
        user_prompt_template="Plan data:\n```json\n{data_json}\n```",
        max_tokens=4000,
    )
)
```

- [ ] **Step 6.4: Run the wikipedia tests**

```bash
pytest tests/test_agency_document_templates.py -v -k wikipedia
```

Expected: 3 PASS for the wikipedia tests (registered, fetch_data with scan, fetch_data no scan).

- [ ] **Step 6.5: Commit**

```bash
git add backend/app/services/document_engine/wikipedia_plan.py backend/tests/test_agency_document_templates.py backend/tests/conftest.py
git commit -m "feat(agency): wikipedia_plan document template + tests"
```

---

### Task 7: `site_plan` template

**Files:**
- Create: `backend/app/services/document_engine/site_plan.py`
- Modify: `backend/tests/test_agency_document_templates.py`

- [ ] **Step 7.1: Add failing tests for site_plan**

Append to `backend/tests/test_agency_document_templates.py`:

```python
@pytest.mark.asyncio
async def test_site_plan_registered():
    assert get_template("site_plan") is not None


@pytest.mark.asyncio
async def test_site_plan_fetch_data_with_audit(seeded_brand_with_site_audit):
    client_id, _brand_id = seeded_brand_with_site_audit
    async with AsyncSessionLocal() as db:
        client = await db.get(AgencyClient, client_id)
        template = get_template("site_plan")
        data = await template.fetch_data(db, client)
    assert data["audit"] is not None
    assert data["audit"]["overall_score"] is not None
    assert len(data["top_fixes"]) >= 1
    # No code blocks / paste-ready artifacts — those stay internal.
    for fix in data["top_fixes"]:
        assert "artifact" not in fix


@pytest.mark.asyncio
async def test_site_plan_fetch_data_no_audit(seeded_agency_client_with_brand):
    client_id, _brand_id = seeded_agency_client_with_brand
    async with AsyncSessionLocal() as db:
        client = await db.get(AgencyClient, client_id)
        template = get_template("site_plan")
        data = await template.fetch_data(db, client)
    assert data["audit"] is None
    assert data["top_fixes"] == []
```

Add the seed fixture to `tests/conftest.py`:

```python
@pytest_asyncio.fixture
async def seeded_brand_with_site_audit(seeded_agency_client_with_brand) -> tuple[int, int]:
    cid, bid = seeded_agency_client_with_brand
    async with AsyncSessionLocal() as db:
        audit = WebsiteAudit(
            brand_id=bid,
            status="completed",
            triggered_by=1,
            started_at=datetime.utcnow() - timedelta(hours=2),
            completed_at=datetime.utcnow() - timedelta(hours=1),
            total_pages=42,
            overall_score=58,
            bot_access_score=80,
            content_score=55,
            schema_score=40,
            technical_score=60,
            render_mode="server",
            llms_txt_present=False,
            llms_txt_valid=False,
        )
        db.add(audit)
        await db.flush()
        for i in range(3):
            rec = WebsiteAuditRecommendation(
                audit_id=audit.id,
                priority="high",
                priority_score=90 - i * 10,
                effort="low",
                category="schema",
                title=f"Fix {i}",
                body=f"Body of fix {i}",
                expected_impact="medium",
                llm_generated=True,
            )
            db.add(rec)
        await db.commit()
    return cid, bid
```

Add `WebsiteAudit, WebsiteAuditRecommendation` to the imports at the top of the test file.

Run:

```bash
pytest tests/test_agency_document_templates.py -v -k site_plan
```

Expected: FAIL — `site_plan` module not yet created.

- [ ] **Step 7.2: Implement the template**

Create `backend/app/services/document_engine/site_plan.py`:

```python
"""Site plan template — customer-facing site optimization summary."""
from __future__ import annotations

from datetime import datetime
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import (
    AgencyClient,
    Brand,
    WebsiteAudit,
    WebsiteAuditPage,
    WebsiteAuditRecommendation,
)
from app.services.document_engine.registry import Template, register


async def fetch_data(db: AsyncSession, client: AgencyClient) -> dict[str, Any]:
    brand_q = await db.execute(select(Brand).where(Brand.agency_client_id == client.id).limit(1))
    brand = brand_q.scalar_one_or_none()

    audit_payload: dict | None = None
    top_fixes: list[dict] = []
    llms_txt_status: dict | None = None
    robots_txt_snippet: str | None = None

    if brand is not None:
        audit_q = await db.execute(
            select(WebsiteAudit)
            .where(WebsiteAudit.brand_id == brand.id, WebsiteAudit.status == "completed")
            .order_by(WebsiteAudit.completed_at.desc())
            .limit(1)
        )
        audit = audit_q.scalar_one_or_none()
        if audit is not None:
            audit_payload = {
                "overall_score": audit.overall_score,
                "bot_access_score": audit.bot_access_score,
                "content_score": audit.content_score,
                "schema_score": audit.schema_score,
                "technical_score": audit.technical_score,
                "render_mode": audit.render_mode,
                "completed_at": audit.completed_at.isoformat() if audit.completed_at else None,
            }
            llms_txt_status = {
                "present": audit.llms_txt_present,
                "valid": audit.llms_txt_valid,
            }
            robots_txt_snippet = (audit.robots_txt_raw or "")[:1000] or None

            recs_q = await db.execute(
                select(WebsiteAuditRecommendation)
                .where(WebsiteAuditRecommendation.audit_id == audit.id)
                .order_by(WebsiteAuditRecommendation.priority_score.desc())
                .limit(10)
            )
            for r in recs_q.scalars().all():
                page_url: str | None = None
                if r.page_id is not None:
                    p = await db.execute(select(WebsiteAuditPage.url).where(WebsiteAuditPage.id == r.page_id))
                    page_url = p.scalar_one_or_none()
                top_fixes.append({
                    "title": r.title,
                    "category": r.category,
                    "effort": r.effort,
                    "expected_impact": r.expected_impact,
                    "body": r.body,
                    "page_url": page_url,  # null means site-wide
                })

    return {
        "client": {"name": client.name},
        "brand": {"name": brand.name, "website_url": brand.website_url} if brand else None,
        "audit": audit_payload,
        "llms_txt_status": llms_txt_status,
        "robots_txt_snippet": robots_txt_snippet,
        "top_fixes": top_fixes,
        "today": datetime.utcnow().strftime("%B %d, %Y"),
    }


SYSTEM_PROMPT = """You are drafting a site optimization plan for an agency client. Output professional markdown.

Use these sections in this order:

# Site optimization plan for {client.name}

## Where we stand today
If `audit` is null: say "We haven't run a site audit yet for this brand. Once we do, this plan will list the specific fixes we'll ship." and stop here.
If `audit` is present: a 2-sentence overview citing overall_score (out of 100), then a markdown table with rows for Bot access / Content / Schema / Technical scores plus the audited date and render_mode.

## Top fixes (priority order)
For each fix in `top_fixes`, render: title (as h3), category, effort, expected impact, affected page (page_url or "Site-wide"), and the body. NEVER include code blocks. NEVER include paste-ready JSON-LD, robots.txt, or llms.txt content — those are internal-only artifacts. Plain English only.

## llms.txt status
One sentence based on `llms_txt_status.present` and `llms_txt_status.valid`.

## AI bot access
If `robots_txt_snippet` is present, say "Current robots.txt allows / blocks the following bots: ..." in plain English (do not paste the snippet).
If null, say "robots.txt was not retrievable during audit."

## Timeline
Targeting completion within 30 days unless data says otherwise.

Stay factual. Do not invent recommendations or pages. Numbers must be exact.
"""


register(
    Template(
        kind="site_plan",
        name="Site plan",
        description="Customer-facing site optimization plan from latest audit.",
        title_factory=lambda c: f"Site plan — {c.name} — {datetime.utcnow().strftime('%b %Y')}",
        fetch_data=fetch_data,
        system_prompt=SYSTEM_PROMPT,
        user_prompt_template="Site plan data:\n```json\n{data_json}\n```",
        max_tokens=4000,
    )
)
```

- [ ] **Step 7.3: Run the site_plan tests**

```bash
pytest tests/test_agency_document_templates.py -v
```

Expected: 6 PASS.

- [ ] **Step 7.4: Commit**

```bash
git add backend/app/services/document_engine/site_plan.py backend/tests/test_agency_document_templates.py backend/tests/conftest.py
git commit -m "feat(agency): site_plan document template + tests"
```

---

### Task 8: Register both templates at engine load

**Files:**
- Modify: `backend/app/services/document_engine/__init__.py`

- [ ] **Step 8.1: Read the existing init**

```bash
cat backend/app/services/document_engine/__init__.py
```

The existing templates are registered when their modules are imported (the `register()` call runs at import time). So `__init__.py` must import every template module.

- [ ] **Step 8.2: Add the two new imports**

In `backend/app/services/document_engine/__init__.py`, find the existing `from app.services.document_engine import audit_initial, sow, ...` block. Add `wikipedia_plan` and `site_plan`:

```python
from app.services.document_engine import (
    audit_initial,
    sow,
    kickoff_checklist,
    monthly_report,
    agency_weekly_report,
    wikipedia_plan,  # new
    site_plan,       # new
)  # noqa: F401 — import side effect registers templates
```

Match the existing style — if the existing init uses one-line imports or a different shape, conform to it.

- [ ] **Step 8.3: Verify registration at app boot**

```bash
cd backend && python -c "
from app.services.document_engine import wikipedia_plan, site_plan  # noqa
from app.services.document_engine.registry import TEMPLATES
print(sorted(TEMPLATES.keys()))
"
```

Expected output: a list containing both `'site_plan'` and `'wikipedia_plan'` alongside the existing 5.

- [ ] **Step 8.4: Run the full document-template test suite**

```bash
pytest tests/test_agency_document_templates.py -v
```

Expected: 6 PASS.

- [ ] **Step 8.5: Commit**

```bash
git add backend/app/services/document_engine/__init__.py
git commit -m "feat(agency): register wikipedia_plan + site_plan templates"
```

---

## Phase 3 — Dead backend cleanup

### Task 9: Delete dead agency endpoints + schemas + tests

**Files:**
- Modify: `backend/app/routers/agency.py`
- Modify: `backend/app/schemas.py`
- Delete tests for these endpoints (in-place)

- [ ] **Step 9.1: Identify the endpoints to delete**

These 9 endpoints have no frontend consumer (CURRENT_STATE.md confirms 2026-05-21 cleanup) and the redesign drops the last surfaces:

| Method | Path | Line (approx) |
|---|---|---|
| GET | `/agency/today` | 259-339 |
| PATCH | `/agency/drafts/{draft_id}/assign` | 341-370 |
| GET | `/agency/activity/recent` | 567-603 |
| GET | `/agency/clients/{id}/tasks` | 628-647 |
| POST | `/agency/clients/{id}/tasks` | 649-681 |
| PATCH | `/agency/tasks/{task_id}` | 683-732 |
| DELETE | `/agency/tasks/{task_id}` | 734-749 |
| GET | `/agency/my-queue` | 751-791 |
| GET | `/agency/documents/recent` | 934-967 |

Use line numbers as a guide only — line numbers may have shifted from earlier tasks.

- [ ] **Step 9.2: Delete the endpoint handlers**

Open `backend/app/routers/agency.py` and delete each `@router....` decorator and its handler function. Also delete the corresponding helper functions if they were only used by these handlers (e.g., `_task_to_out`).

- [ ] **Step 9.3: Drop the now-unused imports**

After deleting the handlers, run:

```bash
cd backend && python -c "from app.routers import agency"
```

Fix any `ImportError`. Likely you'll need to drop these names from `app.schemas` imports at the top of `agency.py`:

- `ActivityEventWithClientOut`
- `AgencyTaskCreate`
- `AgencyTaskOut`
- `AgencyTaskUpdate`
- `DocumentWithClientOut`
- `DraftAssignIn`
- `MyQueueDraft`
- `MyQueueOut`
- `TodayDraftOut`
- `TodayOut`

And from `app.models` imports:
- `AgencyTask` (if no remaining handler uses it)

Verify by:

```bash
grep -n "AgencyTask\b\|TodayOut\|MyQueueOut" backend/app/routers/agency.py
```

If grep returns no hits, the imports are safe to drop.

- [ ] **Step 9.4: Delete the dead schema classes**

In `backend/app/schemas.py`, delete the following class definitions:

- `TodayOut`
- `TodayDraftOut`
- `MyQueueOut`
- `MyQueueDraft`
- `AgencyTaskOut`
- `AgencyTaskCreate`
- `AgencyTaskUpdate`
- `ActivityEventWithClientOut`
- `DocumentWithClientOut`
- `DraftAssignIn`

Use grep to find them:

```bash
grep -n "^class TodayOut\|^class TodayDraftOut\|^class MyQueueOut\|^class MyQueueDraft\|^class AgencyTaskOut\|^class AgencyTaskCreate\|^class AgencyTaskUpdate\|^class ActivityEventWithClientOut\|^class DocumentWithClientOut\|^class DraftAssignIn" backend/app/schemas.py
```

Delete each class plus any class-level docstring.

- [ ] **Step 9.5: Verify nothing else imports them**

```bash
grep -rn "TodayOut\|MyQueueOut\|AgencyTaskOut\|AgencyTaskCreate\|AgencyTaskUpdate\|ActivityEventWithClientOut\|DocumentWithClientOut\|DraftAssignIn\|MyQueueDraft\|TodayDraftOut" backend/app/
```

Expected: no hits. If you find any, delete the import.

- [ ] **Step 9.6: Delete the corresponding tests**

```bash
grep -rln "/today\b\|/my-queue\|/activity/recent\|/documents/recent\|/drafts/.*/assign\|/clients/.*/tasks\|/tasks/.*" backend/tests/
```

For each test file that hits these endpoints, delete the relevant test functions. Likely candidates:
- `backend/tests/test_agency_today.py` (delete entire file if it exists)
- `backend/tests/test_agency_tasks.py` (delete entire file if it exists)
- `backend/tests/test_agency_activity.py` (delete entire file if it exists)

Confirm before deleting:

```bash
ls backend/tests/test_agency*.py
```

For any file that's now entirely about deleted endpoints, `git rm`. For files with mixed content, just delete the obsolete test functions.

- [ ] **Step 9.7: Run the full agency suite**

```bash
pytest tests/test_agency*.py -v
```

Expected: all remaining PASS. Investigate any failure.

- [ ] **Step 9.8: Commit**

```bash
git add -u backend/
git commit -m "chore(agency): drop dead today/my-queue/tasks/activity/recent-documents endpoints"
```

---

## Phase 4 — Frontend API client

### Task 10: Update `lib/api.ts`

**Files:**
- Modify: `frontend/lib/api.ts`

- [ ] **Step 10.1: Read the current file to find the dead exports**

```bash
grep -n "agencyMyQueue\|agencyToday\|MyQueueResponse\|MyQueueDraft\|AgencyTask\|ActivityEvent\|agencyRecentDocuments\|AgencyDocumentWithClient\|peec_dashboard_url\|agencyAssignDraft" frontend/lib/api.ts
```

This produces the list of lines/types to remove.

- [ ] **Step 10.2: Delete the dead exports**

From `frontend/lib/api.ts`, delete:

- `AgencyTask` interface
- `MyQueueDraft` interface
- `MyQueueResponse` interface
- `agencyMyQueue` function
- `AgencyDocumentWithClient` interface
- `agencyRecentDocuments` function
- `peec_dashboard_url` field from `AgencyClient`, `AgencyClientCreate`, and (if present) any update type

The grep output from 10.1 gives exact line numbers.

- [ ] **Step 10.3: Add milestone types + functions**

Append a new section to `frontend/lib/api.ts` (place after the agency documents section so adjacent agency code stays together):

```typescript
// ── Agency milestones (2026-05-26 playbook redesign) ─────────────────────────

export type MilestoneKind =
  | 'kickoff'
  | 'sow'
  | 'initial_audit'
  | 'strategy_locked'
  | 'wikipedia_plan'
  | 'site_plan';

export type MilestoneStatus = 'not_started' | 'in_progress' | 'done' | 'skipped';

export interface AgencyClientMilestone {
  id: number;
  agency_client_id: number;
  kind: MilestoneKind;
  status: MilestoneStatus;
  started_at: string | null;
  target_at: string | null;
  completed_at: string | null;
  completed_by: number | null;
  completed_by_name: string | null;
  notes: string | null;
}

export interface AgencyClientMilestoneUpdate {
  status?: MilestoneStatus;
  started_at?: string | null;
  target_at?: string | null;
  notes?: string | null;
}

export async function agencyListMilestones(clientId: number): Promise<AgencyClientMilestone[]> {
  const res = await api.get<AgencyClientMilestone[]>(`/agency/clients/${clientId}/milestones`);
  return res.data;
}

export async function agencyUpdateMilestone(
  clientId: number,
  kind: MilestoneKind,
  body: AgencyClientMilestoneUpdate,
): Promise<AgencyClientMilestone> {
  const res = await api.patch<AgencyClientMilestone>(
    `/agency/clients/${clientId}/milestones/${kind}`,
    body,
  );
  return res.data;
}
```

- [ ] **Step 10.4: Verify TypeScript compiles**

```bash
cd frontend && npx tsc --noEmit
```

Expected: 0 errors. If you see errors for components consuming the deleted types (e.g., `MyQueueSection.tsx`), don't fix them yet — those components are deleted in Phase 6. For now just verify that `lib/api.ts` itself has no internal type errors. The component errors will be cleared by Phase 6.

If `tsc` errors come from `lib/api.ts` itself (e.g., a dangling reference) — fix those.

- [ ] **Step 10.5: Commit**

```bash
git add frontend/lib/api.ts
git commit -m "feat(agency): milestone API client + drop dead exports"
```

---

## Phase 5 — Frontend Playbook components

### Task 11: `PlaybookLaunchRow.tsx`

**Files:**
- Create: `frontend/components/agency/PlaybookLaunchRow.tsx`

- [ ] **Step 11.1: Create the component**

Create `frontend/components/agency/PlaybookLaunchRow.tsx`:

```tsx
'use client';

import { useState } from 'react';
import { Check, Circle, FileText, Loader2, RotateCcw } from 'lucide-react';
import {
  agencyUpdateMilestone,
  type AgencyClientMilestone,
  type MilestoneKind,
} from '@/lib/api';

interface Props {
  milestone: AgencyClientMilestone;
  label: string;
  /** If null, no "Generate doc" button is shown (e.g., strategy_locked has no template). */
  docKind: string | null;
  /** Secondary CTA shown beside Generate Doc when docKind is null. */
  secondaryHref?: string;
  secondaryLabel?: string;
  onChanged: (next: AgencyClientMilestone) => void;
  onGenerateDoc?: (kind: string) => void;
}

export function PlaybookLaunchRow({
  milestone,
  label,
  docKind,
  secondaryHref,
  secondaryLabel,
  onChanged,
  onGenerateDoc,
}: Props) {
  const [saving, setSaving] = useState(false);
  const done = milestone.status === 'done';

  const toggle = async () => {
    setSaving(true);
    try {
      const next = await agencyUpdateMilestone(milestone.agency_client_id, milestone.kind, {
        status: done ? 'not_started' : 'done',
      });
      onChanged(next);
    } finally {
      setSaving(false);
    }
  };

  const completedAtLabel = milestone.completed_at
    ? new Date(milestone.completed_at + (milestone.completed_at.endsWith('Z') ? '' : 'Z'))
        .toLocaleDateString()
    : null;

  return (
    <div className="flex items-center gap-3 rounded-md border border-[var(--border-subtle)] bg-[var(--bg-card)] p-3">
      <button
        onClick={toggle}
        disabled={saving}
        className="flex h-6 w-6 items-center justify-center rounded-full border border-[var(--border-default)] text-[var(--text-secondary)] hover:bg-[var(--bg-raised)] disabled:opacity-50"
        aria-label={done ? 'Mark not done' : 'Mark done'}
      >
        {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : done ? <Check className="h-3 w-3 text-emerald-400" /> : <Circle className="h-3 w-3" />}
      </button>

      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium text-[var(--text-primary)]">{label}</div>
        <div className="text-xs text-[var(--text-muted)]">
          {done
            ? `Completed ${completedAtLabel ?? ''}${milestone.completed_by_name ? ` by ${milestone.completed_by_name}` : ''}`
            : milestone.status === 'in_progress'
              ? 'In progress'
              : 'Not started'}
        </div>
      </div>

      <div className="flex items-center gap-2 shrink-0">
        {docKind && onGenerateDoc && (
          <button
            onClick={() => onGenerateDoc(docKind)}
            className="flex items-center gap-1 rounded-md border border-[var(--border-default)] px-2.5 py-1 text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-raised)]"
          >
            <FileText className="h-3 w-3" />
            Generate doc
          </button>
        )}
        {!docKind && secondaryHref && secondaryLabel && (
          <a
            href={secondaryHref}
            className="rounded-md border border-[var(--border-default)] px-2.5 py-1 text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-raised)]"
          >
            {secondaryLabel}
          </a>
        )}
        {done && (
          <button
            onClick={toggle}
            disabled={saving}
            className="flex items-center gap-1 rounded-md px-2 py-1 text-xs text-[var(--text-muted)] hover:text-[var(--text-secondary)] disabled:opacity-50"
            title="Undo"
          >
            <RotateCcw className="h-3 w-3" />
          </button>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 11.2: Verify TS compiles for this file**

```bash
cd frontend && npx tsc --noEmit --pretty 2>&1 | grep PlaybookLaunchRow || echo "ok"
```

Expected: `ok` (no errors reported for this file).

- [ ] **Step 11.3: Commit**

```bash
git add frontend/components/agency/PlaybookLaunchRow.tsx
git commit -m "feat(agency): PlaybookLaunchRow component"
```

---

### Task 12: `PlaybookEngagement.tsx`

**Files:**
- Create: `frontend/components/agency/PlaybookEngagement.tsx`

- [ ] **Step 12.1: Create the component**

Create `frontend/components/agency/PlaybookEngagement.tsx`:

```tsx
'use client';

import { useState } from 'react';
import Link from 'next/link';
import { ArrowUpRight, FileText, Loader2 } from 'lucide-react';
import {
  agencyUpdateMilestone,
  type AgencyClientMilestone,
} from '@/lib/api';

interface Props {
  milestone: AgencyClientMilestone;
  label: string;
  docKind: string;
  deepLinkHref: string;
  deepLinkLabel: string;
  /** Short summary rendered between header + actions, e.g. "12 candidates · 4 drafted · 1 submitted" */
  summary?: React.ReactNode;
  onChanged: (next: AgencyClientMilestone) => void;
  onGenerateDoc: (kind: string) => void;
}

function fmtDate(iso: string | null): string {
  if (!iso) return '—';
  const norm = /[Zz]|[+-]\d{2}:?\d{2}$/.test(iso) ? iso : iso + 'Z';
  return new Date(norm).toLocaleDateString();
}

function isOverdue(targetIso: string | null, status: string): boolean {
  if (!targetIso || status === 'done' || status === 'skipped') return false;
  const norm = /[Zz]|[+-]\d{2}:?\d{2}$/.test(targetIso) ? targetIso : targetIso + 'Z';
  return new Date(norm).getTime() < Date.now();
}

export function PlaybookEngagement({
  milestone,
  label,
  docKind,
  deepLinkHref,
  deepLinkLabel,
  summary,
  onChanged,
  onGenerateDoc,
}: Props) {
  const [saving, setSaving] = useState(false);
  const overdue = isOverdue(milestone.target_at, milestone.status);

  const setStatus = async (status: 'in_progress' | 'done' | 'not_started') => {
    setSaving(true);
    try {
      // Auto-set started_at when transitioning into in_progress for the first time
      const body: { status: typeof status; started_at?: string } = { status };
      if (status === 'in_progress' && !milestone.started_at) {
        body.started_at = new Date().toISOString();
      }
      const next = await agencyUpdateMilestone(milestone.agency_client_id, milestone.kind, body);
      onChanged(next);
    } finally {
      setSaving(false);
    }
  };

  const setTarget = async (iso: string) => {
    setSaving(true);
    try {
      const next = await agencyUpdateMilestone(milestone.agency_client_id, milestone.kind, {
        target_at: iso,
      });
      onChanged(next);
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-card)] p-4">
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="text-sm font-medium text-[var(--text-primary)]">{label}</h3>
        <span
          className={`text-xs ${
            overdue ? 'text-rose-400' : 'text-[var(--text-muted)]'
          }`}
        >
          started {fmtDate(milestone.started_at)} · target {fmtDate(milestone.target_at)}{overdue ? ' · overdue' : ''} · {milestone.status.replace('_', ' ')}
        </span>
      </div>

      {summary && <div className="mt-2 text-xs text-[var(--text-secondary)]">{summary}</div>}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          onClick={() => onGenerateDoc(docKind)}
          className="flex items-center gap-1 rounded-md border border-[var(--border-default)] px-2.5 py-1 text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-raised)]"
        >
          <FileText className="h-3 w-3" />
          Generate doc
        </button>
        <Link
          href={deepLinkHref}
          className="flex items-center gap-1 rounded-md border border-[var(--border-default)] px-2.5 py-1 text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-raised)]"
        >
          <ArrowUpRight className="h-3 w-3" />
          {deepLinkLabel}
        </Link>

        <input
          type="date"
          value={milestone.target_at ? milestone.target_at.slice(0, 10) : ''}
          onChange={(e) => {
            if (e.target.value) setTarget(new Date(e.target.value).toISOString());
          }}
          className="rounded-md border border-[var(--border-default)] bg-[var(--bg-raised)] px-2 py-1 text-xs text-[var(--text-secondary)]"
          title="Target completion date"
        />

        <div className="ml-auto flex items-center gap-1">
          {milestone.status !== 'in_progress' && milestone.status !== 'done' && (
            <button
              onClick={() => setStatus('in_progress')}
              disabled={saving}
              className="rounded-md border border-[var(--border-default)] px-2.5 py-1 text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-raised)] disabled:opacity-50"
            >
              {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Mark started'}
            </button>
          )}
          {milestone.status !== 'done' && (
            <button
              onClick={() => setStatus('done')}
              disabled={saving}
              className="rounded-md border border-[var(--border-default)] px-2.5 py-1 text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-raised)] disabled:opacity-50"
            >
              Mark complete
            </button>
          )}
          {milestone.status === 'done' && (
            <button
              onClick={() => setStatus('in_progress')}
              disabled={saving}
              className="rounded-md px-2 py-1 text-xs text-[var(--text-muted)] hover:text-[var(--text-secondary)] disabled:opacity-50"
            >
              Reopen
            </button>
          )}
        </div>
      </div>
    </section>
  );
}
```

- [ ] **Step 12.2: TS check**

```bash
cd frontend && npx tsc --noEmit --pretty 2>&1 | grep PlaybookEngagement || echo "ok"
```

Expected: `ok`.

- [ ] **Step 12.3: Commit**

```bash
git add frontend/components/agency/PlaybookEngagement.tsx
git commit -m "feat(agency): PlaybookEngagement component (wikipedia/site plan)"
```

---

### Task 13: `PlaybookWeeklyExecution.tsx`

**Files:**
- Create: `frontend/components/agency/PlaybookWeeklyExecution.tsx`

- [ ] **Step 13.1: Read the existing pipeline + helpers**

```bash
sed -n '1,80p' frontend/components/agency/ClientPipelineTab.tsx
cat frontend/components/agency/agency-helpers.ts
```

`ClientPipelineTab` is the drafts table we'll embed as the drawer. `agency-helpers.ts` provides `isDraftStale` and `nudgeMessageText`.

- [ ] **Step 13.2: Create the component**

Create `frontend/components/agency/PlaybookWeeklyExecution.tsx`:

```tsx
'use client';

import { useState } from 'react';
import { ChevronDown, ChevronRight, Loader2, Send } from 'lucide-react';
import type { ContentDraft, TrackingRun } from '@/lib/api';
import { ClientPipelineTab } from './ClientPipelineTab';
import { GenerateDraftButton } from './GenerateDraftButton';
import { RunTrackingButton } from './RunTrackingButton';
import { isDraftStale } from './agency-helpers';

type AgencyDraft = Omit<ContentDraft, 'status'> & {
  status: string;
  client_feedback?: string | null;
  updated_at?: string | null;
};

interface Props {
  clientId: number;
  brandId: number | null;
  drafts: AgencyDraft[] | null;
  latestRunIso: string | null;
  reviewLinkUrl: string | null;
  primaryContactName: string | null;
  onDraftsChanged: () => void;
  onTrackingTriggered: () => void;
  onOpenSendModal: () => void;
}

function daysSince(iso: string | null): number | null {
  if (!iso) return null;
  const norm = /[Zz]|[+-]\d{2}:?\d{2}$/.test(iso) ? iso : iso + 'Z';
  return Math.floor((Date.now() - new Date(norm).getTime()) / 86_400_000);
}

export function PlaybookWeeklyExecution({
  clientId,
  brandId,
  drafts,
  latestRunIso,
  reviewLinkUrl,
  primaryContactName,
  onDraftsChanged,
  onTrackingTriggered,
  onOpenSendModal,
}: Props) {
  const [drawerOpen, setDrawerOpen] = useState(false);

  if (drafts == null) {
    return (
      <section className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-card)] p-4 text-sm text-[var(--text-muted)]">
        <Loader2 className="inline h-3 w-3 animate-spin" /> Loading drafts…
      </section>
    );
  }

  let toReview = 0;
  let approved = 0;
  let staleWithClient = 0;
  let inFlight = 0;
  for (const d of drafts) {
    if (d.status === 'draft' || d.status === 'changes_requested') toReview++;
    if (d.status === 'approved') approved++;
    if (d.status === 'awaiting_client' && isDraftStale(d)) staleWithClient++;
    if (['draft', 'changes_requested', 'awaiting_client', 'approved'].includes(d.status)) inFlight++;
  }

  const daysStale = daysSince(latestRunIso);
  const trackingStale = daysStale == null || daysStale >= 14;

  const rows: React.ReactNode[] = [];
  if (toReview > 0) {
    rows.push(
      <li key="review" className="flex items-center justify-between gap-3 py-1.5 text-sm">
        <span>{toReview} draft{toReview === 1 ? '' : 's'} ready for your review</span>
        <button
          onClick={() => setDrawerOpen(true)}
          className="text-xs text-[var(--accent-foreground)] hover:underline"
        >
          Open Pipeline ↓
        </button>
      </li>
    );
  }
  if (approved > 0) {
    rows.push(
      <li key="approved" className="flex items-center justify-between gap-3 py-1.5 text-sm">
        <span>{approved} approved draft{approved === 1 ? '' : 's'} — send to client review</span>
        <button
          onClick={onOpenSendModal}
          className="flex items-center gap-1 rounded-md border border-[var(--border-default)] bg-[var(--bg-elevated)] px-2.5 py-1 text-xs text-[var(--text-primary)] hover:bg-[var(--bg-raised)]"
        >
          <Send className="h-3 w-3" />
          Send drafts
        </button>
      </li>
    );
  }
  if (staleWithClient > 0) {
    rows.push(
      <li key="nudge" className="flex items-center justify-between gap-3 py-1.5 text-sm">
        <span>{staleWithClient} draft{staleWithClient === 1 ? '' : 's'} pending client review for too long</span>
        <span className="text-xs text-[var(--text-muted)]">Use Copy nudge in the header</span>
      </li>
    );
  }
  if (trackingStale) {
    rows.push(
      <li key="tracking" className="flex items-center justify-between gap-3 py-1.5 text-sm">
        <span>
          Tracking last ran {daysStale == null ? 'never' : `${daysStale} days ago`}
        </span>
        <RunTrackingButton clientId={clientId} onTriggered={onTrackingTriggered} />
      </li>
    );
  }
  if (rows.length === 0) {
    rows.push(
      <li key="ok" className="py-1.5 text-sm text-emerald-400">All weekly execution caught up.</li>
    );
  }

  return (
    <section className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-card)] p-4">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-medium text-[var(--text-primary)]">
          Weekly execution{' '}
          <span className="text-xs text-[var(--text-muted)]">
            (active — {rows.length === 1 && drafts.length === 0 ? '0' : `${toReview + approved + (trackingStale ? 1 : 0)}`} items)
          </span>
        </h3>
        <GenerateDraftButton clientId={clientId} brandId={brandId} onGenerated={onDraftsChanged} />
      </div>

      <ul className="mt-2 divide-y divide-[var(--border-subtle)]">{rows}</ul>

      <button
        onClick={() => setDrawerOpen((v) => !v)}
        className="mt-3 flex items-center gap-1 text-xs text-[var(--text-muted)] hover:text-[var(--text-secondary)]"
      >
        {drawerOpen ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
        Pipeline drawer
      </button>

      {drawerOpen && (
        <div className="mt-3 border-t border-[var(--border-subtle)] pt-3">
          <ClientPipelineTab
            brandId={brandId}
            reviewLinkUrl={reviewLinkUrl}
            primaryContactName={primaryContactName}
            lifted={drafts}
            onDraftsChanged={onDraftsChanged}
          />
        </div>
      )}
    </section>
  );
}
```

- [ ] **Step 13.3: TS check**

```bash
cd frontend && npx tsc --noEmit --pretty 2>&1 | grep PlaybookWeeklyExecution || echo "ok"
```

Expected: `ok`.

- [ ] **Step 13.4: Commit**

```bash
git add frontend/components/agency/PlaybookWeeklyExecution.tsx
git commit -m "feat(agency): PlaybookWeeklyExecution component with pipeline drawer"
```

---

### Task 14: `PlaybookReports.tsx`

**Files:**
- Create: `frontend/components/agency/PlaybookReports.tsx`

- [ ] **Step 14.1: Create the component**

Create `frontend/components/agency/PlaybookReports.tsx`:

```tsx
'use client';

import { useState } from 'react';
import { FileText, Loader2 } from 'lucide-react';
import { agencyGenerateDocument, type AgencyDocument } from '@/lib/api';

interface Props {
  clientId: number;
  lastWeekly: AgencyDocument | null;
  lastMonthly: AgencyDocument | null;
  onGenerated: (doc: AgencyDocument) => void;
}

function fmt(doc: AgencyDocument | null): string {
  if (!doc) return 'never';
  const iso = doc.generated_at + (doc.generated_at.endsWith('Z') ? '' : 'Z');
  return new Date(iso).toLocaleDateString() + (doc.generated_by_name ? ` by ${doc.generated_by_name}` : '');
}

export function PlaybookReports({ clientId, lastWeekly, lastMonthly, onGenerated }: Props) {
  const [busyKind, setBusyKind] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const generate = async (kind: 'agency_weekly_report' | 'monthly_report') => {
    setBusyKind(kind);
    setError(null);
    try {
      const doc = await agencyGenerateDocument(clientId, kind);
      onGenerated(doc);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to generate');
    } finally {
      setBusyKind(null);
    }
  };

  return (
    <section className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-card)] p-4">
      <h3 className="text-sm font-medium text-[var(--text-primary)]">Reports</h3>

      <div className="mt-2 space-y-2">
        <div className="flex items-center justify-between gap-3 text-sm">
          <div>
            Weekly · last generated <span className="text-[var(--text-muted)]">{fmt(lastWeekly)}</span>
          </div>
          <button
            onClick={() => generate('agency_weekly_report')}
            disabled={busyKind != null}
            className="flex items-center gap-1 rounded-md border border-[var(--border-default)] px-2.5 py-1 text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-raised)] disabled:opacity-50"
          >
            {busyKind === 'agency_weekly_report' ? <Loader2 className="h-3 w-3 animate-spin" /> : <FileText className="h-3 w-3" />}
            Generate this week's
          </button>
        </div>

        <div className="flex items-center justify-between gap-3 text-sm">
          <div>
            Monthly · last generated <span className="text-[var(--text-muted)]">{fmt(lastMonthly)}</span>
          </div>
          <button
            onClick={() => generate('monthly_report')}
            disabled={busyKind != null}
            className="flex items-center gap-1 rounded-md border border-[var(--border-default)] px-2.5 py-1 text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-raised)] disabled:opacity-50"
          >
            {busyKind === 'monthly_report' ? <Loader2 className="h-3 w-3 animate-spin" /> : <FileText className="h-3 w-3" />}
            Generate this month's
          </button>
        </div>
      </div>

      {error && <p className="mt-2 text-xs text-rose-400">{error}</p>}
    </section>
  );
}
```

- [ ] **Step 14.2: TS check**

```bash
cd frontend && npx tsc --noEmit --pretty 2>&1 | grep PlaybookReports || echo "ok"
```

Expected: `ok`.

- [ ] **Step 14.3: Commit**

```bash
git add frontend/components/agency/PlaybookReports.tsx
git commit -m "feat(agency): PlaybookReports component"
```

---

### Task 15: `PlaybookTab.tsx` orchestrator

**Files:**
- Create: `frontend/components/agency/PlaybookTab.tsx`

- [ ] **Step 15.1: Create the orchestrator**

Create `frontend/components/agency/PlaybookTab.tsx`:

```tsx
'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  agencyGenerateDocument,
  agencyListDocuments,
  agencyListMilestones,
  type AgencyClient,
  type AgencyClientMilestone,
  type AgencyDocument,
  type ContentDraft,
  type MilestoneKind,
  type TrackingRun,
} from '@/lib/api';
import { DocumentViewer } from './DocumentViewer';
import { PlaybookEngagement } from './PlaybookEngagement';
import { PlaybookLaunchRow } from './PlaybookLaunchRow';
import { PlaybookReports } from './PlaybookReports';
import { PlaybookWeeklyExecution } from './PlaybookWeeklyExecution';

type AgencyDraft = Omit<ContentDraft, 'status'> & {
  status: string;
  client_feedback?: string | null;
  updated_at?: string | null;
};

interface Props {
  client: AgencyClient;
  drafts: AgencyDraft[] | null;
  latestRunIso: string | null;
  reviewLinkUrl: string | null;
  onDraftsChanged: () => void;
  onTrackingTriggered: () => void;
  onOpenSendModal: () => void;
}

const LAUNCH_LABELS: Record<string, { label: string; docKind: string | null; secondary?: { href: string; label: string } }> = {
  kickoff:         { label: 'Kickoff',          docKind: 'kickoff_checklist' },
  sow:             { label: 'SOW',              docKind: 'sow' },
  initial_audit:   { label: 'Initial audit',    docKind: 'audit_initial' },
  strategy_locked: { label: 'Strategy locked',  docKind: null, secondary: { href: '?tab=brand', label: 'Open Brand → Prompts' } },
};

export function PlaybookTab({
  client,
  drafts,
  latestRunIso,
  reviewLinkUrl,
  onDraftsChanged,
  onTrackingTriggered,
  onOpenSendModal,
}: Props) {
  const [milestones, setMilestones] = useState<AgencyClientMilestone[] | null>(null);
  const [reports, setReports] = useState<{ weekly: AgencyDocument | null; monthly: AgencyDocument | null }>({
    weekly: null,
    monthly: null,
  });
  const [viewerDoc, setViewerDoc] = useState<AgencyDocument | null>(null);
  const [genError, setGenError] = useState<string | null>(null);

  // Load milestones
  useEffect(() => {
    agencyListMilestones(client.id).then(setMilestones).catch(() => setMilestones([]));
  }, [client.id]);

  // Load latest weekly + monthly report
  useEffect(() => {
    Promise.all([
      agencyListDocuments(client.id, 'agency_weekly_report'),
      agencyListDocuments(client.id, 'monthly_report'),
    ]).then(([w, m]) => {
      setReports({ weekly: w[0] ?? null, monthly: m[0] ?? null });
    });
  }, [client.id]);

  const byKind = useMemo(() => {
    const m = new Map<string, AgencyClientMilestone>();
    for (const ms of milestones ?? []) m.set(ms.kind, ms);
    return m;
  }, [milestones]);

  const upsertMilestone = (next: AgencyClientMilestone) => {
    setMilestones((prev) =>
      (prev ?? []).map((m) => (m.kind === next.kind ? next : m)),
    );
  };

  const generateDoc = async (kind: string) => {
    setGenError(null);
    try {
      const doc = await agencyGenerateDocument(client.id, kind);
      setViewerDoc(doc);
      if (kind === 'agency_weekly_report') setReports((r) => ({ ...r, weekly: doc }));
      if (kind === 'monthly_report') setReports((r) => ({ ...r, monthly: doc }));
    } catch (e) {
      setGenError(e instanceof Error ? e.message : 'Failed to generate document');
    }
  };

  if (milestones == null) {
    return <div className="text-sm text-[var(--text-muted)]">Loading playbook…</div>;
  }

  return (
    <div className="space-y-6">
      {/* Launch */}
      <section>
        <h2 className="mb-2 text-xs font-medium uppercase tracking-wide text-[var(--text-muted)]">
          Launch
        </h2>
        <div className="space-y-2">
          {(['kickoff', 'sow', 'initial_audit', 'strategy_locked'] as const).map((k) => {
            const m = byKind.get(k);
            if (!m) return null;
            const cfg = LAUNCH_LABELS[k];
            return (
              <PlaybookLaunchRow
                key={k}
                milestone={m}
                label={cfg.label}
                docKind={cfg.docKind}
                secondaryHref={cfg.secondary?.href}
                secondaryLabel={cfg.secondary?.label}
                onChanged={upsertMilestone}
                onGenerateDoc={generateDoc}
              />
            );
          })}
        </div>
      </section>

      {/* Engagements */}
      <section>
        <h2 className="mb-2 text-xs font-medium uppercase tracking-wide text-[var(--text-muted)]">
          Engagements
        </h2>
        <div className="space-y-3">
          <PlaybookWeeklyExecution
            clientId={client.id}
            brandId={client.brand_id}
            drafts={drafts}
            latestRunIso={latestRunIso}
            reviewLinkUrl={reviewLinkUrl}
            primaryContactName={client.primary_contact_name}
            onDraftsChanged={onDraftsChanged}
            onTrackingTriggered={onTrackingTriggered}
            onOpenSendModal={onOpenSendModal}
          />

          {byKind.get('wikipedia_plan') && (
            <PlaybookEngagement
              milestone={byKind.get('wikipedia_plan')!}
              label="Wikipedia plan"
              docKind="wikipedia_plan"
              deepLinkHref={client.brand_id ? `/wiki/${client.brand_id}` : '#'}
              deepLinkLabel="Open Wikipedia surface"
              onChanged={upsertMilestone}
              onGenerateDoc={generateDoc}
            />
          )}

          {byKind.get('site_plan') && (
            <PlaybookEngagement
              milestone={byKind.get('site_plan')!}
              label="Site plan"
              docKind="site_plan"
              deepLinkHref={client.brand_id ? `/site-audit/${client.brand_id}` : '#'}
              deepLinkLabel="Open Site Audit"
              onChanged={upsertMilestone}
              onGenerateDoc={generateDoc}
            />
          )}

          <PlaybookReports
            clientId={client.id}
            lastWeekly={reports.weekly}
            lastMonthly={reports.monthly}
            onGenerated={(doc) => {
              setViewerDoc(doc);
              if (doc.kind === 'agency_weekly_report') setReports((r) => ({ ...r, weekly: doc }));
              if (doc.kind === 'monthly_report') setReports((r) => ({ ...r, monthly: doc }));
            }}
          />
        </div>
      </section>

      {genError && <p className="text-sm text-rose-400">{genError}</p>}

      <DocumentViewer
        doc={viewerDoc}
        onClose={() => setViewerDoc(null)}
        onChange={(next) => setViewerDoc(next)}
        onDelete={() => setViewerDoc(null)}
      />
    </div>
  );
}
```

- [ ] **Step 15.2: TS check**

```bash
cd frontend && npx tsc --noEmit --pretty 2>&1 | grep PlaybookTab || echo "ok"
```

Expected: `ok`.

- [ ] **Step 15.3: Commit**

```bash
git add frontend/components/agency/PlaybookTab.tsx
git commit -m "feat(agency): PlaybookTab orchestrator"
```

---

## Phase 6 — Cockpit rewrite + sidebar + deletions

### Task 16: Rewrite `ClientCockpit.tsx` and delete `ClientNextStepShelf.tsx`

**Files:**
- Modify: `frontend/components/agency/ClientCockpit.tsx`
- Delete: `frontend/components/agency/ClientNextStepShelf.tsx`

- [ ] **Step 16.1: Replace ClientCockpit.tsx**

Open `frontend/components/agency/ClientCockpit.tsx` and replace its contents with:

```tsx
'use client';

import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import {
  ChevronDown,
  Mail,
  User,
  Video as VideoIcon,
} from 'lucide-react';
import {
  agencyUpdateClient,
  getDrafts,
  getRecentRuns,
  type AgencyClient,
  type ContentDraft,
  type TrackingRun,
} from '@/lib/api';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import { ClientBrandTab } from './ClientBrandTab';
import { ClientStaffPanel } from './ClientStaffPanel';
import { LumidianTrackingWidget } from './LumidianTrackingWidget';
import { PromptScoresPanel } from './PromptScoresPanel';
import { RunTrackingButton } from './RunTrackingButton';
import { AuditSummaryCard } from './AuditSummaryCard';
import { CopyReviewLinkButton } from './CopyReviewLinkButton';
import { SendDraftsToClientModal } from './SendDraftsToClientModal';
import { PlaybookTab } from './PlaybookTab';

interface Props {
  client: AgencyClient;
  onChange: (next: AgencyClient) => void;
  reviewLinkUrl: string | null;
}

const STATUSES: AgencyClient['status'][] = ['onboarding', 'active', 'paused', 'churned'];

const STATUS_COLORS: Record<AgencyClient['status'], string> = {
  onboarding: 'bg-amber-500/20 text-amber-300',
  active: 'bg-emerald-500/20 text-emerald-300',
  paused: 'bg-slate-500/20 text-slate-300',
  churned: 'bg-rose-500/20 text-rose-300',
};

const TABS = ['playbook', 'tracking', 'audit', 'brand'] as const;
const LEGACY_TAB_REDIRECTS: Record<string, string> = {
  pipeline: 'playbook',
  documents: 'brand',
};
type TabKey = (typeof TABS)[number];

type AgencyDraft = Omit<ContentDraft, 'status'> & {
  status: string;
  client_feedback?: string | null;
  updated_at?: string | null;
};

export function ClientCockpit({ client, onChange, reviewLinkUrl }: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const tabFromUrl = searchParams.get('tab') ?? '';
  const initialTab: TabKey =
    (TABS as readonly string[]).includes(tabFromUrl)
      ? (tabFromUrl as TabKey)
      : ((LEGACY_TAB_REDIRECTS[tabFromUrl] as TabKey | undefined) ?? 'playbook');
  const [tab, setTab] = useState<TabKey>(initialTab);

  const [saving, setSaving] = useState(false);
  const [statusError, setStatusError] = useState<string | null>(null);

  const [drafts, setDrafts] = useState<AgencyDraft[] | null>(null);
  const [latestRunIso, setLatestRunIso] = useState<string | null>(null);
  const [trackingRefreshKey, setTrackingRefreshKey] = useState(0);
  const [draftsRefreshKey, setDraftsRefreshKey] = useState(0);

  const [sendDraftsOpen, setSendDraftsOpen] = useState(false);

  // Drafts
  useEffect(() => {
    if (client.brand_id == null) {
      setDrafts([]);
      return;
    }
    getDrafts(client.brand_id)
      .then((data) => setDrafts(data as AgencyDraft[]))
      .catch(() => setDrafts([]));
  }, [client.brand_id, draftsRefreshKey]);

  // Latest tracking run
  useEffect(() => {
    if (client.brand_id == null) {
      setLatestRunIso(null);
      return;
    }
    getRecentRuns(client.brand_id)
      .then((runs: TrackingRun[]) => {
        const completed = runs
          .filter((r) => r.completed_at)
          .sort((a, b) => new Date(b.completed_at as string).getTime() - new Date(a.completed_at as string).getTime());
        setLatestRunIso(completed[0]?.completed_at ?? null);
      })
      .catch(() => setLatestRunIso(null));
  }, [client.brand_id, trackingRefreshKey]);

  // On mount, normalize legacy ?tab values into ?tab=playbook etc.
  useEffect(() => {
    if (tabFromUrl && !(TABS as readonly string[]).includes(tabFromUrl)) {
      const params = new URLSearchParams(searchParams.toString());
      params.set('tab', initialTab);
      router.replace(`?${params.toString()}`, { scroll: false });
    }
  }, [tabFromUrl, initialTab, router, searchParams]);

  const handleTabChange = (next: string) => {
    setTab(next as TabKey);
    const params = new URLSearchParams(searchParams.toString());
    params.set('tab', next);
    router.replace(`?${params.toString()}`, { scroll: false });
  };

  const updateStatus = async (status: AgencyClient['status']) => {
    setSaving(true);
    setStatusError(null);
    try {
      const next = await agencyUpdateClient(client.id, { status });
      onChange(next);
    } catch (err) {
      setStatusError(err instanceof Error ? err.message : 'Failed to update.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="p-8 text-[var(--text-primary)]">
      <Link href="/agency/clients" className="text-xs text-[var(--text-muted)] hover:underline">
        ← All clients
      </Link>

      {/* Header */}
      <div className="mt-2 flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="truncate text-2xl font-semibold tracking-tight">{client.name}</h1>
          <p className="text-sm text-[var(--text-muted)]">/{client.slug}</p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                disabled={saving}
                className={`flex items-center gap-1 rounded-full px-3 py-1 text-xs font-medium ${STATUS_COLORS[client.status]} hover:opacity-90 disabled:opacity-50`}
              >
                {client.status}
                <ChevronDown className="h-3 w-3 opacity-70" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuLabel>Set status</DropdownMenuLabel>
              <DropdownMenuSeparator />
              {STATUSES.map((s) => (
                <DropdownMenuItem key={s} onSelect={() => updateStatus(s)} disabled={s === client.status}>
                  {s}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>

          {client.retainer_amount_usd != null && (
            <span className="rounded-full bg-[var(--bg-card)] px-3 py-1 text-xs text-[var(--text-secondary)]">
              ${client.retainer_amount_usd}/mo
            </span>
          )}

          {(client.primary_contact_name || client.primary_contact_email) && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  className="rounded-md border border-[var(--border-default)] bg-[var(--bg-card)] p-1.5 text-[var(--text-secondary)] hover:bg-[var(--bg-raised)]"
                  title="Contact"
                >
                  <User className="h-3.5 w-3.5" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuLabel>Primary contact</DropdownMenuLabel>
                <DropdownMenuSeparator />
                {client.primary_contact_name && (
                  <DropdownMenuItem disabled className="flex gap-2 opacity-100">
                    <User className="h-3.5 w-3.5" />
                    {client.primary_contact_name}
                  </DropdownMenuItem>
                )}
                {client.primary_contact_email && (
                  <DropdownMenuItem
                    onSelect={() => { window.location.href = `mailto:${client.primary_contact_email}`; }}
                    className="flex gap-2"
                  >
                    <Mail className="h-3.5 w-3.5" />
                    {client.primary_contact_email}
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          )}

          <Link
            href={`/agency/clients/${client.id}/video`}
            className="flex items-center gap-1.5 rounded-md border border-[var(--border-default)] bg-[var(--bg-card)] px-2.5 py-1 text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-raised)]"
          >
            <VideoIcon className="h-3 w-3" />
            Video studio
          </Link>

          <CopyReviewLinkButton clientId={client.id} />
        </div>
      </div>

      {statusError && <p className="mt-3 text-sm text-red-400">{statusError}</p>}

      {/* Tabs */}
      <Tabs value={tab} onValueChange={handleTabChange} className="mt-6">
        <TabsList>
          <TabsTrigger value="playbook">Playbook</TabsTrigger>
          <TabsTrigger value="tracking">Tracking</TabsTrigger>
          <TabsTrigger value="audit">Audit</TabsTrigger>
          <TabsTrigger value="brand">Brand</TabsTrigger>
        </TabsList>

        <TabsContent value="playbook" className="mt-6">
          <PlaybookTab
            client={client}
            drafts={drafts}
            latestRunIso={latestRunIso}
            reviewLinkUrl={reviewLinkUrl}
            onDraftsChanged={() => setDraftsRefreshKey((k) => k + 1)}
            onTrackingTriggered={() => setTrackingRefreshKey((k) => k + 1)}
            onOpenSendModal={() => setSendDraftsOpen(true)}
          />
        </TabsContent>

        <TabsContent value="tracking" className="mt-6">
          <div className="mb-4 flex items-center justify-end">
            <RunTrackingButton
              clientId={client.id}
              onTriggered={() => setTrackingRefreshKey((k) => k + 1)}
            />
          </div>
          <LumidianTrackingWidget key={trackingRefreshKey} brandId={client.brand_id} />
          <div className="mt-4">
            <PromptScoresPanel brandId={client.brand_id} />
          </div>
        </TabsContent>

        <TabsContent value="audit" className="mt-6">
          <AuditSummaryCard clientId={client.id} brandId={client.brand_id} />
        </TabsContent>

        <TabsContent value="brand" className="mt-6">
          <div className="mb-4">
            <ClientStaffPanel clientId={client.id} />
          </div>
          <ClientBrandTab brandId={client.brand_id} clientId={client.id} />
        </TabsContent>
      </Tabs>

      <SendDraftsToClientModal
        open={sendDraftsOpen}
        onOpenChange={setSendDraftsOpen}
        clientId={client.id}
        clientName={client.name}
        brandId={client.brand_id}
        primaryContactName={client.primary_contact_name}
        primaryContactEmail={client.primary_contact_email ?? null}
        onSent={() => setDraftsRefreshKey((k) => k + 1)}
      />
    </div>
  );
}
```

- [ ] **Step 16.2: Delete `ClientNextStepShelf.tsx`**

```bash
git rm frontend/components/agency/ClientNextStepShelf.tsx
```

- [ ] **Step 16.3: Verify TS compiles (cockpit + playbook chain)**

```bash
cd frontend && npx tsc --noEmit --pretty 2>&1 | head -50
```

Likely remaining errors:
- `ClientBrandTab.tsx` — `clientId` prop doesn't exist yet (added in Task 17).
- References to deleted exports from a few files we'll delete in Task 21.

If only those, proceed. If anything else, fix before commit.

- [ ] **Step 16.4: Commit**

```bash
git add frontend/components/agency/ClientCockpit.tsx
git rm --cached frontend/components/agency/ClientNextStepShelf.tsx 2>/dev/null || true
git commit -m "feat(agency): cockpit collapses to 4 tabs with Playbook default; drop NextStepShelf"
```

---

### Task 17: Append Documents history to `ClientBrandTab.tsx`

**Files:**
- Modify: `frontend/components/agency/ClientBrandTab.tsx`

- [ ] **Step 17.1: Read the current file**

```bash
cat frontend/components/agency/ClientBrandTab.tsx
```

Note its current props and structure.

- [ ] **Step 17.2: Add `clientId` prop and embed `DocumentList` at the bottom**

In `frontend/components/agency/ClientBrandTab.tsx`:

1. Add `clientId: number;` to the Props interface.
2. Import `DocumentList`: `import { DocumentList } from './DocumentList';`
3. At the bottom of the rendered JSX (just before the outermost closing tag), append:

```tsx
      <div className="mt-8">
        <DocumentList clientId={clientId} />
      </div>
```

- [ ] **Step 17.3: TS check**

```bash
cd frontend && npx tsc --noEmit --pretty 2>&1 | grep -E "ClientBrandTab|ClientCockpit" || echo "ok"
```

Expected: `ok`. If `ClientCockpit` still complains about a missing prop somewhere else that passes `<ClientBrandTab>` without `clientId`, search for all usages:

```bash
grep -rn "<ClientBrandTab" frontend/
```

Fix each remaining call site by passing `clientId={client.id}`.

- [ ] **Step 17.4: Commit**

```bash
git add frontend/components/agency/ClientBrandTab.tsx
git commit -m "feat(agency): Brand tab gets read-only Documents history"
```

---

### Task 18: Update `AgencySidebar.tsx`

**Files:**
- Modify: `frontend/components/agency/AgencySidebar.tsx`

- [ ] **Step 18.1: Replace the NAV array**

In `frontend/components/agency/AgencySidebar.tsx`, replace the `NAV` constant with:

```tsx
const NAV = [
  { href: '/agency/clients', label: 'Clients', icon: Users, exact: false },
  { href: '/agency/prospects', label: 'Prospects', icon: Crosshair, exact: false },
  { href: '/agency/settings', label: 'Settings', icon: SettingsIcon, exact: false },
];
```

Remove the `Home` and `FileText` imports if they're no longer used. Verify with:

```bash
grep -n "Home\b\|FileText\b" frontend/components/agency/AgencySidebar.tsx
```

If grep returns no remaining usage, delete those names from the `lucide-react` import line.

- [ ] **Step 18.2: TS check + sidebar visual sanity**

```bash
cd frontend && npx tsc --noEmit --pretty 2>&1 | grep AgencySidebar || echo "ok"
```

Expected: `ok`.

- [ ] **Step 18.3: Commit**

```bash
git add frontend/components/agency/AgencySidebar.tsx
git commit -m "feat(agency): sidebar shrinks to Clients · Prospects · Settings"
```

---

### Task 19: Drop Peec column from clients table

**Files:**
- Modify: `frontend/app/agency/clients/page.tsx`

- [ ] **Step 19.1: Edit the table**

In `frontend/app/agency/clients/page.tsx`:

1. Delete the `<th className="px-4 py-3">Peec</th>` header (line ~67).
2. Delete the entire `<td>` block that renders `c.peec_dashboard_url` (lines ~94-107).

After the edit, `grep -n peec frontend/app/agency/clients/page.tsx` should return nothing.

- [ ] **Step 19.2: TS check**

```bash
cd frontend && npx tsc --noEmit --pretty 2>&1 | grep "agency/clients/page" || echo "ok"
```

Expected: `ok`.

- [ ] **Step 19.3: Commit**

```bash
git add frontend/app/agency/clients/page.tsx
git commit -m "feat(agency): drop Peec column from clients table"
```

---

### Task 20: Replace `/agency/page.tsx` with redirect; delete `/agency/documents/page.tsx`

**Files:**
- Modify: `frontend/app/agency/page.tsx`
- Delete: `frontend/app/agency/documents/page.tsx`

- [ ] **Step 20.1: Replace `/agency` Today page with a redirect**

Replace `frontend/app/agency/page.tsx` with:

```tsx
import { redirect } from 'next/navigation';

export default function AgencyHomeRedirect() {
  redirect('/agency/clients');
}
```

(Server component — strip `'use client'`.)

- [ ] **Step 20.2: Delete `/agency/documents/page.tsx`**

```bash
git rm frontend/app/agency/documents/page.tsx
```

- [ ] **Step 20.3: TS check + manual hit**

```bash
cd frontend && npx tsc --noEmit
```

Expected: no new errors from these two changes.

- [ ] **Step 20.4: Commit**

```bash
git add frontend/app/agency/page.tsx
git commit -m "feat(agency): /agency redirects to /agency/clients; drop global Documents page"
```

---

### Task 21: Delete dead components

**Files:**
- Delete: `frontend/components/agency/MyQueueSection.tsx`
- Delete: `frontend/components/agency/GenerateForAnyClientModal.tsx`

- [ ] **Step 21.1: Verify nothing imports them**

```bash
grep -rn "MyQueueSection\|GenerateForAnyClientModal" frontend/
```

Expected: no hits beyond the files themselves. If anything still imports them, that consumer was supposed to be deleted in an earlier task — fix the consumer first.

- [ ] **Step 21.2: Delete**

```bash
git rm frontend/components/agency/MyQueueSection.tsx
git rm frontend/components/agency/GenerateForAnyClientModal.tsx
```

- [ ] **Step 21.3: Full frontend type-check**

```bash
cd frontend && npx tsc --noEmit
```

Expected: 0 errors. If any remain, fix them — likely a stale import in `ClientCockpit.tsx` or `ClientPipelineTab.tsx`.

- [ ] **Step 21.4: Frontend build**

```bash
cd frontend && npm run build
```

Expected: clean build.

- [ ] **Step 21.5: Commit**

```bash
git add -u frontend/
git commit -m "chore(agency): delete dead MyQueueSection + GenerateForAnyClientModal"
```

---

## Phase 7 — Verification

### Task 22: Run full backend test suite

- [ ] **Step 22.1: Run all agency tests**

```bash
cd backend && source venv/bin/activate
pytest tests/test_agency*.py tests/test_agency_milestones.py tests/test_agency_document_templates.py -v
```

Expected: all PASS.

- [ ] **Step 22.2: Run full backend suite**

```bash
pytest tests/ -v
```

Expected: all PASS (or only pre-existing flaky/skipped tests). Investigate any new failure.

---

### Task 23: Frontend tsc + build

- [ ] **Step 23.1: Type-check**

```bash
cd frontend && npx tsc --noEmit
```

Expected: 0 errors.

- [ ] **Step 23.2: Lint**

```bash
cd frontend && npm run lint
```

Expected: 0 errors.

- [ ] **Step 23.3: Build**

```bash
cd frontend && npm run build
```

Expected: build succeeds.

---

### Task 24: Smoke pass + `CURRENT_STATE.md` update + final notes

- [ ] **Step 24.1: Start backend + frontend dev servers**

Backend on port 3001 (per project convention), frontend on 3002. If they're already running, confirm. Otherwise:

```bash
cd backend && source venv/bin/activate && uvicorn app.main:app --reload --port 3001 &
cd frontend && npm run dev -- --port 3002 &
```

- [ ] **Step 24.2: Smoke 10 items**

For each, browse and confirm:

1. `/agency` redirects to `/agency/clients`.
2. `/agency/clients` table has no Peec column.
3. Click into a client → Playbook tab is the default.
4. Tick a launch milestone → reload → tick persists; "completed by …" appears beside it.
5. Generate each doc kind from the Playbook tab: `kickoff_checklist`, `sow`, `audit_initial`, `wikipedia_plan`, `site_plan`, `agency_weekly_report`, `monthly_report`. Each opens in the DocumentViewer; PDF download works.
6. Set a `target_at` on Wikipedia plan → reload → date persists. Set it to a past date → "overdue" styling triggers.
7. Pipeline drawer opens inline inside Weekly execution; all existing draft actions work.
8. Brand tab shows the previously generated docs in the Documents history section.
9. `/agency/documents` URL returns 404 in the browser (or routes to a Next.js not-found page).
10. Open `/agency/clients/{id}?tab=pipeline` and `/agency/clients/{id}?tab=documents` → both end up on `?tab=playbook` (or `?tab=brand` for documents — depending on the LEGACY_TAB_REDIRECTS map). Verify each behaves per the spec.

- [ ] **Step 24.3: Update `CURRENT_STATE.md`**

Edit the top of `CURRENT_STATE.md`:

1. **Last updated** line: `2026-05-26 by Claude Code (Agency cockpit playbook redesign — 4 tabs, milestone-driven)`.

2. **Current Task / WIP**: replace the "Most recent work" bullet with a summary of this branch: which migrations ran, which files were added/deleted, what's still pending (browser smoke if not done).

3. **Recent Decisions**: append a new entry at the top:

```
- **2026-05-26** — Shipped **agency cockpit playbook redesign** on `agency-strays-extended`. Cockpit collapses 5 tabs → 4 (Playbook default / Tracking / Audit / Brand). New `agency_client_milestones` table (6 kinds: kickoff, sow, initial_audit, strategy_locked, wikipedia_plan, site_plan) with `GET`/`PATCH /clients/{id}/milestones`. Manual checklist (Ken's call — pure manual over auto-derivation). Two new document templates: `wikipedia_plan` (Wikipedia scan + candidates + brand publications) and `site_plan` (latest completed audit + top 10 recs; no paste-ready artifacts — stays internal). Dropped `peec_dashboard_url` column. Deleted Today page, global Documents page, 9 dead backend endpoints (today/my-queue/tasks/activity-recent/documents-recent). Folded Pipeline into a Playbook drawer; Documents history moved into the Brand tab. Spec `docs/superpowers/specs/2026-05-22-agency-cockpit-playbook-redesign-design.md`, plan `docs/superpowers/plans/2026-05-26-agency-cockpit-playbook-redesign.md`.
```

4. **Recently Changed**: replace the section with the file list from this branch's commits.

- [ ] **Step 24.4: Commit the doc update**

```bash
git add CURRENT_STATE.md
git commit -m "docs: CURRENT_STATE — agency cockpit playbook redesign shipped"
```

- [ ] **Step 24.5: Final status check + summary**

```bash
git status && git log --oneline main..HEAD | head -30
```

Confirm:
- Working tree clean.
- Commit log shows ~24 commits in the order matching this plan.
- Branch is `agency-strays-extended` (or wherever you started).

Report to Ken what's done, what still needs his eyes (browser smoke if any were deferred), and any deviations from the plan.

---

## Out-of-scope (do not implement)

- Auto-derivation of milestone status from existing data. Ken explicitly chose manual.
- New tables for tasks / activity / queue — existing tables stay; only their routes go.
- Customer-facing artifact appendix in `site_plan` — paste-ready artifacts stay internal.
- Optimistic concurrency on milestone PATCH — last write wins.
- Prospects flow changes.
- Global SaaS app changes beyond removing `peec_dashboard_url` from `AgencyClient`.
