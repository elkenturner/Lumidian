'use client';

import { useEffect, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { Loader2, X } from 'lucide-react';
import {
  agencyGenerateDocument,
  agencyListClients,
  agencyListDocumentTemplates,
  type AgencyClient,
  type AgencyDocument,
  type DocumentTemplate,
} from '@/lib/api';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onGenerated: (doc: AgencyDocument) => void;
}

export function GenerateForAnyClientModal({ open, onOpenChange, onGenerated }: Props) {
  const [clients, setClients] = useState<AgencyClient[]>([]);
  const [templates, setTemplates] = useState<DocumentTemplate[]>([]);
  const [clientId, setClientId] = useState<number | ''>('');
  const [kind, setKind] = useState<string>('');
  const [filter, setFilter] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setError(null);
    Promise.all([agencyListClients(), agencyListDocumentTemplates()])
      .then(([cs, ts]) => {
        setClients(cs);
        setTemplates(ts);
      })
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load'));
  }, [open]);

  const filteredClients = clients.filter(
    (c) =>
      !filter ||
      c.name.toLowerCase().includes(filter.toLowerCase()) ||
      c.slug.toLowerCase().includes(filter.toLowerCase()),
  );

  const submit = async () => {
    if (clientId === '' || !kind) return;
    setBusy(true);
    setError(null);
    try {
      const doc = await agencyGenerateDocument(clientId, kind);
      onGenerated(doc);
      onOpenChange(false);
      setClientId('');
      setKind('');
      setFilter('');
    } catch (e) {
      const status = (e as { response?: { status?: number } })?.response?.status;
      if (status === 503) {
        setError('LLM unavailable. Check that ANTHROPIC_API_KEY is set on the backend.');
      } else {
        setError(e instanceof Error ? e.message : 'Generation failed');
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/60" />
        <Dialog.Content className="fixed left-1/2 top-1/2 w-[min(90vw,560px)] -translate-x-1/2 -translate-y-1/2 rounded-lg border border-[var(--border-default)] bg-[var(--bg-raised)] text-[var(--text-primary)] shadow-lg">
          <div className="flex items-start justify-between border-b border-[var(--border-subtle)] p-5">
            <Dialog.Title className="text-base font-semibold">Generate document</Dialog.Title>
            <Dialog.Close asChild>
              <button className="rounded-md border border-[var(--border-default)] p-2 hover:bg-[var(--bg-card)]">
                <X className="h-4 w-4" />
              </button>
            </Dialog.Close>
          </div>

          <div className="space-y-4 p-5">
            <div>
              <label className="mb-1 block text-xs text-[var(--text-secondary)]">Client</label>
              <input
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                placeholder="Search clients…"
                className="mb-2 w-full rounded-md border border-[var(--border-default)] bg-[var(--bg-card)] px-3 py-2 text-sm"
              />
              <select
                value={clientId}
                onChange={(e) => setClientId(e.target.value === '' ? '' : parseInt(e.target.value, 10))}
                className="w-full rounded-md border border-[var(--border-default)] bg-[var(--bg-card)] px-3 py-2 text-sm"
              >
                <option value="">Pick a client…</option>
                {filteredClients.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} ({c.status})
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="mb-1 block text-xs text-[var(--text-secondary)]">Template</label>
              <select
                value={kind}
                onChange={(e) => setKind(e.target.value)}
                className="w-full rounded-md border border-[var(--border-default)] bg-[var(--bg-card)] px-3 py-2 text-sm"
              >
                <option value="">Pick a template…</option>
                {templates.map((t) => (
                  <option key={t.kind} value={t.kind}>
                    {t.name} — {t.description}
                  </option>
                ))}
              </select>
            </div>

            {error && <p className="text-sm text-red-400">{error}</p>}
          </div>

          <div className="flex items-center justify-end gap-2 border-t border-[var(--border-subtle)] p-4">
            <Dialog.Close asChild>
              <button className="rounded-md border border-[var(--border-default)] px-3 py-1.5 text-xs text-[var(--text-secondary)]">
                Cancel
              </button>
            </Dialog.Close>
            <button
              onClick={submit}
              disabled={busy || clientId === '' || !kind}
              className="flex items-center gap-2 rounded-md bg-[var(--bg-elevated)] px-3 py-1.5 text-xs font-medium text-[var(--text-primary)] hover:bg-[var(--bg-card)] disabled:opacity-50"
            >
              {busy && <Loader2 className="h-3 w-3 animate-spin" />}
              {busy ? 'Generating…' : 'Generate'}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
