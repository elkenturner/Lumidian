'use client';

import { useEffect, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { Loader2, Plus, X } from 'lucide-react';
import {
  agencyGenerateDraft,
  getBrand,
  type ContentDraft,
  type Prompt,
} from '@/lib/api';
import { useClientView } from '@/lib/client-view';

interface Props {
  clientId: number;
  brandId: number | null;
  onGenerated: (draft: ContentDraft) => void;
}

const PLATFORMS: Array<{ value: string; label: string }> = [
  { value: 'medium', label: 'Medium' },
  { value: 'linkedin_post', label: 'LinkedIn post' },
  { value: 'reddit_post', label: 'Reddit post' },
  { value: 'reddit_reply', label: 'Reddit reply' },
  { value: 'quora', label: 'Quora' },
  { value: 'x_post', label: 'X post' },
  { value: 'wikipedia', label: 'Wikipedia' },
];

export function GenerateDraftButton({ clientId, brandId, onGenerated }: Props) {
  // Defensive gate: suppress this write-action component when rendered inside
  // the /client/[token] portal shell. Portal pages don't import this today,
  // but this guard prevents future accidents. (Task 16 narrowed-scope audit.)
  const { isClientView } = useClientView();
  if (isClientView) return null;

  const [open, setOpen] = useState(false);
  const [prompts, setPrompts] = useState<Prompt[]>([]);
  const [promptId, setPromptId] = useState<number | ''>('');
  const [platform, setPlatform] = useState('medium');
  const [customBrief, setCustomBrief] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || brandId == null) return;
    setError(null);
    getBrand(brandId)
      .then((brand) => {
        setPrompts(brand.prompts ?? []);
        if (brand.prompts && brand.prompts.length > 0) {
          setPromptId(brand.prompts[0].id);
        }
      })
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load prompts'));
  }, [open, brandId]);

  const submit = async () => {
    if (promptId === '') return;
    setBusy(true);
    setError(null);
    try {
      const draft = await agencyGenerateDraft(clientId, {
        prompt_id: promptId,
        platform,
        custom_brief: customBrief.trim() || undefined,
      });
      onGenerated(draft);
      setOpen(false);
      setCustomBrief('');
    } catch (e) {
      const status = (e as { response?: { status?: number } })?.response?.status;
      if (status === 503) {
        setError('LLM unavailable. Check that ANTHROPIC_API_KEY is set on the backend.');
      } else {
        setError(e instanceof Error ? e.message : 'Draft generation failed');
      }
    } finally {
      setBusy(false);
    }
  };

  if (brandId == null) return null;

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger asChild>
        <button className="flex items-center gap-2 rounded-md bg-[var(--bg-elevated)] px-3 py-1.5 text-xs font-medium text-[var(--text-primary)] hover:bg-[var(--bg-card)]">
          <Plus className="h-3 w-3" />
          Generate draft
        </button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/60" />
        <Dialog.Content className="fixed left-1/2 top-1/2 w-[min(90vw,560px)] -translate-x-1/2 -translate-y-1/2 rounded-lg border border-[var(--border-default)] bg-[var(--bg-raised)] text-[var(--text-primary)] shadow-lg">
          <div className="flex items-start justify-between border-b border-[var(--border-subtle)] p-5">
            <Dialog.Title className="text-base font-semibold">Generate a draft</Dialog.Title>
            <Dialog.Close asChild>
              <button className="rounded-md border border-[var(--border-default)] p-2 hover:bg-[var(--bg-card)]">
                <X className="h-4 w-4" />
              </button>
            </Dialog.Close>
          </div>

          <div className="space-y-4 p-5">
            <div>
              <label className="mb-1 block text-xs text-[var(--text-secondary)]">Prompt</label>
              {prompts.length === 0 ? (
                <p className="text-sm text-[var(--text-muted)]">
                  No prompts on this brand yet. Add some on the Brand &amp; prompts section first.
                </p>
              ) : (
                <select
                  value={promptId}
                  onChange={(e) =>
                    setPromptId(e.target.value === '' ? '' : parseInt(e.target.value, 10))
                  }
                  className="w-full rounded-md border border-[var(--border-default)] bg-[var(--bg-card)] px-3 py-2 text-sm"
                >
                  {prompts.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.text}
                    </option>
                  ))}
                </select>
              )}
            </div>

            <div>
              <label className="mb-1 block text-xs text-[var(--text-secondary)]">Platform</label>
              <select
                value={platform}
                onChange={(e) => setPlatform(e.target.value)}
                className="w-full rounded-md border border-[var(--border-default)] bg-[var(--bg-card)] px-3 py-2 text-sm"
              >
                {PLATFORMS.map((p) => (
                  <option key={p.value} value={p.value}>
                    {p.label}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="mb-1 block text-xs text-[var(--text-secondary)]">
                Custom brief (optional)
              </label>
              <textarea
                value={customBrief}
                onChange={(e) => setCustomBrief(e.target.value)}
                rows={3}
                placeholder="Steering for this specific draft, e.g. 'focus on the pricing comparison'"
                className="w-full rounded-md border border-[var(--border-default)] bg-[var(--bg-card)] px-3 py-2 text-sm"
              />
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
              disabled={busy || promptId === ''}
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
