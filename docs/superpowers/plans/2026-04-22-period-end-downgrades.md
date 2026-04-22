# Period-End Downgrades Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Defer subscription downgrades to `current_period_end` via Stripe Subscription Schedules so users keep paid-for features through the end of the period. Upgrades remain immediate. Also fixes `_upgrade_brands_for_tier` to sync brand state on downgrades.

**Architecture:** Add three nullable columns to `User` (`pending_tier`, `pending_tier_effective_at`, `stripe_schedule_id`). Refactor `POST /api/billing/change-plan` into a state machine that creates/amends/releases `stripe.SubscriptionSchedule` objects for downgrades and supersede cases, and keeps immediate `Subscription.modify` for upgrades. Webhook handlers clear pending state on transition. Frontend surfaces the pending state as a banner with a cancel action.

**Tech Stack:** FastAPI, SQLAlchemy async, Stripe Python SDK, Next.js 15, React 18, TypeScript.

**Spec:** `docs/superpowers/specs/2026-04-22-period-end-downgrades-design.md`

---

## File Structure

- **Modify** `backend/app/models.py` — add 3 nullable columns to `User`.
- **Modify** `backend/app/database.py` — append 3 `ALTER TABLE` migrations at the bottom of `run_migrations()`.
- **Modify** `backend/app/routers/billing.py` — add `TIER_ORDER`, rewrite `change_plan` endpoint, extend cancel endpoint, rename `_upgrade_brands_for_tier` → `_sync_brands_for_tier` and add downgrade branches, extend webhook handler for new events and pending-state clearing.
- **Modify** `backend/tests/test_billing.py` — add tests for every new branch and webhook handler.
- **Modify** `frontend/lib/api.ts` — extend `BillingStatus` type with pending fields.
- **Modify** `frontend/app/settings/billing/page.tsx` — pending-downgrade banner with cancel action, plan card badges.

---

## Task 1: Add pending-tier columns to `User`

**Files:**
- Modify: `backend/app/models.py` (find the `User` class, add columns near other subscription columns around line 56)
- Modify: `backend/app/database.py` (append to `run_migrations()`)

- [ ] **Step 1: Add columns to the User model**

Open `backend/app/models.py`. Find the `User` class. After the existing `admin_tier_override` column (around line 63), add:

```python
pending_tier: Mapped[str | None] = mapped_column(String(50), nullable=True)
pending_tier_effective_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
stripe_schedule_id: Mapped[str | None] = mapped_column(String(255), nullable=True)
```

`DateTime` and `datetime` are already imported at the top of the file. `Mapped`, `mapped_column`, and `String` are already imported.

- [ ] **Step 2: Append migrations**

Open `backend/app/database.py`. Find `run_migrations()`. At the very bottom of the migrations list (after the most recent `ALTER TABLE` entry), append:

```python
# 2026-04-22: Period-end downgrades — track pending tier transitions
"ALTER TABLE users ADD COLUMN pending_tier VARCHAR(50)",
"ALTER TABLE users ADD COLUMN pending_tier_effective_at DATETIME",
"ALTER TABLE users ADD COLUMN stripe_schedule_id VARCHAR(255)",
```

Do not modify any existing migration step.

- [ ] **Step 3: Run the backend test suite — verify existing tests still pass**

Run: `cd backend && source venv/bin/activate && pytest tests/ -x -q`
Expected: all tests pass. The new columns are nullable and default to `NULL` so they don't break any existing logic.

- [ ] **Step 4: Commit**

```bash
git add backend/app/models.py backend/app/database.py
git commit -m "feat(billing): add pending-tier columns to User for scheduled downgrades"
```

---

## Task 2: Rename `_upgrade_brands_for_tier` → `_sync_brands_for_tier` and add downgrade branches

**Files:**
- Modify: `backend/app/routers/billing.py` (function at line 482, call sites at 599 and 649)
- Modify: `backend/tests/test_billing.py`

- [ ] **Step 1: Write failing test for `starter` tier downgrade branch**

Open `backend/tests/test_billing.py`. Add this test at the bottom:

```python
async def test_sync_brands_for_tier_downgrades_pro_brands_to_starter():
    """When a user downgrades to starter (Growth), any brand_type='pro' brand
    must be moved back to 'standard' with prompt_limit=25."""
    from app.database import AsyncSessionLocal
    from app.models import Brand, User, utcnow
    from app.routers.billing import _sync_brands_for_tier

    async with AsyncSessionLocal() as db:
        user = User(email="sync_dg_starter@example.com", password_hash="x", email_verified=1)
        db.add(user)
        await db.flush()
        brand = Brand(
            user_id=user.id, name="Pro Brand", slug="pro-brand-sync-starter",
            tier="basic", brand_type="pro", prompt_limit=30,
        )
        db.add(brand)
        await db.commit()
        brand_id = brand.id
        await _sync_brands_for_tier(db, user.id, "starter")
        await db.commit()
        await db.refresh(brand)
        assert brand.brand_type == "standard"
        assert brand.prompt_limit == 25
```

- [ ] **Step 2: Run test — verify it fails with ImportError**

Run: `cd backend && pytest tests/test_billing.py::test_sync_brands_for_tier_downgrades_pro_brands_to_starter -v`
Expected: `ImportError` or `AttributeError` on `_sync_brands_for_tier` (the function is currently called `_upgrade_brands_for_tier`).

- [ ] **Step 3: Rename function and extend branches**

Open `backend/app/routers/billing.py`. Replace the entire `_upgrade_brands_for_tier` function (lines 482–514) with:

```python
async def _sync_brands_for_tier(db: AsyncSession, user_id: int, tier: str) -> None:
    """Sync a user's brand rows to match their subscription tier.

    Handles both directions: upgrades pitch/standard brands on tier increase,
    and demotes pro brands back to standard on tier decrease. Idempotent.
    """
    from sqlalchemy import update as sa_update

    from app.models import Brand

    if tier == "pro":
        result = await db.execute(
            sa_update(Brand)
            .where(Brand.user_id == user_id, Brand.brand_type.in_(["standard", "pitch"]))
            .values(brand_type="pro", prompt_limit=30)
        )
        if result.rowcount > 0:
            logger.info("Synced %d brand(s) up to pro for user %d", result.rowcount, user_id)
    elif tier == "starter":
        # Pitch → standard (Growth)
        await db.execute(
            sa_update(Brand)
            .where(Brand.user_id == user_id, Brand.brand_type == "pitch")
            .values(brand_type="standard", prompt_limit=25)
        )
        # Pro → standard (downgrade)
        dg = await db.execute(
            sa_update(Brand)
            .where(Brand.user_id == user_id, Brand.brand_type == "pro")
            .values(brand_type="standard", prompt_limit=25)
        )
        if dg.rowcount > 0:
            logger.info("Synced %d pro brand(s) down to standard for user %d (tier=starter)", dg.rowcount, user_id)
    elif tier == "basic":
        # Pitch → standard (Starter)
        await db.execute(
            sa_update(Brand)
            .where(Brand.user_id == user_id, Brand.brand_type == "pitch")
            .values(brand_type="standard", prompt_limit=10)
        )
        # Pro → standard (downgrade)
        dg = await db.execute(
            sa_update(Brand)
            .where(Brand.user_id == user_id, Brand.brand_type == "pro")
            .values(brand_type="standard", prompt_limit=10)
        )
        if dg.rowcount > 0:
            logger.info("Synced %d pro brand(s) down to standard for user %d (tier=basic)", dg.rowcount, user_id)
```

- [ ] **Step 4: Update the two call sites**

In the same file, change `await _upgrade_brands_for_tier(` to `await _sync_brands_for_tier(` on lines 599 and 649.

Use grep to verify no other call sites remain:

Run: `cd backend && grep -n "_upgrade_brands_for_tier" app/routers/billing.py`
Expected: no output.

- [ ] **Step 5: Run the new test and the full billing test file**

Run: `cd backend && pytest tests/test_billing.py -v`
Expected: all tests pass including `test_sync_brands_for_tier_downgrades_pro_brands_to_starter`.

- [ ] **Step 6: Add a second test for the `basic` branch**

Append to `backend/tests/test_billing.py`:

```python
async def test_sync_brands_for_tier_downgrades_pro_brands_to_basic():
    """Starter (basic) downgrade: pro brand → standard with prompt_limit=10."""
    from app.database import AsyncSessionLocal
    from app.models import Brand, User
    from app.routers.billing import _sync_brands_for_tier

    async with AsyncSessionLocal() as db:
        user = User(email="sync_dg_basic@example.com", password_hash="x", email_verified=1)
        db.add(user)
        await db.flush()
        brand = Brand(
            user_id=user.id, name="Pro Brand B", slug="pro-brand-sync-basic",
            tier="basic", brand_type="pro", prompt_limit=30,
        )
        db.add(brand)
        await db.commit()
        await _sync_brands_for_tier(db, user.id, "basic")
        await db.commit()
        await db.refresh(brand)
        assert brand.brand_type == "standard"
        assert brand.prompt_limit == 10
```

Run: `cd backend && pytest tests/test_billing.py::test_sync_brands_for_tier_downgrades_pro_brands_to_basic -v`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add backend/app/routers/billing.py backend/tests/test_billing.py
git commit -m "fix(billing): sync pro brands down to standard on tier downgrade

Renames _upgrade_brands_for_tier to _sync_brands_for_tier and adds
downgrade branches so brand_type and prompt_limit correctly track
subscription tier changes in both directions."
```

---

## Task 3: Add `TIER_ORDER` constant

**Files:**
- Modify: `backend/app/routers/billing.py`

- [ ] **Step 1: Add the constant near the other tier constants**

Open `backend/app/routers/billing.py`. Just below the `TIER_PRICES` definition (around line 54), add:

```python
# Integer ordering used to detect upgrade vs downgrade in change-plan.
# Free (None) is not included — downgrading to Free goes through /cancel.
TIER_ORDER = {"basic": 1, "starter": 2, "pro": 3}
```

- [ ] **Step 2: Commit (no test needed — pure data)**

```bash
git add backend/app/routers/billing.py
git commit -m "chore(billing): add TIER_ORDER for upgrade/downgrade direction detection"
```

---

## Task 4: Refactor `change_plan` — downgrade creates a `SubscriptionSchedule`

**Files:**
- Modify: `backend/app/routers/billing.py` (function at line 365)
- Modify: `backend/tests/test_billing.py`

- [ ] **Step 1: Write failing test — downgrade creates schedule, keeps tier**

Append to `backend/tests/test_billing.py`:

```python
async def test_change_plan_downgrade_creates_schedule_and_keeps_current_tier(client: httpx.AsyncClient):
    """Pro → Growth downgrade: creates SubscriptionSchedule, sets pending fields,
    does NOT change subscription_tier locally."""
    from sqlalchemy import text
    from app.database import AsyncSessionLocal

    await register_and_login(client, email="dg_create@example.com", subscription_tier="pro")
    # Give the test user a fake stripe subscription id
    async with AsyncSessionLocal() as db:
        await db.execute(
            text("UPDATE users SET stripe_subscription_id = :sid WHERE email = :email"),
            {"sid": "sub_test_fake", "email": "dg_create@example.com"},
        )
        await db.commit()

    # Mock Stripe: SubscriptionSchedule.create returns an object with phases
    fake_schedule = {
        "id": "sub_sched_fake",
        "phases": [{
            "items": [{"price": "price_test_pro", "quantity": 1}],
            "start_date": 1713200000,
            "end_date": 1715792000,
        }],
    }
    with (
        patch.dict("os.environ", {"STRIPE_STARTER_PRICE_ID": "price_test_starter", "STRIPE_PRO_PRICE_ID": "price_test_pro"}),
        patch("stripe.SubscriptionSchedule.create", return_value=fake_schedule) as mock_create,
        patch("stripe.SubscriptionSchedule.modify", return_value=fake_schedule) as mock_modify,
    ):
        resp = await client.post("/api/billing/change-plan", json={"tier": "starter"})

    assert resp.status_code == 200, resp.text
    mock_create.assert_called_once_with(from_subscription="sub_test_fake")
    mock_modify.assert_called_once()

    # Verify local state
    async with AsyncSessionLocal() as db:
        from app.models import User
        from sqlalchemy import select
        u = (await db.execute(select(User).where(User.email == "dg_create@example.com"))).scalar_one()
        assert u.subscription_tier == "pro"  # unchanged!
        assert u.pending_tier == "starter"
        assert u.stripe_schedule_id == "sub_sched_fake"
        assert u.pending_tier_effective_at is not None
```

- [ ] **Step 2: Run — verify FAIL**

Run: `cd backend && pytest tests/test_billing.py::test_change_plan_downgrade_creates_schedule_and_keeps_current_tier -v`
Expected: FAIL. The current endpoint immediately modifies the subscription and doesn't touch `SubscriptionSchedule`.

- [ ] **Step 3: Rewrite the `change_plan` endpoint**

Replace the entire body of the `change_plan` endpoint in `backend/app/routers/billing.py` (lines 365–435) with:

```python
@router.post("/change-plan")
async def change_plan(
    request: ChangePlanRequest,
    user: Annotated[User, Depends(get_current_user)],
    db: DbDep,
):
    """Switch the user's subscription tier.

    Upgrades apply immediately with proration. Downgrades defer to the
    current billing period end via a Stripe SubscriptionSchedule.
    """
    from datetime import datetime

    target_tier = request.tier
    if target_tier not in TIER_PRICES:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid tier")
    if not user.stripe_subscription_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No active subscription found. Use checkout to start a new subscription.",
        )
    current_tier = user.subscription_tier
    if current_tier not in TIER_ORDER:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Cannot switch plans from a non-paid tier. Use checkout instead.",
        )

    pending_tier = user.pending_tier
    target_order = TIER_ORDER[target_tier]
    current_order = TIER_ORDER[current_tier]
    is_upgrade = target_order > current_order
    is_downgrade = target_order < current_order
    is_same = target_order == current_order

    stripe = get_stripe()
    display = TIER_DISPLAY_NAMES.get(target_tier, target_tier)

    # Target already matches a pending downgrade — reject.
    if pending_tier and target_tier == pending_tier:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Already scheduled to downgrade to this plan.",
        )

    # Target equals current tier.
    if is_same:
        if pending_tier and user.stripe_schedule_id:
            try:
                stripe.SubscriptionSchedule.release(user.stripe_schedule_id)
            except Exception:
                logger.exception("Failed to release schedule %s", user.stripe_schedule_id)
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Could not cancel the scheduled downgrade. Please try again.",
                )
            user.stripe_schedule_id = None
            user.pending_tier = None
            user.pending_tier_effective_at = None
            user.updated_at = utcnow()
            await db.commit()
            return {"message": "Scheduled downgrade canceled."}
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Already on this plan")

    # Upgrade path — release any pending schedule, then immediate modify.
    if is_upgrade:
        if user.stripe_schedule_id:
            try:
                stripe.SubscriptionSchedule.release(user.stripe_schedule_id)
            except Exception:
                logger.exception("Failed to release schedule %s during upgrade", user.stripe_schedule_id)
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Could not process upgrade. Please try again.",
                )
            user.stripe_schedule_id = None
            user.pending_tier = None
            user.pending_tier_effective_at = None

        price_id = TIER_PRICES[target_tier]
        if not price_id:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Stripe price ID for '{target_tier}' not configured",
            )
        try:
            subscription = stripe.Subscription.retrieve(user.stripe_subscription_id)
            items_data = subscription.get("items", {}).get("data", [])
            if not items_data:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Could not retrieve subscription items from Stripe",
                )
            item_id = items_data[0]["id"]
            stripe.Subscription.modify(
                user.stripe_subscription_id,
                items=[{"id": item_id, "price": price_id}],
                proration_behavior="create_prorations",
                metadata={"tier": target_tier, "user_id": str(user.id)},
            )
        except HTTPException:
            raise
        except stripe.error.APIConnectionError as exc:
            logger.error("Stripe connection error during plan upgrade: %s", exc)
            raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="Payment service temporarily unavailable. Please try again.")
        except stripe.error.RateLimitError as exc:
            logger.warning("Stripe rate limit during plan upgrade: %s", exc)
            raise HTTPException(status_code=status.HTTP_429_TOO_MANY_REQUESTS, detail="Too many requests to payment service. Please wait a moment and try again.")
        except Exception:
            logger.exception("Plan upgrade failed")
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Could not upgrade plan. Please try again or contact support.",
            )
        old_tier = user.subscription_tier
        user.subscription_tier = target_tier
        user.updated_at = utcnow()
        await db.commit()

        from app.services.analytics_service import log_event
        await log_event("plan_switched", {"old_plan": old_tier, "new_plan": target_tier}, user_id=user.id)
        return {"message": f"Plan upgraded to {display}."}

    # Downgrade path — create or amend a SubscriptionSchedule.
    if is_downgrade:
        new_price_id = TIER_PRICES[target_tier]
        if not new_price_id:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Stripe price ID for '{target_tier}' not configured",
            )
        try:
            if user.stripe_schedule_id:
                # Amend existing schedule's phase 2.
                schedule = stripe.SubscriptionSchedule.retrieve(user.stripe_schedule_id)
                phase1 = schedule["phases"][0]
                stripe.SubscriptionSchedule.modify(
                    user.stripe_schedule_id,
                    phases=[
                        {
                            "items": phase1["items"],
                            "start_date": phase1["start_date"],
                            "end_date": phase1["end_date"],
                        },
                        {
                            "items": [{"price": new_price_id, "quantity": 1}],
                            "iterations": 1,
                            "metadata": {"tier": target_tier, "user_id": str(user.id)},
                            "proration_behavior": "none",
                        },
                    ],
                    end_behavior="release",
                )
                user.pending_tier = target_tier
                user.updated_at = utcnow()
                await db.commit()
                return {"message": f"Scheduled downgrade updated to {display}."}
            else:
                # Create a new schedule from the subscription.
                schedule = stripe.SubscriptionSchedule.create(
                    from_subscription=user.stripe_subscription_id
                )
                phase1 = schedule["phases"][0]
                stripe.SubscriptionSchedule.modify(
                    schedule["id"],
                    phases=[
                        {
                            "items": phase1["items"],
                            "start_date": phase1["start_date"],
                            "end_date": phase1["end_date"],
                        },
                        {
                            "items": [{"price": new_price_id, "quantity": 1}],
                            "iterations": 1,
                            "metadata": {"tier": target_tier, "user_id": str(user.id)},
                            "proration_behavior": "none",
                        },
                    ],
                    end_behavior="release",
                )
                effective_at = datetime.fromtimestamp(phase1["end_date"], UTC).replace(tzinfo=None)
                user.stripe_schedule_id = schedule["id"]
                user.pending_tier = target_tier
                user.pending_tier_effective_at = effective_at
                user.updated_at = utcnow()
                await db.commit()
                return {"message": f"Plan downgrades to {display} on {effective_at.strftime('%b %d, %Y')}."}
        except HTTPException:
            raise
        except stripe.error.APIConnectionError as exc:
            logger.error("Stripe connection error during downgrade schedule: %s", exc)
            raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="Payment service temporarily unavailable. Please try again.")
        except stripe.error.RateLimitError as exc:
            logger.warning("Stripe rate limit during downgrade schedule: %s", exc)
            raise HTTPException(status_code=status.HTTP_429_TOO_MANY_REQUESTS, detail="Too many requests to payment service. Please wait a moment and try again.")
        except Exception:
            logger.exception("Downgrade scheduling failed")
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Could not schedule downgrade. Please try again or contact support.",
            )

    # Should be unreachable.
    raise HTTPException(status_code=500, detail="Unexpected plan-change state")
```

- [ ] **Step 4: Run Step 1's test — verify PASS**

Run: `cd backend && pytest tests/test_billing.py::test_change_plan_downgrade_creates_schedule_and_keeps_current_tier -v`
Expected: PASS.

- [ ] **Step 5: Run the full billing test file — verify no regression**

Run: `cd backend && pytest tests/test_billing.py -v`
Expected: all tests pass. If any existing test around plan switching fails, it was written against the old immediate-downgrade behavior; read the test, confirm the only assertion that breaks is "tier changed immediately after downgrade," and update it to assert the new pending-state shape instead. Do not change any other assertion.

- [ ] **Step 6: Commit**

```bash
git add backend/app/routers/billing.py backend/tests/test_billing.py
git commit -m "feat(billing): create Stripe SubscriptionSchedule for downgrades

Refactors /billing/change-plan into an upgrade/downgrade state machine.
Downgrades now create a two-phase SubscriptionSchedule so the tier change
takes effect at the current period end; local subscription_tier is
unchanged until the webhook confirms the transition. Upgrades remain
immediate with proration."
```

---

## Task 5: Upgrade-while-pending releases the schedule first

**Files:**
- Modify: `backend/tests/test_billing.py`

Implementation is already in place from Task 4. This task just verifies it with a dedicated test.

- [ ] **Step 1: Write the test**

Append to `backend/tests/test_billing.py`:

```python
async def test_change_plan_upgrade_while_pending_releases_schedule(client: httpx.AsyncClient):
    """If a downgrade is scheduled and the user upgrades, the schedule must
    be released before the immediate modify fires."""
    from sqlalchemy import text
    from app.database import AsyncSessionLocal

    await register_and_login(client, email="up_while_pending@example.com", subscription_tier="starter")
    async with AsyncSessionLocal() as db:
        await db.execute(
            text("""
                UPDATE users SET
                  stripe_subscription_id = :sid,
                  stripe_schedule_id = :schid,
                  pending_tier = :pt,
                  pending_tier_effective_at = :pte
                WHERE email = :email
            """),
            {
                "sid": "sub_fake_1", "schid": "sub_sched_fake_1",
                "pt": "basic", "pte": "2026-05-09 00:00:00",
                "email": "up_while_pending@example.com",
            },
        )
        await db.commit()

    fake_sub = {"items": {"data": [{"id": "si_fake_1"}]}}
    with (
        patch.dict("os.environ", {"STRIPE_PRO_PRICE_ID": "price_test_pro"}),
        patch("stripe.SubscriptionSchedule.release") as mock_release,
        patch("stripe.Subscription.retrieve", return_value=fake_sub),
        patch("stripe.Subscription.modify") as mock_modify,
    ):
        resp = await client.post("/api/billing/change-plan", json={"tier": "pro"})

    assert resp.status_code == 200, resp.text
    mock_release.assert_called_once_with("sub_sched_fake_1")
    mock_modify.assert_called_once()

    async with AsyncSessionLocal() as db:
        from app.models import User
        from sqlalchemy import select
        u = (await db.execute(select(User).where(User.email == "up_while_pending@example.com"))).scalar_one()
        assert u.subscription_tier == "pro"
        assert u.pending_tier is None
        assert u.stripe_schedule_id is None
        assert u.pending_tier_effective_at is None
```

- [ ] **Step 2: Run — verify PASS**

Run: `cd backend && pytest tests/test_billing.py::test_change_plan_upgrade_while_pending_releases_schedule -v`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add backend/tests/test_billing.py
git commit -m "test(billing): upgrade releases pending schedule before modify"
```

---

## Task 6: Further-downgrade-while-pending amends the schedule

**Files:**
- Modify: `backend/tests/test_billing.py`

- [ ] **Step 1: Write the test**

Append to `backend/tests/test_billing.py`:

```python
async def test_change_plan_further_downgrade_amends_schedule(client: httpx.AsyncClient):
    """Pro user with pending starter → change target to basic: amend phase 2,
    do NOT release/recreate the schedule. pending_tier_effective_at unchanged."""
    from sqlalchemy import text
    from app.database import AsyncSessionLocal

    await register_and_login(client, email="further_dg@example.com", subscription_tier="pro")
    async with AsyncSessionLocal() as db:
        await db.execute(
            text("""
                UPDATE users SET
                  stripe_subscription_id = :sid,
                  stripe_schedule_id = :schid,
                  pending_tier = :pt,
                  pending_tier_effective_at = :pte
                WHERE email = :email
            """),
            {
                "sid": "sub_fake_2", "schid": "sub_sched_fake_2",
                "pt": "starter", "pte": "2026-05-09 00:00:00",
                "email": "further_dg@example.com",
            },
        )
        await db.commit()

    fake_schedule = {
        "id": "sub_sched_fake_2",
        "phases": [{
            "items": [{"price": "price_test_pro", "quantity": 1}],
            "start_date": 1713200000,
            "end_date": 1715792000,
        }],
    }
    with (
        patch.dict("os.environ", {"STRIPE_BASIC_PRICE_ID": "price_test_basic"}),
        patch("stripe.SubscriptionSchedule.retrieve", return_value=fake_schedule),
        patch("stripe.SubscriptionSchedule.modify") as mock_modify,
        patch("stripe.SubscriptionSchedule.release") as mock_release,
        patch("stripe.SubscriptionSchedule.create") as mock_create,
    ):
        resp = await client.post("/api/billing/change-plan", json={"tier": "basic"})

    assert resp.status_code == 200, resp.text
    mock_modify.assert_called_once()
    mock_release.assert_not_called()
    mock_create.assert_not_called()

    async with AsyncSessionLocal() as db:
        from app.models import User
        from sqlalchemy import select
        u = (await db.execute(select(User).where(User.email == "further_dg@example.com"))).scalar_one()
        assert u.subscription_tier == "pro"  # unchanged
        assert u.pending_tier == "basic"     # updated
        assert u.stripe_schedule_id == "sub_sched_fake_2"  # unchanged
        # Effective date unchanged
        assert str(u.pending_tier_effective_at).startswith("2026-05-09")
```

- [ ] **Step 2: Run — verify PASS**

Run: `cd backend && pytest tests/test_billing.py::test_change_plan_further_downgrade_amends_schedule -v`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add backend/tests/test_billing.py
git commit -m "test(billing): further downgrade amends existing schedule"
```

---

## Task 7: Selecting current tier while pending releases the schedule

**Files:**
- Modify: `backend/tests/test_billing.py`

- [ ] **Step 1: Write the test**

Append to `backend/tests/test_billing.py`:

```python
async def test_change_plan_select_current_tier_releases_pending(client: httpx.AsyncClient):
    """Pro user with pending starter → selects pro: releases schedule, clears pending."""
    from sqlalchemy import text
    from app.database import AsyncSessionLocal

    await register_and_login(client, email="cancel_dg@example.com", subscription_tier="pro")
    async with AsyncSessionLocal() as db:
        await db.execute(
            text("""
                UPDATE users SET
                  stripe_subscription_id = :sid,
                  stripe_schedule_id = :schid,
                  pending_tier = :pt,
                  pending_tier_effective_at = :pte
                WHERE email = :email
            """),
            {
                "sid": "sub_fake_3", "schid": "sub_sched_fake_3",
                "pt": "starter", "pte": "2026-05-09 00:00:00",
                "email": "cancel_dg@example.com",
            },
        )
        await db.commit()

    with (
        patch("stripe.SubscriptionSchedule.release") as mock_release,
        patch("stripe.Subscription.modify") as mock_modify,
    ):
        resp = await client.post("/api/billing/change-plan", json={"tier": "pro"})

    assert resp.status_code == 200, resp.text
    mock_release.assert_called_once_with("sub_sched_fake_3")
    mock_modify.assert_not_called()

    async with AsyncSessionLocal() as db:
        from app.models import User
        from sqlalchemy import select
        u = (await db.execute(select(User).where(User.email == "cancel_dg@example.com"))).scalar_one()
        assert u.subscription_tier == "pro"
        assert u.pending_tier is None
        assert u.stripe_schedule_id is None
        assert u.pending_tier_effective_at is None
```

- [ ] **Step 2: Run — verify PASS**

Run: `cd backend && pytest tests/test_billing.py::test_change_plan_select_current_tier_releases_pending -v`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add backend/tests/test_billing.py
git commit -m "test(billing): selecting current tier cancels pending downgrade"
```

---

## Task 8: Reject target-equals-pending and target-equals-current-no-pending

**Files:**
- Modify: `backend/tests/test_billing.py`

- [ ] **Step 1: Write the tests**

Append to `backend/tests/test_billing.py`:

```python
async def test_change_plan_rejects_same_as_pending(client: httpx.AsyncClient):
    """Setting target to the already-pending tier returns 400."""
    from sqlalchemy import text
    from app.database import AsyncSessionLocal

    await register_and_login(client, email="dup_pending@example.com", subscription_tier="pro")
    async with AsyncSessionLocal() as db:
        await db.execute(
            text("""
                UPDATE users SET stripe_subscription_id = :sid, stripe_schedule_id = :schid,
                                 pending_tier = :pt, pending_tier_effective_at = :pte
                WHERE email = :email
            """),
            {"sid": "sub_x", "schid": "sch_x", "pt": "starter",
             "pte": "2026-05-09 00:00:00", "email": "dup_pending@example.com"},
        )
        await db.commit()

    resp = await client.post("/api/billing/change-plan", json={"tier": "starter"})
    assert resp.status_code == 400
    assert "already scheduled" in resp.json()["detail"].lower()


async def test_change_plan_rejects_same_as_current_no_pending(client: httpx.AsyncClient):
    """Selecting current tier with no pending schedule returns 400."""
    from sqlalchemy import text
    from app.database import AsyncSessionLocal

    await register_and_login(client, email="dup_current@example.com", subscription_tier="pro")
    async with AsyncSessionLocal() as db:
        await db.execute(
            text("UPDATE users SET stripe_subscription_id = :sid WHERE email = :email"),
            {"sid": "sub_y", "email": "dup_current@example.com"},
        )
        await db.commit()

    resp = await client.post("/api/billing/change-plan", json={"tier": "pro"})
    assert resp.status_code == 400
    assert "already on this plan" in resp.json()["detail"].lower()
```

- [ ] **Step 2: Run — verify PASS**

Run: `cd backend && pytest tests/test_billing.py::test_change_plan_rejects_same_as_pending tests/test_billing.py::test_change_plan_rejects_same_as_current_no_pending -v`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add backend/tests/test_billing.py
git commit -m "test(billing): reject redundant plan changes"
```

---

## Task 9: Cancel endpoint releases schedule before canceling

**Files:**
- Modify: `backend/app/routers/billing.py` (function at line 440)
- Modify: `backend/tests/test_billing.py`

- [ ] **Step 1: Write failing test**

Append to `backend/tests/test_billing.py`:

```python
async def test_cancel_releases_pending_schedule_first(client: httpx.AsyncClient):
    """Cancel while a downgrade is pending: release schedule, then cancel_at_period_end."""
    from sqlalchemy import text
    from app.database import AsyncSessionLocal

    await register_and_login(client, email="cancel_with_sched@example.com", subscription_tier="pro")
    async with AsyncSessionLocal() as db:
        await db.execute(
            text("""
                UPDATE users SET stripe_subscription_id = :sid, stripe_schedule_id = :schid,
                                 pending_tier = :pt, pending_tier_effective_at = :pte
                WHERE email = :email
            """),
            {"sid": "sub_cancel_1", "schid": "sch_cancel_1", "pt": "starter",
             "pte": "2026-05-09 00:00:00", "email": "cancel_with_sched@example.com"},
        )
        await db.commit()

    with (
        patch("stripe.SubscriptionSchedule.release") as mock_release,
        patch("stripe.Subscription.modify") as mock_modify,
    ):
        resp = await client.post("/api/billing/cancel")

    assert resp.status_code == 200, resp.text
    mock_release.assert_called_once_with("sch_cancel_1")
    mock_modify.assert_called_once_with("sub_cancel_1", cancel_at_period_end=True)

    async with AsyncSessionLocal() as db:
        from app.models import User
        from sqlalchemy import select
        u = (await db.execute(select(User).where(User.email == "cancel_with_sched@example.com"))).scalar_one()
        assert u.stripe_schedule_id is None
        assert u.pending_tier is None
        assert u.pending_tier_effective_at is None
        assert u.subscription_status == "canceling"
```

- [ ] **Step 2: Run — verify FAIL**

Run: `cd backend && pytest tests/test_billing.py::test_cancel_releases_pending_schedule_first -v`
Expected: FAIL. Current cancel endpoint does not touch schedules.

- [ ] **Step 3: Extend the cancel endpoint**

In `backend/app/routers/billing.py`, replace the body of the `cancel_subscription` endpoint (lines 440–477) with:

```python
@router.post("/cancel")
async def cancel_subscription(
    user: Annotated[User, Depends(get_current_user)],
    db: DbDep,
):
    """Cancel the user's subscription at end of billing period.

    If a downgrade is scheduled (SubscriptionSchedule), release it first so
    Stripe doesn't try to transition a canceled subscription.
    """
    if not user.stripe_subscription_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No active subscription found",
        )
    stripe = get_stripe()

    # Release any pending downgrade schedule first.
    if user.stripe_schedule_id:
        try:
            stripe.SubscriptionSchedule.release(user.stripe_schedule_id)
        except Exception:
            logger.exception("Failed to release schedule %s during cancel — proceeding anyway", user.stripe_schedule_id)
        user.stripe_schedule_id = None
        user.pending_tier = None
        user.pending_tier_effective_at = None

    try:
        stripe.Subscription.modify(
            user.stripe_subscription_id,
            cancel_at_period_end=True,
        )
    except stripe.error.APIConnectionError as exc:
        logger.error("Stripe connection error during subscription cancellation: %s", exc)
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="Payment service temporarily unavailable. Please try again.")
    except stripe.error.RateLimitError as exc:
        logger.warning("Stripe rate limit during subscription cancellation: %s", exc)
        raise HTTPException(status_code=status.HTTP_429_TOO_MANY_REQUESTS, detail="Too many requests to payment service. Please wait a moment and try again.")
    except Exception:
        logger.exception("Subscription cancellation failed")
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Could not cancel subscription. Please try again or contact support.",
        )

    user.subscription_status = "canceling"
    user.updated_at = utcnow()
    await db.commit()

    from app.services.analytics_service import log_event
    await log_event("subscription_cancel_requested", {}, user_id=user.id)

    return {"message": "Subscription will be canceled at the end of the current billing period"}
```

- [ ] **Step 4: Run — verify PASS**

Run: `cd backend && pytest tests/test_billing.py::test_cancel_releases_pending_schedule_first -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/app/routers/billing.py backend/tests/test_billing.py
git commit -m "feat(billing): cancel endpoint releases pending downgrade schedule first"
```

---

## Task 10: Webhook clears pending state when transition completes

**Files:**
- Modify: `backend/app/routers/billing.py` (`customer.subscription.updated` handler around line 607)
- Modify: `backend/tests/test_billing.py`

- [ ] **Step 1: Write failing test**

Append to `backend/tests/test_billing.py`:

```python
async def test_webhook_clears_pending_when_transition_completes(client: httpx.AsyncClient):
    """When customer.subscription.updated arrives with the pending_tier's price,
    clear all three pending columns."""
    import json
    from sqlalchemy import text
    from app.database import AsyncSessionLocal

    await register_and_login(client, email="tx_complete@example.com", subscription_tier="pro")
    async with AsyncSessionLocal() as db:
        await db.execute(
            text("""
                UPDATE users SET stripe_customer_id = :cid, stripe_subscription_id = :sid,
                                 stripe_schedule_id = :schid, pending_tier = :pt,
                                 pending_tier_effective_at = :pte
                WHERE email = :email
            """),
            {"cid": "cus_tx", "sid": "sub_tx", "schid": "sch_tx", "pt": "starter",
             "pte": "2026-05-09 00:00:00", "email": "tx_complete@example.com"},
        )
        await db.commit()

    event_payload = {
        "id": "evt_tx_1",
        "type": "customer.subscription.updated",
        "data": {"object": {
            "id": "sub_tx",
            "customer": "cus_tx",
            "status": "active",
            "metadata": {"tier": "starter"},
        }},
    }

    with patch("stripe.Webhook.construct_event", return_value=event_payload):
        with patch.dict("os.environ", {"STRIPE_WEBHOOK_SECRET": "whsec_test", "STRIPE_SECRET_KEY": "sk_test"}):
            resp = await client.post(
                "/api/billing/webhook",
                content=json.dumps(event_payload),
                headers={"stripe-signature": "t=1,v1=fake"},
            )
    assert resp.status_code == 200

    async with AsyncSessionLocal() as db:
        from app.models import User
        from sqlalchemy import select
        u = (await db.execute(select(User).where(User.email == "tx_complete@example.com"))).scalar_one()
        assert u.subscription_tier == "starter"
        assert u.pending_tier is None
        assert u.stripe_schedule_id is None
        assert u.pending_tier_effective_at is None
```

- [ ] **Step 2: Run — verify FAIL**

Run: `cd backend && pytest tests/test_billing.py::test_webhook_clears_pending_when_transition_completes -v`
Expected: FAIL. Existing webhook updates `subscription_tier` but does not clear pending columns.

- [ ] **Step 3: Extend webhook handler**

In `backend/app/routers/billing.py`, inside the `elif event_type in ("customer.subscription.created", "customer.subscription.updated"):` block, find the line `user.subscription_status = sub_status` (around line 622). After the existing `if tier:` block that updates `user.subscription_tier`, add this block (still inside the `if user:` branch):

```python
# If this webhook reflects the completed phase transition, clear pending state.
if tier and user.pending_tier and tier == user.pending_tier:
    logger.info(
        "Subscription schedule transition completed for user %s: tier=%s",
        user.email, tier,
    )
    user.pending_tier = None
    user.pending_tier_effective_at = None
    user.stripe_schedule_id = None
```

Place this block directly after the existing `if tier:` block that sets `user.subscription_tier` (just before the `# Store trial end date if present` comment). Ordering matters: the tier must be written first so we can compare `tier == user.pending_tier` against the just-written tier.

Actually — read the `if tier:` block carefully. It writes `user.subscription_tier = tier` inside the `admin_tier_override` check. Capture the previous `user.pending_tier` before the tier write:

Replace lines 621–628 (the block that includes `old_tier = user.subscription_tier`, through the admin-override `user.subscription_tier = tier` write) with:

```python
old_tier = user.subscription_tier
prev_pending_tier = user.pending_tier
user.subscription_status = sub_status
user.stripe_subscription_id = sub_id
if tier:
    if getattr(user, "admin_tier_override", False):
        logger.info("Skipping tier update for user %s — admin override active", user.email)
    else:
        user.subscription_tier = tier
# If this webhook reflects the completed phase transition, clear pending state.
if tier and prev_pending_tier and tier == prev_pending_tier:
    logger.info(
        "Subscription schedule transition completed for user %s: tier=%s",
        user.email, tier,
    )
    user.pending_tier = None
    user.pending_tier_effective_at = None
    user.stripe_schedule_id = None
```

- [ ] **Step 4: Run — verify PASS**

Run: `cd backend && pytest tests/test_billing.py::test_webhook_clears_pending_when_transition_completes -v`
Expected: PASS.

- [ ] **Step 5: Run the full billing test file**

Run: `cd backend && pytest tests/test_billing.py -v`
Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add backend/app/routers/billing.py backend/tests/test_billing.py
git commit -m "feat(billing): clear pending state when schedule transition webhook arrives"
```

---

## Task 11: Handle `subscription_schedule.released` and `.canceled` webhook events

**Files:**
- Modify: `backend/app/routers/billing.py` (webhook handler around line 565)
- Modify: `backend/tests/test_billing.py`

- [ ] **Step 1: Write failing test**

Append to `backend/tests/test_billing.py`:

```python
async def test_webhook_subscription_schedule_released_clears_pending(client: httpx.AsyncClient):
    """subscription_schedule.released event clears pending columns defensively."""
    import json
    from sqlalchemy import text
    from app.database import AsyncSessionLocal

    await register_and_login(client, email="sch_released@example.com", subscription_tier="pro")
    async with AsyncSessionLocal() as db:
        await db.execute(
            text("""
                UPDATE users SET stripe_customer_id = :cid, stripe_subscription_id = :sid,
                                 stripe_schedule_id = :schid, pending_tier = :pt,
                                 pending_tier_effective_at = :pte
                WHERE email = :email
            """),
            {"cid": "cus_r", "sid": "sub_r", "schid": "sch_r_1", "pt": "starter",
             "pte": "2026-05-09 00:00:00", "email": "sch_released@example.com"},
        )
        await db.commit()

    event_payload = {
        "id": "evt_sch_r_1",
        "type": "subscription_schedule.released",
        "data": {"object": {"id": "sch_r_1"}},
    }

    with patch("stripe.Webhook.construct_event", return_value=event_payload):
        with patch.dict("os.environ", {"STRIPE_WEBHOOK_SECRET": "whsec_test", "STRIPE_SECRET_KEY": "sk_test"}):
            resp = await client.post(
                "/api/billing/webhook",
                content=json.dumps(event_payload),
                headers={"stripe-signature": "t=1,v1=fake"},
            )
    assert resp.status_code == 200

    async with AsyncSessionLocal() as db:
        from app.models import User
        from sqlalchemy import select
        u = (await db.execute(select(User).where(User.email == "sch_released@example.com"))).scalar_one()
        assert u.pending_tier is None
        assert u.stripe_schedule_id is None
        assert u.pending_tier_effective_at is None
```

- [ ] **Step 2: Run — verify FAIL**

Run: `cd backend && pytest tests/test_billing.py::test_webhook_subscription_schedule_released_clears_pending -v`
Expected: FAIL. No handler exists.

- [ ] **Step 3: Add the handler**

In `backend/app/routers/billing.py`, find the `elif event_type == "customer.subscription.deleted":` branch in the webhook handler (around line 651). Immediately before it, insert a new branch:

```python
elif event_type in ("subscription_schedule.released", "subscription_schedule.canceled"):
    schedule_id = data_obj.get("id")
    if schedule_id:
        result = await db.execute(
            sa_select(UserModel).where(UserModel.stripe_schedule_id == schedule_id)
        )
        user = result.scalar_one_or_none()
        if user:
            logger.info(
                "Clearing pending state for user %s after schedule %s (%s)",
                user.email, schedule_id, event_type,
            )
            user.pending_tier = None
            user.pending_tier_effective_at = None
            user.stripe_schedule_id = None
            user.updated_at = utcnow()
            await db.flush()
```

- [ ] **Step 4: Run — verify PASS**

Run: `cd backend && pytest tests/test_billing.py::test_webhook_subscription_schedule_released_clears_pending -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/app/routers/billing.py backend/tests/test_billing.py
git commit -m "feat(billing): handle subscription_schedule released/canceled webhooks"
```

---

## Task 12: Expose pending fields via `GET /api/billing/status`

**Files:**
- Modify: `backend/app/routers/billing.py` (status endpoint around line 100-155)
- Modify: `backend/tests/test_billing.py`

- [ ] **Step 1: Write failing test**

Append to `backend/tests/test_billing.py`:

```python
async def test_billing_status_includes_pending_fields(client: httpx.AsyncClient):
    """GET /billing/status returns pending_tier and pending_tier_effective_at."""
    from sqlalchemy import text
    from app.database import AsyncSessionLocal

    await register_and_login(client, email="status_pending@example.com", subscription_tier="pro")
    async with AsyncSessionLocal() as db:
        await db.execute(
            text("""
                UPDATE users SET pending_tier = :pt, pending_tier_effective_at = :pte
                WHERE email = :email
            """),
            {"pt": "starter", "pte": "2026-05-09 00:00:00", "email": "status_pending@example.com"},
        )
        await db.commit()

    resp = await client.get("/api/billing/status")
    assert resp.status_code == 200
    data = resp.json()
    assert data["pending_tier"] == "starter"
    assert data["pending_tier_effective_at"] is not None
    assert data["pending_tier_effective_at"].startswith("2026-05-09")


async def test_billing_status_pending_null_when_unset(client: httpx.AsyncClient):
    """Users without a scheduled downgrade see null pending fields."""
    await register_and_login(client, email="status_nopending@example.com", subscription_tier="pro")
    resp = await client.get("/api/billing/status")
    assert resp.status_code == 200
    data = resp.json()
    assert data["pending_tier"] is None
    assert data["pending_tier_effective_at"] is None
```

- [ ] **Step 2: Run — verify FAIL**

Run: `cd backend && pytest tests/test_billing.py::test_billing_status_includes_pending_fields tests/test_billing.py::test_billing_status_pending_null_when_unset -v`
Expected: FAIL. Response keys don't exist yet.

- [ ] **Step 3: Extend the status response**

In `backend/app/routers/billing.py`, find the return statement in `billing_status` (around line 146-155). Change it to include the pending fields:

```python
return {
    "subscription_tier": user.subscription_tier,
    "subscription_status": user.subscription_status,
    "subscription_trial_end": trial_end,
    "days_remaining": days_remaining,
    "prompt_limit": limit,
    "brand_limits": brand_limits,
    "is_admin": user.is_admin,
    "has_payment_method": bool(user.stripe_customer_id),
    "pending_tier": user.pending_tier,
    "pending_tier_effective_at": (
        user.pending_tier_effective_at.isoformat()
        if user.pending_tier_effective_at else None
    ),
}
```

- [ ] **Step 4: Run — verify PASS**

Run: `cd backend && pytest tests/test_billing.py::test_billing_status_includes_pending_fields tests/test_billing.py::test_billing_status_pending_null_when_unset -v`
Expected: PASS.

- [ ] **Step 5: Run full billing test file**

Run: `cd backend && pytest tests/test_billing.py -v`
Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add backend/app/routers/billing.py backend/tests/test_billing.py
git commit -m "feat(billing): expose pending_tier and effective_at in status response"
```

---

## Task 13: Frontend — extend `BillingStatus` type and add pending banner

**Files:**
- Modify: `frontend/lib/api.ts` (around line 965)
- Modify: `frontend/app/settings/billing/page.tsx`

No frontend test suite exists — this task uses manual verification in the dev server.

- [ ] **Step 1: Extend the `BillingStatus` type**

In `frontend/lib/api.ts`, find the `BillingStatus` interface (around line 965). Add two fields:

```typescript
export interface BillingStatus {
  subscription_tier: 'basic' | 'starter' | 'pro' | null;
  subscription_status: string | null;
  subscription_trial_end: string | null;
  days_remaining: number | null;
  prompt_limit: number;
  brand_limits: { standard: number; pitch: number };
  is_admin: boolean;
  has_payment_method: boolean;
  pending_tier: 'basic' | 'starter' | 'pro' | null;
  pending_tier_effective_at: string | null;
}
```

- [ ] **Step 2: Add pending-downgrade banner to billing page**

In `frontend/app/settings/billing/page.tsx`, inside the main return body (after the cancel/switch modals, before the plan cards render), add a banner block. The exact placement: directly above the `<div className="mb-6">` header block if pending state exists, or right after it.

Add this JSX block right after line 156 (`</div>` closing the header):

```tsx
{status?.pending_tier && status.pending_tier_effective_at && (
  <div className="mb-6 rounded-lg border border-[var(--warning)]/30 bg-[var(--warning)]/10 px-4 py-3 flex items-start gap-3">
    <AlertTriangle size={16} className="text-[var(--warning)] mt-0.5 flex-shrink-0" />
    <div className="flex-1 text-xs text-[var(--text-primary)]">
      <p>
        Your plan changes to <strong>{TIER_DISPLAY_NAMES[status.pending_tier] || status.pending_tier}</strong>
        {' on '}
        <strong>
          {new Date(status.pending_tier_effective_at).toLocaleDateString(undefined, {
            year: 'numeric', month: 'long', day: 'numeric',
          })}
        </strong>.
      </p>
      <p className="text-[var(--text-muted)] mt-1">
        You keep your current features until that date.
      </p>
    </div>
    <button
      onClick={async () => {
        if (!currentTier) return;
        setUpgrading(currentTier);
        try {
          await changePlan(currentTier);
          const updated = await getBillingStatus();
          setStatus(updated);
        } catch (err: unknown) {
          const e = err as { response?: { data?: { detail?: string } } };
          alert(e?.response?.data?.detail || 'Could not cancel the downgrade.');
        } finally {
          setUpgrading(null);
        }
      }}
      disabled={upgrading !== null}
      className="text-xs font-medium text-[var(--text-primary)] hover:underline disabled:opacity-50"
    >
      Cancel downgrade
    </button>
  </div>
)}
```

- [ ] **Step 3: Disable the "switch to" CTA on the pending tier card**

In the same file, find where plan cards are rendered (search for where `TIER_FEATURES` or the tier-card button is rendered — the button that triggers `handleUpgrade`). When rendering each plan card's action button, add a check: if `tier === status?.pending_tier`, show the label "Scheduled" instead of the normal CTA and disable the click.

Search for the line that renders `handleUpgrade(...)` for each card (search: `handleUpgrade(`). Wrap the existing button with a conditional:

```tsx
{status?.pending_tier === tier ? (
  <button
    disabled
    className="w-full py-2 px-4 rounded-lg text-xs font-medium bg-[var(--surface-sunken)] text-[var(--text-muted)] cursor-not-allowed border border-[var(--border-default)]"
  >
    Scheduled for {new Date(status.pending_tier_effective_at!).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
  </button>
) : (
  /* existing button */
)}
```

Adjust the exact JSX to match the existing button's className pattern. Preserve the existing button's behavior for all non-pending tiers.

- [ ] **Step 4: Manual verification**

Start both dev servers and exercise the flow end-to-end:

Run (backend): `cd backend && source venv/bin/activate && uvicorn app.main:app --reload --port 3001`
Run (frontend, separate terminal): `cd frontend && npm run dev -- --port 3002`

In a browser at http://localhost:3002/settings/billing with a Pro-tier user who has a Stripe subscription:

1. Click "Switch to Growth" — confirm the modal, submit. Verify:
   - No immediate tier change in the UI beyond the banner appearing.
   - Banner reads "Your plan changes to Growth on [date]." with a "Cancel downgrade" button.
   - Growth card shows "Scheduled for [date]" and is disabled.
2. Click "Cancel downgrade" — verify banner disappears and Growth card re-enables.
3. Re-schedule the downgrade, then click "Switch to Starter" — verify banner updates to "changes to Starter on [same date]."
4. Re-schedule, then click "Switch to Pro" (the current tier) — verify banner disappears (select-current-tier releases).

- [ ] **Step 5: Commit**

```bash
git add frontend/lib/api.ts frontend/app/settings/billing/page.tsx
git commit -m "feat(billing): show pending-downgrade banner with cancel action"
```

---

## Task 14: Document Stripe Customer Portal config requirement

**Files:**
- Modify: `backend/app/routers/billing.py` (module-level docstring or comment near `/webhook`)

- [ ] **Step 1: Add a comment documenting the portal setting**

At the top of `backend/app/routers/billing.py`, after the imports, add a module-level comment:

```python
# ── Stripe Customer Portal configuration ──────────────────────────────────────
# The Customer Portal's "Customers can switch plans" setting MUST be disabled.
# Plan switching is handled exclusively by POST /api/billing/change-plan, which
# implements the period-end downgrade state machine (see
# docs/superpowers/specs/2026-04-22-period-end-downgrades-design.md). Allowing
# plan switches in the portal would bypass our SubscriptionSchedule logic and
# create drift between Stripe and local pending_tier state.
# "Cancel subscription" in the portal is fine — it uses cancel_at_period_end
# which /api/billing/cancel also uses.
```

- [ ] **Step 2: Update the Stripe Dashboard setting**

In the Stripe Dashboard (production + test modes both):
1. Navigate to **Settings → Billing → Customer portal**.
2. Under **Subscriptions**, toggle **Customers can switch plans** off.
3. Under **Cancellations**, confirm **Mode: End of billing period** is selected.
4. Save.

- [ ] **Step 3: Commit**

```bash
git add backend/app/routers/billing.py
git commit -m "docs(billing): document Stripe Customer Portal plan-switch requirement"
```

---

## Final Verification

- [ ] **Full backend test suite passes**

Run: `cd backend && source venv/bin/activate && pytest tests/ -x -q`
Expected: all tests pass.

- [ ] **No orphaned references to old names**

Run: `cd backend && grep -rn "_upgrade_brands_for_tier" app/ tests/`
Expected: no output.

- [ ] **Production smoke plan (execute after deploy, not now)**

After merge and deploy, on a dedicated test account with an active Pro subscription:
1. Trigger Pro → Growth downgrade via the UI.
2. Verify banner appears and shows correct period-end date.
3. Open Stripe Dashboard → find the subscription → confirm a `SubscriptionSchedule` is attached with two phases.
4. Confirm `GET /api/billing/status` returns the expected `pending_tier` and `pending_tier_effective_at`.
5. Test supersede: click "Switch to Pro" (current) — confirm banner disappears and Stripe Dashboard shows no schedule.
