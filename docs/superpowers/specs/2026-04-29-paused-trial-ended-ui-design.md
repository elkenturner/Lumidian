# Paused Account & Trial-Ended UI

**Date:** 2026-04-29
**Status:** Design — pending implementation plan

## Problem

Two account states currently have no user-facing UI:

1. **Account paused** — when an admin sets `User.is_paused=True`, the backend throws a 403 from `get_current_user`. The frontend's existing 401 interceptor doesn't catch this, so the user sees broken pages or gets bounced to `/login` without explanation.
2. **Trial ended / billing broken** — when `subscription_status` is `past_due`, `canceled`, `unpaid`, `incomplete_expired`, or a stale `trialing` past `subscription_trial_end`, scheduled tracking silently stops. The user sees flat charts with no indication why.

Both states are reachable in production today. A user reporting "the prompt details graph is cutoff on April 22" turned out to be a paused owner whose scheduled runs were silently skipped — this is the bug that motivated the work.

## Goals

- Paused users land on a clear, dedicated page with a path to support — not on broken pages or a bare login screen.
- Users with broken billing see a persistent, global banner on every authenticated page until they fix it. They cannot dismiss it away and forget — the banner reflects a real, ongoing failure.
- The existing soft "trial ending in N days" amber nudge keeps working as-is.

## Non-goals

- Self-service unpause (paused is admin-controlled by design).
- New billing flows. The banner CTAs route to existing `/settings/billing` and Stripe portal.
- Backend changes beyond a structured 403 detail.

## Architecture

**Two surfaces, separate components.**

### New files

- `frontend/app/account-paused/page.tsx` — full-screen route, no app shell, no `/auth/me` call.
- `frontend/components/BillingPausedBanner.tsx` — global persistent banner.
- `frontend/lib/utils/billing.ts` — pure helper `getBillingPausedReason(user)` returning `{ code, message } | null`.

### Modified files

- `frontend/lib/api.ts` — add a 403 interceptor branch that detects `detail.code === 'account_paused'` and redirects to `/account-paused`.
- `frontend/components/AppShell.tsx` — render `BillingPausedBanner` directly below `ImpersonationBanner`. Add `/account-paused` to `NO_SIDEBAR_PATHS`.
- `frontend/middleware.ts` — add `/account-paused` to public paths so post-logout users can still load it.
- `backend/app/dependencies.py` — change the paused-user 403 detail from a string to a structured object: `{"code": "account_paused", "message": "..."}` (both occurrences at lines 128-133 and 162-166).
- `backend/app/routers/auth.py` — verify `/api/auth/logout` does not depend on `get_current_user` (so paused users can log out). If it does, refactor to clear cookies without requiring auth.
- `frontend/components/SubscriptionBanner.tsx` — remove the `past_due` / `unpaid` / `canceled` rendering branches. Keep only the trial-ending-soon (amber) branch. The new `BillingPausedBanner` covers the blocking states.

## Detection & routing flow

### Backend contract

```python
# backend/app/dependencies.py — paused-user check
raise HTTPException(
    status_code=403,
    detail={
        "code": "account_paused",
        "message": "Your account has been paused. Contact support to restore access.",
    },
)
```

Matching the `code` (not the message text) is the stable contract. Same change applies in both `get_current_user` and `get_current_user_allow_unverified`.

### Frontend interceptor (in `lib/api.ts`)

Pseudocode added alongside the existing 401 handler:

```
on response error:
    status = error.response.status
    detail = error.response.data?.detail
    code   = typeof detail === 'object' ? detail.code : null

    if status === 403 and code === 'account_paused':
        url = error.config?.url ?? ''
        if not url.includes('/auth/logout') and window.location.pathname !== '/account-paused':
            window.location.href = '/account-paused'
        return reject

    if status === 401: (existing logic unchanged)
        ...
```

### Triggering scenarios

1. **Already-logged-in user gets paused mid-session.** Next API call returns 403 with code → redirect.
2. **Fresh login of a paused user.** Cookie sets, then `/auth/me` returns 403 with code → redirect.
3. **User on `/account-paused`.** Page makes no API calls (other than Logout), so no loop.
4. **Loop prevention.** Interceptor checks `pathname !== '/account-paused'` before redirecting; the page itself avoids `/auth/me`.

### Logout from `/account-paused`

- Calls `POST /api/auth/logout` (must work for paused users — endpoint shouldn't depend on user identity).
- On success, redirect to `/login`.
- On failure, clear `clarity_token` and `clarity_session` cookies client-side as fallback, then redirect to `/login`.

## Component contracts

### `frontend/app/account-paused/page.tsx`

- No app shell (path in `NO_SIDEBAR_PATHS`).
- Renders without calling `/auth/me`.
- Layout: centered card on dark background, similar to `/login`.
- Content:
    - Lumidian logo (small, top center).
    - Heading: "Your account has been paused"
    - Body: "Access to your account has been restricted. To restore access, please contact our team and we'll get back to you shortly."
    - Primary CTA (button-styled link): `<a href="mailto:support@lumidian.ai?subject=Account%20paused%20—%20request%20review">Contact support</a>`
    - Secondary CTA (text button): "Log out" — calls `authLogout()`, then `router.push('/login')`.
- No nav, no sidebar, no other links.

### `frontend/components/BillingPausedBanner.tsx`

- Renders inside `AppShell`, just below `ImpersonationBanner`.
- Reads `user` from `useAuth()`.
- Renders only when `getBillingPausedReason(user)` returns non-null.
- Suppressed when `usePathname() === '/settings/billing'` (let the user fix it without nag).
- Non-dismissible (no X button).
- Visual: red banner, full-width across content area, top of page.
- Single CTA button: "Manage billing" → `router.push('/settings/billing')`.

### `frontend/lib/utils/billing.ts` — `getBillingPausedReason(user)`

Returns `null` if user is healthy. Otherwise returns `{ code, message }` for these cases:

| Trigger | code | message |
|---|---|---|
| `status === 'past_due'` or `'unpaid'` | `past_due` | Payment failed — tracking is paused until your payment method is updated. |
| `status === 'canceled'` | `canceled` | Your subscription has been canceled — tracking is paused. Reactivate to resume. |
| `status === 'incomplete_expired'` | `incomplete_expired` | Your subscription couldn't be activated — tracking is paused. |
| `status === 'trialing'` AND `subscription_trial_end < now` | `trial_ended` | Your trial has ended — subscribe to resume tracking. |

Timezone parsing follows existing pattern from `SubscriptionBanner.tsx:49`: `new Date(trialEnd + (trialEnd.endsWith('Z') ? '' : 'Z'))`.

### Existing `SubscriptionBanner` — narrowed scope

Keep only the trial-ending-soon (amber) branch. Remove the `past_due` / `unpaid` / `canceled` rendering — the new global banner covers those cases. Render locations stay (dashboard + content) for the trial-ending-soon nudge.

## Edge cases

| Case | Behavior |
|---|---|
| Admin user is paused | Backend already exempts admins. Admin sees normal app. |
| Admin impersonating a paused user | Backend exempts via `is_impersonated`. Banner reflects impersonated user's billing state. |
| Admin with broken billing | Banner shows. Admins are still customers. |
| Logout fails on paused page | Client-side cookie clear + redirect to `/login` as fallback. |
| `/auth/logout` requires `get_current_user` | Refactor that endpoint to clear cookies without requiring user identity. |
| User pays → status flips to `active` | `AuthContext` refetches `/auth/me` on route changes; banner clears on next navigation. |
| Direct nav to `/account-paused` when not paused | Page renders static content. Harmless. |
| `subscription_trial_end` timezone parsing | Use existing `Z` suffix pattern. |
| Other (non-paused) 403 errors | Interceptor only redirects when `detail.code === 'account_paused'`. Pass-through otherwise. |
| Banner on auth pages | `BillingPausedBanner` returns null when `user` is null. |
| Stacking with `ImpersonationBanner` | Render order: impersonation first (top), billing below. |
| Race: multiple in-flight 403s | All redirect to same target; `pathname` check prevents loop after navigation. |

## Testing

No frontend tests exist in this repo. Testing is backend-test + manual frontend smoke.

### Backend tests (add to `backend/tests/test_auth.py`)

1. `test_paused_user_gets_structured_403` — assert `status == 403`, `detail` is dict, `detail['code'] == 'account_paused'`.
2. `test_paused_admin_not_blocked` — admin with `is_paused=True` gets 200 from `/auth/me`.
3. `test_impersonating_admin_not_blocked` — impersonation bypasses paused 403.
4. `test_paused_user_can_logout` — `/api/auth/logout` returns 200 for paused user; cookies cleared in response.
5. `test_get_current_user_allow_unverified_paused` — same 403 contract on the unverified-allowed dependency.

### Manual frontend smoke

Toggle DB fields directly to simulate each state.

**Paused-account flow:**
1. Set `is_paused=1` on a non-admin user. Log in → expect redirect to `/account-paused`. Verify no sidebar, no API errors, mailto link works, Logout lands on `/login` with cookies cleared.
2. Log in normally first, then admin pauses user → click anywhere → expect redirect on next API call.

**Banner flow:**
3. `subscription_status='past_due'` → red banner with "Manage billing" on `/dashboard`.
4. `canceled` → red banner appropriate copy.
5. `unpaid` / `incomplete_expired` → red banner.
6. `trialing` + `subscription_trial_end` yesterday → "Trial ended" red banner.
7. Navigate to `/settings/billing` → banner suppressed.
8. Banner persists across `/dashboard`, `/content`, `/reports`, `/settings`, `/team`.

**No-regression:**
9. `active` user → no banner anywhere.
10. `trialing` + 5 days remaining → existing soft amber `SubscriptionBanner` only, no red banner.
11. Logged-out user on `/login` → no banner.
12. Existing 401 → `/login` redirect still works.
13. `ImpersonationBanner` still renders when impersonating, with billing banner stacked below if applicable.

### Verification before claiming done

- `pytest backend/tests/test_auth.py` — green.
- `npm run build && npm run lint` in `frontend/` — clean.
- Manual steps 1-13 walked through in browser.

## Out of scope

- Self-service unpause flows.
- Stripe portal session for `incomplete_expired` users (they have no Stripe customer; CTA routes to `/settings/billing` plan picker).
- Email notifications for paused state (admin sets it manually; assumed to communicate out-of-band).
- Auto-refresh of user state on banner mount (relying on existing `AuthContext` route-change refetch is sufficient).
