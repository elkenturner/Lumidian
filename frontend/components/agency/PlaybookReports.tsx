'use client';

import { useState } from 'react';
import { FileText, Loader2 } from 'lucide-react';
import { agencyRenderDocument, agencyListDocuments, MissingFieldsError, type AgencyDocument } from '@/lib/api';
import { MissingBrandFieldsCard } from './MissingBrandFieldsCard';

interface Props {
  clientId: number;
  brandId: number | null;
  lastWeekly: AgencyDocument | null;
  lastMonthly: AgencyDocument | null;
  onGenerated: (doc: AgencyDocument) => void;
}

function fmt(doc: AgencyDocument | null): string {
  if (!doc) return 'never';
  const iso = doc.generated_at + (doc.generated_at.endsWith('Z') ? '' : 'Z');
  return new Date(iso).toLocaleDateString() + (doc.generated_by_name ? ` by ${doc.generated_by_name}` : '');
}

export function PlaybookReports({ clientId, brandId, lastWeekly, lastMonthly, onGenerated }: Props) {
  const [busyKind, setBusyKind] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [missing, setMissing] = useState<string[] | null>(null);

  const generate = async (kind: 'agency_weekly_report' | 'monthly_report') => {
    setBusyKind(kind);
    setError(null);
    setMissing(null);
    try {
      const { blob, filename } = await agencyRenderDocument(clientId, kind);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      // Refresh the "last generated" pointer
      const refreshed = await agencyListDocuments(clientId, kind);
      if (refreshed[0]) onGenerated(refreshed[0]);
    } catch (e) {
      if (e instanceof MissingFieldsError) {
        setMissing(e.missingFields);
      } else {
        setError(e instanceof Error ? e.message : 'Failed to generate');
      }
    } finally {
      setBusyKind(null);
    }
  };

  return (
    <section className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-card)] p-4">
      <h3 className="text-sm font-medium text-[var(--text-primary)]">Reports</h3>

      <div className="mt-2 space-y-2">
        <div className="flex items-center justify-between gap-3 text-sm">
          <div>
            Weekly · last generated <span className="text-[var(--text-muted)]">{fmt(lastWeekly)}</span>
          </div>
          <button
            onClick={() => generate('agency_weekly_report')}
            disabled={busyKind != null}
            className="flex items-center gap-1 rounded-md border border-[var(--border-default)] px-2.5 py-1 text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-raised)] disabled:opacity-50"
          >
            {busyKind === 'agency_weekly_report' ? <Loader2 className="h-3 w-3 animate-spin" /> : <FileText className="h-3 w-3" />}
            Generate this week's
          </button>
        </div>

        <div className="flex items-center justify-between gap-3 text-sm">
          <div>
            Monthly · last generated <span className="text-[var(--text-muted)]">{fmt(lastMonthly)}</span>
          </div>
          <button
            onClick={() => generate('monthly_report')}
            disabled={busyKind != null}
            className="flex items-center gap-1 rounded-md border border-[var(--border-default)] px-2.5 py-1 text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-raised)] disabled:opacity-50"
          >
            {busyKind === 'monthly_report' ? <Loader2 className="h-3 w-3 animate-spin" /> : <FileText className="h-3 w-3" />}
            Generate this month's
          </button>
        </div>
      </div>

      {missing && (
        <div className="mt-2">
          <MissingBrandFieldsCard
            brandId={brandId}
            missingFields={missing}
            onDismiss={() => setMissing(null)}
          />
        </div>
      )}
      {error && <p className="mt-2 text-xs text-rose-400">{error}</p>}
    </section>
  );
}
