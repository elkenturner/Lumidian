'use client';

import { useEffect, useState } from 'react';
import {
  addPrompt,
  deletePrompt,
  getBrand,
  getBrandProfile,
  updateBrandProfile,
  type AgencyClient,
  type BrandDetail,
  type BrandProfile,
} from '@/lib/api';
import ClientProposalForm from './ClientProposalForm';

interface Props {
  brandId: number | null;
  client?: AgencyClient;
}

const linesToArray = (s: string): string[] =>
  s.split('\n').map((x) => x.trim()).filter(Boolean);

const arrayToLines = (xs: string[] | null | undefined): string =>
  Array.isArray(xs) ? xs.join('\n') : '';

export function ClientBrandTab({ brandId, client }: Props) {
  const [profile, setProfile] = useState<BrandProfile | null>(null);
  const [brand, setBrand] = useState<BrandDetail | null>(null);
  const [newPrompt, setNewPrompt] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (brandId == null) return;
    Promise.all([
      getBrandProfile(brandId).catch(() => null),
      getBrand(brandId).catch(() => null),
    ])
      .then(([p, b]) => {
        setProfile(p);
        setBrand(b);
      })
      .catch((e) => setError(String(e?.message ?? e)));
  }, [brandId]);

  if (brandId == null) {
    return (
      <p className="text-sm text-[var(--text-muted)]">No brand attached to this client.</p>
    );
  }
  if (error) return <p className="text-sm text-red-400">{error}</p>;
  if (!profile || !brand) {
    return <p className="text-sm text-[var(--text-muted)]">Loading…</p>;
  }

  const saveProfile = async (patch: Partial<Parameters<typeof updateBrandProfile>[1]>) => {
    setSaving(true);
    try {
      const next = await updateBrandProfile(brandId, patch as Parameters<typeof updateBrandProfile>[1]);
      setProfile(next);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save profile.');
    } finally {
      setSaving(false);
    }
  };

  const handleAddPrompt = async () => {
    if (!newPrompt.trim()) return;
    try {
      const created = await addPrompt(brandId, newPrompt.trim());
      setBrand({ ...brand, prompts: [...brand.prompts, created] });
      setNewPrompt('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to add prompt.');
    }
  };

  const handleRemovePrompt = async (promptId: number) => {
    try {
      await deletePrompt(brandId, promptId);
      setBrand({ ...brand, prompts: brand.prompts.filter((p) => p.id !== promptId) });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to remove prompt.');
    }
  };

  const fieldClass =
    'w-full rounded-md border border-[var(--border-default)] bg-[var(--bg-card)] px-3 py-2 text-sm text-[var(--text-primary)]';

  return (
    <div className="space-y-6 text-[var(--text-primary)]">
      {client != null && (
        <ClientProposalForm
          clientId={client.id}
          initialDocUrl={client.current_proposal_doc_url ?? null}
          initialLabel={client.current_proposal_label ?? null}
        />
      )}
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
      <section className="space-y-3">
        <h3 className="text-sm font-medium">Brand profile</h3>

        <div>
          <label className="mb-1 block text-xs font-medium text-[var(--text-secondary)]">
            Company description
          </label>
          <textarea
            defaultValue={profile.company_description ?? ''}
            onBlur={(e) => {
              if ((profile.company_description ?? '') !== e.target.value) {
                saveProfile({ company_description: e.target.value });
              }
            }}
            rows={4}
            className={fieldClass}
          />
        </div>

        <div>
          <label className="mb-1 block text-xs font-medium text-[var(--text-secondary)]">
            Tone of voice
          </label>
          <textarea
            defaultValue={profile.tone_of_voice ?? ''}
            onBlur={(e) => {
              if ((profile.tone_of_voice ?? '') !== e.target.value) {
                saveProfile({ tone_of_voice: e.target.value });
              }
            }}
            rows={2}
            className={fieldClass}
          />
        </div>

        <div>
          <label className="mb-1 block text-xs font-medium text-[var(--text-secondary)]">
            What not to say <span className="text-[var(--text-muted)]">(one per line)</span>
          </label>
          <textarea
            defaultValue={arrayToLines(profile.what_not_to_say)}
            onBlur={(e) => {
              const next = linesToArray(e.target.value);
              if (JSON.stringify(profile.what_not_to_say ?? []) !== JSON.stringify(next)) {
                saveProfile({ what_not_to_say: next });
              }
            }}
            rows={2}
            className={fieldClass}
          />
        </div>

        <div>
          <label className="mb-1 block text-xs font-medium text-[var(--text-secondary)]">
            Approved language <span className="text-[var(--text-muted)]">(one per line)</span>
          </label>
          <textarea
            defaultValue={arrayToLines(profile.approved_language)}
            onBlur={(e) => {
              const next = linesToArray(e.target.value);
              if (JSON.stringify(profile.approved_language ?? []) !== JSON.stringify(next)) {
                saveProfile({ approved_language: next });
              }
            }}
            rows={2}
            className={fieldClass}
          />
        </div>

        <div>
          <label className="mb-1 block text-xs font-medium text-[var(--text-secondary)]">
            Key stats <span className="text-[var(--text-muted)]">(one per line)</span>
          </label>
          <textarea
            defaultValue={arrayToLines(profile.key_stats)}
            onBlur={(e) => {
              const next = linesToArray(e.target.value);
              if (JSON.stringify(profile.key_stats ?? []) !== JSON.stringify(next)) {
                saveProfile({ key_stats: next });
              }
            }}
            rows={2}
            className={fieldClass}
          />
        </div>

        {saving && (
          <p className="text-xs text-[var(--text-muted)]">Saving…</p>
        )}
      </section>

      <section className="space-y-3">
        <h3 className="text-sm font-medium">Tracked prompts</h3>
        {brand.prompts.length === 0 && (
          <p className="text-sm text-[var(--text-muted)]">No prompts yet.</p>
        )}
        <ul className="space-y-2">
          {brand.prompts.map((p) => (
            <li
              key={p.id}
              className="flex items-start justify-between gap-3 rounded-md border border-[var(--border-subtle)] bg-[var(--bg-card)] px-3 py-2 text-sm"
            >
              <span>{p.text}</span>
              <button
                onClick={() => handleRemovePrompt(p.id)}
                className="text-xs text-[var(--text-muted)] hover:text-red-400"
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
            className="flex-1 rounded-md border border-[var(--border-default)] bg-[var(--bg-card)] px-3 py-2 text-sm text-[var(--text-primary)]"
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleAddPrompt();
            }}
          />
          <button
            onClick={handleAddPrompt}
            className="rounded-md bg-[var(--bg-elevated)] px-3 py-2 text-sm font-medium text-[var(--text-primary)] hover:bg-[var(--bg-card)]"
          >
            Add
          </button>
        </div>
      </section>
    </div>
    </div>
  );
}
