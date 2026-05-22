'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Plus } from 'lucide-react';

import { ProspectsList } from '@/components/agency/ProspectsList';
import { listProspectAudits, type ProspectAuditListItem } from '@/lib/api';

export default function ProspectsPage() {
  const [items, setItems] = useState<ProspectAuditListItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    listProspectAudits()
      .then(setItems)
      .catch((e) => setError(e?.message ?? 'Failed to load prospects'));
  }, []);

  return (
    <div className="mx-auto max-w-5xl px-6 py-8">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-[var(--text-primary)]">Prospect audits</h1>
          <p className="mt-1 text-sm text-[var(--text-secondary)]">
            Generate cold-email PDF audits for businesses you're pitching.
          </p>
        </div>
        <Link
          href="/agency/prospects/new"
          className="inline-flex items-center gap-2 rounded-md bg-[var(--accent)] px-3 py-2 text-sm font-medium text-white hover:bg-[var(--accent-hover)]"
        >
          <Plus className="h-4 w-4" />
          New prospect
        </Link>
      </div>

      {error && (
        <div className="rounded-md border border-rose-500/30 bg-rose-500/10 p-4 text-sm text-rose-300">
          {error}
        </div>
      )}

      {!error && items === null && (
        <div className="text-sm text-[var(--text-muted)]">Loading…</div>
      )}

      {items !== null && <ProspectsList items={items} />}
    </div>
  );
}
