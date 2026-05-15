'use client';

import { useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { CheckCircle2, Link as LinkIcon, X } from 'lucide-react';
import { agencyMarkDraftPosted, type ContentDraft } from '@/lib/api';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  draft: ContentDraft;
  onPosted: (draft: ContentDraft) => void;
}

export function MarkPostedModal({ open, onOpenChange, draft, onPosted }: Props) {
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (withUrl: boolean) => {
    setBusy(true);
    setError(null);
    try {
      const trimmed = withUrl ? url.trim() : '';
      const updated = await agencyMarkDraftPosted(draft.id, trimmed || undefined);
      onPosted(updated);
      onOpenChange(false);
      setUrl('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to mark as posted');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/60" />
        <Dialog.Content className="fixed left-1/2 top-1/2 w-[min(90vw,520px)] -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-lg border border-[var(--border-default)] bg-[var(--bg-raised)] text-[var(--text-primary)] shadow-lg">
          <div className="flex items-start justify-between border-b border-[var(--border-subtle)] p-5">
            <Dialog.Title className="text-base font-semibold">
              Where did you post this?
            </Dialog.Title>
            <Dialog.Close asChild>
              <button className="rounded-md border border-[var(--border-default)] p-2 hover:bg-[var(--bg-card)]">
                <X className="h-4 w-4" />
              </button>
            </Dialog.Close>
          </div>

          <div className="p-5">
            <p className="mb-3 text-xs text-[var(--text-muted)]">
              Paste the live URL of the published post. We use this for the activity log and
              attribution. You can skip if you don&apos;t have it handy.
            </p>

            <div className="flex items-center gap-2 rounded-md border border-[var(--border-default)] bg-[var(--bg-card)] px-3 py-2">
              <LinkIcon className="h-4 w-4 shrink-0 text-[var(--text-muted)]" />
              <input
                type="url"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder={`https://${draft.platform}.com/…`}
                autoFocus
                className="w-full bg-transparent text-sm outline-none placeholder:text-[var(--text-muted)]"
              />
            </div>

            {error && <p className="mt-3 text-xs text-red-400">{error}</p>}
          </div>

          <div className="flex items-center justify-end gap-2 border-t border-[var(--border-subtle)] p-4">
            <button
              onClick={() => submit(false)}
              disabled={busy}
              className="rounded-md border border-[var(--border-default)] px-3 py-1.5 text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-card)] disabled:opacity-50"
            >
              Skip URL
            </button>
            <button
              onClick={() => submit(true)}
              disabled={busy || !url.trim()}
              className="flex items-center gap-1 rounded-md bg-[var(--bg-elevated)] px-3 py-1.5 text-xs font-medium text-[var(--text-primary)] hover:bg-[var(--bg-card)] disabled:opacity-50"
            >
              <CheckCircle2 className="h-3 w-3" />
              {busy ? 'Saving…' : 'Mark as posted'}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
