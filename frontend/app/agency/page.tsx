'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  agencyGetReviewLink,
  agencyToday,
  type AgencyTodayDraft,
  type AgencyTodayResponse,
  type ReviewLinkOut,
} from '@/lib/api';
import { MyQueueSection } from '@/components/agency/MyQueueSection';
import { NudgePill } from '@/components/agency/NudgePill';
import { isDraftStale, nudgeMessageText } from '@/components/agency/agency-helpers';

interface DraftRowProps {
  draft: AgencyTodayDraft;
  showNudge?: boolean;
  nudgeMessageByClient: Map<number, string>;
}

function DraftRow({ draft, showNudge, nudgeMessageByClient }: DraftRowProps) {
  const msg = nudgeMessageByClient.get(draft.client_id);
  const stale = showNudge && isDraftStale(draft) && !!msg;
  return (
    <li className="rounded-md border border-[var(--border-subtle)] bg-[var(--bg-raised)] p-3 text-sm">
      <div className="flex items-start justify-between gap-2">
        <div className="font-medium">{draft.title || `Draft #${draft.draft_id}`}</div>
        {stale && msg && <NudgePill message={msg} />}
      </div>
      <div className="mt-1 text-xs text-[var(--text-muted)]">
        <Link href={`/agency/clients/${draft.client_id}`} className="hover:underline">
          {draft.client_name}
        </Link>{' '}
        · {draft.platform}
      </div>
    </li>
  );
}

function DraftList({
  drafts,
  emptyText,
  showNudge,
  nudgeMessageByClient,
}: {
  drafts: AgencyTodayDraft[];
  emptyText: string;
  showNudge?: boolean;
  nudgeMessageByClient: Map<number, string>;
}) {
  if (drafts.length === 0) {
    return <p className="text-sm text-[var(--text-muted)]">{emptyText}</p>;
  }
  return (
    <ul className="space-y-2">
      {drafts.slice(0, 10).map((d) => (
        <DraftRow
          key={d.draft_id}
          draft={d}
          showNudge={showNudge}
          nudgeMessageByClient={nudgeMessageByClient}
        />
      ))}
    </ul>
  );
}

export default function AgencyTodayPage() {
  const [data, setData] = useState<AgencyTodayResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [nudgeMessageByClient, setNudgeMessageByClient] = useState<Map<number, string>>(new Map());

  useEffect(() => {
    agencyToday()
      .then(async (resp) => {
        setData(resp);
        const clientIds = Array.from(
          new Set((resp.awaiting_client ?? []).map((d) => d.client_id)),
        );
        const map = new Map<number, string>();
        const linkResults = await Promise.allSettled(clientIds.map((id) => agencyGetReviewLink(id)));
        clientIds.forEach((id, i) => {
          const r = linkResults[i];
          if (r.status === 'fulfilled' && r.value) {
            const link: ReviewLinkOut = r.value;
            map.set(id, nudgeMessageText(null, link.url));
          }
        });
        setNudgeMessageByClient(map);
      })
      .catch((e) => setError(String(e?.message ?? e)));
  }, []);

  if (error) return <div className="p-8 text-sm text-red-400">{error}</div>;
  if (!data) return <div className="p-8 text-sm text-[var(--text-muted)]">Loading…</div>;

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

      <MyQueueSection />

      <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
        <section className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-card)] p-5">
          <h2 className="mb-3 text-sm font-medium text-[var(--text-secondary)]">
            Awaiting your review ({data.drafts_to_review_count})
          </h2>
          <DraftList
            drafts={data.drafts_to_review}
            emptyText="Nothing to work on right now."
            nudgeMessageByClient={nudgeMessageByClient}
          />
        </section>

        <section className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-card)] p-5">
          <h2 className="mb-3 text-sm font-medium text-[var(--text-secondary)]">
            With client ({data.awaiting_client?.length ?? 0})
          </h2>
          <DraftList
            drafts={data.awaiting_client ?? []}
            emptyText="Nothing waiting on the client."
            showNudge
            nudgeMessageByClient={nudgeMessageByClient}
          />
        </section>

        <section className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-card)] p-5">
          <h2 className="mb-3 text-sm font-medium text-[var(--text-secondary)]">
            Ready to post ({data.approved?.length ?? 0})
          </h2>
          <DraftList
            drafts={data.approved ?? []}
            emptyText="Nothing approved yet."
            nudgeMessageByClient={nudgeMessageByClient}
          />
        </section>
      </div>
    </div>
  );
}
