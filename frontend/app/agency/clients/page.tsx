'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useSearchParams, useRouter, usePathname } from 'next/navigation';
import { agencyListClients, type AgencyClient } from '@/lib/api';
import { NewClientDialog } from '@/components/agency/NewClientDialog';
import { useAuth } from '@/contexts/AuthContext';

const STATUS_COLORS: Record<string, string> = {
  onboarding: 'bg-amber-500/20 text-amber-300',
  active: 'bg-emerald-500/20 text-emerald-300',
  paused: 'bg-slate-500/20 text-slate-300',
  churned: 'bg-rose-500/20 text-rose-300',
};

export default function AgencyClientsPage() {
  const [clients, setClients] = useState<AgencyClient[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const openNewOnMount = searchParams.get('new') === '1';
  const { user } = useAuth();

  useEffect(() => {
    if (openNewOnMount) {
      router.replace(pathname);
    }
  }, [openNewOnMount, pathname, router]);

  useEffect(() => {
    agencyListClients()
      .then(setClients)
      .catch((e) => setError(String(e?.message ?? e)))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="p-8 text-[var(--text-primary)]">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Clients</h1>
          <p className="text-sm text-[var(--text-muted)]">{clients.length} total</p>
        </div>
        {user?.is_admin && (
          <NewClientDialog initialOpen={openNewOnMount} onCreated={(c) => setClients((prev) => [c, ...prev])} />
        )}
      </div>

      {loading && <p className="text-sm text-[var(--text-muted)]">Loading…</p>}
      {error && <p className="text-sm text-red-400">{error}</p>}

      {!loading && clients.length === 0 && (
        <div className="rounded-lg border border-dashed border-[var(--border-subtle)] p-10 text-center text-sm text-[var(--text-muted)]">
          No clients yet. Create your first one.
        </div>
      )}

      {clients.length > 0 && (
        <div className="overflow-hidden rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-card)]">
          <table className="w-full text-sm">
            <thead className="bg-[var(--bg-raised)] text-left text-xs uppercase tracking-wide text-[var(--text-muted)]">
              <tr>
                <th className="px-4 py-3">Name</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Retainer</th>
                <th className="px-4 py-3">Drafts pending</th>
                <th className="px-4 py-3">Peec</th>
              </tr>
            </thead>
            <tbody>
              {clients.map((c) => (
                <tr
                  key={c.id}
                  className="border-t border-[var(--border-subtle)] hover:bg-[var(--bg-raised)]"
                >
                  <td className="px-4 py-3">
                    <Link href={`/agency/clients/${c.id}`} className="font-medium hover:underline">
                      {c.name}
                    </Link>
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`rounded-full px-2 py-1 text-xs ${
                        STATUS_COLORS[c.status] ?? 'bg-slate-500/20 text-slate-300'
                      }`}
                    >
                      {c.status}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    {c.retainer_amount_usd ? `$${c.retainer_amount_usd}/mo` : '—'}
                  </td>
                  <td className="px-4 py-3">{c.drafts_pending}</td>
                  <td className="px-4 py-3">
                    {c.peec_dashboard_url ? (
                      <a
                        href={c.peec_dashboard_url}
                        target="_blank"
                        rel="noreferrer"
                        className="text-xs underline"
                      >
                        Open
                      </a>
                    ) : (
                      <span className="text-xs text-[var(--text-muted)]">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
