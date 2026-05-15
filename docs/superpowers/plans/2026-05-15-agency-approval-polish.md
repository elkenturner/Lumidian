# Agency Approval Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development.

**Goal:** Sub-project I-polish — record post URLs in `ContentPost` when staff marks a draft posted, and add a mailto button to the send-drafts message stage.

**Architecture:** New backend endpoint `POST /api/agency/drafts/{id}/mark-posted` that creates a `ContentPost` row alongside the status flip. New `MarkPostedModal` Radix dialog. New activity event constant. Mailto link wired in the existing `SendDraftsToClientModal` message stage, plumbing `primaryContactEmail` down from `ClientQuickActionsRail`.

**Tech Stack:** FastAPI, SQLAlchemy async, pytest. Next.js, React, Tailwind, Radix Dialog.

**Spec:** `docs/superpowers/specs/2026-05-15-agency-approval-polish-design.md`

---

## Task 1: Backend mark-posted endpoint + activity constant

**Files:**
- Modify: `backend/app/routers/agency.py`
- Modify: `backend/app/schemas.py`
- Modify: `backend/app/services/agency_activity.py`

- [ ] **Step 1: Add `EVENT_DRAFT_MARKED_POSTED` constant**

In `backend/app/services/agency_activity.py`, add near the other `EVENT_*` constants:

```python
EVENT_DRAFT_MARKED_POSTED = "draft_marked_posted"
```

- [ ] **Step 2: Add `MarkPostedIn` schema**

In `backend/app/schemas.py`, add (place near other agency-related schemas like `AgencyDraftGenerateIn`):

```python
class MarkPostedIn(BaseModel):
    post_url: str | None = Field(default=None, max_length=1000)
```

- [ ] **Step 3: Add the endpoint to `backend/app/routers/agency.py`**

First, check existing imports — `ContentPost`, `Brand`, `datetime`, `emit_event` must all be importable. Read the existing import block at the top and add anything missing:

```bash
grep -n "ContentPost\|from datetime\|from app.models import" /Users/ken/Desktop/Lumidian/backend/app/routers/agency.py | head -10
```

Then append the endpoint near the other draft-related endpoints (look for `agency_generate_draft` or similar). Add:

```python
@router.post("/drafts/{draft_id}/mark-posted", response_model=DraftOut)
async def mark_draft_posted(
    draft_id: int,
    body: MarkPostedIn,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_agency_staff),
):
    """Flip a draft to 'posted', set posted_at, create a ContentPost row. Agency-only."""
    draft = await db.get(ContentDraft, draft_id)
    if draft is None:
        raise HTTPException(status_code=404, detail="Draft not found")
    brand = await db.get(Brand, draft.brand_id)
    if brand is None or brand.agency_client_id is None:
        raise HTTPException(status_code=400, detail="Draft is not on an agency brand")
    if draft.status == "posted":
        return _draft_to_out(draft)
    if draft.status != "approved":
        raise HTTPException(
            status_code=http_status.HTTP_409_CONFLICT,
            detail=f"Draft must be 'approved' to mark as posted (current: {draft.status})",
        )
    now = datetime.utcnow()
    draft.status = "posted"
    draft.posted_at = now
    db.add(
        ContentPost(
            draft_id=draft.id,
            platform=draft.platform,
            post_url=body.post_url,
            posted_at=now,
        )
    )
    await emit_event(
        db,
        agency_client_id=brand.agency_client_id,
        event_type=EVENT_DRAFT_MARKED_POSTED,
        body=draft.title or f"Draft #{draft.id}",
        actor_user_id=user.id,
        related_draft_id=draft.id,
        payload={"post_url": body.post_url, "platform": draft.platform},
    )
    await db.commit()
    await db.refresh(draft)
    return _draft_to_out(draft)
```

Ensure these imports are present at the top of the file (add only what's missing):
```python
from datetime import datetime
from app.models import ContentPost  # add to existing models import line
from app.schemas import MarkPostedIn  # add to existing schemas import line
from app.services.agency_activity import EVENT_DRAFT_MARKED_POSTED  # add to existing line
```

**Verify the existing `_draft_to_out` helper signature** with a quick grep — pass a `ContentDraft` and it returns a `DraftOut`. If the signature differs (e.g. requires db), adapt the call.

- [ ] **Step 4: Verify route registers**

```bash
cd /Users/ken/Desktop/Lumidian/backend
source venv/bin/activate
python -c "from app.main import app
for r in app.routes:
    p = str(getattr(r, 'path', ''))
    if 'mark-posted' in p:
        print(p, list(getattr(r, 'methods', [])))"
```

Expected: `/api/agency/drafts/{draft_id}/mark-posted ['POST']`

- [ ] **Step 5: Commit**

```bash
git add backend/app/routers/agency.py backend/app/schemas.py backend/app/services/agency_activity.py
git commit -m "feat(backend): agency mark-posted endpoint (creates ContentPost row)"
```

---

## Task 2: Backend tests

**Files:** Create `backend/tests/test_agency_mark_posted.py`

- [ ] **Step 1: Create the test file**

Use the `_make_agency_user` / `_create_agency_client` helpers from `tests/test_agency_tracking.py` (known-working pattern). Tests:

```python
"""Tests for the agency mark-posted endpoint."""
from __future__ import annotations

import pytest
from sqlalchemy import select, update

from app.database import AsyncSessionLocal
from app.models import (
    AgencyStaff,
    Brand,
    ContentDraft,
    ContentPost,
    Prompt,
    User,
)
from tests.conftest import register_and_login


async def _make_agency_user(client, email: str = "mp@example.com") -> None:
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


async def _create_agency_client(client, name: str = "MPCo") -> tuple[int, int]:
    resp = await client.post("/api/agency/clients", json={"name": name})
    assert resp.status_code == 201, resp.text
    body = resp.json()
    return body["id"], body["brand_id"]


async def _create_approved_draft(brand_id: int, platform: str = "linkedin") -> int:
    async with AsyncSessionLocal() as db:
        prompt = Prompt(brand_id=brand_id, text="test", prompt_type="standard")
        db.add(prompt)
        await db.flush()
        d = ContentDraft(
            brand_id=brand_id,
            prompt_id=prompt.id,
            platform=platform,
            status="approved",
            title="My draft",
            content_text="body",
            source="manual",
        )
        db.add(d)
        await db.commit()
        return d.id


@pytest.mark.asyncio
async def test_mark_posted_with_url(client):
    await _make_agency_user(client)
    _cid, bid = await _create_agency_client(client)
    draft_id = await _create_approved_draft(bid)
    resp = await client.post(
        f"/api/agency/drafts/{draft_id}/mark-posted",
        json={"post_url": "https://linkedin.com/posts/12345"},
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["status"] == "posted"
    async with AsyncSessionLocal() as db:
        post_q = await db.execute(select(ContentPost).where(ContentPost.draft_id == draft_id))
        posts = post_q.scalars().all()
        assert len(posts) == 1
        assert posts[0].post_url == "https://linkedin.com/posts/12345"
        assert posts[0].platform == "linkedin"


@pytest.mark.asyncio
async def test_mark_posted_without_url(client):
    await _make_agency_user(client, email="mp2@example.com")
    _cid, bid = await _create_agency_client(client, name="MPCo2")
    draft_id = await _create_approved_draft(bid)
    resp = await client.post(
        f"/api/agency/drafts/{draft_id}/mark-posted",
        json={},
    )
    assert resp.status_code == 200, resp.text
    async with AsyncSessionLocal() as db:
        post_q = await db.execute(select(ContentPost).where(ContentPost.draft_id == draft_id))
        post = post_q.scalar_one()
        assert post.post_url is None


@pytest.mark.asyncio
async def test_mark_posted_non_approved_returns_409(client):
    await _make_agency_user(client, email="mp3@example.com")
    _cid, bid = await _create_agency_client(client, name="MPCo3")
    async with AsyncSessionLocal() as db:
        prompt = Prompt(brand_id=bid, text="test", prompt_type="standard")
        db.add(prompt)
        await db.flush()
        d = ContentDraft(
            brand_id=bid,
            prompt_id=prompt.id,
            platform="linkedin",
            status="draft",
            title="t",
            content_text="b",
            source="manual",
        )
        db.add(d)
        await db.commit()
        draft_id = d.id
    resp = await client.post(f"/api/agency/drafts/{draft_id}/mark-posted", json={})
    assert resp.status_code == 409


@pytest.mark.asyncio
async def test_mark_posted_non_agency_brand_returns_400(client, db_session):
    await _make_agency_user(client, email="mp4@example.com")
    _cid, bid = await _create_agency_client(client, name="MPCo4")
    # Flip the brand off agency-tier
    await db_session.execute(update(Brand).where(Brand.id == bid).values(agency_client_id=None))
    await db_session.commit()
    draft_id = await _create_approved_draft(bid)
    resp = await client.post(f"/api/agency/drafts/{draft_id}/mark-posted", json={})
    assert resp.status_code == 400


@pytest.mark.asyncio
async def test_mark_posted_idempotent(client):
    await _make_agency_user(client, email="mp5@example.com")
    _cid, bid = await _create_agency_client(client, name="MPCo5")
    draft_id = await _create_approved_draft(bid)
    r1 = await client.post(
        f"/api/agency/drafts/{draft_id}/mark-posted", json={"post_url": "https://x.com/1"}
    )
    assert r1.status_code == 200
    r2 = await client.post(
        f"/api/agency/drafts/{draft_id}/mark-posted", json={"post_url": "https://x.com/2"}
    )
    assert r2.status_code == 200
    async with AsyncSessionLocal() as db:
        post_q = await db.execute(select(ContentPost).where(ContentPost.draft_id == draft_id))
        # Only 1 ContentPost row should exist (second call was idempotent)
        assert len(post_q.scalars().all()) == 1


@pytest.mark.asyncio
async def test_mark_posted_unknown_draft_404(client):
    await _make_agency_user(client, email="mp6@example.com")
    resp = await client.post("/api/agency/drafts/99999/mark-posted", json={})
    assert resp.status_code == 404
```

- [ ] **Step 2: Run the tests**

```bash
cd /Users/ken/Desktop/Lumidian/backend
source venv/bin/activate
pytest tests/test_agency_mark_posted.py -v --timeout=60
```

Expected: 6 PASS. If a field name is wrong (e.g., `ContentDraft` constructor field mismatch), check `models.py` and adjust the test.

- [ ] **Step 3: Regression check**

```bash
pytest tests/test_agency.py tests/test_agency_drafting.py tests/test_agency_tracking.py tests/test_agency_weekly_report.py tests/test_review_public.py -q --timeout=60
```

Expected: all pass.

- [ ] **Step 4: Commit**

```bash
git add backend/tests/test_agency_mark_posted.py
git commit -m "test(backend): mark-posted endpoint (6 tests)"
```

---

## Task 3: Frontend API helper

**Files:** Modify `frontend/lib/api.ts`

- [ ] **Step 1: Add the helper**

Append near other `agency*` helpers (search for `agencyTriggerTracking` to find the cluster):

```typescript
export async function agencyMarkDraftPosted(
  draftId: number,
  postUrl?: string,
): Promise<ContentDraft> {
  const res = await api.post<ContentDraft>(`/agency/drafts/${draftId}/mark-posted`, {
    post_url: postUrl ?? null,
  });
  return res.data;
}
```

- [ ] **Step 2: TS check**

```bash
cd /Users/ken/Desktop/Lumidian/frontend
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add frontend/lib/api.ts
git commit -m "feat(frontend): agencyMarkDraftPosted helper"
```

---

## Task 4: MarkPostedModal component

**Files:** Create `frontend/components/agency/MarkPostedModal.tsx`

- [ ] **Step 1: Create the component**

```tsx
'use client';

import { useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { CheckCircle2, Link as LinkIcon, X } from 'lucide-react';
import { agencyMarkDraftPosted, type ContentDraft } from '@/lib/api';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  draft: ContentDraft;
  onPosted: (draft: ContentDraft) => void;
}

export function MarkPostedModal({ open, onOpenChange, draft, onPosted }: Props) {
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (withUrl: boolean) => {
    setBusy(true);
    setError(null);
    try {
      const trimmed = withUrl ? url.trim() : '';
      const updated = await agencyMarkDraftPosted(draft.id, trimmed || undefined);
      onPosted(updated);
      onOpenChange(false);
      setUrl('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to mark as posted');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/60" />
        <Dialog.Content className="fixed left-1/2 top-1/2 w-[min(90vw,520px)] -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-lg border border-[var(--border-default)] bg-[var(--bg-raised)] text-[var(--text-primary)] shadow-lg">
          <div className="flex items-start justify-between border-b border-[var(--border-subtle)] p-5">
            <Dialog.Title className="text-base font-semibold">
              Where did you post this?
            </Dialog.Title>
            <Dialog.Close asChild>
              <button className="rounded-md border border-[var(--border-default)] p-2 hover:bg-[var(--bg-card)]">
                <X className="h-4 w-4" />
              </button>
            </Dialog.Close>
          </div>

          <div className="p-5">
            <p className="mb-3 text-xs text-[var(--text-muted)]">
              Paste the live URL of the published post. We use this for the activity log and
              attribution. You can skip if you don&apos;t have it handy.
            </p>

            <div className="flex items-center gap-2 rounded-md border border-[var(--border-default)] bg-[var(--bg-card)] px-3 py-2">
              <LinkIcon className="h-4 w-4 shrink-0 text-[var(--text-muted)]" />
              <input
                type="url"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder={`https://${draft.platform}.com/…`}
                autoFocus
                className="w-full bg-transparent text-sm outline-none placeholder:text-[var(--text-muted)]"
              />
            </div>

            {error && <p className="mt-3 text-xs text-red-400">{error}</p>}
          </div>

          <div className="flex items-center justify-end gap-2 border-t border-[var(--border-subtle)] p-4">
            <button
              onClick={() => submit(false)}
              disabled={busy}
              className="rounded-md border border-[var(--border-default)] px-3 py-1.5 text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-card)] disabled:opacity-50"
            >
              Skip URL
            </button>
            <button
              onClick={() => submit(true)}
              disabled={busy || !url.trim()}
              className="flex items-center gap-1 rounded-md bg-[var(--bg-elevated)] px-3 py-1.5 text-xs font-medium text-[var(--text-primary)] hover:bg-[var(--bg-card)] disabled:opacity-50"
            >
              <CheckCircle2 className="h-3 w-3" />
              {busy ? 'Saving…' : 'Mark as posted'}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
```

- [ ] **Step 2: TS check**

```bash
cd /Users/ken/Desktop/Lumidian/frontend
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add frontend/components/agency/MarkPostedModal.tsx
git commit -m "feat(frontend): MarkPostedModal — capture post URL on mark-posted"
```

---

## Task 5: Wire `MarkPostedModal` into `ClientPipelineTab.tsx`

**Files:** Modify `frontend/components/agency/ClientPipelineTab.tsx`

- [ ] **Step 1: Replace `DraftActions` per-draft "Mark as posted" with modal-opening button**

Read the current `DraftActions` component (around line 33). Replace the `if (draft.status === 'approved')` block. The new behavior: clicking the button opens `MarkPostedModal`; on success, `onChange` updates the local draft state to reflect the new status.

Add an `import { MarkPostedModal } from './MarkPostedModal';` and `import { useState } from 'react';` (the latter is likely already imported).

The replaced `DraftActions` should become (only the approved branch changes):

```tsx
function DraftActions({ draft, onChange }: DraftActionsProps) {
  const [busy, setBusy] = useState(false);
  const [postModalOpen, setPostModalOpen] = useState(false);

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
      <>
        <button
          onClick={() => setPostModalOpen(true)}
          className="mt-2 rounded-md border border-[var(--border-default)] px-2 py-1 text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-raised)]"
        >
          Mark as posted
        </button>
        <MarkPostedModal
          open={postModalOpen}
          onOpenChange={setPostModalOpen}
          draft={draft as unknown as ContentDraft}
          onPosted={(updated) => onChange({ status: updated.status, posted_at: updated.posted_at })}
        />
      </>
    );
  }
  return null;
}
```

You may need to add `ContentDraft` to the import from `@/lib/api`. The cast is required because the local `AgencyDraft` type widens `status` to `string`.

- [ ] **Step 2: TS check**

```bash
cd /Users/ken/Desktop/Lumidian/frontend
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add frontend/components/agency/ClientPipelineTab.tsx
git commit -m "feat(frontend): open MarkPostedModal on approved drafts in pipeline"
```

---

## Task 6: Mailto button in SendDraftsToClientModal

**Files:**
- Modify: `frontend/components/agency/SendDraftsToClientModal.tsx`
- Modify: `frontend/components/agency/ClientQuickActionsRail.tsx`

- [ ] **Step 1: Add `primaryContactEmail` prop to `SendDraftsToClientModal`**

In `frontend/components/agency/SendDraftsToClientModal.tsx`:

1. Add to the Props interface:
```tsx
primaryContactEmail: string | null;
```

2. Destructure it in the component signature.

3. Add to imports: `import { Copy, Mail, Send, X } from 'lucide-react';` (add `Mail`).

4. In the `stage === 'message'` footer block, insert the mailto link BEFORE the existing "Open review page" link:

```tsx
{primaryContactEmail && (
  <a
    href={`mailto:${encodeURIComponent(primaryContactEmail)}?subject=${encodeURIComponent(
      `Drafts ready for review — ${clientName}`,
    )}&body=${encodeURIComponent(messageText)}`}
    className="flex items-center gap-1 rounded-md bg-[var(--bg-elevated)] px-3 py-1.5 text-xs font-medium text-[var(--text-primary)] hover:bg-[var(--bg-card)]"
  >
    <Mail className="h-3 w-3" />
    Compose email
  </a>
)}
```

- [ ] **Step 2: Plumb `primaryContactEmail` from `ClientQuickActionsRail.tsx`**

Read the current usage of `<SendDraftsToClientModal ... />` in `ClientQuickActionsRail.tsx` (around line 89). Add `primaryContactEmail={client.primary_contact_email ?? null}` to the props.

The rail already has access to the client object (it's passed in via props); verify the field name on the client object — it's `primary_contact_email` per the backend model.

- [ ] **Step 3: TS check**

```bash
cd /Users/ken/Desktop/Lumidian/frontend
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add frontend/components/agency/SendDraftsToClientModal.tsx frontend/components/agency/ClientQuickActionsRail.tsx
git commit -m "feat(frontend): mailto Compose email button in send-drafts modal"
```

---

## Task 7: Smoke

**Files:** None — verification only.

- [ ] **Step 1: Backend smoke (curl)**

```bash
cd /Users/ken/Desktop/Lumidian/backend && source venv/bin/activate
nohup uvicorn app.main:app --port 3001 > /tmp/i-be.log 2>&1 &
sleep 6
python3 <<'PY'
import asyncio, httpx
async def m():
    async with httpx.AsyncClient(base_url="http://localhost:3001", timeout=30.0) as c:
        r = await c.post("/api/auth/login", json={"email": "ken@lumidian.ai", "password": "bat422Tuw!"})
        assert r.status_code == 200, r.text
        cookie = r.cookies
        r = await c.post("/api/agency/clients", cookies=cookie, json={"name": "I-Smoke"})
        cid = r.json()["id"]
        bid = r.json()["brand_id"]
        # Mark-posted with bogus draft id → 404
        r = await c.post("/api/agency/drafts/99999/mark-posted", cookies=cookie, json={})
        print(f"bogus mark-posted: {r.status_code}")
        assert r.status_code == 404
        # Cleanup
        d = await c.delete(f"/api/agency/clients/{cid}", cookies=cookie)
        print(f"cleanup: {d.status_code}")
        print("OK")
asyncio.run(m())
PY
pkill -f "uvicorn app.main:app --port 3001" 2>/dev/null
```

Expected: bogus mark-posted returns 404 (proves the endpoint is registered and reachable).

No commit. Manual verification only.

---

## Self-Review

- Spec §1 (mark-posted endpoint): Task 1 ✓
- Spec §2 (activity event constant): Task 1 Step 1 ✓
- Spec §3 (MarkPostedIn schema): Task 1 Step 2 ✓
- Spec frontend §1 (API helper): Task 3 ✓
- Spec frontend §2 (MarkPostedModal component): Task 4 ✓
- Spec frontend §3 (wire into pipeline): Task 5 ✓
- Spec frontend §4 (mailto button): Task 6 ✓
- Spec testing: Task 2 covers all 6 listed cases ✓
- All code blocks complete. No placeholders.
