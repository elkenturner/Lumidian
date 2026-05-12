'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { agencyMyQueue, type MyQueueResponse } from '@/lib/api';

function dueLabel(iso: string | null): string | null {
  if (!iso) return null;
  const normalized = /[Zz]|[+-]\d{2}:?\d{2}$/.test(iso) ? iso : iso + 'Z';
  const t = new Date(normalized).getTime();
  const now = Date.now();
  const days = Math.round((t - now) / 86400000);
  if (days < -1) return `${Math.abs(days)}d overdue`;
  if (days <= 0) return 'Today';
  if (days === 1) return 'Tomorrow';
  return `in ${days}d`;
}

export function MyQueueSection() {
  const [data, setData] = useState<MyQueueResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    agencyMyQueue().then(setData).catch((e) => setError(e instanceof Error ? e.message : 'Failed to load'));
  }, []);

  if (error) return null;
  if (!data) return null;

  const total = data.drafts.length + data.tasks.length;
  if (total === 0) return null;

  return (
    <section className="mb-6 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-card)] p-5">
      <h2 className="mb-3 text-sm font-medium text-[var(--text-secondary)]">
        Your queue ({total})
      </h2>
      <ul className="space-y-2">
        {data.tasks.map((t) => (
          <li key={`task-${t.id}`} className="flex items-start gap-3 rounded-md border border-[var(--border-subtle)] bg-[var(--bg-raised)] p-3 text-sm">
            <div className="flex-1 min-w-0">
              <Link href={`/agency/clients/${t.agency_client_id}`} className="font-medium text-[var(--text-primary)] hover:underline">
                {t.title}
              </Link>
              <div className="mt-1 text-xs text-[var(--text-muted)]">
                Task · {t.status === 'in_progress' ? 'In progress' : 'Open'}
                {dueLabel(t.due_at) && <> · {dueLabel(t.due_at)}</>}
              </div>
            </div>
          </li>
        ))}
        {data.drafts.map((d) => (
          <li key={`draft-${d.draft_id}`} className="flex items-start gap-3 rounded-md border border-[var(--border-subtle)] bg-[var(--bg-raised)] p-3 text-sm">
            <div className="flex-1 min-w-0">
              <Link href={`/agency/clients/${d.client_id}`} className="font-medium text-[var(--text-primary)] hover:underline">
                {d.title || `Draft #${d.draft_id}`}
              </Link>
              <div className="mt-1 text-xs text-[var(--text-muted)]">
                Draft · {d.status.replace('_', ' ')} · {d.platform} · {d.client_name}
              </div>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
