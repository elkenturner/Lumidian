'use client';

import { useState } from 'react';
import { api, type AgencyClientOut } from '@/lib/api';

interface Props {
  client: AgencyClientOut;
  onChange: (next: AgencyClientOut) => void;
}

const STATUSES: AgencyClientOut['status'][] = ['onboarding', 'active', 'paused', 'churned'];

export function ClientOverviewTab({ client, onChange }: Props) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const updateStatus = async (status: AgencyClientOut['status']) => {
    setSaving(true);
    setError(null);
    try {
      const next = await api.updateClient(client.id, { status });
      onChange(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-sm font-medium text-muted-foreground">Status</h2>
        <div className="mt-2 flex gap-2">
          {STATUSES.map((s) => (
            <button
              key={s}
              onClick={() => updateStatus(s)}
              disabled={saving || client.status === s}
              className={`rounded-md border px-3 py-1.5 text-xs ${
                client.status === s
                  ? 'border-primary bg-primary text-primary-foreground'
                  : 'border-border bg-white hover:bg-muted'
              }`}
            >
              {s}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-6">
        <div>
          <h2 className="mb-1 text-sm font-medium text-muted-foreground">Retainer</h2>
          <p className="text-base">
            {client.retainer_amount_usd ? `$${client.retainer_amount_usd}/mo` : '—'}
          </p>
        </div>
        <div>
          <h2 className="mb-1 text-sm font-medium text-muted-foreground">Started</h2>
          <p className="text-base">
            {client.retainer_started_at
              ? new Date(client.retainer_started_at).toLocaleDateString()
              : '—'}
          </p>
        </div>
        <div>
          <h2 className="mb-1 text-sm font-medium text-muted-foreground">Primary contact</h2>
          <p className="text-base">
            {client.primary_contact_name || '—'}
            {client.primary_contact_email && (
              <span className="block text-sm text-muted-foreground">
                {client.primary_contact_email}
              </span>
            )}
          </p>
        </div>
        <div>
          <h2 className="mb-1 text-sm font-medium text-muted-foreground">Peec dashboard</h2>
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
            <p className="text-sm text-muted-foreground">Not set</p>
          )}
        </div>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}
    </div>
  );
}
