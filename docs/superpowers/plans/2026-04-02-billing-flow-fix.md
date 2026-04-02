# Billing Flow Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove free-trial logic from paid checkouts, grant tier access immediately on payment, and refresh the sidebar plan label after a successful payment redirect.

**Architecture:** Three independent changes — (1) strip trial kwargs from the backend checkout and fix the webhook to write tier+active status in one event, (2) drop the trial banner and call `refresh()` on the billing success page so AuthContext (and thus the sidebar) reflects the new plan, (3) remove the TRIAL badge from the sidebar since no new subscriber will ever be trialing. Each change is self-contained; all three must land together for the flow to be correct end-to-end.

**Tech Stack:** Python 3.11 / FastAPI / SQLAlchemy async (backend); Next.js 15 / TypeScript / React (frontend); Stripe Python SDK; pytest-asyncio; unittest.mock

---

## Files

| File | Change |
|------|--------|
| `backend/app/routers/billing.py` | Remove `TRIAL_TIERS`, `TRIAL_DAYS`, trial kwargs; add session metadata; fix `checkout.session.completed` handler |
| `backend/tests/test_billing.py` | Add tests: checkout has no trial days; checkout session carries tier metadata; webhook sets active status + tier |
| `frontend/app/settings/billing/page.tsx` | Remove `trialParam`; call `refresh()` on success; clean up trial copy |
| `frontend/components/Sidebar.tsx` | Remove TRIAL badge |

---

### Task 1: Remove trial logic from checkout creation + fix webhook

**Files:**
- Modify: `backend/app/routers/billing.py`

#### What to change

**Lines 36-38** — delete `TRIAL_TIERS` and `TRIAL_DAYS`:
```python
# DELETE these two lines entirely:
TRIAL_TIERS = {"starter", "pro"}
TRIAL_DAYS = 30
```

**Lines 225-249** — in `create_checkout`, replace the trial URL and session kwargs block:

Current code (lines 225–249):
```python
    # Append trial=true to the success URL so the frontend can display the right message
    success_url = request.success_url
    if request.tier in TRIAL_TIERS:
        sep = "&" if "?" in success_url else "?"
        success_url = f"{success_url}{sep}trial=true"

    session_kwargs: dict = dict(
        customer=customer_id,
        payment_method_types=["card"],
        line_items=[{"price": price_id, "quantity": 1}],
        mode="subscription",
        success_url=success_url,
        cancel_url=request.cancel_url,
        # Always collect payment method upfront — required for trials
        payment_method_collection="always",
        subscription_data={
            "metadata": {"user_id": str(user.id), "tier": request.tier},
        },
    )
    if request.tier in TRIAL_TIERS:
        session_kwargs["subscription_data"]["trial_period_days"] = TRIAL_DAYS
        # Allow users to cancel during trial without being charged
        session_kwargs["subscription_data"]["trial_settings"] = {
            "end_behavior": {"missing_payment_method": "cancel"}
        }
```

Replace with:
```python
    session_kwargs: dict = dict(
        customer=customer_id,
        payment_method_types=["card"],
        line_items=[{"price": price_id, "quantity": 1}],
        mode="subscription",
        success_url=request.success_url,
        cancel_url=request.cancel_url,
        metadata={"user_id": str(user.id), "tier": request.tier},
        subscription_data={
            "metadata": {"user_id": str(user.id), "tier": request.tier},
        },
    )
```

Note: `metadata` is now set on **both** the session (so `checkout.session.completed` can read it directly) and `subscription_data` (so `customer.subscription.created` can read it). No trial kwargs.

**Lines 416-452** — in the `checkout.session.completed` webhook handler, replace the entire `if user:` block:

Current:
```python
        if user:
            from datetime import datetime, timedelta, timezone
            changed = False
            if sub_id and not user.stripe_subscription_id:
                user.stripe_subscription_id = sub_id
                changed = True
            if not user.subscription_trial_end:
                user.subscription_trial_end = (
                    datetime.now(timezone.utc).replace(tzinfo=None)
                    + timedelta(days=TRIAL_DAYS)
                )
                changed = True
            if not user.subscription_status:
                user.subscription_status = "trialing"
                changed = True
            if changed:
                user.updated_at = utcnow()
                await db.commit()
```

Replace with:
```python
        if user:
            tier = data_obj.get("metadata", {}).get("tier")
            changed = False
            if sub_id and not user.stripe_subscription_id:
                user.stripe_subscription_id = sub_id
                changed = True
            if tier and user.subscription_tier != tier:
                user.subscription_tier = tier
                changed = True
            if user.subscription_status != "active":
                user.subscription_status = "active"
                changed = True
            user.subscription_trial_end = None
            if changed:
                user.updated_at = utcnow()
                await db.commit()
```

- [ ] **Step 1: Apply all three edits to `billing.py`** (delete TRIAL_TIERS/TRIAL_DAYS, replace session_kwargs block, replace checkout.session.completed handler)

- [ ] **Step 2: Verify the file still imports cleanly**

```bash
cd /Users/ken/Desktop/Lumidian/backend && source venv/bin/activate && python -c "from app.routers.billing import router; print('OK')"
```
Expected: `OK`

- [ ] **Step 3: Commit**

```bash
cd /Users/ken/Desktop/Lumidian/backend
git add app/routers/billing.py
git commit -m "fix: remove trial logic from checkout; set tier+active immediately on checkout.session.completed"
```

---

### Task 2: Update billing tests

**Files:**
- Modify: `backend/tests/test_billing.py`

- [ ] **Step 1: Write the new tests**

Add the following test functions at the end of `backend/tests/test_billing.py`:

```python
async def test_create_checkout_has_no_trial(client: httpx.AsyncClient):
    """create-checkout must NOT include trial_period_days in subscription_data."""
    await register_and_login(client, email="billing_notrial@example.com")

    mock_customer = MagicMock()
    mock_customer.id = "cus_notrial_fake"

    mock_session = MagicMock()
    mock_session.url = "https://checkout.stripe.com/pay/cs_notrial"

    captured_kwargs: dict = {}

    def capture_session(**kwargs):
        captured_kwargs.update(kwargs)
        return mock_session

    with (
        patch("stripe.Customer.create", return_value=mock_customer),
        patch("stripe.checkout.Session.create", side_effect=capture_session),
    ):
        with patch.dict("os.environ", {"STRIPE_STARTER_PRICE_ID": "price_test_starter"}):
            resp = await client.post(
                "/api/billing/create-checkout",
                json={"tier": "starter"},
            )

    assert resp.status_code == 200
    sub_data = captured_kwargs.get("subscription_data", {})
    assert "trial_period_days" not in sub_data, "Trial period must not be set on paid checkout"
    assert "trial_settings" not in sub_data, "Trial settings must not be set on paid checkout"


async def test_create_checkout_session_carries_tier_metadata(client: httpx.AsyncClient):
    """checkout session must carry tier in session-level metadata (for checkout.session.completed)."""
    await register_and_login(client, email="billing_meta@example.com")

    mock_customer = MagicMock()
    mock_customer.id = "cus_meta_fake"

    mock_session = MagicMock()
    mock_session.url = "https://checkout.stripe.com/pay/cs_meta"

    captured_kwargs: dict = {}

    def capture_session(**kwargs):
        captured_kwargs.update(kwargs)
        return mock_session

    with (
        patch("stripe.Customer.create", return_value=mock_customer),
        patch("stripe.checkout.Session.create", side_effect=capture_session),
    ):
        with patch.dict("os.environ", {"STRIPE_STARTER_PRICE_ID": "price_test_starter"}):
            resp = await client.post(
                "/api/billing/create-checkout",
                json={"tier": "starter"},
            )

    assert resp.status_code == 200
    session_meta = captured_kwargs.get("metadata", {})
    assert session_meta.get("tier") == "starter", "Session metadata must include tier"


async def test_webhook_checkout_completed_sets_active_tier(client: httpx.AsyncClient):
    """checkout.session.completed webhook must set subscription_tier and status='active', not 'trialing'."""
    import os
    import hmac
    import hashlib
    import time
    import json

    user_data = await register_and_login(client, email="billing_webhook@example.com", subscription_tier=None)

    # Give the user a Stripe customer ID in the DB (normally set during checkout)
    # We'll patch the lookup — simulate the webhook arriving with the user's customer ID
    customer_id = "cus_webhook_test"

    # Directly set customer_id on the user via the DB helper used in conftest
    from app.database import AsyncSessionLocal
    from sqlalchemy import update
    from app.models import User
    async with AsyncSessionLocal() as db:
        await db.execute(
            update(User)
            .where(User.email == "billing_webhook@example.com")
            .values(stripe_customer_id=customer_id)
        )
        await db.commit()

    payload = {
        "type": "checkout.session.completed",
        "data": {
            "object": {
                "customer": customer_id,
                "subscription": "sub_webhook_test",
                "metadata": {"tier": "starter", "user_id": "1"},
            }
        },
    }
    body = json.dumps(payload).encode()

    webhook_secret = "whsec_test_secret"
    ts = str(int(time.time()))
    sig_payload = f"{ts}.{body.decode()}"
    sig = hmac.new(webhook_secret.encode(), sig_payload.encode(), hashlib.sha256).hexdigest()
    stripe_sig = f"t={ts},v1={sig}"

    with patch.dict("os.environ", {
        "STRIPE_SECRET_KEY": "sk_test_fake",
        "STRIPE_WEBHOOK_SECRET": webhook_secret,
    }):
        import stripe as _stripe
        with patch.object(_stripe.Webhook, "construct_event", return_value=payload):
            resp = await client.post(
                "/api/billing/webhook",
                content=body,
                headers={"stripe-signature": stripe_sig, "content-type": "application/json"},
            )

    assert resp.status_code == 200

    resp2 = await client.get("/api/billing/status")
    data = resp2.json()
    assert data["subscription_tier"] == "starter", f"Expected starter, got {data['subscription_tier']}"
    assert data["subscription_status"] == "active", f"Expected active, got {data['subscription_status']}"
    assert data.get("subscription_trial_end") is None, "Trial end must be None after paid checkout"
```

- [ ] **Step 2: Run the new tests**

```bash
cd /Users/ken/Desktop/Lumidian/backend && source venv/bin/activate
pytest tests/test_billing.py -v
```
Expected: All tests pass. The three new tests (`test_create_checkout_has_no_trial`, `test_create_checkout_session_carries_tier_metadata`, `test_webhook_checkout_completed_sets_active_tier`) must be green.

- [ ] **Step 3: Commit**

```bash
git add tests/test_billing.py
git commit -m "test: verify no trial on checkout, tier metadata on session, webhook sets active"
```

---

### Task 3: Fix billing page — remove trial param, call refresh() on success

**Files:**
- Modify: `frontend/app/settings/billing/page.tsx`

- [ ] **Step 1: Apply the following diff to `frontend/app/settings/billing/page.tsx`**

**3a. Remove `trialParam` from the `useSearchParams` destructure (line ~26):**

Current:
```tsx
  const successParam = searchParams.get('success');
  const trialParam = searchParams.get('trial');
```

Replace with:
```tsx
  const successParam = searchParams.get('success');
```

**3b. Import `refresh` from `useAuth` and call it on success mount.**

Current import at the top of the component:
```tsx
  const { user } = useAuth();
```

Replace with:
```tsx
  const { user, refresh } = useAuth();
```

**3c. In the existing `useEffect` that loads billing status, also call `refresh()` when `successParam === 'true'`:**

Current:
```tsx
  useEffect(() => {
    getBillingStatus()
      .then(setStatus)
      .catch(() => setLoadError('Could not load billing status. Please refresh the page.'))
      .finally(() => setLoading(false));
  }, []);
```

Replace with:
```tsx
  useEffect(() => {
    const init = async () => {
      try {
        const [s] = await Promise.all([
          getBillingStatus(),
          successParam === 'true' ? refresh() : Promise.resolve(),
        ]);
        setStatus(s);
      } catch {
        setLoadError('Could not load billing status. Please refresh the page.');
      } finally {
        setLoading(false);
      }
    };
    init();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
```

**3d. Remove the "Trial started" banner (lines ~125–133):**

Current:
```tsx
      {/* Trial started banner */}
      {trialParam === 'true' && (
        <div className="flex items-start gap-3 bg-[#064e3b]/20 border border-[#065f46]/40 rounded-xl px-4 py-3 mb-6">
          <CheckCircle2 size={16} className="text-[#10b981] flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-sm text-[#10b981] font-medium">Free trial started!</p>
            <p className="text-xs text-[#34d399]/70 mt-0.5">You won&apos;t be charged for 30 days. Cancel any time before your trial ends to avoid being billed.</p>
          </div>
        </div>
      )}
```

Delete those lines entirely.

**3e. Update the success banner (lines ~136–141) to include the tier name:**

Current:
```tsx
      {/* Success banner */}
      {successParam === 'true' && trialParam !== 'true' && (
        <div className="flex items-center gap-3 bg-[#064e3b]/20 border border-[#065f46]/40 rounded-xl px-4 py-3 mb-6">
          <CheckCircle2 size={16} className="text-[#10b981] flex-shrink-0" />
          <p className="text-sm text-[#10b981] font-medium">Subscription activated! Your plan has been updated.</p>
        </div>
      )}
```

Replace with:
```tsx
      {/* Success banner */}
      {successParam === 'true' && (
        <div className="flex items-center gap-3 bg-[#064e3b]/20 border border-[#065f46]/40 rounded-xl px-4 py-3 mb-6">
          <CheckCircle2 size={16} className="text-[#10b981] flex-shrink-0" />
          <p className="text-sm text-[#10b981] font-medium">
            {currentTier
              ? `${currentTier.charAt(0).toUpperCase() + currentTier.slice(1)} plan activated — you now have full access.`
              : 'Subscription activated! Your plan has been updated.'}
          </p>
        </div>
      )}
```

**3f. Remove the "Free trial active" section (lines ~217–231):**

Current:
```tsx
            {/* Trial status */}
            {status?.subscription_status === 'trialing' && status.subscription_trial_end && (
              <div className="flex items-start gap-2 bg-[#10b981]/10 border border-[#10b981]/20 rounded-lg px-3 py-2.5 mt-3">
                <Clock size={13} className="text-[#10b981] flex-shrink-0 mt-0.5" />
                <div>
                  <p className="text-xs font-medium text-[#10b981]">Free trial active</p>
                  <p className="text-xs text-[#64748b] mt-0.5">
                    Trial ends{' '}
                    <span className="text-[#94a3b8] font-medium">
                      {new Date(status.subscription_trial_end + 'Z').toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}
                    </span>
                    . Your card will be charged automatically unless you cancel before then.
                  </p>
                </div>
              </div>
            )}
```

Delete those lines entirely.

**3g. Remove the `Clock` icon from the lucide import** (no longer used after removing trial status section):

Current:
```tsx
import { CreditCard, Check, Loader2, Zap, AlertTriangle, CheckCircle2, Clock, X } from 'lucide-react';
```

Replace with:
```tsx
import { CreditCard, Check, Loader2, Zap, AlertTriangle, CheckCircle2, X } from 'lucide-react';
```

**3h. Also remove the cancel dialog trial copy (lines ~93–98):**

Current:
```tsx
            {status?.subscription_status === 'trialing' && status.subscription_trial_end ? (
              <p className="text-xs text-[#64748b] mb-4">
                You are currently in your free trial. Cancelling now means you won&apos;t be charged on{' '}
                <span className="text-[#e2e8f0] font-medium">{new Date(status.subscription_trial_end + 'Z').toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}</span>{' '}
                and your account will revert to the free plan.
              </p>
            ) : (
              <p className="text-xs text-[#64748b] mb-4">
                Your plan will remain active until the end of the current billing period, then revert to the free plan.
              </p>
            )}
```

Replace with:
```tsx
            <p className="text-xs text-[#64748b] mb-4">
              Your plan will remain active until the end of the current billing period, then revert to the free plan.
            </p>
```

- [ ] **Step 2: Type-check**

```bash
cd /Users/ken/Desktop/Lumidian/frontend && npx tsc --noEmit 2>&1
```
Expected: no output (clean).

- [ ] **Step 3: Commit**

```bash
cd /Users/ken/Desktop/Lumidian/frontend
git add app/settings/billing/page.tsx
git commit -m "fix: remove trial banner; call refresh() on payment success so sidebar updates immediately"
```

---

### Task 4: Remove TRIAL badge from Sidebar

**Files:**
- Modify: `frontend/components/Sidebar.tsx`

- [ ] **Step 1: Remove the TRIAL badge block**

Find and delete this block (approximately lines 480–484):
```tsx
                  {user?.subscription_status === 'trialing' && (
                    <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded-full bg-[#166534]/30 text-[#4ade80] border border-[#166534]/40 leading-none">
                      TRIAL
                    </span>
                  )}
```

Delete those 4 lines entirely.

- [ ] **Step 2: Type-check**

```bash
cd /Users/ken/Desktop/Lumidian/frontend && npx tsc --noEmit 2>&1
```
Expected: no output.

- [ ] **Step 3: Commit**

```bash
git add components/Sidebar.tsx
git commit -m "fix: remove TRIAL badge from sidebar — no new subscribers will be in trial"
```

---

### Task 5: End-to-end smoke test

This is a manual verification step using Stripe CLI and test cards.

- [ ] **Step 1: Start services**

Terminal 1 — backend:
```bash
cd /Users/ken/Desktop/Lumidian/backend && source venv/bin/activate
uvicorn app.main:app --reload --port 3001
```

Terminal 2 — frontend:
```bash
cd /Users/ken/Desktop/Lumidian/frontend && npm run dev
```

Terminal 3 — Stripe CLI webhook forwarding:
```bash
stripe listen --forward-to localhost:3001/api/billing/webhook
```
Copy the `whsec_...` printed and confirm it's set in `backend/.env` as `STRIPE_WEBHOOK_SECRET`.

- [ ] **Step 2: Verify checkout creates no trial**

1. Log in as a free user at `http://localhost:3002`
2. Go to `/settings/billing`
3. Click **Subscribe** on Starter
4. On the Stripe checkout page, confirm there is **no** "Free trial" section — should show the first billing charge immediately
5. Enter card `4242 4242 4242 4242`, any future date, any CVC
6. Submit

- [ ] **Step 3: Verify post-payment state**

After Stripe redirects back to `/settings/billing?success=true`:
1. Banner shows "Starter plan activated — you now have full access." (not "Free trial started!")
2. "Current Plan" card shows **Starter Plan**
3. Bottom-left sidebar shows **Starter Plan** (not "Free Plan") — this confirms `refresh()` ran
4. No "TRIAL" badge visible anywhere

- [ ] **Step 4: Verify backend DB state**

```bash
cd /Users/ken/Desktop/Lumidian/backend
sqlite3 clarity_ai.db "SELECT email, subscription_tier, subscription_status, subscription_trial_end FROM users WHERE email = '<your test email>';"
```
Expected:
```
<email>|starter|active|
```
`subscription_trial_end` column must be empty.

- [ ] **Step 5: Final commit (if any cleanup needed)**

```bash
git add -p  # only if there are any leftover changes
git commit -m "fix: billing e2e verified — no trial, immediate access, sidebar refresh"
```
