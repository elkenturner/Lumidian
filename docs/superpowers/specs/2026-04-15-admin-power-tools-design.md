# Admin Power Tools — Design Spec

**Date:** 2026-04-15
**Goal:** Upgrade the admin dashboard with user impersonation, user data editing, and brand/prompt editing via dedicated sub-pages.

---

## Overview

The current admin page (`/admin`) is read-only stats + basic user management (pause/remove) and log viewing. This upgrade adds three capabilities:

1. **Impersonation** — log in as any user to see exactly what they see and take actions as them
2. **User editing** — change tier, subscription status, trial dates, verification, name directly from admin
3. **Brand/prompt editing** — rename brands, edit slugs, change tiers, add/remove/edit prompts and competitors for any user's brands

All new functionality lives behind dedicated admin sub-pages (`/admin/users/[userId]`) with a new backend admin router.

---

## Architecture

### Backend: New `routers/admin.py`

A dedicated admin router mounted at `/api/admin`. Moves the existing admin endpoints out of `analytics.py` into this new router for clean separation. All endpoints require `is_admin` check.

**Existing endpoints to migrate from `analytics.py`:**
- `GET /api/admin/users` — list all users
- `POST /api/admin/users/{user_id}/pause` — pause/unpause
- `DELETE /api/admin/users/{user_id}` — remove user
- `GET /api/admin/runs` — list all runs
- `GET /api/admin/stats` — system stats
- `POST /api/admin/trigger-run/{brand_id}` — trigger run
- `GET /api/admin/logs` — tail log file
- `POST /api/admin/generate-draft/{brand_id}` — generate drafts

**Also migrate from `auth.py`:**
- `POST /api/admin/reset-password` — admin password reset

**New endpoints:**

| Method | Path | Purpose |
|--------|------|---------|
| `POST` | `/api/admin/impersonate/{user_id}` | Mint impersonation JWT, set cookies |
| `POST` | `/api/admin/exit-impersonation` | Restore admin session from stored token |
| `GET` | `/api/admin/users/{user_id}` | Full user detail |
| `PATCH` | `/api/admin/users/{user_id}` | Edit user fields |
| `GET` | `/api/admin/users/{user_id}/brands` | User's brands with prompts + competitors |
| `PATCH` | `/api/admin/brands/{brand_id}` | Edit brand fields |
| `POST` | `/api/admin/brands/{brand_id}/prompts` | Add prompt |
| `PATCH` | `/api/admin/prompts/{prompt_id}` | Edit prompt text |
| `DELETE` | `/api/admin/prompts/{prompt_id}` | Delete prompt |
| `POST` | `/api/admin/brands/{brand_id}/competitors` | Add competitor |
| `DELETE` | `/api/admin/competitors/{competitor_id}` | Delete competitor |

### Frontend: New pages

| Route | Purpose |
|-------|---------|
| `/admin` | Existing page — user list rows become clickable links to detail pages |
| `/admin/users/[userId]` | User detail with tabs: Overview, Edit User, Brands, Activity |

---

## Feature 1: Impersonation

### Backend

`POST /api/admin/impersonate/{user_id}`:
- Validates admin status
- Rejects impersonation of other admin accounts
- Loads the target user
- Mints a standard JWT for the target user with one extra claim: `impersonated_by: <admin_user_id>`
- Sets `clarity_token` (httpOnly) and `clarity_session` cookies, same as normal login
- Returns `{ admin_token: "<current_admin_jwt>", target_user_email: "..." }` in the response body so the frontend can stash the admin token before the cookies are overwritten

No changes to `get_current_user` — the impersonation JWT is a valid user token. The `impersonated_by` claim is passive metadata for logging.

### Audit logging

Add a utility in the admin router that checks for the `impersonated_by` claim on write operations. When present, log lines include `(impersonated by admin {admin_id})`. This uses the existing logger — no new logging infrastructure.

### Frontend — entering impersonation

1. User detail page has an "Impersonate" button in the header
2. On click: call `POST /api/admin/impersonate/{user_id}`
3. Before the response sets new cookies, save the current admin JWT to `sessionStorage` key `admin_restore_token`
4. The response sets the impersonation cookies via `Set-Cookie`
5. Refresh auth context (call `authMe()` which now returns the target user)
6. Redirect to `/dashboard`

### Frontend — impersonation banner

A fixed banner rendered at the top of the app shell (above everything) when `sessionStorage.getItem('admin_restore_token')` is truthy.

- **Appearance:** Red/orange background, white text, full width, ~40px tall
- **Content:** `"Viewing as {user_email}"` on the left, `"Exit Impersonation"` button on the right
- **Z-index:** Above everything (z-50+)
- **Persists** across all page navigation within the session

### Frontend — exiting impersonation

1. Click "Exit Impersonation"
2. Retrieve `admin_restore_token` from `sessionStorage`
3. Call `POST /api/admin/exit-impersonation` with `{ admin_token: "..." }` in the body
4. Backend validates the token is a real admin JWT, then re-sets `clarity_token` and `clarity_session` cookies to the admin's session
5. Clear `admin_restore_token` from `sessionStorage`
6. Refresh auth context
7. Redirect to `/admin`

### Safety

- Cannot impersonate other admins
- Banner is impossible to miss (red, fixed, top of viewport)
- `impersonated_by` claim in JWT provides audit trail
- `sessionStorage` clears on tab close — no stale impersonation across browser sessions

---

## Feature 2: User Detail Page & Editing

### Backend

**`GET /api/admin/users/{user_id}`** returns:
```json
{
  "id": 1,
  "email": "user@example.com",
  "name": "User Name",
  "subscription_tier": "basic",
  "subscription_status": "active",
  "trial_end": "2026-05-01T00:00:00",
  "email_verified": true,
  "is_paused": false,
  "is_admin": false,
  "created_at": "2026-01-15T10:00:00",
  "stripe_customer_id": "cus_abc123",
  "google_id": "...",
  "totp_enabled": false,
  "brand_count": 3,
  "total_runs": 47,
  "total_drafts": 12,
  "last_active": "2026-04-14T08:00:00"
}
```

**`PATCH /api/admin/users/{user_id}`** accepts partial body:
```json
{
  "subscription_tier": "starter",
  "subscription_status": "active",
  "trial_end": "2026-06-01T00:00:00",
  "email_verified": true,
  "is_paused": false,
  "name": "New Name"
}
```

- Only provided fields are updated
- Logs every change: `Admin {email} updated user {user_id}: subscription_tier basic→starter, trial_end null→2026-06-01`
- Cannot edit another admin account
- Returns the updated user object

### Frontend — `/admin/users/[userId]`

**Page header:**
- Back arrow → `/admin`
- User email + name as title
- "Impersonate" button (right-aligned)
- Tier badge, paused badge, verified badge inline

**Tab: Overview**
- Info card: email, name, joined, last active, Stripe ID (if present), Google-linked indicator, 2FA status
- Quick stats row: brands count, total runs, total drafts
- Recent runs table: last 10 tracking runs for this user (status, score, date)

**Tab: Edit User**
- Form fields:
  - Subscription tier — dropdown: None (Free), basic (Starter), starter (Growth), pro (Pro)
  - Subscription status — dropdown: null, active, trialing, canceled
  - Trial end — date picker (or clear button)
  - Email verified — toggle
  - Is paused — toggle
  - Name — text input
- "Save Changes" button
- On save: show a confirmation with a summary of changes (e.g., "Change tier from basic to starter?") before submitting

**Tab: Activity**
- Full tracking run history for this user
- Table columns: brand name, status, score, type (manual/scheduled), date
- Sorted newest-first

---

## Feature 3: Brand & Prompt Editing

### Backend

**`GET /api/admin/users/{user_id}/brands`** returns:
```json
[
  {
    "id": 1,
    "name": "Acme Corp",
    "slug": "acme-corp",
    "tier": "standard",
    "brand_type": "standard",
    "website_url": "https://acme.com",
    "latest_score": 42.5,
    "prompts": [
      { "id": 10, "text": "What is the best CRM?", "prompt_type": "standard" }
    ],
    "competitors": [
      { "id": 5, "name": "Rival Inc", "website_url": "https://rival.com" }
    ]
  }
]
```

**`PATCH /api/admin/brands/{brand_id}`** accepts partial body:
```json
{
  "name": "Acme Corporation",
  "slug": "acme-corporation",
  "tier": "premium",
  "brand_type": "standard",
  "website_url": "https://acme.com"
}
```
- Validates slug uniqueness
- Logs changes

**`POST /api/admin/brands/{brand_id}/prompts`** — body: `{ "text": "...", "prompt_type": "standard" }`
**`PATCH /api/admin/prompts/{prompt_id}`** — body: `{ "text": "..." }`
**`DELETE /api/admin/prompts/{prompt_id}`** — no body
**`POST /api/admin/brands/{brand_id}/competitors`** — body: `{ "name": "...", "website_url": "..." }`
**`DELETE /api/admin/competitors/{competitor_id}`** — no body

All skip the usual tier-based limits that apply to normal users.

### Frontend — Brands tab on `/admin/users/[userId]`

- List of brands as expandable cards
- Each collapsed card shows: name, slug, type badge, tier badge, website URL, latest score, prompt count, competitor count
- Each card has "Trigger Run" and "Generate Drafts" action buttons (reusing existing admin endpoints)
- Expand a card to see:
  - **Editable fields:** name (text input), slug (text input), tier (dropdown), type (dropdown), website URL (text input). Inline save button per card.
  - **Prompts section:** list of prompts with edit (inline text input) and delete (X button with confirm) per prompt. "Add Prompt" text input + button at the bottom.
  - **Competitors section:** list of competitors with delete (X button with confirm). "Add Competitor" with name + URL inputs at the bottom.

---

## Router Migration Plan

To keep things clean, the existing admin endpoints in `analytics.py` should be migrated to the new `admin.py` router. To avoid breaking the frontend during migration:

1. Create `routers/admin.py` with all new + migrated endpoints
2. Mount it at `/api/admin` in `main.py`
3. Update frontend API functions in `lib/api.ts` to point to `/admin/...` paths (drop the `/analytics` prefix)
4. Remove the old admin endpoints from `analytics.py`
5. Move the admin reset-password endpoint from `auth.py` to `admin.py`

This is a one-time cleanup — all admin logic ends up in one router.

---

## Files to Create

| File | Purpose |
|------|---------|
| `backend/app/routers/admin.py` | All admin API endpoints (new + migrated) |
| `frontend/app/admin/users/[userId]/page.tsx` | User detail page with tabs |
| `frontend/components/admin/ImpersonationBanner.tsx` | Fixed top banner during impersonation |

## Files to Modify

| File | Change |
|------|--------|
| `backend/app/main.py` | Mount admin router |
| `backend/app/routers/analytics.py` | Remove migrated admin endpoints |
| `backend/app/routers/auth.py` | Remove admin reset-password endpoint |
| `frontend/app/admin/page.tsx` | Make user rows clickable links |
| `frontend/lib/api.ts` | Add new admin API functions, update existing paths |
| `frontend/components/AppShell.tsx` (or equivalent layout) | Render `ImpersonationBanner` when active |

## Out of Scope

- Role-based admin (multiple admin tiers) — single admin account is sufficient
- Admin activity audit log page — log lines are sufficient for now
- Bulk operations (edit multiple users at once)
- Creating new users from admin
- Editing content drafts from admin
