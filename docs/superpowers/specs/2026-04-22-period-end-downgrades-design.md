# Period-End Downgrades — Design Spec

**Date:** 2026-04-22
**Goal:** Defer subscription tier downgrades until the end of the current billing period so that users who paid for a higher tier keep those features for the time they've already paid for. Upgrades remain immediate with proration.

---

## Background

Today, `POST /api/billing/change-plan` (`backend/app/routers/billing.py:365`) calls `stripe.Subscription.modify(..., proration_behavior="none")` immediately and updates `user.subscription_tier` synchronously. Consequence: a user who clicks "Switch to Growth" the day after being charged for Pro loses Pro features (Claude model, 30-prompt cap) instantly while remaining paid through the end of the Pro billing period. Stripe does not refund them; the next invoice just charges at the new price.

This spec changes the endpoint so that **downgrades defer to the current period's end** while **upgrades stay immediate**. The implementation uses Stripe Subscription Schedules as the system of record for the scheduled transition.

A related bug exists in `_upgrade_brands_for_tier` (`billing.py:482`): the function is upgrade-only (no branch handles `pro → standard`-tier downgrades on brands), so Pro-era brand fields (`brand_type="pro"`, `prompt_limit=30`) persist on downgrade. This spec also fixes that so the downgrade flow self-heals brand state at the transition boundary.

---

## Requirements

- A downgrade via `POST /api/billing/change-plan` must not change the user's feature set until the current billing period ends.
- Stripe must charge the new, lower price at the next renewal (not the current one).
- An upgrade via the same endpoint stays immediate (with proration).
- Users can supersede a scheduled downgrade: upgrading cancels it, a further downgrade updates its target, re-selecting the current tier cancels it.
- The billing UI must surface the pending state so users know a change is scheduled and can cancel it.
- Cancel flow (`POST /api/billing/cancel`) must release any active schedule first, then cancel at period end.
- Brand-level state (`brand_type`, `prompt_limit`) must sync correctly on downgrade transitions, not just upgrades.

Out of scope:

- Allowing plan changes in the Stripe Customer Portal. This spec disables plan-switching in the portal; users must change plans via the in-app UI.
- Retroactive handling of users who already downgraded under the old flow (none exist in production aside from Rod Turner's brand, which has been manually corrected).

---

## Architecture

### Data model

Add three nullable columns to `User` (`backend/app/models.py`):

| Column | Type | Purpose |
|---|---|---|
| `pending_tier` | `String(50)` | Target tier for a scheduled downgrade (`basic`, `starter`). `None` when no downgrade is scheduled. |
| `pending_tier_effective_at` | `DateTime` | Naive UTC timestamp when the schedule transitions (= Stripe's `current_period_end` at time of scheduling). |
| `stripe_schedule_id` | `String(255)` | Stripe `SubscriptionSchedule` ID for the active schedule. |

Migrations appended to the bottom of `run_migrations()` in `backend/app/database.py` per project convention:

```sql
ALTER TABLE users ADD COLUMN pending_tier VARCHAR(50);
ALTER TABLE users ADD COLUMN pending_tier_effective_at DATETIME;
ALTER TABLE users ADD COLUMN stripe_schedule_id VARCHAR(255);
```

No backfill needed — `NULL` is the correct default for all existing users.

### Tier ordering

Direction is derived from a fixed integer map in `billing.py`:

```python
TIER_ORDER = {"basic": 1, "starter": 2, "pro": 3}
```

`None` (Free) is treated as order 0 only for display; downgrading to Free goes through `POST /billing/cancel`, not `change-plan`, so it does not appear in this comparison.

### `POST /api/billing/change-plan` state machine

Logic branches on the relationship between the user's current tier, the incoming `target_tier`, and any `pending_tier`:

| Current → Target | `pending_tier` | Action |
|---|---|---|
| Upgrade | `None` | Immediate `Subscription.modify` (existing behavior). |
| Upgrade | set | `SubscriptionSchedule.release(stripe_schedule_id)`, clear pending columns, then immediate `Subscription.modify`. |
| Downgrade | `None` | Create `SubscriptionSchedule` with two phases (see below). Store pending columns. **`subscription_tier` unchanged.** |
| Downgrade | set | Amend phase 2 of the existing schedule to the new target price. Update `pending_tier`; `stripe_schedule_id` and `pending_tier_effective_at` unchanged. |
| Target == current tier | set | `SubscriptionSchedule.release(...)` + clear pending columns. Return message confirming the downgrade is canceled. |
| Target == current tier | `None` | 400 "Already on this plan" (existing). |
| Target == pending_tier | set | 400 "Already scheduled to downgrade to this plan." |

### Creating the Subscription Schedule

Downgrade path:

```python
schedule = stripe.SubscriptionSchedule.create(from_subscription=user.stripe_subscription_id)
# Stripe auto-creates phase 1 mirroring the current subscription.
phase1 = schedule.phases[0]
stripe.SubscriptionSchedule.modify(
    schedule.id,
    phases=[
        {
            "items": [{"price": current_price_id, "quantity": 1}],
            "start_date": phase1.start_date,
            "end_date": phase1.end_date,  # == subscription.current_period_end
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

user.stripe_schedule_id = schedule.id
user.pending_tier = target_tier
user.pending_tier_effective_at = datetime.fromtimestamp(phase1.end_date, UTC).replace(tzinfo=None)
```

`end_behavior="release"` means that after the last phase completes, Stripe releases the schedule and the subscription continues on its own with the new price — no recurring renewal anomalies.

### Releasing / amending

- **Release** (on supersede-to-upgrade, supersede-to-current-tier, or cancel): `stripe.SubscriptionSchedule.release(schedule_id)` — detaches the schedule, subscription price remains as it currently is.
- **Amend** (further downgrade while pending): `stripe.SubscriptionSchedule.modify(schedule_id, phases=[<phase 1 unchanged>, <phase 2 with new price + metadata>])`. The transition date stays pinned to `phase1.end_date`.

### Webhook handling

Extend the existing `/api/billing/webhook` handler (`billing.py:519`):

**`customer.subscription.updated`** (existing event, extend logic):
The handler already syncs `subscription_tier` from the event's price metadata. Add: if the new `subscription_tier` equals the user's `pending_tier`, clear `pending_tier`, `pending_tier_effective_at`, and `stripe_schedule_id`. This is the signal that the scheduled transition executed.

**`subscription_schedule.released`** (new handler):
Clear all three pending columns. Defensive cleanup in case a release was initiated outside our code path (e.g., Stripe dashboard).

**`subscription_schedule.canceled`** (new handler):
Same cleanup as `released`. Edge case when a schedule is canceled outright rather than released.

**`customer.subscription.deleted`** (existing handler):
Add release-before-clear: if `stripe_schedule_id` is set, call `SubscriptionSchedule.release` in a try/except (best-effort) before clearing the pending columns alongside the existing subscription teardown.

### Fix `_upgrade_brands_for_tier`

Rename to `_sync_brands_for_tier`. Add downgrade branches:

```python
elif tier == "starter":
    # Bring pitch up to standard...
    await db.execute(
        sa_update(Brand)
        .where(Brand.user_id == user_id, Brand.brand_type == "pitch")
        .values(brand_type="standard", prompt_limit=25)
    )
    # ...and bring any pro brands back down to standard.
    await db.execute(
        sa_update(Brand)
        .where(Brand.user_id == user_id, Brand.brand_type == "pro")
        .values(brand_type="standard", prompt_limit=25)
    )
elif tier == "basic":
    await db.execute(
        sa_update(Brand)
        .where(Brand.user_id == user_id, Brand.brand_type == "pitch")
        .values(brand_type="standard", prompt_limit=10)
    )
    await db.execute(
        sa_update(Brand)
        .where(Brand.user_id == user_id, Brand.brand_type == "pro")
        .values(brand_type="standard", prompt_limit=10)
    )
```

The existing `tier == "pro"` branch remains as-is. Call sites (`billing.py:599`, `:649`) stay the same — only the function body changes.

### Frontend: billing UI

`GET /api/billing/status` response (`billing.py:137`) gains two fields:

```json
{
  "pending_tier": "starter",
  "pending_tier_effective_at": "2026-05-09T14:23:11"
}
```

The Pro-tier display name ("Pro", "Growth", etc.) is resolved frontend-side from the existing tier→display mapping.

In `/settings/billing`:

- When `pending_tier` is set, render a banner above the plan cards:
  > Your plan changes to **Growth** on **May 9, 2026**.  [Cancel downgrade]
- "Cancel downgrade" calls `POST /api/billing/change-plan` with `{ tier: <current_tier> }`. The backend interprets target==current-tier+pending-set as release.
- The current tier card gets a secondary label "Downgrades on May 9" when pending.
- The scheduled target card gets a "Scheduled" badge and its CTA is hidden.

### Stripe Customer Portal configuration

Disable plan switching in the portal (Stripe Dashboard → Settings → Billing → Customer Portal → Subscriptions → "Customers can switch plans" → off). Leave "Cancel subscription" on — that flow already correctly uses `cancel_at_period_end`. Leave payment methods and invoice history on.

Rationale: the portal has no knowledge of our state machine, so allowing plan changes there would create drift between Stripe and our local schedule logic. Centralizing plan changes in our UI is simpler and keeps the state machine coherent.

---

## Testing

### Backend unit tests (`backend/tests/test_billing.py`)

- Downgrade creates a schedule (mocked Stripe) and does **not** change `user.subscription_tier`; sets `pending_tier`, `pending_tier_effective_at`, `stripe_schedule_id`.
- Upgrade while a schedule is pending calls `SubscriptionSchedule.release` once, then `Subscription.modify`; clears pending columns.
- Further downgrade while pending calls `SubscriptionSchedule.modify` with the new price in phase 2; `pending_tier_effective_at` unchanged.
- Selecting current tier while pending calls `SubscriptionSchedule.release` and clears pending columns.
- Cancel while pending releases then cancels.
- `customer.subscription.updated` webhook with new-tier price metadata flips `subscription_tier` and clears pending columns when they match.
- `subscription_schedule.released` webhook clears pending columns.
- `_sync_brands_for_tier("starter")` moves `brand_type="pro"` brands to `"standard"` with `prompt_limit=25`; `_sync_brands_for_tier("basic")` likewise with `prompt_limit=10`.

Stripe calls are mocked using the existing `MagicMock` pattern in `test_billing.py`.

### Manual verification

- Local end-to-end: with Stripe test mode, use a test clock to advance time past `current_period_end` and verify the webhook arrives, local tier flips, and brand fields sync.
- Production smoke test (post-deploy): trigger one Pro→Growth downgrade on a test account, confirm banner appears, confirm Stripe Dashboard shows the scheduled change.

---

## Rollout

- Single feature branch (`feature/period-end-downgrades`), reviewed before merging to main.
- Migrations append at the bottom of `run_migrations()` — safe for a rolling restart.
- No feature flag; the change is self-contained in the billing router and billing UI.
- After merge and deploy, update the Stripe Customer Portal config to disable plan switching.
- No data backfill required.

---

## Risks

- **Stripe API failures during schedule creation** — if `SubscriptionSchedule.create` succeeds but `modify` fails, the user ends up with a schedule that has only phase 1 (no-op). Mitigation: wrap both calls in try/except; on inner failure, call `release` on the partially-created schedule before raising the 400 back to the client.
- **Webhook ordering** — a `subscription_schedule.released` event might race a `customer.subscription.updated` event during upgrade-while-pending. Both handlers are idempotent (clearing already-`None` columns is a no-op), so order doesn't matter.
- **Customer Portal config drift** — if someone flips "Customers can switch plans" back on in the Stripe Dashboard, portal-initiated changes would bypass this flow. Low probability; would be caught in production monitoring by an unexpected `customer.subscription.updated` event without a corresponding change-plan API call. Document the setting in this spec and in the billing router's module docstring so future contributors know it is load-bearing.
