'use client';

import { useState } from 'react';
import { Check, Circle, FileText, Loader2, RotateCcw } from 'lucide-react';
import {
  agencyUpdateMilestone,
  type AgencyClientMilestone,
  type MilestoneKind,
} from '@/lib/api';

interface Props {
  milestone: AgencyClientMilestone;
  label: string;
  /** If null, no "Generate doc" button is shown (e.g., strategy_locked has no template). */
  docKind: string | null;
  /** Secondary CTA shown beside Generate Doc when docKind is null. */
  secondaryHref?: string;
  secondaryLabel?: string;
  onChanged: (next: AgencyClientMilestone) => void;
  onGenerateDoc?: (kind: string) => void;
  /** True while this row's doc is being generated — shows spinner + disables button. */
  generating?: boolean;
  /** True while a sibling row's doc is generating — disables this row's button to avoid races. */
  disabled?: boolean;
}

export function PlaybookLaunchRow({
  milestone,
  label,
  docKind,
  secondaryHref,
  secondaryLabel,
  onChanged,
  onGenerateDoc,
  generating = false,
  disabled = false,
}: Props) {
  const [saving, setSaving] = useState(false);
  const done = milestone.status === 'done';

  const toggle = async () => {
    setSaving(true);
    try {
      const next = await agencyUpdateMilestone(milestone.agency_client_id, milestone.kind, {
        status: done ? 'not_started' : 'done',
      });
      onChanged(next);
    } finally {
      setSaving(false);
    }
  };

  const completedAtLabel = milestone.completed_at
    ? new Date(milestone.completed_at + (milestone.completed_at.endsWith('Z') ? '' : 'Z'))
        .toLocaleDateString()
    : null;

  return (
    <div className="flex items-center gap-3 rounded-md border border-[var(--border-subtle)] bg-[var(--bg-card)] p-3">
      <button
        onClick={toggle}
        disabled={saving}
        className="flex h-6 w-6 items-center justify-center rounded-full border border-[var(--border-default)] text-[var(--text-secondary)] hover:bg-[var(--bg-raised)] disabled:opacity-50"
        aria-label={done ? 'Mark not done' : 'Mark done'}
      >
        {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : done ? <Check className="h-3 w-3 text-emerald-400" /> : <Circle className="h-3 w-3" />}
      </button>

      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium text-[var(--text-primary)]">{label}</div>
        <div className="text-xs text-[var(--text-muted)]">
          {done
            ? `Completed ${completedAtLabel ?? ''}${milestone.completed_by_name ? ` by ${milestone.completed_by_name}` : ''}`
            : milestone.status === 'in_progress'
              ? 'In progress'
              : 'Not started'}
        </div>
      </div>

      <div className="flex items-center gap-2 shrink-0">
        {docKind && onGenerateDoc && (
          <button
            onClick={() => onGenerateDoc(docKind)}
            disabled={generating || disabled}
            className="flex items-center gap-1 rounded-md border border-[var(--border-default)] px-2.5 py-1 text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-raised)] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {generating ? <Loader2 className="h-3 w-3 animate-spin" /> : <FileText className="h-3 w-3" />}
            {generating ? 'Generating…' : 'Generate doc'}
          </button>
        )}
        {!docKind && secondaryHref && secondaryLabel && (
          <a
            href={secondaryHref}
            className="rounded-md border border-[var(--border-default)] px-2.5 py-1 text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-raised)]"
          >
            {secondaryLabel}
          </a>
        )}
        {done && (
          <button
            onClick={toggle}
            disabled={saving}
            className="flex items-center gap-1 rounded-md px-2 py-1 text-xs text-[var(--text-muted)] hover:text-[var(--text-secondary)] disabled:opacity-50"
            title="Undo"
          >
            <RotateCcw className="h-3 w-3" />
          </button>
        )}
      </div>
    </div>
  );
}
