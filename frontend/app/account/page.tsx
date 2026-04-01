'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  AlertTriangle,
  Loader2,
  CreditCard,
  X,
  CheckCircle,
  Lock,
  ArrowRight,
  ArrowUpRight,
  Trash2,
  Check,
  ShieldCheck,
} from 'lucide-react';
import {
  getBillingStatus,
  createCheckoutSession,
  createPortalSession,
  cancelSubscription,
  changePlan,
  BillingStatus,
} from '@/lib/api';
import { useAuth } from '@/contexts/AuthContext';

const BLOCKED_STATUSES = new Set(['canceled', 'past_due', 'unpaid']);

const PLAN_ROWS = [
  { label: 'Price',                    starter: '$300 / mo',       pro: '$500 / mo' },
  { label: 'Standard brands',          starter: '2',               pro: '2' },
  { label: 'Prompts per brand',        starter: '25',              pro: '100' },
  { label: 'Pitch decks',              starter: '1 (30 days)',     pro: '3 (30 days each)' },
  { label: 'Manual runs',              starter: '3 / day',         pro: 'Unlimited' },
  { label: 'Weekly auto-drafts',       starter: '✓',               pro: '✓' },
  { label: 'Manual drafts',            starter: '10 / week',       pro: '25 / week' },
  { label: 'Competitors per brand',    starter: '5',               pro: '15' },
  { label: 'Team seats',               starter: '1',               pro: '3' },
  { label: 'AI models tracked',        starter: '4',               pro: '4' },
  { label: 'Support',                  starter: 'Email',           pro: 'Priority' },
];

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
  const [upgradeLoading, setUpgradeLoading] = useState<string | null>(null);
  const [portalLoading, setPortalLoading] = useState(false);
  const [cancelLoading, setCancelLoading] = useState(false);
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);
  const [switchLoading, setSwitchLoading] = useState<string | null>(null);
  const [switchSuccess, setSwitchSuccess] = useState<string | null>(null);
  const [billingError, setBillingError] = useState<string | null>(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleteInput, setDeleteInput] = useState('');

  useEffect(() => { document.title = 'Account — Lumidian'; }, []);

  useEffect(() => {
    getBillingStatus()
      .then(setBilling)
      .catch(() => setBillingError('Could not load billing status'))
      .finally(() => setBillingLoading(false));
  }, []);

  async function handleUpgrade(tier: string) {
    setUpgradeLoading(tier);
    setBillingError(null);
    try {
      const { checkout_url } = await createCheckoutSession(tier);
      window.location.href = checkout_url;
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setBillingError(msg ?? 'Could not start checkout. Please try again.');
      setUpgradeLoading(null);
    }
  }

  async function handlePortal() {
    setPortalLoading(true);
    setBillingError(null);
    try {
      const { portal_url } = await createPortalSession();
      window.location.href = portal_url;
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setBillingError(msg ?? 'Could not open billing portal.');
      setPortalLoading(false);
    }
  }

  async function handleSwitch(tier: string) {
    setSwitchLoading(tier);
    setBillingError(null);
    setSwitchSuccess(null);
    try {
      await changePlan(tier);
      const updated = await getBillingStatus();
      setBilling(updated);
      setSwitchSuccess(tier === 'pro'
        ? 'Upgraded to Pro — 100 prompts/brand and unlimited runs are now active.'
        : 'Switched to Starter. Changes apply at your next billing cycle.');
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setBillingError(msg ?? 'Could not switch plan. Please try again.');
    } finally {
      setSwitchLoading(null);
    }
  }

  async function handleCancel() {
    setCancelLoading(true);
    setBillingError(null);
    try {
      await cancelSubscription();
      const updated = await getBillingStatus();
      setBilling(updated);
      setShowCancelConfirm(false);
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setBillingError(msg ?? 'Could not cancel subscription.');
    } finally {
      setCancelLoading(false);
    }
  }

  const currentTier = billing?.subscription_tier ?? null;
  const subStatus = billing?.subscription_status ?? null;
  const isBlocked = subStatus !== null && BLOCKED_STATUSES.has(subStatus) && !billing?.is_admin;
  const hasActiveSub = !!billing?.stripe_subscription_id && subStatus !== 'canceled';
  const isCanceling = subStatus === 'canceling';
  const isAdmin = billing?.is_admin || user?.is_admin;
  const tierPrice = currentTier === 'starter' ? '$300/mo' : currentTier === 'pro' ? '$500/mo' : null;

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
              <button
                onClick={handlePortal}
                disabled={portalLoading}
                className="mt-2 flex items-center gap-1.5 text-xs font-medium text-red-400 hover:text-red-300 transition-colors cursor-pointer"
              >
                {portalLoading ? <Loader2 size={11} className="animate-spin" /> : <ArrowRight size={11} />}
                Update payment in Stripe →
              </button>
            )}
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_268px] gap-5 items-start">

        {/* ── Subscription ─────────────────────────────── */}
        <section className="order-2 lg:order-1 bg-[rgba(99,102,241,0.06)] border border-[rgba(99,102,241,0.20)] rounded-xl shadow-[0_4px_28px_rgba(0,0,0,0.28)] overflow-hidden">

          {/* Header */}
          <div className="flex items-center justify-between px-5 py-4 border-b border-[rgba(99,102,241,0.12)]">
            <div className="flex items-center gap-2.5">
              <CreditCard size={14} className="text-[#6366f1]" />
              <span className="text-sm font-semibold text-[#F0F4F8]">Plan</span>
              {!isAdmin && tierPrice && (
                <span className="text-xs text-[#6366f1] font-medium">{tierPrice}</span>
              )}
            </div>
            <div className="flex items-center gap-2">
              {billingLoading && <Loader2 size={13} className="animate-spin text-[#6366f1]" />}
              {!billingLoading && isAdmin && (
                <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium border bg-[rgba(99,102,241,0.14)] text-[#818cf8] border-[rgba(99,102,241,0.28)]">Admin</span>
              )}
              {!billingLoading && !isAdmin && <StatusPill status={subStatus} />}
            </div>
          </div>

          {/* Alerts */}
          {(billingError || switchSuccess || isCanceling) && (
            <div className="px-5 pt-4">
              {billingError && (
                <div className="flex items-start gap-2 text-xs text-amber-400 bg-amber-950/30 border border-amber-900/40 rounded-lg px-3 py-2.5">
                  <AlertTriangle size={13} className="shrink-0 mt-0.5" />
                  {billingError}
                </div>
              )}
              {switchSuccess && (
                <div className="flex items-start gap-2 text-xs text-emerald-400 bg-emerald-950/30 border border-emerald-900/40 rounded-lg px-3 py-2.5">
                  <CheckCircle size={13} className="shrink-0 mt-0.5" />
                  {switchSuccess}
                </div>
              )}
              {isCanceling && (
                <div className="flex items-start gap-2 text-xs text-amber-400 bg-amber-950/20 border border-amber-900/30 rounded-lg px-3 py-2.5">
                  <AlertTriangle size={13} className="shrink-0 mt-0.5" />
                  Cancels at end of billing period — access continues until then.
                </div>
              )}
            </div>
          )}

          {/* Plan comparison table — always visible */}
          <div className="px-5 pt-5 pb-1">
            <div className="rounded-lg border border-[rgba(99,102,241,0.16)] overflow-hidden text-xs">

              {/* Column headers */}
              <div className="grid grid-cols-[1fr_1fr_1fr]">
                <div className="px-4 py-3 bg-[rgba(255,255,255,0.02)] border-b border-[rgba(99,102,241,0.12)]" />
                {/* Starter header */}
                <div className={`px-4 py-3 text-center font-semibold border-b border-x border-[rgba(99,102,241,0.14)] ${
                  currentTier === 'starter'
                    ? 'bg-[rgba(99,102,241,0.18)] text-[#a5b4fc]'
                    : 'bg-[rgba(99,102,241,0.05)] text-[#475569]'
                }`}>
                  <span>Starter</span>
                  {currentTier === 'starter' && (
                    <span className="ml-1.5 text-[9px] font-bold px-1.5 py-0.5 rounded bg-[rgba(99,102,241,0.35)] text-[#c7d2fe]">CURRENT</span>
                  )}
                </div>
                {/* Pro header */}
                <div className={`px-4 py-3 text-center font-semibold border-b border-[rgba(99,102,241,0.14)] ${
                  currentTier === 'pro'
                    ? 'bg-[rgba(99,102,241,0.18)] text-[#a5b4fc]'
                    : 'bg-[rgba(99,102,241,0.05)] text-[#475569]'
                }`}>
                  <span>Pro</span>
                  {currentTier === 'pro' && (
                    <span className="ml-1.5 text-[9px] font-bold px-1.5 py-0.5 rounded bg-[rgba(99,102,241,0.35)] text-[#c7d2fe]">CURRENT</span>
                  )}
                </div>
              </div>

              {/* Rows */}
              {PLAN_ROWS.map((row, i) => {
                const isEven = i % 2 === 0;
                const rowBg = isEven ? '' : 'bg-[rgba(255,255,255,0.018)]';
                const starterActive = currentTier === 'starter';
                const proActive = currentTier === 'pro';
                const same = row.starter === row.pro;
                return (
                  <div key={row.label} className="grid grid-cols-[1fr_1fr_1fr]">
                    <div className={`px-4 py-2.5 text-[#64748B] ${rowBg}`}>{row.label}</div>
                    <div className={`px-4 py-2.5 text-center border-x border-[rgba(99,102,241,0.10)] ${rowBg} ${
                      starterActive
                        ? 'text-[#CBD5E1] bg-[rgba(99,102,241,0.04)]'
                        : 'text-[#475569]'
                    }`}>
                      {same
                        ? <span className="flex justify-center"><Check size={12} className={starterActive ? 'text-[#6366f1]' : 'text-[#334155]'} /></span>
                        : row.starter}
                    </div>
                    <div className={`px-4 py-2.5 text-center ${rowBg} ${
                      proActive
                        ? 'text-[#CBD5E1] bg-[rgba(99,102,241,0.04)]'
                        : 'text-[#475569]'
                    }`}>
                      {same
                        ? <span className="flex justify-center"><Check size={12} className={proActive ? 'text-[#6366f1]' : 'text-[#334155]'} /></span>
                        : row.pro}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* CTA row */}
          <div className="px-5 py-4 flex flex-wrap items-center gap-3">
            {isAdmin && (
              <p className="text-xs text-[#475569] italic">Admin account — billing actions are not applicable.</p>
            )}

            {!isAdmin && !isCanceling && (
              <>
                {currentTier === 'starter' && hasActiveSub && (
                  <button
                    onClick={() => handleSwitch('pro')}
                    disabled={!!switchLoading}
                    className="flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold bg-[#6366f1] hover:bg-[#4f46e5] text-white rounded-lg transition-colors disabled:opacity-50 cursor-pointer"
                  >
                    {switchLoading === 'pro' ? <Loader2 size={12} className="animate-spin" /> : <ArrowUpRight size={12} />}
                    Upgrade to Pro
                  </button>
                )}
                {currentTier === 'pro' && hasActiveSub && (
                  <button
                    onClick={() => handleSwitch('starter')}
                    disabled={!!switchLoading}
                    className="flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium bg-[rgba(99,102,241,0.12)] hover:bg-[rgba(99,102,241,0.20)] text-[#818cf8] border border-[rgba(99,102,241,0.25)] rounded-lg transition-colors disabled:opacity-50 cursor-pointer"
                  >
                    {switchLoading === 'starter' && <Loader2 size={12} className="animate-spin" />}
                    Downgrade to Starter
                  </button>
                )}
                {!currentTier && !hasActiveSub && (
                  <div className="flex gap-2">
                    <button
                      onClick={() => handleUpgrade('starter')}
                      disabled={!!upgradeLoading}
                      className="flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium bg-[rgba(99,102,241,0.12)] hover:bg-[rgba(99,102,241,0.20)] text-[#818cf8] border border-[rgba(99,102,241,0.25)] rounded-lg transition-colors disabled:opacity-50 cursor-pointer"
                    >
                      {upgradeLoading === 'starter' && <Loader2 size={12} className="animate-spin" />}
                      {upgradeLoading === 'starter' ? 'Redirecting…' : 'Subscribe — Starter'}
                    </button>
                    <button
                      onClick={() => handleUpgrade('pro')}
                      disabled={!!upgradeLoading}
                      className="flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold bg-[#6366f1] hover:bg-[#4f46e5] text-white rounded-lg transition-colors disabled:opacity-50 cursor-pointer"
                    >
                      {upgradeLoading === 'pro' ? <Loader2 size={12} className="animate-spin" /> : <ArrowUpRight size={12} />}
                      {upgradeLoading === 'pro' ? 'Redirecting…' : 'Subscribe — Pro'}
                    </button>
                  </div>
                )}
                {subStatus === 'canceled' && (
                  <div className="flex gap-2">
                    <button
                      onClick={() => handleUpgrade('starter')}
                      disabled={!!upgradeLoading}
                      className="flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium bg-[rgba(99,102,241,0.12)] hover:bg-[rgba(99,102,241,0.20)] text-[#818cf8] border border-[rgba(99,102,241,0.25)] rounded-lg transition-colors disabled:opacity-50 cursor-pointer"
                    >
                      {upgradeLoading === 'starter' && <Loader2 size={12} className="animate-spin" />}
                      Resubscribe — Starter
                    </button>
                    <button
                      onClick={() => handleUpgrade('pro')}
                      disabled={!!upgradeLoading}
                      className="flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold bg-[#6366f1] hover:bg-[#4f46e5] text-white rounded-lg transition-colors disabled:opacity-50 cursor-pointer"
                    >
                      {upgradeLoading === 'pro' ? <Loader2 size={12} className="animate-spin" /> : <ArrowUpRight size={12} />}
                      Resubscribe — Pro
                    </button>
                  </div>
                )}
              </>
            )}

            {hasActiveSub && !isAdmin && (
              <button
                onClick={handlePortal}
                disabled={portalLoading}
                className="flex items-center gap-1.5 text-xs text-[#64748B] hover:text-[#94A3B8] transition-colors disabled:opacity-50 cursor-pointer ml-auto"
              >
                {portalLoading ? <Loader2 size={11} className="animate-spin" /> : <CreditCard size={11} />}
                Invoices &amp; payment
              </button>
            )}

            {hasActiveSub && !isAdmin && !isCanceling && (
              showCancelConfirm ? (
                <div className="flex items-center gap-2">
                  <span className="text-xs text-[#64748B]">Cancel at period end?</span>
                  <button
                    onClick={handleCancel}
                    disabled={cancelLoading}
                    className="text-xs text-red-400 hover:text-red-300 font-medium disabled:opacity-50 flex items-center gap-1 cursor-pointer"
                  >
                    {cancelLoading && <Loader2 size={11} className="animate-spin" />}
                    Confirm
                  </button>
                  <button onClick={() => setShowCancelConfirm(false)} className="cursor-pointer">
                    <X size={12} className="text-[#475569]" />
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => setShowCancelConfirm(true)}
                  className="text-xs text-[#475569] hover:text-[#64748B] transition-colors cursor-pointer"
                >
                  Cancel plan
                </button>
              )
            )}
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
