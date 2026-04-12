'use client';

import { useState } from 'react';
import { Plus, Loader2, Sparkles, Trash2, MessageSquare } from 'lucide-react';
import { addPrompt, deletePrompt, getSuggestedPrompts, Prompt } from '@/lib/api';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';

export function ManagePromptsModal({
  brandId,
  brandName,
  prompts,
  promptLimit,
  isRunning = false,
  onClose,
  onChanged,
}: {
  brandId: number;
  brandName?: string;
  prompts: Prompt[];
  promptLimit: number;
  isRunning?: boolean;
  onClose: () => void;
  onChanged: (updated: Prompt[]) => void;
}) {
  const [localPrompts, setLocalPrompts] = useState(prompts);
  const [newText, setNewText] = useState('');
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState('');
  const [suggesting, setSuggesting] = useState(false);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [deletingId, setDeletingId] = useState<number | null>(null);

  const atLimit = localPrompts.length >= promptLimit;
  const locked = isRunning;

  async function handleAdd() {
    if (!newText.trim() || atLimit) return;
    setAdding(true);
    setAddError('');
    try {
      const p = await addPrompt(brandId, newText.trim());
      const updated = [...localPrompts, p];
      setLocalPrompts(updated);
      setNewText('');
      onChanged(updated);
    } catch (err: unknown) {
      const e = err as { response?: { data?: { detail?: string } } };
      setAddError(e?.response?.data?.detail || 'Failed to add prompt.');
    } finally {
      setAdding(false);
    }
  }

  async function handleDelete(promptId: number) {
    setDeletingId(promptId);
    try {
      await deletePrompt(brandId, promptId);
      const updated = localPrompts.filter((p) => p.id !== promptId);
      setLocalPrompts(updated);
      onChanged(updated);
    } catch (err: unknown) {
      const e = err as { response?: { data?: { detail?: string } } };
      setAddError(e?.response?.data?.detail || 'Failed to delete prompt.');
    } finally {
      setDeletingId(null);
    }
  }

  async function handleSuggest() {
    setSuggesting(true);
    try {
      const s = await getSuggestedPrompts(brandId);
      setSuggestions(s);
    } catch { /* ignore */ } finally {
      setSuggesting(false);
    }
  }

  return (
    <Dialog open={true} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg max-h-[80vh] flex flex-col">
        <DialogHeader className="shrink-0">
          <div className="flex items-center justify-between">
            <DialogTitle>Manage Prompts</DialogTitle>
            <span className={`text-xs font-medium tabular-nums font-mono ${atLimit && promptLimit < 99999 ? 'text-[var(--danger)]' : localPrompts.length >= promptLimit * 0.8 && promptLimit < 99999 ? 'text-[var(--warning)]' : 'text-[var(--text-faint)]'}`}>
              {promptLimit >= 99999 ? `${localPrompts.length} prompts` : `${localPrompts.length}/${promptLimit}`}
            </span>
          </div>
          <p className="text-xs text-[var(--text-muted)] mt-0.5">Add or remove the prompts AI models are queried with</p>
        </DialogHeader>

        {/* Current prompts */}
        <div className="flex-1 overflow-y-auto space-y-2 mb-4">
          {localPrompts.length === 0 ? (
            <div className="flex flex-col items-center py-6 text-center">
              <MessageSquare size={18} className="text-[var(--text-faint)] mb-2" />
              <p className="text-sm text-[var(--text-faint)]">No prompts yet</p>
              <p className="text-xs text-[var(--text-faint)] mt-0.5">Add your first prompt below</p>
            </div>
          ) : (
            localPrompts.map((p) => (
              <div key={p.id} className="flex items-start gap-3 bg-[rgba(95,126,166,0.06)] border border-[rgba(95,126,166,0.12)] rounded-lg px-3 py-2.5">
                <p className="text-sm text-[var(--text-secondary)] flex-1 leading-snug">{p.text}</p>
                <button
                  onClick={() => handleDelete(p.id)}
                  disabled={deletingId === p.id || locked}
                  aria-label="Delete prompt"
                  className="text-[var(--text-faint)] hover:text-[var(--danger)] transition-colors shrink-0 disabled:opacity-40"
                >
                  {deletingId === p.id ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />}
                </button>
              </div>
            ))
          )}
        </div>

        {/* Suggestions */}
        {suggestions.length > 0 && (
          <div className="mb-4 space-y-1.5 shrink-0">
            <p className="text-xs text-[var(--text-muted)] font-medium uppercase tracking-wide">Suggested prompts</p>
            {suggestions.map((s) => (
              <button
                key={s}
                onClick={() => { setNewText(s); setSuggestions([]); }}
                className="w-full text-left text-xs text-[var(--text-secondary)] bg-[rgba(95,126,166,0.06)] border border-[rgba(95,126,166,0.12)] hover:border-[rgba(95,126,166,0.25)] rounded-lg px-3 py-2 transition-colors"
              >
                {s}
              </button>
            ))}
          </div>
        )}

        {/* Add new */}
        <div className="shrink-0 space-y-2">
          {addError && (
            <p className="text-xs text-[var(--danger)]">{addError}</p>
          )}
          {locked && (
            <p className="text-xs text-[var(--warning)]">Prompts are locked while a report is running.</p>
          )}
          {atLimit && !locked && (
            <p className="text-xs text-[var(--warning)]">Prompt limit reached ({promptLimit}/{promptLimit}). Remove a prompt to add another.</p>
          )}
          <div className="flex gap-2">
            <input
              type="text"
              value={newText}
              onChange={(e) => setNewText(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
              placeholder={`e.g. What is the best ${brandName || 'product'} alternative?`}
              disabled={atLimit || locked}
              className="flex-1 bg-[rgba(255,255,255,0.05)] border border-[rgba(255,255,255,0.10)] text-[var(--text-primary)] rounded-lg px-3 py-2 text-sm placeholder:text-[var(--text-faint)] focus:outline-none focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--accent)]/50 disabled:opacity-40"
            />
            <button
              onClick={handleAdd}
              disabled={adding || !newText.trim() || atLimit || locked}
              className="flex items-center gap-1.5 text-xs bg-[var(--accent)] hover:bg-[var(--accent-hover)] disabled:opacity-50 text-white rounded-lg px-3 py-2 transition-colors shrink-0"
            >
              {adding ? <Loader2 size={11} className="animate-spin" /> : <Plus size={11} />}
              Add
            </button>
          </div>
          <button
            onClick={handleSuggest}
            disabled={suggesting || locked}
            className="w-full flex items-center justify-center gap-1.5 text-xs text-[var(--text-muted)] hover:text-[var(--text-secondary)] border border-[rgba(255,255,255,0.08)] hover:border-[rgba(255,255,255,0.14)] rounded-lg py-2 transition-colors"
          >
            {suggesting ? <Loader2 size={11} className="animate-spin" /> : <Sparkles size={11} />}
            {suggesting ? 'Generating suggestions...' : 'Suggest prompts with AI'}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
