'use client';

import { useEffect, useState } from 'react';
import { Download, FileText, Loader2 } from 'lucide-react';
import { agencyListDocuments, agencyRenderDocument, type AgencyDocument } from '@/lib/api';
import { DocumentViewer } from './DocumentViewer';

interface Props {
  clientId: number;
  // optional: render docs supplied externally (e.g., after a fresh generation)
  injectDoc?: AgencyDocument | null;
}

function DownloadPdfButton({ clientId, kind, title }: { clientId: number; kind: string; title: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const onClick = async () => {
    setBusy(true);
    setError(null);
    try {
      const { blob, filename } = await agencyRenderDocument(clientId, kind);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename || `${title.replace(/[^a-zA-Z0-9_-]+/g, '-')}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to download PDF');
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <button
        onClick={onClick}
        disabled={busy}
        className="flex items-center gap-1 rounded-md border border-[var(--border-default)] px-2 py-1 text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-raised)] disabled:opacity-50"
        title="Download as PDF"
      >
        {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Download className="h-3 w-3" />}
        PDF
      </button>
      {error && <span className="ml-2 text-xs text-red-400">{error}</span>}
    </>
  );
}

export function DocumentList({ clientId, injectDoc }: Props) {
  const [docs, setDocs] = useState<AgencyDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeDoc, setActiveDoc] = useState<AgencyDocument | null>(null);

  useEffect(() => {
    agencyListDocuments(clientId)
      .then(setDocs)
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load'))
      .finally(() => setLoading(false));
  }, [clientId]);

  useEffect(() => {
    if (injectDoc) {
      setDocs((prev) => [injectDoc, ...prev.filter((d) => d.id !== injectDoc.id)]);
      setActiveDoc(injectDoc);
    }
  }, [injectDoc]);

  return (
    <>
      <section className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-card)] p-5">
        <h3 className="mb-3 text-sm font-medium text-[var(--text-secondary)]">Documents</h3>
        {loading && <p className="text-sm text-[var(--text-muted)]">Loading…</p>}
        {error && <p className="text-sm text-red-400">{error}</p>}
        {!loading && docs.length === 0 && (
          <p className="text-sm text-[var(--text-muted)]">No documents yet. Generate one above.</p>
        )}
        <ul className="space-y-2">
          {docs.map((d) => (
            <li
              key={d.id}
              className="flex items-start gap-3 rounded-md border border-[var(--border-subtle)] bg-[var(--bg-raised)] p-3 text-sm"
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
                  {new Date(d.generated_at + (d.generated_at.endsWith('Z') ? '' : 'Z')).toLocaleDateString()}
                  {d.generated_by_name && <> · {d.generated_by_name}</>}
                </div>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <DownloadPdfButton clientId={clientId} kind={d.kind} title={d.title} />
              </div>
            </li>
          ))}
        </ul>
      </section>
      <DocumentViewer
        doc={activeDoc}
        clientId={clientId}
        onClose={() => setActiveDoc(null)}
        onChange={(next) => {
          setDocs((prev) => prev.map((d) => (d.id === next.id ? next : d)));
          setActiveDoc(next);
        }}
        onDelete={(id) => setDocs((prev) => prev.filter((d) => d.id !== id))}
      />
    </>
  );
}
