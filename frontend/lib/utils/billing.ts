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
