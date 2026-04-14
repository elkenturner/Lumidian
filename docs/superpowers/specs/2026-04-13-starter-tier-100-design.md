# Starter Tier ($100/mo) — Design Spec

**Date:** 2026-04-13
**Status:** Draft

---

## Overview

Add a new $100/mo entry-level paid tier to bridge the gap between Free ($0) and the current Starter ($300/mo). The current "Starter" tier is renamed to "Growth" in the UI only — internal keys are unchanged.

### Goals

1. **Land-and-expand** — convert free users who won't jump to $300, create natural upgrade pressure as they grow
2. **Solo practitioner** — a complete experience for individuals/small brands who don't need Growth/Pro scale

---

## Naming & Internal Keys

Display-only rename. Internal database keys are NOT changed to avoid data migration risk.

| Internal key | Display name | Price |
|-------------|-------------|-------|
| `None` / `""` | Free | $0 |
| `"basic"` | Starter | $100/mo |
| `"starter"` | Growth | $300/mo |
| `"pro"` | Pro | $500/mo |

A `TIER_DISPLAY_NAMES` constant is added to both backend (`billing.py`) and frontend (`lib/tiers.ts` or equivalent) with clear comments explaining that internal keys differ from display names and must not be renamed without a data migration.

A `TIER_ORDER` constant defines rendering order: `[None, "basic", "starter", "pro"]`.

---

## Limits

### Full Comparison Table

| Feature | Free | Starter ($100) | Growth ($300) | Pro ($500) |
|---------|------|-----------------|---------------|------------|
| Brands | 1 pitch | 1 standard | 1 standard | 2 pro |
| Prompts/brand | 10 | 15 | 25 | 100 |
| Manual runs/day | 1 | 2 | 3 | Unlimited |
| Competitors/brand | 3 | 3 | 5 | 15 |
| Weekly scans | 2 | 5 | 10 | 25 |
| Team members | 0 | 0 | 1 | 3 |
| Draft queue | 5 | 10 | 20 | 20 |
| Scheduled drafts | 10 | 25 | 50 | 100 |
| LinkedIn/X drafts | No | No | No | Yes |
| LLM models | Standard | Standard | Standard | Enhanced |
| Support | — | Email | Email | Priority |

### Upgrade Pressure Points (basic → starter)

- Prompts (15 → 25)
- Runs/day (2 → 3)
- Competitors (3 → 5)
- Scans/week (5 → 10)
- Team members (0 → 1)
- Draft queue (10 → 20)
- Scheduled drafts (25 → 50)

---

## Backend Changes

### Approach

Distributed constants (Approach A) — add `"basic"` key to every existing limit dict. No refactoring of the existing constant pattern.

### Files to Modify

**`backend/app/routers/billing.py`:**
- Add `TIER_DISPLAY_NAMES` dict with comments explaining internal key ≠ display name
- Add `TIER_ORDER` list
- Add `"basic"` to: `TIER_PRICES`, `TIER_LIMITS`, `BRAND_TYPE_LIMITS`, `DAILY_RUN_LIMITS`, `COMPETITOR_LIMITS`, `TEAM_MEMBER_LIMITS`, `WEEKLY_SCAN_LIMITS`
- Add `"basic"` as valid tier in `create-checkout` endpoint
- Add `"basic"` as valid tier in `change-plan` endpoint
- New env var: `STRIPE_BASIC_PRICE_ID`

**`backend/app/services/drafting_service.py`:**
- Add `"basic": 10` to `TIER_DRAFT_CAPS`

**`backend/app/routers/content.py`:**
- Add `"basic": 25` to `TIER_SCHEDULED_CAPS`

**`backend/.env.example`:**
- Add `STRIPE_BASIC_PRICE_ID=price_...`

### No Changes Needed

- `llm_service.py` — basic gets standard models automatically (enhanced only triggers for `"pro"`)
- `dependencies.py` — `PRO_ONLY_PLATFORMS` unchanged, LinkedIn/X stays Pro-only
- `tracking_service.py` — reads limits from billing dicts, picks up basic automatically
- `models.py` — `subscription_tier` is already a free-form string field

### Stripe Integration

- New env var `STRIPE_BASIC_PRICE_ID` maps to a Stripe price created manually in the Stripe dashboard
- `TIER_PRICES` gets `"basic": os.getenv("STRIPE_BASIC_PRICE_ID", "")`
- Checkout creates subscription with `tier: "basic"` in metadata

### Webhook Behavior for Basic Tier

- **`checkout.session.completed`**: sets `subscription_tier = "basic"`, upgrades pitch brands → standard with `prompt_limit = 15`
- **`customer.subscription.updated`**: tier changes (basic ↔ starter ↔ pro) trigger brand upgrade/downgrade logic, adjusting `prompt_limit` accordingly
- **`customer.subscription.deleted`**: clears tier, downgrades brands

### Downgrade to Basic

- Pro brands → standard, `brand_type` set to `"standard"`, `prompt_limit` set to 15
- Standard brands (from Growth): `prompt_limit` reduced to 15
- Existing prompts exceeding the new limit are preserved — user can't add new prompts until count is under 15
- Team members: all active team memberships are revoked (basic has 0 seats)

---

## Frontend Changes

### Files to Modify

**`frontend/app/settings/billing/page.tsx`:**
- Add `TIER_FEATURES["basic"]` with Starter features list
- Rename existing `TIER_FEATURES["starter"]` display to "Growth"
- Render 3 pricing cards: Starter ($100) | Growth ($300) | Pro ($500)
- Use `TIER_DISPLAY_NAMES` for all label rendering

**`frontend/app/page.tsx` (landing page):**
- Update pricing section to show 3 tiers with correct display names and prices

**`frontend/app/account/page.tsx`:**
- Update `tierLabel` mapping: `basic → 'Starter — $100/mo'`, `starter → 'Growth — $300/mo'`

**Display name utility:**
- Add `TIER_DISPLAY_NAMES` map to frontend (in billing page or shared `lib/tiers.ts`)
- Mirror of backend mapping with same comments about internal keys

### No Changes Needed

- Onboarding — basic creates standard brands, same flow as current starter
- Content page — upgrade prompts already gate on Pro for LinkedIn/X
- Middleware — no tier-based routing

---

## Testing

- Add `"basic"` to existing billing/checkout tests
- Test tier transitions: free → basic, basic → starter, basic → pro, starter → basic, pro → basic
- Test limit enforcement at basic tier boundaries (15 prompts, 2 runs/day, etc.)
- Test brand upgrade/downgrade: pitch → standard (prompt_limit=15) on basic subscription
- Test display name rendering in frontend (verify "Growth" appears, not "Starter" for $300 tier)

---

## Out of Scope

- No centralized tier config refactor (Approach B) — follow existing distributed pattern
- No database migration for renaming "starter" key
- No new brand type — basic tier uses existing "standard" brand type
- No LLM model upgrades for basic tier
- No LinkedIn/X access for basic tier
