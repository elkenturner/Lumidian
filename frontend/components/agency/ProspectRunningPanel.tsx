'use client';

import { useState } from 'react';
import { Loader2, X } from 'lucide-react';

import { cancelProspectAudit, type ProspectAuditOut } from '@/lib/api';

const STATUS_LABELS: Record<string, string> = {
  pending: 'Queued',
  scraping: 'Reading their site',
  generating_prompts: 'Generating audit prompts',
  detecting_competitors: 'Identifying peer brands',
  running_queries: 'Running queries on ChatGPT, Perplexity, Gemini',
  scoring: 'Computing visibility scores',
  drafting_recs: 'Writing recommendations',
  rendering_pdf: 'Rendering PDF',
};

interface Props {
  audit: ProspectAuditOut;
}

export function ProspectRunningPanel({ audit }: Props) {
  const [cancelling, setCancelling] = useState(false);

  async function handleCancel() {
    if (cancelling || audit.cancel_requested) return;
    setCancelling(true);
    try {
      await cancelProspectAudit(audit.id);
    } finally {
      setCancelling(false);
    }
  }

  return (
    <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-card)] p-8">
      <h1 className="text-xl font-semibold text-[var(--text-primary)]">{audit.business_name}</h1>
      <p className="mt-1 text-sm text-[var(--text-muted)]">{audit.website_url}</p>

      <div className="mt-6 flex items-center gap-3">
        <Loader2 className="h-5 w-5 animate-spin text-[var(--accent)]" />
        <div>
          <div className="text-sm font-medium text-[var(--text-primary)]">
            {STATUS_LABELS[audit.status] ?? audit.status}
          </div>
          {audit.status_message && (
            <div className="mt-0.5 text-xs text-[var(--text-muted)]">{audit.status_message}</div>
          )}
        </div>
      </div>

      <p className="mt-4 text-xs text-[var(--text-muted)]">
        This typically takes 90–150 seconds. You can leave this page and come back — the audit will keep running.
      </p>

      <button
        type="button"
        onClick={handleCancel}
        disabled={audit.cancel_requested || cancelling}
        className="mt-6 inline-flex items-center gap-1 rounded-md border border-[var(--border-subtle)] px-3 py-1.5 text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-raised)] disabled:opacity-50"
      >
        <X className="h-3.5 w-3.5" />
        {audit.cancel_requested ? 'Cancellation requested' : 'Cancel'}
      </button>
    </div>
  );
}
