'use client';

import { useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { agencyCreateClient, type AgencyClient } from '@/lib/api';

interface Props {
  onCreated: (client: AgencyClient) => void;
}

export function NewClientDialog({ onCreated }: Props) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [contactName, setContactName] = useState('');
  const [contactEmail, setContactEmail] = useState('');
  const [retainer, setRetainer] = useState('');
  const [peecUrl, setPeecUrl] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reset = () => {
    setName('');
    setContactName('');
    setContactEmail('');
    setRetainer('');
    setPeecUrl('');
    setError(null);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setError('Name is required.');
      return;
    }
    setSubmitting(true);
    try {
      const created = await agencyCreateClient({
        name: name.trim(),
        primary_contact_name: contactName.trim() || undefined,
        primary_contact_email: contactEmail.trim() || undefined,
        retainer_amount_usd: retainer ? parseInt(retainer, 10) : undefined,
        peec_dashboard_url: peecUrl.trim() || undefined,
      });
      onCreated(created);
      setOpen(false);
      reset();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create client.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger asChild>
        <button className="rounded-md bg-[var(--bg-elevated)] px-4 py-2 text-sm font-medium text-[var(--text-primary)] hover:bg-[var(--bg-card)]">
          New client
        </button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/60" />
        <Dialog.Content className="fixed left-1/2 top-1/2 w-full max-w-md -translate-x-1/2 -translate-y-1/2 rounded-lg border border-[var(--border-default)] bg-[var(--bg-raised)] p-6 shadow-lg text-[var(--text-primary)]">
          <Dialog.Title className="text-lg font-semibold">New client</Dialog.Title>
          <Dialog.Description className="mb-4 text-sm text-[var(--text-muted)]">
            Creates an agency client and a linked brand record.
          </Dialog.Description>

          <form onSubmit={submit} className="space-y-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-[var(--text-secondary)]">Name</label>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full rounded-md border border-[var(--border-default)] bg-[var(--bg-card)] px-3 py-2 text-sm text-[var(--text-primary)]"
                placeholder="Acme Co"
                autoFocus
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1 block text-xs font-medium text-[var(--text-secondary)]">Contact name</label>
                <input
                  value={contactName}
                  onChange={(e) => setContactName(e.target.value)}
                  className="w-full rounded-md border border-[var(--border-default)] bg-[var(--bg-card)] px-3 py-2 text-sm text-[var(--text-primary)]"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-[var(--text-secondary)]">Contact email</label>
                <input
                  type="email"
                  value={contactEmail}
                  onChange={(e) => setContactEmail(e.target.value)}
                  className="w-full rounded-md border border-[var(--border-default)] bg-[var(--bg-card)] px-3 py-2 text-sm text-[var(--text-primary)]"
                />
              </div>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-[var(--text-secondary)]">Retainer (USD/mo)</label>
              <input
                type="number"
                value={retainer}
                onChange={(e) => setRetainer(e.target.value)}
                className="w-full rounded-md border border-[var(--border-default)] bg-[var(--bg-card)] px-3 py-2 text-sm text-[var(--text-primary)]"
                placeholder="3000"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-[var(--text-secondary)]">Peec dashboard URL</label>
              <input
                type="url"
                value={peecUrl}
                onChange={(e) => setPeecUrl(e.target.value)}
                className="w-full rounded-md border border-[var(--border-default)] bg-[var(--bg-card)] px-3 py-2 text-sm text-[var(--text-primary)]"
                placeholder="https://peec.ai/..."
              />
            </div>

            {error && <p className="text-sm text-red-400">{error}</p>}

            <div className="flex justify-end gap-2 pt-2">
              <Dialog.Close asChild>
                <button
                  type="button"
                  className="rounded-md border border-[var(--border-default)] px-4 py-2 text-sm text-[var(--text-secondary)]"
                >
                  Cancel
                </button>
              </Dialog.Close>
              <button
                type="submit"
                disabled={submitting}
                className="rounded-md bg-[var(--bg-elevated)] px-4 py-2 text-sm font-medium text-[var(--text-primary)] hover:bg-[var(--bg-card)] disabled:opacity-50"
              >
                {submitting ? 'Creating…' : 'Create client'}
              </button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
