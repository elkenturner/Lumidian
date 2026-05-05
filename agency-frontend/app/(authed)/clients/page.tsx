'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api, type AgencyClientOut } from '@/lib/api';
import { NewClientDialog } from '@/components/clients/new-client-dialog';

const STATUS_COLORS: Record<string, string> = {
  onboarding: 'bg-amber-100 text-amber-800',
  active: 'bg-emerald-100 text-emerald-800',
  paused: 'bg-slate-100 text-slate-700',
  churned: 'bg-rose-100 text-rose-800',
};

export default function ClientsPage() {
  const [clients, setClients] = useState<AgencyClientOut[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api
      .listClients()
      .then(setClients)
      .catch((e) => setError(String(e?.message ?? e)))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="p-8">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Clients</h1>
          <p className="text-sm text-muted-foreground">{clients.length} total</p>
        </div>
        <NewClientDialog onCreated={(c) => setClients((prev) => [c, ...prev])} />
      </div>

      {loading && <p className="text-sm text-muted-foreground">Loading…</p>}
      {error && <p className="text-sm text-red-600">{error}</p>}

      {!loading && clients.length === 0 && (
        <div className="rounded-lg border border-dashed border-border p-10 text-center text-sm text-muted-foreground">
          No clients yet. Create your first one.
        </div>
      )}

      {clients.length > 0 && (
        <div className="overflow-hidden rounded-lg border border-border bg-white">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left text-xs uppercase tracking-wide text-muted-foreground">
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
                <tr key={c.id} className="border-t border-border hover:bg-muted/30">
                  <td className="px-4 py-3">
                    <Link href={`/clients/${c.id}`} className="font-medium hover:underline">
                      {c.name}
                    </Link>
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`rounded-full px-2 py-1 text-xs ${STATUS_COLORS[c.status] ?? 'bg-muted'}`}
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
                      <span className="text-xs text-muted-foreground">—</span>
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
