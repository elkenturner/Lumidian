'use client';

import { ArrowRight, CheckCircle2 } from 'lucide-react';

export interface NextStepDraftCounts {
  /** drafts where status === 'draft' or 'changes_requested' */
  toReview: number;
  /** drafts where status === 'approved' (staff-approved, awaiting client send / mark-posted) */
  approved: number;
  /** drafts where status === 'awaiting_client' AND have sat there > STALE_DAYS days */
  staleWithClient: number;
  /** total drafts in any non-terminal status (draft, changes_requested, awaiting_client, approved) */
  inFlight: number;
}

export type NextStepAction =
  | { kind: 'review_drafts'; count: number }
  | { kind: 'send_to_client'; count: number }
  | { kind: 'nudge_client'; count: number }
  | { kind: 'mark_posted'; count: number }
  | { kind: 'run_tracking'; daysStale: number }
  | { kind: 'generate_drafts' }
  | { kind: 'all_caught_up' };

const TRACKING_STALE_DAYS = 14;

export function computeNextStep(
  counts: NextStepDraftCounts,
  lastTrackingRunIso: string | null,
): NextStepAction {
  if (counts.toReview > 0) return { kind: 'review_drafts', count: counts.toReview };

  // "approved" drafts split between two cards: nothing on the front end distinguishes
  // "approved but not yet sent" from "approved by client, ready to post". We treat any
  // 'approved' draft as ready for the next staff action and surface "Send to client review"
  // — staff will hit "Mark as posted" on the Pipeline tab once the draft is live.
  if (counts.approved > 0) return { kind: 'send_to_client', count: counts.approved };

  if (counts.staleWithClient > 0) return { kind: 'nudge_client', count: counts.staleWithClient };

  const daysStale = computeDaysStaleTracking(lastTrackingRunIso);
  if (daysStale >= TRACKING_STALE_DAYS) return { kind: 'run_tracking', daysStale };

  if (counts.inFlight === 0) return { kind: 'generate_drafts' };

  return { kind: 'all_caught_up' };
}

function computeDaysStaleTracking(lastRunIso: string | null): number {
  if (!lastRunIso) return Number.MAX_SAFE_INTEGER;
  const normalized = /[Zz]|[+-]\d{2}:?\d{2}$/.test(lastRunIso) ? lastRunIso : lastRunIso + 'Z';
  const t = new Date(normalized).getTime();
  return Math.floor((Date.now() - t) / 86_400_000);
}

interface ShelfProps {
  action: NextStepAction;
  clientName: string;
  /** Called when the CTA is clicked. Cockpit dispatches to the right handler based on `action.kind`. */
  onAction: (action: NextStepAction) => void;
}

export function ClientNextStepShelf({ action, clientName, onAction }: ShelfProps) {
  if (action.kind === 'all_caught_up') {
    return (
      <div className="flex items-center gap-3 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-card)] px-5 py-4 text-sm text-[var(--text-secondary)]">
        <CheckCircle2 className="h-4 w-4 text-emerald-400" />
        All caught up for {clientName}.
      </div>
    );
  }

  const { headline, cta } = describe(action);

  return (
    <button
      onClick={() => onAction(action)}
      className="flex w-full items-center justify-between gap-4 rounded-lg border border-[var(--border-default)] bg-[var(--bg-elevated)] px-5 py-4 text-left transition hover:border-[var(--border-strong)] hover:bg-[var(--bg-card)]"
    >
      <div>
        <div className="text-xs uppercase tracking-wide text-[var(--text-muted)]">Next step</div>
        <div className="mt-1 text-sm font-medium text-[var(--text-primary)]">{headline}</div>
      </div>
      <span className="flex items-center gap-2 text-sm font-medium text-[var(--accent-foreground)]">
        {cta}
        <ArrowRight className="h-4 w-4" />
      </span>
    </button>
  );
}

function describe(action: NextStepAction): { headline: string; cta: string } {
  switch (action.kind) {
    case 'review_drafts': {
      const s = action.count === 1 ? '' : 's';
      return { headline: `${action.count} draft${s} ready for your review`, cta: 'Open Pipeline' };
    }
    case 'send_to_client': {
      const s = action.count === 1 ? '' : 's';
      return { headline: `${action.count} approved draft${s} — send to client review`, cta: 'Send drafts' };
    }
    case 'nudge_client': {
      const s = action.count === 1 ? '' : 's';
      return { headline: `${action.count} draft${s} pending client review for too long`, cta: 'Copy nudge' };
    }
    case 'mark_posted': {
      const s = action.count === 1 ? '' : 's';
      return { headline: `${action.count} client-approved draft${s} ready to mark posted`, cta: 'Open Pipeline' };
    }
    case 'run_tracking': {
      const phrase = action.daysStale >= Number.MAX_SAFE_INTEGER / 2 ? 'never' : `${action.daysStale} days ago`;
      return { headline: `Tracking last ran ${phrase}`, cta: 'Run tracking' };
    }
    case 'generate_drafts':
      return { headline: 'No drafts in flight — generate some', cta: 'Generate drafts' };
    case 'all_caught_up':
      // unreachable
      return { headline: '', cta: '' };
  }
}
