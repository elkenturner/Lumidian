'use client';

import { useEffect, useState } from 'react';
import {
  User,
  Save,
  AlertTriangle,
  Calendar,
  Pause,
  Play,
  Loader2,
  Trash2,
  CreditCard,
  ReceiptText,
  Zap,
} from 'lucide-react';
import {
  getSchedulerStatus,
  setSchedulerStatus,
} from '@/lib/api';
import { useAuth } from '@/contexts/AuthContext';
import { useRouter } from 'next/navigation';

const PLANS = [
  { key: 'free',  label: 'Free',       price: '$0/mo',   features: ['1 brand', '5 prompts', '2 runs/day'] },
  { key: 'pro',   label: 'Pro',        price: '$49/mo',  features: ['5 brands', '50 prompts', 'Unlimited runs', 'Content Hub'] },
  { key: 'scale', label: 'Scale',      price: '$149/mo', features: ['Unlimited brands', 'Unlimited prompts', 'Priority support', 'API access'] },
];

export default function AccountPage() {
  const { user } = useAuth();
  const router = useRouter();

  // Profile
  const [displayName, setDisplayName] = useState('');
  const [accountSaved, setAccountSaved] = useState(false);

  // Scheduler
  const [schedulerPaused, setSchedulerPaused] = useState(false);
  const [schedulerLoading, setSchedulerLoading] = useState(true);
  const [schedulerError, setSchedulerError] = useState<string | null>(null);

  // Danger zone
  const [showDeleteAccountConfirm, setShowDeleteAccountConfirm] = useState(false);
  const [deleteAccountInput, setDeleteAccountInput] = useState('');

  useEffect(() => {
    // Load display name from localStorage
    if (typeof window !== 'undefined') {
      const stored = localStorage.getItem('clarity_settings');
      if (stored) {
        try {
          const parsed = JSON.parse(stored);
          if (parsed.displayName) setDisplayName(parsed.displayName);
        } catch { /* ignore */ }
      }
    }
    // Load scheduler status
    getSchedulerStatus()
      .then((s) => { setSchedulerPaused(s.paused); setSchedulerLoading(false); })
      .catch(() => setSchedulerLoading(false));
  }, []);

  function handleAccountSave() {
    if (typeof window !== 'undefined') {
      localStorage.setItem('clarity_settings', JSON.stringify({ displayName }));
    }
    setAccountSaved(true);
    setTimeout(() => setAccountSaved(false), 2500);
  }

  async function handleToggleScheduler() {
    setSchedulerLoading(true);
    setSchedulerError(null);
    try {
      const result = await setSchedulerStatus(!schedulerPaused);
      setSchedulerPaused(result.paused);
    } catch {
      setSchedulerError('Failed to update scheduler. Check that the backend is running.');
    } finally {
      setSchedulerLoading(false);
    }
  }

  const currentPlan = user?.subscription_tier ?? 'free';

  return (
    <div className="px-8 py-8 max-w-3xl space-y-6">
      {/* Header */}
      <div className="mb-2">
        <h1 className="text-2xl font-bold text-[#F0F4F8]">Account</h1>
        <p className="text-sm text-[#64748B] mt-1">Manage your profile, subscription, and account settings</p>
      </div>

      {/* Profile */}
      <section className="bg-[rgba(99,102,241,0.06)] backdrop-blur-md border border-[rgba(99,102,241,0.15)] rounded-xl p-6 space-y-5 shadow-[0_4px_24px_rgba(0,0,0,0.30),inset_0_1px_0_rgba(255,255,255,0.06)]">
        <div className="flex items-center gap-2 mb-1">
          <User className="w-4 h-4 text-[#6366f1]" />
          <h2 className="text-sm font-semibold text-[#F0F4F8]">Profile</h2>
        </div>

        {user && (
          <div className="space-y-1">
            <p className="text-xs text-[#64748B] uppercase tracking-wide">Email</p>
            <p className="text-sm text-[#94A3B8]">{user.email}</p>
          </div>
        )}

        <div>
          <label className="block text-xs text-[#64748B] uppercase tracking-wide mb-1.5">Display Name</label>
          <input
            type="text"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder="e.g. Acme Corp"
            className="w-full bg-[rgba(255,255,255,0.05)] border border-[rgba(99,102,241,0.18)] text-[#F0F4F8] text-sm rounded-lg px-3 py-2.5 focus:outline-none focus:border-[#6366f1] placeholder-[#475569]"
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

      {/* Subscription */}
      <section className="bg-[rgba(99,102,241,0.06)] backdrop-blur-md border border-[rgba(99,102,241,0.15)] rounded-xl p-6 shadow-[0_4px_24px_rgba(0,0,0,0.30),inset_0_1px_0_rgba(255,255,255,0.06)]">
        <div className="flex items-center gap-2 mb-4">
          <CreditCard className="w-4 h-4 text-[#6366f1]" />
          <h2 className="text-sm font-semibold text-[#F0F4F8]">Subscription</h2>
        </div>

        <div className="grid grid-cols-3 gap-3">
          {PLANS.map((plan) => {
            const isCurrent = currentPlan === plan.key;
            return (
              <div
                key={plan.key}
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
                    <li key={f} className="text-xs text-[#64748B] flex items-center gap-1.5">
                      <Zap size={9} className="text-[#6366f1] flex-shrink-0" />
                      {f}
                    </li>
                  ))}
                </ul>
                {!isCurrent && (
                  <button
                    onClick={() => alert('Billing portal coming soon')}
                    className={`w-full py-1.5 text-xs font-medium rounded-lg border transition-colors ${
                      plan.key === 'free'
                        ? 'border-[rgba(255,255,255,0.12)] text-[#64748B] hover:text-[#94A3B8] hover:border-[rgba(255,255,255,0.20)]'
                        : 'bg-[#6366f1] hover:bg-[#4f46e5] text-white border-transparent'
                    }`}
                  >
                    {plan.key === 'free' ? 'Downgrade' : 'Upgrade'}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </section>

      {/* Billing History */}
      <section className="bg-[rgba(99,102,241,0.06)] backdrop-blur-md border border-[rgba(99,102,241,0.15)] rounded-xl p-6 shadow-[0_4px_24px_rgba(0,0,0,0.30),inset_0_1px_0_rgba(255,255,255,0.06)]">
        <div className="flex items-center gap-2 mb-4">
          <ReceiptText className="w-4 h-4 text-[#6366f1]" />
          <h2 className="text-sm font-semibold text-[#F0F4F8]">Billing History</h2>
        </div>
        <div className="border border-[rgba(99,102,241,0.10)] rounded-lg overflow-hidden">
          <div className="px-4 py-3 border-b border-[rgba(99,102,241,0.10)] bg-[rgba(99,102,241,0.04)] flex items-center justify-between">
            <span className="text-xs font-semibold text-[#64748B] uppercase tracking-wide">Date</span>
            <span className="text-xs font-semibold text-[#64748B] uppercase tracking-wide">Amount</span>
          </div>
          <div className="px-4 py-10 text-center">
            <p className="text-sm text-[#475569]">No billing history yet</p>
            <p className="text-xs text-[#334155] mt-1">Invoices will appear here after your first payment</p>
          </div>
        </div>
      </section>

      {/* Automatic Scheduler */}
      <section className="bg-[rgba(99,102,241,0.06)] backdrop-blur-md border border-[rgba(99,102,241,0.15)] rounded-xl p-6 shadow-[0_4px_24px_rgba(0,0,0,0.30),inset_0_1px_0_rgba(255,255,255,0.06)]">
        <div className="flex items-center gap-2 mb-1">
          <Calendar className="w-4 h-4 text-[#6366f1]" />
          <h2 className="text-sm font-semibold text-[#F0F4F8]">Automatic Scheduler</h2>
        </div>
        <p className="text-xs text-[#475569] mb-5">
          Controls the 8:00 AM and 8:00 PM UTC tracking sweeps, the nightly Reddit scan, and
          auto-drafting. Manual &ldquo;Run Report Now&rdquo; always works regardless of this setting.
        </p>

        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            {schedulerLoading ? (
              <div className="w-[4.5rem] h-6 bg-[rgba(255,255,255,0.06)] rounded-full animate-pulse" />
            ) : (
              <span className={`inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1 rounded-full border ${schedulerPaused ? 'bg-[#451a03]/40 text-[#fb923c] border-[#78350f]/60' : 'bg-[#052e16]/40 text-[#34d399] border-[#065f46]/60'}`}>
                <span className={`w-1.5 h-1.5 rounded-full ${schedulerPaused ? 'bg-[#fb923c]' : 'bg-[#34d399] animate-pulse'}`} />
                {schedulerPaused ? 'Paused' : 'Active'}
              </span>
            )}
            <p className="text-sm text-[#94A3B8]">
              {schedulerPaused ? 'Scheduled runs will not fire' : 'Running at 8:00 AM and 8:00 PM UTC'}
            </p>
          </div>

          <button
            type="button"
            onClick={handleToggleScheduler}
            disabled={schedulerLoading}
            className={`flex items-center gap-2 text-sm font-medium rounded-lg px-4 py-2 border transition-colors disabled:opacity-50 ${
              schedulerPaused
                ? 'bg-[#052e16]/40 hover:bg-[#052e16]/70 border-[#065f46]/60 text-[#34d399]'
                : 'bg-[#451a03]/30 hover:bg-[#451a03]/50 border-[#78350f]/50 text-[#fb923c]'
            }`}
          >
            {schedulerLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : schedulerPaused ? <Play className="w-4 h-4" /> : <Pause className="w-4 h-4" />}
            {schedulerLoading ? 'Updating…' : schedulerPaused ? 'Resume Scheduler' : 'Pause Scheduler'}
          </button>
        </div>

        {schedulerPaused && !schedulerLoading && (
          <div className="mt-4 flex items-start gap-2 text-xs text-[#fb923c] bg-[#451a03]/20 border border-[#78350f]/30 rounded-lg px-3 py-2.5">
            <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
            <span>Automatic tracking, Reddit scanning, and auto-drafting are paused. Use &ldquo;Run Report Now&rdquo; on the Dashboard to trigger a manual run.</span>
          </div>
        )}
        {schedulerError && <p className="mt-3 text-xs text-[#f87171]">{schedulerError}</p>}
      </section>

      {/* Danger Zone */}
      <section className="border border-red-900/40 rounded-xl overflow-hidden">
        <div className="px-6 py-4 bg-red-900/10">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-[#ef4444]" />
            <h2 className="text-sm font-semibold text-[#ef4444]">Danger Zone</h2>
          </div>
        </div>
        <div className="px-6 py-5 bg-[rgba(255,255,255,0.02)]">
          <div className="flex items-start justify-between gap-6">
            <div>
              <p className="text-sm font-medium text-[#F0F4F8]">Delete account</p>
              <p className="text-xs text-[#64748B] mt-0.5">
                Permanently delete all brands, prompts, tracking history, and content drafts. This cannot be undone.
              </p>
            </div>
            {!showDeleteAccountConfirm ? (
              <button
                type="button"
                onClick={() => setShowDeleteAccountConfirm(true)}
                className="flex-shrink-0 flex items-center gap-1.5 text-sm text-[#ef4444] border border-red-900/40 hover:border-red-700 hover:bg-red-900/10 rounded-lg px-4 py-2 transition-colors"
              >
                <Trash2 className="w-4 h-4" />
                Delete account
              </button>
            ) : (
              <div className="flex-shrink-0 w-64">
                <p className="text-xs text-[#64748B] mb-2">
                  Type <span className="text-[#ef4444] font-mono">DELETE</span> to confirm
                </p>
                <input
                  type="text"
                  value={deleteAccountInput}
                  onChange={(e) => setDeleteAccountInput(e.target.value)}
                  placeholder="DELETE"
                  className="w-full bg-[rgba(255,255,255,0.08)] border border-red-900/40 text-[#F0F4F8] text-sm rounded-lg px-3 py-2 mb-2 focus:outline-none focus:border-red-700 placeholder-[#475569]"
                />
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => { setShowDeleteAccountConfirm(false); setDeleteAccountInput(''); }}
                    className="flex-1 py-1.5 text-xs text-[#64748B] border border-[rgba(99,102,241,0.15)] rounded-lg hover:text-[#94A3B8] transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    disabled={deleteAccountInput !== 'DELETE'}
                    className="flex-1 py-1.5 text-xs text-white bg-red-500 hover:bg-red-600 rounded-lg disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                  >
                    Confirm delete
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}
