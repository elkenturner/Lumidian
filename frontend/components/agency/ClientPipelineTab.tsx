'use client';

import { useEffect, useState } from 'react';
import {
  agencyAssignDraft,
  agencyUpdateDraftStatus,
  getDrafts,
  type ContentDraft,
  type DraftStaffStatus,
} from '@/lib/api';
import { AssigneePicker } from './AssigneePicker';

interface Props {
  brandId: number | null;
}

const COLUMNS: Array<{ key: string; label: string }> = [
  { key: 'draft', label: 'Draft' },
  { key: 'awaiting_client', label: 'Awaiting client' },
  { key: 'changes_requested', label: 'Changes requested' },
  { key: 'approved', label: 'Approved' },
  { key: 'posted', label: 'Posted' },
];

// ContentDraft.status covers the core states; agency workflow adds extra states
// at runtime that the public type doesn't enumerate.
type AgencyDraft = Omit<ContentDraft, 'status'> & { status: string };

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

export function ClientPipelineTab({ brandId }: Props) {
  const [drafts, setDrafts] = useState<AgencyDraft[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

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
    return (
      <p className="text-sm text-[var(--text-muted)]">No brand attached to this client.</p>
    );
  }
  if (loading) return <p className="text-sm text-[var(--text-muted)]">Loading…</p>;
  if (error) return <p className="text-sm text-red-400">{error}</p>;

  if (drafts.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-[var(--border-subtle)] p-10 text-center text-sm text-[var(--text-muted)]">
        No drafts yet. Use the Lumidian Content section to generate some for this client&apos;s
        brand — they&apos;ll show up here.
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-4 text-[var(--text-primary)] md:grid-cols-5">
      {COLUMNS.map(({ key, label }) => {
        const items = drafts.filter((d) => d.status === key);
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
              {items.map((d) => (
                <li
                  key={d.id}
                  className="rounded-md border border-[var(--border-subtle)] bg-[var(--bg-raised)] p-3 text-sm"
                >
                  <div className="font-medium">{d.title || `Draft #${d.id}`}</div>
                  <div className="text-xs text-[var(--text-muted)]">{d.platform}</div>
                  {d.content_text && (
                    <p className="mt-2 line-clamp-3 text-xs text-[var(--text-muted)]">
                      {d.content_text}
                    </p>
                  )}
                  {key === 'changes_requested' &&
                    'client_feedback' in d &&
                    typeof (d as { client_feedback?: string | null }).client_feedback ===
                      'string' && (
                      <p className="mt-2 rounded border border-amber-500/30 bg-amber-500/10 p-2 text-xs text-amber-200">
                        {(d as { client_feedback?: string | null }).client_feedback}
                      </p>
                    )}
                  <div className="mt-2">
                    <AssigneePicker
                      value={(d as { assigned_to_user_id?: number | null }).assigned_to_user_id ?? null}
                      onChange={async (userId) => {
                        await agencyAssignDraft(d.id, userId);
                        updateLocal(d.id, { assigned_to_user_id: userId } as Partial<typeof d>);
                      }}
                      compact
                    />
                  </div>
                  <DraftActions
                    draft={d}
                    onChange={(patch) => updateLocal(d.id, patch)}
                  />
                </li>
              ))}
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
  );
}
