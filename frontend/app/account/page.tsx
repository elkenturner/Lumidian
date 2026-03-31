'use client';

import { useEffect, useState } from 'react';
import {
  User,
  Save,
  AlertTriangle,
  Loader2,
  Trash2,
  CreditCard,
  ReceiptText,
  Zap,
  X,
  ShieldCheck,
  ShieldOff,
  QrCode,
} from 'lucide-react';
import {
  getBillingStatus,
  createCheckoutSession,
  createPortalSession,
  cancelSubscription,
  changePlan,
  setup2fa,
  enable2fa,
  disable2fa,
  BillingStatus,
  TotpSetupData,
} from '@/lib/api';
import { useAuth } from '@/contexts/AuthContext';

const PLANS = [
  {
    key: null,
    label: 'Free Trial',
    price: '$0 for 30 days',
    features: ['1 pitch brand (10 prompts)', 'No credit card required', '4 AI models tracked', 'Visibility scoring', '1 manual run per day', 'No content drafting'],
  },
  {
    key: 'starter',
    label: 'Starter',
    price: '$300/mo',
    features: [
      '2 standard brands (25 prompts each)',
      '1 pitch deck (30 days)',
      '3 manual runs per day',
      '10 content drafts per week',
      'Content Hub & gap analysis',
      'Email support',
    ],
  },
  {
    key: 'pro',
    label: 'Pro',
    price: '$500/mo',
    features: [
      '2 standard brands (100 prompts each)',
      '3 pitch decks (30 days each)',
      'Unlimited manual runs',
      '10 content drafts per week',
      'Content Hub & gap analysis',
      'Priority support',
    ],
  },
];

export default function AccountPage() {
  const { user } = useAuth();

  // Profile
  const [displayName, setDisplayName] = useState('');
  const [accountSaved, setAccountSaved] = useState(false);

  // Billing
  const [billing, setBilling] = useState<BillingStatus | null>(null);
  const [billingLoading, setBillingLoading] = useState(true);
  const [upgradeLoading, setUpgradeLoading] = useState<string | null>(null);
  const [portalLoading, setPortalLoading] = useState(false);
  const [cancelLoading, setCancelLoading] = useState(false);
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);
  const [switchLoading, setSwitchLoading] = useState<string | null>(null);
  const [switchSuccess, setSwitchSuccess] = useState<string | null>(null);
  const [billingError, setBillingError] = useState<string | null>(null);

  // 2FA
  const [twoFaEnabled, setTwoFaEnabled] = useState(false);
  const [totpSetup, setTotpSetup] = useState<TotpSetupData | null>(null);
  const [totpConfirmCode, setTotpConfirmCode] = useState('');
  const [totpDisablePassword, setTotpDisablePassword] = useState('');
  const [showDisable2fa, setShowDisable2fa] = useState(false);
  const [twoFaLoading, setTwoFaLoading] = useState(false);
  const [twoFaError, setTwoFaError] = useState<string | null>(null);
  const [twoFaSuccess, setTwoFaSuccess] = useState<string | null>(null);

  // Danger zone
  const [showDeleteAccountConfirm, setShowDeleteAccountConfirm] = useState(false);
  const [deleteAccountInput, setDeleteAccountInput] = useState('');

  useEffect(() => { document.title = 'Account — Lumidian'; }, []);

  // Sync 2FA state from user object once loaded
  useEffect(() => {
    if (user) setTwoFaEnabled(user.totp_enabled ?? false);
  }, [user]);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const stored = localStorage.getItem('clarity_settings');
      if (stored) {
        try {
          const parsed = JSON.parse(stored);
          if (parsed.displayName) setDisplayName(parsed.displayName);
        } catch { /* ignore */ }
      }
    }

    getBillingStatus()
      .then(setBilling)
      .catch(() => setBillingError('Could not load billing status'))
      .finally(() => setBillingLoading(false));
  }, []);

  function handleAccountSave() {
    if (typeof window !== 'undefined') {
      localStorage.setItem('clarity_settings', JSON.stringify({ displayName }));
    }
    setAccountSaved(true);
    setTimeout(() => setAccountSaved(false), 2500);
  }

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

  async function handleManageBilling() {
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
      setSwitchSuccess(`Switched to ${tier.charAt(0).toUpperCase() + tier.slice(1)}. Billing adjusts at your next renewal.`);
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
      setBilling((prev) => prev ? { ...prev, subscription_status: 'canceling' } : prev);
      setShowCancelConfirm(false);
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setBillingError(msg ?? 'Could not cancel subscription.');
    } finally {
      setCancelLoading(false);
    }
  }

  function handleDeleteAccount() {
    window.location.href = 'mailto:support@lumidian.ai?subject=Account%20Deletion%20Request&body=Please%20delete%20my%20account%20and%20all%20associated%20data.';
  }

  async function handleSetup2fa() {
    setTwoFaLoading(true);
    setTwoFaError(null);
    setTwoFaSuccess(null);
    try {
      const data = await setup2fa();
      setTotpSetup(data);
    } catch {
      setTwoFaError('Could not start 2FA setup. Please try again.');
    } finally {
      setTwoFaLoading(false);
    }
  }

  async function handleEnable2fa() {
    setTwoFaLoading(true);
    setTwoFaError(null);
    try {
      await enable2fa(totpConfirmCode.trim());
      setTwoFaEnabled(true);
      setTotpSetup(null);
      setTotpConfirmCode('');
      setTwoFaSuccess('Two-factor authentication is now enabled.');
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setTwoFaError(msg ?? 'Invalid code. Please try again.');
    } finally {
      setTwoFaLoading(false);
    }
  }

  async function handleDisable2fa() {
    setTwoFaLoading(true);
    setTwoFaError(null);
    try {
      await disable2fa(totpDisablePassword);
      setTwoFaEnabled(false);
      setShowDisable2fa(false);
      setTotpDisablePassword('');
      setTwoFaSuccess('Two-factor authentication has been disabled.');
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setTwoFaError(msg ?? 'Incorrect password.');
    } finally {
      setTwoFaLoading(false);
    }
  }

  const currentTier = billing?.subscription_tier ?? null;
  const subStatus = billing?.subscription_status ?? null;
  const hasActiveSub = billing?.stripe_subscription_id != null && subStatus !== 'canceled';
  const isCanceling = subStatus === 'canceling';

  return (
    <div className="px-4 sm:px-8 py-6 sm:py-8 max-w-5xl">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-[#F0F4F8]">Account</h1>
        <p className="text-[13px] text-[#64748B] mt-1.5">Manage your profile, subscription, and account settings</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_300px] gap-6 items-start">
        {/* Left column — billing */}
        <div className="space-y-6">

      {/* Subscription */}
      <section className="bg-[rgba(99,102,241,0.06)] backdrop-blur-md border border-[rgba(99,102,241,0.22)] rounded-xl p-6 shadow-[0_4px_24px_rgba(0,0,0,0.30),inset_0_1px_0_rgba(255,255,255,0.06)]">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <CreditCard className="w-4 h-4 text-[#6366f1]" />
            <h2 className="text-sm font-semibold text-[#F0F4F8]">Subscription</h2>
          </div>
          {billingLoading && <Loader2 className="w-4 h-4 text-[#6366f1] animate-spin" />}
        </div>

        {billingError && (
          <div className="mb-4 flex items-center gap-2 text-xs text-[#fb923c] bg-[#451a03]/20 border border-[#78350f]/30 rounded-lg px-3 py-2.5">
            <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
            {billingError}
          </div>
        )}

        {switchSuccess && (
          <div className="mb-4 flex items-center gap-2 text-xs text-[#34d399] bg-[#022c22]/30 border border-[#064e3b]/40 rounded-lg px-3 py-2.5">
            <Zap className="w-3.5 h-3.5 shrink-0" />
            {switchSuccess}
          </div>
        )}

        {isCanceling && (
          <div className="mb-4 flex items-center gap-2 text-xs text-[#fb923c] bg-[#451a03]/20 border border-[#78350f]/30 rounded-lg px-3 py-2.5">
            <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
            Your subscription is set to cancel at the end of the current billing period. You&apos;ll keep access until then.
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4">
          {PLANS.map((plan) => {
            const isCurrent = currentTier === plan.key;
            return (
              <div
                key={String(plan.key)}
                className={`rounded-xl p-4 border transition-colors ${
                  isCurrent
                    ? 'bg-[rgba(99,102,241,0.15)] border-[rgba(99,102,241,0.40)]'
                    : 'bg-[rgba(255,255,255,0.03)] border-[rgba(99,102,241,0.10)]'
                }`}
              >
                <div className="flex items-center justify-between mb-2">
                  <p className="text-sm font-semibold text-[#F0F4F8]">{plan.label}</p>
                  {isCurrent && (
                    <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-[rgba(99,102,241,0.25)] text-[#818CF8]">
                      Current
                    </span>
                  )}
                </div>
                <p className="text-base font-bold text-[#6366f1] mb-3">{plan.price}</p>
                <ul className="space-y-1 mb-4">
                  {plan.features.map((f) => (
                    <li key={f} className="text-xs text-[#64748B] flex items-start gap-1.5">
                      <Zap size={9} className="text-[#6366f1] flex-shrink-0 mt-0.5" />
                      {f}
                    </li>
                  ))}
                </ul>
                {!isCurrent && plan.key !== null && !billing?.is_admin && (
                  hasActiveSub ? (
                    <button
                      onClick={() => handleSwitch(plan.key!)}
                      disabled={!!switchLoading}
                      className="w-full py-1.5 text-xs font-medium rounded-lg bg-[rgba(99,102,241,0.15)] hover:bg-[rgba(99,102,241,0.25)] text-[#818CF8] border border-[rgba(99,102,241,0.30)] transition-colors disabled:opacity-50 flex items-center justify-center gap-1.5"
                    >
                      {switchLoading === plan.key ? <Loader2 className="w-3 h-3 animate-spin" /> : null}
                      Switch to {plan.label}
                    </button>
                  ) : (
                    <button
                      onClick={() => handleUpgrade(plan.key!)}
                      disabled={!!upgradeLoading}
                      className="w-full py-1.5 text-xs font-medium rounded-lg bg-[#6366f1] hover:bg-[#4f46e5] text-white border-transparent border transition-colors disabled:opacity-50 flex items-center justify-center gap-1.5"
                    >
                      {upgradeLoading === plan.key ? <Loader2 className="w-3 h-3 animate-spin" /> : null}
                      Upgrade
                    </button>
                  )
                )}
              </div>
            );
          })}
        </div>

        {/* Billing portal / cancel row */}
        {hasActiveSub && (
          <div className="flex items-center gap-3 pt-3 border-t border-[rgba(99,102,241,0.10)]">
            <button
              onClick={handleManageBilling}
              disabled={portalLoading}
              className="flex items-center gap-1.5 text-xs text-[#6366f1] hover:text-[#818cf8] transition-colors disabled:opacity-50"
            >
              {portalLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : <CreditCard className="w-3 h-3" />}
              Manage billing &amp; invoices
            </button>

            {!isCanceling && (
              <>
                <span className="text-[#475569]">·</span>
                {showCancelConfirm ? (
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-[#64748B]">Cancel at period end?</span>
                    <button
                      onClick={handleCancel}
                      disabled={cancelLoading}
                      className="text-xs text-[#ef4444] hover:text-red-400 font-medium disabled:opacity-50 flex items-center gap-1"
                    >
                      {cancelLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : null}
                      Yes, cancel
                    </button>
                    <button
                      onClick={() => setShowCancelConfirm(false)}
                      className="text-xs text-[#64748B] hover:text-[#94A3B8]"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => setShowCancelConfirm(true)}
                    className="text-xs text-[#64748B] hover:text-[#94A3B8] transition-colors"
                  >
                    Cancel subscription
                  </button>
                )}
              </>
            )}
          </div>
        )}
      </section>

      {/* Billing History */}
      <section className="bg-[rgba(99,102,241,0.06)] backdrop-blur-md border border-[rgba(99,102,241,0.22)] rounded-xl p-6 shadow-[0_4px_24px_rgba(0,0,0,0.30),inset_0_1px_0_rgba(255,255,255,0.06)]">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <ReceiptText className="w-4 h-4 text-[#6366f1]" />
            <h2 className="text-sm font-semibold text-[#F0F4F8]">Billing History</h2>
          </div>
          {billing?.stripe_customer_id && (
            <button
              onClick={handleManageBilling}
              disabled={portalLoading}
              className="text-xs text-[#6366f1] hover:text-[#818cf8] transition-colors disabled:opacity-50"
            >
              View all invoices →
            </button>
          )}
        </div>
        <div className="border border-[rgba(99,102,241,0.10)] rounded-lg overflow-hidden">
          <div className="px-4 py-3 border-b border-[rgba(99,102,241,0.10)] bg-[rgba(99,102,241,0.04)] flex items-center justify-between">
            <span className="text-xs font-semibold text-[#64748B] uppercase tracking-wide">Date</span>
            <span className="text-xs font-semibold text-[#64748B] uppercase tracking-wide">Amount</span>
          </div>
          <div className="px-4 py-10 text-center">
            <p className="text-sm text-[#475569]">No billing history yet</p>
            <p className="text-xs text-[#475569] mt-1">Invoices will appear here after your first payment</p>
          </div>
        </div>
      </section>

        </div>{/* end left column */}

        {/* Right column — profile + scheduler + danger */}
        <div className="space-y-5">

          {/* Profile */}
          <section className="bg-[rgba(99,102,241,0.06)] backdrop-blur-md border border-[rgba(99,102,241,0.22)] rounded-xl p-5 space-y-4 shadow-[0_4px_24px_rgba(0,0,0,0.30),inset_0_1px_0_rgba(255,255,255,0.06)]">
            <div className="flex items-center gap-2">
              <User className="w-4 h-4 text-[#6366f1]" />
              <h2 className="text-sm font-semibold text-[#F0F4F8]">Profile</h2>
            </div>

            {user && (
              <div className="space-y-1">
                <p className="text-xs text-[#64748B] uppercase tracking-wide">Email</p>
                <p className="text-sm text-[#94A3B8] break-all">{user.email}</p>
              </div>
            )}

            <div>
              <label className="block text-xs text-[#64748B] uppercase tracking-wide mb-1.5">Display Name</label>
              <input
                type="text"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="e.g. Acme Corp"
                className="w-full bg-[rgba(255,255,255,0.05)] border border-[rgba(99,102,241,0.18)] text-[#F0F4F8] text-sm rounded-lg px-3 py-2.5 focus:outline-none focus:border-[#6366f1] focus:ring-2 focus:ring-[#6366f1]/50 placeholder-[#475569]"
              />
            </div>

            <button
              onClick={handleAccountSave}
              className="flex items-center gap-2 bg-[#6366f1] hover:bg-[#4f46e5] text-white rounded-lg px-4 py-2 text-sm font-medium transition-colors"
            >
              <Save className="w-4 h-4" />
              {accountSaved ? 'Saved!' : 'Save Changes'}
            </button>
          </section>

          {/* Two-Factor Authentication */}
          <section className="bg-[rgba(99,102,241,0.06)] backdrop-blur-md border border-[rgba(99,102,241,0.22)] rounded-xl p-5 space-y-4 shadow-[0_4px_24px_rgba(0,0,0,0.30),inset_0_1px_0_rgba(255,255,255,0.06)]">
            <div className="flex items-center gap-2">
              <ShieldCheck className="w-4 h-4 text-[#6366f1]" />
              <h2 className="text-sm font-semibold text-[#F0F4F8]">Two-Factor Authentication</h2>
              {twoFaEnabled && (
                <span className="ml-auto text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-[rgba(52,211,153,0.15)] text-[#34d399]">ON</span>
              )}
            </div>

            {twoFaError && (
              <div className="flex items-center gap-2 text-xs text-[#fb923c] bg-[#451a03]/20 border border-[#78350f]/30 rounded-lg px-3 py-2.5">
                <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                {twoFaError}
              </div>
            )}
            {twoFaSuccess && (
              <div className="flex items-center gap-2 text-xs text-[#34d399] bg-[#022c22]/30 border border-[#064e3b]/40 rounded-lg px-3 py-2.5">
                <ShieldCheck className="w-3.5 h-3.5 shrink-0" />
                {twoFaSuccess}
              </div>
            )}

            {/* Not yet set up */}
            {!twoFaEnabled && !totpSetup && (
              <div>
                <p className="text-xs text-[#64748B] mb-3 leading-relaxed">
                  Add an extra layer of security. You&apos;ll need an authenticator app like Google Authenticator or 1Password.
                </p>
                <button
                  onClick={handleSetup2fa}
                  disabled={twoFaLoading}
                  className="flex items-center gap-2 bg-[rgba(99,102,241,0.15)] hover:bg-[rgba(99,102,241,0.25)] text-[#818CF8] border border-[rgba(99,102,241,0.30)] rounded-lg px-4 py-2 text-sm font-medium transition-colors disabled:opacity-50"
                >
                  {twoFaLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <QrCode className="w-4 h-4" />}
                  Set up 2FA
                </button>
              </div>
            )}

            {/* QR setup flow */}
            {!twoFaEnabled && totpSetup && (
              <div className="space-y-3">
                <p className="text-xs text-[#64748B] leading-relaxed">
                  Scan this QR code with your authenticator app, then enter the 6-digit code to confirm.
                </p>
                <div className="flex justify-center">
                  <img src={totpSetup.qr_code} alt="2FA QR code" className="rounded-lg w-40 h-40" />
                </div>
                <div className="bg-[rgba(255,255,255,0.04)] border border-[rgba(255,255,255,0.08)] rounded-lg px-3 py-2">
                  <p className="text-[10px] text-[#64748B] mb-1">Can&apos;t scan? Enter this secret manually:</p>
                  <p className="text-xs text-[#94A3B8] font-mono tracking-widest break-all">{totpSetup.secret}</p>
                </div>
                <div className="flex gap-2">
                  <input
                    type="text"
                    inputMode="numeric"
                    maxLength={6}
                    value={totpConfirmCode}
                    onChange={(e) => setTotpConfirmCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                    placeholder="000000"
                    className="flex-1 bg-[rgba(255,255,255,0.05)] border border-[rgba(99,102,241,0.18)] text-[#F0F4F8] text-sm rounded-lg px-3 py-2 focus:outline-none focus:border-[#6366f1] focus:ring-2 focus:ring-[#6366f1]/50 placeholder-[#475569] font-mono tracking-widest text-center"
                  />
                  <button
                    onClick={handleEnable2fa}
                    disabled={twoFaLoading || totpConfirmCode.length !== 6}
                    className="flex items-center gap-1.5 bg-[#6366f1] hover:bg-[#4f46e5] text-white rounded-lg px-4 py-2 text-sm font-medium transition-colors disabled:opacity-40"
                  >
                    {twoFaLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
                    Activate
                  </button>
                </div>
                <button
                  onClick={() => { setTotpSetup(null); setTotpConfirmCode(''); setTwoFaError(null); }}
                  className="text-xs text-[#475569] hover:text-[#64748B] transition-colors"
                >
                  Cancel
                </button>
              </div>
            )}

            {/* Disable flow */}
            {twoFaEnabled && (
              <div>
                {!showDisable2fa ? (
                  <button
                    onClick={() => setShowDisable2fa(true)}
                    className="flex items-center gap-2 text-xs text-[#475569] hover:text-[#f87171] border border-[rgba(255,255,255,0.08)] hover:border-red-900/30 rounded-lg px-3 py-1.5 transition-colors"
                  >
                    <ShieldOff className="w-3.5 h-3.5" />
                    Disable 2FA
                  </button>
                ) : (
                  <div className="space-y-2">
                    <p className="text-xs text-[#64748B]">Enter your password to confirm.</p>
                    <input
                      type="password"
                      value={totpDisablePassword}
                      onChange={(e) => setTotpDisablePassword(e.target.value)}
                      placeholder="Your password"
                      className="w-full bg-[rgba(255,255,255,0.05)] border border-[rgba(255,255,255,0.10)] text-[#F0F4F8] text-sm rounded-lg px-3 py-2 focus:outline-none focus:border-[rgba(255,255,255,0.20)] placeholder-[#334155]"
                    />
                    <div className="flex gap-2">
                      <button
                        onClick={() => { setShowDisable2fa(false); setTotpDisablePassword(''); setTwoFaError(null); }}
                        className="flex-1 py-1.5 text-xs text-[#475569] border border-[rgba(255,255,255,0.08)] rounded-lg transition-colors"
                      >
                        Cancel
                      </button>
                      <button
                        onClick={handleDisable2fa}
                        disabled={twoFaLoading || !totpDisablePassword}
                        className="flex-1 py-1.5 text-xs text-[#94A3B8] bg-[rgba(239,68,68,0.10)] hover:bg-[rgba(239,68,68,0.18)] rounded-lg disabled:opacity-30 transition-colors flex items-center justify-center gap-1"
                      >
                        {twoFaLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : null}
                        Confirm disable
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </section>

          {/* Delete account — quiet administrative section */}
          <section className="bg-[rgba(255,255,255,0.02)] border border-[rgba(255,255,255,0.07)] rounded-xl p-5">
            <p className="text-xs font-medium text-[#64748B] mb-1">Delete account</p>
            <p className="text-xs text-[#334155] mb-3 leading-relaxed">
              Permanently removes all brands, history, and drafts. This cannot be undone.
            </p>
            {!showDeleteAccountConfirm ? (
              <button
                type="button"
                onClick={() => setShowDeleteAccountConfirm(true)}
                className="text-xs text-[#475569] hover:text-[#f87171] border border-[rgba(255,255,255,0.08)] hover:border-red-900/30 rounded-lg px-3 py-1.5 transition-colors"
              >
                Request deletion
              </button>
            ) : (
              <div>
                <p className="text-xs text-[#64748B] mb-2">
                  Type <span className="text-[#94A3B8] font-mono">DELETE</span> to confirm
                </p>
                <input
                  type="text"
                  value={deleteAccountInput}
                  onChange={(e) => setDeleteAccountInput(e.target.value)}
                  placeholder="DELETE"
                  className="w-full bg-[rgba(255,255,255,0.05)] border border-[rgba(255,255,255,0.10)] text-[#F0F4F8] text-xs rounded-lg px-3 py-2 mb-2 focus:outline-none focus:border-[rgba(255,255,255,0.20)] placeholder-[#334155]"
                />
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => { setShowDeleteAccountConfirm(false); setDeleteAccountInput(''); }}
                    className="flex-1 py-1.5 text-xs text-[#475569] border border-[rgba(255,255,255,0.08)] rounded-lg hover:text-[#64748B] transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={handleDeleteAccount}
                    disabled={deleteAccountInput !== 'DELETE'}
                    className="flex-1 py-1.5 text-xs text-[#94A3B8] bg-[rgba(239,68,68,0.10)] hover:bg-[rgba(239,68,68,0.18)] rounded-lg disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                  >
                    Confirm delete
                  </button>
                </div>
              </div>
            )}
          </section>

        </div>{/* end right column */}
      </div>{/* end grid */}
    </div>
  );
}
