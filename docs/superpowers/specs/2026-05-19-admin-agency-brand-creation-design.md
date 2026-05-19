# Admin "Agency" brand creation option

**Status:** Approved
**Date:** 2026-05-19
**Author:** Claude Code (with Ken)

## Problem

Admins who try to create a brand via the standard SaaS wizard at `/settings/brands/new` are forced into a `pitch` brand if they have no paid subscription. There is no in-wizard path to create an `agency` brand. The proper agency flow already exists at `/agency/clients` (auto-creates `AgencyClient + Brand(brand_type='agency')` via `POST /api/agency/clients`), but admins coming through the brand creation entry point don't discover it.

Concretely: Diego (`diego@lumidian.ai`, admin) created a brand via the SaaS wizard and ended up with a pitch brand instead of an agency brand.

## Goals

1. Admins coming through the standard brand creation flow can choose to create an agency brand instead.
2. Diego's existing pitch brand on production is converted to an agency brand.

## Non-goals

- Adding a new agency-brand-creation API. The existing `POST /api/agency/clients` does the job.
- Inline agency brand creation inside the SaaS wizard. Agency client onboarding needs fields (retainer, primary contact, Peec URL) that don't belong in the SaaS wizard.
- Self-serve agency tier for non-admin users.

## Design

### Frontend changes

**`frontend/app/settings/brands/new/page.tsx`**

On the "type" selection step (currently shows three cards: Starter / Pro / Pitch), add a 4th card labeled **Agency** visible only when `user.is_admin === true`. Card subtitle: "Create a new agency client". Card icon and styling consistent with the other three.

Clicking the Agency card does not advance the wizard. It calls `router.push('/agency/clients?new=1')`. This keeps the SaaS wizard focused on SaaS brand types and reuses the existing agency creation surface.

**`frontend/app/agency/clients/page.tsx`**

Read `?new=1` from `useSearchParams()` on mount. When present, auto-open `NewClientDialog`. Strip the param from the URL after opening (via `router.replace`) so a refresh doesn't re-open the dialog.

`NewClientDialog` already accepts an `onCreated` callback that prepends the new client to the list — no changes needed to the component itself, only to how it's mounted on the parent page (need to lift its `open` state up, or add an `initialOpen` prop).

### Backend changes

None. `POST /api/agency/clients` is gated by `require_agency_staff`, which already allows admins (`is_admin OR is_agency_staff`).

### Diego conversion (production, one-off)

Run via Railway CLI against the production SQLite. Steps:

1. Look up Diego's `user_id` and his existing brand (`brand_type='pitch'`, no `agency_client_id`).
2. Insert a new `AgencyClient` row with `name = <brand name>`, slug derived from name, `status='onboarding'`.
3. Update the brand: `brand_type='agency'`, `agency_client_id=<new client id>`, `pitch_expires_at=NULL`.
4. Update Diego: `is_agency_staff=1` (admin alone grants `/agency/*` access, but staff flag makes him appear in agency staff lists).
5. Insert an `AgencyStaff` row linking Diego to the new agency client.

All wrapped in a single transaction. Verify via `SELECT brand_type, agency_client_id FROM brands WHERE id=?` and `SELECT * FROM agency_clients WHERE id=?` after.

## Risks / edge cases

- **Existing pitch fields:** Diego's brand has `pitch_expires_at` set. Leaving it set on an agency brand could trigger pitch-expiry logic in the daily 06:00 UTC sweep. Mitigate by setting it to NULL during conversion.
- **Brand slug collision:** The agency router's `_unique_slug` only checks `agency_clients.slug`, not `brands.slug`. Since Diego's brand already exists with some slug, we don't need a new brand slug — we keep his existing one.
- **`?new=1` after refresh:** Strip the param on dialog open so refreshing doesn't re-open the dialog.

## Out of scope

- A separate "admin shortcut" link from `/settings/brands/new` to `/agency/clients`. The redirect from the type card is the only entry point added.
- Migration for any other users in a similar pitch-stuck state. If this comes up again, we'll generalize.

## Verification

- Frontend: As an admin, visit `/settings/brands/new` → see 4 type cards → click "Agency" → land on `/agency/clients` with the New Client dialog open. As a non-admin, see only the original 3 cards.
- Backend: `POST /api/agency/clients` (existing tests cover this).
- Diego conversion: After running, `SELECT brand_type, agency_client_id, pitch_expires_at FROM brands WHERE id=?` returns `('agency', <new_id>, NULL)`. Diego can see the new client in `/agency/clients`.

## Scope note

This change is small enough that a separate implementation plan would add overhead with no clarity gain. Implementation is two file edits and a one-off SQL conversion against production.
