'use client';

import { useState } from 'react';
import { Download, Trash2 } from 'lucide-react';
import { useRouter } from 'next/navigation';

import {
  deleteProspectAudit,
  prospectAuditPdfUrl,
  type ProspectAuditOut,
} from '@/lib/api';
import { RviBandBadge } from './RviBandBadge';

interface Props {
  audit: ProspectAuditOut;
}

export function ProspectResultsPanel({ audit }: Props) {
  const router = useRouter();
  const [deleting, setDeleting] = useState(false);

  async function handleDelete() {
    if (!confirm(`Delete prospect audit for ${audit.business_name}? This removes the PDF too.`)) return;
    setDeleting(true);
    try {
      await deleteProspectAudit(audit.id);
      router.push('/agency/prospects');
    } catch {
      setDeleting(false);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-[var(--text-primary)]">{audit.business_name}</h1>
        <p className="mt-1 text-sm text-[var(--text-muted)]">
          {audit.website_url}{audit.is_local && audit.location ? ` · ${audit.location}` : ''}
        </p>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-card)] p-5">
          <div className="text-xs uppercase tracking-wide text-[var(--text-muted)]">Your visibility</div>
          <div className="mt-3 font-mono text-3xl tabular-nums text-[var(--text-primary)]">
            {audit.overall_visibility_pct !== null ? `${Math.round(audit.overall_visibility_pct)}%` : '—'}
          </div>
        </div>
        <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-card)] p-5">
          <div className="text-xs uppercase tracking-wide text-[var(--text-muted)]">Aggregate RVI</div>
          <div className="mt-3 font-mono text-3xl tabular-nums text-[var(--text-primary)]">
            {audit.aggregate_rvi !== null ? audit.aggregate_rvi.toFixed(2) : '∞'}
          </div>
        </div>
        <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-card)] p-5">
          <div className="text-xs uppercase tracking-wide text-[var(--text-muted)]">Band</div>
          <div className="mt-3">
            <RviBandBadge band={audit.rvi_band} className="text-sm" />
          </div>
        </div>
      </div>

      <div className="flex items-center gap-3">
        {audit.has_pdf && (
          <a
            href={prospectAuditPdfUrl(audit.id)}
            className="inline-flex items-center gap-2 rounded-md bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white hover:bg-[var(--accent-hover)]"
          >
            <Download className="h-4 w-4" />
            Download PDF
          </a>
        )}
        <button
          type="button"
          onClick={handleDelete}
          disabled={deleting}
          className="inline-flex items-center gap-2 rounded-md border border-[var(--border-subtle)] px-4 py-2 text-sm text-[var(--text-secondary)] hover:bg-[var(--bg-raised)] disabled:opacity-50"
        >
          <Trash2 className="h-4 w-4" />
          {deleting ? 'Deleting…' : 'Delete'}
        </button>
      </div>

      <p className="text-xs text-[var(--text-muted)]">
        Detailed per-prompt scores, competitor breakdown, and recommendations are in the PDF — designed for the cold email.
      </p>
    </div>
  );
}
