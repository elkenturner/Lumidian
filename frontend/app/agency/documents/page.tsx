'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { FileText, Plus } from 'lucide-react';
import { agencyRecentDocuments, type AgencyDocumentWithClient } from '@/lib/api';
import { DocumentViewer } from '@/components/agency/DocumentViewer';
import { GenerateForAnyClientModal } from '@/components/agency/GenerateForAnyClientModal';

const KINDS = [
  { value: '', label: 'All kinds' },
  { value: 'audit_initial', label: 'Initial audit' },
  { value: 'sow', label: 'Statement of Work' },
  { value: 'monthly_report', label: 'Monthly report' },
  { value: 'kickoff_checklist', label: 'Kickoff checklist' },
];

export default function DocumentsPage() {
  const [docs, setDocs] = useState<AgencyDocumentWithClient[]>([]);
  const [kind, setKind] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeDoc, setActiveDoc] = useState<AgencyDocumentWithClient | null>(null);
  const [genOpen, setGenOpen] = useState(false);

  useEffect(() => {
    setLoading(true);
    agencyRecentDocuments(50, kind || undefined)
      .then(setDocs)
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load'))
      .finally(() => setLoading(false));
  }, [kind]);

  return (
    <div className="p-8 text-[var(--text-primary)]">
      <div className="mb-6 flex items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold tracking-tight">Documents</h1>
        <div className="flex items-center gap-2">
          <select
            value={kind}
            onChange={(e) => setKind(e.target.value)}
            className="rounded-md border border-[var(--border-default)] bg-[var(--bg-raised)] px-3 py-2 text-sm text-[var(--text-primary)]"
          >
            {KINDS.map((k) => (
              <option key={k.value} value={k.value}>
                {k.label}
              </option>
            ))}
          </select>
          <button
            onClick={() => setGenOpen(true)}
            className="flex items-center gap-2 rounded-md bg-[var(--bg-elevated)] px-3 py-2 text-sm font-medium text-[var(--text-primary)] hover:bg-[var(--bg-card)]"
          >
            <Plus className="h-4 w-4" />
            Generate document
          </button>
        </div>
      </div>

      {loading && <p className="text-sm text-[var(--text-muted)]">Loading…</p>}
      {error && <p className="text-sm text-red-400">{error}</p>}
      {!loading && docs.length === 0 && (
        <p className="text-sm text-[var(--text-muted)]">
          No documents yet. Click &ldquo;Generate document&rdquo; to create one.
        </p>
      )}

      <ul className="space-y-2">
        {docs.map((d) => (
          <li
            key={d.id}
            className="flex items-start gap-3 rounded-md border border-[var(--border-subtle)] bg-[var(--bg-card)] p-3 text-sm"
          >
            <FileText className="mt-0.5 h-4 w-4 text-[var(--text-secondary)]" />
            <div className="flex-1 min-w-0">
              <button
                onClick={() => setActiveDoc(d)}
                className="text-left font-medium text-[var(--text-primary)] hover:underline"
              >
                {d.title}
              </button>
              <div className="text-xs text-[var(--text-muted)]">
                {d.kind} ·{' '}
                <Link href={`/agency/clients/${d.client_id}`} className="hover:underline">
                  {d.client_name}
                </Link>{' '}
                ·{' '}
                {new Date(d.generated_at + (d.generated_at.endsWith('Z') ? '' : 'Z')).toLocaleString()}
              </div>
            </div>
          </li>
        ))}
      </ul>

      <DocumentViewer
        doc={activeDoc}
        onClose={() => setActiveDoc(null)}
        onChange={(next) => {
          setDocs((prev) => prev.map((d) => (d.id === next.id ? { ...d, ...next } : d)));
          setActiveDoc((prev) => (prev ? { ...prev, ...next } : null));
        }}
        onDelete={(id) => setDocs((prev) => prev.filter((d) => d.id !== id))}
      />

      <GenerateForAnyClientModal
        open={genOpen}
        onOpenChange={setGenOpen}
        onGenerated={(doc) => {
          agencyRecentDocuments(50, kind || undefined).then(setDocs);
          setActiveDoc(doc as AgencyDocumentWithClient);
        }}
      />
    </div>
  );
}
