'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api, type TodayResponse } from '@/lib/api';

export default function TodayPage() {
  const [data, setData] = useState<TodayResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.today().then(setData).catch((e) => setError(String(e?.message ?? e)));
  }, []);

  if (error) return <div className="p-8 text-sm text-red-600">{error}</div>;
  if (!data) return <div className="p-8 text-sm text-muted-foreground">Loading…</div>;

  return (
    <div className="p-8">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Today</h1>
        <p className="text-sm text-muted-foreground">
          {data.active_clients} active client{data.active_clients === 1 ? '' : 's'} ·{' '}
          {data.drafts_to_review_count} draft{data.drafts_to_review_count === 1 ? '' : 's'} pending review
        </p>
      </div>

      <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
        <section className="rounded-lg border border-border bg-white p-5">
          <h2 className="mb-3 text-sm font-medium text-muted-foreground">Drafts to review</h2>
          {data.drafts_to_review.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nothing pending. Go ship something.</p>
          ) : (
            <ul className="space-y-2">
              {data.drafts_to_review.slice(0, 8).map((d) => (
                <li key={d.draft_id} className="rounded-md border border-border p-3 text-sm">
                  <div className="font-medium">{d.title || `Draft #${d.draft_id}`}</div>
                  <div className="text-xs text-muted-foreground">
                    <Link href={`/clients/${d.client_id}`} className="underline-offset-2 hover:underline">
                      {d.client_name}
                    </Link>{' '}
                    · {d.platform}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="rounded-lg border border-border bg-white p-5">
          <h2 className="mb-3 text-sm font-medium text-muted-foreground">Scheduled this week</h2>
          <p className="text-sm text-muted-foreground">Coming in V1.</p>
        </section>

        <section className="rounded-lg border border-border bg-white p-5">
          <h2 className="mb-3 text-sm font-medium text-muted-foreground">Recent activity</h2>
          <p className="text-sm text-muted-foreground">Coming in V1.</p>
        </section>
      </div>
    </div>
  );
}
