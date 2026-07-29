# Pro-Only Plan + Weekly Tracking Cadence — Design

**Date:** 2026-07-29
**Status:** Approved direction (Ken, 2026-07-29); spec pending review
**Related:** MSC Growth-tier diagnosis (this session), CLAUDE.md tier tables

## Problem

The 4-tier system (Free / Starter `basic` / Growth `starter` / Pro `pro`) branches in ~40
places across backend and frontend, but only the Pro path is actually exercised — agency
brands are force-treated as Pro, and until today Pro was the only well-tested paid tier.
Lower tiers fail in ways that read as bugs, not plan limits. Diagnosed on MSC (Growth):

- **Wikipedia lockout**: Growth allows 4 scans/rolling-30-days; MSC hit the cap July 20
  and every scan since is rejected until mid-August. Pro is unlimited.
- **Claude silently missing**: Growth queries 3 models; the dashboard's "locked model"
  tile only handles pitch brands, so Growth users see a missing model with no explanation.
- **Weaker writer**: Growth drafts use Sonnet; Pro uses Opus.
- **Invisible caps** that fail like bugs: 3 manual runs/day, 5 competitors, 75 coach
  messages/day, smaller site-audit limits.

Decision: collapse to **one paid plan (Pro)**. Also move scheduled tracking from daily to
**weekly** — daily runs mostly re-measure unchanged visibility and burn API budget.

## Design

### 1. Entitlement flattening (data-level, not code-level)

Keep the tier plumbing; make `pro` the only paid value that can exist.

- **Migration** (new step at the bottom of `database.py:run_migrations()`):
  - `UPDATE users SET subscription_tier='pro' WHERE subscription_tier IN ('basic','starter')`
  - Upgrade those users' standard brands the same way `billing._sync_brands_for_tier`
    does on a tier change (brand_type `standard`→`pro`, prompt_limit to Pro's 30).
    Pitch brands untouched.
- **Stripe webhook** (`billing.py`): map **all three** price IDs
  (`STRIPE_BASIC_PRICE_ID`, `STRIPE_STARTER_PRICE_ID`, `STRIPE_PRO_PRICE_ID`) → `"pro"`,
  so renewals/plan events can never write `basic`/`starter` back.
- **Checkout**: new subscriptions only offer the Pro price. Change-plan
  (upgrade/downgrade) endpoints and UI are removed; Stripe billing portal remains for
  cancel/payment-method.
- **Grandfathering**: existing subscribers keep their current Stripe price (MSC stays at
  $300/mo) but receive full Pro entitlements. No Stripe migration.
- **Gate tables stay in place** (`TIER_DRAFT_CAPS`, `TIER_SCHEDULED_CAPS`,
  `TIER_AUDIT_LIMITS`, wikipedia caps, coach caps, `billing.py` limit tables,
  `models_for_tier`, `writer_model_for_tier`): after flattening, only `None` and `"pro"`
  occur at runtime, so lower-tier rows become dead data. Deleting them is a follow-up
  cleanup, not part of this change (keeps the diff small and reversible).
- **Free tier (`None`) and pitch brands are unchanged** — Free remains the teaser
  (Perplexity + Gemini, existing caps); pitch stays keyed on `brand_type`.

### 2. Frontend

- `settings/billing`: single Pro plan card (features from the current Pro column);
  remove the 3-card comparison, upgrade/downgrade ranking, and pending-tier banners.
  Grandfathered users see their actual price from the billing status endpoint.
- Remove upgrade CTAs that target paid users: sidebar "Upgrade" pill (keep for Free),
  dashboard limit-hit upsell modal paths that can no longer trigger, coach
  `LimitHitCard` upsell copy (Pro caps only).
- `lib/tiers.ts`: display name for any paid tier is "Pro".
- Onboarding `TIER_BRAND_TYPE`: any paid tier → `pro` brand type.

### 3. Weekly tracking cadence

- `scheduler.py` `morning_sweep`: `CronTrigger(hour=8)` daily →
  `CronTrigger(day_of_week="mon", hour=8)` (Monday 08:00 UTC). Agency brands already
  sweep weekly (Sunday 02:00) — unchanged.
- Manual runs are unlimited on Pro, so users who need a fresh number run one on demand.
- **Copy**: dashboard "Updated Xh ago · next report in ~Yh" footer must reflect weekly
  cadence ("next weekly check Monday"); "vs previous report" language already
  cadence-neutral.
- **Visibility-drop alert job** (daily 21:00) compares the latest two completed runs; it
  simply fires at most weekly now. No change needed, but verify it doesn't re-alert on
  the same run pair across the 6 idle days (dedupe by run id if it does).
- The daily-run-limit gate (`DAILY_RUN_LIMITS`) becomes unlimited for everyone paid via
  flattening; Free keeps its cap.

### 4. Out of scope

- Deleting the tier tables/plumbing wholesale (follow-up cleanup once stable).
- Stripe price migration for grandfathered subscribers.
- Removing the Free tier or changing pitch-brand behavior.
- MSC site-audit crawler bug (both audits crawled only 1 page — separate ticket).

## Testing

- Migration test: users with `basic`/`starter` become `pro`; their standard brands
  become `pro` brand_type; pitch brands and Free users untouched; idempotent on re-run.
- Webhook test: all three price IDs resolve to `pro`.
- `models_for_tier` / caps behavior for flattened users (Claude present, unlimited
  wikipedia scans, Opus writer).
- Scheduler: `morning_sweep` trigger is weekly; existing sweep tests still pass.
- Frontend: tsc + build; billing page renders single-plan state for Free and paid.

## Completed prerequisite (2026-07-29)

Brand purge executed on prod + local dev: all brands deleted except MSC (brand 2).
Prod removed 7 brands + ~199,740 descendant rows across 35 tables (incl. all
agency-cockpit client rows); local removed 4 brands + 506 rows. Pre-purge snapshots:
`/data/backups/pre-brand-purge-20260729.db` (prod, 345 MB) and
`backend/clarity_ai.db.pre-brand-purge-20260729` (local). User accounts untouched.
