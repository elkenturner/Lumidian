'use client';

import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { CreditCard, Check, Loader2, Zap, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { getBillingStatus, createCheckoutSession, createPortalSession, BillingStatus } from '@/lib/api';
import { useAuth } from '@/contexts/AuthContext';

const TIER_FEATURES: Record<string, string[]> = {
  starter: ['25 tracked prompts', '4 AI models', 'Twice-daily reports', 'Gap analysis', 'Content drafts'],
  pro: ['100 tracked prompts', '4 AI models', 'Twice-daily reports', 'Advanced gap analysis', 'Priority content drafts', 'Competitor comparison', 'Priority support'],
};

export default function BillingPage() {
  const { user } = useAuth();
  const searchParams = useSearchParams();
  const [status, setStatus] = useState<BillingStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [upgrading, setUpgrading] = useState<string | null>(null);
  const [portalLoading, setPortalLoading] = useState(false);

  const successParam = searchParams.get('success');

  useEffect(() => {
    getBillingStatus()
      .then(setStatus)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  async function handleUpgrade(tier: string) {
    setUpgrading(tier);
    try {
      const { checkout_url } = await createCheckoutSession(tier);
      window.location.href = checkout_url;
    } catch (err: any) {
      alert(err?.response?.data?.detail || 'Failed to create checkout session. Check Stripe configuration.');
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
      alert(err?.response?.data?.detail || 'Failed to open billing portal.');
    } finally {
      setPortalLoading(false);
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
                  {currentTier === 'starter' ? '25 prompts included' : currentTier === 'pro' ? '100 prompts included' : '25 prompts on free plan'}
                </p>
              </div>
            )}

            {currentTier && !isAdmin && (
              <button
                onClick={handlePortal}
                disabled={portalLoading}
                className="mt-4 flex items-center gap-2 text-sm text-[#64748b] hover:text-[#94a3b8] transition-colors"
              >
                {portalLoading ? <Loader2 size={13} className="animate-spin" /> : null}
                Manage billing in Stripe →
              </button>
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

          {/* Stripe test mode notice */}
          <div className="flex items-start gap-2 mt-6 px-1">
            <AlertTriangle size={13} className="text-[#f59e0b] flex-shrink-0 mt-0.5" />
            <p className="text-xs text-[#475569]">
              Stripe is in <span className="text-[#f59e0b]">test mode</span>. No real charges will occur.
              Use card 4242 4242 4242 4242 with any future date and CVC.
            </p>
          </div>
        </>
      )}
    </div>
  );
}
