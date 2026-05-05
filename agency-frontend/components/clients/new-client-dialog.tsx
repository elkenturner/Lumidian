'use client';

import { useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { api, type AgencyClientOut } from '@/lib/api';

interface Props {
  onCreated: (client: AgencyClientOut) => void;
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
      const created = await api.createClient({
        name: name.trim(),
        primary_contact_name: contactName.trim() || undefined,
        primary_contact_email: contactEmail.trim() || undefined,
        retainer_amount_usd: retainer ? parseInt(retainer, 10) : undefined,
        peec_dashboard_url: peecUrl.trim() || undefined,
      });
      onCreated(created);
      setOpen(false);
      reset();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to create client.';
      setError(msg);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger asChild>
        <button className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90">
          New client
        </button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/40" />
        <Dialog.Content className="fixed left-1/2 top-1/2 w-full max-w-md -translate-x-1/2 -translate-y-1/2 rounded-lg border border-border bg-white p-6 shadow-lg">
          <Dialog.Title className="text-lg font-semibold">New client</Dialog.Title>
          <Dialog.Description className="mb-4 text-sm text-muted-foreground">
            Creates an agency client and a linked brand record.
          </Dialog.Description>

          <form onSubmit={submit} className="space-y-3">
            <div>
              <label className="mb-1 block text-xs font-medium">Name</label>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full rounded-md border border-border px-3 py-2 text-sm"
                placeholder="Acme Co"
                autoFocus
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1 block text-xs font-medium">Contact name</label>
                <input
                  value={contactName}
                  onChange={(e) => setContactName(e.target.value)}
                  className="w-full rounded-md border border-border px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium">Contact email</label>
                <input
                  type="email"
                  value={contactEmail}
                  onChange={(e) => setContactEmail(e.target.value)}
                  className="w-full rounded-md border border-border px-3 py-2 text-sm"
                />
              </div>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium">Retainer (USD/mo)</label>
              <input
                type="number"
                value={retainer}
                onChange={(e) => setRetainer(e.target.value)}
                className="w-full rounded-md border border-border px-3 py-2 text-sm"
                placeholder="3000"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium">Peec dashboard URL</label>
              <input
                type="url"
                value={peecUrl}
                onChange={(e) => setPeecUrl(e.target.value)}
                className="w-full rounded-md border border-border px-3 py-2 text-sm"
                placeholder="https://peec.ai/..."
              />
            </div>

            {error && <p className="text-sm text-red-600">{error}</p>}

            <div className="flex justify-end gap-2 pt-2">
              <Dialog.Close asChild>
                <button type="button" className="rounded-md border border-border px-4 py-2 text-sm">
                  Cancel
                </button>
              </Dialog.Close>
              <button
                type="submit"
                disabled={submitting}
                className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
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
