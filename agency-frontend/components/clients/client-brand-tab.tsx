'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';

interface Props {
  brandId: number | null;
}

interface Prompt {
  id: number;
  text: string;
}

interface BrandDetail {
  id: number;
  name: string;
  prompts: Prompt[];
}

interface BrandProfile {
  company_description?: string | null;
  tone_of_voice?: string | null;
  internal_brand_context?: string | null;
  key_stats?: string[] | null;
  what_not_to_say?: string[] | null;
  approved_language?: string[] | null;
}

const linesToArray = (s: string): string[] =>
  s.split('\n').map((x) => x.trim()).filter(Boolean);

const arrayToLines = (xs: string[] | null | undefined): string =>
  Array.isArray(xs) ? xs.join('\n') : '';

export function ClientBrandTab({ brandId }: Props) {
  const [profile, setProfile] = useState<BrandProfile | null>(null);
  const [prompts, setPrompts] = useState<Prompt[]>([]);
  const [newPrompt, setNewPrompt] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (brandId == null) return;
    Promise.all([
      api.getBrandProfile(brandId).catch(() => ({})),
      api.getBrand(brandId).catch(() => ({ prompts: [] })),
    ])
      .then(([p, brand]) => {
        setProfile(p as BrandProfile);
        const b = brand as Partial<BrandDetail>;
        setPrompts((b.prompts ?? []) as Prompt[]);
      })
      .catch((e) => setError(String(e?.message ?? e)));
  }, [brandId]);

  if (brandId == null) {
    return <p className="text-sm text-muted-foreground">No brand attached to this client.</p>;
  }
  if (error) return <p className="text-sm text-red-600">{error}</p>;
  if (!profile) return <p className="text-sm text-muted-foreground">Loading…</p>;

  const saveProfile = async (patch: Record<string, unknown>) => {
    setSaving(true);
    try {
      const next = await api.updateBrandProfile(brandId, patch);
      setProfile(next as BrandProfile);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save profile.');
    } finally {
      setSaving(false);
    }
  };

  const addPrompt = async () => {
    if (!newPrompt.trim()) return;
    try {
      const created = (await api.addPrompt(brandId, newPrompt.trim())) as Prompt;
      setPrompts((prev) => [...prev, created]);
      setNewPrompt('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to add prompt.');
    }
  };

  const removePrompt = async (promptId: number) => {
    try {
      await api.deletePrompt(brandId, promptId);
      setPrompts((prev) => prev.filter((p) => p.id !== promptId));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to remove prompt.');
    }
  };

  const StringField = ({
    label,
    field,
    rows = 3,
  }: {
    label: string;
    field: 'company_description' | 'tone_of_voice' | 'internal_brand_context';
    rows?: number;
  }) => (
    <div>
      <label className="mb-1 block text-xs font-medium text-muted-foreground">{label}</label>
      <textarea
        defaultValue={profile[field] ?? ''}
        onBlur={(e) => {
          const next = e.target.value;
          if ((profile[field] ?? '') !== next) saveProfile({ [field]: next });
        }}
        rows={rows}
        className="w-full rounded-md border border-border px-3 py-2 text-sm"
      />
    </div>
  );

  const ListField = ({
    label,
    field,
    rows = 3,
  }: {
    label: string;
    field: 'key_stats' | 'what_not_to_say' | 'approved_language';
    rows?: number;
  }) => (
    <div>
      <label className="mb-1 block text-xs font-medium text-muted-foreground">
        {label} <span className="text-muted-foreground">(one per line)</span>
      </label>
      <textarea
        defaultValue={arrayToLines(profile[field])}
        onBlur={(e) => {
          const next = linesToArray(e.target.value);
          const prev = profile[field] ?? [];
          if (JSON.stringify(prev) !== JSON.stringify(next)) saveProfile({ [field]: next });
        }}
        rows={rows}
        className="w-full rounded-md border border-border px-3 py-2 text-sm"
      />
    </div>
  );

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
      <section className="space-y-3">
        <h3 className="text-sm font-medium">Brand profile</h3>
        <StringField label="Company description" field="company_description" rows={4} />
        <StringField label="Tone of voice" field="tone_of_voice" rows={2} />
        <ListField label="What not to say" field="what_not_to_say" rows={2} />
        <ListField label="Approved language" field="approved_language" rows={2} />
        <ListField label="Key stats" field="key_stats" rows={2} />
        <StringField label="Internal brand context" field="internal_brand_context" rows={4} />
        {saving && <p className="text-xs text-muted-foreground">Saving…</p>}
      </section>

      <section className="space-y-3">
        <h3 className="text-sm font-medium">Tracked prompts</h3>
        {prompts.length === 0 && (
          <p className="text-sm text-muted-foreground">No prompts yet.</p>
        )}
        <ul className="space-y-2">
          {prompts.map((p) => (
            <li
              key={p.id}
              className="flex items-start justify-between gap-3 rounded-md border border-border px-3 py-2 text-sm"
            >
              <span>{p.text}</span>
              <button
                onClick={() => removePrompt(p.id)}
                className="text-xs text-muted-foreground hover:text-red-600"
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
        <div className="flex gap-2">
          <input
            value={newPrompt}
            onChange={(e) => setNewPrompt(e.target.value)}
            placeholder="Add a prompt…"
            className="flex-1 rounded-md border border-border px-3 py-2 text-sm"
            onKeyDown={(e) => {
              if (e.key === 'Enter') addPrompt();
            }}
          />
          <button
            onClick={addPrompt}
            className="rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground"
          >
            Add
          </button>
        </div>
      </section>
    </div>
  );
}
