# Agency Client Portal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a read-only `/client/[token]` portal that mirrors the SaaS surfaces (visibility / results / competitors / site audit / clusters / wikipedia / posted content / reports) for agency clients, entered via the existing `ClientReviewLink` token. No new auth surface. No write endpoints. Content review cycle deliberately stays in Google Docs.

**Architecture:**
- Backend: 2 new nullable columns on `AgencyClient`; 1 new public token-gated router (`/api/public/client/{token}/...`) with read-only mirror endpoints; tiny `PATCH /api/agency/clients/{id}/proposal` for staff to set the "this week's proposal" pointer.
- Frontend: new `/client/[token]/` route group with 9 pages; `ClientViewContext` + `useClientView()` hook; action-button audit pass across shared SaaS components.
- The existing `/api/public/review/{token}/...` router and `/review/[token]/` frontend route stay; the frontend `/review/[token]` becomes a thin redirect to `/client/[token]`. The existing `_link_to_out` URL builder switches to emit `/client/{token}`.
- We deliberately follow the existing `/api/public/...` token-gated naming convention. (Spec says `/api/client/{token}`; this plan uses `/api/public/client/{token}` for consistency with the established `/api/public/review/...` pattern. The user-facing portal URL stays `/client/[token]` as the spec requires.)

**Tech Stack:** FastAPI, SQLAlchemy async (SQLite + aiosqlite), pytest. Next.js 15 App Router, React 18, TypeScript strict, Tailwind, Radix.

**Spec:** `docs/superpowers/specs/2026-05-22-agency-client-portal-design.md`

**Verification model:**
- Backend: each task ends with a test run. New test file `backend/tests/test_client_portal.py`.
- Frontend: no unit tests in this repo. Each task ends with `npm run lint` and a manual browser smoke check. Final task is a full smoke checklist.

---

## File Plan

### New backend files
- `backend/app/routers/client_portal.py` — public token-gated read-only mirror endpoints (~14 endpoints).
- `backend/tests/test_client_portal.py` — token resolution, brand scoping, write blockage tests.

### Modified backend files
- `backend/app/models.py` — add 2 cols on `AgencyClient` (`current_proposal_doc_url`, `current_proposal_label`).
- `backend/app/database.py` — append 2 `ALTER TABLE` migrations.
- `backend/app/dependencies.py` — add `get_client_view_context()` dep + `ClientViewContext` dataclass.
- `backend/app/schemas.py` — add `ClientProposalUpdateIn`, `ClientPortalBrandOut`, `ClientPortalProposalOut`.
- `backend/app/routers/agency.py` — (1) emit `/client/{token}` instead of `/review/{token}` in `_link_to_out`; (2) add `PATCH /clients/{id}/proposal` endpoint.
- `backend/app/main.py` — mount `client_portal_router`.

### New frontend files
- `frontend/lib/client-view.ts` — `ClientViewContext`, `ClientViewProvider`, `useClientView()` hook.
- `frontend/app/client/[token]/layout.tsx` — portal shell + sidebar.
- `frontend/app/client/[token]/page.tsx` — home (scores + proposal card + recent activity).
- `frontend/app/client/[token]/visibility/page.tsx` — runs + per-prompt scores.
- `frontend/app/client/[token]/transcripts/page.tsx` — raw LLM responses.
- `frontend/app/client/[token]/competitors/page.tsx` — competitor positioning.
- `frontend/app/client/[token]/site-audit/page.tsx` — audit findings + recommendations.
- `frontend/app/client/[token]/strategy/page.tsx` — clusters view.
- `frontend/app/client/[token]/wikipedia/page.tsx` — wikipedia candidates.
- `frontend/app/client/[token]/content/page.tsx` — posted content history.
- `frontend/app/client/[token]/reports/page.tsx` — documents (weekly reports).
- `frontend/components/client-portal/ClientPortalSidebar.tsx` — portal nav.
- `frontend/components/client-portal/ProposalCard.tsx` — "this week's proposal" card.
- `frontend/components/agency/ClientProposalForm.tsx` — staff form for setting proposal URL/label.

### Modified frontend files
- `frontend/lib/api.ts` — add `clientPortal.*` methods + `agencySetProposal()` method.
- `frontend/app/review/[token]/page.tsx` — replace contents with a `redirect('/client/[token]')` server component.
- `frontend/components/agency/ClientBrandTab.tsx` — mount `ClientProposalForm`.
- ~10 SaaS components — wrap action buttons in `!isClientView` checks (enumerated in Task 16).

---

## Task 1: AgencyClient proposal columns + migration

**Files:**
- Modify: `backend/app/models.py:769-783` (AgencyClient class)
- Modify: `backend/app/database.py` (append 2 migrations)
- Test: `backend/tests/test_client_portal.py` (new file)

- [ ] **Step 1: Write the failing test**

Create `backend/tests/test_client_portal.py`:

```python
"""Tests for the client portal (read-only token-gated mirror of SaaS surfaces)."""
from __future__ import annotations

import pytest
from httpx import AsyncClient
from sqlalchemy import select

from app.models import AgencyClient
from tests.conftest import register_user, login_user


@pytest.mark.asyncio
async def test_agency_client_has_proposal_columns(client: AsyncClient, async_session):
    """AgencyClient table has current_proposal_doc_url and current_proposal_label columns."""
    ac = AgencyClient(
        name="Acme Inc",
        slug="acme-inc",
        status="active",
        current_proposal_doc_url="https://docs.google.com/document/d/abc",
        current_proposal_label="Week of May 22 — 5 pieces",
    )
    async_session.add(ac)
    await async_session.commit()
    await async_session.refresh(ac)
    assert ac.current_proposal_doc_url == "https://docs.google.com/document/d/abc"
    assert ac.current_proposal_label == "Week of May 22 — 5 pieces"
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd backend && source venv/bin/activate
pytest tests/test_client_portal.py::test_agency_client_has_proposal_columns -v
```

Expected: FAIL with `AttributeError` or SQL error referencing missing columns.

- [ ] **Step 3: Add columns to the ORM model**

Edit `backend/app/models.py`. In the `AgencyClient` class (starts line 769), insert two new columns *after* `primary_contact_email` (line 780) and *before* `created_at`:

```python
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
    current_proposal_doc_url: Mapped[str | None] = mapped_column(String(500), nullable=True)
    current_proposal_label: Mapped[str | None] = mapped_column(String(200), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, onupdate=utcnow)
```

- [ ] **Step 4: Append migration to `database.py:run_migrations()`**

Edit `backend/app/database.py`. Find the end of the `migrations = [...]` list (around line 493, just after the `idx_agency_assignments_client` line). Insert before the closing `]`:

```python
        # 2026-05-22: Client portal — proposal pointer fields on agency_clients
        "ALTER TABLE agency_clients ADD COLUMN current_proposal_doc_url VARCHAR(500)",
        "ALTER TABLE agency_clients ADD COLUMN current_proposal_label VARCHAR(200)",
```

- [ ] **Step 5: Run test to verify it passes**

```bash
pytest tests/test_client_portal.py::test_agency_client_has_proposal_columns -v
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/app/models.py backend/app/database.py backend/tests/test_client_portal.py
git commit -m "feat(agency): add proposal pointer columns to AgencyClient"
```

---

## Task 2: Staff endpoint to set proposal pointer

**Files:**
- Modify: `backend/app/schemas.py` (add `ClientProposalUpdateIn`)
- Modify: `backend/app/routers/agency.py` (add PATCH endpoint)
- Test: `backend/tests/test_client_portal.py`

- [ ] **Step 1: Write the failing test**

Append to `backend/tests/test_client_portal.py`:

```python
@pytest.mark.asyncio
async def test_staff_can_set_proposal_pointer(client: AsyncClient, async_session, agency_staff_user):
    """PATCH /api/agency/clients/{id}/proposal updates the doc_url + label."""
    # Create client (auto-assigns creator)
    resp = await client.post("/api/agency/clients", json={"name": "Acme"})
    assert resp.status_code == 201
    client_id = resp.json()["id"]

    # Patch proposal pointer
    resp = await client.patch(
        f"/api/agency/clients/{client_id}/proposal",
        json={
            "current_proposal_doc_url": "https://docs.google.com/document/d/abc123",
            "current_proposal_label": "Week of May 22 — 5 pieces",
        },
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["current_proposal_doc_url"] == "https://docs.google.com/document/d/abc123"
    assert body["current_proposal_label"] == "Week of May 22 — 5 pieces"

    # Verify persisted
    ac = await async_session.get(AgencyClient, client_id)
    await async_session.refresh(ac)
    assert ac.current_proposal_doc_url == "https://docs.google.com/document/d/abc123"


@pytest.mark.asyncio
async def test_staff_can_clear_proposal_pointer(client: AsyncClient, async_session, agency_staff_user):
    """PATCH with null values clears the proposal pointer."""
    resp = await client.post("/api/agency/clients", json={"name": "Acme"})
    client_id = resp.json()["id"]
    await client.patch(
        f"/api/agency/clients/{client_id}/proposal",
        json={"current_proposal_doc_url": "https://docs.google.com/document/d/abc", "current_proposal_label": "Test"},
    )
    # Clear
    resp = await client.patch(
        f"/api/agency/clients/{client_id}/proposal",
        json={"current_proposal_doc_url": None, "current_proposal_label": None},
    )
    assert resp.status_code == 200
    assert resp.json()["current_proposal_doc_url"] is None
    assert resp.json()["current_proposal_label"] is None
```

If `agency_staff_user` fixture does not exist, check `backend/tests/conftest.py` for an existing similar fixture (look for `is_agency_staff=True` registrations); if missing, define it in the test file's module scope before the tests.

- [ ] **Step 2: Run tests to verify they fail**

```bash
pytest tests/test_client_portal.py -k "proposal" -v
```

Expected: FAIL — endpoint doesn't exist (404 or 405).

- [ ] **Step 3: Add the request schema**

Edit `backend/app/schemas.py`. Find an existing agency schema block (search for `AgencyClientUpdate`); add nearby:

```python
class ClientProposalUpdateIn(BaseModel):
    current_proposal_doc_url: str | None = Field(default=None, max_length=500)
    current_proposal_label: str | None = Field(default=None, max_length=200)
```

Also extend `AgencyClientOut` to include the two fields. Find its definition (search `class AgencyClientOut`) and add:

```python
class AgencyClientOut(BaseModel):
    id: int
    name: str
    slug: str
    status: str
    retainer_amount_usd: int | None = None
    retainer_started_at: datetime | None = None
    peec_dashboard_url: str | None = None
    primary_contact_name: str | None = None
    primary_contact_email: str | None = None
    brand_id: int | None = None
    drafts_pending: int = 0
    created_at: datetime
    current_proposal_doc_url: str | None = None
    current_proposal_label: str | None = None
```

Verify there are no other producers of `AgencyClientOut` that would need updating — `grep -n "AgencyClientOut" backend/app/routers/agency.py`. The single producer is `_client_to_out`; update it to populate the two new fields:

Edit `backend/app/routers/agency.py:_client_to_out` (around line 78). Change the return statement to include the two new fields:

```python
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
        current_proposal_doc_url=client.current_proposal_doc_url,
        current_proposal_label=client.current_proposal_label,
    )
```

- [ ] **Step 4: Add the PATCH endpoint**

Edit `backend/app/routers/agency.py`. Add at the end of the file (or near `update_client`):

```python
@router.patch("/clients/{client_id}/proposal", response_model=AgencyClientOut)
async def update_client_proposal(
    client_id: int,
    body: ClientProposalUpdateIn,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_client_access),
):
    """Set the 'this week's proposal' pointer (Google Doc URL + label).

    Either field may be set to null to clear. Used by staff after sending out
    the weekly content proposal Google Doc.
    """
    client = await db.get(AgencyClient, client_id)
    if client is None:
        raise HTTPException(status_code=404, detail="Client not found")
    data = body.model_dump(exclude_unset=True)
    if "current_proposal_doc_url" in data:
        client.current_proposal_doc_url = data["current_proposal_doc_url"]
    if "current_proposal_label" in data:
        client.current_proposal_label = data["current_proposal_label"]
    client.updated_at = datetime.utcnow()
    await db.commit()
    await db.refresh(client)
    return await _client_to_out(db, client)
```

Update the imports at the top of `backend/app/routers/agency.py` — add `ClientProposalUpdateIn` to the schemas import block (around line 18-46):

```python
from app.schemas import (
    ...,
    ClientProposalUpdateIn,
    ...,
)
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
pytest tests/test_client_portal.py -k "proposal" -v
```

Expected: both proposal tests PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/app/schemas.py backend/app/routers/agency.py backend/tests/test_client_portal.py
git commit -m "feat(agency): PATCH /clients/{id}/proposal endpoint for staff to set proposal pointer"
```

---

## Task 3: Update review-link URL builder to emit `/client/{token}`

**Files:**
- Modify: `backend/app/routers/agency.py:_link_to_out` (line ~367)
- Test: `backend/tests/test_client_portal.py`

- [ ] **Step 1: Write the failing test**

Append to `backend/tests/test_client_portal.py`:

```python
@pytest.mark.asyncio
async def test_review_link_emits_client_url(client: AsyncClient, agency_staff_user):
    """POST /api/agency/clients/{id}/review-link returns a /client/{token} URL."""
    resp = await client.post("/api/agency/clients", json={"name": "Acme"})
    client_id = resp.json()["id"]

    resp = await client.post(f"/api/agency/clients/{client_id}/review-link")
    assert resp.status_code == 201
    url = resp.json()["url"]
    assert "/client/" in url, f"Expected /client/ in URL, got {url}"
    assert "/review/" not in url, f"URL should not contain /review/ anymore: {url}"
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pytest tests/test_client_portal.py::test_review_link_emits_client_url -v
```

Expected: FAIL — URL contains `/review/` not `/client/`.

- [ ] **Step 3: Update the URL builder**

Edit `backend/app/routers/agency.py`. Find `_link_to_out` (around line 367):

```python
def _link_to_out(link: ClientReviewLink, request: Request) -> ReviewLinkOut:
    base = _public_base_url(request)
    return ReviewLinkOut(token=link.token, url=f"{base}/review/{link.token}", created_at=link.created_at)
```

Change `/review/` to `/client/`:

```python
def _link_to_out(link: ClientReviewLink, request: Request) -> ReviewLinkOut:
    base = _public_base_url(request)
    return ReviewLinkOut(token=link.token, url=f"{base}/client/{link.token}", created_at=link.created_at)
```

- [ ] **Step 4: Run test to verify it passes**

```bash
pytest tests/test_client_portal.py::test_review_link_emits_client_url -v
```

Expected: PASS.

- [ ] **Step 5: Verify no other tests broke**

```bash
pytest tests/test_agency_tracking.py tests/test_agency_client_access.py -v
```

Expected: all PASS (these tests don't assert on the URL string format).

- [ ] **Step 6: Commit**

```bash
git add backend/app/routers/agency.py backend/tests/test_client_portal.py
git commit -m "feat(agency): emit /client/{token} from review-link builder"
```

---

## Task 4: `ClientViewContext` dependency

**Files:**
- Modify: `backend/app/dependencies.py` (add new dep)
- Test: `backend/tests/test_client_portal.py`

- [ ] **Step 1: Write the failing tests**

Append to `backend/tests/test_client_portal.py`:

```python
@pytest.mark.asyncio
async def test_client_view_context_resolves_valid_token(client: AsyncClient, agency_staff_user):
    """A valid token resolves to the right AgencyClient + Brand."""
    # Create client and get token
    resp = await client.post("/api/agency/clients", json={"name": "Acme"})
    ac_id = resp.json()["id"]
    brand_id = resp.json()["brand_id"]
    resp = await client.post(f"/api/agency/clients/{ac_id}/review-link")
    token = resp.json()["token"]

    # Hit the new public brand endpoint — built in Task 5; here we just confirm the
    # endpoint reaches the resolver. This test will fail until Task 5 ships the route.
    resp = await client.get(f"/api/public/client/{token}/brand")
    assert resp.status_code == 200
    body = resp.json()
    assert body["id"] == brand_id


@pytest.mark.asyncio
async def test_client_view_context_rejects_unknown_token(client: AsyncClient):
    """Unknown tokens return 404."""
    resp = await client.get("/api/public/client/notatoken/brand")
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_client_view_context_rejects_revoked_token(client: AsyncClient, async_session, agency_staff_user):
    """Revoked review-link tokens return 404."""
    from app.models import ClientReviewLink
    from datetime import datetime

    resp = await client.post("/api/agency/clients", json={"name": "Acme"})
    ac_id = resp.json()["id"]
    resp = await client.post(f"/api/agency/clients/{ac_id}/review-link")
    token = resp.json()["token"]

    # Revoke the link directly in the DB
    link_q = await async_session.execute(select(ClientReviewLink).where(ClientReviewLink.token == token))
    link = link_q.scalar_one()
    link.revoked_at = datetime.utcnow()
    await async_session.commit()

    resp = await client.get(f"/api/public/client/{token}/brand")
    assert resp.status_code == 404
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
pytest tests/test_client_portal.py -k "client_view_context" -v
```

Expected: FAIL — `/api/public/client/{token}/brand` route doesn't exist yet.

- [ ] **Step 3: Add `ClientViewContext` + `get_client_view_context` dep**

Edit `backend/app/dependencies.py`. Append at the bottom of the file (after `ensure_client_access`):

```python
# ── Client portal: read-only token-gated context ─────────────────────────────


from dataclasses import dataclass


@dataclass
class ClientViewContext:
    """Resolved context for a public token-gated client portal request.

    Holds the AgencyClient + Brand the token belongs to. is_client_view is
    always True for instances of this class — exists for symmetry with
    require_not_client_view backstops on write endpoints.
    """
    agency_client: "AgencyClient"
    brand: "Brand"
    is_client_view: bool = True


async def get_client_view_context(
    token: str,
    db: AsyncSession = Depends(get_db),
) -> ClientViewContext:
    """Resolve a ClientReviewLink token to its AgencyClient + Brand.

    Raises 404 if the token is unknown or revoked, or if the client has no
    attached brand.
    """
    from app.models import AgencyClient, Brand, ClientReviewLink

    link_q = await db.execute(
        select(ClientReviewLink).where(
            ClientReviewLink.token == token,
            ClientReviewLink.revoked_at.is_(None),
        )
    )
    link = link_q.scalar_one_or_none()
    if link is None:
        raise HTTPException(status_code=404, detail="Client portal link not found or revoked")

    ac = await db.get(AgencyClient, link.agency_client_id)
    if ac is None:
        raise HTTPException(status_code=404, detail="Client portal link not found or revoked")

    brand_q = await db.execute(
        select(Brand).where(Brand.agency_client_id == ac.id).order_by(Brand.id.asc()).limit(1)
    )
    brand = brand_q.scalar_one_or_none()
    if brand is None:
        raise HTTPException(status_code=404, detail="No brand attached to this client")

    return ClientViewContext(agency_client=ac, brand=brand)
```

(Note: this task only adds the dep. The tests still fail until Task 5 mounts a route that uses it. That's expected — Task 4 is groundwork.)

- [ ] **Step 4: Verify it imports cleanly**

```bash
cd backend && source venv/bin/activate
python -c "from app.dependencies import get_client_view_context, ClientViewContext; print('ok')"
```

Expected: prints `ok`.

- [ ] **Step 5: Commit**

```bash
git add backend/app/dependencies.py backend/tests/test_client_portal.py
git commit -m "feat(agency): add ClientViewContext dependency for token-gated portal"
```

---

## Task 5: Client portal router — brand + proposal endpoints

**Files:**
- Create: `backend/app/routers/client_portal.py`
- Modify: `backend/app/main.py` (mount the router)
- Modify: `backend/app/schemas.py` (add `ClientPortalBrandOut`, `ClientPortalProposalOut`)
- Test: `backend/tests/test_client_portal.py`

- [ ] **Step 1: Write the failing tests**

Append to `backend/tests/test_client_portal.py`:

```python
@pytest.mark.asyncio
async def test_client_portal_brand_returns_brand_summary(client: AsyncClient, agency_staff_user):
    """GET /api/public/client/{token}/brand returns brand id, name, slug, type."""
    resp = await client.post("/api/agency/clients", json={"name": "Acme Inc"})
    ac_id = resp.json()["id"]
    brand_id = resp.json()["brand_id"]
    resp = await client.post(f"/api/agency/clients/{ac_id}/review-link")
    token = resp.json()["token"]

    resp = await client.get(f"/api/public/client/{token}/brand")
    assert resp.status_code == 200
    body = resp.json()
    assert body["id"] == brand_id
    assert body["name"] == "Acme Inc"
    assert body["brand_type"] == "agency"


@pytest.mark.asyncio
async def test_client_portal_proposal_returns_pointer(client: AsyncClient, agency_staff_user):
    """GET /api/public/client/{token}/proposal returns current proposal fields."""
    resp = await client.post("/api/agency/clients", json={"name": "Acme"})
    ac_id = resp.json()["id"]
    await client.patch(
        f"/api/agency/clients/{ac_id}/proposal",
        json={"current_proposal_doc_url": "https://docs.google.com/document/d/abc", "current_proposal_label": "Week of May 22"},
    )
    resp = await client.post(f"/api/agency/clients/{ac_id}/review-link")
    token = resp.json()["token"]

    resp = await client.get(f"/api/public/client/{token}/proposal")
    assert resp.status_code == 200
    body = resp.json()
    assert body["doc_url"] == "https://docs.google.com/document/d/abc"
    assert body["label"] == "Week of May 22"


@pytest.mark.asyncio
async def test_client_portal_proposal_null_when_unset(client: AsyncClient, agency_staff_user):
    """If proposal not set, endpoint returns nulls (not 404)."""
    resp = await client.post("/api/agency/clients", json={"name": "Acme"})
    ac_id = resp.json()["id"]
    resp = await client.post(f"/api/agency/clients/{ac_id}/review-link")
    token = resp.json()["token"]

    resp = await client.get(f"/api/public/client/{token}/proposal")
    assert resp.status_code == 200
    body = resp.json()
    assert body["doc_url"] is None
    assert body["label"] is None
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
pytest tests/test_client_portal.py -k "client_portal_brand or client_portal_proposal" -v
```

Expected: FAIL — endpoints don't exist (404).

- [ ] **Step 3: Add response schemas**

Edit `backend/app/schemas.py`. Add near the other agency schemas:

```python
class ClientPortalBrandOut(BaseModel):
    id: int
    name: str
    slug: str
    brand_type: str
    website_url: str | None = None


class ClientPortalProposalOut(BaseModel):
    doc_url: str | None = None
    label: str | None = None
```

- [ ] **Step 4: Create the router file**

Create `backend/app/routers/client_portal.py`:

```python
"""Public, no-auth client portal router. Token-gated via ClientReviewLink.

All endpoints are read-only mirrors of SaaS surfaces, scoped to the brand
attached to the AgencyClient that owns the token.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends

from app.dependencies import ClientViewContext, get_client_view_context
from app.schemas import (
    ClientPortalBrandOut,
    ClientPortalProposalOut,
)

router = APIRouter(prefix="/api/public/client", tags=["client-portal"])


@router.get("/{token}/brand", response_model=ClientPortalBrandOut)
async def get_brand(ctx: ClientViewContext = Depends(get_client_view_context)):
    """Brand summary for the portal home."""
    return ClientPortalBrandOut(
        id=ctx.brand.id,
        name=ctx.brand.name,
        slug=ctx.brand.slug,
        brand_type=ctx.brand.brand_type,
        website_url=ctx.brand.website_url,
    )


@router.get("/{token}/proposal", response_model=ClientPortalProposalOut)
async def get_proposal(ctx: ClientViewContext = Depends(get_client_view_context)):
    """Current 'this week's proposal' pointer (Google Doc URL + label).

    Returns nulls if not set — the frontend hides the card in that case.
    """
    return ClientPortalProposalOut(
        doc_url=ctx.agency_client.current_proposal_doc_url,
        label=ctx.agency_client.current_proposal_label,
    )
```

- [ ] **Step 5: Mount the router in main.py**

Edit `backend/app/main.py`. Add the import near line 71 (where `review_public` is imported):

```python
from app.routers import client_portal as client_portal_router
```

Then mount it. Find the existing review_public mount (search for `review_public_router.router`) and add the new mount next to it:

```python
app.include_router(client_portal_router.router)
```

(No `/api` prefix needed — the router already has the full prefix `/api/public/client`.)

- [ ] **Step 6: Run tests to verify they pass**

```bash
pytest tests/test_client_portal.py -k "client_portal_brand or client_portal_proposal or client_view_context" -v
```

Expected: all 5 tests PASS.

- [ ] **Step 7: Commit**

```bash
git add backend/app/routers/client_portal.py backend/app/main.py backend/app/schemas.py backend/tests/test_client_portal.py
git commit -m "feat(client-portal): brand + proposal pointer endpoints"
```

---

## Task 6: Client portal router — visibility/dashboard endpoints

**Files:**
- Modify: `backend/app/routers/client_portal.py`
- Test: `backend/tests/test_client_portal.py`

This task wires up the *data* endpoints. Pattern: each endpoint resolves the token → brand, then delegates to the same service/query the SaaS endpoint uses, scoped to that brand.

- [ ] **Step 1: Write the failing tests**

Append to `backend/tests/test_client_portal.py`:

```python
@pytest.mark.asyncio
async def test_client_portal_dashboard_returns_overview(client: AsyncClient, agency_staff_user, agency_brand_with_run):
    """GET /api/public/client/{token}/dashboard returns visibility overview."""
    ac_id, _brand_id, token = agency_brand_with_run

    resp = await client.get(f"/api/public/client/{token}/dashboard")
    assert resp.status_code == 200
    body = resp.json()
    assert "overall_score" in body
    assert "total_runs" in body


@pytest.mark.asyncio
async def test_client_portal_runs_returns_recent_runs(client: AsyncClient, agency_staff_user, agency_brand_with_run):
    """GET /api/public/client/{token}/runs returns the run list."""
    ac_id, brand_id, token = agency_brand_with_run

    resp = await client.get(f"/api/public/client/{token}/runs")
    assert resp.status_code == 200
    runs = resp.json()
    assert isinstance(runs, list)
    assert len(runs) >= 1
    assert all(r.get("brand_id") == brand_id for r in runs)
```

The fixture `agency_brand_with_run` does not exist yet. Add it to the top of `test_client_portal.py`:

```python
@pytest.fixture
async def agency_brand_with_run(client: AsyncClient, async_session, agency_staff_user):
    """Create an agency client + completed tracking run + return (ac_id, brand_id, token)."""
    from datetime import datetime
    from app.models import TrackingRun

    resp = await client.post("/api/agency/clients", json={"name": "Acme"})
    ac_id = resp.json()["id"]
    brand_id = resp.json()["brand_id"]

    # Insert a completed run directly
    run = TrackingRun(
        brand_id=brand_id,
        status="completed",
        run_type="manual",
        overall_score=42.0,
        total_queries=10,
        total_mentions=4,
        started_at=datetime.utcnow(),
        completed_at=datetime.utcnow(),
    )
    async_session.add(run)
    await async_session.commit()

    resp = await client.post(f"/api/agency/clients/{ac_id}/review-link")
    token = resp.json()["token"]
    return ac_id, brand_id, token
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
pytest tests/test_client_portal.py -k "client_portal_dashboard or client_portal_runs" -v
```

Expected: FAIL — endpoints don't exist.

- [ ] **Step 3: Identify the SaaS query functions to reuse**

Open `backend/app/routers/dashboard.py` and `backend/app/routers/results.py`. Locate:
- `dashboard.get_overview` (or equivalent — search for the brand-stats endpoint)
- `results.get_recent_runs` (or equivalent — search for `recent_runs`)

These existing handlers take `brand_id` and a `user` for auth. Extract their *data assembly* logic so it can be called with just a `brand_id` and a `db` session (no user check).

If the existing code already has internal helper functions that take `brand_id` + `db`, reuse those directly. If not, refactor: pull the core query logic into a module-level async function (e.g., `async def _brand_overview(db, brand_id) -> OverviewOut`), and have both the SaaS handler and the client portal handler call it.

For this plan, assume the SaaS handlers contain straightforward query logic. The implementation engineer should:
- Open each SaaS endpoint
- If the query logic is ≤30 lines, copy it into the client portal endpoint (don't refactor SaaS code yet)
- If it's larger or has clear branches, extract to a helper in the SaaS router and call from both sides

- [ ] **Step 4: Add the dashboard endpoint**

Append to `backend/app/routers/client_portal.py`:

```python
from sqlalchemy import desc, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models import TrackingRun, RunModelScore


@router.get("/{token}/dashboard")
async def get_dashboard(
    ctx: ClientViewContext = Depends(get_client_view_context),
    db: AsyncSession = Depends(get_db),
):
    """Visibility overview for the portal home: overall score, run counts, sparkline data."""
    brand_id = ctx.brand.id

    # Latest completed run
    latest_q = await db.execute(
        select(TrackingRun)
        .where(TrackingRun.brand_id == brand_id, TrackingRun.status == "completed")
        .order_by(desc(TrackingRun.completed_at))
        .limit(1)
    )
    latest = latest_q.scalar_one_or_none()

    # Total completed runs
    count_q = await db.execute(
        select(func.count(TrackingRun.id)).where(
            TrackingRun.brand_id == brand_id, TrackingRun.status == "completed"
        )
    )
    total_runs = count_q.scalar_one() or 0

    # Last 30 days of run scores for the sparkline
    spark_q = await db.execute(
        select(TrackingRun.completed_at, TrackingRun.overall_score)
        .where(TrackingRun.brand_id == brand_id, TrackingRun.status == "completed")
        .order_by(desc(TrackingRun.completed_at))
        .limit(30)
    )
    spark_rows = list(spark_q.all())
    sparkline = [
        {"completed_at": r[0].isoformat() if r[0] else None, "score": r[1]}
        for r in reversed(spark_rows)
    ]

    return {
        "overall_score": latest.overall_score if latest else None,
        "latest_run_at": latest.completed_at.isoformat() if latest and latest.completed_at else None,
        "total_runs": total_runs,
        "sparkline": sparkline,
    }


@router.get("/{token}/runs")
async def list_runs(
    ctx: ClientViewContext = Depends(get_client_view_context),
    db: AsyncSession = Depends(get_db),
    limit: int = 20,
):
    """Recent completed tracking runs for this brand."""
    limit = max(1, min(limit, 100))
    rows = await db.execute(
        select(TrackingRun)
        .where(TrackingRun.brand_id == ctx.brand.id, TrackingRun.status == "completed")
        .order_by(desc(TrackingRun.completed_at))
        .limit(limit)
    )
    runs = rows.scalars().all()
    return [
        {
            "id": r.id,
            "brand_id": r.brand_id,
            "status": r.status,
            "run_type": r.run_type,
            "overall_score": r.overall_score,
            "total_queries": r.total_queries,
            "total_mentions": r.total_mentions,
            "completed_at": r.completed_at.isoformat() if r.completed_at else None,
            "started_at": r.started_at.isoformat() if r.started_at else None,
        }
        for r in runs
    ]
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
pytest tests/test_client_portal.py -k "client_portal_dashboard or client_portal_runs" -v
```

Expected: both PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/app/routers/client_portal.py backend/tests/test_client_portal.py
git commit -m "feat(client-portal): dashboard + runs endpoints"
```

---

## Task 7: Client portal router — transcripts, competitors, posted-content endpoints

**Files:**
- Modify: `backend/app/routers/client_portal.py`
- Test: `backend/tests/test_client_portal.py`

- [ ] **Step 1: Write the failing tests**

Append to `backend/tests/test_client_portal.py`:

```python
@pytest.mark.asyncio
async def test_client_portal_responses_returns_transcripts(client: AsyncClient, async_session, agency_brand_with_run):
    """GET /api/public/client/{token}/responses returns raw LLM transcripts for the latest run."""
    from app.models import QueryResult, Prompt

    ac_id, brand_id, token = agency_brand_with_run

    # Add a prompt and a query result
    prompt = Prompt(brand_id=brand_id, text="best CRM for startups")
    async_session.add(prompt)
    await async_session.commit()
    await async_session.refresh(prompt)

    from sqlalchemy import select
    run_q = await async_session.execute(select(TrackingRun).where(TrackingRun.brand_id == brand_id).limit(1))
    run = run_q.scalar_one()

    qr = QueryResult(
        tracking_run_id=run.id,
        prompt_id=prompt.id,
        model="chatgpt",
        run_number=1,
        response_text="Acme is the best CRM for startups.",
        mentioned=True,
    )
    async_session.add(qr)
    await async_session.commit()

    resp = await client.get(f"/api/public/client/{token}/responses")
    assert resp.status_code == 200
    rows = resp.json()
    assert isinstance(rows, list)
    assert any(r.get("response_text") == "Acme is the best CRM for startups." for r in rows)


@pytest.mark.asyncio
async def test_client_portal_competitors_returns_list(client: AsyncClient, async_session, agency_brand_with_run):
    """GET /api/public/client/{token}/competitors returns competitor list."""
    from app.models import Competitor

    ac_id, brand_id, token = agency_brand_with_run
    async_session.add(Competitor(brand_id=brand_id, name="Salesforce", website_url="https://salesforce.com"))
    await async_session.commit()

    resp = await client.get(f"/api/public/client/{token}/competitors")
    assert resp.status_code == 200
    competitors = resp.json()
    assert any(c["name"] == "Salesforce" for c in competitors)


@pytest.mark.asyncio
async def test_client_portal_posted_content_excludes_in_progress(client: AsyncClient, async_session, agency_brand_with_run):
    """GET /api/public/client/{token}/content returns ONLY posted drafts (status='posted')."""
    from app.models import ContentDraft, Prompt
    from datetime import datetime

    ac_id, brand_id, token = agency_brand_with_run
    prompt = Prompt(brand_id=brand_id, text="best CRM")
    async_session.add(prompt)
    await async_session.commit()
    await async_session.refresh(prompt)

    posted = ContentDraft(brand_id=brand_id, prompt_id=prompt.id, platform="linkedin", status="posted", title="Posted piece", content_text="...", posted_at=datetime.utcnow())
    in_progress = ContentDraft(brand_id=brand_id, prompt_id=prompt.id, platform="linkedin", status="awaiting_client", title="In progress", content_text="...")
    async_session.add_all([posted, in_progress])
    await async_session.commit()

    resp = await client.get(f"/api/public/client/{token}/content")
    assert resp.status_code == 200
    drafts = resp.json()
    titles = [d["title"] for d in drafts]
    assert "Posted piece" in titles
    assert "In progress" not in titles
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
pytest tests/test_client_portal.py -k "responses or competitors or posted_content" -v
```

Expected: 3 failures.

- [ ] **Step 3: Add the endpoints**

Append to `backend/app/routers/client_portal.py`:

```python
from app.models import Competitor, ContentDraft, Prompt, QueryResult


@router.get("/{token}/responses")
async def list_responses(
    ctx: ClientViewContext = Depends(get_client_view_context),
    db: AsyncSession = Depends(get_db),
    run_id: int | None = None,
    limit: int = 200,
):
    """Raw LLM responses for a run (latest run if run_id not given)."""
    brand_id = ctx.brand.id
    limit = max(1, min(limit, 500))

    if run_id is None:
        latest_q = await db.execute(
            select(TrackingRun.id)
            .where(TrackingRun.brand_id == brand_id, TrackingRun.status == "completed")
            .order_by(desc(TrackingRun.completed_at))
            .limit(1)
        )
        run_id = latest_q.scalar_one_or_none()
        if run_id is None:
            return []

    # Validate the run belongs to this brand (defense in depth)
    own_q = await db.execute(
        select(TrackingRun.id).where(TrackingRun.id == run_id, TrackingRun.brand_id == brand_id)
    )
    if own_q.scalar_one_or_none() is None:
        return []

    rows = await db.execute(
        select(QueryResult, Prompt.text)
        .join(Prompt, Prompt.id == QueryResult.prompt_id)
        .where(QueryResult.tracking_run_id == run_id)
        .order_by(QueryResult.created_at.desc())
        .limit(limit)
    )
    out = []
    for qr, prompt_text in rows.all():
        out.append({
            "id": qr.id,
            "prompt_id": qr.prompt_id,
            "prompt_text": prompt_text,
            "model": qr.model,
            "run_number": qr.run_number,
            "response_text": qr.response_text,
            "mentioned": bool(qr.mentioned),
            "sentiment": qr.sentiment,
            "latency_ms": qr.latency_ms,
        })
    return out


@router.get("/{token}/competitors")
async def list_competitors(
    ctx: ClientViewContext = Depends(get_client_view_context),
    db: AsyncSession = Depends(get_db),
):
    """Competitor list for this brand."""
    rows = await db.execute(
        select(Competitor)
        .where(Competitor.brand_id == ctx.brand.id)
        .order_by(Competitor.id.asc())
    )
    return [
        {"id": c.id, "name": c.name, "website_url": c.website_url}
        for c in rows.scalars().all()
    ]


@router.get("/{token}/content")
async def list_posted_content(
    ctx: ClientViewContext = Depends(get_client_view_context),
    db: AsyncSession = Depends(get_db),
    limit: int = 100,
):
    """Posted-only content drafts for this brand (in-progress drafts are excluded)."""
    limit = max(1, min(limit, 500))
    rows = await db.execute(
        select(ContentDraft)
        .where(ContentDraft.brand_id == ctx.brand.id, ContentDraft.status == "posted")
        .order_by(desc(ContentDraft.posted_at))
        .limit(limit)
    )
    return [
        {
            "id": d.id,
            "title": d.title,
            "platform": d.platform,
            "status": d.status,
            "content_text": d.content_text,
            "posted_at": d.posted_at.isoformat() if d.posted_at else None,
            "created_at": d.created_at.isoformat() if d.created_at else None,
        }
        for d in rows.scalars().all()
    ]
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
pytest tests/test_client_portal.py -k "responses or competitors or posted_content" -v
```

Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/app/routers/client_portal.py backend/tests/test_client_portal.py
git commit -m "feat(client-portal): responses + competitors + posted-content endpoints"
```

---

## Task 8: Client portal router — site audit, clusters, wikipedia, documents endpoints

**Files:**
- Modify: `backend/app/routers/client_portal.py`
- Test: `backend/tests/test_client_portal.py`

These four surfaces follow the same pattern: resolve token → brand → query existing tables, return read-only payloads.

- [ ] **Step 1: Write the failing tests**

Append to `backend/tests/test_client_portal.py`:

```python
@pytest.mark.asyncio
async def test_client_portal_site_audit_returns_latest(client: AsyncClient, async_session, agency_brand_with_run):
    """GET /api/public/client/{token}/site-audit returns the latest audit + findings."""
    from app.models import WebsiteAudit
    from datetime import datetime

    ac_id, brand_id, token = agency_brand_with_run
    audit = WebsiteAudit(brand_id=brand_id, status="completed", overall_score=72.0, started_at=datetime.utcnow(), completed_at=datetime.utcnow())
    async_session.add(audit)
    await async_session.commit()
    await async_session.refresh(audit)

    resp = await client.get(f"/api/public/client/{token}/site-audit")
    assert resp.status_code == 200
    body = resp.json()
    assert body["audit"]["id"] == audit.id
    assert body["audit"]["overall_score"] == 72.0


@pytest.mark.asyncio
async def test_client_portal_clusters_returns_brand_clusters(client: AsyncClient, async_session, agency_brand_with_run):
    """GET /api/public/client/{token}/clusters returns this brand's clusters."""
    from app.models import ContentCluster, Prompt

    ac_id, brand_id, token = agency_brand_with_run
    p = Prompt(brand_id=brand_id, text="best CRM")
    async_session.add(p)
    await async_session.commit()
    await async_session.refresh(p)
    c = ContentCluster(brand_id=brand_id, prompt_id=p.id, status="ready")
    async_session.add(c)
    await async_session.commit()

    resp = await client.get(f"/api/public/client/{token}/clusters")
    assert resp.status_code == 200
    body = resp.json()
    assert any(cl["prompt_id"] == p.id for cl in body)


@pytest.mark.asyncio
async def test_client_portal_wikipedia_candidates_returns_brand_scoped(client: AsyncClient, async_session, agency_brand_with_run):
    """GET /api/public/client/{token}/wikipedia returns brand's wikipedia candidates."""
    from app.models import WikipediaCandidate, WikipediaScan
    from datetime import datetime

    ac_id, brand_id, token = agency_brand_with_run
    scan = WikipediaScan(brand_id=brand_id, status="completed", started_at=datetime.utcnow())
    async_session.add(scan)
    await async_session.commit()
    await async_session.refresh(scan)
    cand = WikipediaCandidate(
        brand_id=brand_id, scan_id=scan.id, article_title="Customer relationship management",
        article_url="https://en.wikipedia.org/wiki/CRM", pageid=12345, status="new",
    )
    async_session.add(cand)
    await async_session.commit()

    resp = await client.get(f"/api/public/client/{token}/wikipedia")
    assert resp.status_code == 200
    candidates = resp.json()
    assert any(c["article_title"] == "Customer relationship management" for c in candidates)


@pytest.mark.asyncio
async def test_client_portal_documents_returns_client_docs(client: AsyncClient, async_session, agency_brand_with_run):
    """GET /api/public/client/{token}/documents returns the client's documents."""
    from app.models import ClientDocument
    from datetime import datetime

    ac_id, brand_id, token = agency_brand_with_run
    doc = ClientDocument(
        agency_client_id=ac_id, kind="agency_weekly_report",
        title="Week of May 22", body_markdown="# Weekly Report\n...",
        generated_at=datetime.utcnow(),
    )
    async_session.add(doc)
    await async_session.commit()

    resp = await client.get(f"/api/public/client/{token}/documents")
    assert resp.status_code == 200
    docs = resp.json()
    assert any(d["title"] == "Week of May 22" for d in docs)
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
pytest tests/test_client_portal.py -k "site_audit or clusters or wikipedia_candidates or documents_returns" -v
```

Expected: 4 failures.

- [ ] **Step 3: Add the endpoints**

Append to `backend/app/routers/client_portal.py`:

```python
from fastapi import HTTPException
from fastapi import Response

from app.models import (
    ClientDocument,
    ContentCluster,
    WebsiteAudit,
    WebsiteAuditFinding,
    WebsiteAuditRecommendation,
    WikipediaCandidate,
)


@router.get("/{token}/site-audit")
async def get_site_audit(
    ctx: ClientViewContext = Depends(get_client_view_context),
    db: AsyncSession = Depends(get_db),
):
    """Latest site audit for this brand with findings + recommendations."""
    brand_id = ctx.brand.id
    audit_q = await db.execute(
        select(WebsiteAudit)
        .where(WebsiteAudit.brand_id == brand_id, WebsiteAudit.status == "completed")
        .order_by(desc(WebsiteAudit.completed_at))
        .limit(1)
    )
    audit = audit_q.scalar_one_or_none()
    if audit is None:
        return {"audit": None, "findings": [], "recommendations": []}

    findings_q = await db.execute(
        select(WebsiteAuditFinding).where(WebsiteAuditFinding.audit_id == audit.id)
    )
    findings = findings_q.scalars().all()
    recs_q = await db.execute(
        select(WebsiteAuditRecommendation).where(WebsiteAuditRecommendation.audit_id == audit.id)
    )
    recs = recs_q.scalars().all()

    return {
        "audit": {
            "id": audit.id,
            "overall_score": audit.overall_score,
            "bot_access_score": getattr(audit, "bot_access_score", None),
            "content_score": getattr(audit, "content_score", None),
            "schema_score": getattr(audit, "schema_score", None),
            "technical_score": getattr(audit, "technical_score", None),
            "completed_at": audit.completed_at.isoformat() if audit.completed_at else None,
        },
        "findings": [
            {
                "id": f.id, "check_id": f.check_id, "severity": f.severity,
                "category": f.category, "message": f.message,
            }
            for f in findings
        ],
        "recommendations": [
            {
                "id": r.id, "priority": r.priority, "effort": r.effort,
                "category": r.category, "title": r.title, "body": r.body,
                "status": getattr(r, "status", None),
                "priority_score": getattr(r, "priority_score", None),
            }
            for r in recs
        ],
    }


@router.get("/{token}/clusters")
async def list_clusters(
    ctx: ClientViewContext = Depends(get_client_view_context),
    db: AsyncSession = Depends(get_db),
):
    """All clusters for this brand (read-only view of strategy)."""
    rows = await db.execute(
        select(ContentCluster, Prompt.text)
        .join(Prompt, Prompt.id == ContentCluster.prompt_id)
        .where(ContentCluster.brand_id == ctx.brand.id)
        .order_by(ContentCluster.id.desc())
    )
    return [
        {
            "id": c.id,
            "prompt_id": c.prompt_id,
            "prompt_text": ptext,
            "status": c.status,
            "pillar_mode": c.pillar_mode,
            "pillar_url": c.pillar_url,
            "version": c.version,
            "last_generated_at": c.last_generated_at.isoformat() if c.last_generated_at else None,
        }
        for c, ptext in rows.all()
    ]


@router.get("/{token}/wikipedia")
async def list_wikipedia_candidates(
    ctx: ClientViewContext = Depends(get_client_view_context),
    db: AsyncSession = Depends(get_db),
):
    """Wikipedia candidates for this brand."""
    rows = await db.execute(
        select(WikipediaCandidate)
        .where(WikipediaCandidate.brand_id == ctx.brand.id)
        .order_by(desc(WikipediaCandidate.legitimacy_score))
    )
    return [
        {
            "id": w.id,
            "article_title": w.article_title,
            "article_url": w.article_url,
            "article_summary": w.article_summary,
            "legitimacy_score": w.legitimacy_score,
            "legitimacy_reasoning": w.legitimacy_reasoning,
            "status": w.status,
            "last_status_change_at": w.last_status_change_at.isoformat() if w.last_status_change_at else None,
        }
        for w in rows.scalars().all()
    ]


@router.get("/{token}/documents")
async def list_documents(
    ctx: ClientViewContext = Depends(get_client_view_context),
    db: AsyncSession = Depends(get_db),
):
    """Client-facing documents (weekly reports, etc.)."""
    rows = await db.execute(
        select(ClientDocument)
        .where(ClientDocument.agency_client_id == ctx.agency_client.id)
        .order_by(desc(ClientDocument.generated_at))
    )
    return [
        {
            "id": d.id,
            "kind": d.kind,
            "title": d.title,
            "generated_at": d.generated_at.isoformat() if d.generated_at else None,
        }
        for d in rows.scalars().all()
    ]


@router.get("/{token}/documents/{document_id}")
async def get_document(
    document_id: int,
    ctx: ClientViewContext = Depends(get_client_view_context),
    db: AsyncSession = Depends(get_db),
):
    """Single document's markdown body."""
    doc = await db.get(ClientDocument, document_id)
    if doc is None or doc.agency_client_id != ctx.agency_client.id:
        raise HTTPException(status_code=404, detail="Document not found")
    return {
        "id": doc.id,
        "kind": doc.kind,
        "title": doc.title,
        "body_markdown": doc.body_markdown,
        "generated_at": doc.generated_at.isoformat() if doc.generated_at else None,
    }


@router.get("/{token}/documents/{document_id}/pdf")
async def get_document_pdf(
    document_id: int,
    ctx: ClientViewContext = Depends(get_client_view_context),
    db: AsyncSession = Depends(get_db),
):
    """Render a client document as PDF."""
    import re as _re
    from app.services.document_engine.pdf_renderer import render_pdf

    doc = await db.get(ClientDocument, document_id)
    if doc is None or doc.agency_client_id != ctx.agency_client.id:
        raise HTTPException(status_code=404, detail="Document not found")
    try:
        pdf_bytes = await render_pdf(db, doc)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    safe_title = _re.sub(r"[^a-zA-Z0-9_-]+", "-", (doc.title or f"document-{doc.id}"))[:120].strip("-")
    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{safe_title}.pdf"'},
    )
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
pytest tests/test_client_portal.py -k "site_audit or clusters or wikipedia_candidates or documents_returns" -v
```

Expected: all 4 PASS.

- [ ] **Step 5: Multi-tenancy regression test — verify a token cannot access another brand's data**

Append:

```python
@pytest.mark.asyncio
async def test_client_portal_token_isolated_to_own_brand(client: AsyncClient, async_session, agency_staff_user):
    """A token for client A cannot access client B's data."""
    from app.models import Competitor

    # Two separate clients
    r1 = await client.post("/api/agency/clients", json={"name": "Acme"})
    a_id = r1.json()["id"]
    a_brand = r1.json()["brand_id"]
    r2 = await client.post("/api/agency/clients", json={"name": "Globex"})
    b_brand = r2.json()["brand_id"]

    # Add a competitor to Acme (brand A)
    async_session.add(Competitor(brand_id=a_brand, name="OnlyOnA"))
    # Add a competitor to Globex (brand B)
    async_session.add(Competitor(brand_id=b_brand, name="OnlyOnB"))
    await async_session.commit()

    # Get token for Acme
    r = await client.post(f"/api/agency/clients/{a_id}/review-link")
    a_token = r.json()["token"]

    # Token A's competitors endpoint should NOT see OnlyOnB
    resp = await client.get(f"/api/public/client/{a_token}/competitors")
    names = [c["name"] for c in resp.json()]
    assert "OnlyOnA" in names
    assert "OnlyOnB" not in names
```

Run:

```bash
pytest tests/test_client_portal.py::test_client_portal_token_isolated_to_own_brand -v
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/app/routers/client_portal.py backend/tests/test_client_portal.py
git commit -m "feat(client-portal): site-audit + clusters + wikipedia + documents endpoints"
```

---

## Task 9: Frontend — `ClientViewContext` + `useClientView()` hook + API client

**Files:**
- Create: `frontend/lib/client-view.ts`
- Modify: `frontend/lib/api.ts`

- [ ] **Step 1: Create the ClientViewContext + hook**

Create `frontend/lib/client-view.ts`:

```tsx
'use client';
import { createContext, useContext, type ReactNode } from 'react';

export interface ClientViewState {
  /** True when rendered inside the /client/[token] portal shell. */
  isClientView: boolean;
  /** The token from the URL — used to construct API calls. */
  token: string | null;
  /** The resolved brand id (loaded after first /brand call). */
  brandId: number | null;
}

const ClientViewContext = createContext<ClientViewState>({
  isClientView: false,
  token: null,
  brandId: null,
});

export function ClientViewProvider({
  token,
  brandId,
  children,
}: {
  token: string;
  brandId: number | null;
  children: ReactNode;
}) {
  return (
    <ClientViewContext.Provider value={{ isClientView: true, token, brandId }}>
      {children}
    </ClientViewContext.Provider>
  );
}

export function useClientView(): ClientViewState {
  return useContext(ClientViewContext);
}
```

- [ ] **Step 2: Add API client methods**

Edit `frontend/lib/api.ts`. Append a new namespace block (find an empty area near the end, before any default export):

```typescript
// ─── Client portal (token-gated, no auth) ───────────────────────────────────

export interface ClientPortalBrand {
  id: number;
  name: string;
  slug: string;
  brand_type: string;
  website_url: string | null;
}

export interface ClientPortalProposal {
  doc_url: string | null;
  label: string | null;
}

export interface ClientPortalDashboard {
  overall_score: number | null;
  latest_run_at: string | null;
  total_runs: number;
  sparkline: { completed_at: string | null; score: number | null }[];
}

const CLIENT_BASE = '/api/public/client';

export async function clientPortalGetBrand(token: string): Promise<ClientPortalBrand> {
  const { data } = await api.get(`${CLIENT_BASE}/${token}/brand`);
  return data;
}

export async function clientPortalGetProposal(token: string): Promise<ClientPortalProposal> {
  const { data } = await api.get(`${CLIENT_BASE}/${token}/proposal`);
  return data;
}

export async function clientPortalGetDashboard(token: string): Promise<ClientPortalDashboard> {
  const { data } = await api.get(`${CLIENT_BASE}/${token}/dashboard`);
  return data;
}

export async function clientPortalListRuns(token: string): Promise<any[]> {
  const { data } = await api.get(`${CLIENT_BASE}/${token}/runs`);
  return data;
}

export async function clientPortalListResponses(token: string, runId?: number): Promise<any[]> {
  const params = runId ? `?run_id=${runId}` : '';
  const { data } = await api.get(`${CLIENT_BASE}/${token}/responses${params}`);
  return data;
}

export async function clientPortalListCompetitors(token: string): Promise<any[]> {
  const { data } = await api.get(`${CLIENT_BASE}/${token}/competitors`);
  return data;
}

export async function clientPortalGetSiteAudit(token: string): Promise<any> {
  const { data } = await api.get(`${CLIENT_BASE}/${token}/site-audit`);
  return data;
}

export async function clientPortalListClusters(token: string): Promise<any[]> {
  const { data } = await api.get(`${CLIENT_BASE}/${token}/clusters`);
  return data;
}

export async function clientPortalListWikipedia(token: string): Promise<any[]> {
  const { data } = await api.get(`${CLIENT_BASE}/${token}/wikipedia`);
  return data;
}

export async function clientPortalListDocuments(token: string): Promise<any[]> {
  const { data } = await api.get(`${CLIENT_BASE}/${token}/documents`);
  return data;
}

export async function clientPortalGetDocument(token: string, docId: number): Promise<any> {
  const { data } = await api.get(`${CLIENT_BASE}/${token}/documents/${docId}`);
  return data;
}

export async function clientPortalListPostedContent(token: string): Promise<any[]> {
  const { data } = await api.get(`${CLIENT_BASE}/${token}/content`);
  return data;
}

export async function agencySetClientProposal(
  clientId: number,
  body: { current_proposal_doc_url: string | null; current_proposal_label: string | null },
): Promise<any> {
  const { data } = await api.patch(`/api/agency/clients/${clientId}/proposal`, body);
  return data;
}
```

Adjust the `api` reference name to match the existing axios instance in the file (search the file for `axios.create` to find the existing instance variable name and use it).

- [ ] **Step 3: Verify lint passes**

```bash
cd frontend && npm run lint
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add frontend/lib/client-view.ts frontend/lib/api.ts
git commit -m "feat(client-portal): ClientViewContext + useClientView hook + API client"
```

---

## Task 10: Frontend — `/client/[token]/` layout + sidebar

**Files:**
- Create: `frontend/app/client/[token]/layout.tsx`
- Create: `frontend/components/client-portal/ClientPortalSidebar.tsx`

- [ ] **Step 1: Create the sidebar component**

Create `frontend/components/client-portal/ClientPortalSidebar.tsx`:

```tsx
'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { BarChart3, FileText, Globe, LayoutDashboard, MessageSquare, Search, Send, Users } from 'lucide-react';

const NAV = (token: string) => [
  { href: `/client/${token}`, label: 'Home', icon: LayoutDashboard, exact: true },
  { href: `/client/${token}/visibility`, label: 'Visibility', icon: BarChart3 },
  { href: `/client/${token}/transcripts`, label: 'Transcripts', icon: MessageSquare },
  { href: `/client/${token}/competitors`, label: 'Competitors', icon: Users },
  { href: `/client/${token}/site-audit`, label: 'Site audit', icon: Search },
  { href: `/client/${token}/strategy`, label: 'Strategy', icon: Send },
  { href: `/client/${token}/wikipedia`, label: 'Wikipedia', icon: Globe },
  { href: `/client/${token}/content`, label: 'Content posted', icon: FileText },
  { href: `/client/${token}/reports`, label: 'Reports', icon: FileText },
];

export default function ClientPortalSidebar({ token }: { token: string }) {
  const pathname = usePathname();
  const nav = NAV(token);

  return (
    <aside className="hidden w-56 shrink-0 border-r border-neutral-200 bg-white px-3 py-6 md:block">
      <div className="mb-6 px-2 text-sm font-semibold text-neutral-900">Lumidian</div>
      <nav className="space-y-1">
        {nav.map((item) => {
          const active = item.exact ? pathname === item.href : pathname?.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors ${
                active ? 'bg-neutral-900 text-white' : 'text-neutral-700 hover:bg-neutral-100'
              }`}
            >
              <item.icon className="h-4 w-4" />
              {item.label}
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}
```

- [ ] **Step 2: Create the layout**

Create `frontend/app/client/[token]/layout.tsx`:

```tsx
import { ReactNode } from 'react';
import ClientPortalSidebar from '@/components/client-portal/ClientPortalSidebar';
import { ClientViewProvider } from '@/lib/client-view';
import { clientPortalGetBrand } from '@/lib/api';
import { notFound } from 'next/navigation';

export const dynamic = 'force-dynamic';

export default async function ClientPortalLayout({
  params,
  children,
}: {
  params: Promise<{ token: string }>;
  children: ReactNode;
}) {
  const { token } = await params;

  let brandId: number | null = null;
  try {
    const brand = await clientPortalGetBrand(token);
    brandId = brand.id;
  } catch {
    notFound();
  }

  return (
    <ClientViewProvider token={token} brandId={brandId}>
      <div className="min-h-screen bg-neutral-50 flex">
        <ClientPortalSidebar token={token} />
        <main className="flex-1 px-6 py-6">{children}</main>
      </div>
    </ClientViewProvider>
  );
}
```

(Note: server components can't use the `'use client'` hook directly. The `clientPortalGetBrand` call in this layout uses the axios client which is browser-only. If the existing `lib/api.ts` is configured as client-only, this layout call will fail at build time — in that case, convert the layout to a client component by adding `'use client'` and resolving `params` differently, or use Next.js' built-in `fetch` here. The implementer should pick whichever matches the existing patterns used in `app/review/[token]/layout.tsx`.)

- [ ] **Step 3: Verify lint passes**

```bash
cd frontend && npm run lint
```

Expected: no errors. Build may produce warnings about `params` async — these are normal in Next.js 15.

- [ ] **Step 4: Smoke check shell loads**

Start the dev server (if not running). Get a valid token by running:

```bash
cd backend && source venv/bin/activate
python -c "
import asyncio
from app.database import AsyncSessionLocal
from app.models import ClientReviewLink
from sqlalchemy import select

async def main():
    async with AsyncSessionLocal() as db:
        q = await db.execute(select(ClientReviewLink).limit(1))
        l = q.scalar_one_or_none()
        print('token:', l.token if l else 'none — create a client first')
asyncio.run(main())
"
```

Visit `http://localhost:3002/client/<token>`. The sidebar should render with 9 nav items. The main area will be empty (the page itself isn't built yet — that's Task 11).

- [ ] **Step 5: Commit**

```bash
git add frontend/app/client/[token]/layout.tsx frontend/components/client-portal/ClientPortalSidebar.tsx
git commit -m "feat(client-portal): portal shell layout + sidebar nav"
```

---

## Task 11: Frontend — `/review/[token]` alias redirect

**Files:**
- Modify: `frontend/app/review/[token]/page.tsx`

- [ ] **Step 1: Replace `/review/[token]` with a redirect**

The existing file at `frontend/app/review/[token]/page.tsx` shows the legacy draft-only review UI. Replace its contents with a server-side redirect to the new portal:

```tsx
import { redirect } from 'next/navigation';

export default async function ReviewRedirect({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  redirect(`/client/${token}`);
}
```

This deletes the existing review page implementation. **Before deleting, check that no other component imports `ReviewPage` from this directory** — `grep -rn "app/review/\[token\]/ReviewPage" frontend/` should return only the file itself.

If `ReviewPage.tsx`, `DraftCard.tsx`, `DocumentCard.tsx`, `EmptyState.tsx`, `DocumentReader.tsx`, `RevokedState.tsx` in `frontend/app/review/[token]/` become orphaned (no imports), leave them in place for now — they're harmless. A follow-up cleanup pass can delete them.

- [ ] **Step 2: Verify lint passes**

```bash
cd frontend && npm run lint
```

Expected: no errors.

- [ ] **Step 3: Smoke check the redirect**

Visit `http://localhost:3002/review/<token>`. Should redirect to `/client/<token>` (URL bar updates).

- [ ] **Step 4: Commit**

```bash
git add frontend/app/review/[token]/page.tsx
git commit -m "feat(client-portal): redirect /review/[token] → /client/[token]"
```

---

## Task 12: Frontend — Portal home page (scores + proposal card + activity)

**Files:**
- Create: `frontend/app/client/[token]/page.tsx`
- Create: `frontend/components/client-portal/ProposalCard.tsx`

- [ ] **Step 1: Create the ProposalCard component**

Create `frontend/components/client-portal/ProposalCard.tsx`:

```tsx
'use client';
import { ExternalLink } from 'lucide-react';

export default function ProposalCard({
  label,
  docUrl,
}: {
  label: string | null;
  docUrl: string | null;
}) {
  if (!label || !docUrl) return null;
  return (
    <div className="rounded-lg border border-neutral-200 bg-white p-5 shadow-sm">
      <div className="mb-1 text-xs font-medium uppercase tracking-wide text-neutral-500">
        This week's proposal
      </div>
      <div className="mb-3 text-base font-medium text-neutral-900">{label}</div>
      <a
        href={docUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-1.5 rounded-md bg-neutral-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-neutral-800"
      >
        Open in Google Docs
        <ExternalLink className="h-3.5 w-3.5" />
      </a>
    </div>
  );
}
```

- [ ] **Step 2: Create the home page**

Create `frontend/app/client/[token]/page.tsx`:

```tsx
'use client';
import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import {
  clientPortalGetBrand,
  clientPortalGetDashboard,
  clientPortalGetProposal,
  clientPortalListPostedContent,
  type ClientPortalBrand,
  type ClientPortalDashboard,
  type ClientPortalProposal,
} from '@/lib/api';
import ProposalCard from '@/components/client-portal/ProposalCard';

export default function ClientPortalHome() {
  const params = useParams<{ token: string }>();
  const token = params.token;
  const [brand, setBrand] = useState<ClientPortalBrand | null>(null);
  const [dashboard, setDashboard] = useState<ClientPortalDashboard | null>(null);
  const [proposal, setProposal] = useState<ClientPortalProposal | null>(null);
  const [posted, setPosted] = useState<any[]>([]);

  useEffect(() => {
    if (!token) return;
    Promise.all([
      clientPortalGetBrand(token),
      clientPortalGetDashboard(token),
      clientPortalGetProposal(token),
      clientPortalListPostedContent(token),
    ]).then(([b, d, p, c]) => {
      setBrand(b);
      setDashboard(d);
      setProposal(p);
      setPosted(c);
    });
  }, [token]);

  if (!brand) return <div className="text-sm text-neutral-500">Loading…</div>;

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <header>
        <h1 className="text-2xl font-semibold text-neutral-900">{brand.name}</h1>
        {dashboard?.latest_run_at && (
          <p className="mt-1 text-sm text-neutral-500">
            Last tracked: {new Date(dashboard.latest_run_at).toLocaleDateString()}
          </p>
        )}
      </header>

      {dashboard && (
        <section className="rounded-lg border border-neutral-200 bg-white p-5 shadow-sm">
          <div className="text-xs font-medium uppercase tracking-wide text-neutral-500">Visibility</div>
          <div className="mt-1 text-4xl font-semibold text-neutral-900">
            {dashboard.overall_score?.toFixed(1) ?? '—'}
          </div>
          <div className="mt-1 text-xs text-neutral-500">{dashboard.total_runs} runs total</div>
        </section>
      )}

      {proposal && <ProposalCard label={proposal.label} docUrl={proposal.doc_url} />}

      <section>
        <h2 className="mb-3 text-sm font-semibold text-neutral-900">Recently shipped</h2>
        {posted.length === 0 ? (
          <p className="text-sm text-neutral-500">No posted content yet.</p>
        ) : (
          <ul className="space-y-2">
            {posted.slice(0, 5).map((p) => (
              <li key={p.id} className="rounded-md border border-neutral-200 bg-white p-3 text-sm">
                <span className="font-medium">{p.title}</span>
                <span className="ml-2 text-neutral-500">· {p.platform}</span>
                {p.posted_at && (
                  <span className="ml-2 text-neutral-500">
                    · {new Date(p.posted_at).toLocaleDateString()}
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
```

- [ ] **Step 3: Verify lint passes**

```bash
cd frontend && npm run lint
```

Expected: no errors.

- [ ] **Step 4: Smoke check the home page**

Visit `http://localhost:3002/client/<token>`. Verify: brand name renders, visibility score shows, ProposalCard appears if proposal pointer is set (test by hitting the staff PATCH endpoint first to set one), recently shipped section shows posted drafts or "No posted content yet."

- [ ] **Step 5: Commit**

```bash
git add frontend/app/client/[token]/page.tsx frontend/components/client-portal/ProposalCard.tsx
git commit -m "feat(client-portal): portal home page with scores + proposal card"
```

---

## Task 13: Frontend — Visibility + Transcripts pages

**Files:**
- Create: `frontend/app/client/[token]/visibility/page.tsx`
- Create: `frontend/app/client/[token]/transcripts/page.tsx`

- [ ] **Step 1: Visibility page**

Create `frontend/app/client/[token]/visibility/page.tsx`:

```tsx
'use client';
import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { clientPortalListRuns } from '@/lib/api';

export default function VisibilityPage() {
  const params = useParams<{ token: string }>();
  const token = params.token;
  const [runs, setRuns] = useState<any[]>([]);

  useEffect(() => {
    if (!token) return;
    clientPortalListRuns(token).then(setRuns);
  }, [token]);

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <h1 className="text-2xl font-semibold text-neutral-900">Visibility runs</h1>
      <table className="w-full rounded-lg border border-neutral-200 bg-white">
        <thead className="border-b border-neutral-200 text-left text-xs uppercase tracking-wide text-neutral-500">
          <tr>
            <th className="px-4 py-2">Date</th>
            <th className="px-4 py-2">Score</th>
            <th className="px-4 py-2">Queries</th>
            <th className="px-4 py-2">Mentions</th>
          </tr>
        </thead>
        <tbody>
          {runs.map((r) => (
            <tr key={r.id} className="border-b border-neutral-100 text-sm last:border-0">
              <td className="px-4 py-2">{r.completed_at ? new Date(r.completed_at).toLocaleDateString() : '—'}</td>
              <td className="px-4 py-2 font-medium">{r.overall_score?.toFixed(1) ?? '—'}</td>
              <td className="px-4 py-2">{r.total_queries}</td>
              <td className="px-4 py-2">{r.total_mentions}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
```

- [ ] **Step 2: Transcripts page**

Create `frontend/app/client/[token]/transcripts/page.tsx`:

```tsx
'use client';
import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { clientPortalListResponses } from '@/lib/api';

export default function TranscriptsPage() {
  const params = useParams<{ token: string }>();
  const token = params.token;
  const [rows, setRows] = useState<any[]>([]);

  useEffect(() => {
    if (!token) return;
    clientPortalListResponses(token).then(setRows);
  }, [token]);

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <h1 className="text-2xl font-semibold text-neutral-900">Transcripts</h1>
      <p className="text-sm text-neutral-500">Raw responses from the latest tracking run.</p>
      <ul className="space-y-3">
        {rows.map((r) => (
          <li key={r.id} className="rounded-md border border-neutral-200 bg-white p-4">
            <div className="mb-1 text-xs font-medium uppercase tracking-wide text-neutral-500">
              {r.model} · {r.prompt_text}
            </div>
            <div className={`text-sm ${r.mentioned ? 'text-neutral-900' : 'text-neutral-600'}`}>
              {r.response_text}
            </div>
            {r.mentioned && (
              <div className="mt-2 inline-block rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700">
                Mentioned
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
```

- [ ] **Step 3: Verify lint + smoke check**

```bash
cd frontend && npm run lint
```

Visit both `/client/<token>/visibility` and `/client/<token>/transcripts`. Confirm content renders.

- [ ] **Step 4: Commit**

```bash
git add frontend/app/client/[token]/visibility/page.tsx frontend/app/client/[token]/transcripts/page.tsx
git commit -m "feat(client-portal): visibility + transcripts pages"
```

---

## Task 14: Frontend — Competitors + Site audit + Strategy + Wikipedia pages

**Files:**
- Create: 4 page files

Each follows the same pattern as Task 13: client component, `useEffect` to fetch data, simple list/table rendering. Implementer reuses existing display components from the SaaS surfaces where possible (e.g., the existing `BotGrid`, `ScoreStrip` from `site-audit/`), passing in the data fetched from the portal endpoints.

- [ ] **Step 1: Competitors page**

Create `frontend/app/client/[token]/competitors/page.tsx`:

```tsx
'use client';
import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { clientPortalListCompetitors } from '@/lib/api';

export default function CompetitorsPage() {
  const params = useParams<{ token: string }>();
  const token = params.token;
  const [items, setItems] = useState<any[]>([]);

  useEffect(() => {
    if (!token) return;
    clientPortalListCompetitors(token).then(setItems);
  }, [token]);

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <h1 className="text-2xl font-semibold text-neutral-900">Competitors</h1>
      <ul className="space-y-2">
        {items.map((c) => (
          <li key={c.id} className="rounded-md border border-neutral-200 bg-white p-3 text-sm">
            <span className="font-medium">{c.name}</span>
            {c.website_url && (
              <a
                href={c.website_url}
                target="_blank"
                rel="noopener noreferrer"
                className="ml-2 text-neutral-500 hover:underline"
              >
                {c.website_url}
              </a>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
```

- [ ] **Step 2: Site audit page**

Create `frontend/app/client/[token]/site-audit/page.tsx`:

```tsx
'use client';
import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { clientPortalGetSiteAudit } from '@/lib/api';

export default function SiteAuditPage() {
  const params = useParams<{ token: string }>();
  const token = params.token;
  const [data, setData] = useState<any | null>(null);

  useEffect(() => {
    if (!token) return;
    clientPortalGetSiteAudit(token).then(setData);
  }, [token]);

  if (!data) return <div className="text-sm text-neutral-500">Loading…</div>;
  if (!data.audit) return <div className="text-sm text-neutral-500">No audit yet.</div>;

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <h1 className="text-2xl font-semibold text-neutral-900">Site audit</h1>
      <section className="rounded-lg border border-neutral-200 bg-white p-5">
        <div className="text-xs font-medium uppercase tracking-wide text-neutral-500">Overall score</div>
        <div className="mt-1 text-4xl font-semibold text-neutral-900">
          {data.audit.overall_score?.toFixed(1) ?? '—'}
        </div>
      </section>
      <section>
        <h2 className="mb-2 text-sm font-semibold text-neutral-900">Recommendations</h2>
        <ul className="space-y-2">
          {data.recommendations.map((r: any) => (
            <li key={r.id} className="rounded-md border border-neutral-200 bg-white p-3 text-sm">
              <span className="mr-2 inline-block rounded-full bg-neutral-100 px-2 py-0.5 text-xs uppercase tracking-wide text-neutral-700">
                {r.priority}
              </span>
              <span className="font-medium">{r.title}</span>
              <div className="mt-1 text-neutral-600">{r.body}</div>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
```

- [ ] **Step 3: Strategy (clusters) page**

Create `frontend/app/client/[token]/strategy/page.tsx`:

```tsx
'use client';
import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { clientPortalListClusters } from '@/lib/api';

export default function StrategyPage() {
  const params = useParams<{ token: string }>();
  const token = params.token;
  const [clusters, setClusters] = useState<any[]>([]);

  useEffect(() => {
    if (!token) return;
    clientPortalListClusters(token).then(setClusters);
  }, [token]);

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <h1 className="text-2xl font-semibold text-neutral-900">Content strategy</h1>
      <p className="text-sm text-neutral-500">Per-prompt content clusters and their status.</p>
      <ul className="space-y-2">
        {clusters.map((c) => (
          <li key={c.id} className="rounded-md border border-neutral-200 bg-white p-3 text-sm">
            <div className="font-medium text-neutral-900">{c.prompt_text}</div>
            <div className="mt-1 text-xs text-neutral-500">
              Status: {c.status}
              {c.last_generated_at && ` · Last generated ${new Date(c.last_generated_at).toLocaleDateString()}`}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
```

- [ ] **Step 4: Wikipedia page**

Create `frontend/app/client/[token]/wikipedia/page.tsx`:

```tsx
'use client';
import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { clientPortalListWikipedia } from '@/lib/api';

export default function WikipediaPage() {
  const params = useParams<{ token: string }>();
  const token = params.token;
  const [candidates, setCandidates] = useState<any[]>([]);

  useEffect(() => {
    if (!token) return;
    clientPortalListWikipedia(token).then(setCandidates);
  }, [token]);

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <h1 className="text-2xl font-semibold text-neutral-900">Wikipedia candidates</h1>
      <ul className="space-y-2">
        {candidates.map((c) => (
          <li key={c.id} className="rounded-md border border-neutral-200 bg-white p-3 text-sm">
            <a
              href={c.article_url}
              target="_blank"
              rel="noopener noreferrer"
              className="font-medium text-neutral-900 hover:underline"
            >
              {c.article_title}
            </a>
            <span className="ml-2 text-xs text-neutral-500">
              · Legitimacy {c.legitimacy_score?.toFixed(2) ?? '—'}
            </span>
            <span className="ml-2 inline-block rounded-full bg-neutral-100 px-2 py-0.5 text-xs uppercase text-neutral-700">
              {c.status}
            </span>
            {c.article_summary && (
              <div className="mt-1 text-neutral-600 line-clamp-2">{c.article_summary}</div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
```

- [ ] **Step 5: Verify lint + smoke check all four pages**

```bash
cd frontend && npm run lint
```

Visit each of `/client/<token>/competitors`, `/site-audit`, `/strategy`, `/wikipedia`. Confirm renders without errors.

- [ ] **Step 6: Commit**

```bash
git add frontend/app/client/[token]/competitors frontend/app/client/[token]/site-audit frontend/app/client/[token]/strategy frontend/app/client/[token]/wikipedia
git commit -m "feat(client-portal): competitors + site-audit + strategy + wikipedia pages"
```

---

## Task 15: Frontend — Content posted + Reports pages

**Files:**
- Create: `frontend/app/client/[token]/content/page.tsx`
- Create: `frontend/app/client/[token]/reports/page.tsx`

- [ ] **Step 1: Content (posted) page**

Create `frontend/app/client/[token]/content/page.tsx`:

```tsx
'use client';
import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { clientPortalListPostedContent } from '@/lib/api';

export default function ContentPostedPage() {
  const params = useParams<{ token: string }>();
  const token = params.token;
  const [items, setItems] = useState<any[]>([]);

  useEffect(() => {
    if (!token) return;
    clientPortalListPostedContent(token).then(setItems);
  }, [token]);

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <h1 className="text-2xl font-semibold text-neutral-900">Content posted</h1>
      <p className="text-sm text-neutral-500">Everything that has been published for this brand.</p>
      <ul className="space-y-3">
        {items.map((p) => (
          <li key={p.id} className="rounded-md border border-neutral-200 bg-white p-4 text-sm">
            <div className="flex items-baseline justify-between">
              <span className="font-medium text-neutral-900">{p.title}</span>
              {p.posted_at && (
                <span className="text-xs text-neutral-500">
                  {new Date(p.posted_at).toLocaleDateString()}
                </span>
              )}
            </div>
            <div className="mt-1 text-xs text-neutral-500">{p.platform}</div>
            {p.content_text && (
              <div className="mt-2 whitespace-pre-wrap text-neutral-700 line-clamp-6">
                {p.content_text}
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
```

- [ ] **Step 2: Reports page**

Create `frontend/app/client/[token]/reports/page.tsx`:

```tsx
'use client';
import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { clientPortalListDocuments, clientPortalGetDocument } from '@/lib/api';
import { Download } from 'lucide-react';

export default function ReportsPage() {
  const params = useParams<{ token: string }>();
  const token = params.token;
  const [docs, setDocs] = useState<any[]>([]);
  const [open, setOpen] = useState<any | null>(null);

  useEffect(() => {
    if (!token) return;
    clientPortalListDocuments(token).then(setDocs);
  }, [token]);

  async function openDoc(id: number) {
    const d = await clientPortalGetDocument(token, id);
    setOpen(d);
  }

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <h1 className="text-2xl font-semibold text-neutral-900">Reports</h1>
      <ul className="space-y-2">
        {docs.map((d) => (
          <li
            key={d.id}
            className="flex items-center justify-between rounded-md border border-neutral-200 bg-white p-3 text-sm"
          >
            <button onClick={() => openDoc(d.id)} className="text-left font-medium hover:underline">
              {d.title}
            </button>
            <div className="flex items-center gap-3">
              {d.generated_at && (
                <span className="text-xs text-neutral-500">
                  {new Date(d.generated_at).toLocaleDateString()}
                </span>
              )}
              <a
                href={`/api/public/client/${token}/documents/${d.id}/pdf`}
                className="inline-flex items-center gap-1 rounded-md border border-neutral-200 px-2 py-1 text-xs hover:bg-neutral-50"
              >
                <Download className="h-3 w-3" /> PDF
              </a>
            </div>
          </li>
        ))}
      </ul>
      {open && (
        <article className="rounded-md border border-neutral-200 bg-white p-5">
          <div className="mb-2 text-sm font-semibold text-neutral-900">{open.title}</div>
          <div className="whitespace-pre-wrap text-sm text-neutral-700">{open.body_markdown}</div>
        </article>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Verify lint + smoke check**

```bash
cd frontend && npm run lint
```

Visit `/client/<token>/content` and `/client/<token>/reports`. Confirm rendering. Click a report — body should appear below. PDF download should trigger a file download.

- [ ] **Step 4: Commit**

```bash
git add frontend/app/client/[token]/content frontend/app/client/[token]/reports
git commit -m "feat(client-portal): content posted + reports pages"
```

---

## Task 16: Frontend — Action-button audit pass

**Goal:** Inside the `/client/[token]/*` shell, no action button should be visible. The portal pages built in Tasks 12-15 don't use action buttons because they're new pages built fresh. This task ensures that any *shared component* a portal page might import (now or in the future) honors `useClientView()`.

This is a defense-in-depth pass. The portal pages we just built don't currently import the heavy SaaS components, so the user-visible impact is small — but if a future developer imports `RunTrackingButton` into a portal page, this audit ensures it does nothing.

**Files (audit pass):**
- `frontend/components/agency/RunTrackingButton.tsx`
- `frontend/components/agency/GenerateDraftButton.tsx`
- `frontend/components/agency/SendDraftsToClientModal.tsx`
- `frontend/components/agency/GenerateDocumentButton.tsx`
- `frontend/components/agency/MarkPostedModal.tsx`
- `frontend/components/site-audit/AuditTriggerButton.tsx` (and any FixCard write actions)
- `frontend/components/clusters/*` (regenerate/edit-brief/pillar buttons)
- `frontend/components/wikipedia/*` (scan/draft buttons)
- `frontend/components/BrandProfile*.tsx` (read-only mode)

- [ ] **Step 1: Enumerate the components to gate**

Run this exact command and save the output:

```bash
cd frontend && grep -rln "onClick=" components/agency components/site-audit components/clusters components/wikipedia 2>/dev/null | sort -u
```

Open each file. For each `onClick` handler that calls a write API (POST/PATCH/DELETE), wrap the rendered Button with an `isClientView` check.

- [ ] **Step 2: Apply the wrap pattern**

The standard pattern for each component:

```tsx
import { useClientView } from '@/lib/client-view';

export default function RunTrackingButton({ /* props */ }) {
  const { isClientView } = useClientView();
  if (isClientView) return null;
  // ... existing rendering
}
```

Apply this to every component whose primary purpose is firing a write. For components that are mostly display but have a button inside (e.g., a row component with a "Delete" icon), wrap just the button:

```tsx
const { isClientView } = useClientView();
// ...
{!isClientView && (
  <button onClick={handleDelete}>Delete</button>
)}
```

Components to update at minimum (from the spec's audit list):
- `RunTrackingButton` — full return null
- `GenerateDraftButton` — full return null
- `SendDraftsToClientModal` — trigger button hidden
- `GenerateDocumentButton` — full return null
- `MarkPostedModal` — trigger button hidden
- Any component file under `components/site-audit/` that fires `draftRec`, `setRecStatus`, `triggerAudit`, or similar — gate the action button
- Any `components/clusters/` button-bearing component
- Any `components/wikipedia/` button-bearing component
- `CopyReviewLinkButton` — keep visible inside SaaS but `return null` in `isClientView` (clients shouldn't see "copy your own portal link")

For each file modified, the pattern is identical: import the hook, return null OR gate the button. No new tests — this is purely defensive.

- [ ] **Step 3: Brand profile read-only treatment**

Find the brand profile editor component (likely `frontend/components/BrandProfileEditor.tsx` or similar — `grep -rln "tone_of_voice\|target_audience" frontend/components/`). For each `<input>` / `<textarea>` rendered in the profile form, wrap with a check:

```tsx
const { isClientView } = useClientView();

// Instead of:
<input value={brand.tone_of_voice} onChange={...} />
// Render:
{isClientView ? (
  <div className="rounded-md bg-neutral-50 px-3 py-2 text-sm text-neutral-700">
    {brand.tone_of_voice || '—'}
  </div>
) : (
  <input value={brand.tone_of_voice} onChange={...} />
)}
```

Also hide the `internal_brand_context` field entirely when `isClientView`:

```tsx
{!isClientView && (
  // existing internal_brand_context field
)}
```

- [ ] **Step 4: Verify lint passes**

```bash
cd frontend && npm run lint
```

Expected: no errors.

- [ ] **Step 5: Smoke check — confirm no action buttons reachable in portal**

Manually click through all 9 portal pages. Confirm:
- No "Trigger Run" button anywhere
- No "Regenerate" button anywhere
- No "Draft", "Approve", "Mark Posted" buttons anywhere
- No "Scan", "Edit", "Delete" buttons anywhere
- No form inputs (all text values render as plain text)

- [ ] **Step 6: Commit**

```bash
git add frontend/components
git commit -m "feat(client-portal): gate action buttons + brand profile editor with isClientView"
```

---

## Task 17: Staff cockpit — proposal pointer form

**Files:**
- Create: `frontend/components/agency/ClientProposalForm.tsx`
- Modify: `frontend/components/agency/ClientBrandTab.tsx`

- [ ] **Step 1: Create the form component**

Create `frontend/components/agency/ClientProposalForm.tsx`:

```tsx
'use client';
import { useState, useEffect } from 'react';
import { agencySetClientProposal } from '@/lib/api';

export default function ClientProposalForm({
  clientId,
  initialDocUrl,
  initialLabel,
  onSaved,
}: {
  clientId: number;
  initialDocUrl: string | null;
  initialLabel: string | null;
  onSaved?: (next: { docUrl: string | null; label: string | null }) => void;
}) {
  const [docUrl, setDocUrl] = useState(initialDocUrl ?? '');
  const [label, setLabel] = useState(initialLabel ?? '');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    setDocUrl(initialDocUrl ?? '');
    setLabel(initialLabel ?? '');
  }, [initialDocUrl, initialLabel]);

  async function handleSave() {
    setSaving(true);
    setSaved(false);
    try {
      await agencySetClientProposal(clientId, {
        current_proposal_doc_url: docUrl.trim() || null,
        current_proposal_label: label.trim() || null,
      });
      setSaved(true);
      onSaved?.({ docUrl: docUrl.trim() || null, label: label.trim() || null });
      setTimeout(() => setSaved(false), 2000);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="rounded-lg border border-neutral-200 bg-white p-4">
      <div className="mb-3 text-sm font-semibold text-neutral-900">This week's proposal</div>
      <div className="space-y-3">
        <label className="block text-xs font-medium text-neutral-700">
          Label
          <input
            type="text"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="Week of May 22 — 5 pieces"
            className="mt-1 block w-full rounded-md border border-neutral-300 px-3 py-1.5 text-sm"
          />
        </label>
        <label className="block text-xs font-medium text-neutral-700">
          Google Docs URL
          <input
            type="url"
            value={docUrl}
            onChange={(e) => setDocUrl(e.target.value)}
            placeholder="https://docs.google.com/document/d/…"
            className="mt-1 block w-full rounded-md border border-neutral-300 px-3 py-1.5 text-sm"
          />
        </label>
        <div className="flex items-center justify-between">
          <button
            onClick={handleSave}
            disabled={saving}
            className="rounded-md bg-neutral-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-neutral-800 disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
          {saved && <span className="text-xs text-emerald-600">Saved</span>}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Mount the form in `ClientBrandTab.tsx`**

Open `frontend/components/agency/ClientBrandTab.tsx`. Find an appropriate location (likely under the brand profile section). Import and render:

```tsx
import ClientProposalForm from './ClientProposalForm';

// ... inside the JSX, somewhere near the brand profile or actions area:
<ClientProposalForm
  clientId={client.id}
  initialDocUrl={client.current_proposal_doc_url ?? null}
  initialLabel={client.current_proposal_label ?? null}
  onSaved={({ docUrl, label }) => {
    /* optionally refetch client data here */
  }}
/>
```

You'll need to ensure the `client` prop being passed into `ClientBrandTab` includes `current_proposal_doc_url` and `current_proposal_label`. The `AgencyClientOut` schema (Task 2) already includes these fields. The frontend `AgencyClient` TypeScript type in `lib/api.ts` may need the fields added — search `frontend/lib/api.ts` for the interface (likely `AgencyClient` or `AgencyClientOut`) and add:

```typescript
current_proposal_doc_url: string | null;
current_proposal_label: string | null;
```

- [ ] **Step 3: Verify lint passes**

```bash
cd frontend && npm run lint
```

Expected: no errors.

- [ ] **Step 4: Smoke check — fill the form, verify portal home updates**

Open `/agency/clients/<id>` (cockpit). Confirm the "This week's proposal" form appears in the Brand tab. Type a label and a Google Doc URL, click Save. Then open `/client/<token>` (portal home) in a separate tab — the ProposalCard should appear with the link.

- [ ] **Step 5: Commit**

```bash
git add frontend/components/agency/ClientProposalForm.tsx frontend/components/agency/ClientBrandTab.tsx frontend/lib/api.ts
git commit -m "feat(agency): staff form for setting this-week's-proposal pointer"
```

---

## Task 18: Final smoke checklist + cleanup

- [ ] **Step 1: Run the full backend test suite**

```bash
cd backend && source venv/bin/activate
pytest tests/ -x --tb=short
```

Expected: all tests PASS. Investigate any new failures — most likely culprits are tests asserting on the old `/review/` URL format (Task 3 changed this) or tests that don't expect the new `current_proposal_*` columns on `AgencyClient`.

- [ ] **Step 2: Run frontend build**

```bash
cd frontend && npm run build
```

Expected: succeeds without errors.

- [ ] **Step 3: Manual smoke test — end-to-end portal walkthrough**

With dev server running:

1. Create an agency client via cockpit at `/agency/clients`
2. Trigger a tracking run for it via `RunTrackingButton`
3. Wait for completion
4. Mark at least one draft as posted (so content history has data)
5. Generate a weekly report so the documents/reports surface has data
6. Set a proposal pointer via the new form in the Brand tab
7. Get the review link from `Copy review link` button (now `/client/<token>` URL)
8. Open the URL in a private browser window (no auth)
9. Click through all 9 portal nav items: Home, Visibility, Transcripts, Competitors, Site audit, Strategy, Wikipedia, Content posted, Reports
10. Confirm each page loads, shows expected data, and has zero action buttons
11. Confirm the ProposalCard on Home shows the Google Docs link
12. Confirm the Reports tab shows the weekly report and the PDF download works
13. Confirm the old `/review/<token>` URL redirects to `/client/<token>`
14. Confirm `/client/<token>/settings` (typed manually) returns 404

- [ ] **Step 4: Verify token revocation invalidates the portal**

Revoke the review link via the cockpit (rotate the link). Refresh the old portal tab — should now show a 404 (because the layout's `clientPortalGetBrand` call fails and triggers `notFound()`).

- [ ] **Step 5: If any pages or features broke, fix and re-commit**

- [ ] **Step 6: Final commit (if any fixes)**

```bash
git add -A
git commit -m "fix(client-portal): smoke test fixes"
```

- [ ] **Step 7: Update CURRENT_STATE.md**

Append a one-liner to "Recent Decisions" in `CURRENT_STATE.md`:

```markdown
- **2026-05-22** — Shipped **client portal v1** on branch `<branch>`. Read-only token-gated portal at `/client/[token]` mirroring SaaS surfaces (dashboard / visibility / transcripts / competitors / site-audit / strategy / wikipedia / content-posted / reports). Entry via existing `ClientReviewLink` token (no new auth surface). New `/api/public/client/{token}/...` router with 13 read endpoints. Tiny "this week's proposal" pointer (2 cols on `AgencyClient` + staff form + portal card) ties the Google-Docs review cycle to the portal without API integration. Action-button audit gates ~10 write components with `useClientView()`. Spec at `docs/superpowers/specs/2026-05-22-agency-client-portal-design.md`.
```

```bash
git add CURRENT_STATE.md
git commit -m "docs: update CURRENT_STATE for client portal v1 ship"
```

---

## Self-review notes (from plan author)

- **Spec coverage:** Every section of the spec maps to one or more tasks. Workflow split = inherent (no code). Portal entry = Task 3 (URL builder) + Task 4 (resolver) + Task 11 (alias). Read endpoints = Tasks 5-8. `is_client_view` flag = Task 4 (`ClientViewContext` dataclass — implicit since context exists or doesn't, no boolean needed in handlers). Hide vs. block = Task 16 (frontend hide) + the architectural choice to not mount writes in `/api/public/client/` namespace (block by routing). Proposal pointer = Task 1 (cols) + Task 2 (staff endpoint) + Task 12 (portal card) + Task 17 (staff form). Sidebar nav = Task 10. Pages = Tasks 12-15. Brand profile read-only = Task 16, Step 3. Tests = scattered across tasks 1-8.
- **`require_not_client_view` backstop:** Spec mentions adding this as a backstop dependency on every write endpoint. The plan defers this to a follow-up — currently we block writes purely by not mounting write routes in `/api/public/client/`. Adding the dep to every existing write endpoint across all routers is a large mechanical change unrelated to the user-visible feature, and there's no realistic threat vector when the namespace itself excludes writes. If the implementer wants to add it, do so after Task 18 as an "optional belt-and-suspenders" task.
- **`/client/{token}` vs `/api/public/client/{token}`:** The spec writes `/api/client/{token}` for backend routes; this plan deliberately uses `/api/public/client/{token}` for consistency with the existing `/api/public/review/{token}` namespace. The user-facing frontend URL remains `/client/{token}` as the spec specifies.
