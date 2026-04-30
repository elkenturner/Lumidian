'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { AlertTriangle, ExternalLink } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { getBillingPausedReason } from '@/lib/utils/billing';

/**
 * Persistent, non-dismissible global banner shown when the user's billing
 * state means scheduled tracking is paused (past_due, canceled,
 * incomplete_expired, or trialing-with-trial_end-in-past).
 *
 * Suppressed on /settings/billing because the user is already there to fix it.
 * Hidden when there is no user (public/auth pages).
 */
export default function BillingPausedBanner() {
  const { user } = useAuth();
  const pathname = usePathname();

  if (!user) return null;
  if (pathname === '/settings/billing') return null;

  const reason = getBillingPausedReason(user);
  if (!reason) return null;

  return (
    <div
      role="status"
      className="mx-8 mt-4 mb-0 flex items-center gap-3 rounded-xl border border-[#7f1d1d]/40 bg-[#7f1d1d]/15 px-4 py-3"
    >
      <AlertTriangle size={16} className="shrink-0 text-[var(--danger)]" />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-[var(--danger-text)]">
          {reason.message}
        </p>
      </div>
      <Link
        href="/settings/billing"
        className="shrink-0 flex items-center gap-1.5 rounded-lg bg-[var(--danger)]/20 hover:bg-[var(--danger)]/30 border border-[var(--danger)]/30 px-3 py-1.5 text-xs font-semibold text-[var(--danger-text)] transition-colors"
      >
        <ExternalLink size={12} />
        Manage billing
      </Link>
    </div>
  );
}
