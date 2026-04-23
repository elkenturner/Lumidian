'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { AlertTriangle, Clock, X, ExternalLink, Loader2 } from 'lucide-react';
import { createPortalSession } from '@/lib/api';
import { AppToast, ToastData } from '@/components/AppToast';

interface Props {
  status: string;  // 'past_due' | 'canceled' | 'unpaid' | 'trialing'
  daysRemaining?: number | null;
  trialEnd?: string | null;
}

export default function SubscriptionBanner({ status, daysRemaining, trialEnd }: Props) {
  const [loading, setLoading] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [toast, setToast] = useState<ToastData | null>(null);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(t);
  }, [toast]);

  if (dismissed) return null;

  const isPastDue  = status === 'past_due' || status === 'unpaid';
  const isCanceled = status === 'canceled';
  const isTrialEndingSoon = status === 'trialing' && typeof daysRemaining === 'number' && daysRemaining < 7;

  if (!isPastDue && !isCanceled && !isTrialEndingSoon) return null;

  async function openPortal() {
    setLoading(true);
    try {
      const { portal_url } = await createPortalSession();
      window.location.href = portal_url;
    } catch {
      setToast({ message: 'Could not open billing portal. Please try again.', type: 'error' });
    } finally {
      setLoading(false);
    }
  }

  // Trial ending soon — amber banner
  if (isTrialEndingSoon) {
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

  // Past due / canceled — red banner
  return (
    <div className="mx-8 mt-4 mb-0 flex items-center gap-3 rounded-xl border border-[#7f1d1d]/40 bg-[#7f1d1d]/15 px-4 py-3">
      <AlertTriangle size={16} className="shrink-0 text-[var(--danger)]" />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-[var(--danger-text)]">
          {isPastDue
            ? 'Payment failed — your subscription is past due.'
            : 'Your subscription has been canceled.'}
        </p>
        <p className="text-xs text-[var(--danger)]/70 mt-0.5">
          {isPastDue
            ? 'AI tracking and content generation are paused until your payment is updated.'
            : 'Reactivate your plan to resume AI tracking and content generation.'}
        </p>
      </div>
      <button
        onClick={openPortal}
        disabled={loading}
        className="shrink-0 flex items-center gap-1.5 rounded-lg bg-[var(--danger)]/20 hover:bg-[var(--danger)]/30 border border-[var(--danger)]/30 px-3 py-1.5 text-xs font-semibold text-[var(--danger-text)] transition-colors disabled:opacity-60"
      >
        {loading
          ? <Loader2 size={12} className="animate-spin" />
          : <ExternalLink size={12} />}
        {isPastDue ? 'Update payment' : 'Reactivate plan'}
      </button>
      <button
        onClick={() => setDismissed(true)}
        className="shrink-0 text-[var(--danger)]/50 hover:text-[var(--danger)] transition-colors"
        aria-label="Dismiss"
      >
        <X size={14} />
      </button>
      {toast && <AppToast {...toast} onDismiss={() => setToast(null)} />}
    </div>
  );
}
