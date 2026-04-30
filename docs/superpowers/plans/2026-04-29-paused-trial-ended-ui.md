# Paused Account & Trial-Ended UI — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Spec:** `docs/superpowers/specs/2026-04-29-paused-trial-ended-ui-design.md`

**Goal:** Surface a dedicated `/account-paused` page when an admin pauses a user, and a persistent global banner when billing is broken — so users always know why tracking stopped and how to fix it.

**Architecture:** Two surfaces. (1) A frontend route `/account-paused` triggered by a 403 interceptor on a structured backend error code. (2) A `BillingPausedBanner` rendered globally inside `AppShell` next to `ImpersonationBanner`, suppressed only on `/settings/billing`. The existing dismissible `SubscriptionBanner` is narrowed to only handle the soft "trial ending in N days" amber nudge.

**Tech Stack:** Next.js 15 App Router, TypeScript, Axios interceptors. Backend: FastAPI HTTPException with structured detail.

---

## File Structure

**New files:**
- `frontend/app/account-paused/page.tsx` — full-screen paused page
- `frontend/components/BillingPausedBanner.tsx` — global persistent banner
- `frontend/lib/utils/billing.ts` — `getBillingPausedReason()` pure helper

**Modified files:**
- `backend/app/dependencies.py` — structured 403 detail (lines 128-133 and 162-166)
- `backend/app/routers/auth.py` — include `subscription_trial_end` in `user_to_dict()` (line 231-244)
- `backend/tests/test_auth.py` — add 5 tests
- `frontend/lib/api.ts` — extend `AuthUser` interface; add 403 interceptor branch
- `frontend/components/AppShell.tsx` — render banner; add `/account-paused` to `NO_SIDEBAR_PATHS`
- `frontend/components/SubscriptionBanner.tsx` — remove blocking-state branches
- `frontend/middleware.ts` — add `/account-paused` to `PUBLIC_PATHS`
- `frontend/contexts/AuthContext.tsx` — add `/account-paused` to its mirrored `PUBLIC_PATHS`

---

## Task 1: Backend — structured 403 detail in `get_current_user`

**Files:**
- Modify: `backend/app/dependencies.py:128-133`
- Test: `backend/tests/test_auth.py`

- [ ] **Step 1.1: Add failing test for structured paused 403**

Add to `backend/tests/test_auth.py` (append at the end of the file):

```python
# ── Paused account ────────────────────────────────────────────────────────────

async def test_paused_user_gets_structured_403(client: httpx.AsyncClient):
    """Paused users hit /auth/me with a structured detail object so the
    frontend can detect this case via a stable code, not a brittle string match."""
    await register_and_login(client, email="paused@example.com")
    async with AsyncSessionLocal() as db:
        from sqlalchemy import text
        await db.execute(
            text("UPDATE users SET is_paused = 1 WHERE email = :e"),
            {"e": "paused@example.com"},
        )
        await db.commit()

    resp = await client.get("/api/auth/me")
    assert resp.status_code == 403
    body = resp.json()
    assert isinstance(body["detail"], dict), f"detail should be dict, got: {body['detail']}"
    assert body["detail"]["code"] == "account_paused"
    assert "paused" in body["detail"]["message"].lower()
```

- [ ] **Step 1.2: Run test — verify it fails**

Run: `cd backend && source venv/bin/activate && pytest tests/test_auth.py::test_paused_user_gets_structured_403 -v`
Expected: FAIL — current detail is a string, not a dict.

- [ ] **Step 1.3: Update `dependencies.py:128-133`**

Replace:

```python
    if getattr(user, "is_paused", False) and not user.is_admin and not is_impersonated:
        logger.warning(f"get_current_user: BLOCKED - account paused for user {user.id}")
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Your account has been paused. Contact support to restore access.",
        )
```

With:

```python
    if getattr(user, "is_paused", False) and not user.is_admin and not is_impersonated:
        logger.warning(f"get_current_user: BLOCKED - account paused for user {user.id}")
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail={
                "code": "account_paused",
                "message": "Your account has been paused. Contact support to restore access.",
            },
        )
```

- [ ] **Step 1.4: Run test — verify it passes**

Run: `pytest tests/test_auth.py::test_paused_user_gets_structured_403 -v`
Expected: PASS.

- [ ] **Step 1.5: Commit**

```bash
git add backend/app/dependencies.py backend/tests/test_auth.py
git commit -m "feat(auth): structured detail for paused-account 403"
```

---

## Task 2: Backend — same structured 403 in `get_current_user_allow_unverified`

**Files:**
- Modify: `backend/app/dependencies.py:162-166`
- Test: `backend/tests/test_auth.py`

- [ ] **Step 2.1: Add failing test**

Append to `backend/tests/test_auth.py`:

```python
async def test_paused_user_unverified_dep_gets_structured_403(client: httpx.AsyncClient):
    """The allow_unverified dependency is used by /auth/me and should also
    return the structured paused error so the same frontend handler works."""
    # Register without verifying email
    await register_user(client, email="paused-unverified@example.com")
    async with AsyncSessionLocal() as db:
        from sqlalchemy import text
        await db.execute(
            text("UPDATE users SET is_paused = 1 WHERE email = :e"),
            {"e": "paused-unverified@example.com"},
        )
        await db.commit()
    # Login the unverified user
    await client.post(
        "/api/auth/login",
        json={"email": "paused-unverified@example.com", "password": "Password123"},
    )

    resp = await client.get("/api/auth/me")
    assert resp.status_code == 403
    body = resp.json()
    assert isinstance(body["detail"], dict)
    assert body["detail"]["code"] == "account_paused"
```

- [ ] **Step 2.2: Run test — verify it fails**

Run: `pytest tests/test_auth.py::test_paused_user_unverified_dep_gets_structured_403 -v`
Expected: FAIL.

- [ ] **Step 2.3: Update `dependencies.py:162-166`**

Replace:

```python
    if getattr(user, "is_paused", False) and not user.is_admin and not is_impersonated:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Your account has been paused. Contact support to restore access.",
        )
```

With:

```python
    if getattr(user, "is_paused", False) and not user.is_admin and not is_impersonated:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail={
                "code": "account_paused",
                "message": "Your account has been paused. Contact support to restore access.",
            },
        )
```

- [ ] **Step 2.4: Run test — verify it passes**

Run: `pytest tests/test_auth.py::test_paused_user_unverified_dep_gets_structured_403 -v`
Expected: PASS.

- [ ] **Step 2.5: Commit**

```bash
git add backend/app/dependencies.py backend/tests/test_auth.py
git commit -m "feat(auth): structured 403 in allow_unverified dependency"
```

---

## Task 3: Backend — admin/impersonation bypass tests + paused logout test

These verify existing behavior continues to work after Tasks 1-2 changed the detail shape.

**Files:**
- Test: `backend/tests/test_auth.py`

- [ ] **Step 3.1: Add three verifying tests**

Append to `backend/tests/test_auth.py`:

```python
async def test_paused_admin_not_blocked(client: httpx.AsyncClient):
    """Admin users bypass the paused 403 check entirely."""
    await register_and_login(client, email="paused-admin@example.com")
    async with AsyncSessionLocal() as db:
        from sqlalchemy import text
        await db.execute(
            text("UPDATE users SET is_paused = 1, is_admin = 1 WHERE email = :e"),
            {"e": "paused-admin@example.com"},
        )
        await db.commit()

    resp = await client.get("/api/auth/me")
    assert resp.status_code == 200
    assert resp.json()["email"] == "paused-admin@example.com"


async def test_paused_user_can_still_logout(client: httpx.AsyncClient):
    """Logout endpoint must work for paused users — it doesn't depend on
    get_current_user, but this test guards against a future regression."""
    await register_and_login(client, email="paused-logout@example.com")
    async with AsyncSessionLocal() as db:
        from sqlalchemy import text
        await db.execute(
            text("UPDATE users SET is_paused = 1 WHERE email = :e"),
            {"e": "paused-logout@example.com"},
        )
        await db.commit()

    resp = await client.post("/api/auth/logout")
    assert resp.status_code == 200
    # Cookie cleared in response
    set_cookie = resp.headers.get("set-cookie", "")
    assert "clarity_token=" in set_cookie
    assert "Max-Age=0" in set_cookie or "max-age=0" in set_cookie or "expires=" in set_cookie.lower()


async def test_paused_user_cannot_call_protected_endpoints(client: httpx.AsyncClient):
    """Sanity: a paused user gets the structured 403 from any
    get_current_user-dependent endpoint, not just /auth/me."""
    await register_and_login(client, email="paused-protected@example.com")
    async with AsyncSessionLocal() as db:
        from sqlalchemy import text
        await db.execute(
            text("UPDATE users SET is_paused = 1 WHERE email = :e"),
            {"e": "paused-protected@example.com"},
        )
        await db.commit()

    resp = await client.get("/api/brands")  # uses get_current_user
    assert resp.status_code == 403
    body = resp.json()
    assert isinstance(body["detail"], dict)
    assert body["detail"]["code"] == "account_paused"
```

- [ ] **Step 3.2: Run the new tests — all should pass**

Run: `pytest tests/test_auth.py::test_paused_admin_not_blocked tests/test_auth.py::test_paused_user_can_still_logout tests/test_auth.py::test_paused_user_cannot_call_protected_endpoints -v`
Expected: 3 PASS.

- [ ] **Step 3.3: Run the full auth test file — no regressions**

Run: `pytest tests/test_auth.py -v`
Expected: all green.

- [ ] **Step 3.4: Commit**

```bash
git add backend/tests/test_auth.py
git commit -m "test(auth): admin bypass, paused logout, paused protected endpoint"
```

---

## Task 4: Backend — include `subscription_trial_end` in `/auth/me` response

The frontend banner needs `subscription_trial_end` to detect "trial ended" (status=trialing, trial_end in past). It's not currently in the `/auth/me` payload.

**Files:**
- Modify: `backend/app/routers/auth.py:231-244`
- Test: `backend/tests/test_auth.py`

- [ ] **Step 4.1: Add failing test**

Append to `backend/tests/test_auth.py`:

```python
async def test_auth_me_includes_subscription_trial_end(client: httpx.AsyncClient):
    """The frontend BillingPausedBanner reads subscription_trial_end from
    /auth/me to detect 'trial ended' (status=trialing, trial_end in past)."""
    from datetime import datetime, timedelta, timezone

    await register_and_login(client, email="trial@example.com")
    trial_end = (datetime.now(timezone.utc) + timedelta(days=3)).replace(microsecond=0)
    async with AsyncSessionLocal() as db:
        from sqlalchemy import text
        await db.execute(
            text(
                "UPDATE users SET subscription_status = 'trialing', "
                "subscription_trial_end = :te WHERE email = :e"
            ),
            {"te": trial_end, "e": "trial@example.com"},
        )
        await db.commit()

    resp = await client.get("/api/auth/me")
    assert resp.status_code == 200
    data = resp.json()
    assert "subscription_trial_end" in data, f"missing field; got keys: {list(data.keys())}"
    assert data["subscription_trial_end"] is not None
    assert data["subscription_status"] == "trialing"
```

- [ ] **Step 4.2: Run test — verify it fails**

Run: `pytest tests/test_auth.py::test_auth_me_includes_subscription_trial_end -v`
Expected: FAIL — `subscription_trial_end` missing from response.

- [ ] **Step 4.3: Update `user_to_dict()` in `backend/app/routers/auth.py:231-244`**

Replace:

```python
def user_to_dict(user: User) -> dict:
    limit = 999999 if user.is_admin else TIER_LIMITS.get(user.subscription_tier or "", 10)
    return {
        "id": user.id,
        "email": user.email,
        "name": user.name,
        "subscription_tier": user.subscription_tier,
        "subscription_status": user.subscription_status,
        "is_admin": user.is_admin,
        "prompt_limit": limit,
        "totp_enabled": bool(user.totp_enabled),
        "created_at": user.created_at.isoformat() if user.created_at else None,
        "email_verified": bool(getattr(user, "email_verified", True)),
    }
```

With:

```python
def user_to_dict(user: User) -> dict:
    limit = 999999 if user.is_admin else TIER_LIMITS.get(user.subscription_tier or "", 10)
    trial_end = getattr(user, "subscription_trial_end", None)
    return {
        "id": user.id,
        "email": user.email,
        "name": user.name,
        "subscription_tier": user.subscription_tier,
        "subscription_status": user.subscription_status,
        "subscription_trial_end": trial_end.isoformat() if trial_end else None,
        "is_admin": user.is_admin,
        "prompt_limit": limit,
        "totp_enabled": bool(user.totp_enabled),
        "created_at": user.created_at.isoformat() if user.created_at else None,
        "email_verified": bool(getattr(user, "email_verified", True)),
    }
```

- [ ] **Step 4.4: Run test — verify it passes**

Run: `pytest tests/test_auth.py::test_auth_me_includes_subscription_trial_end -v`
Expected: PASS.

- [ ] **Step 4.5: Run full auth tests — no regressions**

Run: `pytest tests/test_auth.py -v`
Expected: all green.

- [ ] **Step 4.6: Commit**

```bash
git add backend/app/routers/auth.py backend/tests/test_auth.py
git commit -m "feat(auth): include subscription_trial_end in /auth/me"
```

---

## Task 5: Frontend — extend `AuthUser` interface

**Files:**
- Modify: `frontend/lib/api.ts:882-895` (the `AuthUser` interface)

- [ ] **Step 5.1: Add `subscription_trial_end` to `AuthUser`**

Find the `AuthUser` interface and add the field after `subscription_status`. The current interface is:

```typescript
export interface AuthUser {
  id: number;
  email: string;
  name: string | null;
  subscription_tier: 'basic' | 'starter' | 'pro' | null;
  subscription_status: string | null;
  is_admin: boolean;
  prompt_limit: number;
  totp_enabled: boolean;
  created_at: string;
  email_verified: boolean;
  is_team_member?: boolean;
  team_owner_name?: string | null;
  // ...
}
```

Update to:

```typescript
export interface AuthUser {
  id: number;
  email: string;
  name: string | null;
  subscription_tier: 'basic' | 'starter' | 'pro' | null;
  subscription_status: string | null;
  subscription_trial_end: string | null;
  is_admin: boolean;
  prompt_limit: number;
  totp_enabled: boolean;
  created_at: string;
  email_verified: boolean;
  is_team_member?: boolean;
  team_owner_name?: string | null;
  // ...
}
```

(Keep the rest of the interface unchanged.)

- [ ] **Step 5.2: Lint check**

Run: `cd frontend && npm run lint`
Expected: clean (no new warnings).

- [ ] **Step 5.3: Commit**

```bash
git add frontend/lib/api.ts
git commit -m "feat(types): add subscription_trial_end to AuthUser"
```

---

## Task 6: Frontend — `getBillingPausedReason()` helper

**Files:**
- Create: `frontend/lib/utils/billing.ts`

- [ ] **Step 6.1: Create the helper file**

Create `frontend/lib/utils/billing.ts` with this exact content:

```typescript
import { AuthUser } from '@/lib/api';

export type BillingPausedCode =
  | 'past_due'
  | 'canceled'
  | 'incomplete_expired'
  | 'trial_ended';

export interface BillingPausedReason {
  code: BillingPausedCode;
  message: string;
}

/**
 * Returns a non-null reason when the user's billing state means tracking is paused.
 * Returns null for healthy users (active, trialing-with-time-remaining, no subscription).
 *
 * The four blocking states:
 *  - past_due / unpaid    → payment failed
 *  - canceled             → subscription ended
 *  - incomplete_expired   → initial signup never activated
 *  - trialing + trial_end in past → trial ended without renewal
 */
export function getBillingPausedReason(
  user: AuthUser | null | undefined,
): BillingPausedReason | null {
  if (!user) return null;
  const status = user.subscription_status;

  if (status === 'past_due' || status === 'unpaid') {
    return {
      code: 'past_due',
      message: 'Payment failed — tracking is paused until your payment method is updated.',
    };
  }
  if (status === 'canceled') {
    return {
      code: 'canceled',
      message: 'Your subscription has been canceled — tracking is paused. Reactivate to resume.',
    };
  }
  if (status === 'incomplete_expired') {
    return {
      code: 'incomplete_expired',
      message: "Your subscription couldn't be activated — tracking is paused.",
    };
  }
  if (status === 'trialing' && user.subscription_trial_end) {
    const raw = user.subscription_trial_end;
    const trialEnd = new Date(raw + (raw.endsWith('Z') ? '' : 'Z'));
    if (!Number.isNaN(trialEnd.getTime()) && trialEnd.getTime() < Date.now()) {
      return {
        code: 'trial_ended',
        message: 'Your trial has ended — subscribe to resume tracking.',
      };
    }
  }
  return null;
}
```

- [ ] **Step 6.2: Lint check**

Run: `cd frontend && npm run lint`
Expected: clean.

- [ ] **Step 6.3: Commit**

```bash
git add frontend/lib/utils/billing.ts
git commit -m "feat(billing): add getBillingPausedReason helper"
```

---

## Task 7: Frontend — `BillingPausedBanner` component

**Files:**
- Create: `frontend/components/BillingPausedBanner.tsx`

- [ ] **Step 7.1: Create the banner component**

Create `frontend/components/BillingPausedBanner.tsx` with this exact content:

```typescript
'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { AlertTriangle, ExternalLink } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { getBillingPausedReason } from '@/lib/utils/billing';

/**
 * Persistent, non-dismissible global banner shown when the user's billing
 * state means scheduled tracking is paused (past_due, canceled,
 * incomplete_expired, or trialing-with-trial_end-in-past).
 *
 * Suppressed on /settings/billing because the user is already there to fix it.
 * Hidden when there is no user (public/auth pages).
 */
export default function BillingPausedBanner() {
  const { user } = useAuth();
  const pathname = usePathname();

  if (!user) return null;
  if (pathname === '/settings/billing') return null;

  const reason = getBillingPausedReason(user);
  if (!reason) return null;

  return (
    <div
      role="status"
      className="mx-8 mt-4 mb-0 flex items-center gap-3 rounded-xl border border-[#7f1d1d]/40 bg-[#7f1d1d]/15 px-4 py-3"
    >
      <AlertTriangle size={16} className="shrink-0 text-[var(--danger)]" />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-[var(--danger-text)]">
          {reason.message}
        </p>
      </div>
      <Link
        href="/settings/billing"
        className="shrink-0 flex items-center gap-1.5 rounded-lg bg-[var(--danger)]/20 hover:bg-[var(--danger)]/30 border border-[var(--danger)]/30 px-3 py-1.5 text-xs font-semibold text-[var(--danger-text)] transition-colors"
      >
        <ExternalLink size={12} />
        Manage billing
      </Link>
    </div>
  );
}
```

- [ ] **Step 7.2: Lint check**

Run: `cd frontend && npm run lint`
Expected: clean.

- [ ] **Step 7.3: Commit**

```bash
git add frontend/components/BillingPausedBanner.tsx
git commit -m "feat(banner): add BillingPausedBanner global component"
```

---

## Task 8: Frontend — wire banner into `AppShell` + add `/account-paused` to `NO_SIDEBAR_PATHS`

**Files:**
- Modify: `frontend/components/AppShell.tsx` (lines 18, 24, 826)

- [ ] **Step 8.1: Add the import**

In `frontend/components/AppShell.tsx`, find the existing `ImpersonationBanner` import at line 18:

```typescript
import ImpersonationBanner from '@/components/admin/ImpersonationBanner';
```

Add a new import directly below it:

```typescript
import ImpersonationBanner from '@/components/admin/ImpersonationBanner';
import BillingPausedBanner from '@/components/BillingPausedBanner';
```

- [ ] **Step 8.2: Add `/account-paused` to `NO_SIDEBAR_PATHS`**

At line 24, find:

```typescript
const NO_SIDEBAR_PATHS = ['/', '/login', '/register', '/onboarding', '/forgot-password', '/reset-password', '/verify-email', '/terms', '/privacy', '/methodology'];
```

Add `/account-paused` to the array:

```typescript
const NO_SIDEBAR_PATHS = ['/', '/login', '/register', '/onboarding', '/forgot-password', '/reset-password', '/verify-email', '/terms', '/privacy', '/methodology', '/account-paused'];
```

- [ ] **Step 8.3: Render banner below `ImpersonationBanner`**

Find line 826:

```typescript
        <ImpersonationBanner />
```

Replace with:

```typescript
        <ImpersonationBanner />
        <BillingPausedBanner />
```

- [ ] **Step 8.4: Build check**

Run: `cd frontend && npm run build`
Expected: clean build.

- [ ] **Step 8.5: Commit**

```bash
git add frontend/components/AppShell.tsx
git commit -m "feat(shell): render BillingPausedBanner globally; carve out /account-paused"
```

---

## Task 9: Frontend — narrow `SubscriptionBanner` scope

Remove the `past_due`/`unpaid`/`canceled` rendering branches. The new global banner covers those. Keep only the trial-ending-soon (amber) branch.

**Files:**
- Modify: `frontend/components/SubscriptionBanner.tsx`

- [ ] **Step 9.1: Rewrite `SubscriptionBanner.tsx`**

Replace the entire file content with this trimmed version:

```typescript
'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Clock, X } from 'lucide-react';

interface Props {
  status: string;
  daysRemaining?: number | null;
  trialEnd?: string | null;
}

/**
 * Soft amber nudge for "trial ending in N days" only. Dismissible.
 * Blocking billing states (past_due, canceled, unpaid, incomplete_expired,
 * trial-ended) are handled by BillingPausedBanner globally in AppShell.
 */
export default function SubscriptionBanner({ status, daysRemaining, trialEnd }: Props) {
  const [dismissed, setDismissed] = useState(false);

  if (dismissed) return null;

  const isTrialEndingSoon = status === 'trialing' && typeof daysRemaining === 'number' && daysRemaining < 7;
  if (!isTrialEndingSoon) return null;

  const chargeDate = trialEnd
    ? new Date(trialEnd + (trialEnd.endsWith('Z') ? '' : 'Z')).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
    : null;

  return (
    <div className="mx-8 mt-4 mb-0 flex items-center gap-3 rounded-xl border border-[#92400e]/40 bg-[#92400e]/15 px-4 py-3">
      <Clock size={16} className="shrink-0 text-[var(--warning)]" />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-[var(--warning-text)]">
          {daysRemaining === 0
            ? 'Your free trial ends today'
            : `Your free trial ends in ${daysRemaining} day${daysRemaining === 1 ? '' : 's'}`}
        </p>
        <p className="text-xs text-[var(--warning)]/70 mt-0.5">
          {chargeDate
            ? `Your card will be charged automatically on ${chargeDate}.`
            : 'Your card will be charged automatically when the trial ends.'}
        </p>
      </div>
      <Link
        href="/settings/billing"
        className="shrink-0 flex items-center gap-1.5 rounded-lg bg-[var(--warning)]/20 hover:bg-[var(--warning)]/30 border border-[var(--warning)]/30 px-3 py-1.5 text-xs font-semibold text-[var(--warning-text)] transition-colors"
      >
        Manage plan
      </Link>
      <button
        onClick={() => setDismissed(true)}
        className="shrink-0 text-[var(--warning)]/50 hover:text-[var(--warning)] transition-colors"
        aria-label="Dismiss"
      >
        <X size={14} />
      </button>
    </div>
  );
}
```

This drops the `AppToast`, `createPortalSession`, `Loader2`, `AlertTriangle`, and `ExternalLink` imports since they were only used by the removed red-banner branches.

- [ ] **Step 9.2: Build check**

Run: `cd frontend && npm run build`
Expected: clean build (no unused-import warnings, no missing-symbol errors).

- [ ] **Step 9.3: Commit**

```bash
git add frontend/components/SubscriptionBanner.tsx
git commit -m "refactor(banner): narrow SubscriptionBanner to trial-ending-soon only"
```

---

## Task 10: Frontend — `/account-paused` page

**Files:**
- Create: `frontend/app/account-paused/page.tsx`

- [ ] **Step 10.1: Create the page**

Create `frontend/app/account-paused/page.tsx` with this exact content:

```typescript
'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Mail, LogOut, Loader2 } from 'lucide-react';
import LumidianLogo from '@/components/LumidianLogo';
import { authLogout } from '@/lib/api';

const SUPPORT_MAILTO = 'mailto:support@lumidian.ai?subject=Account%20paused%20%E2%80%94%20request%20review&body=Please%20review%20my%20account%20status.';

/**
 * Full-screen page shown when an admin has paused the user's account.
 * Reachable via the 403 interceptor in lib/api.ts. Makes no API calls
 * other than the explicit Logout action — the page must work even when
 * every other endpoint is returning 403 for this user.
 */
export default function AccountPausedPage() {
  const router = useRouter();
  const [loggingOut, setLoggingOut] = useState(false);

  useEffect(() => {
    document.title = 'Account paused — Lumidian';
  }, []);

  async function handleLogout() {
    setLoggingOut(true);
    try {
      await authLogout();
    } catch {
      // Logout endpoint should always work for paused users (no auth required),
      // but if anything goes sideways, clear cookies client-side as fallback.
      document.cookie = 'clarity_session=; path=/; max-age=0';
      document.cookie = 'clarity_token=; path=/; max-age=0';
    } finally {
      router.push('/login');
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-[var(--bg-base)] px-4">
      <div className="w-full max-w-md">
        <div className="flex justify-center mb-8">
          <LumidianLogo />
        </div>
        <div className="card p-8 text-center">
          <h1 className="text-xl font-semibold text-[var(--text-primary)] mb-3">
            Your account has been paused
          </h1>
          <p className="text-sm text-[var(--text-secondary)] mb-6 leading-relaxed">
            Access to your account has been restricted. To restore access, please contact our team and we&rsquo;ll get back to you shortly.
          </p>
          <a
            href={SUPPORT_MAILTO}
            className="inline-flex items-center justify-center gap-2 w-full rounded-lg bg-[var(--accent)] hover:brightness-110 px-4 py-2.5 text-sm font-semibold text-white transition-all"
          >
            <Mail size={14} />
            Contact support
          </a>
          <button
            onClick={handleLogout}
            disabled={loggingOut}
            className="mt-3 inline-flex items-center justify-center gap-2 w-full rounded-lg border border-[var(--border-subtle)] hover:bg-[rgba(255,255,255,0.04)] px-4 py-2.5 text-sm font-medium text-[var(--text-secondary)] transition-colors disabled:opacity-60"
          >
            {loggingOut ? <Loader2 size={14} className="animate-spin" /> : <LogOut size={14} />}
            Log out
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 10.2: Add `/account-paused` to `frontend/middleware.ts:5`**

Find:

```typescript
const PUBLIC_PATHS = ['/', '/login', '/register', '/onboarding', '/forgot-password', '/reset-password', '/verify-email', '/team/accept', '/terms', '/privacy', '/methodology'];
```

Replace with:

```typescript
const PUBLIC_PATHS = ['/', '/login', '/register', '/onboarding', '/forgot-password', '/reset-password', '/verify-email', '/team/accept', '/terms', '/privacy', '/methodology', '/account-paused'];
```

- [ ] **Step 10.3: Add `/account-paused` to `frontend/contexts/AuthContext.tsx:19`**

Find:

```typescript
const PUBLIC_PATHS = ['/', '/login', '/register', '/onboarding', '/forgot-password', '/reset-password', '/verify-email', '/team/accept', '/terms', '/privacy', '/methodology'];
```

Replace with:

```typescript
const PUBLIC_PATHS = ['/', '/login', '/register', '/onboarding', '/forgot-password', '/reset-password', '/verify-email', '/team/accept', '/terms', '/privacy', '/methodology', '/account-paused'];
```

- [ ] **Step 10.4: Build check**

Run: `cd frontend && npm run build`
Expected: clean build.

- [ ] **Step 10.5: Commit**

```bash
git add frontend/app/account-paused/page.tsx frontend/middleware.ts frontend/contexts/AuthContext.tsx
git commit -m "feat(paused): add /account-paused full-screen route"
```

---

## Task 11: Frontend — 403 interceptor in `lib/api.ts`

Add a 403 branch alongside the existing 401 handler. Detects `detail.code === 'account_paused'` and redirects to `/account-paused`.

**Files:**
- Modify: `frontend/lib/api.ts:13-35`

- [ ] **Step 11.1: Replace the response interceptor**

Find the existing block (lines 13-35):

```typescript
// ── 401 response interceptor ─────────────────────────────────────────────────
// When a session expires, redirect to /login automatically.
// Skip redirect for /auth/me (AuthContext handles it) and /auth/logout (expected).
api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (
      error?.response?.status === 401 &&
      typeof window !== 'undefined'
    ) {
      const url: string = error.config?.url ?? '';
      const isAuthMe = url.includes('/auth/me');
      const isAuthLogout = url.includes('/auth/logout');

      if (!isAuthMe && !isAuthLogout) {
        // Clear the JS-readable session cookie so middleware stops treating user as logged-in
        document.cookie = 'clarity_session=; path=/; max-age=0';
        window.location.href = '/login';
      }
    }
    return Promise.reject(error);
  },
);
```

Replace with:

```typescript
// ── Response interceptor: 401 (session) and 403 (paused account) ─────────────
// 401: redirect to /login on session expiry. Skip for /auth/me (AuthContext
//      owns that flow) and /auth/logout (expected to fail when not logged in).
// 403 with detail.code === 'account_paused': redirect to /account-paused.
//      Skip if already on that page (prevents redirect loop) or if the failing
//      request was /auth/logout (so the paused page can still log the user out).
api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (typeof window === 'undefined') return Promise.reject(error);

    const status: number | undefined = error?.response?.status;
    const url: string = error.config?.url ?? '';
    const isAuthMe = url.includes('/auth/me');
    const isAuthLogout = url.includes('/auth/logout');

    if (status === 403) {
      const detail = error?.response?.data?.detail;
      const code = detail && typeof detail === 'object' ? detail.code : null;
      if (
        code === 'account_paused' &&
        !isAuthLogout &&
        window.location.pathname !== '/account-paused'
      ) {
        window.location.href = '/account-paused';
      }
    } else if (status === 401) {
      if (!isAuthMe && !isAuthLogout) {
        // Clear the JS-readable session cookie so middleware stops treating user as logged-in
        document.cookie = 'clarity_session=; path=/; max-age=0';
        window.location.href = '/login';
      }
    }

    return Promise.reject(error);
  },
);
```

- [ ] **Step 11.2: Lint + build check**

Run: `cd frontend && npm run lint && npm run build`
Expected: clean.

- [ ] **Step 11.3: Commit**

```bash
git add frontend/lib/api.ts
git commit -m "feat(api): redirect to /account-paused on structured 403"
```

---

## Task 12: Verification — backend tests + frontend smoke

No code changes in this task. This is the manual verification gate before merging.

**Files:** none

- [ ] **Step 12.1: Run full backend test suite**

Run: `cd backend && source venv/bin/activate && pytest tests/ -v`
Expected: all green. If anything in `test_auth.py` or `test_billing.py` regresses, stop and investigate before merging.

- [ ] **Step 12.2: Run frontend lint + build**

Run: `cd frontend && npm run lint && npm run build`
Expected: clean.

- [ ] **Step 12.3: Manual smoke — paused flow**

Start backend on port 3001 and frontend on port 3002 (per project convention):

```bash
# Terminal 1
cd backend && source venv/bin/activate && uvicorn app.main:app --reload --port 3001
# Terminal 2
cd frontend && npm run dev -- -p 3002
```

Pick a test user (or register one). Then:

```bash
sqlite3 backend/clarity_ai.db "UPDATE users SET is_paused = 1 WHERE email = 'YOUR_EMAIL';"
```

In the browser:
1. Log in as that user → expect immediate redirect to `/account-paused`. Verify: no sidebar visible, no API errors in browser console, page renders the support card.
2. Click "Contact support" → mailto opens in default mail client with prefilled subject.
3. Click "Log out" → cookies cleared, redirected to `/login`.
4. Log in normally as a non-paused user, then in another terminal flip `is_paused=1` for that user. In the browser, navigate to any page (e.g., `/dashboard`) → expect redirect to `/account-paused` on the next API call.

Reset: `sqlite3 backend/clarity_ai.db "UPDATE users SET is_paused = 0 WHERE email = 'YOUR_EMAIL';"`

- [ ] **Step 12.4: Manual smoke — billing banner**

For each status, run the corresponding SQL update and reload `/dashboard`. Verify the red banner appears with the correct copy and a "Manage billing" CTA. Then navigate to `/settings/billing` and confirm the banner is suppressed there.

```bash
# past_due
sqlite3 backend/clarity_ai.db "UPDATE users SET subscription_status='past_due' WHERE email='YOUR_EMAIL';"

# canceled
sqlite3 backend/clarity_ai.db "UPDATE users SET subscription_status='canceled' WHERE email='YOUR_EMAIL';"

# unpaid
sqlite3 backend/clarity_ai.db "UPDATE users SET subscription_status='unpaid' WHERE email='YOUR_EMAIL';"

# incomplete_expired
sqlite3 backend/clarity_ai.db "UPDATE users SET subscription_status='incomplete_expired' WHERE email='YOUR_EMAIL';"

# trial ended (status=trialing, trial_end yesterday)
sqlite3 backend/clarity_ai.db "UPDATE users SET subscription_status='trialing', subscription_trial_end=datetime('now','-1 day') WHERE email='YOUR_EMAIL';"
```

For each, verify:
- Red banner appears at the top of `/dashboard`
- Banner persists on `/content`, `/reports`, `/settings`, `/team`
- Banner is suppressed on `/settings/billing`
- "Manage billing" link routes to `/settings/billing`

Reset: `sqlite3 backend/clarity_ai.db "UPDATE users SET subscription_status='active', subscription_trial_end=NULL WHERE email='YOUR_EMAIL';"`

- [ ] **Step 12.5: Manual smoke — no-regression cases**

1. With `subscription_status='active'`: verify NO banner anywhere.
2. With `subscription_status='trialing'` and `subscription_trial_end` 5 days in the future: verify the soft amber `SubscriptionBanner` shows on `/dashboard` and `/content` (existing behavior), and NO red banner.
   - SQL: `UPDATE users SET subscription_status='trialing', subscription_trial_end=datetime('now','+5 days') WHERE email='YOUR_EMAIL';`
3. Log out and load `/login` directly: verify NO banner.
4. As an admin user with `is_paused=1`: verify the user can use the app normally (NOT redirected to `/account-paused`). SQL: `UPDATE users SET is_paused=1, is_admin=1 WHERE email='YOUR_EMAIL';`
5. Existing 401 flow: clear `clarity_token` cookie in browser devtools, then click anything → expect redirect to `/login` (existing behavior unchanged).

Reset all test fields after smoke is complete:
```bash
sqlite3 backend/clarity_ai.db "UPDATE users SET is_paused=0, subscription_status='active', subscription_trial_end=NULL WHERE email='YOUR_EMAIL';"
```

- [ ] **Step 12.6: Capture evidence**

Screenshot the four key states for the PR description:
1. `/account-paused` page
2. Red banner with `past_due` copy on `/dashboard`
3. Red banner with `trial_ended` copy on `/dashboard`
4. `/settings/billing` showing the banner is suppressed

---

## Spec Coverage Self-Review

Cross-checking the plan against `docs/superpowers/specs/2026-04-29-paused-trial-ended-ui-design.md`:

- ✅ Paused account dedicated page → Task 10
- ✅ Persistent global banner for blocking billing states → Tasks 6, 7, 8
- ✅ Existing `SubscriptionBanner` narrowed to trial-ending-soon → Task 9
- ✅ Backend structured 403 detail (both deps) → Tasks 1, 2
- ✅ Backend `/auth/me` exposes `subscription_trial_end` → Task 4
- ✅ Frontend `AuthUser` type extension → Task 5
- ✅ 403 interceptor with loop prevention → Task 11
- ✅ Middleware + AuthContext public-paths update → Task 10
- ✅ NO_SIDEBAR_PATHS update → Task 8
- ✅ Suppress on `/settings/billing` → Task 7 component logic
- ✅ Logout from paused page (with fallback) → Task 10 page code
- ✅ Backend test for paused logout → Task 3
- ✅ Admin/impersonation bypass tests → Task 3
- ✅ Manual smoke for all states + no-regression checks → Task 12

No gaps identified.
