# Agency Brand Tier + Drafting Inside Cockpit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development.

**Goal:** Introduce `brand_type='agency'` as a discriminator, hide agency brands from SaaS UI, and ship a "Generate draft" button inside the agency cockpit that calls the existing drafting service while bypassing SaaS tier checks.

**Architecture:** Backend changes: (1) flip the new-client flow to create brands with `brand_type='agency'`, (2) filter the two SaaS list endpoints, (3) add a new agency-scoped drafting endpoint that calls `generate_gap_draft` directly (the existing drafting service), avoiding the tier-gated content router. Frontend: new `GenerateDraftButton` component wired into the cockpit's Pipeline section + drop the "Open in Lumidian" link from the tracking widget.

**Tech Stack:** FastAPI, SQLAlchemy async, pytest. Next.js, React, TypeScript, Tailwind, Radix Dialog.

**Spec:** `docs/superpowers/specs/2026-05-13-agency-tier-and-drafting-design.md`

---

## File Structure

### Backend (modify)

- `backend/app/routers/agency.py` — flip new-brand `brand_type` to `'agency'`; add `POST /clients/{client_id}/drafts/generate` endpoint.
- `backend/app/routers/brands.py` — exclude agency brands from `list_brands` + `list_brands_with_stats`.
- `backend/app/schemas.py` — add `AgencyDraftGenerateIn`.
- `backend/app/services/agency_activity.py` — add `EVENT_DRAFT_GENERATED_BY_STAFF` constant.
- `backend/tests/test_agency_drafting.py` — new test file.

### Frontend

- `frontend/lib/api.ts` — add `agencyGenerateDraft()`.
- `frontend/components/agency/LumidianTrackingWidget.tsx` — drop "Open in Lumidian" link.
- `frontend/components/agency/GenerateDraftButton.tsx` — NEW.
- `frontend/components/agency/ClientCockpit.tsx` — render `<GenerateDraftButton>` in the Pipeline section header.

---

## Task 1: Agency brand tier (backend)

**Files:**
- Modify: `backend/app/routers/agency.py`
- Modify: `backend/app/routers/brands.py`

- [ ] **Step 1: Flip new-brand type in `agency.py:create_client`**

In `backend/app/routers/agency.py`, find the `create_client` function. Replace:

```python
brand = Brand(
    name=body.name.strip(),
    slug=f"agency-{slug}",
    user_id=user.id,
    agency_client_id=client.id,
    brand_type="standard",
)
```

with:

```python
brand = Brand(
    name=body.name.strip(),
    slug=f"agency-{slug}",
    user_id=user.id,
    agency_client_id=client.id,
    brand_type="agency",
)
```

- [ ] **Step 2: Exclude agency brands from `list_brands_with_stats` in `brands.py`**

Find `list_brands_with_stats` (around line 120). Locate the existing `select(...).where(Brand.user_id == owner_id)...` clause and add `Brand.brand_type != 'agency'`:

```python
brands_result = await db.execute(
    select(Brand, func.count(Prompt.id).label("prompt_count"))
    .outerjoin(Prompt, Prompt.brand_id == Brand.id)
    .where(Brand.user_id == owner_id, Brand.brand_type != 'agency')
    .group_by(Brand.id)
    .order_by(Brand.created_at.desc())
)
```

- [ ] **Step 3: Exclude agency brands from `list_brands`**

Find `list_brands` (around line 197). Same change — add `Brand.brand_type != 'agency'` to the where clause:

```python
result = await db.execute(
    select(Brand, func.count(Prompt.id).label("prompt_count"))
    .outerjoin(Prompt, Prompt.brand_id == Brand.id)
    .where(Brand.user_id == owner_id, Brand.brand_type != 'agency')
    .group_by(Brand.id)
    .order_by(Brand.created_at.desc())
)
```

- [ ] **Step 4: Verify the app boots cleanly**

```bash
cd /Users/ken/Desktop/Lumidian/backend
source venv/bin/activate
python -c "from app.main import app; print('OK')"
```

Expected: `OK`.

- [ ] **Step 5: Commit**

```bash
git add backend/app/routers/agency.py backend/app/routers/brands.py
git commit -m "feat(backend): agency brand_type discriminator + hide from SaaS list endpoints"
```

---

## Task 2: Schema + event constant

**Files:**
- Modify: `backend/app/schemas.py`
- Modify: `backend/app/services/agency_activity.py`

- [ ] **Step 1: Append schema to `schemas.py`**

```python
# ── Agency drafting (sub-project E, 2026-05-13) ──────────────────────────────


class AgencyDraftGenerateIn(BaseModel):
    prompt_id: int
    platform: str = Field(min_length=1, max_length=64)
    custom_brief: str | None = Field(default=None, max_length=2000)
```

- [ ] **Step 2: Add event constant**

In `backend/app/services/agency_activity.py`, append after the existing event constants:

```python
EVENT_DRAFT_GENERATED_BY_STAFF = "draft_generated_by_staff"
```

- [ ] **Step 3: Verify imports**

```bash
cd /Users/ken/Desktop/Lumidian/backend
source venv/bin/activate
python -c "from app.schemas import AgencyDraftGenerateIn; from app.services.agency_activity import EVENT_DRAFT_GENERATED_BY_STAFF; print('OK')"
```

Expected: `OK`.

- [ ] **Step 4: Commit**

```bash
git add backend/app/schemas.py backend/app/services/agency_activity.py
git commit -m "feat(backend): AgencyDraftGenerateIn schema + draft_generated_by_staff event"
```

---

## Task 3: Agency drafting endpoint

**Files:**
- Modify: `backend/app/routers/agency.py`

- [ ] **Step 1: Update imports**

In `backend/app/routers/agency.py`:

- Add `Prompt` to the existing `from app.models import (...)` tuple.
- Add `AgencyDraftGenerateIn` to the existing `from app.schemas import (...)` tuple.
- Add a new import line below the existing `agency_activity` import:
  ```python
  from app.services.agency_activity import EVENT_DRAFT_GENERATED_BY_STAFF
  from app.services.drafting_service import generate_gap_draft, ALL_DRAFT_PLATFORMS
  ```

  Update the existing `from app.services.agency_activity import (...)` to include `EVENT_DRAFT_GENERATED_BY_STAFF`.

- [ ] **Step 2: Append the new endpoint**

Append to `backend/app/routers/agency.py`:

```python
@router.post(
    "/clients/{client_id}/drafts/generate",
    status_code=http_status.HTTP_201_CREATED,
)
async def agency_generate_draft(
    client_id: int,
    body: AgencyDraftGenerateIn,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_agency_staff),
):
    """Generate a draft inside the agency portal. Bypasses SaaS tier checks."""
    # Resolve client + its brand
    client = await db.get(AgencyClient, client_id)
    if client is None:
        raise HTTPException(status_code=404, detail="Client not found")

    brand_q = await db.execute(
        select(Brand).where(Brand.agency_client_id == client_id).limit(1)
    )
    brand = brand_q.scalar_one_or_none()
    if brand is None:
        raise HTTPException(status_code=404, detail="No brand attached to client")
    if brand.brand_type != "agency":
        raise HTTPException(
            status_code=http_status.HTTP_400_BAD_REQUEST,
            detail="Brand is not agency-tier",
        )

    # Validate platform
    if body.platform not in ALL_DRAFT_PLATFORMS:
        raise HTTPException(
            status_code=http_status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Unsupported platform. Must be one of {sorted(ALL_DRAFT_PLATFORMS)}",
        )

    # Validate prompt belongs to this brand
    prompt = await db.get(Prompt, body.prompt_id)
    if prompt is None or prompt.brand_id != brand.id:
        raise HTTPException(
            status_code=404,
            detail="Prompt not found for this client's brand",
        )

    # Generate via the existing service. agency-staff bypasses SaaS tier gates
    # by virtue of calling this endpoint (which is gated by require_agency_staff).
    try:
        draft = await generate_gap_draft(
            db=db,
            brand_id=brand.id,
            prompt_id=body.prompt_id,
            platform=body.platform,
            custom_brief=body.custom_brief,
            source="agency",
        )
    except ValueError as exc:
        raise HTTPException(
            status_code=http_status.HTTP_400_BAD_REQUEST,
            detail=str(exc),
        )

    # Emit activity event
    await emit_event(
        db,
        agency_client_id=client_id,
        event_type=EVENT_DRAFT_GENERATED_BY_STAFF,
        body=f"Generated draft '{draft.title or f'Draft #{draft.id}'}' for {body.platform}",
        actor_user_id=user.id,
        payload={"prompt_id": body.prompt_id, "platform": body.platform, "draft_id": draft.id},
        related_draft_id=draft.id,
    )
    await db.commit()
    await db.refresh(draft)

    # Return as plain dict — let FastAPI serialize via the existing ContentDraft schema
    return {
        "id": draft.id,
        "brand_id": draft.brand_id,
        "prompt_id": draft.prompt_id,
        "platform": draft.platform,
        "status": draft.status,
        "title": draft.title,
        "content_text": draft.content_text,
        "content_brief": draft.content_brief,
        "estimated_impact": draft.estimated_impact,
        "source": draft.source,
        "assigned_to_user_id": getattr(draft, "assigned_to_user_id", None),
        "created_at": draft.created_at.isoformat() if draft.created_at else None,
        "updated_at": draft.updated_at.isoformat() if draft.updated_at else None,
    }
```

Note: returning a plain dict instead of `ContentDraftSchema` to avoid the implementer needing to figure out the exact response_model. Frontend treats the response as a `ContentDraft` shape.

- [ ] **Step 3: Verify the route is mounted**

```bash
cd /Users/ken/Desktop/Lumidian/backend
source venv/bin/activate
python -c "from app.main import app
for r in app.routes:
    p = str(getattr(r, 'path', ''))
    if 'drafts/generate' in p:
        print(p)"
```

Expected: prints `/api/agency/clients/{client_id}/drafts/generate`.

- [ ] **Step 4: Commit**

```bash
git add backend/app/routers/agency.py
git commit -m "feat(backend): agency drafting endpoint (bypasses SaaS tier checks)"
```

---

## Task 4: Backend tests

**Files:**
- Create: `backend/tests/test_agency_drafting.py`

- [ ] **Step 1: Create the test file**

```python
"""Tests for the agency drafting endpoint + brand-type filtering."""
from __future__ import annotations

from unittest.mock import AsyncMock, patch

import pytest
from sqlalchemy import select, update

from app.database import AsyncSessionLocal
from app.models import AgencyStaff, Brand, ClientActivityEvent, Prompt, User
from tests.conftest import register_and_login


async def _make_agency_user(client, email: str = "draft@example.com") -> None:
    await register_and_login(client, email=email)
    async with AsyncSessionLocal() as db:
        await db.execute(update(User).where(User.email == email).values(is_agency_staff=True))
        user = (await db.execute(select(User).where(User.email == email))).scalar_one()
        existing = (
            await db.execute(select(AgencyStaff).where(AgencyStaff.user_id == user.id))
        ).scalar_one_or_none()
        if existing is None:
            db.add(AgencyStaff(user_id=user.id, role="owner", active=True))
        await db.commit()


async def _create_agency_client(client, name: str = "DraftCo") -> tuple[int, int]:
    resp = await client.post("/api/agency/clients", json={"name": name})
    assert resp.status_code == 201, resp.text
    body = resp.json()
    return body["id"], body["brand_id"]


@pytest.mark.asyncio
async def test_new_client_brand_type_is_agency(client, db_session):
    await _make_agency_user(client)
    _, brand_id = await _create_agency_client(client)
    brand = await db_session.get(Brand, brand_id)
    assert brand.brand_type == "agency"


@pytest.mark.asyncio
async def test_saas_brand_list_excludes_agency_brands(client, db_session):
    await _make_agency_user(client)
    # Create an agency brand
    await _create_agency_client(client, name="HiddenCo")
    # Also create a regular standard brand (via the SaaS brands endpoint)
    me = (await db_session.execute(select(User).where(User.email == "draft@example.com"))).scalar_one()
    db_session.add(Brand(name="VisibleCo", slug="visible-co", user_id=me.id, brand_type="standard"))
    await db_session.commit()

    resp = await client.get("/api/brands")
    assert resp.status_code == 200
    names = {b["name"] for b in resp.json()}
    assert "VisibleCo" in names
    assert "HiddenCo" not in names


@pytest.mark.asyncio
async def test_generate_draft_returns_201_with_mocked_llm(client, db_session):
    await _make_agency_user(client)
    cid, brand_id = await _create_agency_client(client)
    # Add a prompt to the brand
    db_session.add(Prompt(brand_id=brand_id, text="What is the best CRM for B2B SaaS?"))
    await db_session.commit()
    prompt = (await db_session.execute(select(Prompt).where(Prompt.brand_id == brand_id))).scalar_one()

    # Mock the LLM call that drafting service uses. We patch a high-level helper
    # so we don't need to know every internal call site.
    with patch(
        "app.services.drafting_service.generate_gap_draft",
        new=AsyncMock(
            return_value=type(
                "MockDraft",
                (),
                {
                    "id": 999,
                    "brand_id": brand_id,
                    "prompt_id": prompt.id,
                    "platform": "medium",
                    "status": "draft",
                    "title": "Mock title",
                    "content_text": "Mock body",
                    "content_brief": None,
                    "estimated_impact": None,
                    "source": "agency",
                    "assigned_to_user_id": None,
                    "created_at": None,
                    "updated_at": None,
                },
            )()
        ),
    ):
        resp = await client.post(
            f"/api/agency/clients/{cid}/drafts/generate",
            json={"prompt_id": prompt.id, "platform": "medium"},
        )
    assert resp.status_code == 201, resp.text
    body = resp.json()
    assert body["id"] == 999
    assert body["platform"] == "medium"

    # Activity event emitted
    events = (
        await db_session.execute(
            select(ClientActivityEvent).where(
                ClientActivityEvent.agency_client_id == cid,
                ClientActivityEvent.event_type == "draft_generated_by_staff",
            )
        )
    ).scalars().all()
    assert len(events) == 1


@pytest.mark.asyncio
async def test_generate_draft_rejects_unknown_prompt(client, db_session):
    await _make_agency_user(client)
    cid, _ = await _create_agency_client(client)
    resp = await client.post(
        f"/api/agency/clients/{cid}/drafts/generate",
        json={"prompt_id": 99999, "platform": "medium"},
    )
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_generate_draft_rejects_unsupported_platform(client, db_session):
    await _make_agency_user(client)
    cid, brand_id = await _create_agency_client(client)
    db_session.add(Prompt(brand_id=brand_id, text="Q?"))
    await db_session.commit()
    prompt = (await db_session.execute(select(Prompt).where(Prompt.brand_id == brand_id))).scalar_one()
    resp = await client.post(
        f"/api/agency/clients/{cid}/drafts/generate",
        json={"prompt_id": prompt.id, "platform": "bogusnet"},
    )
    assert resp.status_code == 422


@pytest.mark.asyncio
async def test_generate_draft_rejects_when_brand_not_agency_tier(client, db_session):
    await _make_agency_user(client)
    cid, brand_id = await _create_agency_client(client)
    # Flip the brand back to 'standard' (regression simulation)
    await db_session.execute(update(Brand).where(Brand.id == brand_id).values(brand_type="standard"))
    await db_session.commit()
    db_session.add(Prompt(brand_id=brand_id, text="Q?"))
    await db_session.commit()
    prompt = (await db_session.execute(select(Prompt).where(Prompt.brand_id == brand_id))).scalar_one()
    resp = await client.post(
        f"/api/agency/clients/{cid}/drafts/generate",
        json={"prompt_id": prompt.id, "platform": "medium"},
    )
    assert resp.status_code == 400
```

- [ ] **Step 2: Run tests**

```bash
cd /Users/ken/Desktop/Lumidian/backend
source venv/bin/activate
pytest tests/test_agency_drafting.py -v --timeout=60
```

Expected: all 6 tests PASS.

- [ ] **Step 3: Run the broader agency test suite to make sure nothing regressed**

```bash
pytest tests/test_agency.py tests/test_agency_activity.py tests/test_agency_tasks.py tests/test_agency_documents.py tests/test_review_public.py -v --timeout=60
```

Expected: all pass. If the existing `test_staff_can_create_and_list_clients` test in `test_agency.py` asserts on `brand_id` or any brand_type-dependent field, it should still pass because brand_type='agency' is what we ship.

- [ ] **Step 4: Commit**

```bash
git add backend/tests/test_agency_drafting.py
git commit -m "test(backend): agency drafting endpoint + brand_type filtering"
```

---

## Task 5: Frontend API method + drop "Open in Lumidian" link

**Files:**
- Modify: `frontend/lib/api.ts`
- Modify: `frontend/components/agency/LumidianTrackingWidget.tsx`

- [ ] **Step 1: Append API method**

In `frontend/lib/api.ts` at the end:

```typescript
// ── Agency drafting (sub-project E, 2026-05-13) ──────────────────────────────

export interface AgencyGenerateDraftIn {
  prompt_id: number;
  platform: string;
  custom_brief?: string;
}

export async function agencyGenerateDraft(
  clientId: number,
  body: AgencyGenerateDraftIn,
): Promise<ContentDraft> {
  const res = await api.post<ContentDraft>(
    `/agency/clients/${clientId}/drafts/generate`,
    body,
  );
  return res.data;
}
```

- [ ] **Step 2: Drop the "Open in Lumidian" link in `LumidianTrackingWidget.tsx`**

Open `frontend/components/agency/LumidianTrackingWidget.tsx`. Find the JSX block containing:
```tsx
<Link
  href={`/dashboard?brand=${brandId}`}
  className="text-xs text-[var(--text-muted)] hover:underline"
>
  Open in Lumidian →
</Link>
```

Delete it. The widget header should now show only the title, not the right-side link.

If the `Link` import becomes unused after this deletion, remove it from the imports.

- [ ] **Step 3: TS check**

```bash
cd /Users/ken/Desktop/Lumidian/frontend
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add frontend/lib/api.ts frontend/components/agency/LumidianTrackingWidget.tsx
git commit -m "feat(frontend): agencyGenerateDraft API method; drop Open in Lumidian link"
```

---

## Task 6: GenerateDraftButton component

**Files:**
- Create: `frontend/components/agency/GenerateDraftButton.tsx`

- [ ] **Step 1: Create the component**

```tsx
'use client';

import { useEffect, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { Loader2, Plus, X } from 'lucide-react';
import {
  agencyGenerateDraft,
  getBrand,
  type ContentDraft,
  type Prompt,
} from '@/lib/api';

interface Props {
  clientId: number;
  brandId: number | null;
  onGenerated: (draft: ContentDraft) => void;
}

const PLATFORMS: Array<{ value: string; label: string }> = [
  { value: 'medium', label: 'Medium' },
  { value: 'linkedin_post', label: 'LinkedIn post' },
  { value: 'reddit_post', label: 'Reddit post' },
  { value: 'reddit_reply', label: 'Reddit reply' },
  { value: 'quora', label: 'Quora' },
  { value: 'x_post', label: 'X post' },
  { value: 'wikipedia', label: 'Wikipedia' },
];

export function GenerateDraftButton({ clientId, brandId, onGenerated }: Props) {
  const [open, setOpen] = useState(false);
  const [prompts, setPrompts] = useState<Prompt[]>([]);
  const [promptId, setPromptId] = useState<number | ''>('');
  const [platform, setPlatform] = useState('medium');
  const [customBrief, setCustomBrief] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || brandId == null) return;
    setError(null);
    getBrand(brandId)
      .then((brand) => {
        setPrompts(brand.prompts ?? []);
        if (brand.prompts && brand.prompts.length > 0) {
          setPromptId(brand.prompts[0].id);
        }
      })
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load prompts'));
  }, [open, brandId]);

  const submit = async () => {
    if (promptId === '') return;
    setBusy(true);
    setError(null);
    try {
      const draft = await agencyGenerateDraft(clientId, {
        prompt_id: promptId,
        platform,
        custom_brief: customBrief.trim() || undefined,
      });
      onGenerated(draft);
      setOpen(false);
      setCustomBrief('');
    } catch (e) {
      const status = (e as { response?: { status?: number } })?.response?.status;
      if (status === 503) {
        setError('LLM unavailable. Check that ANTHROPIC_API_KEY is set on the backend.');
      } else {
        setError(e instanceof Error ? e.message : 'Draft generation failed');
      }
    } finally {
      setBusy(false);
    }
  };

  if (brandId == null) return null;

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger asChild>
        <button className="flex items-center gap-2 rounded-md bg-[var(--bg-elevated)] px-3 py-1.5 text-xs font-medium text-[var(--text-primary)] hover:bg-[var(--bg-card)]">
          <Plus className="h-3 w-3" />
          Generate draft
        </button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/60" />
        <Dialog.Content className="fixed left-1/2 top-1/2 w-[min(90vw,560px)] -translate-x-1/2 -translate-y-1/2 rounded-lg border border-[var(--border-default)] bg-[var(--bg-raised)] text-[var(--text-primary)] shadow-lg">
          <div className="flex items-start justify-between border-b border-[var(--border-subtle)] p-5">
            <Dialog.Title className="text-base font-semibold">Generate a draft</Dialog.Title>
            <Dialog.Close asChild>
              <button className="rounded-md border border-[var(--border-default)] p-2 hover:bg-[var(--bg-card)]">
                <X className="h-4 w-4" />
              </button>
            </Dialog.Close>
          </div>

          <div className="space-y-4 p-5">
            <div>
              <label className="mb-1 block text-xs text-[var(--text-secondary)]">Prompt</label>
              {prompts.length === 0 ? (
                <p className="text-sm text-[var(--text-muted)]">
                  No prompts on this brand yet. Add some on the Brand & prompts section first.
                </p>
              ) : (
                <select
                  value={promptId}
                  onChange={(e) =>
                    setPromptId(e.target.value === '' ? '' : parseInt(e.target.value, 10))
                  }
                  className="w-full rounded-md border border-[var(--border-default)] bg-[var(--bg-card)] px-3 py-2 text-sm"
                >
                  {prompts.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.text}
                    </option>
                  ))}
                </select>
              )}
            </div>

            <div>
              <label className="mb-1 block text-xs text-[var(--text-secondary)]">Platform</label>
              <select
                value={platform}
                onChange={(e) => setPlatform(e.target.value)}
                className="w-full rounded-md border border-[var(--border-default)] bg-[var(--bg-card)] px-3 py-2 text-sm"
              >
                {PLATFORMS.map((p) => (
                  <option key={p.value} value={p.value}>
                    {p.label}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="mb-1 block text-xs text-[var(--text-secondary)]">
                Custom brief (optional)
              </label>
              <textarea
                value={customBrief}
                onChange={(e) => setCustomBrief(e.target.value)}
                rows={3}
                placeholder="Steering for this specific draft, e.g. 'focus on the pricing comparison'"
                className="w-full rounded-md border border-[var(--border-default)] bg-[var(--bg-card)] px-3 py-2 text-sm"
              />
            </div>

            {error && <p className="text-sm text-red-400">{error}</p>}
          </div>

          <div className="flex items-center justify-end gap-2 border-t border-[var(--border-subtle)] p-4">
            <Dialog.Close asChild>
              <button className="rounded-md border border-[var(--border-default)] px-3 py-1.5 text-xs text-[var(--text-secondary)]">
                Cancel
              </button>
            </Dialog.Close>
            <button
              onClick={submit}
              disabled={busy || promptId === ''}
              className="flex items-center gap-2 rounded-md bg-[var(--bg-elevated)] px-3 py-1.5 text-xs font-medium text-[var(--text-primary)] hover:bg-[var(--bg-card)] disabled:opacity-50"
            >
              {busy && <Loader2 className="h-3 w-3 animate-spin" />}
              {busy ? 'Generating…' : 'Generate'}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
```

Note: `getBrand(brandId)` returns a `BrandDetail` with `prompts: Prompt[]`. The `Prompt` type is exported from `@/lib/api`.

- [ ] **Step 2: TS check**

```bash
cd /Users/ken/Desktop/Lumidian/frontend
npx tsc --noEmit
```

Expected: no errors. If `Prompt` isn't a named export from `@/lib/api`, look up the actual exported type for prompts (it might be `Prompt`, `PromptResponse`, etc.) and adjust the import.

- [ ] **Step 3: Commit**

```bash
git add frontend/components/agency/GenerateDraftButton.tsx
git commit -m "feat(frontend): GenerateDraftButton component"
```

---

## Task 7: Wire GenerateDraftButton into ClientCockpit

**Files:**
- Modify: `frontend/components/agency/ClientCockpit.tsx`

- [ ] **Step 1: Import + render**

In `frontend/components/agency/ClientCockpit.tsx`:

1. Add the import:
```tsx
import { GenerateDraftButton } from './GenerateDraftButton';
```

2. Find the Pipeline section header (around the `<section id="pipeline">` block). Currently:

```tsx
<section id="pipeline" className="scroll-mt-24">
  <h2 className="mb-3 text-sm font-medium text-[var(--text-secondary)]">Pipeline</h2>
  <ClientPipelineTab
    key={pipelineRefreshKey}
    brandId={client.brand_id}
    reviewLinkUrl={reviewLinkUrl}
    primaryContactName={client.primary_contact_name}
  />
</section>
```

Replace with:

```tsx
<section id="pipeline" className="scroll-mt-24">
  <div className="mb-3 flex items-center justify-between">
    <h2 className="text-sm font-medium text-[var(--text-secondary)]">Pipeline</h2>
    <GenerateDraftButton
      clientId={client.id}
      brandId={client.brand_id}
      onGenerated={() => setPipelineRefreshKey((k) => k + 1)}
    />
  </div>
  <ClientPipelineTab
    key={pipelineRefreshKey}
    brandId={client.brand_id}
    reviewLinkUrl={reviewLinkUrl}
    primaryContactName={client.primary_contact_name}
  />
</section>
```

- [ ] **Step 2: TS check**

```bash
cd /Users/ken/Desktop/Lumidian/frontend
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add frontend/components/agency/ClientCockpit.tsx
git commit -m "feat(frontend): wire GenerateDraftButton into cockpit Pipeline section"
```

---

## Task 8: Smoke

**Files:** None — manual + API verification.

- [ ] **Step 1: Start dev servers**

Terminal 1: `cd backend && source venv/bin/activate && uvicorn app.main:app --port 3001`
Terminal 2: `cd frontend && npm run dev -- -p 3002`

- [ ] **Step 2: API smoke**

```bash
cd /Users/ken/Desktop/Lumidian/backend && source venv/bin/activate && python <<'PY'
import asyncio, httpx
async def m():
    async with httpx.AsyncClient(base_url="http://localhost:3001", timeout=120.0) as c:
        r = await c.post("/api/auth/login", json={"email": "ken@lumidian.ai", "password": "bat422Tuw!"})
        cookie = r.cookies
        # Create client → confirm brand_type='agency'
        r = await c.post("/api/agency/clients", cookies=cookie, json={"name": "DE-Smoke"})
        cid = r.json()["id"]
        brand_id = r.json()["brand_id"]
        # Saas brand list should NOT include this brand
        r = await c.get("/api/brands", cookies=cookie)
        names = [b["name"] for b in r.json()]
        assert "DE-Smoke" not in names, f"agency brand leaked into SaaS list: {names}"
        print(f"OK: agency brand hidden from SaaS list ({len(names)} SaaS brands visible)")
        # Add a prompt
        r = await c.post(f"/api/brands/{brand_id}/prompts", cookies=cookie, json={"text": "What is the best CRM?"})
        prompt_id = r.json()["id"]
        # Generate a draft (real LLM call)
        r = await c.post(f"/api/agency/clients/{cid}/drafts/generate", cookies=cookie, json={"prompt_id": prompt_id, "platform": "medium"})
        if r.status_code == 201:
            d = r.json()
            print(f"OK: draft generated id={d['id']} platform={d['platform']} body_len={len(d.get('content_text',''))}")
        else:
            print(f"FAIL draft gen: {r.status_code} {r.text[:200]}")
        # Check the activity event
        r = await c.get(f"/api/agency/clients/{cid}/activity", cookies=cookie)
        types = [e["event_type"] for e in r.json()]
        assert "draft_generated_by_staff" in types
        print(f"OK: draft_generated_by_staff event emitted; full events: {types}")
        # Cleanup
        await c.delete(f"/api/agency/clients/{cid}", cookies=cookie)
asyncio.run(m())
PY
```

Expected: prints "OK" for each check. Brand hidden from SaaS, draft generated, event emitted.

- [ ] **Step 3: Stop servers**

Ctrl+C in both terminals. No commit.

---

## Self-Review

- Spec §D.1 (auto-set agency type): Task 1 ✓
- Spec §D.2 (hide from SaaS list endpoints): Task 1 ✓
- Spec §D.3 (drop "Open in Lumidian"): Task 5 ✓
- Spec §E.4 (drafting endpoint): Task 3 ✓
- Spec §E.5 (cockpit button): Tasks 6, 7 ✓
- Bypass tier checks: Task 3 (by routing through `generate_gap_draft` directly, skipping `routers/content.py` checks) ✓
- Backend tests cover: brand_type set, SaaS list excludes agency, generate succeeds (mocked LLM), unknown prompt 404, bad platform 422, brand-not-agency-tier 400 ✓
- No placeholders; all code blocks complete.

The `generate_gap_draft` signature used in Task 3 matches what `routers/content.py:create_draft` calls. If the agency endpoint hits issues (signature mismatch, missing arg), the implementer should report DONE_WITH_CONCERNS and we'll adjust.
