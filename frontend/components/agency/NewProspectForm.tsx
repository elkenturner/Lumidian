'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

import { createProspectAudit } from '@/lib/api';

export function NewProspectForm() {
  const router = useRouter();
  const [businessName, setBusinessName] = useState('');
  const [websiteUrl, setWebsiteUrl] = useState('');
  const [isLocal, setIsLocal] = useState(false);
  const [location, setLocation] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSubmit =
    businessName.trim().length > 0 &&
    websiteUrl.trim().length > 0 &&
    (!isLocal || location.trim().length > 0);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const audit = await createProspectAudit({
        business_name: businessName.trim(),
        website_url: websiteUrl.trim(),
        is_local: isLocal,
        location: isLocal ? location.trim() : null,
      });
      router.push(`/agency/prospects/${audit.id}`);
    } catch (e: unknown) {
      const msg = e && typeof e === 'object' && 'message' in e ? String((e as { message: unknown }).message) : 'Failed to create audit.';
      setError(msg);
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
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
        disabled={!canSubmit || submitting}
        className="w-full rounded-md bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white hover:bg-[var(--accent-hover)] disabled:cursor-not-allowed disabled:opacity-50"
      >
        {submitting ? 'Creating…' : 'Generate audit'}
      </button>
    </form>
  );
}
