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
