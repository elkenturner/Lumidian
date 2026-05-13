'use client';

import { useEffect, useState } from 'react';
import {
  agencyUpdateDraftStatus,
  getDrafts,
  type ContentDraft,
  type DraftStaffStatus,
} from '@/lib/api';
import { AssigneePicker } from './AssigneePicker';
import { NudgePill } from './NudgePill';
import { agencyAssignDraft } from '@/lib/api';
import { isDraftStale, nudgeMessageText } from './agency-helpers';

interface Props {
  brandId: number | null;
  reviewLinkUrl?: string | null;
  primaryContactName?: string | null;
}

// ContentDraft.status covers core states; agency workflow adds extras at runtime.
type AgencyDraft = Omit<ContentDraft, 'status'> & {
  status: string;
  client_feedback?: string | null;
  updated_at?: string | null;
};

interface DraftActionsProps {
  draft: AgencyDraft;
  onChange: (next: Partial<AgencyDraft>) => void;
}

function DraftActions({ draft, onChange }: DraftActionsProps) {
  const [busy, setBusy] = useState(false);
  const set = async (status: DraftStaffStatus) => {
    setBusy(true);
    try {
      await agencyUpdateDraftStatus(draft.id, status);
      onChange({ status });
    } finally {
      setBusy(false);
    }
  };

  if (draft.status === 'draft' || draft.status === 'changes_requested') {
    return (
      <button
        onClick={() => set('awaiting_client')}
        disabled={busy}
        className="mt-2 rounded-md border border-[var(--border-default)] px-2 py-1 text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-raised)] disabled:opacity-50"
      >
        Send to client review
      </button>
    );
  }
  if (draft.status === 'approved') {
    return (
      <button
        onClick={() => set('posted')}
        disabled={busy}
        className="mt-2 rounded-md border border-[var(--border-default)] px-2 py-1 text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-raised)] disabled:opacity-50"
      >
        Mark as posted
      </button>
    );
  }
  return null;
}

const COLUMNS: Array<{ key: string; label: string; matchesStatus: (s: string) => boolean }> = [
  {
    key: 'drafting',
    label: 'Drafting',
    matchesStatus: (s) => s === 'draft' || s === 'changes_requested',
  },
  {
    key: 'with_client',
    label: 'With client',
    matchesStatus: (s) => s === 'awaiting_client',
  },
  {
    key: 'done',
    label: 'Done',
    matchesStatus: (s) => s === 'approved' || s === 'posted',
  },
];

export function ClientPipelineTab({ brandId, reviewLinkUrl, primaryContactName }: Props) {
  const [drafts, setDrafts] = useState<AgencyDraft[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [showRejected, setShowRejected] = useState(false);

  useEffect(() => {
    if (brandId == null) {
      setLoading(false);
      return;
    }
    getDrafts(brandId)
      .then((data) => setDrafts(data as AgencyDraft[]))
      .catch((e) => setError(String(e?.message ?? e)))
      .finally(() => setLoading(false));
  }, [brandId]);

  const updateLocal = (id: number, patch: Partial<AgencyDraft>) => {
    setDrafts((prev) => prev.map((d) => (d.id === id ? { ...d, ...patch } : d)));
  };

  if (brandId == null) {
    return <p className="text-sm text-[var(--text-muted)]">No brand attached to this client.</p>;
  }
  if (loading) return <p className="text-sm text-[var(--text-muted)]">Loading…</p>;
  if (error) return <p className="text-sm text-red-400">{error}</p>;

  const rejectedCount = drafts.filter((d) => d.status === 'rejected').length;
  const visibleDrafts = showRejected ? drafts : drafts.filter((d) => d.status !== 'rejected');

  if (drafts.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-[var(--border-subtle)] p-10 text-center text-sm text-[var(--text-muted)]">
        No drafts yet. Use the Lumidian Content section to generate some for this client&apos;s
        brand — they&apos;ll show up here.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {rejectedCount > 0 && (
        <div className="flex justify-end">
          <label className="flex items-center gap-2 text-xs text-[var(--text-muted)]">
            <input
              type="checkbox"
              checked={showRejected}
              onChange={(e) => setShowRejected(e.target.checked)}
            />
            Show rejected ({rejectedCount})
          </label>
        </div>
      )}
      <div className="grid grid-cols-1 gap-4 text-[var(--text-primary)] md:grid-cols-3">
        {COLUMNS.map(({ key, label, matchesStatus }) => {
          const items = visibleDrafts.filter((d) => matchesStatus(d.status));
          return (
            <section
              key={key}
              className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-card)] p-4"
            >
              <h3 className="mb-3 flex items-center justify-between text-sm font-medium">
                <span>{label}</span>
                <span className="text-xs text-[var(--text-muted)]">{items.length}</span>
              </h3>
              <ul className="space-y-2">
                {items.map((d) => {
                  const stale = key === 'with_client' && isDraftStale(d);
                  return (
                    <li
                      key={d.id}
                      className="rounded-md border border-[var(--border-subtle)] bg-[var(--bg-raised)] p-3 text-sm"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="font-medium">{d.title || `Draft #${d.id}`}</div>
                        {d.status === 'changes_requested' && (
                          <span className="rounded-full bg-amber-500/20 px-2 py-0.5 text-xs text-amber-300">
                            Changes requested
                          </span>
                        )}
                        {d.status === 'approved' && (
                          <span className="rounded-full bg-emerald-500/20 px-2 py-0.5 text-xs text-emerald-300">
                            Ready to post
                          </span>
                        )}
                        {d.status === 'posted' && (
                          <span className="rounded-full bg-slate-500/20 px-2 py-0.5 text-xs text-slate-300">
                            Posted
                          </span>
                        )}
                        {d.status === 'rejected' && (
                          <span className="rounded-full bg-rose-500/20 px-2 py-0.5 text-xs text-rose-300">
                            Rejected
                          </span>
                        )}
                      </div>
                      <div className="mt-1 text-xs text-[var(--text-muted)]">{d.platform}</div>
                      {d.content_text && (
                        <p className="mt-2 line-clamp-3 text-xs text-[var(--text-muted)]">
                          {d.content_text}
                        </p>
                      )}
                      {d.status === 'changes_requested' && d.client_feedback && (
                        <p className="mt-2 rounded border border-amber-500/30 bg-amber-500/10 p-2 text-xs text-amber-200">
                          {d.client_feedback}
                        </p>
                      )}
                      {stale && reviewLinkUrl && (
                        <div className="mt-2">
                          <NudgePill
                            message={nudgeMessageText(primaryContactName ?? null, reviewLinkUrl)}
                          />
                        </div>
                      )}
                      <div className="mt-2">
                        <AssigneePicker
                          value={d.assigned_to_user_id ?? null}
                          onChange={async (userId) => {
                            await agencyAssignDraft(d.id, userId);
                            updateLocal(d.id, { assigned_to_user_id: userId });
                          }}
                          compact
                        />
                      </div>
                      <DraftActions draft={d} onChange={(patch) => updateLocal(d.id, patch)} />
                    </li>
                  );
                })}
                {items.length === 0 && (
                  <li className="rounded-md border border-dashed border-[var(--border-subtle)] p-3 text-xs text-[var(--text-muted)]">
                    Empty
                  </li>
                )}
              </ul>
            </section>
          );
        })}
      </div>
    </div>
  );
}
