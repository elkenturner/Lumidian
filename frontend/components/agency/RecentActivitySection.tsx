'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { agencyRecentActivity, type ActivityEventWithClient } from '@/lib/api';
import { iconForEventType } from './activity-icons';

function timeAgo(iso: string): string {
  const normalized = /[Zz]|[+-]\d{2}:?\d{2}$/.test(iso) ? iso : iso + 'Z';
  const diff = (Date.now() - new Date(normalized).getTime()) / 1000;
  if (diff < 0) return 'just now';
  if (diff < 60) return `${Math.floor(diff)}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

export function RecentActivitySection() {
  const [events, setEvents] = useState<ActivityEventWithClient[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    agencyRecentActivity(10)
      .then(setEvents)
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load'))
      .finally(() => setLoading(false));
  }, []);

  return (
    <section className="mt-6 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-card)] p-5">
      <h2 className="mb-3 text-sm font-medium text-[var(--text-secondary)]">
        Recent activity across clients
      </h2>
      {loading && <p className="text-sm text-[var(--text-muted)]">Loading…</p>}
      {error && <p className="text-sm text-red-400">{error}</p>}
      {!loading && events.length === 0 && (
        <p className="text-sm text-[var(--text-muted)]">Nothing in the last 7 days.</p>
      )}
      <ul className="space-y-2">
        {events.map((e) => {
          const Icon = iconForEventType(e.event_type);
          return (
            <li
              key={e.id}
              className="flex items-start gap-3 rounded-md border border-[var(--border-subtle)] bg-[var(--bg-raised)] p-3 text-sm"
            >
              <div className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-[var(--bg-elevated)] text-[var(--text-secondary)]">
                <Icon width={14} height={14} />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[var(--text-primary)]">{e.body}</p>
                <div className="mt-1 flex items-center gap-2 text-xs text-[var(--text-muted)]">
                  <Link
                    href={`/agency/clients/${e.client_id}`}
                    className="underline-offset-2 hover:underline"
                  >
                    {e.client_name}
                  </Link>
                  <span>·</span>
                  <span>{timeAgo(e.created_at)}</span>
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
