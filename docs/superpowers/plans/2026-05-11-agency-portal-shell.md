# Agency Portal Shell + Review Portal v1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restructure the existing `/agency` UI into a 4-tab client detail + 7-item global sidebar, replace the Peec link with a Lumidian tracking widget, and ship a public client review portal at `/review/{token}` that kills the Google Doc loop.

**Architecture:** All work lives inside the existing FastAPI backend + Next.js frontend (no new deploys). Backend gains a public, no-auth router for tokenized client reviews + new agency endpoints for review-link management and draft status transitions. Frontend restructures `/agency/clients/[id]` from 3 tabs to 4, adds 5 stub pages under the global sidebar, replaces the Peec UI with a Lumidian tracking widget, and adds a single public route at `/review/[token]`.

**Tech Stack:** FastAPI 0.115, SQLAlchemy 2.0 async, SQLite. Next.js 16, React 18, TypeScript, Radix UI, Tailwind.

**Spec:** `docs/superpowers/specs/2026-05-11-agency-portal-shell-design.md`

---

## File Structure

### Backend (modify or create)

- **Modify:** `backend/app/models.py` — add `client_feedback` and `client_reviewed_at` columns to `ContentDraft`; add new `ClientReviewLink` class.
- **Modify:** `backend/app/database.py` — append migration steps.
- **Modify:** `backend/app/schemas.py` — add Pydantic models for review-link out, public review draft out, request-changes / reject bodies, draft status update.
- **Modify:** `backend/app/routers/agency.py` — add `GET`/`POST` `/clients/{id}/review-link`, `PATCH /drafts/{draft_id}/status`.
- **Modify:** `backend/app/main.py` — mount new public router.
- **Modify:** `backend/tests/conftest.py` — add `client_review_links` to truncation list.
- **Modify:** `backend/tests/test_agency.py` — extend with new endpoint tests.
- **Create:** `backend/app/routers/review_public.py` — public no-auth router.
- **Create:** `backend/tests/test_review_public.py`.

### Frontend (modify or create)

- **Modify:** `frontend/lib/api.ts` — add agency review-link, draft-status, public-review methods + types.
- **Modify:** `frontend/components/agency/AgencySidebar.tsx` — add Calendar / Opportunities / Performance / Documents / Settings nav items.
- **Modify:** `frontend/app/agency/clients/[id]/page.tsx` — restructure tabs to Overview / Strategy / Content / Reports.
- **Modify:** `frontend/components/agency/ClientOverviewTab.tsx` — add Lumidian tracking widget + review-link section, remove Peec card.
- **Modify:** `frontend/components/agency/ClientPipelineTab.tsx` — extend kanban to 5 columns, add per-draft action buttons.
- **Modify:** `frontend/app/agency/page.tsx` — Today screen 3-column expansion.
- **Create:** `frontend/app/agency/calendar/page.tsx` — stub.
- **Create:** `frontend/app/agency/opportunities/page.tsx` — stub.
- **Create:** `frontend/app/agency/performance/page.tsx` — stub.
- **Create:** `frontend/app/agency/documents/page.tsx` — stub.
- **Create:** `frontend/app/agency/settings/page.tsx` — stub.
- **Create:** `frontend/components/agency/ClientStrategyTab.tsx` — wraps existing `ClientBrandTab` + room for AIO/notes later.
- **Create:** `frontend/components/agency/ClientContentTab.tsx` — wraps existing `ClientPipelineTab` + room for calendar/opps later.
- **Create:** `frontend/components/agency/ClientReportsTab.tsx` — placeholder list.
- **Create:** `frontend/components/agency/LumidianTrackingWidget.tsx`.
- **Create:** `frontend/components/agency/ReviewLinkSection.tsx`.
- **Create:** `frontend/app/review/[token]/page.tsx` — public review page.
- **Create:** `frontend/app/review/layout.tsx` — minimal layout (no AuthProvider gating).

### Middleware

- **Modify:** `frontend/middleware.ts` — add `/review` to PUBLIC_PATHS so middleware doesn't redirect public review URLs to login.

---

## Task 1: Backend models + migrations

**Files:**
- Modify: `backend/app/models.py`
- Modify: `backend/app/database.py`

- [ ] **Step 1: Add new fields to `ContentDraft` in `models.py`**

Find the `ContentDraft` class. After the existing `assigned_to_user_id` column, add:

```python
    client_feedback: Mapped[str | None] = mapped_column(Text, nullable=True)
    client_reviewed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
```

- [ ] **Step 2: Add `ClientReviewLink` model class**

Append at the end of `backend/app/models.py` (after the `ClientNote` class):

```python
class ClientReviewLink(Base):
    __tablename__ = "client_review_links"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    agency_client_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("agency_clients.id", ondelete="CASCADE"), nullable=False, index=True
    )
    token: Mapped[str] = mapped_column(String(64), nullable=False, unique=True, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
```

- [ ] **Step 3: Append migration statements in `database.py`**

In `backend/app/database.py`, find the `migrations` list and append at the bottom (just before the closing `]`):

```python
        # 2026-05-11: Agency portal shell — review portal + client states
        "ALTER TABLE content_drafts ADD COLUMN client_feedback TEXT",
        "ALTER TABLE content_drafts ADD COLUMN client_reviewed_at DATETIME",
        """CREATE TABLE IF NOT EXISTS client_review_links (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            agency_client_id INTEGER NOT NULL REFERENCES agency_clients(id) ON DELETE CASCADE,
            token TEXT NOT NULL UNIQUE,
            created_at DATETIME,
            revoked_at DATETIME
        )""",
        "CREATE INDEX IF NOT EXISTS idx_client_review_links_token ON client_review_links(token)",
        "CREATE INDEX IF NOT EXISTS idx_client_review_links_client ON client_review_links(agency_client_id)",
```

- [ ] **Step 4: Verify migrations apply cleanly**

Run:
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

Expected: prints `OK`.

- [ ] **Step 5: Commit**

```bash
git add backend/app/models.py backend/app/database.py
git commit -m "feat(backend): client review link model + draft client-feedback fields"
```

---

## Task 2: Pydantic schemas

**Files:**
- Modify: `backend/app/schemas.py`

- [ ] **Step 1: Append agency-portal-shell schemas to `schemas.py`**

Add at the bottom of `backend/app/schemas.py`:

```python
# ── Agency portal shell (2026-05-11) ─────────────────────────────────────────


class ReviewLinkOut(BaseModel):
    token: str
    url: str
    created_at: datetime
    model_config = ConfigDict(from_attributes=True)


class ReviewDraftOut(BaseModel):
    id: int
    title: str | None
    platform: str
    content_text: str
    created_at: datetime


class ReviewClientPageOut(BaseModel):
    client_name: str
    drafts: list[ReviewDraftOut]


class ChangesRequestIn(BaseModel):
    feedback: str = Field(min_length=1, max_length=2000)


class RejectIn(BaseModel):
    reason: str = Field(min_length=1, max_length=2000)


class DraftStatusUpdateIn(BaseModel):
    status: str = Field(min_length=1, max_length=32)
```

If `ConfigDict` isn't already imported at the top of `schemas.py`, add it.

- [ ] **Step 2: Verify imports**

```bash
cd /Users/ken/Desktop/Lumidian/backend
source venv/bin/activate
python -c "from app import schemas; print(schemas.ReviewLinkOut, schemas.DraftStatusUpdateIn)"
```

Expected: prints the two class repr lines, no ImportError.

- [ ] **Step 3: Commit**

```bash
git add backend/app/schemas.py
git commit -m "feat(backend): schemas for agency review portal"
```

---

## Task 3: Agency router additions

**Files:**
- Modify: `backend/app/routers/agency.py`

- [ ] **Step 1: Add review-link endpoints + draft status update**

Append to `backend/app/routers/agency.py` (after the existing `assign_draft` endpoint):

```python
import os
import secrets

from fastapi import Request

from app.models import ClientReviewLink
from app.schemas import DraftStatusUpdateIn, ReviewLinkOut


def _public_base_url(request: Request) -> str:
    """Return base URL for public links (env override, else inferred)."""
    env_url = os.getenv("PUBLIC_BASE_URL")
    if env_url:
        return env_url.rstrip("/")
    return f"{request.url.scheme}://{request.url.netloc}"


def _link_to_out(link: ClientReviewLink, request: Request) -> ReviewLinkOut:
    base = _public_base_url(request)
    return ReviewLinkOut(token=link.token, url=f"{base}/review/{link.token}", created_at=link.created_at)


@router.get("/clients/{client_id}/review-link", response_model=ReviewLinkOut | None)
async def get_review_link(
    client_id: int,
    request: Request,
    db: AsyncSession = Depends(get_db),
    _user: User = Depends(require_agency_staff),
):
    client = await db.get(AgencyClient, client_id)
    if client is None:
        raise HTTPException(status_code=404, detail="Client not found")
    q = await db.execute(
        select(ClientReviewLink)
        .where(ClientReviewLink.agency_client_id == client_id, ClientReviewLink.revoked_at.is_(None))
        .order_by(ClientReviewLink.created_at.desc())
        .limit(1)
    )
    link = q.scalar_one_or_none()
    return _link_to_out(link, request) if link else None


@router.post("/clients/{client_id}/review-link", response_model=ReviewLinkOut, status_code=http_status.HTTP_201_CREATED)
async def rotate_review_link(
    client_id: int,
    request: Request,
    db: AsyncSession = Depends(get_db),
    _user: User = Depends(require_agency_staff),
):
    client = await db.get(AgencyClient, client_id)
    if client is None:
        raise HTTPException(status_code=404, detail="Client not found")
    # Revoke any existing active links
    existing_q = await db.execute(
        select(ClientReviewLink).where(
            ClientReviewLink.agency_client_id == client_id,
            ClientReviewLink.revoked_at.is_(None),
        )
    )
    for old in existing_q.scalars().all():
        old.revoked_at = datetime.utcnow()
    new_link = ClientReviewLink(
        agency_client_id=client_id,
        token=secrets.token_urlsafe(32),
    )
    db.add(new_link)
    await db.commit()
    await db.refresh(new_link)
    return _link_to_out(new_link, request)


_STAFF_ALLOWED_STATUSES = {"draft", "awaiting_client", "approved", "posted", "dismissed"}


@router.patch("/drafts/{draft_id}/status", status_code=http_status.HTTP_204_NO_CONTENT)
async def update_draft_status(
    draft_id: int,
    body: DraftStatusUpdateIn,
    db: AsyncSession = Depends(get_db),
    _user: User = Depends(require_agency_staff),
):
    if body.status not in _STAFF_ALLOWED_STATUSES:
        raise HTTPException(
            status_code=http_status.HTTP_400_BAD_REQUEST,
            detail=f"Status must be one of {sorted(_STAFF_ALLOWED_STATUSES)}",
        )
    draft = await db.get(ContentDraft, draft_id)
    if draft is None:
        raise HTTPException(status_code=404, detail="Draft not found")
    draft.status = body.status
    if body.status == "approved" and draft.approved_at is None:
        draft.approved_at = datetime.utcnow()
    if body.status == "posted" and draft.posted_at is None:
        draft.posted_at = datetime.utcnow()
    await db.commit()
```

- [ ] **Step 2: Verify the new routes exist**

Run:
```bash
cd /Users/ken/Desktop/Lumidian/backend
source venv/bin/activate
python -c "from app.main import app
paths = [str(getattr(r, 'path', '')) for r in app.routes]
for p in paths:
    if 'review-link' in p or 'drafts/{draft_id}/status' in p:
        print(p)"
```

Expected output should include `/api/agency/clients/{client_id}/review-link` (twice, for GET + POST) and `/api/agency/drafts/{draft_id}/status`.

- [ ] **Step 3: Commit**

```bash
git add backend/app/routers/agency.py
git commit -m "feat(backend): agency review-link endpoints + draft status update"
```

---

## Task 4: Public review router

**Files:**
- Create: `backend/app/routers/review_public.py`
- Modify: `backend/app/main.py`

- [ ] **Step 1: Create `backend/app/routers/review_public.py`**

```python
"""Public, no-auth client review router. Token-gated via ClientReviewLink."""
from __future__ import annotations

from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from fastapi import status as http_status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models import AgencyClient, Brand, ClientReviewLink, ContentDraft
from app.schemas import ChangesRequestIn, RejectIn, ReviewClientPageOut, ReviewDraftOut

router = APIRouter(prefix="/api/public/review", tags=["public-review"])


async def _resolve_client_id(db: AsyncSession, token: str) -> int:
    q = await db.execute(
        select(ClientReviewLink).where(
            ClientReviewLink.token == token,
            ClientReviewLink.revoked_at.is_(None),
        )
    )
    link = q.scalar_one_or_none()
    if link is None:
        raise HTTPException(status_code=404, detail="Review link not found or revoked")
    return link.agency_client_id


async def _get_pending_draft(db: AsyncSession, client_id: int, draft_id: int) -> ContentDraft:
    """Fetch a draft, verify it belongs to this client AND is in awaiting_client state."""
    brand_q = await db.execute(select(Brand.id).where(Brand.agency_client_id == client_id))
    brand_ids = list(brand_q.scalars().all())
    if not brand_ids:
        raise HTTPException(status_code=404, detail="No brand attached to this client")
    draft = await db.get(ContentDraft, draft_id)
    if draft is None or draft.brand_id not in brand_ids:
        raise HTTPException(status_code=404, detail="Draft not found")
    if draft.status != "awaiting_client":
        raise HTTPException(
            status_code=http_status.HTTP_409_CONFLICT,
            detail=f"Draft is in '{draft.status}' state, not awaiting client review",
        )
    return draft


@router.get("/{token}", response_model=ReviewClientPageOut)
async def get_review_page(token: str, db: AsyncSession = Depends(get_db)):
    client_id = await _resolve_client_id(db, token)
    client = await db.get(AgencyClient, client_id)
    if client is None:
        raise HTTPException(status_code=404, detail="Client not found")
    brand_q = await db.execute(select(Brand.id).where(Brand.agency_client_id == client_id))
    brand_ids = list(brand_q.scalars().all())
    drafts: list[ContentDraft] = []
    if brand_ids:
        drafts_q = await db.execute(
            select(ContentDraft)
            .where(
                ContentDraft.brand_id.in_(brand_ids),
                ContentDraft.status == "awaiting_client",
            )
            .order_by(ContentDraft.created_at.asc())
        )
        drafts = list(drafts_q.scalars().all())
    return ReviewClientPageOut(
        client_name=client.name,
        drafts=[
            ReviewDraftOut(
                id=d.id,
                title=getattr(d, "title", None),
                platform=d.platform,
                content_text=d.content_text,
                created_at=d.created_at,
            )
            for d in drafts
        ],
    )


@router.post("/{token}/draft/{draft_id}/approve", status_code=http_status.HTTP_204_NO_CONTENT)
async def approve_draft(token: str, draft_id: int, db: AsyncSession = Depends(get_db)):
    client_id = await _resolve_client_id(db, token)
    draft = await _get_pending_draft(db, client_id, draft_id)
    now = datetime.utcnow()
    draft.status = "approved"
    draft.approved_at = now
    draft.client_reviewed_at = now
    await db.commit()


@router.post("/{token}/draft/{draft_id}/request-changes", status_code=http_status.HTTP_204_NO_CONTENT)
async def request_changes(
    token: str,
    draft_id: int,
    body: ChangesRequestIn,
    db: AsyncSession = Depends(get_db),
):
    client_id = await _resolve_client_id(db, token)
    draft = await _get_pending_draft(db, client_id, draft_id)
    draft.status = "changes_requested"
    draft.client_feedback = body.feedback
    draft.client_reviewed_at = datetime.utcnow()
    await db.commit()


@router.post("/{token}/draft/{draft_id}/reject", status_code=http_status.HTTP_204_NO_CONTENT)
async def reject_draft(
    token: str,
    draft_id: int,
    body: RejectIn,
    db: AsyncSession = Depends(get_db),
):
    client_id = await _resolve_client_id(db, token)
    draft = await _get_pending_draft(db, client_id, draft_id)
    draft.status = "rejected"
    draft.client_feedback = body.reason
    draft.client_reviewed_at = datetime.utcnow()
    await db.commit()
```

- [ ] **Step 2: Mount the public router in `main.py`**

In `backend/app/main.py`, find the imports near line 60-69 and add (alphabetical with the others):

```python
from app.routers import review_public as review_public_router
```

Then near the `app.include_router(...)` calls (around line 210-230), add:

```python
app.include_router(review_public_router.router)
```

(Note: this router uses its own `/api/public/review` prefix internally, so do NOT add a `prefix=` argument to `include_router`.)

- [ ] **Step 3: Verify the public routes exist**

Run:
```bash
cd /Users/ken/Desktop/Lumidian/backend
source venv/bin/activate
python -c "from app.main import app
for r in app.routes:
    p = str(getattr(r, 'path', ''))
    if '/public/review' in p:
        print(p)"
```

Expected: 4 lines including `/api/public/review/{token}`, `/api/public/review/{token}/draft/{draft_id}/approve`, etc.

- [ ] **Step 4: Commit**

```bash
git add backend/app/routers/review_public.py backend/app/main.py
git commit -m "feat(backend): public client review router"
```

---

## Task 5: Backend tests

**Files:**
- Modify: `backend/tests/conftest.py`
- Modify: `backend/tests/test_agency.py`
- Create: `backend/tests/test_review_public.py`

- [ ] **Step 1: Add new tables to test truncation**

In `backend/tests/conftest.py`, find the truncation list (around line 109) and add `client_review_links` near the other agency tables:

Replace:
```python
            "client_notes", "agency_staff",
```

With:
```python
            "client_notes", "client_review_links", "agency_staff",
```

- [ ] **Step 2: Extend `test_agency.py` with review-link + draft-status tests**

Append to `backend/tests/test_agency.py`:

```python
@pytest.mark.asyncio
async def test_get_review_link_returns_none_when_none_exists(client):
    await _make_agency_user(client)
    create = await client.post("/api/agency/clients", json={"name": "RL One"})
    cid = create.json()["id"]
    resp = await client.get(f"/api/agency/clients/{cid}/review-link")
    assert resp.status_code == 200
    assert resp.json() is None


@pytest.mark.asyncio
async def test_create_and_rotate_review_link(client):
    await _make_agency_user(client)
    create = await client.post("/api/agency/clients", json={"name": "RL Two"})
    cid = create.json()["id"]

    first = await client.post(f"/api/agency/clients/{cid}/review-link")
    assert first.status_code == 201
    first_data = first.json()
    assert first_data["token"]
    assert first_data["url"].endswith(f"/review/{first_data['token']}")

    # Rotating produces a new token; old one is revoked
    second = await client.post(f"/api/agency/clients/{cid}/review-link")
    assert second.status_code == 201
    assert second.json()["token"] != first_data["token"]

    # GET returns the latest active
    current = await client.get(f"/api/agency/clients/{cid}/review-link")
    assert current.json()["token"] == second.json()["token"]


@pytest.mark.asyncio
async def test_update_draft_status_requires_valid_status(client, db_session):
    from app.models import AgencyClient, Brand, ContentDraft

    await _make_agency_user(client)
    create = await client.post("/api/agency/clients", json={"name": "RL Three"})
    cid = create.json()["id"]
    brand_id = create.json()["brand_id"]

    # Create a draft directly in DB
    draft = ContentDraft(brand_id=brand_id, platform="medium", content_text="x", status="draft")
    db_session.add(draft)
    await db_session.commit()
    await db_session.refresh(draft)

    bad = await client.patch(f"/api/agency/drafts/{draft.id}/status", json={"status": "invalid"})
    assert bad.status_code == 400

    good = await client.patch(f"/api/agency/drafts/{draft.id}/status", json={"status": "awaiting_client"})
    assert good.status_code == 204
```

- [ ] **Step 3: Create `backend/tests/test_review_public.py`**

```python
"""Tests for the public client review router (no auth)."""
from __future__ import annotations

import pytest

from app.database import AsyncSessionLocal
from app.models import AgencyClient, Brand, ClientReviewLink, ContentDraft


async def _setup_client_with_pending_draft(client_name: str = "PubClient") -> tuple[str, int]:
    """Create an agency client + brand + token + one awaiting_client draft. Returns (token, draft_id)."""
    async with AsyncSessionLocal() as db:
        ac = AgencyClient(name=client_name, slug=client_name.lower().replace(" ", "-"))
        db.add(ac)
        await db.flush()
        brand = Brand(name=client_name, slug=f"b-{ac.slug}", agency_client_id=ac.id, brand_type="standard")
        db.add(brand)
        await db.flush()
        link = ClientReviewLink(agency_client_id=ac.id, token="testtoken-" + client_name.lower())
        db.add(link)
        draft = ContentDraft(
            brand_id=brand.id,
            platform="medium",
            content_text="Draft body",
            status="awaiting_client",
            title="Demo draft",
        )
        db.add(draft)
        await db.commit()
        return link.token, draft.id


@pytest.mark.asyncio
async def test_invalid_token_returns_404(client):
    resp = await client.get("/api/public/review/does-not-exist")
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_review_page_lists_awaiting_drafts(client):
    token, draft_id = await _setup_client_with_pending_draft("ReviewPage")
    resp = await client.get(f"/api/public/review/{token}")
    assert resp.status_code == 200
    body = resp.json()
    assert body["client_name"] == "ReviewPage"
    assert len(body["drafts"]) == 1
    assert body["drafts"][0]["id"] == draft_id


@pytest.mark.asyncio
async def test_approve_transitions_status(client, db_session):
    from app.models import ContentDraft as Cd

    token, draft_id = await _setup_client_with_pending_draft("Approve")
    resp = await client.post(f"/api/public/review/{token}/draft/{draft_id}/approve")
    assert resp.status_code == 204

    refreshed = await db_session.get(Cd, draft_id)
    assert refreshed.status == "approved"
    assert refreshed.approved_at is not None
    assert refreshed.client_reviewed_at is not None


@pytest.mark.asyncio
async def test_request_changes_writes_feedback(client, db_session):
    from app.models import ContentDraft as Cd

    token, draft_id = await _setup_client_with_pending_draft("Changes")
    resp = await client.post(
        f"/api/public/review/{token}/draft/{draft_id}/request-changes",
        json={"feedback": "Make it shorter"},
    )
    assert resp.status_code == 204

    refreshed = await db_session.get(Cd, draft_id)
    assert refreshed.status == "changes_requested"
    assert refreshed.client_feedback == "Make it shorter"


@pytest.mark.asyncio
async def test_reject_writes_reason(client, db_session):
    from app.models import ContentDraft as Cd

    token, draft_id = await _setup_client_with_pending_draft("Reject")
    resp = await client.post(
        f"/api/public/review/{token}/draft/{draft_id}/reject",
        json={"reason": "Off-brand"},
    )
    assert resp.status_code == 204

    refreshed = await db_session.get(Cd, draft_id)
    assert refreshed.status == "rejected"
    assert refreshed.client_feedback == "Off-brand"


@pytest.mark.asyncio
async def test_action_on_already_reviewed_draft_409(client):
    token, draft_id = await _setup_client_with_pending_draft("AlreadyDone")
    # First approve
    await client.post(f"/api/public/review/{token}/draft/{draft_id}/approve")
    # Try to approve again
    again = await client.post(f"/api/public/review/{token}/draft/{draft_id}/approve")
    assert again.status_code == 409


@pytest.mark.asyncio
async def test_request_changes_validates_feedback_length(client):
    token, draft_id = await _setup_client_with_pending_draft("Validate")
    resp = await client.post(
        f"/api/public/review/{token}/draft/{draft_id}/request-changes",
        json={"feedback": ""},
    )
    assert resp.status_code == 422
```

- [ ] **Step 4: Run all the new tests**

```bash
cd /Users/ken/Desktop/Lumidian/backend
source venv/bin/activate
pytest tests/test_agency.py tests/test_review_public.py -v --timeout=60
```

Expected: all tests PASS (10 in test_agency.py + 7 in test_review_public.py = 17 total).

- [ ] **Step 5: Commit**

```bash
git add backend/tests/conftest.py backend/tests/test_agency.py backend/tests/test_review_public.py
git commit -m "test(backend): agency review-link, draft-status, public review endpoints"
```

---

## Task 6: Frontend API client additions

**Files:**
- Modify: `frontend/lib/api.ts`

- [ ] **Step 1: Append new types and methods**

At the end of the agency portal section in `frontend/lib/api.ts` (after `agencyAssignDraft`), add:

```typescript
// ── Agency portal shell (2026-05-11) ─────────────────────────────────────────

export interface ReviewLinkOut {
  token: string;
  url: string;
  created_at: string;
}

export type DraftStaffStatus =
  | 'draft'
  | 'awaiting_client'
  | 'approved'
  | 'posted'
  | 'dismissed';

export async function agencyGetReviewLink(clientId: number): Promise<ReviewLinkOut | null> {
  const res = await api.get<ReviewLinkOut | null>(`/agency/clients/${clientId}/review-link`);
  return res.data;
}

export async function agencyRotateReviewLink(clientId: number): Promise<ReviewLinkOut> {
  const res = await api.post<ReviewLinkOut>(`/agency/clients/${clientId}/review-link`);
  return res.data;
}

export async function agencyUpdateDraftStatus(
  draftId: number,
  status: DraftStaffStatus,
): Promise<void> {
  await api.patch(`/agency/drafts/${draftId}/status`, { status });
}

// ── Public review (no auth) ──────────────────────────────────────────────────

export interface ReviewDraft {
  id: number;
  title: string | null;
  platform: string;
  content_text: string;
  created_at: string;
}

export interface ReviewClientPage {
  client_name: string;
  drafts: ReviewDraft[];
}

export async function publicGetReviewPage(token: string): Promise<ReviewClientPage> {
  const res = await api.get<ReviewClientPage>(`/public/review/${token}`);
  return res.data;
}

export async function publicApproveDraft(token: string, draftId: number): Promise<void> {
  await api.post(`/public/review/${token}/draft/${draftId}/approve`);
}

export async function publicRequestChanges(
  token: string,
  draftId: number,
  feedback: string,
): Promise<void> {
  await api.post(`/public/review/${token}/draft/${draftId}/request-changes`, { feedback });
}

export async function publicRejectDraft(
  token: string,
  draftId: number,
  reason: string,
): Promise<void> {
  await api.post(`/public/review/${token}/draft/${draftId}/reject`, { reason });
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
git commit -m "feat(frontend): agency review-link + public review API methods"
```

---

## Task 7: Sidebar nav additions + stub pages

**Files:**
- Modify: `frontend/components/agency/AgencySidebar.tsx`
- Create: `frontend/app/agency/calendar/page.tsx`
- Create: `frontend/app/agency/opportunities/page.tsx`
- Create: `frontend/app/agency/performance/page.tsx`
- Create: `frontend/app/agency/documents/page.tsx`
- Create: `frontend/app/agency/settings/page.tsx`

- [ ] **Step 1: Update `AgencySidebar.tsx` with new nav items**

Replace the entire content of `frontend/components/agency/AgencySidebar.tsx` with:

```tsx
'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  Home,
  Users,
  Calendar,
  Inbox,
  BarChart3,
  FileText,
  Settings as SettingsIcon,
  ArrowLeft,
  Shield,
} from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';

const NAV = [
  { href: '/agency', label: 'Today', icon: Home, exact: true },
  { href: '/agency/clients', label: 'Clients', icon: Users, exact: false },
  { href: '/agency/calendar', label: 'Calendar', icon: Calendar, exact: false },
  { href: '/agency/opportunities', label: 'Opportunities', icon: Inbox, exact: false },
  { href: '/agency/performance', label: 'Performance', icon: BarChart3, exact: false },
  { href: '/agency/documents', label: 'Documents', icon: FileText, exact: false },
  { href: '/agency/settings', label: 'Settings', icon: SettingsIcon, exact: false },
];

export function AgencySidebar() {
  const pathname = usePathname();
  const { user } = useAuth();

  return (
    <aside className="flex w-56 shrink-0 flex-col border-r border-[var(--border-subtle)] bg-[var(--bg-raised)]">
      <div className="px-5 py-5 text-base font-semibold tracking-tight text-[var(--text-primary)]">
        Lumidian Agency
      </div>

      <nav className="flex-1 px-2 pb-4">
        {NAV.map(({ href, label, icon: Icon, exact }) => {
          const active = exact ? pathname === href : pathname.startsWith(href);
          return (
            <Link
              key={href}
              href={href}
              className={`flex items-center gap-2 rounded-md px-3 py-2 text-sm transition ${
                active
                  ? 'bg-[var(--bg-elevated)] text-[var(--text-primary)]'
                  : 'text-[var(--text-secondary)] hover:bg-[var(--bg-card)] hover:text-[var(--text-primary)]'
              }`}
            >
              <Icon className="h-4 w-4" />
              {label}
            </Link>
          );
        })}
      </nav>

      <div className="border-t border-[var(--border-subtle)] px-2 py-3">
        <Link
          href="/dashboard"
          className="flex items-center gap-2 rounded-md px-3 py-2 text-sm text-[var(--text-secondary)] transition hover:bg-[var(--bg-card)] hover:text-[var(--text-primary)]"
        >
          <ArrowLeft className="h-4 w-4" />
          Lumidian app
        </Link>
        {user?.is_admin && (
          <Link
            href="/admin"
            className="flex items-center gap-2 rounded-md px-3 py-2 text-sm text-[var(--text-secondary)] transition hover:bg-[var(--bg-card)] hover:text-[var(--text-primary)]"
          >
            <Shield className="h-4 w-4" />
            Admin
          </Link>
        )}
      </div>
    </aside>
  );
}
```

- [ ] **Step 2: Create the 5 stub pages**

For each of `calendar`, `opportunities`, `performance`, `documents`, `settings`, create the page file with this body. Replace `STUB_TITLE` and `STUB_BODY` per the table below.

| Filename | STUB_TITLE | STUB_BODY |
|---|---|---|
| `frontend/app/agency/calendar/page.tsx` | `Calendar` | `Week and month view of every scheduled and posted piece across all clients. Coming soon.` |
| `frontend/app/agency/opportunities/page.tsx` | `Opportunities` | `Reddit, Quora, and other thread opportunities found by Lumidian's scanner, filterable by client. Coming soon.` |
| `frontend/app/agency/performance/page.tsx` | `Performance` | `Visibility lift attribution across clients — which posts moved which scores. Coming soon.` |
| `frontend/app/agency/documents/page.tsx` | `Documents` | `Generated artifacts (audits, SOWs, monthly reports) and templates. Coming soon.` |
| `frontend/app/agency/settings/page.tsx` | `Settings` | `Staff management, integrations, document templates. Coming soon.` |

Each page file content (substitute the title/body):

```tsx
export default function StubPage() {
  return (
    <div className="p-8 text-[var(--text-primary)]">
      <h1 className="text-2xl font-semibold tracking-tight">STUB_TITLE</h1>
      <p className="mt-3 max-w-2xl text-sm text-[var(--text-muted)]">
        STUB_BODY
      </p>
    </div>
  );
}
```

- [ ] **Step 3: Type-check**

```bash
cd /Users/ken/Desktop/Lumidian/frontend
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add frontend/components/agency/AgencySidebar.tsx frontend/app/agency
git commit -m "feat(frontend): agency global sidebar nav + stub pages"
```

---

## Task 8: Lumidian tracking widget

**Files:**
- Create: `frontend/components/agency/LumidianTrackingWidget.tsx`

- [ ] **Step 1: Create the widget**

```tsx
'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { getOverview, getTrends, type OverviewData } from '@/lib/api';

interface Props {
  brandId: number | null;
}

interface TrendPointShape {
  overall_score?: number | null;
  date?: string;
}

export function LumidianTrackingWidget({ brandId }: Props) {
  const [overview, setOverview] = useState<OverviewData | null>(null);
  const [trend, setTrend] = useState<number[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (brandId == null) return;
    getOverview(brandId)
      .then(setOverview)
      .catch((e) => setError(String(e?.message ?? e)));
    getTrends(brandId)
      .then((t) => {
        const points: TrendPointShape[] = (t as unknown as { points: TrendPointShape[] }).points ?? [];
        setTrend(
          points
            .slice(-8)
            .map((p) => (typeof p.overall_score === 'number' ? p.overall_score : 0)),
        );
      })
      .catch(() => setTrend([]));
  }, [brandId]);

  if (brandId == null) {
    return (
      <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-card)] p-4 text-sm text-[var(--text-muted)]">
        No brand attached.
      </div>
    );
  }
  if (error) {
    return (
      <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-card)] p-4 text-sm text-red-400">
        {error}
      </div>
    );
  }
  if (!overview) {
    return (
      <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-card)] p-4 text-sm text-[var(--text-muted)]">
        Loading tracking…
      </div>
    );
  }

  const overall = Math.round((overview.overall_score ?? 0) * 100) / 100;
  const modelBars: Array<{ label: string; value: number }> = [
    { label: 'ChatGPT', value: overview.chatgpt_score ?? 0 },
    { label: 'Claude', value: overview.claude_score ?? 0 },
    { label: 'Perplexity', value: overview.perplexity_score ?? 0 },
    { label: 'Gemini', value: overview.gemini_score ?? 0 },
  ];

  const max = Math.max(1, ...trend);

  return (
    <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-card)] p-5 text-[var(--text-primary)]">
      <div className="flex items-baseline justify-between">
        <h3 className="text-sm font-medium text-[var(--text-secondary)]">Lumidian visibility</h3>
        <Link
          href={`/dashboard?brand=${brandId}`}
          className="text-xs text-[var(--text-muted)] hover:underline"
        >
          Open in Lumidian →
        </Link>
      </div>
      <div className="mt-2 text-3xl font-semibold">{overall}%</div>

      <div className="mt-4 grid grid-cols-4 gap-2 text-xs text-[var(--text-secondary)]">
        {modelBars.map(({ label, value }) => (
          <div key={label}>
            <div className="mb-1 truncate">{label}</div>
            <div className="h-2 overflow-hidden rounded-full bg-[var(--bg-raised)]">
              <div
                className="h-full bg-[var(--text-secondary)]"
                style={{ width: `${Math.min(100, value)}%` }}
              />
            </div>
            <div className="mt-1">{Math.round(value)}%</div>
          </div>
        ))}
      </div>

      {trend.length > 0 && (
        <div className="mt-4">
          <div className="mb-1 text-xs text-[var(--text-muted)]">Last {trend.length} runs</div>
          <div className="flex h-10 items-end gap-1">
            {trend.map((v, i) => (
              <div
                key={i}
                className="w-full bg-[var(--text-secondary)] opacity-60"
                style={{ height: `${(v / max) * 100}%` }}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Type-check**

```bash
cd /Users/ken/Desktop/Lumidian/frontend
npx tsc --noEmit
```

If `OverviewData` doesn't have the per-model fields with the names used above (`chatgpt_score`, etc.), check the type and adjust the field names. The fields exist on the API response — see `frontend/lib/api.ts` `OverviewData` interface around line 187. Use whatever the actual field names are.

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add frontend/components/agency/LumidianTrackingWidget.tsx
git commit -m "feat(frontend): Lumidian tracking widget for agency overview"
```

---

## Task 9: Review-link section component

**Files:**
- Create: `frontend/components/agency/ReviewLinkSection.tsx`

- [ ] **Step 1: Create the component**

```tsx
'use client';

import { useEffect, useState } from 'react';
import { Copy, RefreshCw } from 'lucide-react';
import {
  agencyGetReviewLink,
  agencyRotateReviewLink,
  type ReviewLinkOut,
} from '@/lib/api';

interface Props {
  clientId: number;
}

export function ReviewLinkSection({ clientId }: Props) {
  const [link, setLink] = useState<ReviewLinkOut | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    agencyGetReviewLink(clientId)
      .then(setLink)
      .catch((e) => setError(String(e?.message ?? e)))
      .finally(() => setLoading(false));
  }, [clientId]);

  const generate = async () => {
    setBusy(true);
    setError(null);
    try {
      const next = await agencyRotateReviewLink(clientId);
      setLink(next);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to generate link');
    } finally {
      setBusy(false);
    }
  };

  const copy = () => {
    if (!link) return;
    navigator.clipboard.writeText(link.url);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-card)] p-5 text-[var(--text-primary)]">
      <h3 className="text-sm font-medium text-[var(--text-secondary)]">Client review link</h3>
      {loading && (
        <p className="mt-2 text-sm text-[var(--text-muted)]">Loading…</p>
      )}
      {!loading && !link && (
        <div className="mt-2 space-y-2">
          <p className="text-sm text-[var(--text-muted)]">
            No review link yet. Generate one to share with the client.
          </p>
          <button
            onClick={generate}
            disabled={busy}
            className="rounded-md bg-[var(--bg-elevated)] px-3 py-2 text-xs font-medium text-[var(--text-primary)] hover:bg-[var(--bg-card)] disabled:opacity-50"
          >
            {busy ? 'Generating…' : 'Generate review link'}
          </button>
        </div>
      )}
      {!loading && link && (
        <div className="mt-2 space-y-2">
          <div className="flex items-center gap-2">
            <code className="flex-1 truncate rounded-md border border-[var(--border-default)] bg-[var(--bg-raised)] px-3 py-2 text-xs">
              {link.url}
            </code>
            <button
              onClick={copy}
              title="Copy"
              className="rounded-md border border-[var(--border-default)] p-2 hover:bg-[var(--bg-raised)]"
            >
              <Copy className="h-3.5 w-3.5" />
            </button>
            <button
              onClick={generate}
              disabled={busy}
              title="Rotate (revokes the old link)"
              className="rounded-md border border-[var(--border-default)] p-2 hover:bg-[var(--bg-raised)] disabled:opacity-50"
            >
              <RefreshCw className="h-3.5 w-3.5" />
            </button>
          </div>
          <p className="text-xs text-[var(--text-muted)]">
            Share this link with the client. Drafts in &ldquo;awaiting client&rdquo; status appear here for them to approve, request changes, or reject.{' '}
            {copied && <span className="text-emerald-400">Copied!</span>}
          </p>
        </div>
      )}
      {error && <p className="mt-2 text-sm text-red-400">{error}</p>}
    </div>
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
git add frontend/components/agency/ReviewLinkSection.tsx
git commit -m "feat(frontend): review-link generate/copy/rotate UI"
```

---

## Task 10: Restructure client detail tabs (Overview / Strategy / Content / Reports)

**Files:**
- Modify: `frontend/components/agency/ClientOverviewTab.tsx`
- Create: `frontend/components/agency/ClientStrategyTab.tsx`
- Create: `frontend/components/agency/ClientContentTab.tsx`
- Create: `frontend/components/agency/ClientReportsTab.tsx`
- Modify: `frontend/app/agency/clients/[id]/page.tsx`

- [ ] **Step 1: Add the tracking widget + review-link section to `ClientOverviewTab.tsx`**

Replace the existing `frontend/components/agency/ClientOverviewTab.tsx` file with:

```tsx
'use client';

import { useState } from 'react';
import { agencyUpdateClient, type AgencyClient } from '@/lib/api';
import { LumidianTrackingWidget } from './LumidianTrackingWidget';
import { ReviewLinkSection } from './ReviewLinkSection';

interface Props {
  client: AgencyClient;
  onChange: (next: AgencyClient) => void;
}

const STATUSES: AgencyClient['status'][] = ['onboarding', 'active', 'paused', 'churned'];

export function ClientOverviewTab({ client, onChange }: Props) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const updateStatus = async (status: AgencyClient['status']) => {
    setSaving(true);
    setError(null);
    try {
      const next = await agencyUpdateClient(client.id, { status });
      onChange(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6 text-[var(--text-primary)]">
      <div>
        <h2 className="text-sm font-medium text-[var(--text-secondary)]">Status</h2>
        <div className="mt-2 flex gap-2">
          {STATUSES.map((s) => (
            <button
              key={s}
              onClick={() => updateStatus(s)}
              disabled={saving || client.status === s}
              className={`rounded-md border px-3 py-1.5 text-xs ${
                client.status === s
                  ? 'border-[var(--border-strong)] bg-[var(--bg-elevated)] text-[var(--text-primary)]'
                  : 'border-[var(--border-default)] bg-[var(--bg-card)] text-[var(--text-secondary)] hover:bg-[var(--bg-raised)]'
              }`}
            >
              {s}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <LumidianTrackingWidget brandId={client.brand_id} />
        <ReviewLinkSection clientId={client.id} />
      </div>

      <div className="grid grid-cols-2 gap-6">
        <div>
          <h2 className="mb-1 text-sm font-medium text-[var(--text-secondary)]">Retainer</h2>
          <p className="text-base">
            {client.retainer_amount_usd ? `$${client.retainer_amount_usd}/mo` : '—'}
          </p>
        </div>
        <div>
          <h2 className="mb-1 text-sm font-medium text-[var(--text-secondary)]">Started</h2>
          <p className="text-base">
            {client.retainer_started_at
              ? new Date(client.retainer_started_at).toLocaleDateString()
              : '—'}
          </p>
        </div>
        <div>
          <h2 className="mb-1 text-sm font-medium text-[var(--text-secondary)]">Primary contact</h2>
          <p className="text-base">
            {client.primary_contact_name || '—'}
            {client.primary_contact_email && (
              <span className="block text-sm text-[var(--text-muted)]">
                {client.primary_contact_email}
              </span>
            )}
          </p>
        </div>
      </div>

      {error && <p className="text-sm text-red-400">{error}</p>}
    </div>
  );
}
```

(Note: Peec dashboard URL section is removed; field stays in the schema.)

- [ ] **Step 2: Create `ClientStrategyTab.tsx` wrapping the existing brand tab**

```tsx
'use client';

import { ClientBrandTab } from './ClientBrandTab';

interface Props {
  brandId: number | null;
}

export function ClientStrategyTab({ brandId }: Props) {
  return (
    <div className="space-y-6 text-[var(--text-primary)]">
      <ClientBrandTab brandId={brandId} />
      <div className="rounded-lg border border-dashed border-[var(--border-subtle)] p-6 text-sm text-[var(--text-muted)]">
        Content gaps, AIO website audit, and internal notes will live here. Coming soon.
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Create `ClientContentTab.tsx` wrapping pipeline**

```tsx
'use client';

import { ClientPipelineTab } from './ClientPipelineTab';

interface Props {
  brandId: number | null;
}

export function ClientContentTab({ brandId }: Props) {
  return (
    <div className="space-y-6 text-[var(--text-primary)]">
      <ClientPipelineTab brandId={brandId} />
      <div className="rounded-lg border border-dashed border-[var(--border-subtle)] p-6 text-sm text-[var(--text-muted)]">
        Per-client calendar, opportunities, and YouTube queue will appear here. Coming soon.
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Create `ClientReportsTab.tsx`**

```tsx
'use client';

interface Props {
  brandId: number | null;
}

export function ClientReportsTab({ brandId }: Props) {
  if (brandId == null) {
    return <p className="text-sm text-[var(--text-muted)]">No brand attached to this client.</p>;
  }
  return (
    <div className="space-y-4 text-[var(--text-primary)]">
      <div className="rounded-lg border border-dashed border-[var(--border-subtle)] p-6 text-sm text-[var(--text-muted)]">
        Monthly client reports, on-demand audits, and per-client performance summaries will live
        here. Coming soon.
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Update the client detail page tabs**

Replace the entire content of `frontend/app/agency/clients/[id]/page.tsx` with:

```tsx
'use client';

import { use, useEffect, useState } from 'react';
import * as Tabs from '@radix-ui/react-tabs';
import Link from 'next/link';
import { agencyGetClient, type AgencyClient } from '@/lib/api';
import { ClientOverviewTab } from '@/components/agency/ClientOverviewTab';
import { ClientStrategyTab } from '@/components/agency/ClientStrategyTab';
import { ClientContentTab } from '@/components/agency/ClientContentTab';
import { ClientReportsTab } from '@/components/agency/ClientReportsTab';

const TABS: Array<[string, string]> = [
  ['overview', 'Overview'],
  ['strategy', 'Strategy'],
  ['content', 'Content'],
  ['reports', 'Reports'],
];

export default function AgencyClientDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const clientId = parseInt(id, 10);
  const [client, setClient] = useState<AgencyClient | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    agencyGetClient(clientId)
      .then(setClient)
      .catch((e) => setError(String(e?.message ?? e)));
  }, [clientId]);

  if (error) return <div className="p-8 text-sm text-red-400">{error}</div>;
  if (!client) {
    return <div className="p-8 text-sm text-[var(--text-muted)]">Loading…</div>;
  }

  return (
    <div className="p-8 text-[var(--text-primary)]">
      <Link href="/agency/clients" className="text-xs text-[var(--text-muted)] hover:underline">
        ← All clients
      </Link>
      <h1 className="mt-2 text-2xl font-semibold tracking-tight">{client.name}</h1>
      <p className="mb-6 text-sm text-[var(--text-muted)]">/{client.slug}</p>

      <Tabs.Root defaultValue="overview" className="w-full">
        <Tabs.List className="mb-6 flex gap-1 border-b border-[var(--border-subtle)]">
          {TABS.map(([value, label]) => (
            <Tabs.Trigger
              key={value}
              value={value}
              className="border-b-2 border-transparent px-4 py-2 text-sm text-[var(--text-muted)] data-[state=active]:border-[var(--text-primary)] data-[state=active]:text-[var(--text-primary)]"
            >
              {label}
            </Tabs.Trigger>
          ))}
        </Tabs.List>

        <Tabs.Content value="overview">
          <ClientOverviewTab client={client} onChange={setClient} />
        </Tabs.Content>
        <Tabs.Content value="strategy">
          <ClientStrategyTab brandId={client.brand_id} />
        </Tabs.Content>
        <Tabs.Content value="content">
          <ClientContentTab brandId={client.brand_id} />
        </Tabs.Content>
        <Tabs.Content value="reports">
          <ClientReportsTab brandId={client.brand_id} />
        </Tabs.Content>
      </Tabs.Root>
    </div>
  );
}
```

- [ ] **Step 6: Type-check**

```bash
cd /Users/ken/Desktop/Lumidian/frontend
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add frontend/components/agency frontend/app/agency/clients
git commit -m "feat(frontend): 4-tab client detail (Overview/Strategy/Content/Reports)"
```

---

## Task 11: Pipeline kanban — 5 columns + per-draft actions

**Files:**
- Modify: `frontend/components/agency/ClientPipelineTab.tsx`

- [ ] **Step 1: Replace pipeline component with extended status flow**

Replace `frontend/components/agency/ClientPipelineTab.tsx` with:

```tsx
'use client';

import { useEffect, useState } from 'react';
import {
  agencyUpdateDraftStatus,
  getDrafts,
  type ContentDraft,
  type DraftStaffStatus,
} from '@/lib/api';

interface Props {
  brandId: number | null;
}

const COLUMNS: Array<{ key: string; label: string }> = [
  { key: 'draft', label: 'Draft' },
  { key: 'awaiting_client', label: 'Awaiting client' },
  { key: 'changes_requested', label: 'Changes requested' },
  { key: 'approved', label: 'Approved' },
  { key: 'posted', label: 'Posted' },
];

interface DraftActionsProps {
  draft: ContentDraft;
  onChange: (next: Partial<ContentDraft>) => void;
}

function DraftActions({ draft, onChange }: DraftActionsProps) {
  const [busy, setBusy] = useState(false);
  const set = async (status: DraftStaffStatus) => {
    setBusy(true);
    try {
      await agencyUpdateDraftStatus(draft.id, status);
      onChange({ status });
    } finally {
      setBusy(false);
    }
  };

  if (draft.status === 'draft' || draft.status === 'changes_requested') {
    return (
      <button
        onClick={() => set('awaiting_client')}
        disabled={busy}
        className="mt-2 rounded-md border border-[var(--border-default)] px-2 py-1 text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-raised)] disabled:opacity-50"
      >
        Send to client review
      </button>
    );
  }
  if (draft.status === 'approved') {
    return (
      <button
        onClick={() => set('posted')}
        disabled={busy}
        className="mt-2 rounded-md border border-[var(--border-default)] px-2 py-1 text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-raised)] disabled:opacity-50"
      >
        Mark as posted
      </button>
    );
  }
  return null;
}

export function ClientPipelineTab({ brandId }: Props) {
  const [drafts, setDrafts] = useState<ContentDraft[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (brandId == null) {
      setLoading(false);
      return;
    }
    getDrafts(brandId)
      .then(setDrafts)
      .catch((e) => setError(String(e?.message ?? e)))
      .finally(() => setLoading(false));
  }, [brandId]);

  const updateLocal = (id: number, patch: Partial<ContentDraft>) => {
    setDrafts((prev) => prev.map((d) => (d.id === id ? { ...d, ...patch } : d)));
  };

  if (brandId == null) {
    return (
      <p className="text-sm text-[var(--text-muted)]">No brand attached to this client.</p>
    );
  }
  if (loading) return <p className="text-sm text-[var(--text-muted)]">Loading…</p>;
  if (error) return <p className="text-sm text-red-400">{error}</p>;

  if (drafts.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-[var(--border-subtle)] p-10 text-center text-sm text-[var(--text-muted)]">
        No drafts yet. Use the Lumidian Content section to generate some for this client&apos;s
        brand — they&apos;ll show up here.
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-4 text-[var(--text-primary)] md:grid-cols-5">
      {COLUMNS.map(({ key, label }) => {
        const items = drafts.filter((d) => d.status === key);
        return (
          <section
            key={key}
            className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-card)] p-4"
          >
            <h3 className="mb-3 flex items-center justify-between text-sm font-medium">
              <span>{label}</span>
              <span className="text-xs text-[var(--text-muted)]">{items.length}</span>
            </h3>
            <ul className="space-y-2">
              {items.map((d) => (
                <li
                  key={d.id}
                  className="rounded-md border border-[var(--border-subtle)] bg-[var(--bg-raised)] p-3 text-sm"
                >
                  <div className="font-medium">{d.title || `Draft #${d.id}`}</div>
                  <div className="text-xs text-[var(--text-muted)]">{d.platform}</div>
                  {d.content_text && (
                    <p className="mt-2 line-clamp-3 text-xs text-[var(--text-muted)]">
                      {d.content_text}
                    </p>
                  )}
                  {key === 'changes_requested' &&
                    'client_feedback' in d &&
                    typeof (d as { client_feedback?: string | null }).client_feedback ===
                      'string' && (
                      <p className="mt-2 rounded border border-amber-500/30 bg-amber-500/10 p-2 text-xs text-amber-200">
                        {(d as { client_feedback?: string | null }).client_feedback}
                      </p>
                    )}
                  <DraftActions
                    draft={d}
                    onChange={(patch) => updateLocal(d.id, patch)}
                  />
                </li>
              ))}
              {items.length === 0 && (
                <li className="rounded-md border border-dashed border-[var(--border-subtle)] p-3 text-xs text-[var(--text-muted)]">
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

- [ ] **Step 2: Type-check**

```bash
cd /Users/ken/Desktop/Lumidian/frontend
npx tsc --noEmit
```

Expected: no errors. (`ContentDraft` type may not declare `client_feedback`; the inline cast handles that — no change needed to the global type.)

- [ ] **Step 3: Commit**

```bash
git add frontend/components/agency/ClientPipelineTab.tsx
git commit -m "feat(frontend): 5-column pipeline with send-to-client and mark-posted"
```

---

## Task 12: Today screen expansion

**Files:**
- Modify: `frontend/app/agency/page.tsx`

- [ ] **Step 1: Replace the Today page**

The current Today endpoint (`agencyToday()`) returns one list of drafts to review. For the expanded view we want three buckets. Two options:

A. **Backend change:** add a richer `/api/agency/today` response.
B. **Frontend client-side filter:** call `agencyToday()` for one bucket and reuse, OR call `getDrafts()` per agency-client brand and combine. This is more network calls.

Option A is cleaner. Update the backend endpoint to return three buckets at once, then update the page.

Modify `backend/app/routers/agency.py`. Find the `get_today` function and replace it with:

```python
@router.get("/today", response_model=TodayOut)
async def get_today(
    db: AsyncSession = Depends(get_db),
    _user: User = Depends(require_agency_staff),
):
    awaiting_staff_q = await db.execute(
        select(ContentDraft, Brand, AgencyClient)
        .join(Brand, Brand.id == ContentDraft.brand_id)
        .join(AgencyClient, AgencyClient.id == Brand.agency_client_id)
        .where(ContentDraft.status.in_(("draft", "changes_requested")))
        .order_by(ContentDraft.created_at.asc())
        .limit(50)
    )
    awaiting_client_q = await db.execute(
        select(ContentDraft, Brand, AgencyClient)
        .join(Brand, Brand.id == ContentDraft.brand_id)
        .join(AgencyClient, AgencyClient.id == Brand.agency_client_id)
        .where(ContentDraft.status == "awaiting_client")
        .order_by(ContentDraft.created_at.asc())
        .limit(50)
    )
    approved_q = await db.execute(
        select(ContentDraft, Brand, AgencyClient)
        .join(Brand, Brand.id == ContentDraft.brand_id)
        .join(AgencyClient, AgencyClient.id == Brand.agency_client_id)
        .where(ContentDraft.status == "approved")
        .order_by(ContentDraft.created_at.asc())
        .limit(50)
    )

    def _to_out(rows):
        return [
            TodayDraftOut(
                draft_id=draft.id,
                title=getattr(draft, "title", None),
                platform=draft.platform,
                client_id=ac.id,
                client_name=ac.name,
                assigned_to_user_id=draft.assigned_to_user_id,
                created_at=draft.created_at,
            )
            for draft, _b, ac in rows
        ]

    awaiting_staff = _to_out(awaiting_staff_q.all())
    awaiting_client = _to_out(awaiting_client_q.all())
    approved = _to_out(approved_q.all())

    active_clients_q = await db.execute(
        select(func.count(AgencyClient.id)).where(AgencyClient.status == "active")
    )
    active_clients = active_clients_q.scalar_one() or 0

    return TodayOut(
        drafts_to_review=awaiting_staff,
        drafts_to_review_count=len(awaiting_staff),
        active_clients=active_clients,
        awaiting_client=awaiting_client,
        approved=approved,
    )
```

- [ ] **Step 2: Update `TodayOut` schema in `backend/app/schemas.py`**

Find `TodayOut` and add the two new fields:

```python
class TodayOut(BaseModel):
    drafts_to_review: list[TodayDraftOut]
    drafts_to_review_count: int
    active_clients: int
    awaiting_client: list[TodayDraftOut] = []
    approved: list[TodayDraftOut] = []
```

- [ ] **Step 3: Update frontend types in `frontend/lib/api.ts`**

Find `AgencyTodayResponse` and add:

```typescript
export interface AgencyTodayResponse {
  drafts_to_review: AgencyTodayDraft[];
  drafts_to_review_count: number;
  active_clients: number;
  awaiting_client: AgencyTodayDraft[];
  approved: AgencyTodayDraft[];
}
```

- [ ] **Step 4: Replace `frontend/app/agency/page.tsx`**

```tsx
'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { agencyToday, type AgencyTodayDraft, type AgencyTodayResponse } from '@/lib/api';

function DraftList({ drafts, emptyText }: { drafts: AgencyTodayDraft[]; emptyText: string }) {
  if (drafts.length === 0) {
    return <p className="text-sm text-[var(--text-muted)]">{emptyText}</p>;
  }
  return (
    <ul className="space-y-2">
      {drafts.slice(0, 10).map((d) => (
        <li
          key={d.draft_id}
          className="rounded-md border border-[var(--border-subtle)] bg-[var(--bg-raised)] p-3 text-sm"
        >
          <div className="font-medium">{d.title || `Draft #${d.draft_id}`}</div>
          <div className="text-xs text-[var(--text-muted)]">
            <Link
              href={`/agency/clients/${d.client_id}`}
              className="underline-offset-2 hover:underline"
            >
              {d.client_name}
            </Link>{' '}
            · {d.platform}
          </div>
        </li>
      ))}
    </ul>
  );
}

export default function AgencyTodayPage() {
  const [data, setData] = useState<AgencyTodayResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    agencyToday().then(setData).catch((e) => setError(String(e?.message ?? e)));
  }, []);

  if (error) {
    return <div className="p-8 text-sm text-red-400">{error}</div>;
  }
  if (!data) {
    return <div className="p-8 text-sm text-[var(--text-muted)]">Loading…</div>;
  }

  const totalAttention =
    data.drafts_to_review_count + (data.awaiting_client?.length ?? 0) + (data.approved?.length ?? 0);

  return (
    <div className="p-8 text-[var(--text-primary)]">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Today</h1>
        <p className="text-sm text-[var(--text-muted)]">
          {data.active_clients} active client{data.active_clients === 1 ? '' : 's'} ·{' '}
          {totalAttention} draft{totalAttention === 1 ? '' : 's'} in flight
        </p>
      </div>

      <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
        <section className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-card)] p-5">
          <h2 className="mb-3 text-sm font-medium text-[var(--text-secondary)]">
            Awaiting your review ({data.drafts_to_review_count})
          </h2>
          <DraftList
            drafts={data.drafts_to_review}
            emptyText="Nothing to work on right now."
          />
        </section>

        <section className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-card)] p-5">
          <h2 className="mb-3 text-sm font-medium text-[var(--text-secondary)]">
            Awaiting client review ({data.awaiting_client?.length ?? 0})
          </h2>
          <DraftList
            drafts={data.awaiting_client ?? []}
            emptyText="Nothing waiting on the client."
          />
        </section>

        <section className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-card)] p-5">
          <h2 className="mb-3 text-sm font-medium text-[var(--text-secondary)]">
            Approved + ready to post ({data.approved?.length ?? 0})
          </h2>
          <DraftList
            drafts={data.approved ?? []}
            emptyText="Nothing approved yet."
          />
        </section>
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Update existing `test_today_returns_empty_when_no_drafts` test in `test_agency.py`**

Find the test and add assertions for the new fields:

```python
@pytest.mark.asyncio
async def test_today_returns_empty_when_no_drafts(client):
    await _make_agency_user(client)
    resp = await client.get("/api/agency/today")
    assert resp.status_code == 200
    body = resp.json()
    assert body["drafts_to_review"] == []
    assert body["drafts_to_review_count"] == 0
    assert body["active_clients"] == 0
    assert body["awaiting_client"] == []
    assert body["approved"] == []
```

- [ ] **Step 6: Run tests + type-check**

```bash
cd /Users/ken/Desktop/Lumidian/backend
source venv/bin/activate
pytest tests/test_agency.py -v --timeout=60
```

Expected: all 11 tests PASS.

```bash
cd /Users/ken/Desktop/Lumidian/frontend
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add backend/app/routers/agency.py backend/app/schemas.py backend/tests/test_agency.py frontend/lib/api.ts frontend/app/agency/page.tsx
git commit -m "feat(today): three-bucket attention view (yours/client/approved)"
```

---

## Task 13: Public review page

**Files:**
- Modify: `frontend/middleware.ts`
- Create: `frontend/app/review/layout.tsx`
- Create: `frontend/app/review/[token]/page.tsx`

- [ ] **Step 1: Allow `/review` through the auth middleware**

In `frontend/middleware.ts`, find the `PUBLIC_PATHS` constant and add `/review`:

```typescript
const PUBLIC_PATHS = ['/', '/login', '/register', '/onboarding', '/forgot-password', '/reset-password', '/verify-email', '/team/accept', '/terms', '/privacy', '/methodology', '/account-paused', '/review'];
```

(Keep the rest of the file unchanged — `pathname.startsWith(p + '/')` already handles `/review/abc123`.)

- [ ] **Step 2: Create a minimal layout that doesn't require AuthProvider context**

`frontend/app/review/layout.tsx`:

```tsx
export default function ReviewLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-[var(--bg-base)] text-[var(--text-primary)]">
      <div className="border-b border-[var(--border-subtle)] bg-[var(--bg-raised)] px-6 py-4">
        <h1 className="text-base font-semibold tracking-tight">Lumidian Agency · Client review</h1>
      </div>
      <div className="mx-auto max-w-3xl px-6 py-8">{children}</div>
    </div>
  );
}
```

- [ ] **Step 3: Create `frontend/app/review/[token]/page.tsx`**

```tsx
'use client';

import { use, useEffect, useState } from 'react';
import {
  publicApproveDraft,
  publicGetReviewPage,
  publicRejectDraft,
  publicRequestChanges,
  type ReviewClientPage,
  type ReviewDraft,
} from '@/lib/api';

type ActionState = 'idle' | 'changes' | 'reject';

interface CardProps {
  draft: ReviewDraft;
  token: string;
  onActionComplete: (draftId: number, badge: string) => void;
}

function DraftCard({ draft, token, onActionComplete }: CardProps) {
  const [mode, setMode] = useState<ActionState>('idle');
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [doneBadge, setDoneBadge] = useState<string | null>(null);

  const finish = (badge: string) => {
    setDoneBadge(badge);
    onActionComplete(draft.id, badge);
  };

  const approve = async () => {
    setBusy(true);
    setError(null);
    try {
      await publicApproveDraft(token, draft.id);
      finish('Approved');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to approve');
    } finally {
      setBusy(false);
    }
  };

  const submitChanges = async () => {
    if (!text.trim()) {
      setError('Please describe what changes you want.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await publicRequestChanges(token, draft.id, text.trim());
      finish('Changes requested');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to send');
    } finally {
      setBusy(false);
    }
  };

  const submitReject = async () => {
    if (!text.trim()) {
      setError('Please give a reason.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await publicRejectDraft(token, draft.id, text.trim());
      finish('Rejected');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to reject');
    } finally {
      setBusy(false);
    }
  };

  if (doneBadge) {
    return (
      <article className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-card)] p-5 opacity-60">
        <div className="flex items-baseline justify-between">
          <h2 className="text-base font-medium">{draft.title || `Draft #${draft.id}`}</h2>
          <span className="rounded-full bg-emerald-500/20 px-2 py-1 text-xs text-emerald-300">
            {doneBadge}
          </span>
        </div>
      </article>
    );
  }

  return (
    <article className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-card)] p-5">
      <div className="mb-3 flex items-baseline justify-between">
        <h2 className="text-base font-medium">{draft.title || `Draft #${draft.id}`}</h2>
        <span className="text-xs text-[var(--text-muted)]">{draft.platform}</span>
      </div>
      <pre className="whitespace-pre-wrap rounded-md border border-[var(--border-subtle)] bg-[var(--bg-raised)] p-3 text-sm text-[var(--text-primary)]">
        {draft.content_text}
      </pre>

      {mode === 'idle' && (
        <div className="mt-4 flex flex-wrap gap-2">
          <button
            onClick={approve}
            disabled={busy}
            className="rounded-md bg-emerald-500/20 px-3 py-2 text-sm font-medium text-emerald-200 hover:bg-emerald-500/30 disabled:opacity-50"
          >
            Approve
          </button>
          <button
            onClick={() => setMode('changes')}
            disabled={busy}
            className="rounded-md bg-amber-500/20 px-3 py-2 text-sm font-medium text-amber-200 hover:bg-amber-500/30 disabled:opacity-50"
          >
            Request changes
          </button>
          <button
            onClick={() => setMode('reject')}
            disabled={busy}
            className="rounded-md bg-rose-500/20 px-3 py-2 text-sm font-medium text-rose-200 hover:bg-rose-500/30 disabled:opacity-50"
          >
            Reject
          </button>
        </div>
      )}

      {mode === 'changes' && (
        <div className="mt-4 space-y-2">
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={3}
            placeholder="What needs to change?"
            className="w-full rounded-md border border-[var(--border-default)] bg-[var(--bg-raised)] px-3 py-2 text-sm"
          />
          <div className="flex gap-2">
            <button
              onClick={submitChanges}
              disabled={busy}
              className="rounded-md bg-amber-500/30 px-3 py-2 text-sm font-medium text-amber-100 hover:bg-amber-500/40 disabled:opacity-50"
            >
              Send back
            </button>
            <button
              onClick={() => {
                setMode('idle');
                setText('');
              }}
              className="rounded-md border border-[var(--border-default)] px-3 py-2 text-sm text-[var(--text-secondary)]"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {mode === 'reject' && (
        <div className="mt-4 space-y-2">
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={3}
            placeholder="Why are you rejecting this?"
            className="w-full rounded-md border border-[var(--border-default)] bg-[var(--bg-raised)] px-3 py-2 text-sm"
          />
          <div className="flex gap-2">
            <button
              onClick={submitReject}
              disabled={busy}
              className="rounded-md bg-rose-500/30 px-3 py-2 text-sm font-medium text-rose-100 hover:bg-rose-500/40 disabled:opacity-50"
            >
              Reject
            </button>
            <button
              onClick={() => {
                setMode('idle');
                setText('');
              }}
              className="rounded-md border border-[var(--border-default)] px-3 py-2 text-sm text-[var(--text-secondary)]"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {error && <p className="mt-2 text-sm text-red-400">{error}</p>}
    </article>
  );
}

export default function ReviewPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = use(params);
  const [data, setData] = useState<ReviewClientPage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [completedIds, setCompletedIds] = useState<Set<number>>(new Set());

  useEffect(() => {
    publicGetReviewPage(token)
      .then(setData)
      .catch((e) => {
        const status = (e as { response?: { status?: number } })?.response?.status;
        if (status === 404) setError('This review link is invalid or has been revoked.');
        else setError(String((e as Error)?.message ?? e));
      });
  }, [token]);

  const handleAction = (draftId: number) => {
    setCompletedIds((prev) => new Set(prev).add(draftId));
  };

  if (error) {
    return (
      <p className="rounded-md border border-rose-500/30 bg-rose-500/10 p-4 text-sm text-rose-200">
        {error}
      </p>
    );
  }
  if (!data) {
    return <p className="text-sm text-[var(--text-muted)]">Loading…</p>;
  }

  const remaining = data.drafts.filter((d) => !completedIds.has(d.id));
  const allDone = data.drafts.length > 0 && remaining.length === 0;

  return (
    <div className="space-y-6">
      <header>
        <p className="text-xs uppercase tracking-wide text-[var(--text-muted)]">
          {data.client_name}
        </p>
        <h2 className="mt-1 text-xl font-semibold">Drafts pending your review</h2>
      </header>

      {data.drafts.length === 0 && (
        <p className="rounded-md border border-[var(--border-subtle)] bg-[var(--bg-card)] p-4 text-sm text-[var(--text-muted)]">
          Nothing pending right now. Come back when a new batch is sent.
        </p>
      )}

      {allDone && (
        <p className="rounded-md border border-emerald-500/30 bg-emerald-500/10 p-4 text-sm text-emerald-200">
          You&apos;ve reviewed everything in this batch — thanks!
        </p>
      )}

      {data.drafts.map((d) => (
        <DraftCard
          key={d.id}
          draft={d}
          token={token}
          onActionComplete={(id) => handleAction(id)}
        />
      ))}
    </div>
  );
}
```

- [ ] **Step 4: Type-check + build**

```bash
cd /Users/ken/Desktop/Lumidian/frontend
npx tsc --noEmit
npm run build
```

Expected: no TS errors. Build output should include `/review/[token]` in the route list.

- [ ] **Step 5: Commit**

```bash
git add frontend/middleware.ts frontend/app/review
git commit -m "feat(frontend): public client review page at /review/[token]"
```

---

## Task 14: End-to-end smoke test

**Files:** None — manual verification.

- [ ] **Step 1: Start backend (port 3001) + frontend (port 3002)**

Terminal 1:
```bash
cd /Users/ken/Desktop/Lumidian/backend
source venv/bin/activate
uvicorn app.main:app --reload --port 3001
```

Watch for the new migrations applying on startup (lines about `client_review_links`, `client_feedback`, etc.).

Terminal 2:
```bash
cd /Users/ken/Desktop/Lumidian/frontend
npm run dev -- -p 3002
```

- [ ] **Step 2: Verify the agency surface**

In a browser:
1. Open `http://localhost:3002/login`. Log in (admin user — `ken@lumidian.ai` is already agency staff in dev DB).
2. Navigate to `http://localhost:3002/agency`. The Today screen should show 3 columns ("Awaiting your review", "Awaiting client review", "Approved + ready to post").
3. Sidebar shows: Today / Clients / Calendar / Opportunities / Performance / Documents / Settings, plus footer Lumidian app + Admin links.
4. Click each new sidebar item — each should render a "Coming soon" stub.
5. Click Clients → click into a client (or create one).
6. Verify 4 tabs: Overview / Strategy / Content / Reports.
7. Overview tab shows: status buttons, Lumidian tracking widget (or "No tracking data yet" if no runs), Review link section (with "Generate review link" button).
8. Click "Generate review link". A URL appears with a copy button.
9. Click the copy button — confirm "Copied!" appears.

- [ ] **Step 3: Verify the review portal end-to-end**

1. In the agency Content tab for that client, manually create or promote a draft into `awaiting_client` status. Easiest path: create a draft via the existing Lumidian content section (`/content/{brand}` page), then in the agency Pipeline, click "Send to client review" on a Draft-status item.
2. Open the review URL in a private/incognito window (no auth required).
3. The page should show the client's name and the draft.
4. Click **Approve**. Page shows the "Approved" badge on the card.
5. Reload the agency Pipeline tab — that draft should now be in the "Approved" column.
6. Repeat with **Request changes** (with feedback text) on a different draft — back in Pipeline, draft moves to "Changes requested" column with the amber feedback note rendered.

- [ ] **Step 4: Verify the link revocation flow**

1. In Overview, click the rotate button (refresh icon).
2. New URL replaces the old one.
3. Open the OLD URL in a private window — should show "This review link is invalid or has been revoked."

- [ ] **Step 5: Stop dev servers**

Ctrl+C in both terminals.

If all five smoke checks pass, the shell + review portal MVP is functional end-to-end. No commit (manual verification only).

---

## Self-Review Notes

**Spec coverage:**
- Global sidebar with 7 items including 5 stubs → Task 7 ✓
- 4-tab client detail (Overview/Strategy/Content/Reports) → Task 10 ✓
- Lumidian tracking widget on Overview → Task 8, wired in Task 10 ✓
- Review link section on Overview → Task 9, wired in Task 10 ✓
- 5-status pipeline + per-draft actions → Task 11 ✓
- Today 3-column expansion → Task 12 ✓
- Public `/review/[token]` page → Task 13 ✓
- ContentDraft client_feedback + client_reviewed_at columns → Task 1 ✓
- ClientReviewLink table + token rotation → Tasks 1, 3 ✓
- Public router with 4 endpoints → Task 4 ✓
- Backend tests for both routers → Task 5 ✓
- Middleware allows /review → Task 13 ✓
- Lumidian widget replaces Peec UI (field stays in schema) → Task 10 ✓

**Notification/digest item from the spec:** "Notifications fire to you when client takes action" — this requires writing to the `Notification` table on each public-review action. The spec acknowledges this: write a row, type `draft_reviewed`. **Adding as Task 4 amendment** rather than a new task — the public router endpoints should also insert a Notification row for each agency staff user. See addendum below.

**Status value sprawl risk in spec:** addressed by using a single allowlist constant (`_STAFF_ALLOWED_STATUSES`) in the agency router. Public endpoints write fixed status strings only.

**Addendum to Task 4 (notifications on client action):** when implementing each of `approve_draft`, `request_changes`, `reject_draft`, also insert one `Notification` row per active agency staff member. Pseudocode to add at the end of each public action handler before `await db.commit()`:

```python
from app.models import AgencyStaff, Notification

staff_q = await db.execute(
    select(AgencyStaff.user_id).where(AgencyStaff.active == True)  # noqa: E712
)
client_obj = await db.get(AgencyClient, client_id)
client_label = client_obj.name if client_obj else "A client"
action_label = {"approved": "approved", "changes_requested": "requested changes on", "rejected": "rejected"}[draft.status]
title_text = f"{client_label} {action_label} a draft"
for sid in staff_q.scalars().all():
    db.add(Notification(
        user_id=sid,
        type="draft_reviewed",
        title=title_text,
        body=draft.title or f"Draft #{draft.id}",
        link=f"/agency/clients/{client_id}",
        read=False,
    ))
```

Add this block inside each of the three public handlers in `backend/app/routers/review_public.py` (Task 4 step 1) immediately before the final `await db.commit()`. Add a 7th test in `test_review_public.py` to verify a notification row is created (`select(func.count(Notification.id))` after action).
