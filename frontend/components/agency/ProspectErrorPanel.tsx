'use client';

import { useState } from 'react';
import { AlertTriangle, RotateCw, Trash2 } from 'lucide-react';
import { useRouter } from 'next/navigation';

import { deleteProspectAudit, retryProspectAudit, type ProspectAuditOut } from '@/lib/api';

interface Props {
  audit: ProspectAuditOut;
}

export function ProspectErrorPanel({ audit }: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function handleRetry() {
    if (busy) return;
    setBusy(true);
    try {
      await retryProspectAudit(audit.id);
      router.refresh();
    } catch {
      setBusy(false);
    }
  }

  async function handleDelete() {
    if (!confirm(`Delete prospect audit for ${audit.business_name}?`)) return;
    setBusy(true);
    try {
      await deleteProspectAudit(audit.id);
      router.push('/agency/prospects');
    } catch {
      setBusy(false);
    }
  }

  const isCanceled = audit.status === 'canceled';

  return (
    <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-card)] p-8">
      <h1 className="text-xl font-semibold text-[var(--text-primary)]">{audit.business_name}</h1>
      <p className="mt-1 text-sm text-[var(--text-muted)]">{audit.website_url}</p>

      <div className="mt-6 flex items-start gap-3">
        <AlertTriangle className="mt-0.5 h-5 w-5 text-amber-400" />
        <div>
          <div className="text-sm font-medium text-[var(--text-primary)]">
            {isCanceled ? 'Audit canceled' : 'Audit failed'}
          </div>
          {audit.error_message && (
            <div className="mt-1 text-xs text-[var(--text-muted)]">{audit.error_message}</div>
          )}
        </div>
      </div>

      <div className="mt-6 flex items-center gap-3">
        <button
          type="button"
          onClick={handleRetry}
          disabled={busy}
          className="inline-flex items-center gap-2 rounded-md bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white hover:bg-[var(--accent-hover)] disabled:opacity-50"
        >
          <RotateCw className="h-4 w-4" />
          Retry
        </button>
        <button
          type="button"
          onClick={handleDelete}
          disabled={busy}
          className="inline-flex items-center gap-2 rounded-md border border-[var(--border-subtle)] px-4 py-2 text-sm text-[var(--text-secondary)] hover:bg-[var(--bg-raised)] disabled:opacity-50"
        >
          <Trash2 className="h-4 w-4" />
          Delete
        </button>
      </div>
    </div>
  );
}
