'use client';

import { useEffect, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { Copy, Send, X } from 'lucide-react';
import {
  agencyGetReviewLink,
  agencyRotateReviewLink,
  agencyUpdateDraftStatus,
  getDrafts,
  type ContentDraft,
} from '@/lib/api';
import { sendDraftsMessageText } from './agency-helpers';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  clientId: number;
  clientName: string;
  brandId: number | null;
  primaryContactName: string | null;
  onSent: () => void; // caller may want to refresh pipeline
}

type SendableDraft = Omit<ContentDraft, 'status'> & { status: string };

export function SendDraftsToClientModal({
  open,
  onOpenChange,
  clientId,
  clientName,
  brandId,
  primaryContactName,
  onSent,
}: Props) {
  const [drafts, setDrafts] = useState<SendableDraft[]>([]);
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [stage, setStage] = useState<'pick' | 'message'>('pick');
  const [reviewUrl, setReviewUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!open || brandId == null) return;
    setLoading(true);
    setStage('pick');
    setError(null);
    setReviewUrl(null);
    getDrafts(brandId)
      .then((all) => {
        const sendable = (all as SendableDraft[]).filter(
          (d) => d.status === 'draft' || d.status === 'changes_requested',
        );
        setDrafts(sendable);
        setPicked(new Set(sendable.map((d) => d.id)));
      })
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load drafts'))
      .finally(() => setLoading(false));
  }, [open, brandId]);

  const toggle = (id: number) => {
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const submit = async () => {
    if (picked.size === 0) return;
    setSending(true);
    setError(null);
    try {
      for (const id of Array.from(picked)) {
        await agencyUpdateDraftStatus(id, 'awaiting_client');
      }
      let link = await agencyGetReviewLink(clientId);
      if (!link) {
        link = await agencyRotateReviewLink(clientId);
      }
      setReviewUrl(link.url);
      onSent();
      setStage('message');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to send drafts');
    } finally {
      setSending(false);
    }
  };

  const messageText = reviewUrl
    ? sendDraftsMessageText(primaryContactName, picked.size, reviewUrl)
    : '';

  const copyMessage = () => {
    navigator.clipboard.writeText(messageText);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/60" />
        <Dialog.Content className="fixed left-1/2 top-1/2 w-[min(90vw,640px)] max-h-[85vh] -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-lg border border-[var(--border-default)] bg-[var(--bg-raised)] text-[var(--text-primary)] shadow-lg">
          <div className="flex items-start justify-between border-b border-[var(--border-subtle)] p-5">
            <Dialog.Title className="text-base font-semibold">
              {stage === 'pick' ? `Send drafts to ${clientName} for review` : 'Drafts sent — now message your client'}
            </Dialog.Title>
            <Dialog.Close asChild>
              <button className="rounded-md border border-[var(--border-default)] p-2 hover:bg-[var(--bg-card)]">
                <X className="h-4 w-4" />
              </button>
            </Dialog.Close>
          </div>

          <div className="max-h-[60vh] overflow-y-auto p-5">
            {error && <p className="mb-3 text-sm text-red-400">{error}</p>}

            {stage === 'pick' && (
              <>
                {loading && <p className="text-sm text-[var(--text-muted)]">Loading drafts…</p>}
                {!loading && drafts.length === 0 && (
                  <p className="text-sm text-[var(--text-muted)]">
                    No drafts in &ldquo;Drafting&rdquo; status. Generate some content first.
                  </p>
                )}
                {!loading && drafts.length > 0 && (
                  <ul className="space-y-2">
                    {drafts.map((d) => (
                      <li
                        key={d.id}
                        className="flex items-start gap-3 rounded-md border border-[var(--border-subtle)] bg-[var(--bg-card)] p-3 text-sm"
                      >
                        <input
                          type="checkbox"
                          checked={picked.has(d.id)}
                          onChange={() => toggle(d.id)}
                          className="mt-1"
                        />
                        <div className="flex-1 min-w-0">
                          <div className="font-medium">{d.title || `Draft #${d.id}`}</div>
                          <div className="text-xs text-[var(--text-muted)]">
                            {d.platform} · {d.status === 'changes_requested' ? 'changes requested' : 'draft'}
                          </div>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </>
            )}

            {stage === 'message' && reviewUrl && (
              <div className="space-y-3">
                <p className="text-sm text-[var(--text-secondary)]">
                  {picked.size} draft{picked.size === 1 ? '' : 's'} moved to client review. Copy this
                  message and paste it into Slack / email:
                </p>
                <textarea
                  readOnly
                  value={messageText}
                  rows={9}
                  className="w-full rounded-md border border-[var(--border-default)] bg-[var(--bg-card)] p-3 font-mono text-xs text-[var(--text-primary)]"
                />
              </div>
            )}
          </div>

          <div className="flex items-center justify-end gap-2 border-t border-[var(--border-subtle)] p-4">
            {stage === 'pick' && (
              <>
                <Dialog.Close asChild>
                  <button className="rounded-md border border-[var(--border-default)] px-3 py-1.5 text-xs text-[var(--text-secondary)]">
                    Cancel
                  </button>
                </Dialog.Close>
                <button
                  onClick={submit}
                  disabled={sending || picked.size === 0}
                  className="flex items-center gap-2 rounded-md bg-[var(--bg-elevated)] px-3 py-1.5 text-xs font-medium text-[var(--text-primary)] hover:bg-[var(--bg-card)] disabled:opacity-50"
                >
                  <Send className="h-3 w-3" />
                  {sending ? 'Sending…' : `Send ${picked.size} draft${picked.size === 1 ? '' : 's'}`}
                </button>
              </>
            )}
            {stage === 'message' && (
              <>
                <a
                  href={reviewUrl ?? '#'}
                  target="_blank"
                  rel="noreferrer"
                  className="rounded-md border border-[var(--border-default)] px-3 py-1.5 text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-card)]"
                >
                  Open review page
                </a>
                <button
                  onClick={copyMessage}
                  className="flex items-center gap-1 rounded-md bg-[var(--bg-elevated)] px-3 py-1.5 text-xs font-medium text-[var(--text-primary)] hover:bg-[var(--bg-card)]"
                >
                  <Copy className="h-3 w-3" />
                  {copied ? 'Copied!' : 'Copy message'}
                </button>
                <Dialog.Close asChild>
                  <button className="rounded-md border border-[var(--border-default)] px-3 py-1.5 text-xs text-[var(--text-secondary)]">
                    Done
                  </button>
                </Dialog.Close>
              </>
            )}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
