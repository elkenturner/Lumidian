# Agency Approval Polish — Design

**Date:** 2026-05-15
**Status:** Approved (autonomous mode). Sub-project I-polish of the agency-portal-OS roadmap.

---

## Context

The end-to-end approval flow already works (D+E shipped Pipeline kanban + `SendDraftsToClientModal`; review_public.py already handles client-facing approve/changes/reject). Two small gaps remain in the day-to-day staff workflow:

1. **"Mark as posted" doesn't record where the draft was actually posted.** The current per-draft button flips `status='posted'` and sets `posted_at` but never creates a `ContentPost` row. Result: no post-URL audit trail; staff has no way to look back and see "where did this draft land."
2. **The send-drafts message stage has copy-paste only.** No `mailto:` link, so staff has to manually compose an email in their client and paste the message.

Both are tiny but matter for the daily flow.

## Goals

1. Replace the per-draft "Mark as posted" single-click with a tiny modal that optionally takes a post URL and creates a `ContentPost` row.
2. Add a "Compose email" `mailto:` link to the send-drafts message stage, prefilled with the client's primary contact email + a default subject + the message body.

## Non-Goals

- No batch "mark as posted" — one at a time is fine.
- No fancy URL validation — accept any non-empty string; staff is trusted.
- No SMTP send from inside the app — Ken explicitly said manual email for now.
- No tracking of `platform_post_id` for v1 (we leave the column nullable; could come later).

## Data Model

No schema changes. `ContentPost` already exists with `draft_id`, `platform`, `post_url`, `posted_at` (see `models.py:422`). We just start populating it.

## Backend

### New endpoint: `POST /api/agency/drafts/{draft_id}/mark-posted`

In `backend/app/routers/agency.py`:

```python
class MarkPostedIn(BaseModel):  # add to schemas.py
    post_url: str | None = Field(default=None, max_length=1000)


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
    # Confirm this draft is for an agency client
    brand = await db.get(Brand, draft.brand_id)
    if brand is None or brand.agency_client_id is None:
        raise HTTPException(status_code=400, detail="Draft is not on an agency brand")
    if draft.status == "posted":
        # Idempotent — return current state
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
        event_type="draft_marked_posted",  # add constant in agency_activity.py
        body=draft.title or f"Draft #{draft.id}",
        actor_user_id=user.id,
        related_draft_id=draft.id,
        payload={"post_url": body.post_url, "platform": draft.platform},
    )
    await db.commit()
    await db.refresh(draft)
    return _draft_to_out(draft)
```

Note `_draft_to_out` already exists in agency.py — reuse it.

### Activity constant

In `backend/app/services/agency_activity.py`, add:

```python
EVENT_DRAFT_MARKED_POSTED = "draft_marked_posted"
```

(Used by name in the endpoint above.)

## Frontend

### 1. New API method

In `frontend/lib/api.ts`, near other `agency*` helpers:

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

### 2. New `MarkPostedModal` component

`frontend/components/agency/MarkPostedModal.tsx` — Radix `Dialog` with:
- Title: "Where did you post this?"
- Single text input for `post_url` (optional, autofocused)
- Helper text: "Optional — paste the live URL of the published post. We use this for attribution and the activity log."
- Two buttons: "Skip URL" (submits with empty URL) and "Mark as posted" (submits with whatever's in the field)
- Calls `agencyMarkDraftPosted(draftId, urlOrUndefined)` on submit
- On success: closes + calls `onPosted(draft)` so the parent can update local state

Props: `{ open, onOpenChange, draft: ContentDraft, onPosted: (draft: ContentDraft) => void }`.

Use the same visual pattern as `SendDraftsToClientModal` for consistency.

### 3. Wire into `ClientPipelineTab.tsx`

In the `DraftActions` component (the `if (draft.status === 'approved')` branch), replace the single-click button with one that opens the new modal. The post-success handler calls `onChange({ status: 'posted', posted_at: now })` so the card moves to the Done column locally.

### 4. Mailto button in `SendDraftsToClientModal.tsx`

The modal already receives `primaryContactName`. Add `primaryContactEmail: string | null` to its props and thread it through from `ClientQuickActionsRail.tsx` (where the modal is rendered — it has access to the client object).

In the `stage === 'message'` footer, alongside the existing "Open review page" and "Copy message" buttons, add:

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

Import `Mail` from `lucide-react`. If `primaryContactEmail` is null, hide the button (the copy-paste path still works).

## Testing

- Backend test: POST `/mark-posted` on an approved agency draft → 200, status flips to posted, `ContentPost` row created, activity event emitted.
- Backend test: POST `/mark-posted` with no body → 200, ContentPost has `post_url=null`.
- Backend test: POST `/mark-posted` on a non-approved draft → 409.
- Backend test: POST `/mark-posted` on a non-agency draft (brand_type='standard') → 400.
- Backend test: POST `/mark-posted` twice → second call is idempotent (returns posted state).
- Backend test: POST `/mark-posted` on an unknown draft id → 404.

## Risks

- **Existing per-draft PATCH that flips to posted** (the generic `agencyUpdateDraftStatus` route) is now bypassed by the new modal — but the PATCH route still works for any callers that use it. The modal becomes the preferred path; we don't deprecate the old route.
- **ContentPost creation duplicates if staff hits the modal twice quickly** — mitigated by the idempotent early-return when status is already posted.
- **Missing platform_post_id** — out of scope for v1; column stays nullable.

## Out of scope (becomes future polish)

- Capturing `platform_post_id` (e.g., extracting the post ID from the URL)
- Edit-after-post (changing the URL later)
- Auto-post from the cockpit
