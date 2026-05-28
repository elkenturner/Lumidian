'use client';

import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { CreditCard, Check, Loader2, Zap, AlertTriangle, CheckCircle2, X } from 'lucide-react';
import { getBillingStatus, createCheckoutSession, createPortalSession, cancelSubscription, changePlan, BillingStatus } from '@/lib/api';
import { useAuth } from '@/contexts/AuthContext';
import { logError } from '@/lib/utils/errors';
import { AppToast, ToastData } from '@/components/AppToast';

import { TIER_DISPLAY_NAMES, TIER_PRICES } from '@/lib/tiers';

const TIER_FEATURES: Record<string, string[]> = {
  basic: [
    '1 standard brand',
    '10 tracked prompts per brand',
    '2 manual runs per day',
    'Content drafts (10 queued)',
    'LinkedIn & X content drafts',
    '5 manual opportunity scans per week',
    '3 competitors tracked per brand',
    '4 AI models tracked (with ChatGPT web search)',
    'Email support',
  ],
  starter: [
    '1 standard brand',
    '25 tracked prompts per brand',
    '3 manual runs per day',
    'Unlimited content drafts',
    'LinkedIn & X content drafts',
    '10 manual opportunity scans per week',
    '5 competitors tracked per brand',
    '1 additional team member',
    '4 AI models tracked',
    'Email support',
  ],
  pro: [
    '2 pro brands',
    '30 tracked prompts per brand',
    'Unlimited manual runs',
    'Unlimited content drafts',
    'LinkedIn & X content drafts',
    '25 manual opportunity scans per week',
    '15 competitors tracked per brand',
    '3 additional team members',
    '4 AI models tracked (enhanced)',
    'Priority support',
  ],
};

export default function BillingPage() {
  const { user, refresh } = useAuth();
  const searchParams = useSearchParams();
  const [status, setStatus] = useState<BillingStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [upgrading, setUpgrading] = useState<string | null>(null);
  const [portalLoading, setPortalLoading] = useState(false);
  const [cancelLoading, setCancelLoading] = useState(false);
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [toast, setToast] = useState<ToastData | null>(null);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(t);
  }, [toast]);

  const successParam = searchParams.get('success');

  useEffect(() => {
    const init = async () => {
      try {
        const [s] = await Promise.all([
          getBillingStatus(),
          successParam === 'true' ? refresh().catch((err) => logError(err, 'Billing: refresh auth after checkout success')) : Promise.resolve(),
        ]);
        setStatus(s);
      } catch {
        setLoadError('Could not load billing status. Please refresh the page.');
      } finally {
        setLoading(false);
      }
    };
    init();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const [confirmTier, setConfirmTier] = useState<string | null>(null);

  async function handleUpgrade(tier: string) {
    // Existing subscribers: switch plan in-place via Stripe subscription modify
    const hasActiveSub = currentTier && status?.subscription_status && !['canceled', 'incomplete_expired'].includes(status.subscription_status);
    if (hasActiveSub) {
      setConfirmTier(tier);
      return;
    }
    // New subscribers: send to Stripe checkout
    setUpgrading(tier);
    try {
      const { checkout_url } = await createCheckoutSession(tier);
      window.location.href = checkout_url;
    } catch (err: unknown) {
      const e = err as { response?: { data?: { detail?: string } } };
      setToast({ message: e?.response?.data?.detail || 'Unable to start checkout. Please try again or contact support.', type: 'error' });
    } finally {
      setUpgrading(null);
    }
  }

  async function handleConfirmSwitch() {
    if (!confirmTier) return;
    setUpgrading(confirmTier);
    try {
      await changePlan(confirmTier);
      setConfirmTier(null);
      const updated = await getBillingStatus();
      setStatus(updated);
      await refresh();
    } catch (err: unknown) {
      const e = err as { response?: { data?: { detail?: string } } };
      setToast({ message: e?.response?.data?.detail || 'Unable to switch plan. Please try again or contact support.', type: 'error' });
    } finally {
      setUpgrading(null);
    }
  }

  async function handleCancelDowngrade() {
    if (!currentTier) return;
    setUpgrading(currentTier);
    try {
      await changePlan(currentTier);
      const updated = await getBillingStatus();
      setStatus(updated);
    } catch (err: unknown) {
      const e = err as { response?: { data?: { detail?: string } } };
      alert(e?.response?.data?.detail || 'Could not cancel the downgrade.');
    } finally {
      setUpgrading(null);
    }
  }

  async function handlePortal() {
    setPortalLoading(true);
    try {
      const { portal_url } = await createPortalSession();
      window.location.href = portal_url;
    } catch (err: unknown) {
      const e = err as { response?: { data?: { detail?: string } } };
      setToast({ message: e?.response?.data?.detail || 'Unable to open the billing portal. Please try again.', type: 'error' });
    } finally {
      setPortalLoading(false);
    }
  }

  async function handleCancel() {
    setCancelLoading(true);
    try {
      await cancelSubscription();
      setShowCancelConfirm(false);
      // Reload billing status to show updated state
      const updated = await getBillingStatus();
      setStatus(updated);
    } catch (err: unknown) {
      const e = err as { response?: { data?: { detail?: string } } };
      setToast({ message: e?.response?.data?.detail || 'Unable to cancel subscription. Please try again or contact support.', type: 'error' });
    } finally {
      setCancelLoading(false);
    }
  }

  const currentTier = status?.subscription_tier || user?.subscription_tier;
  const isAdmin = status?.is_admin || user?.is_admin;
  const pendingDate = status?.pending_tier_effective_at ? new Date(status.pending_tier_effective_at) : null;

  return (
    <div className="px-8 py-8 max-w-3xl">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-[var(--text-primary)]">Billing & Plan</h1>
        <p className="text-[13px] text-[var(--text-muted)] mt-1.5">Manage your subscription and prompt limits</p>
      </div>

      {/* Cancel confirmation modal */}
      {showCancelConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/60" onClick={() => setShowCancelConfirm(false)} />
          <div className="card relative max-w-sm w-full shadow-2xl max-h-[90vh] overflow-y-auto">
            <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-2">Cancel subscription?</h3>
            <p className="text-xs text-[var(--text-muted)] mb-4">
              Your plan will remain active until the end of the current billing period, then revert to the free plan.
            </p>
            <div className="flex gap-2">
              <button
                onClick={() => setShowCancelConfirm(false)}
                className="flex-1 py-2 text-xs text-[var(--text-muted)] hover:text-[var(--text-secondary)] border border-[var(--border-default)] rounded-lg transition-colors"
              >
                Keep plan
              </button>
              <button
                onClick={handleCancel}
                disabled={cancelLoading}
                className="flex-1 flex items-center justify-center gap-1.5 py-2 text-xs font-medium text-[var(--danger)] bg-[var(--danger)]/10 hover:bg-[var(--danger)]/20 border border-[var(--danger)]/25 rounded-lg transition-colors disabled:opacity-50"
              >
                {cancelLoading && <Loader2 size={11} className="animate-spin" />}
                Confirm cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Plan switch confirmation modal */}
      {confirmTier && (() => {
        const tierRank = { basic: 0, starter: 1, pro: 2 } as const;
        const currentRank = currentTier ? tierRank[currentTier as keyof typeof tierRank] ?? -1 : -1;
        const targetRank = tierRank[confirmTier as keyof typeof tierRank] ?? 0;
        const isDowngrade = targetRank < currentRank;
        const targetName = TIER_DISPLAY_NAMES[confirmTier] || confirmTier;
        const targetPrice = TIER_PRICES[confirmTier] || '$0';
        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div className="absolute inset-0 bg-black/60" onClick={() => setConfirmTier(null)} />
            <div className="card relative max-w-sm w-full shadow-2xl max-h-[90vh] overflow-y-auto">
              <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-2">
                {isDowngrade ? 'Downgrade' : 'Upgrade'} to {targetName}?
              </h3>
              <p className="text-xs text-[var(--text-muted)] mb-4">
                {isDowngrade
                  ? `Your plan will switch to ${targetName} (${targetPrice}/mo) at your next billing cycle. You'll keep your current features until then.`
                  : `Your plan will switch to ${targetName} (${targetPrice}/mo). The new rate applies at your next billing cycle.`}
              </p>
              <div className="flex gap-2">
                <button
                  onClick={() => setConfirmTier(null)}
                  className="flex-1 py-2 text-xs text-[var(--text-muted)] hover:text-[var(--text-secondary)] border border-[var(--border-default)] rounded-lg transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleConfirmSwitch}
                  disabled={upgrading !== null}
                  className={`flex-1 flex items-center justify-center gap-1.5 py-2 text-xs font-medium rounded-lg transition-colors disabled:opacity-50 ${
                    isDowngrade
                      ? 'text-[var(--warning)] bg-[var(--warning)]/10 hover:bg-[var(--warning)]/20 border border-[var(--warning)]/25'
                      : 'text-white bg-[var(--accent)] hover:bg-[var(--accent-hover)]'
                  }`}
                >
                  {upgrading && <Loader2 size={11} className="animate-spin" />}
                  Confirm {isDowngrade ? 'downgrade' : 'upgrade'}
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Pending downgrade banner */}
      {status?.pending_tier && status.pending_tier_effective_at && (
        <div className="mb-6 rounded-lg border border-[var(--warning)]/30 bg-[var(--warning)]/10 px-4 py-3 flex items-start gap-3">
          <AlertTriangle size={16} className="text-[var(--warning)] mt-0.5 flex-shrink-0" />
          <div className="flex-1 text-xs text-[var(--text-primary)]">
            <p>
              Your plan changes to <strong>{TIER_DISPLAY_NAMES[status.pending_tier] || status.pending_tier}</strong>
              {' on '}
              <strong>
                {pendingDate!.toLocaleDateString(undefined, {
                  year: 'numeric', month: 'long', day: 'numeric',
                })}
              </strong>.
            </p>
            <p className="text-[var(--text-muted)] mt-1">
              You keep your current features until that date.
            </p>
          </div>
          <button
            onClick={handleCancelDowngrade}
            disabled={upgrading !== null}
            className="text-xs font-medium text-[var(--text-primary)] hover:underline disabled:opacity-50"
          >
            Cancel downgrade
          </button>
        </div>
      )}

      {/* Success banner */}
      {successParam === 'true' && (
        <div className="flex items-center gap-3 bg-[var(--success)]/10 border border-[var(--success)]/25 rounded-xl px-4 py-3 mb-6">
          <CheckCircle2 size={16} className="text-[var(--success)] flex-shrink-0" />
          <p className="text-sm text-[var(--success)] font-medium">
            {currentTier
              ? `${TIER_DISPLAY_NAMES[currentTier] ?? (currentTier.charAt(0).toUpperCase() + currentTier.slice(1))} plan activated — you now have full access.`
              : 'Subscription activated! Your plan has been updated.'}
          </p>
        </div>
      )}

      {/* Admin bypass notice */}
      {isAdmin && (
        <div className="flex items-center gap-3 bg-[var(--accent)]/10 border border-[var(--accent)]/20 rounded-xl px-4 py-3 mb-6">
          <Zap size={16} className="text-[var(--accent-foreground)] flex-shrink-0" />
          <p className="text-sm text-[var(--accent-foreground)]">Admin account — unlimited prompts, all billing checks bypassed.</p>
        </div>
      )}

      {loadError && (
        <div className="flex items-center gap-3 bg-[#7f1d1d]/20 border border-[#991b1b]/30 rounded-xl px-4 py-3 mb-6">
          <AlertTriangle size={16} className="text-[var(--danger)] flex-shrink-0" />
          <p className="text-sm text-[var(--danger)]">{loadError}</p>
        </div>
      )}

      {/* Past-due banner */}
      {(status?.subscription_status === 'past_due' || status?.subscription_status === 'unpaid') && (
        <div className="flex items-start gap-3 bg-[#7f1d1d]/20 border border-[#991b1b]/40 rounded-xl px-4 py-3 mb-6">
          <AlertTriangle size={16} className="text-[var(--danger)] flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-sm text-[var(--danger)] font-medium">Payment past due</p>
            <p className="text-xs text-[var(--danger-text)]/70 mt-0.5">
              Update your payment method to restore full access and avoid service interruption.
            </p>
            <button
              onClick={handlePortal}
              className="mt-2 text-xs text-[var(--danger)] underline hover:no-underline transition-[text-decoration-line]"
            >
              Update payment method →
            </button>
          </div>
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 size={24} className="animate-spin text-[var(--accent)]" />
        </div>
      ) : (
        <>
          {/* Current plan card */}
          <div className="card rounded-xl p-6 mb-6">
            <div className="flex items-center justify-between mb-4">
              <div>
                <p className="text-xs text-[var(--text-muted)] uppercase tracking-wide mb-1">Current Plan</p>
                <p className="text-xl font-bold text-[var(--text-primary)]">
                  {isAdmin ? 'Admin (Unlimited)' : currentTier ? `${TIER_DISPLAY_NAMES[currentTier] ?? (currentTier.charAt(0).toUpperCase() + currentTier.slice(1))} Plan` : 'Free Plan'}
                </p>
                {status?.subscription_status && (
                  <p className={`text-xs mt-1 ${status.subscription_status === 'active' ? 'text-[var(--success)]' : 'text-[var(--warning)]'}`}>
                    {status.subscription_status.charAt(0).toUpperCase() + status.subscription_status.slice(1)}
                  </p>
                )}
              </div>
              <div className="w-10 h-10 bg-[var(--accent)]/10 rounded-xl flex items-center justify-center">
                <CreditCard size={18} className="text-[var(--accent-foreground)]" />
              </div>
            </div>

            {!isAdmin && (
              <div className="bg-[var(--accent-muted)] rounded-lg px-4 py-3">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-xs text-[var(--text-muted)]">Prompt limit</p>
                  <p className="text-xs font-semibold font-mono text-[var(--text-secondary)]">
                    {status?.prompt_limit ?? user?.prompt_limit ?? 10} max
                  </p>
                </div>
                <p className="text-xs text-[var(--text-faint)]">
                  {currentTier === 'basic' ? '10 prompts per brand' : currentTier === 'starter' ? '25 prompts per brand' : currentTier === 'pro' ? '30 prompts per brand' : '10 prompts on free plan — upgrade for more'}
                </p>
              </div>
            )}

            {/* Canceling notice */}
            {status?.subscription_status === 'canceling' && (
              <div className="flex items-center gap-2 bg-[var(--warning)]/10 border border-[var(--warning)]/20 rounded-lg px-3 py-2.5 mt-3">
                <AlertTriangle size={13} className="text-[var(--warning)] flex-shrink-0" />
                <p className="text-xs text-[var(--warning)]">Subscription canceling — access continues until the end of the billing period.</p>
              </div>
            )}

            {currentTier && !isAdmin && (
              <div className="flex items-center gap-4 mt-4">
                <button
                  onClick={handlePortal}
                  disabled={portalLoading}
                  className="flex items-center gap-2 text-sm text-[var(--text-muted)] hover:text-[var(--text-secondary)] transition-colors"
                >
                  {portalLoading ? <Loader2 size={13} className="animate-spin" /> : null}
                  Manage billing in Stripe →
                </button>
                {status?.subscription_status !== 'canceling' && (
                  <button
                    onClick={() => setShowCancelConfirm(true)}
                    className="flex items-center gap-1 text-xs text-[var(--text-faint)] hover:text-[var(--danger)] transition-colors"
                  >
                    <X size={11} />
                    Cancel plan
                  </button>
                )}
              </div>
            )}
          </div>

          {/* Plan options */}
          {!isAdmin && (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {(['basic', 'starter', 'pro'] as const).map((tier) => {
                const isCurrent = currentTier === tier;
                const price = TIER_PRICES[tier] || '$0';
                const displayName = TIER_DISPLAY_NAMES[tier] || tier;
                const tierRank = { basic: 0, starter: 1, pro: 2 } as const;
                const currentRank = currentTier ? tierRank[currentTier as keyof typeof tierRank] ?? -1 : -1;
                const thisRank = tierRank[tier];
                const isUpgrade = thisRank > currentRank && currentRank >= 0;
                const isDowngrade = thisRank < currentRank;

                return (
                  <div
                    key={tier}
                    className={`bg-[var(--accent-muted)] rounded-xl p-6 border-2 transition-colors ${
                      isCurrent ? 'border-[var(--accent)]' : 'border-[var(--border-default)]'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-3">
                      <p className="text-sm font-semibold text-[var(--text-secondary)] uppercase tracking-wide">{displayName}</p>
                      {isCurrent && (
                        <span className="text-xs bg-[var(--accent)]/20 text-[var(--accent-foreground)] px-2 py-0.5 rounded-full font-medium">Current</span>
                      )}
                    </div>
                    <div className="flex items-end gap-1 mb-4">
                      <span className="text-3xl font-bold font-mono text-[var(--text-primary)]">{price}</span>
                      <span className="text-[var(--text-muted)] mb-1 text-sm">/mo</span>
                    </div>
                    <ul className="space-y-2 mb-5">
                      {TIER_FEATURES[tier].map((f) => (
                        <li key={f} className="flex items-start gap-2">
                          <Check size={13} className="text-[var(--success)] flex-shrink-0 mt-0.5" />
                          <span className="text-xs text-[var(--text-muted)]">{f}</span>
                        </li>
                      ))}
                    </ul>
                    {isCurrent ? (
                      <button disabled className="w-full bg-[rgba(255,255,255,0.04)] border border-[var(--bg-tinted-hover)] text-[var(--text-faint)] rounded-lg py-2 text-sm font-medium">
                        Current plan
                      </button>
                    ) : status?.pending_tier === tier && status.pending_tier_effective_at ? (
                      <button
                        disabled
                        aria-label={`Downgrade to ${displayName} scheduled for ${pendingDate!.toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' })}`}
                        className="w-full bg-[rgba(255,255,255,0.04)] border border-[var(--bg-tinted-hover)] text-[var(--text-faint)] rounded-lg py-2 text-sm font-medium cursor-not-allowed"
                      >
                        Scheduled for {pendingDate!.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                      </button>
                    ) : (
                      <button
                        onClick={() => handleUpgrade(tier)}
                        disabled={upgrading !== null}
                        className={`w-full flex items-center justify-center gap-2 rounded-lg py-2 text-sm font-medium transition-colors ${
                          isUpgrade
                            ? 'bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-white'
                            : 'bg-[rgba(255,255,255,0.05)] hover:bg-[var(--border-faint)] border border-[var(--bg-tinted-hover)] text-[var(--text-secondary)]'
                        } disabled:opacity-50`}
                      >
                        {upgrading === tier ? <Loader2 size={13} className="animate-spin" /> : null}
                        {upgrading === tier ? (currentTier ? 'Switching\u2026' : 'Redirecting\u2026') : isUpgrade ? `Upgrade to ${displayName}` : isDowngrade ? `Downgrade to ${displayName}` : 'Subscribe'}
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {/* Stripe test mode notice -- dev only */}
          {process.env.NODE_ENV === 'development' && (
            <div className="flex items-start gap-2 mt-6 px-1">
              <AlertTriangle size={13} className="text-[var(--warning)] flex-shrink-0 mt-0.5" />
              <p className="text-xs text-[var(--text-faint)]">
                Stripe is in <span className="text-[var(--warning)]">test mode</span>. No real charges will occur.
                Use card 4242 4242 4242 4242 with any future date and CVC.
              </p>
            </div>
          )}
        </>
      )}
      {toast && <AppToast {...toast} onDismiss={() => setToast(null)} />}
    </div>
  );
}
