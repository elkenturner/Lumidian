'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import {
  User,
  Clock,
  BarChart2,
  Globe,
  Trash2,
  Save,
  ChevronRight,
  AlertTriangle,
  Calendar,
  Pause,
  Play,
  Loader2,
} from 'lucide-react';
import { getSchedulerStatus, setSchedulerStatus } from '@/lib/api';

const TIMEZONES = [
  'UTC',
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
  'America/Sao_Paulo',
  'Europe/London',
  'Europe/Paris',
  'Europe/Berlin',
  'Asia/Dubai',
  'Asia/Kolkata',
  'Asia/Singapore',
  'Asia/Tokyo',
  'Australia/Sydney',
];

const FREQUENCY_OPTIONS = [
  { value: 'daily', label: 'Daily', description: 'Run reports every day' },
  { value: 'every_3_days', label: 'Every 3 days', description: 'Run every 3 days' },
  { value: 'weekly', label: 'Weekly', description: 'Run reports once a week' },
  { value: 'manual', label: 'Manual only', description: 'Only run when I trigger it' },
];

const QUERIES_OPTIONS = [
  { value: 5, label: '5 queries', description: 'Basic — faster, lower cost' },
  { value: 10, label: '10 queries', description: 'Standard — balanced accuracy' },
  { value: 20, label: '20 queries', description: 'Premium — highest confidence' },
];

export default function SettingsPage() {
  const [displayName, setDisplayName] = useState('');
  const [defaultFrequency, setDefaultFrequency] = useState('weekly');
  const [defaultQueries, setDefaultQueries] = useState(10);
  const [timezone, setTimezone] = useState('UTC');
  const [saved, setSaved] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleteInput, setDeleteInput] = useState('');

  // Scheduler state — fetched from backend, saved immediately on toggle
  const [schedulerPaused, setSchedulerPaused] = useState(false);
  const [schedulerLoading, setSchedulerLoading] = useState(true);
  const [schedulerError, setSchedulerError] = useState<string | null>(null);

  useEffect(() => {
    getSchedulerStatus()
      .then((s) => setSchedulerPaused(s.paused))
      .catch(() => setSchedulerError('Could not load scheduler status.'))
      .finally(() => setSchedulerLoading(false));
  }, []);

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

  function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (typeof window !== 'undefined') {
      localStorage.setItem(
        'clarity_settings',
        JSON.stringify({ displayName, defaultFrequency, defaultQueries, timezone })
      );
    }
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  }

  return (
    <div className="p-8 max-w-2xl mx-auto space-y-10">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-[#e2e8f0]">Settings</h1>
        <p className="text-sm text-[#64748b] mt-1">Manage your account preferences</p>
      </div>

      <form onSubmit={handleSave} className="space-y-8">
        {/* Profile */}
        <section className="bg-[#111118] border border-[#1e1e2e] rounded-xl p-6 space-y-5">
          <div className="flex items-center gap-2 mb-1">
            <User className="w-4 h-4 text-[#6366f1]" />
            <h2 className="text-sm font-semibold text-[#e2e8f0]">Profile</h2>
          </div>

          <div>
            <label className="block text-xs text-[#64748b] uppercase tracking-wide mb-1.5">
              Display Name
            </label>
            <input
              type="text"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="e.g. Acme Corp"
              className="w-full bg-[#1a1a24] border border-[#1e1e2e] text-[#e2e8f0] text-sm rounded-lg px-3 py-2.5 focus:outline-none focus:border-[#6366f1] placeholder-[#475569]"
            />
            <p className="text-xs text-[#475569] mt-1.5">
              Used as the default name in reports and exports.
            </p>
          </div>
        </section>

        {/* Tracking defaults */}
        <section className="bg-[#111118] border border-[#1e1e2e] rounded-xl p-6 space-y-5">
          <div className="flex items-center gap-2 mb-1">
            <BarChart2 className="w-4 h-4 text-[#6366f1]" />
            <h2 className="text-sm font-semibold text-[#e2e8f0]">Tracking Defaults</h2>
          </div>
          <p className="text-xs text-[#475569] -mt-3">
            Applied to new brands unless overridden per brand.
          </p>

          <div>
            <div className="flex items-center gap-1.5 mb-2">
              <Clock className="w-3.5 h-3.5 text-[#475569]" />
              <label className="text-xs text-[#64748b] uppercase tracking-wide">
                Default Tracking Frequency
              </label>
            </div>
            <div className="grid grid-cols-2 gap-2">
              {FREQUENCY_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setDefaultFrequency(opt.value)}
                  className={`text-left px-3 py-2.5 rounded-lg border text-sm transition-colors ${
                    defaultFrequency === opt.value
                      ? 'border-[#6366f1] bg-[#6366f1]/10 text-[#818cf8]'
                      : 'border-[#1e1e2e] text-[#64748b] hover:border-[#6366f1]/30 hover:text-[#94a3b8]'
                  }`}
                >
                  <span className="font-medium block">{opt.label}</span>
                  <span className="text-xs opacity-70">{opt.description}</span>
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="text-xs text-[#64748b] uppercase tracking-wide mb-2 block">
              Default Queries per Prompt
            </label>
            <div className="flex gap-2">
              {QUERIES_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setDefaultQueries(opt.value)}
                  className={`flex-1 text-center px-3 py-2.5 rounded-lg border text-sm transition-colors ${
                    defaultQueries === opt.value
                      ? 'border-[#6366f1] bg-[#6366f1]/10 text-[#818cf8]'
                      : 'border-[#1e1e2e] text-[#64748b] hover:border-[#6366f1]/30 hover:text-[#94a3b8]'
                  }`}
                >
                  <span className="font-medium block">{opt.label}</span>
                  <span className="text-xs opacity-70">{opt.description}</span>
                </button>
              ))}
            </div>
          </div>
        </section>

        {/* Timezone */}
        <section className="bg-[#111118] border border-[#1e1e2e] rounded-xl p-6">
          <div className="flex items-center gap-2 mb-4">
            <Globe className="w-4 h-4 text-[#6366f1]" />
            <h2 className="text-sm font-semibold text-[#e2e8f0]">Timezone</h2>
          </div>
          <select
            value={timezone}
            onChange={(e) => setTimezone(e.target.value)}
            className="w-full bg-[#1a1a24] border border-[#1e1e2e] text-[#e2e8f0] text-sm rounded-lg px-3 py-2.5 focus:outline-none focus:border-[#6366f1]"
          >
            {TIMEZONES.map((tz) => (
              <option key={tz} value={tz}>
                {tz.replace('_', ' ')}
              </option>
            ))}
          </select>
          <p className="text-xs text-[#475569] mt-2">
            Scheduled tracking runs fire at 8:00 AM and 8:00 PM in this timezone.
          </p>
        </section>

        {/* Save button */}
        <div className="flex items-center justify-between">
          <Link
            href="/settings/accounts"
            className="flex items-center gap-1.5 text-sm text-[#818cf8] hover:text-[#6366f1] transition-colors"
          >
            Manage connected accounts
            <ChevronRight className="w-4 h-4" />
          </Link>
          <button
            type="submit"
            className="flex items-center gap-2 bg-[#6366f1] hover:bg-[#4f46e5] text-white rounded-lg px-5 py-2.5 text-sm font-medium transition-colors"
          >
            <Save className="w-4 h-4" />
            {saved ? 'Saved!' : 'Save Changes'}
          </button>
        </div>
      </form>

      {/* Scheduler — outside the form, saves immediately on toggle */}
      <section className="bg-[#111118] border border-[#1e1e2e] rounded-xl p-6">
        <div className="flex items-center gap-2 mb-1">
          <Calendar className="w-4 h-4 text-[#6366f1]" />
          <h2 className="text-sm font-semibold text-[#e2e8f0]">Automatic Scheduler</h2>
        </div>
        <p className="text-xs text-[#475569] mb-5">
          Controls the 8:00 AM and 8:00 PM UTC tracking sweeps, the nightly Reddit scan, and
          auto-drafting. Manual &ldquo;Run Report Now&rdquo; always works regardless of this setting.
        </p>

        <div className="flex items-center justify-between">
          {/* Status indicator + label */}
          <div className="flex items-center gap-3">
            {schedulerLoading ? (
              <div className="w-[4.5rem] h-6 bg-[#1a1a24] rounded-full animate-pulse" />
            ) : (
              <span
                className={`inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1 rounded-full border ${
                  schedulerPaused
                    ? 'bg-[#451a03]/40 text-[#fb923c] border-[#78350f]/60'
                    : 'bg-[#052e16]/40 text-[#34d399] border-[#065f46]/60'
                }`}
              >
                <span
                  className={`w-1.5 h-1.5 rounded-full ${
                    schedulerPaused ? 'bg-[#fb923c]' : 'bg-[#34d399] animate-pulse'
                  }`}
                />
                {schedulerPaused ? 'Paused' : 'Active'}
              </span>
            )}
            <p className="text-sm text-[#94a3b8]">
              {schedulerPaused ? 'Scheduled runs will not fire' : 'Running at 8:00 AM and 8:00 PM UTC'}
            </p>
          </div>

          {/* Toggle button */}
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
            {schedulerLoading ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : schedulerPaused ? (
              <Play className="w-4 h-4" />
            ) : (
              <Pause className="w-4 h-4" />
            )}
            {schedulerLoading ? 'Updating…' : schedulerPaused ? 'Resume Scheduler' : 'Pause Scheduler'}
          </button>
        </div>

        {/* Warning banner when paused */}
        {schedulerPaused && !schedulerLoading && (
          <div className="mt-4 flex items-start gap-2 text-xs text-[#fb923c] bg-[#451a03]/20 border border-[#78350f]/30 rounded-lg px-3 py-2.5">
            <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
            <span>
              Automatic tracking, Reddit scanning, and auto-drafting are paused.
              Use &ldquo;Run Report Now&rdquo; on any brand to trigger a manual run.
            </span>
          </div>
        )}

        {schedulerError && (
          <p className="mt-3 text-xs text-[#f87171]">{schedulerError}</p>
        )}
      </section>

      {/* Danger zone */}
      <section className="border border-red-900/40 rounded-xl overflow-hidden">
        <div className="px-6 py-4 bg-red-900/10">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-[#ef4444]" />
            <h2 className="text-sm font-semibold text-[#ef4444]">Danger Zone</h2>
          </div>
        </div>
        <div className="px-6 py-5 bg-[#111118]">
          <div className="flex items-start justify-between gap-6">
            <div>
              <p className="text-sm font-medium text-[#e2e8f0]">Delete account</p>
              <p className="text-xs text-[#64748b] mt-0.5">
                Permanently delete all brands, prompts, tracking history, and content drafts. This
                cannot be undone.
              </p>
            </div>
            {!showDeleteConfirm ? (
              <button
                type="button"
                onClick={() => setShowDeleteConfirm(true)}
                className="flex-shrink-0 flex items-center gap-1.5 text-sm text-[#ef4444] border border-red-900/40 hover:border-red-700 hover:bg-red-900/10 rounded-lg px-4 py-2 transition-colors"
              >
                <Trash2 className="w-4 h-4" />
                Delete account
              </button>
            ) : (
              <div className="flex-shrink-0 w-64">
                <p className="text-xs text-[#64748b] mb-2">
                  Type <span className="text-[#ef4444] font-mono">DELETE</span> to confirm
                </p>
                <input
                  type="text"
                  value={deleteInput}
                  onChange={(e) => setDeleteInput(e.target.value)}
                  placeholder="DELETE"
                  className="w-full bg-[#1a1a24] border border-red-900/40 text-[#e2e8f0] text-sm rounded-lg px-3 py-2 mb-2 focus:outline-none focus:border-red-700 placeholder-[#475569]"
                />
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => { setShowDeleteConfirm(false); setDeleteInput(''); }}
                    className="flex-1 py-1.5 text-xs text-[#64748b] border border-[#1e1e2e] rounded-lg hover:text-[#94a3b8] transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    disabled={deleteInput !== 'DELETE'}
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
