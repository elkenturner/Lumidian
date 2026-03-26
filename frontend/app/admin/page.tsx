'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import {
  Users, Activity, BarChart2, Zap, Loader2, RefreshCw,
  Shield, CheckCircle, XCircle, Clock, PauseCircle, PlayCircle, Trash2,
} from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import {
  adminGetUsers, adminGetRuns, adminGetStats, adminTriggerRun, adminGetLogs,
  adminPauseUser, adminRemoveUser,
  AdminUser, AdminRun, AdminStats,
} from '@/lib/api';

function StatCard({ label, value, icon: Icon }: { label: string; value: number | string; icon: React.ElementType }) {
  return (
    <div className="bg-[rgba(99,102,241,0.06)] border border-[rgba(99,102,241,0.15)] rounded-xl p-5">
      <div className="flex items-center gap-3 mb-2">
        <div className="w-8 h-8 rounded-lg bg-[rgba(99,102,241,0.15)] flex items-center justify-center">
          <Icon size={16} className="text-[#818cf8]" />
        </div>
        <span className="text-xs text-[#64748B] font-medium uppercase tracking-wide">{label}</span>
      </div>
      <div className="text-2xl font-bold text-[#F0F4F8]">{value}</div>
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
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium border ${styles[status] ?? 'bg-[rgba(255,255,255,0.06)] text-[#94A3B8] border-[rgba(255,255,255,0.10)]'}`}>
      {status}
    </span>
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
  const [pausingUser, setPausingUser] = useState<number | null>(null);
  const [removingUser, setRemovingUser] = useState<number | null>(null);
  const [confirmRemove, setConfirmRemove] = useState<AdminUser | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [s, u, r, l] = await Promise.all([
        adminGetStats(),
        adminGetUsers(),
        adminGetRuns(),
        adminGetLogs().catch(() => ({ lines: [] as string[] })),
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

  useEffect(() => { document.title = 'Admin — ClarityAI'; }, []);

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
        <div className="h-32 bg-[rgba(99,102,241,0.06)] border border-[rgba(99,102,241,0.15)] rounded-xl" />
        <div className="h-64 bg-[rgba(99,102,241,0.06)] border border-[rgba(99,102,241,0.15)] rounded-xl" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-[#0a0a0f] flex items-center justify-center px-4">
        <div className="bg-[#7f1d1d]/20 border border-[#991b1b]/30 rounded-xl p-6 text-center max-w-sm">
          <Shield size={32} className="text-[#f87171] mx-auto mb-3" />
          <p className="text-[#f87171] text-sm">{error}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0a0a0f] p-6">
      <div className="max-w-7xl mx-auto">

        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-[rgba(99,102,241,0.20)] flex items-center justify-center">
              <Shield size={18} className="text-[#818cf8]" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-[#F0F4F8]">Admin Dashboard</h1>
              <p className="text-xs text-[#64748B]">System overview — visible to admins only</p>
            </div>
          </div>
          <button
            onClick={load}
            className="flex items-center gap-1.5 text-xs text-[#64748B] hover:text-[#94A3B8] transition-colors"
          >
            <RefreshCw size={13} />
            Refresh
          </button>
        </div>

        {/* System Stats */}
        {stats && (
          <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-8">
            <StatCard label="Users" value={stats.total_users} icon={Users} />
            <StatCard label="Brands" value={stats.total_brands} icon={Zap} />
            <StatCard label="Prompts" value={stats.total_prompts} icon={BarChart2} />
            <StatCard label="Drafts" value={stats.total_drafts} icon={Activity} />
            <StatCard label="Runs today" value={stats.runs_today} icon={Clock} />
          </div>
        )}

        <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">

          {/* Users Table */}
          <div className="bg-[rgba(99,102,241,0.06)] backdrop-blur-md border border-[rgba(99,102,241,0.15)] rounded-xl shadow-[0_4px_24px_rgba(0,0,0,0.20)] overflow-hidden">
            <div className="px-5 py-4 border-b border-[rgba(99,102,241,0.12)]">
              <h2 className="text-sm font-semibold text-[#F0F4F8] flex items-center gap-2">
                <Users size={14} className="text-[#818cf8]" />
                Users ({users.length})
              </h2>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-[rgba(255,255,255,0.05)]">
                    <th className="text-left text-[#475569] px-4 py-2.5 font-medium">Email</th>
                    <th className="text-left text-[#475569] px-4 py-2.5 font-medium">Plan</th>
                    <th className="text-left text-[#475569] px-4 py-2.5 font-medium">Brands</th>
                    <th className="text-left text-[#475569] px-4 py-2.5 font-medium">Joined</th>
                    <th className="text-left text-[#475569] px-4 py-2.5 font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {users.map((u) => (
                    <tr key={u.id} className={`border-b border-[rgba(255,255,255,0.04)] hover:bg-[rgba(255,255,255,0.02)] ${u.is_paused ? 'opacity-50' : ''}`}>
                      <td className="px-4 py-2.5">
                        <div className="flex items-center gap-1.5">
                          {u.is_admin && <Shield size={11} className="text-[#818cf8]" />}
                          {u.is_paused && <PauseCircle size={11} className="text-[#f59e0b]" />}
                          <span className="text-[#E2E8F0]">{u.email}</span>
                        </div>
                        {u.last_active && (
                          <div className="text-[#475569] mt-0.5">
                            active {new Date(u.last_active + 'Z').toLocaleDateString()}
                          </div>
                        )}
                        {u.is_paused && <div className="text-[#f59e0b] mt-0.5 text-[10px]">Account paused</div>}
                      </td>
                      <td className="px-4 py-2.5">
                        <div className="flex flex-col gap-0.5">
                          <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium w-fit ${
                            u.subscription_tier === 'pro'
                              ? 'bg-[#6366f1]/20 text-[#818cf8]'
                              : u.subscription_tier === 'starter'
                              ? 'bg-[rgba(255,255,255,0.08)] text-[#94A3B8]'
                              : 'text-[#475569]'
                          }`}>
                            {u.subscription_tier ?? 'free'}
                          </span>
                          {u.subscription_status === 'trialing' && (
                            <span className="text-[10px] text-[#10b981]">trialing</span>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-2.5">
                        {u.brands && u.brands.length > 0 ? (
                          <div className="flex flex-col gap-0.5">
                            {u.brands.map((b) => (
                              <div key={b.id} className="flex items-center gap-1">
                                <span className="text-[#E2E8F0]">{b.name}</span>
                                {b.brand_type === 'pitch' && (
                                  <span className="text-[10px] px-1 py-0 rounded bg-[#6366f1]/15 text-[#818cf8] border border-[#6366f1]/20">pitch</span>
                                )}
                              </div>
                            ))}
                          </div>
                        ) : (
                          <span className="text-[#475569]">—</span>
                        )}
                      </td>
                      <td className="px-4 py-2.5 text-[#475569]">
                        {u.created_at ? new Date(u.created_at + 'Z').toLocaleDateString() : '—'}
                      </td>
                      <td className="px-4 py-2.5">
                        {(!u.is_admin || u.id === user?.id) && (
                          <div className="flex items-center gap-2">
                            <button
                              onClick={() => handlePauseUser(u.id)}
                              disabled={pausingUser === u.id}
                              title={u.is_paused ? 'Unpause account' : 'Pause account'}
                              className="flex items-center gap-1 text-[#64748B] hover:text-[#f59e0b] disabled:opacity-50 transition-colors"
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
                                className="flex items-center gap-1 text-[#64748B] hover:text-[#f87171] disabled:opacity-50 transition-colors"
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
                    <tr><td colSpan={5} className="px-4 py-8 text-center text-[#475569]">No users found</td></tr>
                  )}
                </tbody>
              </table>
            </div>

            {/* Remove confirmation modal */}
            {confirmRemove && (
              <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
                <div className="absolute inset-0 bg-black/60" onClick={() => setConfirmRemove(null)} />
                <div className="relative bg-[rgba(10,14,24,0.97)] border border-[rgba(248,113,113,0.25)] rounded-2xl p-6 max-w-sm w-full shadow-2xl">
                  <div className="flex items-center gap-2 mb-3">
                    <Trash2 size={16} className="text-[#f87171]" />
                    <h3 className="text-sm font-semibold text-[#F0F4F8]">Remove user?</h3>
                  </div>
                  <p className="text-xs text-[#64748B] mb-1">
                    This will permanently delete <span className="text-[#E2E8F0] font-medium">{confirmRemove.email}</span> and all their brands, prompts, and drafts.
                  </p>
                  <p className="text-xs text-[#f87171] mb-5">This action cannot be undone.</p>
                  <div className="flex gap-2">
                    <button
                      onClick={() => setConfirmRemove(null)}
                      className="flex-1 py-2 text-xs text-[#64748B] hover:text-[#94A3B8] border border-[rgba(255,255,255,0.10)] rounded-lg transition-colors"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={() => handleRemoveUser(confirmRemove.id)}
                      className="flex-1 py-2 text-xs font-medium text-white bg-[#f87171]/20 hover:bg-[#f87171]/30 border border-[#f87171]/30 rounded-lg transition-colors"
                    >
                      Remove permanently
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Tracking Runs Table */}
          <div className="bg-[rgba(99,102,241,0.06)] backdrop-blur-md border border-[rgba(99,102,241,0.15)] rounded-xl shadow-[0_4px_24px_rgba(0,0,0,0.20)] overflow-hidden">
            <div className="px-5 py-4 border-b border-[rgba(99,102,241,0.12)]">
              <h2 className="text-sm font-semibold text-[#F0F4F8] flex items-center gap-2">
                <Activity size={14} className="text-[#818cf8]" />
                Recent Tracking Runs
              </h2>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-[rgba(255,255,255,0.05)]">
                    <th className="text-left text-[#475569] px-4 py-2.5 font-medium">Brand</th>
                    <th className="text-left text-[#475569] px-4 py-2.5 font-medium">Status</th>
                    <th className="text-left text-[#475569] px-4 py-2.5 font-medium">Score</th>
                    <th className="text-left text-[#475569] px-4 py-2.5 font-medium">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {runs.slice(0, 30).map((r) => (
                    <tr key={r.id} className="border-b border-[rgba(255,255,255,0.04)] hover:bg-[rgba(255,255,255,0.02)]">
                      <td className="px-4 py-2.5">
                        <div className="text-[#E2E8F0]">{r.brand_name}</div>
                        <div className="text-[#475569]">{r.user_email}</div>
                      </td>
                      <td className="px-4 py-2.5"><StatusBadge status={r.status} /></td>
                      <td className="px-4 py-2.5 text-[#94A3B8]">
                        {r.overall_score != null ? `${r.overall_score.toFixed(1)}%` : '—'}
                      </td>
                      <td className="px-4 py-2.5">
                        <button
                          onClick={() => handleTriggerRun(r.brand_id)}
                          disabled={triggeringBrand === r.brand_id}
                          className="flex items-center gap-1 text-[#6366f1] hover:text-[#818cf8] disabled:opacity-50 transition-colors"
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
                    <tr><td colSpan={4} className="px-4 py-8 text-center text-[#475569]">No runs yet</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        {/* Logs Panel */}
        <div className="mt-6 bg-[rgba(99,102,241,0.06)] backdrop-blur-md border border-[rgba(99,102,241,0.15)] rounded-xl shadow-[0_4px_24px_rgba(0,0,0,0.20)] overflow-hidden">
          <div className="px-5 py-4 border-b border-[rgba(99,102,241,0.12)] flex items-center justify-between">
            <h2 className="text-sm font-semibold text-[#F0F4F8]">Error Log (last 100 lines)</h2>
            <span className="text-xs text-[#475569]">backend/logs/app.log</span>
          </div>
          <div className="p-4 bg-[#0a0a0f] rounded-b-xl max-h-80 overflow-y-auto">
            {logs.length === 0 ? (
              <p className="text-xs text-[#475569] font-mono">No log entries yet.</p>
            ) : (
              <pre className="text-[11px] text-[#64748B] font-mono whitespace-pre-wrap leading-relaxed">
                {[...logs].reverse().join('\n')}
              </pre>
            )}
          </div>
        </div>

      </div>
    </div>
  );
}
