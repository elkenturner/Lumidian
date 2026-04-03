'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  AlertTriangle,
  Loader2,
  CreditCard,
  Lock,
  ArrowRight,
  Trash2,
  ShieldCheck,
} from 'lucide-react';
import {
  getBillingStatus,
  BillingStatus,
} from '@/lib/api';
import { useAuth } from '@/contexts/AuthContext';

const BLOCKED_STATUSES = new Set(['canceled', 'past_due', 'unpaid']);

function StatusPill({ status }: { status: string | null }) {
  if (!status) return null;
  const map: Record<string, { label: string; cls: string }> = {
    active:    { label: 'Active',     cls: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/25' },
    trialing:  { label: 'Trial',      cls: 'bg-blue-500/15 text-blue-400 border-blue-500/25' },
    canceling: { label: 'Canceling',  cls: 'bg-amber-500/15 text-amber-400 border-amber-500/25' },
    past_due:  { label: 'Past due',   cls: 'bg-red-500/15 text-red-400 border-red-500/25' },
    unpaid:    { label: 'Unpaid',     cls: 'bg-red-500/15 text-red-400 border-red-500/25' },
    canceled:  { label: 'Canceled',   cls: 'bg-[rgba(255,255,255,0.06)] text-[#64748B] border-[rgba(255,255,255,0.10)]' },
  };
  const s = map[status] ?? { label: status, cls: 'bg-[rgba(255,255,255,0.06)] text-[#64748B] border-[rgba(255,255,255,0.10)]' };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium border ${s.cls}`}>
      {s.label}
    </span>
  );
}

function InitialsAvatar({ name, email }: { name?: string | null; email?: string | null }) {
  const letter = (name || email || 'U').charAt(0).toUpperCase();
  return (
    <div className="w-11 h-11 rounded-full flex items-center justify-center shrink-0 bg-gradient-to-br from-[rgba(99,102,241,0.35)] to-[rgba(139,92,246,0.25)] border border-[rgba(99,102,241,0.4)] shadow-[0_0_0_3px_rgba(99,102,241,0.08)]">
      <span className="text-base font-bold text-[#a5b4fc] leading-none select-none">{letter}</span>
    </div>
  );
}

export default function AccountPage() {
  const { user } = useAuth();
  const router = useRouter();

  const [billing, setBilling] = useState<BillingStatus | null>(null);
  const [billingLoading, setBillingLoading] = useState(true);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleteInput, setDeleteInput] = useState('');

  useEffect(() => { document.title = 'Account — Lumidian'; }, []);

  useEffect(() => {
    getBillingStatus()
      .then(setBilling)
      .catch(() => {})
      .finally(() => setBillingLoading(false));
  }, []);

  const currentTier = billing?.subscription_tier ?? null;
  const subStatus = billing?.subscription_status ?? null;
  const isBlocked = subStatus !== null && BLOCKED_STATUSES.has(subStatus) && !billing?.is_admin;
  const isAdmin = billing?.is_admin || user?.is_admin;
  const tierLabel = currentTier === 'starter' ? 'Starter — $300/mo' : currentTier === 'pro' ? 'Pro — $500/mo' : 'Free';

  return (
    <div className="px-4 sm:px-8 py-6 sm:py-8 max-w-5xl">
      <div className="mb-7">
        <h1 className="text-2xl font-bold text-[#F0F4F8]">Account</h1>
        <p className="text-[13px] text-[#64748B] mt-1">Manage your subscription and account settings</p>
      </div>

      {/* Blocked banner */}
      {isBlocked && (
        <div className="mb-6 flex items-start gap-3 bg-red-950/30 border border-red-900/50 rounded-xl px-4 py-4">
          <AlertTriangle size={15} className="text-red-400 shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-red-400">
              {subStatus === 'past_due' || subStatus === 'unpaid'
                ? 'Service paused — payment required'
                : 'Subscription ended — service paused'}
            </p>
            <p className="text-xs text-red-400/60 mt-1">
              {subStatus === 'past_due' || subStatus === 'unpaid'
                ? 'Tracking runs and content drafts are disabled until your payment is resolved.'
                : 'Resubscribe below to restore full access.'}
            </p>
            {(subStatus === 'past_due' || subStatus === 'unpaid') && (
              <Link
                href="/settings/billing"
                className="mt-2 flex items-center gap-1.5 text-xs font-medium text-red-400 hover:text-red-300 transition-colors"
              >
                <ArrowRight size={11} />
                Update payment in Stripe →
              </Link>
            )}
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_268px] gap-5 items-start">

        {/* ── Plan (compact) ───────────────────────────── */}
        <section className="order-2 lg:order-1 bg-[rgba(99,102,241,0.06)] border border-[rgba(99,102,241,0.20)] rounded-xl shadow-[0_4px_28px_rgba(0,0,0,0.28)] overflow-hidden">
          <div className="flex items-center justify-between px-5 py-4 border-b border-[rgba(99,102,241,0.12)]">
            <div className="flex items-center gap-2.5">
              <CreditCard size={14} className="text-[#6366f1]" />
              <span className="text-sm font-semibold text-[#F0F4F8]">Plan</span>
            </div>
            <div className="flex items-center gap-2">
              {billingLoading && <Loader2 size={13} className="animate-spin text-[#6366f1]" />}
              {!billingLoading && isAdmin && (
                <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium border bg-[rgba(99,102,241,0.14)] text-[#818cf8] border-[rgba(99,102,241,0.28)]">Admin</span>
              )}
              {!billingLoading && !isAdmin && <StatusPill status={subStatus} />}
            </div>
          </div>

          <div className="px-5 py-5">
            {billingLoading ? null : isAdmin ? (
              <p className="text-sm text-[#475569] italic">Admin account — unlimited access.</p>
            ) : (
              <div>
                <p className="text-lg font-bold text-[#F0F4F8]">
                  {tierLabel}
                </p>
                {subStatus === 'canceling' && (
                  <p className="text-xs text-amber-400 mt-1.5">Cancels at end of billing period — access continues until then.</p>
                )}
              </div>
            )}
          </div>

          <div className="px-5 pb-5">
            <Link
              href="/settings/billing"
              className="flex items-center gap-1.5 text-xs text-[#6366f1] hover:text-[#818cf8] transition-colors"
            >
              <ArrowRight size={11} />
              Manage plan &amp; billing
            </Link>
          </div>
        </section>

        {/* ── Right column ─────────────────────────────── */}
        <div className="order-1 lg:order-2 space-y-4">

          {/* Profile & Security — combined card */}
          <section className="bg-[rgba(99,102,241,0.06)] border border-[rgba(99,102,241,0.20)] rounded-xl shadow-[0_4px_28px_rgba(0,0,0,0.28)] overflow-hidden">
            {/* Avatar + name/email */}
            <div className="px-5 pt-5 pb-4 flex items-center gap-3.5 border-b border-[rgba(99,102,241,0.10)]">
              <div className="w-11 h-11 rounded-full flex items-center justify-center shrink-0 bg-gradient-to-br from-[rgba(99,102,241,0.35)] to-[rgba(139,92,246,0.22)] border border-[rgba(99,102,241,0.38)] shadow-[0_0_0_3px_rgba(99,102,241,0.07)]">
                <span className="text-base font-bold text-[#a5b4fc] leading-none select-none">
                  {(user?.name || user?.email || 'U').charAt(0).toUpperCase()}
                </span>
              </div>
              <div className="min-w-0">
                {user?.name && (
                  <p className="text-sm font-semibold text-[#E2E8F0] truncate leading-tight">{user.name}</p>
                )}
                <p className="text-xs text-[#64748B] truncate mt-0.5">{user?.email}</p>
              </div>
            </div>

            {/* Security */}
            <div className="px-5 py-4">
              <div className="flex items-center gap-2 mb-3">
                <ShieldCheck size={12} className="text-[#6366f1]" />
                <span className="text-xs font-semibold text-[#94A3B8] uppercase tracking-wide" style={{ fontSize: '10px', letterSpacing: '0.06em' }}>Security</span>
              </div>
              <div className="flex items-center gap-2 mb-3">
                <Lock size={11} className="text-[#475569]" />
                <span className="text-xs text-[#64748B]">Email verification enabled</span>
              </div>
              <button
                onClick={() => router.push('/forgot-password')}
                className="flex items-center gap-1.5 text-xs text-[#6366f1] hover:text-[#818cf8] transition-colors cursor-pointer"
              >
                <ArrowRight size={11} />
                Change password
              </button>
            </div>
          </section>

          {/* Delete account */}
          <section className="bg-[rgba(255,255,255,0.02)] border border-[rgba(255,255,255,0.06)] rounded-xl p-5">
            <p className="text-xs font-semibold text-[#475569] mb-1">Delete account</p>
            <p className="text-[11px] text-[#334155] mb-3 leading-relaxed">
              Removes all brands, history, and drafts. Cannot be undone.
            </p>
            {!showDeleteConfirm ? (
              <button
                onClick={() => setShowDeleteConfirm(true)}
                className="flex items-center gap-1.5 text-xs text-[#475569] hover:text-red-400 border border-[rgba(255,255,255,0.07)] hover:border-red-900/30 rounded-lg px-3 py-1.5 transition-colors cursor-pointer"
              >
                <Trash2 size={11} />
                Request deletion
              </button>
            ) : (
              <div>
                <p className="text-xs text-[#475569] mb-2">
                  Type <span className="text-[#94A3B8] font-mono">DELETE</span> to confirm
                </p>
                <input
                  type="text"
                  value={deleteInput}
                  onChange={(e) => setDeleteInput(e.target.value)}
                  placeholder="DELETE"
                  className="w-full bg-[rgba(255,255,255,0.04)] border border-[rgba(255,255,255,0.10)] text-[#F0F4F8] text-xs rounded-lg px-3 py-2 mb-2 focus:outline-none focus:border-[rgba(255,255,255,0.20)] placeholder-[#334155]"
                />
                <div className="flex gap-2">
                  <button
                    onClick={() => { setShowDeleteConfirm(false); setDeleteInput(''); }}
                    className="flex-1 py-1.5 text-xs text-[#475569] border border-[rgba(255,255,255,0.07)] rounded-lg hover:text-[#64748B] transition-colors cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={() => { window.location.href = 'mailto:support@lumidian.ai?subject=Account%20Deletion%20Request&body=Please%20delete%20my%20account%20and%20all%20associated%20data.'; }}
                    disabled={deleteInput !== 'DELETE'}
                    className="flex-1 py-1.5 text-xs text-red-400/70 bg-red-950/20 hover:bg-red-950/30 rounded-lg disabled:opacity-30 disabled:cursor-not-allowed transition-colors cursor-pointer"
                  >
                    Confirm delete
                  </button>
                </div>
              </div>
            )}
          </section>

        </div>
      </div>
    </div>
  );
}
