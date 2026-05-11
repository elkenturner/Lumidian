'use client';

import { useState } from 'react';
import { agencyUpdateClient, type AgencyClient } from '@/lib/api';

interface Props {
  client: AgencyClient;
  onChange: (next: AgencyClient) => void;
}

const STATUSES: AgencyClient['status'][] = ['onboarding', 'active', 'paused', 'churned'];

export function ClientOverviewTab({ client, onChange }: Props) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const updateStatus = async (status: AgencyClient['status']) => {
    setSaving(true);
    setError(null);
    try {
      const next = await agencyUpdateClient(client.id, { status });
      onChange(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6 text-[var(--text-primary)]">
      <div>
        <h2 className="text-sm font-medium text-[var(--text-secondary)]">Status</h2>
        <div className="mt-2 flex gap-2">
          {STATUSES.map((s) => (
            <button
              key={s}
              onClick={() => updateStatus(s)}
              disabled={saving || client.status === s}
              className={`rounded-md border px-3 py-1.5 text-xs ${
                client.status === s
                  ? 'border-[var(--border-strong)] bg-[var(--bg-elevated)] text-[var(--text-primary)]'
                  : 'border-[var(--border-default)] bg-[var(--bg-card)] text-[var(--text-secondary)] hover:bg-[var(--bg-raised)]'
              }`}
            >
              {s}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-6">
        <div>
          <h2 className="mb-1 text-sm font-medium text-[var(--text-secondary)]">Retainer</h2>
          <p className="text-base">
            {client.retainer_amount_usd ? `$${client.retainer_amount_usd}/mo` : '—'}
          </p>
        </div>
        <div>
          <h2 className="mb-1 text-sm font-medium text-[var(--text-secondary)]">Started</h2>
          <p className="text-base">
            {client.retainer_started_at
              ? new Date(client.retainer_started_at).toLocaleDateString()
              : '—'}
          </p>
        </div>
        <div>
          <h2 className="mb-1 text-sm font-medium text-[var(--text-secondary)]">Primary contact</h2>
          <p className="text-base">
            {client.primary_contact_name || '—'}
            {client.primary_contact_email && (
              <span className="block text-sm text-[var(--text-muted)]">
                {client.primary_contact_email}
              </span>
            )}
          </p>
        </div>
        <div>
          <h2 className="mb-1 text-sm font-medium text-[var(--text-secondary)]">Peec dashboard</h2>
          {client.peec_dashboard_url ? (
            <a
              href={client.peec_dashboard_url}
              target="_blank"
              rel="noreferrer"
              className="text-sm underline"
            >
              Open
            </a>
          ) : (
            <p className="text-sm text-[var(--text-muted)]">Not set</p>
          )}
        </div>
      </div>

      {error && <p className="text-sm text-red-400">{error}</p>}
    </div>
  );
}
