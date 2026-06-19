'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Plus, Sparkles, Trash2, X } from 'lucide-react';

import { createProspectAudit, suggestProspectPrompts } from '@/lib/api';

interface PromptRow {
  id: number;
  text: string;
  selected: boolean;
}

const MAX_PROMPTS = 15;

export function NewProspectForm() {
  const router = useRouter();
  const [businessName, setBusinessName] = useState('');
  const [websiteUrl, setWebsiteUrl] = useState('');
  const [isLocal, setIsLocal] = useState(false);
  const [location, setLocation] = useState('');

  const [step, setStep] = useState<'details' | 'prompts'>('details');
  const [prompts, setPrompts] = useState<PromptRow[]>([]);
  const nextId = useRef(0);

  const [suggesting, setSuggesting] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const detailsValid =
    businessName.trim().length > 0 &&
    websiteUrl.trim().length > 0 &&
    (!isLocal || location.trim().length > 0);

  const selectedCount = prompts.filter((p) => p.selected && p.text.trim().length > 0).length;

  function makeRows(texts: string[]): PromptRow[] {
    return texts.map((text) => ({ id: nextId.current++, text, selected: true }));
  }

  async function loadSuggestions() {
    if (!detailsValid || suggesting) return;
    setSuggesting(true);
    setError(null);
    try {
      const suggested = await suggestProspectPrompts({
        business_name: businessName.trim(),
        website_url: websiteUrl.trim(),
        is_local: isLocal,
        location: isLocal ? location.trim() : null,
      });
      setPrompts(makeRows(suggested));
      setStep('prompts');
    } catch (e: unknown) {
      setError(extractMessage(e, 'Failed to generate prompt suggestions.'));
    } finally {
      setSuggesting(false);
    }
  }

  function updatePrompt(id: number, patch: Partial<PromptRow>) {
    setPrompts((rows) => rows.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  }

  function removePrompt(id: number) {
    setPrompts((rows) => rows.filter((r) => r.id !== id));
  }

  function addPrompt() {
    if (prompts.length >= MAX_PROMPTS) return;
    setPrompts((rows) => [...rows, { id: nextId.current++, text: '', selected: true }]);
  }

  async function handleGenerate() {
    const chosen = prompts.filter((p) => p.selected).map((p) => p.text.trim()).filter(Boolean);
    if (chosen.length === 0 || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const audit = await createProspectAudit({
        business_name: businessName.trim(),
        website_url: websiteUrl.trim(),
        is_local: isLocal,
        location: isLocal ? location.trim() : null,
        prompts: chosen,
      });
      router.push(`/agency/prospects/${audit.id}`);
    } catch (e: unknown) {
      setError(extractMessage(e, 'Failed to create audit.'));
      setSubmitting(false);
    }
  }

  // ── Step 1: business details ────────────────────────────────────────────────
  if (step === 'details') {
    return (
      <form
        onSubmit={(e) => {
          e.preventDefault();
          loadSuggestions();
        }}
        className="space-y-5"
      >
        <div>
          <label className="block text-sm font-medium text-[var(--text-primary)]">Business name</label>
          <input
            type="text"
            required
            value={businessName}
            onChange={(e) => setBusinessName(e.target.value)}
            placeholder="Acme Dental"
            className="mt-1 w-full rounded-md border border-[var(--border-subtle)] bg-[var(--bg-card)] px-3 py-2 text-sm text-[var(--text-primary)] outline-none focus:border-[var(--accent)]"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-[var(--text-primary)]">Website URL</label>
          <input
            type="url"
            required
            value={websiteUrl}
            onChange={(e) => setWebsiteUrl(e.target.value)}
            placeholder="https://acmedental.com"
            className="mt-1 w-full rounded-md border border-[var(--border-subtle)] bg-[var(--bg-card)] px-3 py-2 text-sm text-[var(--text-primary)] outline-none focus:border-[var(--accent)]"
          />
        </div>

        <div className="flex items-center gap-2">
          <input
            id="is_local"
            type="checkbox"
            checked={isLocal}
            onChange={(e) => setIsLocal(e.target.checked)}
            className="h-4 w-4 rounded border-[var(--border-subtle)] bg-[var(--bg-card)]"
          />
          <label htmlFor="is_local" className="text-sm text-[var(--text-primary)]">
            This is a local business
          </label>
        </div>

        {isLocal && (
          <div>
            <label className="block text-sm font-medium text-[var(--text-primary)]">Location</label>
            <input
              type="text"
              required={isLocal}
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              placeholder="Austin, TX"
              className="mt-1 w-full rounded-md border border-[var(--border-subtle)] bg-[var(--bg-card)] px-3 py-2 text-sm text-[var(--text-primary)] outline-none focus:border-[var(--accent)]"
            />
            <p className="mt-1 text-xs text-[var(--text-muted)]">
              City + state/region. Every generated prompt will reference this location.
            </p>
          </div>
        )}

        {error && (
          <div className="rounded-md border border-rose-500/30 bg-rose-500/10 p-3 text-sm text-rose-300">
            {error}
          </div>
        )}

        <button
          type="submit"
          disabled={!detailsValid || suggesting}
          className="flex w-full items-center justify-center gap-2 rounded-md bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white hover:bg-[var(--accent-hover)] disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Sparkles className="h-4 w-4" />
          {suggesting ? 'Generating prompts…' : 'Generate suggested prompts'}
        </button>
        <p className="text-center text-xs text-[var(--text-muted)]">
          You&apos;ll review and pick the prompts before the audit runs.
        </p>
      </form>
    );
  }

  // ── Step 2: review & select prompts ─────────────────────────────────────────
  return (
    <div className="space-y-5">
      <div className="rounded-md border border-[var(--border-subtle)] bg-[var(--bg-card)] px-3 py-2 text-sm text-[var(--text-secondary)]">
        <span className="font-medium text-[var(--text-primary)]">{businessName.trim()}</span>
        {' · '}
        {websiteUrl.trim()}
        {isLocal && location.trim() ? ` · ${location.trim()}` : ''}
        <button
          type="button"
          onClick={() => {
            setStep('details');
            setError(null);
          }}
          className="ml-2 text-xs text-[var(--accent)] hover:underline"
        >
          Edit
        </button>
      </div>

      <div>
        <div className="flex items-baseline justify-between">
          <label className="block text-sm font-medium text-[var(--text-primary)]">Audit prompts</label>
          <span className="text-xs text-[var(--text-muted)]">{selectedCount} selected</span>
        </div>
        <p className="mt-1 text-xs text-[var(--text-muted)]">
          Deselect, edit, or add prompts. Only checked prompts are used for the audit.
        </p>

        <ul className="mt-3 space-y-2">
          {prompts.map((row) => (
            <li
              key={row.id}
              className="flex items-center gap-2 rounded-md border border-[var(--border-subtle)] bg-[var(--bg-card)] px-2 py-1.5"
            >
              <input
                type="checkbox"
                checked={row.selected}
                onChange={(e) => updatePrompt(row.id, { selected: e.target.checked })}
                className="h-4 w-4 shrink-0 rounded border-[var(--border-subtle)] bg-[var(--bg-card)]"
              />
              <input
                type="text"
                value={row.text}
                onChange={(e) => updatePrompt(row.id, { text: e.target.value })}
                placeholder="Type a prompt…"
                className={`flex-1 bg-transparent text-sm text-[var(--text-primary)] outline-none ${
                  row.selected ? '' : 'opacity-50'
                }`}
              />
              <button
                type="button"
                onClick={() => removePrompt(row.id)}
                aria-label="Remove prompt"
                className="shrink-0 text-[var(--text-muted)] hover:text-rose-400"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </li>
          ))}
        </ul>

        {prompts.length < MAX_PROMPTS && (
          <button
            type="button"
            onClick={addPrompt}
            className="mt-2 inline-flex items-center gap-1 text-sm text-[var(--accent)] hover:underline"
          >
            <Plus className="h-4 w-4" />
            Add prompt
          </button>
        )}
      </div>

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={loadSuggestions}
          disabled={suggesting}
          className="inline-flex items-center gap-1 text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)] disabled:opacity-50"
        >
          {suggesting ? (
            'Regenerating…'
          ) : (
            <>
              <X className="h-4 w-4" />
              Regenerate suggestions
            </>
          )}
        </button>
      </div>

      {error && (
        <div className="rounded-md border border-rose-500/30 bg-rose-500/10 p-3 text-sm text-rose-300">
          {error}
        </div>
      )}

      <button
        type="button"
        onClick={handleGenerate}
        disabled={selectedCount === 0 || submitting}
        className="w-full rounded-md bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white hover:bg-[var(--accent-hover)] disabled:cursor-not-allowed disabled:opacity-50"
      >
        {submitting ? 'Creating…' : `Generate audit (${selectedCount} prompt${selectedCount === 1 ? '' : 's'})`}
      </button>
    </div>
  );
}

function extractMessage(e: unknown, fallback: string): string {
  if (e && typeof e === 'object' && 'message' in e) {
    return String((e as { message: unknown }).message);
  }
  return fallback;
}
