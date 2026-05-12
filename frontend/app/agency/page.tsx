'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { agencyToday, type AgencyTodayDraft, type AgencyTodayResponse } from '@/lib/api';

function DraftList({ drafts, emptyText }: { drafts: AgencyTodayDraft[]; emptyText: string }) {
  if (drafts.length === 0) {
    return <p className="text-sm text-[var(--text-muted)]">{emptyText}</p>;
  }
  return (
    <ul className="space-y-2">
      {drafts.slice(0, 10).map((d) => (
        <li
          key={d.draft_id}
          className="rounded-md border border-[var(--border-subtle)] bg-[var(--bg-raised)] p-3 text-sm"
        >
          <div className="font-medium">{d.title || `Draft #${d.draft_id}`}</div>
          <div className="text-xs text-[var(--text-muted)]">
            <Link
              href={`/agency/clients/${d.client_id}`}
              className="underline-offset-2 hover:underline"
            >
              {d.client_name}
            </Link>{' '}
            · {d.platform}
          </div>
        </li>
      ))}
    </ul>
  );
}

export default function AgencyTodayPage() {
  const [data, setData] = useState<AgencyTodayResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    agencyToday().then(setData).catch((e) => setError(String(e?.message ?? e)));
  }, []);

  if (error) {
    return <div className="p-8 text-sm text-red-400">{error}</div>;
  }
  if (!data) {
    return <div className="p-8 text-sm text-[var(--text-muted)]">Loading…</div>;
  }

  const totalAttention =
    data.drafts_to_review_count + (data.awaiting_client?.length ?? 0) + (data.approved?.length ?? 0);

  return (
    <div className="p-8 text-[var(--text-primary)]">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Today</h1>
        <p className="text-sm text-[var(--text-muted)]">
          {data.active_clients} active client{data.active_clients === 1 ? '' : 's'} ·{' '}
          {totalAttention} draft{totalAttention === 1 ? '' : 's'} in flight
        </p>
      </div>

      <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
        <section className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-card)] p-5">
          <h2 className="mb-3 text-sm font-medium text-[var(--text-secondary)]">
            Awaiting your review ({data.drafts_to_review_count})
          </h2>
          <DraftList
            drafts={data.drafts_to_review}
            emptyText="Nothing to work on right now."
          />
        </section>

        <section className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-card)] p-5">
          <h2 className="mb-3 text-sm font-medium text-[var(--text-secondary)]">
            Awaiting client review ({data.awaiting_client?.length ?? 0})
          </h2>
          <DraftList
            drafts={data.awaiting_client ?? []}
            emptyText="Nothing waiting on the client."
          />
        </section>

        <section className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-card)] p-5">
          <h2 className="mb-3 text-sm font-medium text-[var(--text-secondary)]">
            Approved + ready to post ({data.approved?.length ?? 0})
          </h2>
          <DraftList
            drafts={data.approved ?? []}
            emptyText="Nothing approved yet."
          />
        </section>
      </div>
    </div>
  );
}
