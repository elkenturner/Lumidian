'use client';

import { motion } from 'framer-motion';
import { fadeIn } from '@/lib/motion';
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
  Shield,
  CheckCircle2,
  LogOut,
} from 'lucide-react';
import {
  getBillingStatus,
  BillingStatus,
  changePassword,
} from '@/lib/api';
import { useAuth } from '@/contexts/AuthContext';
import { logError } from '@/lib/utils/errors';

const BLOCKED_STATUSES = new Set(['canceled', 'past_due', 'unpaid']);

function StatusPill({ status }: { status: string | null }) {
  if (!status) return null;
  const map: Record<string, { label: string; cls: string }> = {
    active:    { label: 'Active',     cls: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/25' },
    trialing:  { label: 'Trial',      cls: 'bg-blue-500/15 text-blue-400 border-blue-500/25' },
    canceling: { label: 'Canceling',  cls: 'bg-amber-500/15 text-amber-400 border-amber-500/25' },
    past_due:  { label: 'Past due',   cls: 'bg-red-500/15 text-red-400 border-red-500/25' },
    unpaid:    { label: 'Unpaid',     cls: 'bg-red-500/15 text-red-400 border-red-500/25' },
    canceled:  { label: 'Canceled',   cls: 'bg-[rgba(255,255,255,0.06)] text-[var(--text-muted)] border-[rgba(255,255,255,0.10)]' },
  };
  const s = map[status] ?? { label: status, cls: 'bg-[rgba(255,255,255,0.06)] text-[var(--text-muted)] border-[rgba(255,255,255,0.10)]' };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium border ${s.cls}`}>
      {s.label}
    </span>
  );
}

function InitialsAvatar({ name, email }: { name?: string | null; email?: string | null }) {
  const letter = (name || email || 'U').charAt(0).toUpperCase();
  return (
    <div className="w-11 h-11 rounded-full flex items-center justify-center shrink-0 bg-gradient-to-br from-[rgba(95,126,166,0.35)] to-[rgba(74,106,144,0.25)] border border-[rgba(95,126,166,0.4)] shadow-[0_0_0_3px_rgba(95,126,166,0.08)]">
      <span className="text-base font-bold text-[var(--accent-foreground)] leading-none select-none">{letter}</span>
    </div>
  );
}

export default function AccountPage() {
  const { user, logout } = useAuth();
  const router = useRouter();

  const [billing, setBilling] = useState<BillingStatus | null>(null);
  const [billingLoading, setBillingLoading] = useState(true);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleteInput, setDeleteInput] = useState('');
  const [showPasswordForm, setShowPasswordForm] = useState(false);
  const [currentPw, setCurrentPw] = useState('');
  const [newPw, setNewPw] = useState('');
  const [pwSaving, setPwSaving] = useState(false);
  const [pwMsg, setPwMsg] = useState<{ text: string; ok: boolean } | null>(null);

  useEffect(() => { document.title = 'Account \u2014 Lumidian'; }, []);

  useEffect(() => {
    getBillingStatus()
      .then(setBilling)
      .catch((err) => logError(err, 'Account: fetch billing status'))
      .finally(() => setBillingLoading(false));
  }, []);

  const currentTier = billing?.subscription_tier ?? null;
  const subStatus = billing?.subscription_status ?? null;
  const isBlocked = subStatus !== null && BLOCKED_STATUSES.has(subStatus) && !billing?.is_admin;
  const isAdmin = billing?.is_admin || user?.is_admin;
  const tierLabel = currentTier === 'starter' ? 'Starter \u2014 $300/mo' : currentTier === 'pro' ? 'Pro \u2014 $500/mo' : 'Free';

  return (
    <motion.div
      variants={fadeIn}
      initial="hidden"
      animate="visible"
      className="px-3 sm:px-8 py-4 sm:py-8 max-w-7xl"
    >
      <div className="mb-7">
        <h1 className="text-2xl font-bold text-[var(--text-primary)]">Account</h1>
        <p className="text-[13px] text-[var(--text-muted)] mt-1">Manage your subscription and account settings</p>
      </div>

      {/* Blocked banner */}
      {isBlocked && (
        <div className="mb-6 flex items-start gap-3 bg-red-950/30 border border-red-900/50 rounded-xl px-4 py-4">
          <AlertTriangle size={15} className="text-red-400 shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-red-400">
              {subStatus === 'past_due' || subStatus === 'unpaid'
                ? 'Service paused \u2014 payment required'
                : 'Subscription ended \u2014 service paused'}
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
                Update payment in Stripe &rarr;
              </Link>
            )}
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_268px] gap-5 items-start">

        {/* Plan (compact) */}
        <section className="order-2 lg:order-1 bg-[var(--bg-raised)] border border-[var(--border-subtle)] rounded-xl shadow-[0_4px_28px_rgba(0,0,0,0.28)] overflow-hidden">
          <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--border-subtle)]">
            <div className="flex items-center gap-2.5">
              <CreditCard size={14} className="text-[var(--accent)]" />
              <span className="text-sm font-semibold text-[var(--text-primary)]">Plan</span>
            </div>
            <div className="flex items-center gap-2">
              {billingLoading && <Loader2 size={13} className="animate-spin text-[var(--accent)]" />}
              {!billingLoading && isAdmin && (
                <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium border bg-[rgba(95,126,166,0.14)] text-[var(--accent-foreground)] border-[rgba(95,126,166,0.28)]">Admin</span>
              )}
              {!billingLoading && !isAdmin && <StatusPill status={subStatus} />}
            </div>
          </div>

          <div className="px-5 py-5">
            {billingLoading ? null : isAdmin ? (
              <p className="text-sm text-[var(--text-faint)] italic">Admin account &mdash; unlimited access.</p>
            ) : (
              <div>
                <p className="text-lg font-bold text-[var(--text-primary)]">
                  {tierLabel}
                </p>
                {subStatus === 'canceling' && (
                  <p className="text-xs text-amber-400 mt-1.5">Cancels at end of billing period &mdash; access continues until then.</p>
                )}
              </div>
            )}
          </div>

          <div className="px-5 pb-5">
            <Link
              href="/settings/billing"
              className="flex items-center gap-1.5 text-xs text-[var(--accent)] hover:text-[var(--accent-foreground)] transition-colors"
            >
              <ArrowRight size={11} />
              Manage plan &amp; billing
            </Link>
          </div>
        </section>

        {/* Right column */}
        <div className="order-1 lg:order-2 space-y-4">

          {/* Profile & Security combined card */}
          <section className="bg-[var(--bg-raised)] border border-[var(--border-subtle)] rounded-xl shadow-[0_4px_28px_rgba(0,0,0,0.28)] overflow-hidden">
            {/* Avatar + name/email */}
            <div className="px-5 pt-5 pb-4 flex items-center gap-3.5 border-b border-[var(--border-subtle)]">
              <div className="w-11 h-11 rounded-full flex items-center justify-center shrink-0 bg-gradient-to-br from-[rgba(95,126,166,0.35)] to-[rgba(74,106,144,0.22)] border border-[rgba(95,126,166,0.38)] shadow-[0_0_0_3px_rgba(95,126,166,0.07)]">
                <span className="text-base font-bold text-[var(--accent-foreground)] leading-none select-none">
                  {(user?.name || user?.email || 'U').charAt(0).toUpperCase()}
                </span>
              </div>
              <div className="min-w-0">
                <p className="text-sm font-semibold text-[var(--text-primary)] leading-tight">
                  {user?.name || user?.email?.split('@')[0]}
                </p>
                <p className="text-xs text-[var(--text-muted)] truncate mt-0.5">{user?.email}</p>
              </div>
            </div>

            {/* Security */}
            <div className="px-5 py-4">
              <div className="flex items-center gap-2 mb-3">
                <ShieldCheck size={12} className="text-[var(--accent)]" />
                <span className="text-xs font-semibold text-[var(--text-secondary)] uppercase tracking-wide" style={{ fontSize: '10px', letterSpacing: '0.06em' }}>Security</span>
              </div>
              <div className="flex items-center gap-2 mb-3">
                <Lock size={11} className="text-[var(--text-faint)]" />
                <span className="text-xs text-[var(--text-muted)]">Email verification enabled</span>
              </div>
              {user?.totp_enabled ? (
                <div className="flex items-center gap-2 text-xs text-[#22c55e] mb-3">
                  <CheckCircle2 size={13} />
                  Two-factor authentication enabled
                </div>
              ) : (
                <div className="flex items-center gap-2 text-xs text-[var(--text-faint)] mb-3">
                  <Shield size={13} />
                  Two-factor authentication not enabled
                </div>
              )}
              {!showPasswordForm ? (
                <button
                  onClick={() => { setShowPasswordForm(true); setPwMsg(null); }}
                  className="flex items-center gap-1.5 text-xs text-[var(--accent)] hover:text-[var(--accent-foreground)] transition-colors cursor-pointer"
                >
                  <ArrowRight size={11} />
                  Change password
                </button>
              ) : (
                <div className="mt-1 space-y-2">
                  <input
                    type="password"
                    value={currentPw}
                    onChange={(e) => setCurrentPw(e.target.value)}
                    placeholder="Current password"
                    className="mobile-input w-full bg-[rgba(255,255,255,0.04)] border border-[rgba(255,255,255,0.10)] text-[var(--text-primary)] text-xs rounded-lg px-3 py-2 focus:outline-none focus:border-[var(--accent)] placeholder-[var(--text-faint)]"
                  />
                  <input
                    type="password"
                    value={newPw}
                    onChange={(e) => setNewPw(e.target.value)}
                    placeholder="New password (min 8 chars)"
                    className="mobile-input w-full bg-[rgba(255,255,255,0.04)] border border-[rgba(255,255,255,0.10)] text-[var(--text-primary)] text-xs rounded-lg px-3 py-2 focus:outline-none focus:border-[var(--accent)] placeholder-[var(--text-faint)]"
                  />
                  {pwMsg && (
                    <p className={`text-[11px] ${pwMsg.ok ? 'text-emerald-400' : 'text-red-400'}`}>{pwMsg.text}</p>
                  )}
                  <div className="flex gap-2">
                    <button
                      onClick={() => { setShowPasswordForm(false); setCurrentPw(''); setNewPw(''); setPwMsg(null); }}
                      className="flex-1 py-1.5 text-xs text-[var(--text-faint)] border border-[rgba(255,255,255,0.07)] rounded-lg hover:text-[var(--text-muted)] transition-colors cursor-pointer"
                    >
                      Cancel
                    </button>
                    <button
                      disabled={pwSaving || !currentPw || !newPw}
                      onClick={async () => {
                        setPwSaving(true);
                        setPwMsg(null);
                        try {
                          await changePassword(currentPw, newPw);
                          setPwMsg({ text: 'Password updated.', ok: true });
                          setCurrentPw('');
                          setNewPw('');
                          setTimeout(() => setShowPasswordForm(false), 1500);
                        } catch (err: unknown) {
                          const e = err as { response?: { data?: { detail?: string } } };
                          setPwMsg({ text: e?.response?.data?.detail || 'Failed to update password.', ok: false });
                        } finally {
                          setPwSaving(false);
                        }
                      }}
                      className="flex-1 flex items-center justify-center gap-1.5 py-1.5 text-xs text-[var(--accent-foreground)] bg-[rgba(95,126,166,0.15)] hover:bg-[rgba(95,126,166,0.25)] rounded-lg disabled:opacity-30 disabled:cursor-not-allowed transition-colors cursor-pointer"
                    >
                      {pwSaving && <Loader2 size={11} className="animate-spin" />}
                      Save
                    </button>
                  </div>
                </div>
              )}
            </div>
          </section>

          {/* Sign out */}
          <button
            onClick={async () => { await logout(); router.push('/login'); }}
            className="w-full flex items-center justify-center gap-2 text-sm text-[var(--text-muted)] hover:text-[var(--text-primary)] bg-[var(--bg-raised)] border border-[var(--border-subtle)] rounded-xl p-3.5 transition-colors cursor-pointer"
          >
            <LogOut size={14} />
            Sign out
          </button>

          {/* Delete account */}
          <section className="bg-[var(--bg-raised)] border border-[var(--border-subtle)] rounded-xl p-5">
            <p className="text-xs font-semibold text-[var(--text-faint)] mb-1">Delete account</p>
            <p className="text-[11px] text-[var(--text-muted)] mb-3 leading-relaxed">
              Removes all brands, history, and drafts. Cannot be undone.
            </p>
            {!showDeleteConfirm ? (
              <button
                onClick={() => setShowDeleteConfirm(true)}
                className="flex items-center gap-1.5 text-xs text-[var(--text-faint)] hover:text-red-400 border border-[rgba(255,255,255,0.07)] hover:border-red-900/30 rounded-lg px-3 py-2.5 sm:py-1.5 min-h-[44px] sm:min-h-0 transition-colors cursor-pointer"
              >
                <Trash2 size={11} />
                Request deletion
              </button>
            ) : (
              <div>
                <p className="text-xs text-[var(--text-faint)] mb-2">
                  Type <span className="text-[var(--text-secondary)] font-mono">DELETE</span> to confirm
                </p>
                <input
                  type="text"
                  value={deleteInput}
                  onChange={(e) => setDeleteInput(e.target.value)}
                  placeholder="DELETE"
                  className="mobile-input w-full bg-[rgba(255,255,255,0.04)] border border-[rgba(255,255,255,0.10)] text-[var(--text-primary)] text-xs rounded-lg px-3 py-2 mb-2 focus:outline-none focus:border-[rgba(255,255,255,0.20)] placeholder-[var(--text-faint)]"
                />
                <div className="flex gap-2">
                  <button
                    onClick={() => { setShowDeleteConfirm(false); setDeleteInput(''); }}
                    className="flex-1 py-1.5 text-xs text-[var(--text-faint)] border border-[rgba(255,255,255,0.07)] rounded-lg hover:text-[var(--text-muted)] transition-colors cursor-pointer"
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
    </motion.div>
  );
}
