'use client';

import { useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { Copy, X } from 'lucide-react';
import { agencyDeleteDocument, agencyUpdateDocument, type AgencyDocument } from '@/lib/api';

interface Props {
  doc: AgencyDocument | null;
  onClose: () => void;
  onChange: (next: AgencyDocument) => void;
  onDelete: (id: number) => void;
}

export function DocumentViewer({ doc, onClose, onChange, onDelete }: Props) {
  const [editing, setEditing] = useState(false);
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!doc) return null;

  const startEdit = () => {
    setBody(doc.body_markdown);
    setEditing(true);
  };

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const next = await agencyUpdateDocument(doc.id, body);
      onChange(next);
      setEditing(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save');
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!confirm('Delete this document?')) return;
    setBusy(true);
    try {
      await agencyDeleteDocument(doc.id);
      onDelete(doc.id);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to delete');
    } finally {
      setBusy(false);
    }
  };

  const copy = () => {
    navigator.clipboard.writeText(doc.body_markdown);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <Dialog.Root open={!!doc} onOpenChange={(o) => !o && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/60" />
        <Dialog.Content className="fixed left-1/2 top-1/2 max-h-[85vh] w-[min(90vw,900px)] -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-lg border border-[var(--border-default)] bg-[var(--bg-raised)] text-[var(--text-primary)] shadow-lg">
          <div className="flex items-start justify-between border-b border-[var(--border-subtle)] p-5">
            <div className="min-w-0">
              <Dialog.Title className="text-base font-semibold">{doc.title}</Dialog.Title>
              <p className="mt-1 text-xs text-[var(--text-muted)]">
                {doc.kind} · generated{' '}
                {new Date(doc.generated_at + (doc.generated_at.endsWith('Z') ? '' : 'Z')).toLocaleString()}
                {doc.generated_by_name && <> by {doc.generated_by_name}</>}
              </p>
            </div>
            <Dialog.Close asChild>
              <button className="rounded-md border border-[var(--border-default)] p-2 hover:bg-[var(--bg-card)]">
                <X className="h-4 w-4" />
              </button>
            </Dialog.Close>
          </div>

          <div className="max-h-[60vh] overflow-y-auto p-5">
            {editing ? (
              <textarea
                value={body}
                onChange={(e) => setBody(e.target.value)}
                rows={24}
                className="w-full rounded-md border border-[var(--border-default)] bg-[var(--bg-card)] p-3 font-mono text-xs text-[var(--text-primary)]"
              />
            ) : (
              <pre className="whitespace-pre-wrap font-sans text-sm text-[var(--text-primary)]">
                {doc.body_markdown}
              </pre>
            )}
            {error && <p className="mt-2 text-sm text-red-400">{error}</p>}
          </div>

          <div className="flex items-center justify-between gap-2 border-t border-[var(--border-subtle)] p-4">
            <div className="flex gap-2">
              {editing ? (
                <>
                  <button
                    onClick={save}
                    disabled={busy}
                    className="rounded-md bg-[var(--bg-elevated)] px-3 py-1.5 text-xs font-medium text-[var(--text-primary)] hover:bg-[var(--bg-card)] disabled:opacity-50"
                  >
                    Save
                  </button>
                  <button
                    onClick={() => setEditing(false)}
                    disabled={busy}
                    className="rounded-md border border-[var(--border-default)] px-3 py-1.5 text-xs text-[var(--text-secondary)]"
                  >
                    Cancel
                  </button>
                </>
              ) : (
                <>
                  <button
                    onClick={copy}
                    className="flex items-center gap-1 rounded-md border border-[var(--border-default)] px-3 py-1.5 text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-card)]"
                  >
                    <Copy className="h-3 w-3" />
                    {copied ? 'Copied!' : 'Copy'}
                  </button>
                  <button
                    onClick={startEdit}
                    className="rounded-md border border-[var(--border-default)] px-3 py-1.5 text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-card)]"
                  >
                    Edit
                  </button>
                </>
              )}
            </div>
            <button
              onClick={remove}
              disabled={busy}
              className="rounded-md border border-[var(--border-default)] px-3 py-1.5 text-xs text-[var(--text-muted)] hover:text-red-400"
            >
              Delete
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
