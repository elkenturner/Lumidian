'use client';

import { useState } from 'react';
import { Plus, Loader2, Sparkles, Trash2, MessageSquare, Pencil, Check, X } from 'lucide-react';
import {
  addPrompt,
  deletePrompt,
  getSuggestedPrompts,
  updatePrompt,
  inferBrandScope,
  getBrandProfile,
  updateBrandProfile,
  Prompt,
} from '@/lib/api';
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
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editText, setEditText] = useState('');
  const [savingEdit, setSavingEdit] = useState(false);
  const [scopeStep, setScopeStep] = useState<'idle' | 'inferring' | 'confirming'>('idle');
  const [confirmLoading, setConfirmLoading] = useState(false);
  const [scopeValue, setScopeValue] = useState<'local' | 'national' | 'global' | 'niche'>('national');
  const [geographyValue, setGeographyValue] = useState('');
  const [scopeError, setScopeError] = useState('');

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

  function startEdit(p: Prompt) {
    setEditingId(p.id);
    setEditText(p.text);
    setAddError('');
  }

  function cancelEdit() {
    setEditingId(null);
    setEditText('');
  }

  async function saveEdit() {
    if (editingId == null || !editText.trim()) return;
    setSavingEdit(true);
    setAddError('');
    try {
      const updated = await updatePrompt(brandId, editingId, editText.trim());
      const next = localPrompts.map((p) => (p.id === updated.id ? updated : p));
      setLocalPrompts(next);
      onChanged(next);
      setEditingId(null);
      setEditText('');
    } catch (err: unknown) {
      const e = err as { response?: { data?: { detail?: string } } };
      setAddError(e?.response?.data?.detail || 'Failed to save prompt.');
    } finally {
      setSavingEdit(false);
    }
  }

  async function handleSuggest() {
    setSuggesting(true);
    setScopeError('');
    try {
      const profile = await getBrandProfile(brandId);
      if (profile.market_scope) {
        const s = await getSuggestedPrompts(brandId);
        setSuggestions(s);
        return;
      }
      // No scope set — infer, then confirm
      setScopeStep('inferring');
      const inferred = await inferBrandScope(brandId);
      setScopeValue(inferred.market_scope);
      setGeographyValue(inferred.geography ?? '');
      setScopeStep('confirming');
    } catch (err: unknown) {
      const e = err as { response?: { data?: { detail?: string } } };
      setScopeError(e?.response?.data?.detail || 'Could not generate suggestions.');
      setScopeStep('idle');
    } finally {
      setSuggesting(false);
    }
  }

  async function confirmScopeAndSuggest() {
    setConfirmLoading(true);
    setScopeError('');
    try {
      await updateBrandProfile(brandId, {
        market_scope: scopeValue,
        geography: geographyValue.trim() || null,
      });
      const s = await getSuggestedPrompts(brandId);
      setSuggestions(s);
      setScopeStep('idle');
    } catch (err: unknown) {
      const e = err as { response?: { data?: { detail?: string } } };
      setScopeError(e?.response?.data?.detail || 'Could not generate suggestions.');
    } finally {
      setConfirmLoading(false);
    }
  }

  return (
    <Dialog open={true} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg max-h-[80vh] flex flex-col">
        <DialogHeader className="shrink-0">
          <div className="flex items-center justify-between">
            <DialogTitle>Manage Prompts</DialogTitle>
            <span className={`text-xs font-medium tabular-nums font-mono ${atLimit && promptLimit < 99999 ? 'text-[var(--danger)]' : localPrompts.length >= promptLimit * 0.8 && promptLimit < 99999 ? 'text-[var(--warning)]' : 'text-[var(--text-faint)]'}`}>
              {promptLimit >= 99999 ? `${localPrompts.length} prompt${localPrompts.length !== 1 ? 's' : ''}` : `${localPrompts.length}/${promptLimit}`}
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
            localPrompts.map((p) => {
              const isEditing = editingId === p.id;
              const editable = !p.has_history && !locked;
              return (
                <div key={p.id} className="flex items-start gap-3 bg-[rgba(95,126,166,0.06)] border border-[rgba(95,126,166,0.12)] rounded-lg px-3 py-2.5">
                  {isEditing ? (
                    <input
                      type="text"
                      value={editText}
                      onChange={(e) => setEditText(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') saveEdit();
                        if (e.key === 'Escape') cancelEdit();
                      }}
                      autoFocus
                      className="flex-1 bg-transparent border-b border-[var(--accent)]/40 text-sm text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent)] py-0.5"
                    />
                  ) : (
                    <p className="text-sm text-[var(--text-secondary)] flex-1 leading-snug">{p.text}</p>
                  )}

                  {isEditing ? (
                    <>
                      <button
                        onClick={saveEdit}
                        disabled={savingEdit || !editText.trim()}
                        aria-label="Save prompt"
                        className="text-[var(--accent)] hover:text-[var(--accent-hover)] transition-colors shrink-0 disabled:opacity-40"
                      >
                        {savingEdit ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />}
                      </button>
                      <button
                        onClick={cancelEdit}
                        disabled={savingEdit}
                        aria-label="Cancel edit"
                        className="text-[var(--text-faint)] hover:text-[var(--text-secondary)] transition-colors shrink-0"
                      >
                        <X size={13} />
                      </button>
                    </>
                  ) : (
                    <>
                      {editable && (
                        <button
                          onClick={() => startEdit(p)}
                          aria-label="Edit prompt"
                          className="text-[var(--text-faint)] hover:text-[var(--accent)] transition-colors shrink-0"
                        >
                          <Pencil size={13} />
                        </button>
                      )}
                      <button
                        onClick={() => handleDelete(p.id)}
                        disabled={deletingId === p.id || locked}
                        aria-label="Delete prompt"
                        title={p.has_history ? 'Delete to remove tracking history.' : undefined}
                        className="text-[var(--text-faint)] hover:text-[var(--danger)] transition-colors shrink-0 disabled:opacity-40"
                      >
                        {deletingId === p.id ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />}
                      </button>
                    </>
                  )}
                </div>
              );
            })
          )}
        </div>

        {/* Scope confirmation chip */}
        {scopeStep === 'confirming' && (
          <div className="mb-4 p-3 rounded-lg border border-[var(--accent)]/30 bg-[var(--accent)]/5 shrink-0">
            <p className="text-xs text-[var(--text-secondary)] mb-2">
              Where does this brand actually compete? Suggestions will be scoped to match.
            </p>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <select
                value={scopeValue}
                onChange={(e) => setScopeValue(e.target.value as typeof scopeValue)}
                className="bg-[rgba(255,255,255,0.05)] border border-[var(--bg-tinted-hover)] text-[var(--text-primary)] rounded-md px-2 py-1.5 text-xs focus:outline-none focus:border-[var(--accent)]"
              >
                <option value="local">Local (city/region)</option>
                <option value="national">National (single country)</option>
                <option value="global">Global (multi-country)</option>
                <option value="niche">Niche (narrow B2B vertical)</option>
              </select>
              <input
                type="text"
                value={geographyValue}
                onChange={(e) => setGeographyValue(e.target.value)}
                placeholder={scopeValue === 'local' ? 'e.g. Portland, OR' : scopeValue === 'national' ? 'e.g. United States' : 'optional'}
                className="flex-1 bg-[rgba(255,255,255,0.05)] border border-[var(--bg-tinted-hover)] text-[var(--text-primary)] rounded-md px-2 py-1.5 text-xs placeholder:text-[var(--text-faint)] focus:outline-none focus:border-[var(--accent)]"
              />
              <button
                onClick={confirmScopeAndSuggest}
                disabled={confirmLoading}
                className="text-xs bg-[var(--accent)] hover:bg-[var(--accent-hover)] disabled:opacity-50 text-white rounded-md px-3 py-1.5 transition-colors shrink-0 inline-flex items-center gap-1.5"
              >
                {confirmLoading ? <Loader2 size={11} className="animate-spin" /> : null}
                Use & suggest
              </button>
            </div>
            {scopeError && (
              <p className="text-xs text-[var(--danger)] mt-2">{scopeError}</p>
            )}
          </div>
        )}

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
              className="flex-1 bg-[rgba(255,255,255,0.05)] border border-[var(--bg-tinted-hover)] text-[var(--text-primary)] rounded-lg px-3 py-2 text-sm placeholder:text-[var(--text-faint)] focus:outline-none focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--accent)]/50 disabled:opacity-40"
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
            disabled={suggesting || scopeStep === 'inferring' || locked}
            className="w-full flex items-center justify-center gap-1.5 text-xs text-[var(--text-muted)] hover:text-[var(--text-secondary)] border border-[var(--border-faint)] hover:border-[rgba(255,255,255,0.14)] rounded-lg py-2 transition-colors"
          >
            {suggesting || scopeStep === 'inferring' ? <Loader2 size={11} className="animate-spin" /> : <Sparkles size={11} />}
            {scopeStep === 'inferring'
              ? 'Detecting market scope...'
              : suggesting
              ? 'Generating suggestions...'
              : 'Suggest prompts with AI'}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
