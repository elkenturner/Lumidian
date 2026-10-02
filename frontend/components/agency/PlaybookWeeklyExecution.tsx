'use client';

import { useState } from 'react';
import { ChevronDown, ChevronRight, Loader2, Send } from 'lucide-react';
import type { ContentDraft, TrackingRun } from '@/lib/api';
import { ClientPipelineTab } from './ClientPipelineTab';
import { GenerateDraftButton } from './GenerateDraftButton';
import { RunTrackingButton } from './RunTrackingButton';
import { isDraftStale } from './agency-helpers';

type AgencyDraft = Omit<ContentDraft, 'status'> & {
  status: string;
  client_feedback?: string | null;
  updated_at?: string | null;
};

interface Props {
  clientId: number;
  brandId: number | null;
  drafts: AgencyDraft[] | null;
  latestRunIso: string | null;
  reviewLinkUrl: string | null;
  primaryContactName: string | null;
  onDraftsChanged: () => void;
  onTrackingTriggered: () => void;
  onOpenSendModal: () => void;
}

function daysSince(iso: string | null): number | null {
  if (!iso) return null;
  const norm = /[Zz]|[+-]\d{2}:?\d{2}$/.test(iso) ? iso : iso + 'Z';
  return Math.floor((Date.now() - new Date(norm).getTime()) / 86_400_000);
}

export function PlaybookWeeklyExecution({
  clientId,
  brandId,
  drafts,
  latestRunIso,
  reviewLinkUrl,
  primaryContactName,
  onDraftsChanged,
  onTrackingTriggered,
  onOpenSendModal,
}: Props) {
  const [drawerOpen, setDrawerOpen] = useState(false);

  if (drafts == null) {
    return (
      <section className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-card)] p-4 text-sm text-[var(--text-muted)]">
        <Loader2 className="inline h-3 w-3 animate-spin" /> Loading drafts…
      </section>
    );
  }

  let toReview = 0;
  let approved = 0;
  let staleWithClient = 0;
  let inFlight = 0;
  for (const d of drafts) {
    if (d.status === 'draft' || d.status === 'changes_requested') toReview++;
    if (d.status === 'approved') approved++;
    if (d.status === 'awaiting_client' && isDraftStale(d)) staleWithClient++;
    if (['draft', 'changes_requested', 'awaiting_client', 'approved'].includes(d.status)) inFlight++;
  }

  const daysStale = daysSince(latestRunIso);
  const trackingStale = daysStale == null || daysStale >= 14;

  const rows: React.ReactNode[] = [];
  if (toReview > 0) {
    rows.push(
      <li key="review" className="flex items-center justify-between gap-3 py-1.5 text-sm">
        <span>{toReview} draft{toReview === 1 ? '' : 's'} ready for your review</span>
        <button
          onClick={() => setDrawerOpen(true)}
          className="text-xs text-[var(--accent-foreground)] hover:underline"
        >
          Open Pipeline ↓
        </button>
      </li>
    );
  }
  if (approved > 0) {
    rows.push(
      <li key="approved" className="flex items-center justify-between gap-3 py-1.5 text-sm">
        <span>{approved} approved draft{approved === 1 ? '' : 's'} to send for client review</span>
        <button
          onClick={onOpenSendModal}
          className="flex items-center gap-1 rounded-md border border-[var(--border-default)] bg-[var(--bg-elevated)] px-2.5 py-1 text-xs text-[var(--text-primary)] hover:bg-[var(--bg-raised)]"
        >
          <Send className="h-3 w-3" />
          Send drafts
        </button>
      </li>
    );
  }
  if (staleWithClient > 0) {
    rows.push(
      <li key="nudge" className="flex items-center justify-between gap-3 py-1.5 text-sm">
        <span>{staleWithClient} draft{staleWithClient === 1 ? '' : 's'} pending client review for too long</span>
        <span className="text-xs text-[var(--text-muted)]">Use Copy nudge in the header</span>
      </li>
    );
  }
  if (trackingStale) {
    rows.push(
      <li key="tracking" className="flex items-center justify-between gap-3 py-1.5 text-sm">
        <span>
          Tracking last ran {daysStale == null ? 'never' : `${daysStale} days ago`}
        </span>
        <RunTrackingButton clientId={clientId} onTriggered={onTrackingTriggered} />
      </li>
    );
  }
  if (rows.length === 0) {
    rows.push(
      <li key="ok" className="py-1.5 text-sm text-emerald-400">All weekly execution caught up.</li>
    );
  }

  return (
    <section className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-card)] p-4">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-medium text-[var(--text-primary)]">
          Weekly execution{' '}
          <span className="text-xs text-[var(--text-muted)]">
            (active: {rows.length === 1 && drafts.length === 0 ? '0' : `${toReview + approved + (trackingStale ? 1 : 0)}`} items)
          </span>
        </h3>
        <GenerateDraftButton clientId={clientId} brandId={brandId} onGenerated={onDraftsChanged} />
      </div>

      <ul className="mt-2 divide-y divide-[var(--border-subtle)]">{rows}</ul>

      <button
        onClick={() => setDrawerOpen((v) => !v)}
        className="mt-3 flex items-center gap-1 text-xs text-[var(--text-muted)] hover:text-[var(--text-secondary)]"
      >
        {drawerOpen ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
        Pipeline drawer
      </button>

      {drawerOpen && (
        <div className="mt-3 border-t border-[var(--border-subtle)] pt-3">
          <ClientPipelineTab
            brandId={brandId}
            reviewLinkUrl={reviewLinkUrl}
            primaryContactName={primaryContactName}
            lifted={drafts}
            onDraftsChanged={onDraftsChanged}
          />
        </div>
      )}
    </section>
  );
}
