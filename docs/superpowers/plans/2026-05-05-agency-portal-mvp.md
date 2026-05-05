# Agency Portal MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the agency cockpit MVP — a separate Next.js app at `agency.lumidian.ai` sharing the existing FastAPI backend, with three screens (Today, Clients, Client detail) and a backend `/api/agency/*` router that reuses existing brand/draft services.

**Architecture:** Same FastAPI backend, same DB. New SQLAlchemy models (`AgencyClient`, `AgencyStaff`, `ClientNote`) and three new fields on existing models (`User.is_agency_staff`, `Brand.agency_client_id`, `ContentDraft.assigned_to_user_id`). New `agency.py` router exposes agency-specific endpoints; existing `/api/brands`, `/api/brand_profile`, `/api/content` are reused for per-brand operations. Separate Next.js app at `agency-frontend/` (mirrors structure of existing `frontend/`).

**Tech Stack:** FastAPI 0.115, SQLAlchemy 2.0 async, SQLite (dev) / Postgres (prod), pytest. Next.js 16, React 18, TypeScript, Tailwind CSS, Radix UI, Axios.

**Spec:** `docs/superpowers/specs/2026-05-05-agency-portal-mvp-design.md`

---

## File Structure

### Backend (modify or create)

- **Modify:** `backend/app/models.py` — add `AgencyClient`, `AgencyStaff`, `ClientNote` classes; add `is_agency_staff` to `User`; add `agency_client_id` to `Brand`; add `assigned_to_user_id` to `ContentDraft`.
- **Modify:** `backend/app/database.py` — append migration steps at the bottom of `migrations` list.
- **Modify:** `backend/app/schemas.py` — add Pydantic schemas for agency client CRUD, today aggregation, draft assign.
- **Modify:** `backend/app/dependencies.py` — add `require_agency_staff` dependency.
- **Modify:** `backend/app/routers/auth.py` — update `set_auth_cookies()` to set `domain=".lumidian.ai"` when `ENVIRONMENT=production`.
- **Modify:** `backend/app/main.py` — register the new router; add `https://agency.lumidian.ai` and dev port to default `ALLOWED_ORIGINS`.
- **Create:** `backend/app/routers/agency.py` — agency-specific endpoints.
- **Create:** `backend/seed_agency_staff.py` — one-off script to flip `is_agency_staff=True` on a user.
- **Create:** `backend/tests/test_agency.py` — tests for agency router.

### Frontend (new app)

- **Create:** `agency-frontend/` (sibling of `frontend/`) — full Next.js 16 app with the structure below.
  - `package.json`, `tsconfig.json`, `next.config.js`, `tailwind.config.js`, `postcss.config.js`, `.eslintrc.json`
  - `app/layout.tsx`, `app/globals.css`
  - `app/login/page.tsx` — fallback login redirect
  - `app/(authed)/layout.tsx` — wraps authed pages with sidebar
  - `app/(authed)/page.tsx` — Today screen (route: `/`)
  - `app/(authed)/clients/page.tsx` — Clients list
  - `app/(authed)/clients/[id]/page.tsx` — Client detail
  - `components/sidebar-nav.tsx`
  - `components/clients/new-client-dialog.tsx`
  - `components/clients/client-overview-tab.tsx`
  - `components/clients/client-brand-tab.tsx`
  - `components/clients/client-pipeline-tab.tsx`
  - `contexts/AuthContext.tsx`
  - `lib/api.ts` — typed client
  - `lib/utils.ts`
  - `middleware.ts`

---

## Task 1: Backend models + migration

**Files:**
- Modify: `backend/app/models.py` (add 3 new classes; add 3 new columns to existing models)
- Modify: `backend/app/database.py` (append 7 migration statements)

- [ ] **Step 1: Add new model classes to `models.py`**

Append at the bottom of `backend/app/models.py`:

```python
# ── Agency portal ────────────────────────────────────────────────────────────


class AgencyClientStatusEnum(str, enum.Enum):
    onboarding = "onboarding"
    active = "active"
    paused = "paused"
    churned = "churned"


class AgencyClient(Base):
    __tablename__ = "agency_clients"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    slug: Mapped[str] = mapped_column(String(255), nullable=False, unique=True, index=True)
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="onboarding")
    retainer_amount_usd: Mapped[int | None] = mapped_column(Integer, nullable=True)
    retainer_started_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    peec_dashboard_url: Mapped[str | None] = mapped_column(String(1024), nullable=True)
    primary_contact_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    primary_contact_email: Mapped[str | None] = mapped_column(String(255), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, onupdate=utcnow)


class AgencyStaff(Base):
    __tablename__ = "agency_staff"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    user_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, unique=True, index=True
    )
    role: Mapped[str] = mapped_column(String(32), nullable=False, default="contractor")
    active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)


class ClientNote(Base):
    __tablename__ = "client_notes"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    agency_client_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("agency_clients.id", ondelete="CASCADE"), nullable=False, index=True
    )
    author_user_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    body: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
```

- [ ] **Step 2: Add new fields to existing models**

In `User` class (after `password_changed_at`):

```python
    is_agency_staff: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
```

In `Brand` class — find the class definition and add (anywhere among the columns):

```python
    agency_client_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("agency_clients.id", ondelete="SET NULL"), nullable=True, index=True
    )
```

In `ContentDraft` class:

```python
    assigned_to_user_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True
    )
```

- [ ] **Step 3: Append migration steps in `database.py`**

In `backend/app/database.py`, find the `migrations` list (it ends around line 342). Append these at the bottom (just before the closing `]`):

```python
        # 2026-05-05: Agency portal
        """CREATE TABLE IF NOT EXISTS agency_clients (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            slug TEXT NOT NULL UNIQUE,
            status TEXT NOT NULL DEFAULT 'onboarding',
            retainer_amount_usd INTEGER,
            retainer_started_at DATETIME,
            peec_dashboard_url TEXT,
            primary_contact_name TEXT,
            primary_contact_email TEXT,
            created_at DATETIME,
            updated_at DATETIME
        )""",
        "CREATE INDEX IF NOT EXISTS idx_agency_clients_slug ON agency_clients(slug)",
        """CREATE TABLE IF NOT EXISTS agency_staff (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
            role TEXT NOT NULL DEFAULT 'contractor',
            active INTEGER NOT NULL DEFAULT 1,
            created_at DATETIME
        )""",
        """CREATE TABLE IF NOT EXISTS client_notes (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            agency_client_id INTEGER NOT NULL REFERENCES agency_clients(id) ON DELETE CASCADE,
            author_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
            body TEXT NOT NULL,
            created_at DATETIME
        )""",
        "ALTER TABLE users ADD COLUMN is_agency_staff INTEGER NOT NULL DEFAULT 0",
        "ALTER TABLE brands ADD COLUMN agency_client_id INTEGER REFERENCES agency_clients(id) ON DELETE SET NULL",
        "CREATE INDEX IF NOT EXISTS idx_brands_agency_client ON brands(agency_client_id)",
        "ALTER TABLE content_drafts ADD COLUMN assigned_to_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL",
```

- [ ] **Step 4: Verify the backend starts and runs migrations cleanly**

Run:

```bash
cd /Users/ken/Desktop/Lumidian/backend
source venv/bin/activate
python -c "import asyncio; from app.database import create_tables, run_migrations; asyncio.run(create_tables()); asyncio.run(run_migrations()); print('OK')"
```

Expected: prints `OK` (and several `Migration applied:` log lines for the new statements).

- [ ] **Step 5: Commit**

```bash
git add backend/app/models.py backend/app/database.py
git commit -m "feat(backend): add agency portal models and migrations"
```

---

## Task 2: Pydantic schemas + agency staff dependency

**Files:**
- Modify: `backend/app/schemas.py`
- Modify: `backend/app/dependencies.py`

- [ ] **Step 1: Add agency schemas to `schemas.py`**

Append at the bottom of `backend/app/schemas.py`:

```python
# ── Agency portal ────────────────────────────────────────────────────────────


class AgencyClientCreate(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    status: str | None = None
    retainer_amount_usd: int | None = None
    peec_dashboard_url: str | None = None
    primary_contact_name: str | None = None
    primary_contact_email: str | None = None


class AgencyClientUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=255)
    status: str | None = None
    retainer_amount_usd: int | None = None
    retainer_started_at: datetime | None = None
    peec_dashboard_url: str | None = None
    primary_contact_name: str | None = None
    primary_contact_email: str | None = None


class AgencyClientOut(BaseModel):
    id: int
    name: str
    slug: str
    status: str
    retainer_amount_usd: int | None
    retainer_started_at: datetime | None
    peec_dashboard_url: str | None
    primary_contact_name: str | None
    primary_contact_email: str | None
    brand_id: int | None
    drafts_pending: int
    created_at: datetime

    class Config:
        from_attributes = True


class DraftAssignIn(BaseModel):
    assigned_to_user_id: int | None  # null to unassign


class TodayDraftOut(BaseModel):
    draft_id: int
    title: str | None
    platform: str
    client_id: int
    client_name: str
    assigned_to_user_id: int | None
    created_at: datetime


class TodayOut(BaseModel):
    drafts_to_review: list[TodayDraftOut]
    drafts_to_review_count: int
    active_clients: int
```

If `BaseModel`, `Field`, or `datetime` are not already imported at the top of `schemas.py`, add the imports.

- [ ] **Step 2: Add `require_agency_staff` to `dependencies.py`**

Append to `backend/app/dependencies.py`:

```python
from fastapi import Depends, HTTPException, status as http_status

from app.models import User
from app.dependencies import get_current_user  # if get_current_user lives elsewhere, import accordingly


async def require_agency_staff(user: User = Depends(get_current_user)) -> User:
    """Allow only users with is_agency_staff=True or is_admin=True."""
    if not (user.is_agency_staff or user.is_admin):
        raise HTTPException(status_code=http_status.HTTP_403_FORBIDDEN, detail="Agency staff access required")
    return user
```

If the file already imports `Depends`, `HTTPException`, `status`, `User`, or `get_current_user`, do not duplicate the imports — just add the function.

- [ ] **Step 3: Verify imports and types resolve**

Run:

```bash
cd /Users/ken/Desktop/Lumidian/backend
source venv/bin/activate
python -c "from app import schemas, dependencies; print('OK')"
```

Expected: prints `OK` with no ImportError.

- [ ] **Step 4: Commit**

```bash
git add backend/app/schemas.py backend/app/dependencies.py
git commit -m "feat(backend): agency schemas and require_agency_staff dependency"
```

---

## Task 3: Agency router

**Files:**
- Create: `backend/app/routers/agency.py`
- Modify: `backend/app/main.py` (mount the new router)

- [ ] **Step 1: Create `backend/app/routers/agency.py`**

```python
"""Agency portal endpoints. All endpoints require is_agency_staff=True."""
from __future__ import annotations

import re
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, status as http_status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.dependencies import require_agency_staff
from app.models import AgencyClient, Brand, ContentDraft, User
from app.schemas import (
    AgencyClientCreate,
    AgencyClientOut,
    AgencyClientUpdate,
    DraftAssignIn,
    TodayDraftOut,
    TodayOut,
)

router = APIRouter(prefix="/api/agency", tags=["agency"])


def _slugify(name: str) -> str:
    s = re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")
    return s or "client"


async def _unique_slug(db: AsyncSession, base: str) -> str:
    slug = base
    suffix = 2
    while True:
        existing = await db.execute(select(AgencyClient.id).where(AgencyClient.slug == slug))
        if existing.scalar_one_or_none() is None:
            return slug
        slug = f"{base}-{suffix}"
        suffix += 1


async def _client_to_out(db: AsyncSession, client: AgencyClient) -> AgencyClientOut:
    brand_q = await db.execute(
        select(Brand.id).where(Brand.agency_client_id == client.id).order_by(Brand.id.asc()).limit(1)
    )
    brand_id = brand_q.scalar_one_or_none()
    pending_count = 0
    if brand_id is not None:
        cnt = await db.execute(
            select(func.count(ContentDraft.id)).where(
                ContentDraft.brand_id == brand_id, ContentDraft.status == "draft"
            )
        )
        pending_count = cnt.scalar_one() or 0
    return AgencyClientOut(
        id=client.id,
        name=client.name,
        slug=client.slug,
        status=client.status,
        retainer_amount_usd=client.retainer_amount_usd,
        retainer_started_at=client.retainer_started_at,
        peec_dashboard_url=client.peec_dashboard_url,
        primary_contact_name=client.primary_contact_name,
        primary_contact_email=client.primary_contact_email,
        brand_id=brand_id,
        drafts_pending=pending_count,
        created_at=client.created_at,
    )


@router.get("/clients", response_model=list[AgencyClientOut])
async def list_clients(
    db: AsyncSession = Depends(get_db),
    _user: User = Depends(require_agency_staff),
):
    rows = await db.execute(select(AgencyClient).order_by(AgencyClient.created_at.desc()))
    clients = rows.scalars().all()
    return [await _client_to_out(db, c) for c in clients]


@router.post("/clients", response_model=AgencyClientOut, status_code=http_status.HTTP_201_CREATED)
async def create_client(
    body: AgencyClientCreate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_agency_staff),
):
    base_slug = _slugify(body.name)
    slug = await _unique_slug(db, base_slug)
    client = AgencyClient(
        name=body.name.strip(),
        slug=slug,
        status=body.status or "onboarding",
        retainer_amount_usd=body.retainer_amount_usd,
        peec_dashboard_url=body.peec_dashboard_url,
        primary_contact_name=body.primary_contact_name,
        primary_contact_email=body.primary_contact_email,
    )
    db.add(client)
    await db.flush()

    brand = Brand(
        name=body.name.strip(),
        slug=f"agency-{slug}",
        user_id=user.id,
        agency_client_id=client.id,
        brand_type="standard",
    )
    db.add(brand)
    await db.commit()
    await db.refresh(client)
    return await _client_to_out(db, client)


@router.get("/clients/{client_id}", response_model=AgencyClientOut)
async def get_client(
    client_id: int,
    db: AsyncSession = Depends(get_db),
    _user: User = Depends(require_agency_staff),
):
    client = await db.get(AgencyClient, client_id)
    if client is None:
        raise HTTPException(status_code=404, detail="Client not found")
    return await _client_to_out(db, client)


@router.patch("/clients/{client_id}", response_model=AgencyClientOut)
async def update_client(
    client_id: int,
    body: AgencyClientUpdate,
    db: AsyncSession = Depends(get_db),
    _user: User = Depends(require_agency_staff),
):
    client = await db.get(AgencyClient, client_id)
    if client is None:
        raise HTTPException(status_code=404, detail="Client not found")
    for field, value in body.model_dump(exclude_unset=True).items():
        setattr(client, field, value)
    if body.status == "active" and client.retainer_started_at is None:
        client.retainer_started_at = datetime.utcnow()
    await db.commit()
    await db.refresh(client)
    return await _client_to_out(db, client)


@router.delete("/clients/{client_id}", status_code=http_status.HTTP_204_NO_CONTENT)
async def delete_client(
    client_id: int,
    db: AsyncSession = Depends(get_db),
    _user: User = Depends(require_agency_staff),
):
    client = await db.get(AgencyClient, client_id)
    if client is None:
        raise HTTPException(status_code=404, detail="Client not found")
    client.status = "churned"
    await db.commit()


@router.get("/today", response_model=TodayOut)
async def get_today(
    db: AsyncSession = Depends(get_db),
    _user: User = Depends(require_agency_staff),
):
    drafts_q = await db.execute(
        select(ContentDraft, Brand, AgencyClient)
        .join(Brand, Brand.id == ContentDraft.brand_id)
        .join(AgencyClient, AgencyClient.id == Brand.agency_client_id)
        .where(ContentDraft.status == "draft")
        .order_by(ContentDraft.created_at.asc())
        .limit(50)
    )
    drafts_rows = drafts_q.all()
    drafts = [
        TodayDraftOut(
            draft_id=draft.id,
            title=getattr(draft, "title", None),
            platform=draft.platform,
            client_id=client.id,
            client_name=client.name,
            assigned_to_user_id=draft.assigned_to_user_id,
            created_at=draft.created_at,
        )
        for draft, _brand, client in drafts_rows
    ]
    active_clients_q = await db.execute(
        select(func.count(AgencyClient.id)).where(AgencyClient.status == "active")
    )
    active_clients = active_clients_q.scalar_one() or 0
    return TodayOut(
        drafts_to_review=drafts,
        drafts_to_review_count=len(drafts),
        active_clients=active_clients,
    )


@router.patch("/drafts/{draft_id}/assign", status_code=http_status.HTTP_204_NO_CONTENT)
async def assign_draft(
    draft_id: int,
    body: DraftAssignIn,
    db: AsyncSession = Depends(get_db),
    _user: User = Depends(require_agency_staff),
):
    draft = await db.get(ContentDraft, draft_id)
    if draft is None:
        raise HTTPException(status_code=404, detail="Draft not found")
    draft.assigned_to_user_id = body.assigned_to_user_id
    await db.commit()
```

- [ ] **Step 2: Mount the router in `main.py`**

In `backend/app/main.py`, find the section where other routers are imported and included (search for `app.include_router`). Add:

```python
from app.routers import agency
app.include_router(agency.router)
```

Place these next to the other router imports/registrations.

- [ ] **Step 3: Verify the router boots**

Run:

```bash
cd /Users/ken/Desktop/Lumidian/backend
source venv/bin/activate
python -c "from app.main import app; print([r.path for r in app.routes if '/agency' in str(getattr(r, 'path', ''))])"
```

Expected output should include `/api/agency/clients`, `/api/agency/today`, etc.

- [ ] **Step 4: Commit**

```bash
git add backend/app/routers/agency.py backend/app/main.py
git commit -m "feat(backend): agency portal router"
```

---

## Task 4: Cookie domain + CORS updates

**Files:**
- Modify: `backend/app/routers/auth.py` (lines 204–223)
- Modify: `backend/app/main.py` (line 149 area)

- [ ] **Step 1: Update `set_auth_cookies` to scope cookies to `.lumidian.ai` in production**

In `backend/app/routers/auth.py`, locate `set_auth_cookies` (around line 204). Replace the function with:

```python
def set_auth_cookies(response: Response, token: str) -> None:
    cookie_domain = os.getenv("COOKIE_DOMAIN") or None
    response.set_cookie(
        "clarity_token",
        token,
        httponly=True,
        secure=_COOKIE_SECURE,
        samesite="lax",
        max_age=COOKIE_MAX_AGE,
        path="/",
        domain=cookie_domain,
    )
    response.set_cookie(
        "clarity_session",
        "1",
        httponly=False,
        secure=_COOKIE_SECURE,
        samesite="lax",
        max_age=COOKIE_MAX_AGE,
        path="/",
        domain=cookie_domain,
    )
```

Also update `clear_auth_cookies` to pass the same domain:

```python
def clear_auth_cookies(response: Response) -> None:
    cookie_domain = os.getenv("COOKIE_DOMAIN") or None
    response.delete_cookie("clarity_token", path="/", domain=cookie_domain)
    response.delete_cookie("clarity_session", path="/", domain=cookie_domain)
```

If `import os` isn't already at the top of the file, add it.

- [ ] **Step 2: Update default `ALLOWED_ORIGINS` in `main.py`**

In `backend/app/main.py` line 149 area, update the default list to include `localhost:3003` (agency-frontend dev port):

Find:
```python
_raw_origins = os.getenv("ALLOWED_ORIGINS", "http://localhost:3000,http://localhost:3001,http://localhost:3002,http://127.0.0.1:3000,http://127.0.0.1:3001,http://127.0.0.1:3002")
```

Replace with:
```python
_raw_origins = os.getenv("ALLOWED_ORIGINS", "http://localhost:3000,http://localhost:3001,http://localhost:3002,http://localhost:3003,http://127.0.0.1:3000,http://127.0.0.1:3001,http://127.0.0.1:3002,http://127.0.0.1:3003")
```

- [ ] **Step 3: Document the new env var in `.env.example`**

In `backend/.env.example`, append:

```
# Agency portal — set to ".lumidian.ai" in production so JWT cookie works across
# lumidian.ai and agency.lumidian.ai. Leave unset for local dev.
COOKIE_DOMAIN=
```

- [ ] **Step 4: Commit**

```bash
git add backend/app/routers/auth.py backend/app/main.py backend/.env.example
git commit -m "feat(backend): cookie domain env var and agency CORS origin"
```

---

## Task 5: Backend tests for agency router

**Files:**
- Create: `backend/tests/test_agency.py`

- [ ] **Step 1: Inspect existing test fixtures**

Run:
```bash
sed -n '1,80p' /Users/ken/Desktop/Lumidian/backend/tests/conftest.py
```

Note the helpers (`register_and_login`, `create_brand`) and the `client` / `db` fixtures. Use these patterns in the new test file.

- [ ] **Step 2: Write the test file**

Create `backend/tests/test_agency.py`:

```python
"""Tests for the agency portal router."""
from __future__ import annotations

import pytest

from tests.conftest import register_and_login


async def _make_agency_user(client, db, email: str = "agency@example.com") -> str:
    """Register, login, and flip is_agency_staff=True. Returns auth cookie."""
    cookie = await register_and_login(client, email=email, password="testpass123!")
    # Flip is_agency_staff directly in DB
    from sqlalchemy import update
    from app.models import User
    await db.execute(update(User).where(User.email == email).values(is_agency_staff=True))
    await db.commit()
    return cookie


@pytest.mark.asyncio
async def test_non_staff_cannot_list_clients(client):
    cookie = await register_and_login(client, email="user@example.com", password="testpass123!")
    resp = await client.get("/api/agency/clients", cookies={"clarity_token": cookie})
    assert resp.status_code == 403


@pytest.mark.asyncio
async def test_unauthenticated_cannot_access_agency(client):
    resp = await client.get("/api/agency/clients")
    assert resp.status_code in (401, 403)


@pytest.mark.asyncio
async def test_staff_can_create_and_list_clients(client, db):
    cookie = await _make_agency_user(client, db)

    create = await client.post(
        "/api/agency/clients",
        cookies={"clarity_token": cookie},
        json={"name": "Acme Co", "primary_contact_email": "ceo@acme.com"},
    )
    assert create.status_code == 201, create.text
    created = create.json()
    assert created["name"] == "Acme Co"
    assert created["slug"] == "acme-co"
    assert created["status"] == "onboarding"
    assert created["brand_id"] is not None
    assert created["drafts_pending"] == 0

    listing = await client.get("/api/agency/clients", cookies={"clarity_token": cookie})
    assert listing.status_code == 200
    assert any(c["id"] == created["id"] for c in listing.json())


@pytest.mark.asyncio
async def test_create_client_handles_slug_collision(client, db):
    cookie = await _make_agency_user(client, db)
    a = await client.post("/api/agency/clients", cookies={"clarity_token": cookie}, json={"name": "Acme"})
    b = await client.post("/api/agency/clients", cookies={"clarity_token": cookie}, json={"name": "Acme"})
    assert a.json()["slug"] == "acme"
    assert b.json()["slug"] == "acme-2"


@pytest.mark.asyncio
async def test_update_client_status_sets_retainer_started_at(client, db):
    cookie = await _make_agency_user(client, db)
    create = await client.post("/api/agency/clients", cookies={"clarity_token": cookie}, json={"name": "Beta Inc"})
    cid = create.json()["id"]

    upd = await client.patch(
        f"/api/agency/clients/{cid}",
        cookies={"clarity_token": cookie},
        json={"status": "active"},
    )
    assert upd.status_code == 200
    assert upd.json()["status"] == "active"
    assert upd.json()["retainer_started_at"] is not None


@pytest.mark.asyncio
async def test_delete_client_marks_churned(client, db):
    cookie = await _make_agency_user(client, db)
    create = await client.post("/api/agency/clients", cookies={"clarity_token": cookie}, json={"name": "Gamma"})
    cid = create.json()["id"]

    resp = await client.delete(f"/api/agency/clients/{cid}", cookies={"clarity_token": cookie})
    assert resp.status_code == 204

    detail = await client.get(f"/api/agency/clients/{cid}", cookies={"clarity_token": cookie})
    assert detail.json()["status"] == "churned"


@pytest.mark.asyncio
async def test_today_returns_empty_when_no_drafts(client, db):
    cookie = await _make_agency_user(client, db)
    resp = await client.get("/api/agency/today", cookies={"clarity_token": cookie})
    assert resp.status_code == 200
    body = resp.json()
    assert body["drafts_to_review"] == []
    assert body["drafts_to_review_count"] == 0
    assert body["active_clients"] == 0
```

- [ ] **Step 3: Run the tests**

Run:
```bash
cd /Users/ken/Desktop/Lumidian/backend
source venv/bin/activate
pytest tests/test_agency.py -v
```

Expected: all 6 tests PASS.

If a test fails because the fixtures or `register_and_login` helper signature differs, adjust the calls to match the existing pattern in `tests/conftest.py`. Do not change the production code to make tests pass — fix the test instead.

- [ ] **Step 4: Commit**

```bash
git add backend/tests/test_agency.py
git commit -m "test(backend): agency portal endpoints"
```

---

## Task 6: Staff seed script

**Files:**
- Create: `backend/seed_agency_staff.py`

- [ ] **Step 1: Create the seed script**

```python
"""One-off: flip is_agency_staff=True on a user by email and create AgencyStaff row.

Usage:
    python seed_agency_staff.py user@example.com [owner|contractor]
"""
from __future__ import annotations

import asyncio
import sys

from sqlalchemy import select

from app.database import AsyncSessionLocal, create_tables, run_migrations
from app.models import AgencyStaff, User


async def main() -> None:
    if len(sys.argv) < 2:
        print("Usage: python seed_agency_staff.py <email> [owner|contractor]")
        sys.exit(1)

    email = sys.argv[1].strip().lower()
    role = sys.argv[2] if len(sys.argv) > 2 else "owner"
    if role not in ("owner", "contractor"):
        print(f"Invalid role '{role}'. Must be 'owner' or 'contractor'.")
        sys.exit(1)

    await create_tables()
    await run_migrations()

    async with AsyncSessionLocal() as db:
        user = (await db.execute(select(User).where(User.email == email))).scalar_one_or_none()
        if user is None:
            print(f"No user found with email {email}. Register the user first via the normal signup flow.")
            sys.exit(1)

        user.is_agency_staff = True

        existing = (await db.execute(select(AgencyStaff).where(AgencyStaff.user_id == user.id))).scalar_one_or_none()
        if existing is None:
            db.add(AgencyStaff(user_id=user.id, role=role, active=True))
        else:
            existing.role = role
            existing.active = True

        await db.commit()
        print(f"OK — {email} is now agency staff ({role}).")


if __name__ == "__main__":
    asyncio.run(main())
```

- [ ] **Step 2: Smoke-test with the existing admin user**

Confirm an admin user exists locally first (the app seeds one on first startup if `ADMIN_PASSWORD` is set). Find one:

```bash
cd /Users/ken/Desktop/Lumidian/backend
source venv/bin/activate
python -c "import asyncio; from sqlalchemy import select; from app.database import AsyncSessionLocal; from app.models import User
async def m():
    async with AsyncSessionLocal() as db:
        rows = (await db.execute(select(User.email).where(User.is_admin == True))).scalars().all()
        print(rows)
asyncio.run(m())"
```

If at least one admin email is printed, run the seed:

```bash
python seed_agency_staff.py <admin-email> owner
```

Expected: `OK — <email> is now agency staff (owner).`

If no admin user exists, skip this step — Ken will run the seed manually after registering.

- [ ] **Step 3: Commit**

```bash
git add backend/seed_agency_staff.py
git commit -m "chore(backend): agency staff seed script"
```

---

## Task 7: Scaffold agency-frontend Next.js app

**Files:**
- Create: `agency-frontend/package.json`
- Create: `agency-frontend/tsconfig.json`
- Create: `agency-frontend/next.config.js`
- Create: `agency-frontend/tailwind.config.js`
- Create: `agency-frontend/postcss.config.js`
- Create: `agency-frontend/.eslintrc.json`
- Create: `agency-frontend/.gitignore`
- Create: `agency-frontend/app/layout.tsx`
- Create: `agency-frontend/app/globals.css`
- Create: `agency-frontend/app/page.tsx` (placeholder until Task 9)
- Create: `agency-frontend/lib/utils.ts`

- [ ] **Step 1: Create `agency-frontend/package.json`**

```json
{
  "name": "lumidian-agency-frontend",
  "version": "0.1.0",
  "private": true,
  "engines": {
    "node": ">=20"
  },
  "scripts": {
    "dev": "next dev -p 3003",
    "build": "next build",
    "start": "next start -p 3003",
    "lint": "next lint"
  },
  "dependencies": {
    "@radix-ui/react-dialog": "^1.1.15",
    "@radix-ui/react-dropdown-menu": "^2.1.16",
    "@radix-ui/react-tabs": "^1.1.13",
    "axios": "^1.7.7",
    "class-variance-authority": "^0.7.1",
    "clsx": "^2.1.1",
    "date-fns": "^4.1.0",
    "lucide-react": "^0.454.0",
    "next": "^16.2.2",
    "react": "^18.3.1",
    "react-dom": "^18.3.1",
    "tailwind-merge": "^3.5.0"
  },
  "devDependencies": {
    "@types/node": "^20",
    "@types/react": "^18",
    "@types/react-dom": "^18",
    "autoprefixer": "^10.4.20",
    "eslint": "^8.57.0",
    "eslint-config-next": "^15.0.3",
    "postcss": "^8",
    "tailwindcss": "^3.4.14",
    "typescript": "^5"
  }
}
```

- [ ] **Step 2: Create `agency-frontend/tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["dom", "dom.iterable", "esnext"],
    "allowJs": false,
    "skipLibCheck": true,
    "strict": true,
    "noEmit": true,
    "esModuleInterop": true,
    "module": "esnext",
    "moduleResolution": "bundler",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "jsx": "preserve",
    "incremental": true,
    "plugins": [{ "name": "next" }],
    "baseUrl": ".",
    "paths": {
      "@/*": ["./*"]
    }
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
  "exclude": ["node_modules"]
}
```

- [ ] **Step 3: Create `agency-frontend/next.config.js`**

```javascript
/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
};

module.exports = nextConfig;
```

- [ ] **Step 4: Create `agency-frontend/tailwind.config.js`**

```javascript
/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        border: "hsl(220 13% 91%)",
        background: "hsl(0 0% 100%)",
        foreground: "hsl(222 47% 11%)",
        muted: "hsl(210 40% 96%)",
        "muted-foreground": "hsl(215 16% 47%)",
        primary: "hsl(222 47% 11%)",
        "primary-foreground": "hsl(210 40% 98%)",
        accent: "hsl(210 40% 96%)",
      },
    },
  },
  plugins: [],
};
```

- [ ] **Step 5: Create `agency-frontend/postcss.config.js`**

```javascript
module.exports = {
  plugins: {
    tailwindcss: {},
    autoprefixer: {},
  },
};
```

- [ ] **Step 6: Create `agency-frontend/.eslintrc.json`**

```json
{
  "extends": "next/core-web-vitals"
}
```

- [ ] **Step 7: Create `agency-frontend/.gitignore`**

```
node_modules/
.next/
out/
*.log
.DS_Store
.env*.local
next-env.d.ts
tsconfig.tsbuildinfo
```

- [ ] **Step 8: Create `agency-frontend/app/globals.css`**

```css
@tailwind base;
@tailwind components;
@tailwind utilities;

html, body { height: 100%; }
body { background-color: hsl(220 14% 98%); color: hsl(222 47% 11%); }
```

- [ ] **Step 9: Create `agency-frontend/app/layout.tsx`**

```tsx
import './globals.css';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Lumidian Agency',
  description: 'Internal cockpit for Lumidian agency operations',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen">{children}</body>
    </html>
  );
}
```

- [ ] **Step 10: Create placeholder `agency-frontend/app/page.tsx`**

```tsx
export default function Page() {
  return <div className="p-8">Loading…</div>;
}
```

- [ ] **Step 11: Create `agency-frontend/lib/utils.ts`**

```typescript
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
```

- [ ] **Step 12: Install dependencies and verify the dev server starts**

Run:

```bash
cd /Users/ken/Desktop/Lumidian/agency-frontend
npm install
```

Then start dev to confirm:

```bash
npm run dev
```

After ~5 seconds, in another terminal:

```bash
curl -sf http://localhost:3003 > /dev/null && echo "OK" || echo "FAIL"
```

Expected: `OK`. Then stop the dev server (Ctrl+C in the dev terminal).

- [ ] **Step 13: Commit**

```bash
git add agency-frontend
git commit -m "feat(agency-frontend): scaffold Next.js app"
```

---

## Task 8: Auth context, API client, middleware

**Files:**
- Create: `agency-frontend/contexts/AuthContext.tsx`
- Create: `agency-frontend/lib/api.ts`
- Create: `agency-frontend/middleware.ts`
- Create: `agency-frontend/app/login/page.tsx`

- [ ] **Step 1: Create `agency-frontend/lib/api.ts`**

```typescript
import axios, { type AxiosInstance } from 'axios';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';

const client: AxiosInstance = axios.create({
  baseURL: API_URL,
  withCredentials: true,
  timeout: 30000,
});

client.interceptors.response.use(
  (resp) => resp,
  (err) => {
    if (err?.response?.status === 401 && typeof window !== 'undefined') {
      const apex = process.env.NEXT_PUBLIC_APEX_LOGIN_URL || 'http://localhost:3000/login';
      window.location.href = apex;
    }
    return Promise.reject(err);
  },
);

export interface AgencyUser {
  id: number;
  email: string;
  name: string | null;
  is_admin: boolean;
  email_verified: boolean;
}

export interface AgencyClientOut {
  id: number;
  name: string;
  slug: string;
  status: 'onboarding' | 'active' | 'paused' | 'churned';
  retainer_amount_usd: number | null;
  retainer_started_at: string | null;
  peec_dashboard_url: string | null;
  primary_contact_name: string | null;
  primary_contact_email: string | null;
  brand_id: number | null;
  drafts_pending: number;
  created_at: string;
}

export interface AgencyClientCreateBody {
  name: string;
  status?: string;
  retainer_amount_usd?: number;
  peec_dashboard_url?: string;
  primary_contact_name?: string;
  primary_contact_email?: string;
}

export interface TodayDraft {
  draft_id: number;
  title: string | null;
  platform: string;
  client_id: number;
  client_name: string;
  assigned_to_user_id: number | null;
  created_at: string;
}

export interface TodayResponse {
  drafts_to_review: TodayDraft[];
  drafts_to_review_count: number;
  active_clients: number;
}

export const api = {
  me: () => client.get<AgencyUser>('/api/auth/me').then((r) => r.data),

  listClients: () => client.get<AgencyClientOut[]>('/api/agency/clients').then((r) => r.data),
  getClient: (id: number) => client.get<AgencyClientOut>(`/api/agency/clients/${id}`).then((r) => r.data),
  createClient: (body: AgencyClientCreateBody) =>
    client.post<AgencyClientOut>('/api/agency/clients', body).then((r) => r.data),
  updateClient: (id: number, body: Partial<AgencyClientCreateBody> & { status?: string }) =>
    client.patch<AgencyClientOut>(`/api/agency/clients/${id}`, body).then((r) => r.data),
  deleteClient: (id: number) => client.delete(`/api/agency/clients/${id}`).then(() => undefined),

  today: () => client.get<TodayResponse>('/api/agency/today').then((r) => r.data),

  assignDraft: (draftId: number, userId: number | null) =>
    client.patch(`/api/agency/drafts/${draftId}/assign`, { assigned_to_user_id: userId }),

  // Reused existing endpoints
  getBrandProfile: (brandId: number) =>
    client.get(`/api/brand_profile/${brandId}`).then((r) => r.data),
  updateBrandProfile: (brandId: number, body: Record<string, unknown>) =>
    client.patch(`/api/brand_profile/${brandId}`, body).then((r) => r.data),
  getPrompts: (brandId: number) =>
    client.get(`/api/brands/${brandId}/prompts`).then((r) => r.data),
  addPrompt: (brandId: number, text: string) =>
    client.post(`/api/brands/${brandId}/prompts`, { text }).then((r) => r.data),
  deletePrompt: (promptId: number) =>
    client.delete(`/api/brands/prompts/${promptId}`).then(() => undefined),
  listDrafts: (brandId: number) =>
    client.get(`/api/content/${brandId}/drafts`).then((r) => r.data),
};
```

- [ ] **Step 2: Create `agency-frontend/contexts/AuthContext.tsx`**

```tsx
'use client';

import { createContext, useContext, useEffect, useState } from 'react';
import { api, type AgencyUser } from '@/lib/api';

interface AuthContextValue {
  user: AgencyUser | null;
  loading: boolean;
  refresh: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue>({
  user: null,
  loading: true,
  refresh: async () => {},
});

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AgencyUser | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = async () => {
    try {
      const me = await api.me();
      setUser(me);
    } catch {
      setUser(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    refresh();
  }, []);

  return (
    <AuthContext.Provider value={{ user, loading, refresh }}>{children}</AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
```

- [ ] **Step 3: Create `agency-frontend/middleware.ts`**

```typescript
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

const PUBLIC_PATHS = ['/login'];

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const session = request.cookies.get('clarity_session')?.value;
  const isAuthenticated = session === '1';

  const isPublic = PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(p + '/'));
  if (!isAuthenticated && !isPublic) {
    const apexLoginUrl =
      process.env.NEXT_PUBLIC_APEX_LOGIN_URL || 'http://localhost:3000/login';
    return NextResponse.redirect(new URL(apexLoginUrl));
  }
  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!api|_next/static|_next/image|favicon.ico|.*\\.png$|.*\\.svg$).*)'],
};
```

- [ ] **Step 4: Create `agency-frontend/app/login/page.tsx`**

```tsx
export default function LoginRedirectPage() {
  if (typeof window !== 'undefined') {
    const url = process.env.NEXT_PUBLIC_APEX_LOGIN_URL || 'http://localhost:3000/login';
    window.location.href = url;
  }
  return (
    <div className="p-8 text-sm text-muted-foreground">
      Redirecting to Lumidian login…
    </div>
  );
}
```

- [ ] **Step 5: Wire `AuthProvider` into `app/layout.tsx`**

Replace `agency-frontend/app/layout.tsx` content with:

```tsx
import './globals.css';
import type { Metadata } from 'next';
import { AuthProvider } from '@/contexts/AuthContext';

export const metadata: Metadata = {
  title: 'Lumidian Agency',
  description: 'Internal cockpit for Lumidian agency operations',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen">
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
```

- [ ] **Step 6: Verify TypeScript compiles**

Run:
```bash
cd /Users/ken/Desktop/Lumidian/agency-frontend
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add agency-frontend
git commit -m "feat(agency-frontend): auth context, API client, middleware"
```

---

## Task 9: App shell with sidebar nav

**Files:**
- Create: `agency-frontend/components/sidebar-nav.tsx`
- Create: `agency-frontend/app/(authed)/layout.tsx`

- [ ] **Step 1: Create `agency-frontend/components/sidebar-nav.tsx`**

```tsx
'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';
import { Home, Users } from 'lucide-react';

const NAV = [
  { href: '/', label: 'Today', icon: Home },
  { href: '/clients', label: 'Clients', icon: Users },
];

export function SidebarNav() {
  const pathname = usePathname();
  return (
    <aside className="w-56 shrink-0 border-r border-border bg-white">
      <div className="px-5 py-5 text-base font-semibold tracking-tight">Lumidian Agency</div>
      <nav className="px-2 pb-4">
        {NAV.map(({ href, label, icon: Icon }) => {
          const active = href === '/' ? pathname === '/' : pathname.startsWith(href);
          return (
            <Link
              key={href}
              href={href}
              className={cn(
                'flex items-center gap-2 rounded-md px-3 py-2 text-sm transition',
                active
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:bg-muted hover:text-foreground',
              )}
            >
              <Icon className="h-4 w-4" />
              {label}
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}
```

- [ ] **Step 2: Create `agency-frontend/app/(authed)/layout.tsx`**

```tsx
'use client';

import { SidebarNav } from '@/components/sidebar-nav';
import { useAuth } from '@/contexts/AuthContext';

export default function AuthedLayout({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();

  if (loading) {
    return <div className="p-8 text-sm text-muted-foreground">Loading…</div>;
  }
  if (!user) {
    return <div className="p-8 text-sm text-muted-foreground">Not signed in.</div>;
  }

  return (
    <div className="flex min-h-screen">
      <SidebarNav />
      <main className="flex-1 overflow-auto">{children}</main>
    </div>
  );
}
```

- [ ] **Step 3: TS check**

```bash
cd /Users/ken/Desktop/Lumidian/agency-frontend
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add agency-frontend
git commit -m "feat(agency-frontend): sidebar nav and authed layout"
```

---

## Task 10: Today screen

**Files:**
- Replace: `agency-frontend/app/page.tsx` (old placeholder) → move into `(authed)/page.tsx`
- Create: `agency-frontend/app/(authed)/page.tsx`

- [ ] **Step 1: Delete the old placeholder root page**

```bash
rm /Users/ken/Desktop/Lumidian/agency-frontend/app/page.tsx
```

- [ ] **Step 2: Create the Today screen at `agency-frontend/app/(authed)/page.tsx`**

```tsx
'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api, type TodayResponse } from '@/lib/api';

export default function TodayPage() {
  const [data, setData] = useState<TodayResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.today().then(setData).catch((e) => setError(String(e?.message ?? e)));
  }, []);

  if (error) return <div className="p-8 text-sm text-red-600">{error}</div>;
  if (!data) return <div className="p-8 text-sm text-muted-foreground">Loading…</div>;

  return (
    <div className="p-8">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Today</h1>
        <p className="text-sm text-muted-foreground">
          {data.active_clients} active client{data.active_clients === 1 ? '' : 's'} ·{' '}
          {data.drafts_to_review_count} draft{data.drafts_to_review_count === 1 ? '' : 's'} pending review
        </p>
      </div>

      <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
        <section className="rounded-lg border border-border bg-white p-5">
          <h2 className="mb-3 text-sm font-medium text-muted-foreground">Drafts to review</h2>
          {data.drafts_to_review.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nothing pending. Go ship something.</p>
          ) : (
            <ul className="space-y-2">
              {data.drafts_to_review.slice(0, 8).map((d) => (
                <li key={d.draft_id} className="rounded-md border border-border p-3 text-sm">
                  <div className="font-medium">{d.title || `Draft #${d.draft_id}`}</div>
                  <div className="text-xs text-muted-foreground">
                    <Link href={`/clients/${d.client_id}`} className="underline-offset-2 hover:underline">
                      {d.client_name}
                    </Link>{' '}
                    · {d.platform}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="rounded-lg border border-border bg-white p-5">
          <h2 className="mb-3 text-sm font-medium text-muted-foreground">Scheduled this week</h2>
          <p className="text-sm text-muted-foreground">Coming in V1.</p>
        </section>

        <section className="rounded-lg border border-border bg-white p-5">
          <h2 className="mb-3 text-sm font-medium text-muted-foreground">Recent activity</h2>
          <p className="text-sm text-muted-foreground">Coming in V1.</p>
        </section>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: TS check**

```bash
cd /Users/ken/Desktop/Lumidian/agency-frontend
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add agency-frontend
git commit -m "feat(agency-frontend): Today screen"
```

---

## Task 11: Clients list with create dialog

**Files:**
- Create: `agency-frontend/components/clients/new-client-dialog.tsx`
- Create: `agency-frontend/app/(authed)/clients/page.tsx`

- [ ] **Step 1: Create the new-client dialog**

```tsx
'use client';

import { useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { api, type AgencyClientOut } from '@/lib/api';

interface Props {
  onCreated: (client: AgencyClientOut) => void;
}

export function NewClientDialog({ onCreated }: Props) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [contactName, setContactName] = useState('');
  const [contactEmail, setContactEmail] = useState('');
  const [retainer, setRetainer] = useState('');
  const [peecUrl, setPeecUrl] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reset = () => {
    setName('');
    setContactName('');
    setContactEmail('');
    setRetainer('');
    setPeecUrl('');
    setError(null);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setError('Name is required.');
      return;
    }
    setSubmitting(true);
    try {
      const created = await api.createClient({
        name: name.trim(),
        primary_contact_name: contactName.trim() || undefined,
        primary_contact_email: contactEmail.trim() || undefined,
        retainer_amount_usd: retainer ? parseInt(retainer, 10) : undefined,
        peec_dashboard_url: peecUrl.trim() || undefined,
      });
      onCreated(created);
      setOpen(false);
      reset();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to create client.';
      setError(msg);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger asChild>
        <button className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90">
          New client
        </button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/40" />
        <Dialog.Content className="fixed left-1/2 top-1/2 w-full max-w-md -translate-x-1/2 -translate-y-1/2 rounded-lg border border-border bg-white p-6 shadow-lg">
          <Dialog.Title className="text-lg font-semibold">New client</Dialog.Title>
          <Dialog.Description className="mb-4 text-sm text-muted-foreground">
            Creates an agency client and a linked brand record.
          </Dialog.Description>

          <form onSubmit={submit} className="space-y-3">
            <div>
              <label className="mb-1 block text-xs font-medium">Name</label>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full rounded-md border border-border px-3 py-2 text-sm"
                placeholder="Acme Co"
                autoFocus
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1 block text-xs font-medium">Contact name</label>
                <input
                  value={contactName}
                  onChange={(e) => setContactName(e.target.value)}
                  className="w-full rounded-md border border-border px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium">Contact email</label>
                <input
                  type="email"
                  value={contactEmail}
                  onChange={(e) => setContactEmail(e.target.value)}
                  className="w-full rounded-md border border-border px-3 py-2 text-sm"
                />
              </div>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium">Retainer (USD/mo)</label>
              <input
                type="number"
                value={retainer}
                onChange={(e) => setRetainer(e.target.value)}
                className="w-full rounded-md border border-border px-3 py-2 text-sm"
                placeholder="3000"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium">Peec dashboard URL</label>
              <input
                type="url"
                value={peecUrl}
                onChange={(e) => setPeecUrl(e.target.value)}
                className="w-full rounded-md border border-border px-3 py-2 text-sm"
                placeholder="https://peec.ai/..."
              />
            </div>

            {error && <p className="text-sm text-red-600">{error}</p>}

            <div className="flex justify-end gap-2 pt-2">
              <Dialog.Close asChild>
                <button type="button" className="rounded-md border border-border px-4 py-2 text-sm">
                  Cancel
                </button>
              </Dialog.Close>
              <button
                type="submit"
                disabled={submitting}
                className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
              >
                {submitting ? 'Creating…' : 'Create client'}
              </button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
```

- [ ] **Step 2: Create the Clients list page**

```tsx
'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api, type AgencyClientOut } from '@/lib/api';
import { NewClientDialog } from '@/components/clients/new-client-dialog';

const STATUS_COLORS: Record<string, string> = {
  onboarding: 'bg-amber-100 text-amber-800',
  active: 'bg-emerald-100 text-emerald-800',
  paused: 'bg-slate-100 text-slate-700',
  churned: 'bg-rose-100 text-rose-800',
};

export default function ClientsPage() {
  const [clients, setClients] = useState<AgencyClientOut[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api
      .listClients()
      .then(setClients)
      .catch((e) => setError(String(e?.message ?? e)))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="p-8">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Clients</h1>
          <p className="text-sm text-muted-foreground">{clients.length} total</p>
        </div>
        <NewClientDialog onCreated={(c) => setClients((prev) => [c, ...prev])} />
      </div>

      {loading && <p className="text-sm text-muted-foreground">Loading…</p>}
      {error && <p className="text-sm text-red-600">{error}</p>}

      {!loading && clients.length === 0 && (
        <div className="rounded-lg border border-dashed border-border p-10 text-center text-sm text-muted-foreground">
          No clients yet. Create your first one.
        </div>
      )}

      {clients.length > 0 && (
        <div className="overflow-hidden rounded-lg border border-border bg-white">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-4 py-3">Name</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Retainer</th>
                <th className="px-4 py-3">Drafts pending</th>
                <th className="px-4 py-3">Peec</th>
              </tr>
            </thead>
            <tbody>
              {clients.map((c) => (
                <tr key={c.id} className="border-t border-border hover:bg-muted/30">
                  <td className="px-4 py-3">
                    <Link href={`/clients/${c.id}`} className="font-medium hover:underline">
                      {c.name}
                    </Link>
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`rounded-full px-2 py-1 text-xs ${STATUS_COLORS[c.status] ?? 'bg-muted'}`}
                    >
                      {c.status}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    {c.retainer_amount_usd ? `$${c.retainer_amount_usd}/mo` : '—'}
                  </td>
                  <td className="px-4 py-3">{c.drafts_pending}</td>
                  <td className="px-4 py-3">
                    {c.peec_dashboard_url ? (
                      <a
                        href={c.peec_dashboard_url}
                        target="_blank"
                        rel="noreferrer"
                        className="text-xs underline"
                      >
                        Open
                      </a>
                    ) : (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 3: TS check**

```bash
cd /Users/ken/Desktop/Lumidian/agency-frontend
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add agency-frontend
git commit -m "feat(agency-frontend): Clients list and new-client dialog"
```

---

## Task 12: Client detail — Overview tab

**Files:**
- Create: `agency-frontend/components/clients/client-overview-tab.tsx`
- Create: `agency-frontend/app/(authed)/clients/[id]/page.tsx`

- [ ] **Step 1: Create the Overview tab**

```tsx
'use client';

import { useState } from 'react';
import { api, type AgencyClientOut } from '@/lib/api';

interface Props {
  client: AgencyClientOut;
  onChange: (next: AgencyClientOut) => void;
}

export function ClientOverviewTab({ client, onChange }: Props) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const update = async (patch: Partial<AgencyClientOut>) => {
    setSaving(true);
    setError(null);
    try {
      const next = await api.updateClient(client.id, patch as Record<string, never>);
      onChange(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-sm font-medium text-muted-foreground">Status</h2>
        <div className="mt-2 flex gap-2">
          {(['onboarding', 'active', 'paused', 'churned'] as const).map((s) => (
            <button
              key={s}
              onClick={() => update({ status: s })}
              disabled={saving || client.status === s}
              className={`rounded-md border px-3 py-1.5 text-xs ${
                client.status === s
                  ? 'border-primary bg-primary text-primary-foreground'
                  : 'border-border bg-white hover:bg-muted'
              }`}
            >
              {s}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-6">
        <div>
          <h2 className="mb-1 text-sm font-medium text-muted-foreground">Retainer</h2>
          <p className="text-base">
            {client.retainer_amount_usd ? `$${client.retainer_amount_usd}/mo` : '—'}
          </p>
        </div>
        <div>
          <h2 className="mb-1 text-sm font-medium text-muted-foreground">Started</h2>
          <p className="text-base">
            {client.retainer_started_at
              ? new Date(client.retainer_started_at).toLocaleDateString()
              : '—'}
          </p>
        </div>
        <div>
          <h2 className="mb-1 text-sm font-medium text-muted-foreground">Primary contact</h2>
          <p className="text-base">
            {client.primary_contact_name || '—'}
            {client.primary_contact_email && (
              <span className="block text-sm text-muted-foreground">
                {client.primary_contact_email}
              </span>
            )}
          </p>
        </div>
        <div>
          <h2 className="mb-1 text-sm font-medium text-muted-foreground">Peec dashboard</h2>
          {client.peec_dashboard_url ? (
            <a
              href={client.peec_dashboard_url}
              target="_blank"
              rel="noreferrer"
              className="text-sm underline"
            >
              Open
            </a>
          ) : (
            <p className="text-sm text-muted-foreground">Not set</p>
          )}
        </div>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}
    </div>
  );
}
```

- [ ] **Step 2: Create the Client detail page (with tabs scaffold; Brand & Pipeline tabs are placeholders, filled in next tasks)**

```tsx
'use client';

import { use, useEffect, useState } from 'react';
import * as Tabs from '@radix-ui/react-tabs';
import Link from 'next/link';
import { api, type AgencyClientOut } from '@/lib/api';
import { ClientOverviewTab } from '@/components/clients/client-overview-tab';

export default function ClientDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const clientId = parseInt(id, 10);
  const [client, setClient] = useState<AgencyClientOut | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.getClient(clientId).then(setClient).catch((e) => setError(String(e?.message ?? e)));
  }, [clientId]);

  if (error) return <div className="p-8 text-sm text-red-600">{error}</div>;
  if (!client) return <div className="p-8 text-sm text-muted-foreground">Loading…</div>;

  return (
    <div className="p-8">
      <Link href="/clients" className="text-xs text-muted-foreground hover:underline">
        ← All clients
      </Link>
      <h1 className="mt-2 text-2xl font-semibold tracking-tight">{client.name}</h1>
      <p className="mb-6 text-sm text-muted-foreground">/{client.slug}</p>

      <Tabs.Root defaultValue="overview" className="w-full">
        <Tabs.List className="mb-6 flex gap-1 border-b border-border">
          {[
            ['overview', 'Overview'],
            ['brand', 'Brand & Prompts'],
            ['pipeline', 'Pipeline'],
          ].map(([value, label]) => (
            <Tabs.Trigger
              key={value}
              value={value}
              className="border-b-2 border-transparent px-4 py-2 text-sm text-muted-foreground data-[state=active]:border-primary data-[state=active]:text-foreground"
            >
              {label}
            </Tabs.Trigger>
          ))}
        </Tabs.List>

        <Tabs.Content value="overview">
          <ClientOverviewTab client={client} onChange={setClient} />
        </Tabs.Content>
        <Tabs.Content value="brand">
          <p className="text-sm text-muted-foreground">Filled in by Task 13.</p>
        </Tabs.Content>
        <Tabs.Content value="pipeline">
          <p className="text-sm text-muted-foreground">Filled in by Task 14.</p>
        </Tabs.Content>
      </Tabs.Root>
    </div>
  );
}
```

- [ ] **Step 3: TS check**

```bash
cd /Users/ken/Desktop/Lumidian/agency-frontend
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add agency-frontend
git commit -m "feat(agency-frontend): client detail page with Overview tab"
```

---

## Task 13: Client detail — Brand & Prompts tab

**Files:**
- Create: `agency-frontend/components/clients/client-brand-tab.tsx`
- Modify: `agency-frontend/app/(authed)/clients/[id]/page.tsx` (replace placeholder)

- [ ] **Step 1: Inspect the existing `brand_profile` and `brands/{id}/prompts` shapes**

Run:
```bash
grep -n "brand_profile\|router\|class.*Schema" /Users/ken/Desktop/Lumidian/backend/app/routers/brand_profile.py | head -30
grep -n "router\|class.*Schema\|prompts" /Users/ken/Desktop/Lumidian/backend/app/routers/brands.py | head -30
```

Note the response shapes for the brand profile and prompts endpoints — we'll display the fields exactly as the API returns them.

- [ ] **Step 2: Create the Brand & Prompts tab**

```tsx
'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';

interface Props {
  brandId: number | null;
}

interface BrandProfile {
  company_description?: string | null;
  tone_of_voice?: string | null;
  what_not_to_say?: string | null;
  approved_language?: string | null;
  publications?: string | null;
}

interface Prompt {
  id: number;
  text: string;
}

export function ClientBrandTab({ brandId }: Props) {
  const [profile, setProfile] = useState<BrandProfile | null>(null);
  const [prompts, setPrompts] = useState<Prompt[]>([]);
  const [newPrompt, setNewPrompt] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (brandId == null) return;
    Promise.all([
      api.getBrandProfile(brandId).catch(() => ({})),
      api.getPrompts(brandId).catch(() => []),
    ])
      .then(([p, pr]) => {
        setProfile(p as BrandProfile);
        setPrompts((pr as Prompt[]) ?? []);
      })
      .catch((e) => setError(String(e?.message ?? e)));
  }, [brandId]);

  if (brandId == null) {
    return <p className="text-sm text-muted-foreground">No brand attached to this client.</p>;
  }
  if (error) return <p className="text-sm text-red-600">{error}</p>;
  if (!profile) return <p className="text-sm text-muted-foreground">Loading…</p>;

  const saveProfile = async (patch: Partial<BrandProfile>) => {
    setSaving(true);
    try {
      const next = await api.updateBrandProfile(brandId, patch);
      setProfile(next as BrandProfile);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save profile.');
    } finally {
      setSaving(false);
    }
  };

  const addPrompt = async () => {
    if (!newPrompt.trim()) return;
    try {
      const created = (await api.addPrompt(brandId, newPrompt.trim())) as Prompt;
      setPrompts((prev) => [...prev, created]);
      setNewPrompt('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to add prompt.');
    }
  };

  const removePrompt = async (id: number) => {
    try {
      await api.deletePrompt(id);
      setPrompts((prev) => prev.filter((p) => p.id !== id));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to remove prompt.');
    }
  };

  const profileField = (label: string, key: keyof BrandProfile, rows = 3) => (
    <div>
      <label className="mb-1 block text-xs font-medium text-muted-foreground">{label}</label>
      <textarea
        defaultValue={profile[key] ?? ''}
        onBlur={(e) => {
          if ((profile[key] ?? '') !== e.target.value) {
            saveProfile({ [key]: e.target.value } as Partial<BrandProfile>);
          }
        }}
        rows={rows}
        className="w-full rounded-md border border-border px-3 py-2 text-sm"
      />
    </div>
  );

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
      <section className="space-y-3">
        <h3 className="text-sm font-medium">Brand profile</h3>
        {profileField('Company description', 'company_description', 4)}
        {profileField('Tone of voice', 'tone_of_voice', 2)}
        {profileField('What not to say', 'what_not_to_say', 2)}
        {profileField('Approved language', 'approved_language', 2)}
        {profileField('Publications (one per line)', 'publications', 3)}
        {saving && <p className="text-xs text-muted-foreground">Saving…</p>}
      </section>

      <section className="space-y-3">
        <h3 className="text-sm font-medium">Tracked prompts</h3>
        {prompts.length === 0 && (
          <p className="text-sm text-muted-foreground">No prompts yet.</p>
        )}
        <ul className="space-y-2">
          {prompts.map((p) => (
            <li
              key={p.id}
              className="flex items-start justify-between gap-3 rounded-md border border-border px-3 py-2 text-sm"
            >
              <span>{p.text}</span>
              <button
                onClick={() => removePrompt(p.id)}
                className="text-xs text-muted-foreground hover:text-red-600"
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
        <div className="flex gap-2">
          <input
            value={newPrompt}
            onChange={(e) => setNewPrompt(e.target.value)}
            placeholder="Add a prompt…"
            className="flex-1 rounded-md border border-border px-3 py-2 text-sm"
            onKeyDown={(e) => {
              if (e.key === 'Enter') addPrompt();
            }}
          />
          <button
            onClick={addPrompt}
            className="rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground"
          >
            Add
          </button>
        </div>
      </section>
    </div>
  );
}
```

- [ ] **Step 3: Wire the tab into the detail page**

In `agency-frontend/app/(authed)/clients/[id]/page.tsx`, replace the `Tabs.Content value="brand"` block with:

```tsx
        <Tabs.Content value="brand">
          <ClientBrandTab brandId={client.brand_id} />
        </Tabs.Content>
```

Also add the import at the top:

```tsx
import { ClientBrandTab } from '@/components/clients/client-brand-tab';
```

- [ ] **Step 4: TS check**

```bash
cd /Users/ken/Desktop/Lumidian/agency-frontend
npx tsc --noEmit
```

Expected: no errors. If `getBrandProfile` or `getPrompts` types don't satisfy strict TypeScript, the cast in the component handles it — leave the `lib/api.ts` return types as `unknown` via the `Record<string, unknown>`-shaped responses (already present in the API client).

- [ ] **Step 5: Commit**

```bash
git add agency-frontend
git commit -m "feat(agency-frontend): Brand & Prompts tab for client detail"
```

---

## Task 14: Client detail — Pipeline tab

**Files:**
- Create: `agency-frontend/components/clients/client-pipeline-tab.tsx`
- Modify: `agency-frontend/app/(authed)/clients/[id]/page.tsx`

- [ ] **Step 1: Inspect the draft response shape**

Run:
```bash
grep -n "drafts\|ContentDraft" /Users/ken/Desktop/Lumidian/backend/app/routers/content.py | head -30
```

Note the field names returned by `GET /api/content/{brand_id}/drafts` (status, platform, title, content_text, created_at, etc.).

- [ ] **Step 2: Create the Pipeline tab**

```tsx
'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';

interface Props {
  brandId: number | null;
}

interface DraftRow {
  id: number;
  title: string | null;
  content_text: string | null;
  platform: string;
  status: string;
  assigned_to_user_id?: number | null;
  created_at: string;
}

const COLUMNS: Array<{ key: string; label: string }> = [
  { key: 'draft', label: 'Draft' },
  { key: 'approved', label: 'Approved' },
  { key: 'posted', label: 'Posted' },
];

export function ClientPipelineTab({ brandId }: Props) {
  const [drafts, setDrafts] = useState<DraftRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (brandId == null) return;
    api
      .listDrafts(brandId)
      .then((data) => setDrafts((data as DraftRow[]) ?? []))
      .catch((e) => setError(String(e?.message ?? e)))
      .finally(() => setLoading(false));
  }, [brandId]);

  if (brandId == null) {
    return <p className="text-sm text-muted-foreground">No brand attached to this client.</p>;
  }
  if (loading) return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (error) return <p className="text-sm text-red-600">{error}</p>;

  if (drafts.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border p-10 text-center text-sm text-muted-foreground">
        No drafts yet. Generate some from Studio (V1) — for MVP, drafts created elsewhere on the
        backend will appear here.
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
      {COLUMNS.map(({ key, label }) => {
        const items = drafts.filter((d) => d.status === key);
        return (
          <section key={key} className="rounded-lg border border-border bg-white p-4">
            <h3 className="mb-3 flex items-center justify-between text-sm font-medium">
              <span>{label}</span>
              <span className="text-xs text-muted-foreground">{items.length}</span>
            </h3>
            <ul className="space-y-2">
              {items.map((d) => (
                <li key={d.id} className="rounded-md border border-border p-3 text-sm">
                  <div className="font-medium">{d.title || `Draft #${d.id}`}</div>
                  <div className="text-xs text-muted-foreground">{d.platform}</div>
                  {d.content_text && (
                    <p className="mt-2 line-clamp-3 text-xs text-muted-foreground">
                      {d.content_text}
                    </p>
                  )}
                </li>
              ))}
              {items.length === 0 && (
                <li className="rounded-md border border-dashed border-border p-3 text-xs text-muted-foreground">
                  Empty
                </li>
              )}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 3: Wire into the detail page**

In `agency-frontend/app/(authed)/clients/[id]/page.tsx`, replace the `Tabs.Content value="pipeline"` block with:

```tsx
        <Tabs.Content value="pipeline">
          <ClientPipelineTab brandId={client.brand_id} />
        </Tabs.Content>
```

Add the import:

```tsx
import { ClientPipelineTab } from '@/components/clients/client-pipeline-tab';
```

- [ ] **Step 4: TS check + lint**

```bash
cd /Users/ken/Desktop/Lumidian/agency-frontend
npx tsc --noEmit
npm run lint
```

Expected: no TS errors; lint may warn but should not fail.

- [ ] **Step 5: Commit**

```bash
git add agency-frontend
git commit -m "feat(agency-frontend): Pipeline tab for client detail"
```

---

## Task 15: End-to-end smoke test

**Files:** None — this is a manual verification task. No commits.

- [ ] **Step 1: Start the backend**

In one terminal:

```bash
cd /Users/ken/Desktop/Lumidian/backend
source venv/bin/activate
uvicorn app.main:app --reload --port 8000
```

Watch for `Migration applied: ALTER TABLE users ADD COLUMN is_agency_staff …` style log lines on first boot.

- [ ] **Step 2: Make sure there's a staff user**

In another terminal:

```bash
cd /Users/ken/Desktop/Lumidian/backend
source venv/bin/activate

# Find a staff candidate (admin)
python -c "import asyncio; from sqlalchemy import select; from app.database import AsyncSessionLocal; from app.models import User
async def m():
    async with AsyncSessionLocal() as db:
        rows = (await db.execute(select(User.email).where(User.is_admin == True))).scalars().all()
        print(rows)
asyncio.run(m())"
```

If an admin email is printed, run:

```bash
python seed_agency_staff.py <that-email> owner
```

Expected: `OK — <email> is now agency staff (owner).`

If no admin user exists, register one via the apex frontend (`http://localhost:3000/register`) first, then run the seed.

- [ ] **Step 3: Log in via apex frontend**

Start the apex frontend if it isn't already:

```bash
cd /Users/ken/Desktop/Lumidian/frontend
npm run dev
```

Open `http://localhost:3000/login`, log in as the staff user. This sets the `clarity_token` and `clarity_session` cookies for `localhost`.

- [ ] **Step 4: Start the agency frontend**

```bash
cd /Users/ken/Desktop/Lumidian/agency-frontend
npm run dev
```

Open `http://localhost:3003`. The `clarity_session` cookie is shared across `localhost` ports, so the middleware should let you through and the `/api/auth/me` call should return the user.

Verify:
- Today screen renders with `0 active clients · 0 drafts pending review` and three placeholder cards.
- Sidebar has "Today" and "Clients".
- Click Clients → empty state ("No clients yet…").
- Click "New client", fill in name "Test Client" + an email, create. The row appears.
- Click into the client → Overview tab shows status buttons; clicking "active" updates the badge and sets a started date.
- Brand & Prompts tab loads (may be empty); add a prompt; remove it.
- Pipeline tab shows three columns, all empty.

- [ ] **Step 5: Sanity-check non-staff lockout**

Log out, register a new non-staff user via apex (`http://localhost:3000/register`), then visit `http://localhost:3003`. The Today page should fail to load `/api/auth/me` data with a 403, or the API client's 401 interceptor should bounce you to `/login`. (If you see a 403 surface in the UI, that's acceptable — we're verifying the backend rejects non-staff.)

- [ ] **Step 6: Stop dev servers**

Ctrl+C in both terminals.

If everything above works, the MVP is functional end-to-end.

---

## Self-review notes

- **Spec coverage:** Today / Clients / Client detail (Overview, Brand & Prompts, Pipeline) all implemented (tasks 10, 11, 12, 13, 14). Backend tables and migrations (task 1). Cookie + CORS (task 4). Tests (task 5). Seed script (task 6). Studio, Notes, Reports, Settings explicitly deferred per spec.
- **`assigned_to_user_id`:** schema column added (task 1) and `PATCH /api/agency/drafts/{id}/assign` endpoint exists (task 3) — full UI for assignment is V1 (matches spec scope).
- **Note tables:** `client_notes` schema is created in task 1 but no UI/endpoints — per spec, Notes tab is V1.
- **Login redirect URL:** uses `NEXT_PUBLIC_APEX_LOGIN_URL` env var with localhost default. In production, set `NEXT_PUBLIC_APEX_LOGIN_URL=https://lumidian.ai/login`.
- **API URL:** uses `NEXT_PUBLIC_API_URL` env var with `http://localhost:8000` default. In production, set to backend URL.
