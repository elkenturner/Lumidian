'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import {
  Users, Activity, BarChart2, Zap, Loader2, RefreshCw,
  Shield, CheckCircle, XCircle, Clock,
} from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import {
  adminGetUsers, adminGetRuns, adminGetStats, adminTriggerRun, adminGetLogs,
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
                  </tr>
                </thead>
                <tbody>
                  {users.map((u) => (
                    <tr key={u.id} className="border-b border-[rgba(255,255,255,0.04)] hover:bg-[rgba(255,255,255,0.02)]">
                      <td className="px-4 py-2.5">
                        <div className="flex items-center gap-1.5">
                          {u.is_admin && <Shield size={11} className="text-[#818cf8]" />}
                          <span className="text-[#E2E8F0]">{u.email}</span>
                        </div>
                        {u.last_active && (
                          <div className="text-[#475569] mt-0.5">
                            active {new Date(u.last_active + 'Z').toLocaleDateString()}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-2.5">
                        <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${
                          u.subscription_tier === 'pro'
                            ? 'bg-[#6366f1]/20 text-[#818cf8]'
                            : u.subscription_tier === 'starter'
                            ? 'bg-[rgba(255,255,255,0.08)] text-[#94A3B8]'
                            : 'text-[#475569]'
                        }`}>
                          {u.subscription_tier ?? 'free'}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-[#94A3B8]">{u.brand_count}</td>
                      <td className="px-4 py-2.5 text-[#475569]">
                        {u.created_at ? new Date(u.created_at + 'Z').toLocaleDateString() : '—'}
                      </td>
                    </tr>
                  ))}
                  {users.length === 0 && (
                    <tr><td colSpan={4} className="px-4 py-8 text-center text-[#475569]">No users found</td></tr>
                  )}
                </tbody>
              </table>
            </div>
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
