'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  Users, Activity, BarChart2, Zap, Loader2, RefreshCw,
  Shield, Clock, PauseCircle, PlayCircle, Trash2, FileText, ChevronDown, ChevronUp,
} from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { logError } from '@/lib/utils/errors';
import {
  adminGetUsers, adminGetRuns, adminGetStats, adminTriggerRun, adminGetLogs,
  adminPauseUser, adminRemoveUser, adminGenerateDraft,
  AdminUser, AdminRun, AdminStats,
} from '@/lib/api';

function StatCard({ label, value, icon: Icon }: { label: string; value: number | string; icon: React.ElementType }) {
  return (
    <div className="card" style={{ padding: 20 }}>
      <div className="flex items-center gap-3 mb-2">
        <div className="w-8 h-8 rounded-lg bg-[var(--accent-muted)] border border-[var(--border-subtle)] flex items-center justify-center">
          <Icon size={16} className="text-[var(--accent-foreground)]" />
        </div>
        <span className="text-xs text-[var(--text-muted)] font-medium uppercase tracking-wide">{label}</span>
      </div>
      <div className="text-2xl font-bold font-mono text-[var(--text-primary)]">{value}</div>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    completed: 'bg-green-500/15 text-green-400 border-green-500/30',
    running:   'bg-blue-500/15 text-blue-400 border-blue-500/30',
    pending:   'bg-yellow-500/15 text-yellow-400 border-yellow-500/30',
    failed:    'bg-red-500/15 text-red-400 border-red-500/30',
  };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium border ${styles[status] ?? 'bg-[rgba(255,255,255,0.06)] text-[var(--text-secondary)] border-[var(--border-subtle)]'}`}>
      {status}
    </span>
  );
}

function TierBadge({ tier }: { tier: string | null }) {
  if (!tier) return <span className="text-[var(--text-faint)] text-[10px]">free</span>;
  const DISPLAY: Record<string, string> = { basic: 'Starter', starter: 'Growth', pro: 'Pro' };
  const cls = tier === 'pro'
    ? 'bg-[var(--accent)]/20 text-[var(--accent-foreground)] border-[var(--accent)]/30'
    : tier === 'starter'
    ? 'bg-[rgba(255,255,255,0.08)] text-[var(--text-secondary)] border-[var(--border-subtle)]'
    : 'bg-[rgba(255,255,255,0.04)] text-[var(--text-faint)] border-[rgba(255,255,255,0.06)]';
  return (
    <span className={`inline-flex px-1.5 py-0.5 rounded text-[10px] font-medium border ${cls}`}>{DISPLAY[tier] ?? tier}</span>
  );
}

export default function AdminPage() {
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();

  const [stats, setStats] = useState<AdminStats | null>(null);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [runs, setRuns] = useState<AdminRun[]>([]);
  const [logs, setLogs] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [triggeringBrand, setTriggeringBrand] = useState<number | null>(null);
  const [draftingBrand, setDraftingBrand] = useState<number | null>(null);
  const [draftedBrands, setDraftedBrands] = useState<Set<number>>(new Set());
  const [pausingUser, setPausingUser] = useState<number | null>(null);
  const [removingUser, setRemovingUser] = useState<number | null>(null);
  const [confirmRemove, setConfirmRemove] = useState<AdminUser | null>(null);
  const [logsOpen, setLogsOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [s, u, r, l] = await Promise.all([
        adminGetStats(),
        adminGetUsers(),
        adminGetRuns(),
        adminGetLogs().catch((err) => { logError(err, 'Admin: fetch logs'); return { lines: [] as string[] }; }),
      ]);
      setStats(s);
      setUsers(u);
      setRuns(r);
      setLogs(l.lines);
    } catch {
      setError('Failed to load admin data. Make sure you have admin access.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { document.title = 'Admin — Lumidian'; }, []);

  useEffect(() => {
    if (authLoading) return;
    if (!user) { router.replace('/login'); return; }
    if (!user.is_admin) { router.replace('/dashboard'); return; }
    load();
  }, [user, authLoading, router, load]);

  async function handleTriggerRun(brandId: number) {
    setTriggeringBrand(brandId);
    try {
      await adminTriggerRun(brandId);
      setTimeout(() => load(), 1000);
    } catch {
      alert('Failed to trigger run.');
    } finally {
      setTriggeringBrand(null);
    }
  }

  async function handleGenerateDraft(brandId: number) {
    setDraftingBrand(brandId);
    try {
      await adminGenerateDraft(brandId);
      setDraftedBrands((prev) => new Set(prev).add(brandId));
    } catch {
      alert('Failed to queue draft generation.');
    } finally {
      setDraftingBrand(null);
    }
  }

  async function handlePauseUser(userId: number) {
    setPausingUser(userId);
    try {
      const result = await adminPauseUser(userId);
      setUsers((prev) => prev.map((u) => u.id === userId ? { ...u, is_paused: result.is_paused } : u));
    } catch {
      alert('Failed to update user status.');
    } finally {
      setPausingUser(null);
    }
  }

  async function handleRemoveUser(userId: number) {
    setRemovingUser(userId);
    setConfirmRemove(null);
    try {
      await adminRemoveUser(userId);
      setUsers((prev) => prev.filter((u) => u.id !== userId));
    } catch {
      alert('Failed to remove user.');
    } finally {
      setRemovingUser(null);
    }
  }

  if (authLoading || loading) {
    return (
      <div className="p-8 max-w-4xl animate-pulse space-y-4">
        <div className="h-8 bg-[rgba(255,255,255,0.06)] rounded w-40" />
        <div className="h-32 card rounded-xl" />
        <div className="h-64 card rounded-xl" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-[var(--bg-base)] flex items-center justify-center px-4">
        <div className="bg-[#7f1d1d]/20 border border-[#991b1b]/30 rounded-xl p-6 text-center max-w-sm">
          <Shield size={32} className="text-[var(--danger)] mx-auto mb-3" />
          <p className="text-[var(--danger)] text-sm">{error}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[var(--bg-base)] p-6">
      <div className="max-w-7xl mx-auto space-y-6">

        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-[var(--accent-muted)] flex items-center justify-center">
              <Shield size={18} className="text-[var(--accent-foreground)]" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-[var(--text-primary)]">Admin Dashboard</h1>
              <p className="text-xs text-[var(--text-muted)]">System overview — visible to admins only</p>
            </div>
          </div>
          <button
            onClick={load}
            className="flex items-center gap-1.5 text-xs text-[var(--text-muted)] hover:text-[var(--text-secondary)] transition-colors cursor-pointer"
          >
            <RefreshCw size={13} />
            Refresh
          </button>
        </div>

        {/* System Stats */}
        {stats && (
          <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
            <StatCard label="Users" value={stats.total_users} icon={Users} />
            <StatCard label="Brands" value={stats.total_brands} icon={Zap} />
            <StatCard label="Prompts" value={stats.total_prompts} icon={BarChart2} />
            <StatCard label="Drafts" value={stats.total_drafts} icon={Activity} />
            <StatCard label="Runs today" value={stats.runs_today} icon={Clock} />
          </div>
        )}

        {/* Users Table */}
        <div className="card rounded-xl overflow-hidden">
          <div className="px-5 py-4 border-b border-[var(--border-subtle)]">
            <h2 className="text-sm font-semibold text-[var(--text-primary)] flex items-center gap-2">
              <Users size={14} className="text-[var(--accent-foreground)]" />
              Users ({users.length})
            </h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-[var(--border-subtle)]">
                  <th className="text-left text-[var(--text-faint)] px-4 py-2.5 font-medium">User</th>
                  <th className="text-left text-[var(--text-faint)] px-4 py-2.5 font-medium">Plan</th>
                  <th className="text-left text-[var(--text-faint)] px-4 py-2.5 font-medium">Brands</th>
                  <th className="text-left text-[var(--text-faint)] px-4 py-2.5 font-medium">Joined</th>
                  <th className="text-left text-[var(--text-faint)] px-4 py-2.5 font-medium">Account</th>
                </tr>
              </thead>
              <tbody>
                {users.map((u) => (
                  <tr key={u.id} className={`border-b border-[var(--border-subtle)] hover:bg-[rgba(255,255,255,0.02)] ${u.is_paused ? 'opacity-60' : ''}`}>
                    {/* User */}
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1.5">
                        {u.is_admin && <Shield size={11} className="text-[var(--accent-foreground)] shrink-0" />}
                        {u.is_paused && <PauseCircle size={11} className="text-[var(--warning)] shrink-0" />}
                        <Link
                          href={`/admin/users/${u.id}`}
                          className="text-[var(--text-primary)] font-medium hover:text-[var(--accent)] transition-colors"
                        >
                          {u.email}
                        </Link>
                      </div>
                      {u.name && <div className="text-[var(--text-faint)] mt-0.5">{u.name}</div>}
                      {u.last_active && (
                        <div className="text-[var(--text-faint)] mt-0.5">
                          active {new Date(u.last_active + 'Z').toLocaleDateString()}
                        </div>
                      )}
                    </td>
                    {/* Plan */}
                    <td className="px-4 py-3">
                      <div className="flex flex-col gap-1">
                        <TierBadge tier={u.subscription_tier ?? null} />
                        {u.subscription_status === 'trialing' && (
                          <span className="text-[10px] text-[var(--success)]">trialing</span>
                        )}
                      </div>
                    </td>
                    {/* Brands + actions */}
                    <td className="px-4 py-3">
                      {u.brands && u.brands.length > 0 ? (
                        <div className="flex flex-col gap-1.5">
                          {u.brands.map((b) => (
                            <div key={b.id} className="flex items-center gap-2 group">
                              <span className="text-[var(--text-primary)]">{b.name}</span>
                              {b.brand_type === 'pitch' && (
                                <span className="text-[10px] px-1 rounded bg-[var(--accent)]/15 text-[var(--accent-foreground)] border border-[var(--accent)]/20">pitch</span>
                              )}
                              {/* Run */}
                              <button
                                onClick={() => handleTriggerRun(b.id)}
                                disabled={triggeringBrand === b.id}
                                title="Trigger tracking run"
                                className="flex items-center gap-1 text-[var(--text-faint)] hover:text-[var(--accent)] disabled:opacity-40 transition-colors cursor-pointer opacity-0 group-hover:opacity-100"
                              >
                                {triggeringBrand === b.id
                                  ? <Loader2 size={11} className="animate-spin" />
                                  : <RefreshCw size={11} />}
                                <span>Run</span>
                              </button>
                              {/* Draft */}
                              <button
                                onClick={() => handleGenerateDraft(b.id)}
                                disabled={draftingBrand === b.id}
                                title="Generate content drafts"
                                className={`flex items-center gap-1 disabled:opacity-40 transition-colors cursor-pointer opacity-0 group-hover:opacity-100 ${
                                  draftedBrands.has(b.id)
                                    ? 'text-[var(--success)]'
                                    : 'text-[var(--text-faint)] hover:text-[var(--success)]'
                                }`}
                              >
                                {draftingBrand === b.id
                                  ? <Loader2 size={11} className="animate-spin" />
                                  : <FileText size={11} />}
                                <span>{draftedBrands.has(b.id) ? 'Queued' : 'Draft'}</span>
                              </button>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <span className="text-[var(--text-faint)]">—</span>
                      )}
                    </td>
                    {/* Joined */}
                    <td className="px-4 py-3 text-[var(--text-faint)] whitespace-nowrap">
                      {u.created_at ? new Date(u.created_at + 'Z').toLocaleDateString() : '—'}
                    </td>
                    {/* Account actions */}
                    <td className="px-4 py-3">
                      {(!u.is_admin || u.id === user?.id) && (
                        <div className="flex items-center gap-3">
                          <button
                            onClick={() => handlePauseUser(u.id)}
                            disabled={pausingUser === u.id}
                            title={u.is_paused ? 'Unpause account' : 'Pause account'}
                            className="flex items-center gap-1 text-[var(--text-muted)] hover:text-[var(--warning)] disabled:opacity-50 transition-colors cursor-pointer"
                          >
                            {pausingUser === u.id
                              ? <Loader2 size={11} className="animate-spin" />
                              : u.is_paused
                              ? <PlayCircle size={11} />
                              : <PauseCircle size={11} />}
                            {u.is_paused ? 'Unpause' : 'Pause'}
                          </button>
                          {u.id !== user?.id && (
                            <button
                              onClick={() => setConfirmRemove(u)}
                              disabled={removingUser === u.id}
                              title="Permanently remove user"
                              className="flex items-center gap-1 text-[var(--text-muted)] hover:text-[var(--danger)] disabled:opacity-50 transition-colors cursor-pointer"
                            >
                              {removingUser === u.id
                                ? <Loader2 size={11} className="animate-spin" />
                                : <Trash2 size={11} />}
                              Remove
                            </button>
                          )}
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
                {users.length === 0 && (
                  <tr><td colSpan={5} className="px-4 py-8 text-center text-[var(--text-faint)]">No users found</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Recent Runs Table */}
        <div className="card rounded-xl overflow-hidden">
          <div className="px-5 py-4 border-b border-[var(--border-subtle)]">
            <h2 className="text-sm font-semibold text-[var(--text-primary)] flex items-center gap-2">
              <Activity size={14} className="text-[var(--accent-foreground)]" />
              Recent Tracking Runs
            </h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-[var(--border-subtle)]">
                  <th className="text-left text-[var(--text-faint)] px-4 py-2.5 font-medium">Brand</th>
                  <th className="text-left text-[var(--text-faint)] px-4 py-2.5 font-medium">Status</th>
                  <th className="text-left text-[var(--text-faint)] px-4 py-2.5 font-medium">Score</th>
                  <th className="text-left text-[var(--text-faint)] px-4 py-2.5 font-medium">When</th>
                  <th className="text-left text-[var(--text-faint)] px-4 py-2.5 font-medium">Action</th>
                </tr>
              </thead>
              <tbody>
                {runs.slice(0, 30).map((r) => (
                  <tr key={r.id} className="border-b border-[var(--border-subtle)] hover:bg-[rgba(255,255,255,0.02)]">
                    <td className="px-4 py-2.5">
                      <div className="text-[var(--text-primary)]">{r.brand_name}</div>
                      <div className="text-[var(--text-faint)]">{r.user_email}</div>
                    </td>
                    <td className="px-4 py-2.5"><StatusBadge status={r.status} /></td>
                    <td className="px-4 py-2.5 text-[var(--text-secondary)] font-mono">
                      {r.overall_score != null ? `${r.overall_score.toFixed(1)}%` : '—'}
                    </td>
                    <td className="px-4 py-2.5 text-[var(--text-faint)] whitespace-nowrap">
                      {r.created_at ? new Date(r.created_at + 'Z').toLocaleDateString() : '—'}
                    </td>
                    <td className="px-4 py-2.5">
                      <button
                        onClick={() => handleTriggerRun(r.brand_id)}
                        disabled={triggeringBrand === r.brand_id}
                        className="flex items-center gap-1 text-[var(--accent)] hover:text-[var(--accent-foreground)] disabled:opacity-50 transition-colors cursor-pointer"
                      >
                        {triggeringBrand === r.brand_id
                          ? <Loader2 size={11} className="animate-spin" />
                          : <RefreshCw size={11} />}
                        Run
                      </button>
                    </td>
                  </tr>
                ))}
                {runs.length === 0 && (
                  <tr><td colSpan={5} className="px-4 py-8 text-center text-[var(--text-faint)]">No runs yet</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Logs Panel — collapsible */}
        <div className="card rounded-xl overflow-hidden">
          <button
            onClick={() => setLogsOpen((v) => !v)}
            className="w-full px-5 py-4 border-b border-[var(--border-subtle)] flex items-center justify-between cursor-pointer hover:bg-[rgba(255,255,255,0.01)] transition-colors"
          >
            <span className="text-sm font-semibold text-[var(--text-primary)]">Error Log (last 100 lines)</span>
            <div className="flex items-center gap-3">
              <span className="text-xs text-[var(--text-faint)]">backend/logs/app.log</span>
              {logsOpen ? <ChevronUp size={14} className="text-[var(--text-faint)]" /> : <ChevronDown size={14} className="text-[var(--text-faint)]" />}
            </div>
          </button>
          {logsOpen && (
            <div className="p-4 bg-[var(--bg-base)] rounded-b-xl max-h-80 overflow-y-auto">
              {logs.length === 0 ? (
                <p className="text-xs text-[var(--text-faint)] font-mono">No log entries yet.</p>
              ) : (
                <pre className="text-[11px] text-[var(--text-muted)] font-mono whitespace-pre-wrap leading-relaxed">
                  {[...logs].reverse().join('\n')}
                </pre>
              )}
            </div>
          )}
        </div>

      </div>

      {/* Remove confirmation modal */}
      {confirmRemove && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/60" onClick={() => setConfirmRemove(null)} />
          <div className="relative bg-[rgba(10,14,24,0.97)] border border-[var(--danger)]/25 rounded-2xl p-6 max-w-sm w-full shadow-2xl">
            <div className="flex items-center gap-2 mb-3">
              <Trash2 size={16} className="text-[var(--danger)]" />
              <h3 className="text-sm font-semibold text-[var(--text-primary)]">Remove user?</h3>
            </div>
            <p className="text-xs text-[var(--text-muted)] mb-1">
              This will permanently delete <span className="text-[var(--text-primary)] font-medium">{confirmRemove.email}</span> and all their brands, prompts, and drafts.
            </p>
            <p className="text-xs text-[var(--danger)] mb-5">This action cannot be undone.</p>
            <div className="flex gap-2">
              <button
                onClick={() => setConfirmRemove(null)}
                className="flex-1 py-2 text-xs text-[var(--text-muted)] hover:text-[var(--text-secondary)] border border-[var(--border-subtle)] rounded-lg transition-colors cursor-pointer"
              >
                Cancel
              </button>
              <button
                onClick={() => handleRemoveUser(confirmRemove.id)}
                className="flex-1 py-2 text-xs font-medium text-white bg-[var(--danger)]/20 hover:bg-[var(--danger)]/30 border border-[var(--danger)]/30 rounded-lg transition-colors cursor-pointer"
              >
                Remove permanently
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
