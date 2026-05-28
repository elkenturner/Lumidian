'use client';

import { useState } from 'react';
import Link from 'next/link';
import { ArrowUpRight, FileText, Loader2 } from 'lucide-react';
import {
  agencyUpdateMilestone,
  type AgencyClientMilestone,
} from '@/lib/api';

interface Props {
  milestone: AgencyClientMilestone;
  label: string;
  docKind: string;
  deepLinkHref: string;
  deepLinkLabel: string;
  /** Short summary rendered between header + actions, e.g. "12 candidates · 4 drafted · 1 submitted" */
  summary?: React.ReactNode;
  onChanged: (next: AgencyClientMilestone) => void;
  onGenerateDoc: (kind: string) => void;
}

function fmtDate(iso: string | null): string {
  if (!iso) return '—';
  const norm = /[Zz]|[+-]\d{2}:?\d{2}$/.test(iso) ? iso : iso + 'Z';
  return new Date(norm).toLocaleDateString();
}

function isOverdue(targetIso: string | null, status: string): boolean {
  if (!targetIso || status === 'done' || status === 'skipped') return false;
  const norm = /[Zz]|[+-]\d{2}:?\d{2}$/.test(targetIso) ? targetIso : targetIso + 'Z';
  return new Date(norm).getTime() < Date.now();
}

export function PlaybookEngagement({
  milestone,
  label,
  docKind,
  deepLinkHref,
  deepLinkLabel,
  summary,
  onChanged,
  onGenerateDoc,
}: Props) {
  const [saving, setSaving] = useState(false);
  const overdue = isOverdue(milestone.target_at, milestone.status);

  const setStatus = async (status: 'in_progress' | 'done' | 'not_started') => {
    setSaving(true);
    try {
      const body: { status: typeof status; started_at?: string } = { status };
      if (status === 'in_progress' && !milestone.started_at) {
        body.started_at = new Date().toISOString();
      }
      const next = await agencyUpdateMilestone(milestone.agency_client_id, milestone.kind, body);
      onChanged(next);
    } finally {
      setSaving(false);
    }
  };

  const setTarget = async (iso: string) => {
    setSaving(true);
    try {
      const next = await agencyUpdateMilestone(milestone.agency_client_id, milestone.kind, {
        target_at: iso,
      });
      onChanged(next);
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-card)] p-4">
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="text-sm font-medium text-[var(--text-primary)]">{label}</h3>
        <span
          className={`text-xs ${
            overdue ? 'text-rose-400' : 'text-[var(--text-muted)]'
          }`}
        >
          started {fmtDate(milestone.started_at)} · target {fmtDate(milestone.target_at)}{overdue ? ' · overdue' : ''} · {milestone.status.replace('_', ' ')}
        </span>
      </div>

      {summary && <div className="mt-2 text-xs text-[var(--text-secondary)]">{summary}</div>}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          onClick={() => onGenerateDoc(docKind)}
          className="flex items-center gap-1 rounded-md border border-[var(--border-default)] px-2.5 py-1 text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-raised)]"
        >
          <FileText className="h-3 w-3" />
          Generate doc
        </button>
        <Link
          href={deepLinkHref}
          className="flex items-center gap-1 rounded-md border border-[var(--border-default)] px-2.5 py-1 text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-raised)]"
        >
          <ArrowUpRight className="h-3 w-3" />
          {deepLinkLabel}
        </Link>

        <input
          type="date"
          value={milestone.target_at ? milestone.target_at.slice(0, 10) : ''}
          onChange={(e) => {
            if (e.target.value) setTarget(new Date(e.target.value).toISOString());
          }}
          className="rounded-md border border-[var(--border-default)] bg-[var(--bg-raised)] px-2 py-1 text-xs text-[var(--text-secondary)]"
          title="Target completion date"
        />

        <div className="ml-auto flex items-center gap-1">
          {milestone.status !== 'in_progress' && milestone.status !== 'done' && (
            <button
              onClick={() => setStatus('in_progress')}
              disabled={saving}
              className="rounded-md border border-[var(--border-default)] px-2.5 py-1 text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-raised)] disabled:opacity-50"
            >
              {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Mark started'}
            </button>
          )}
          {milestone.status !== 'done' && (
            <button
              onClick={() => setStatus('done')}
              disabled={saving}
              className="rounded-md border border-[var(--border-default)] px-2.5 py-1 text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-raised)] disabled:opacity-50"
            >
              Mark complete
            </button>
          )}
          {milestone.status === 'done' && (
            <button
              onClick={() => setStatus('in_progress')}
              disabled={saving}
              className="rounded-md px-2 py-1 text-xs text-[var(--text-muted)] hover:text-[var(--text-secondary)] disabled:opacity-50"
            >
              Reopen
            </button>
          )}
        </div>
      </div>
    </section>
  );
}
