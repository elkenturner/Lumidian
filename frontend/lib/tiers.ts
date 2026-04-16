/**
 * Tier display name mapping — single source of truth for the frontend.
 *
 * Internal keys are stored in the database (subscription_tier), Stripe
 * metadata, and throughout the codebase. The "starter" key predates the
 * current naming — it displays as "Growth" in the UI.
 *
 * Do NOT rename internal keys without a data migration.
 * See also: TIER_DISPLAY_NAMES in backend/app/routers/billing.py
 */

export const TIER_DISPLAY_NAMES: Record<string, string> = {
  basic: 'Starter',     // $100/mo — entry-level paid tier
  starter: 'Growth',    // $300/mo — formerly "Starter" in the UI
  pro: 'Pro',           // $500/mo
};

export const TIER_PRICES: Record<string, string> = {
  basic: '$100',
  starter: '$300',
  pro: '$500',
};

/** Display name with price, e.g. "Starter — $100/mo" */
export function tierLabel(key: string | null): string {
  if (!key) return 'Free';
  const name = TIER_DISPLAY_NAMES[key] ?? key;
  const price = TIER_PRICES[key];
  return price ? `${name} \u2014 ${price}/mo` : name;
}
