'use client';

import { useState } from 'react';
import { AlertTriangle, X, ExternalLink, Loader2 } from 'lucide-react';
import { createPortalSession } from '@/lib/api';

interface Props {
  status: string;  // 'past_due' | 'canceled' | 'unpaid'
}

export default function SubscriptionBanner({ status }: Props) {
  const [loading, setLoading] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  if (dismissed) return null;

  const isPastDue  = status === 'past_due' || status === 'unpaid';
  const isCanceled = status === 'canceled';

  if (!isPastDue && !isCanceled) return null;

  async function openPortal() {
    setLoading(true);
    try {
      const { portal_url } = await createPortalSession();
      window.location.href = portal_url;
    } catch {
      alert('Could not open billing portal. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mx-8 mt-4 mb-0 flex items-center gap-3 rounded-xl border border-[#7f1d1d]/40 bg-[#7f1d1d]/15 px-4 py-3">
      <AlertTriangle size={16} className="shrink-0 text-[#f87171]" />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-[#fca5a5]">
          {isPastDue
            ? 'Payment failed — your subscription is past due.'
            : 'Your subscription has been canceled.'}
        </p>
        <p className="text-xs text-[#f87171]/70 mt-0.5">
          {isPastDue
            ? 'AI tracking and content generation are paused until your payment is updated.'
            : 'Reactivate your plan to resume AI tracking and content generation.'}
        </p>
      </div>
      <button
        onClick={openPortal}
        disabled={loading}
        className="shrink-0 flex items-center gap-1.5 rounded-lg bg-[#ef4444]/20 hover:bg-[#ef4444]/30 border border-[#ef4444]/30 px-3 py-1.5 text-xs font-semibold text-[#fca5a5] transition-colors disabled:opacity-60"
      >
        {loading
          ? <Loader2 size={12} className="animate-spin" />
          : <ExternalLink size={12} />}
        {isPastDue ? 'Update payment' : 'Reactivate plan'}
      </button>
      <button
        onClick={() => setDismissed(true)}
        className="shrink-0 text-[#f87171]/50 hover:text-[#f87171] transition-colors"
        aria-label="Dismiss"
      >
        <X size={14} />
      </button>
    </div>
  );
}
