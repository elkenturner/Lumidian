# Agency Brand Tier + Drafting Inside Cockpit — Design

**Date:** 2026-05-13
**Status:** Approved (autonomous mode). Sub-projects D + E of the agency-portal-OS roadmap.

---

## Context

Agency portal currently shows drafts but doesn't generate them — staff still have to use the SaaS `/content` flow. Agency brands are regular `Brand` rows that show up in the SaaS user's brand switcher alongside personal brands. This is the source of the "two dashboards bleeding into each other" friction.

This sub-project introduces a fourth brand type — `agency` — and makes the agency portal self-sufficient for drafting.

## Goals

1. New `brand_type='agency'` value. Auto-set when a client is created in `/agency`.
2. Agency brands hidden from SaaS UI: `GET /api/brands` and `GET /api/brands/with-stats` exclude them.
3. "Open in Lumidian" link removed from `LumidianTrackingWidget` (agency staff never need to leave `/agency`).
4. New endpoint `POST /api/agency/clients/{client_id}/drafts/generate` — staff-tier draft generation, bypasses SaaS tier checks.
5. "Generate drafts" button at the top of the cockpit's Pipeline section. Modal lets staff pick a prompt + platform + optional brief, fires the new endpoint.

## Non-Goals (this sub-project)

- Drafting-cadence changes (no scheduled auto-drafting for agency brands).
- Bulk-generate-N-drafts-at-once (one-at-a-time for v1 — Ken can click multiple times).
- Tracking changes (sub-project F).
- Comprehensive reports (sub-project G).
- Backend schema changes — `brand_type` is already a free-text varchar; no migration.

## Data Model

No schema changes. The existing `Brand.brand_type` column accepts `'agency'` as a value alongside `'standard'`, `'pitch'`, `'pro'`.

## Backend

### 1. Agency-tier brand creation

Modify `backend/app/routers/agency.py`'s `create_client` function. Currently:

```python
brand = Brand(
    name=body.name.strip(),
    slug=f"agency-{slug}",
    user_id=user.id,
    agency_client_id=client.id,
    brand_type="standard",
)
```

Change `brand_type="standard"` → `brand_type="agency"`.

### 2. Hide agency brands from SaaS list endpoints

In `backend/app/routers/brands.py`:

- `list_brands_with_stats` (around line 120) — add `.where(Brand.brand_type != 'agency')` to the existing query
- `list_brands` (around line 197) — same

This affects only the cross-brand list views. Direct fetch of a specific brand (`GET /api/brands/{id}`) is unchanged — admin staff can still hit it by id if needed; no need to actively block.

### 3. New drafting endpoint

Add to `backend/app/routers/agency.py`:

`POST /api/agency/clients/{client_id}/drafts/generate`

Body schema (`AgencyDraftGenerateIn`):
- `prompt_id: int` (required) — must belong to the client's brand
- `platform: str` (required) — same platforms the existing drafting service supports (medium / linkedin / reddit_post / etc.)
- `custom_brief: str | None = None`

Behavior:
1. Resolve client → brand
2. Verify brand has `brand_type='agency'`
3. Verify prompt belongs to brand
4. Call existing `services/drafting_service.generate_draft(brand_id, ...)` — but inside the agency context, bypass tier limits (see Step 4 below)
5. Emit `draft_generated_by_staff` activity event with prompt + platform in payload
6. Return the new `ContentDraft` row

Returns: `ContentDraftSchema` (existing). Status 201.

### 4. Bypass tier checks for agency-tier brands

In `services/drafting_service.py` and any helper that gates on `user.subscription_tier`, add a fast-path: if the calling brand has `brand_type='agency'`, treat the request as if the caller has Pro tier (no rate limits, no daily caps, no platform-paid checks). This is safe because agency-tier brands are only created via `/api/agency/*` endpoints, which already require `is_agency_staff || is_admin`.

Implementation: add a small helper `_is_agency_brand(brand: Brand) -> bool` in `drafting_service.py`. Wherever tier checks happen, short-circuit when `_is_agency_brand(brand)`.

### 5. Activity event constant

In `app/services/agency_activity.py`, add:
```python
EVENT_DRAFT_GENERATED_BY_STAFF = "draft_generated_by_staff"
```

### 6. Pydantic schema

Add to `app/schemas.py`:
```python
class AgencyDraftGenerateIn(BaseModel):
    prompt_id: int
    platform: str = Field(min_length=1, max_length=64)
    custom_brief: str | None = Field(default=None, max_length=2000)
```

## Frontend

### 1. Drop the "Open in Lumidian" link

In `frontend/components/agency/LumidianTrackingWidget.tsx`, remove the `<Link href="...dashboard?brand=...">Open in Lumidian →</Link>`. Agency staff don't need to leave `/agency`.

### 2. New API client method

In `frontend/lib/api.ts`:

```typescript
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

### 3. GenerateDraftButton component

New `frontend/components/agency/GenerateDraftButton.tsx`:

- Renders as a "Generate draft" button.
- Opens a modal with three inputs:
  - **Prompt** — dropdown populated from the client's brand prompts
  - **Platform** — dropdown with the same options used elsewhere (`medium`, `linkedin_post`, `reddit_post`, `quora`, `x_post`, `wikipedia`)
  - **Custom brief** (optional textarea, 0-2000 chars) — passed through to the drafting service for steering
- Submit → calls `agencyGenerateDraft(clientId, ...)`.
- Loading state during the LLM call (10-30s).
- On 201: closes modal, calls `onGenerated(draft)` so the parent can refresh Pipeline.
- On 503: friendly "LLM unavailable" message.

Props: `{ clientId: number; brandId: number; onGenerated: (draft: ContentDraft) => void }`.

The prompts list is fetched on modal open via the existing `getBrand(brandId)` (which returns the brand including prompts) or a dedicated prompts call if cleaner.

### 4. Wire into cockpit Pipeline

In `frontend/components/agency/ClientCockpit.tsx`, in the Pipeline section header, render `<GenerateDraftButton clientId={client.id} brandId={client.brand_id} onGenerated={...} />` alongside the section title.

On generated → bump the `pipelineRefreshKey` so `<ClientPipelineTab>` remounts and refetches. (The same mechanism we already use for `SendDraftsToClientModal.onSent`.)

## Testing

- Backend test: agency client created → brand has `brand_type='agency'`.
- Backend test: `GET /api/brands` for the agency-staff user does NOT return agency brands.
- Backend test: `POST /api/agency/clients/{id}/drafts/generate` mocks `call_claude`, returns a draft, emits `draft_generated_by_staff` event.
- Backend test: drafting endpoint rejects when prompt doesn't belong to the brand (400 / 404).
- Backend test: drafting endpoint succeeds for an agency brand even when caller has no SaaS subscription (verifies tier-bypass).
- Frontend smoke: button renders, modal opens, generate fires a request.

## Risks

- **Existing SaaS users with bookmarked agency-brand pages** — none exist (agency portal is new); not a real risk.
- **Tier-bypass introducing rate-limit pressure** — agency-tier brands are 1-handful of clients; volume is fine.
- **Frontend brand switcher pulling stale data** — the `BrandContext` reloads on auth. Filter is server-side, no client cache invalidation needed.

## Out of scope (becomes future sub-project F or G)

- "Run tracking now" button + weekly tracking cadence — sub-project F
- Comprehensive reports — sub-project G
- Bulk N-drafts at once — defer
- Draft regeneration with feedback — defer
