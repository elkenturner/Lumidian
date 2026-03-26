'use client';

import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { CreditCard, Check, Loader2, Zap, AlertTriangle, CheckCircle2, Clock, X } from 'lucide-react';
import { getBillingStatus, createCheckoutSession, createPortalSession, cancelSubscription, BillingStatus } from '@/lib/api';
import { useAuth } from '@/contexts/AuthContext';

const TIER_FEATURES: Record<string, string[]> = {
  starter: ['25 tracked prompts', '1 standard brand', '2 pitch brands (30-day each)', '4 AI models', 'Twice-daily reports', 'Gap analysis', 'Content drafts'],
  pro: ['100 tracked prompts', '5 standard brands', '4 pitch brands (30-day each)', '4 AI models', 'Twice-daily reports', 'Advanced gap analysis', 'Priority content drafts', 'Priority support'],
};

export default function BillingPage() {
  const { user } = useAuth();
  const searchParams = useSearchParams();
  const [status, setStatus] = useState<BillingStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [upgrading, setUpgrading] = useState<string | null>(null);
  const [portalLoading, setPortalLoading] = useState(false);
  const [cancelLoading, setCancelLoading] = useState(false);
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const successParam = searchParams.get('success');

  useEffect(() => {
    getBillingStatus()
      .then(setStatus)
      .catch(() => setLoadError('Could not load billing status. Please refresh the page.'))
      .finally(() => setLoading(false));
  }, []);

  async function handleUpgrade(tier: string) {
    setUpgrading(tier);
    try {
      const { checkout_url } = await createCheckoutSession(tier);
      window.location.href = checkout_url;
    } catch (err: any) {
      alert(err?.response?.data?.detail || 'Unable to start checkout. Please try again or contact support.');
    } finally {
      setUpgrading(null);
    }
  }

  async function handlePortal() {
    setPortalLoading(true);
    try {
      const { portal_url } = await createPortalSession();
      window.location.href = portal_url;
    } catch (err: any) {
      alert(err?.response?.data?.detail || 'Unable to open the billing portal. Please try again.');
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
    } catch (err: any) {
      alert(err?.response?.data?.detail || 'Unable to cancel subscription. Please try again or contact support.');
    } finally {
      setCancelLoading(false);
    }
  }

  const currentTier = status?.subscription_tier || user?.subscription_tier;
  const isAdmin = status?.is_admin || user?.is_admin;

  return (
    <div className="px-8 py-8 max-w-3xl">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-[#e2e8f0]">Billing & Plan</h1>
        <p className="text-sm text-[#64748b] mt-1">Manage your subscription and prompt limits</p>
      </div>

      {/* Cancel confirmation modal */}
      {showCancelConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/60" onClick={() => setShowCancelConfirm(false)} />
          <div className="relative bg-[#111118] border border-[#2a2a3a] rounded-2xl p-6 max-w-sm w-full shadow-2xl max-h-[90vh] overflow-y-auto">
            <h3 className="text-sm font-semibold text-[#e2e8f0] mb-2">Cancel subscription?</h3>
            {status?.subscription_status === 'trialing' && status.subscription_trial_end ? (
              <p className="text-xs text-[#64748b] mb-4">
                You are currently in your free trial. Cancelling now means you won&apos;t be charged on{' '}
                <span className="text-[#e2e8f0] font-medium">{new Date(status.subscription_trial_end + 'Z').toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}</span>{' '}
                and your account will revert to the free plan.
              </p>
            ) : (
              <p className="text-xs text-[#64748b] mb-4">
                Your plan will remain active until the end of the current billing period, then revert to the free plan.
              </p>
            )}
            <div className="flex gap-2">
              <button
                onClick={() => setShowCancelConfirm(false)}
                className="flex-1 py-2 text-xs text-[#64748b] hover:text-[#94a3b8] border border-[#2a2a3a] rounded-lg transition-colors"
              >
                Keep plan
              </button>
              <button
                onClick={handleCancel}
                disabled={cancelLoading}
                className="flex-1 flex items-center justify-center gap-1.5 py-2 text-xs font-medium text-[#f87171] bg-[#f87171]/10 hover:bg-[#f87171]/20 border border-[#f87171]/25 rounded-lg transition-colors disabled:opacity-50"
              >
                {cancelLoading && <Loader2 size={11} className="animate-spin" />}
                Confirm cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Success banner */}
      {successParam === 'true' && (
        <div className="flex items-center gap-3 bg-[#064e3b]/20 border border-[#065f46]/40 rounded-xl px-4 py-3 mb-6">
          <CheckCircle2 size={16} className="text-[#10b981] flex-shrink-0" />
          <p className="text-sm text-[#10b981] font-medium">Subscription activated! Your plan has been updated.</p>
        </div>
      )}

      {/* Admin bypass notice */}
      {isAdmin && (
        <div className="flex items-center gap-3 bg-[#6366f1]/10 border border-[#6366f1]/20 rounded-xl px-4 py-3 mb-6">
          <Zap size={16} className="text-[#818cf8] flex-shrink-0" />
          <p className="text-sm text-[#818cf8]">Admin account — unlimited prompts, all billing checks bypassed.</p>
        </div>
      )}

      {loadError && (
        <div className="flex items-center gap-3 bg-[#7f1d1d]/20 border border-[#991b1b]/30 rounded-xl px-4 py-3 mb-6">
          <AlertTriangle size={16} className="text-[#f87171] flex-shrink-0" />
          <p className="text-sm text-[#f87171]">{loadError}</p>
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 size={24} className="animate-spin text-[#6366f1]" />
        </div>
      ) : (
        <>
          {/* Current plan card */}
          <div className="bg-[#111118] border border-[#1e1e2e] rounded-xl p-6 mb-6">
            <div className="flex items-center justify-between mb-4">
              <div>
                <p className="text-xs text-[#64748b] uppercase tracking-wide mb-1">Current Plan</p>
                <p className="text-xl font-bold text-[#e2e8f0]">
                  {isAdmin ? 'Admin (Unlimited)' : currentTier ? `${currentTier.charAt(0).toUpperCase() + currentTier.slice(1)} Plan` : 'Free Plan'}
                </p>
                {status?.subscription_status && (
                  <p className={`text-xs mt-1 ${status.subscription_status === 'active' ? 'text-[#10b981]' : 'text-[#f59e0b]'}`}>
                    {status.subscription_status.charAt(0).toUpperCase() + status.subscription_status.slice(1)}
                  </p>
                )}
              </div>
              <div className="w-10 h-10 bg-[#6366f1]/10 rounded-xl flex items-center justify-center">
                <CreditCard size={18} className="text-[#818cf8]" />
              </div>
            </div>

            {!isAdmin && (
              <div className="bg-[#0d0d14] rounded-lg px-4 py-3">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-xs text-[#64748b]">Prompt limit</p>
                  <p className="text-xs font-semibold text-[#94a3b8]">
                    {status?.prompt_limit ?? user?.prompt_limit ?? 25} max
                  </p>
                </div>
                <p className="text-xs text-[#475569]">
                  {currentTier === 'starter' ? '25 prompts included' : currentTier === 'pro' ? '100 prompts included' : '25 prompts on free plan — upgrade to Pro for 100'}
                </p>
              </div>
            )}

            {/* Trial status */}
            {status?.subscription_status === 'trialing' && status.subscription_trial_end && (
              <div className="flex items-start gap-2 bg-[#10b981]/10 border border-[#10b981]/20 rounded-lg px-3 py-2.5 mt-3">
                <Clock size={13} className="text-[#10b981] flex-shrink-0 mt-0.5" />
                <div>
                  <p className="text-xs font-medium text-[#10b981]">Free trial active</p>
                  <p className="text-xs text-[#64748b] mt-0.5">
                    Trial ends{' '}
                    <span className="text-[#94a3b8] font-medium">
                      {new Date(status.subscription_trial_end + 'Z').toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}
                    </span>
                    . Your card will be charged automatically unless you cancel before then.
                  </p>
                </div>
              </div>
            )}

            {/* Canceling notice */}
            {status?.subscription_status === 'canceling' && (
              <div className="flex items-center gap-2 bg-[#f59e0b]/10 border border-[#f59e0b]/20 rounded-lg px-3 py-2.5 mt-3">
                <AlertTriangle size={13} className="text-[#f59e0b] flex-shrink-0" />
                <p className="text-xs text-[#f59e0b]">Subscription canceling — access continues until the end of the billing period.</p>
              </div>
            )}

            {currentTier && !isAdmin && (
              <div className="flex items-center gap-4 mt-4">
                <button
                  onClick={handlePortal}
                  disabled={portalLoading}
                  className="flex items-center gap-2 text-sm text-[#64748b] hover:text-[#94a3b8] transition-colors"
                >
                  {portalLoading ? <Loader2 size={13} className="animate-spin" /> : null}
                  Manage billing in Stripe →
                </button>
                {status?.subscription_status !== 'canceling' && (
                  <button
                    onClick={() => setShowCancelConfirm(true)}
                    className="flex items-center gap-1 text-xs text-[#475569] hover:text-[#f87171] transition-colors"
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
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {(['starter', 'pro'] as const).map((tier) => {
                const isCurrent = currentTier === tier;
                const price = tier === 'starter' ? '$300' : '$500';
                const isUpgrade = tier === 'pro' && currentTier === 'starter';
                const isDowngrade = tier === 'starter' && currentTier === 'pro';

                return (
                  <div
                    key={tier}
                    className={`bg-[#111118] rounded-xl p-6 border-2 transition-colors ${
                      isCurrent ? 'border-[#6366f1]' : 'border-[#1e1e2e]'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-3">
                      <p className="text-sm font-semibold text-[#94a3b8] uppercase tracking-wide">{tier}</p>
                      {isCurrent && (
                        <span className="text-xs bg-[#6366f1]/20 text-[#818cf8] px-2 py-0.5 rounded-full font-medium">Current</span>
                      )}
                    </div>
                    <div className="flex items-end gap-1 mb-4">
                      <span className="text-3xl font-bold text-[#e2e8f0]">{price}</span>
                      <span className="text-[#64748b] mb-1 text-sm">/mo</span>
                    </div>
                    <ul className="space-y-2 mb-5">
                      {TIER_FEATURES[tier].map((f) => (
                        <li key={f} className="flex items-start gap-2">
                          <Check size={13} className="text-[#10b981] flex-shrink-0 mt-0.5" />
                          <span className="text-xs text-[#64748b]">{f}</span>
                        </li>
                      ))}
                    </ul>
                    {isCurrent ? (
                      <button disabled className="w-full bg-[#1a1a24] border border-[#2a2a3a] text-[#475569] rounded-lg py-2 text-sm font-medium">
                        Current plan
                      </button>
                    ) : (
                      <button
                        onClick={() => handleUpgrade(tier)}
                        disabled={upgrading !== null}
                        className={`w-full flex items-center justify-center gap-2 rounded-lg py-2 text-sm font-medium transition-colors ${
                          isUpgrade
                            ? 'bg-[#6366f1] hover:bg-[#4f46e5] text-white'
                            : 'bg-[#1a1a24] hover:bg-[#2a2a3a] border border-[#2a2a3a] text-[#94a3b8]'
                        } disabled:opacity-50`}
                      >
                        {upgrading === tier ? <Loader2 size={13} className="animate-spin" /> : null}
                        {upgrading === tier ? 'Redirecting…' : isUpgrade ? 'Upgrade to Pro' : isDowngrade ? 'Switch to Starter' : 'Subscribe'}
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {/* Stripe test mode notice — dev only */}
          {process.env.NODE_ENV === 'development' && (
            <div className="flex items-start gap-2 mt-6 px-1">
              <AlertTriangle size={13} className="text-[#f59e0b] flex-shrink-0 mt-0.5" />
              <p className="text-xs text-[#475569]">
                Stripe is in <span className="text-[#f59e0b]">test mode</span>. No real charges will occur.
                Use card 4242 4242 4242 4242 with any future date and CVC.
              </p>
            </div>
          )}
        </>
      )}
    </div>
  );
}
