'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { agencyToday, type AgencyTodayResponse } from '@/lib/api';

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

  return (
    <div className="p-8 text-[var(--text-primary)]">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Today</h1>
        <p className="text-sm text-[var(--text-muted)]">
          {data.active_clients} active client{data.active_clients === 1 ? '' : 's'} ·{' '}
          {data.drafts_to_review_count} draft
          {data.drafts_to_review_count === 1 ? '' : 's'} pending review
        </p>
      </div>

      <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
        <section className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-card)] p-5">
          <h2 className="mb-3 text-sm font-medium text-[var(--text-secondary)]">
            Drafts to review
          </h2>
          {data.drafts_to_review.length === 0 ? (
            <p className="text-sm text-[var(--text-muted)]">
              Nothing pending. Go ship something.
            </p>
          ) : (
            <ul className="space-y-2">
              {data.drafts_to_review.slice(0, 8).map((d) => (
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
          )}
        </section>

        <section className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-card)] p-5">
          <h2 className="mb-3 text-sm font-medium text-[var(--text-secondary)]">
            Scheduled this week
          </h2>
          <p className="text-sm text-[var(--text-muted)]">Coming in V1.</p>
        </section>

        <section className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-card)] p-5">
          <h2 className="mb-3 text-sm font-medium text-[var(--text-secondary)]">
            Recent activity
          </h2>
          <p className="text-sm text-[var(--text-muted)]">Coming in V1.</p>
        </section>
      </div>
    </div>
  );
}
