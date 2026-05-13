'use client';

import { useState } from 'react';
import Link from 'next/link';
import {
  agencyUpdateClient,
  type AgencyClient,
  type AgencyDocument,
} from '@/lib/api';
import { ActivityFeed } from './ActivityFeed';
import { ClientBrandTab } from './ClientBrandTab';
import { ClientPipelineTab } from './ClientPipelineTab';
import { ClientQuickActionsRail } from './ClientQuickActionsRail';
import { DocumentList } from './DocumentList';
import { LumidianTrackingWidget } from './LumidianTrackingWidget';
import { TaskList } from './TaskList';

interface Props {
  client: AgencyClient;
  onChange: (next: AgencyClient) => void;
  reviewLinkUrl: string | null;
}

const STATUSES: AgencyClient['status'][] = ['onboarding', 'active', 'paused', 'churned'];

const SECTIONS = [
  { id: 'tracking', label: 'Tracking' },
  { id: 'pipeline', label: 'Pipeline' },
  { id: 'brand', label: 'Brand' },
  { id: 'documents', label: 'Documents' },
  { id: 'tasks', label: 'Tasks' },
  { id: 'activity', label: 'Activity' },
];

export function ClientCockpit({ client, onChange, reviewLinkUrl }: Props) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [justGeneratedDoc, setJustGeneratedDoc] = useState<AgencyDocument | null>(null);
  const [pipelineRefreshKey, setPipelineRefreshKey] = useState(0);

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
    <div className="p-8 text-[var(--text-primary)]">
      <Link href="/agency/clients" className="text-xs text-[var(--text-muted)] hover:underline">
        ← All clients
      </Link>
      <h1 className="mt-2 text-2xl font-semibold tracking-tight">{client.name}</h1>
      <p className="text-sm text-[var(--text-muted)]">/{client.slug}</p>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <span className="text-xs text-[var(--text-muted)]">Status:</span>
        {STATUSES.map((s) => (
          <button
            key={s}
            onClick={() => updateStatus(s)}
            disabled={saving || client.status === s}
            className={`rounded-md border px-3 py-1 text-xs ${
              client.status === s
                ? 'border-[var(--border-strong)] bg-[var(--bg-elevated)] text-[var(--text-primary)]'
                : 'border-[var(--border-default)] bg-[var(--bg-card)] text-[var(--text-secondary)] hover:bg-[var(--bg-raised)]'
            }`}
          >
            {s}
          </button>
        ))}
        <span className="ml-auto text-xs text-[var(--text-muted)]">
          {client.retainer_amount_usd ? `$${client.retainer_amount_usd}/mo` : 'No retainer'}
          {client.primary_contact_name && ` · ${client.primary_contact_name}`}
          {client.primary_contact_email && ` · ${client.primary_contact_email}`}
        </span>
      </div>

      {error && <p className="mt-3 text-sm text-red-400">{error}</p>}

      <nav className="mt-6 sticky top-0 z-10 -mx-8 border-y border-[var(--border-subtle)] bg-[var(--bg-base)] px-8 py-2">
        <ul className="flex gap-4 text-xs">
          {SECTIONS.map((s) => (
            <li key={s.id}>
              <a
                href={`#${s.id}`}
                className="text-[var(--text-muted)] hover:text-[var(--text-primary)]"
              >
                {s.label}
              </a>
            </li>
          ))}
        </ul>
      </nav>

      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-[1fr_320px]">
        <div className="space-y-8 min-w-0">
          <section id="tracking" className="scroll-mt-24">
            <h2 className="mb-3 text-sm font-medium text-[var(--text-secondary)]">Tracking</h2>
            <LumidianTrackingWidget brandId={client.brand_id} />
          </section>

          <section id="pipeline" className="scroll-mt-24">
            <h2 className="mb-3 text-sm font-medium text-[var(--text-secondary)]">Pipeline</h2>
            <ClientPipelineTab
              key={pipelineRefreshKey}
              brandId={client.brand_id}
              reviewLinkUrl={reviewLinkUrl}
              primaryContactName={client.primary_contact_name}
            />
          </section>

          <section id="brand" className="scroll-mt-24">
            <h2 className="mb-3 text-sm font-medium text-[var(--text-secondary)]">Brand & prompts</h2>
            <ClientBrandTab brandId={client.brand_id} />
          </section>

          <section id="documents" className="scroll-mt-24">
            <h2 className="mb-3 text-sm font-medium text-[var(--text-secondary)]">Documents</h2>
            <DocumentList clientId={client.id} injectDoc={justGeneratedDoc} />
          </section>

          <section id="tasks" className="scroll-mt-24">
            <TaskList clientId={client.id} />
          </section>

          <section id="activity" className="scroll-mt-24">
            <ActivityFeed clientId={client.id} />
          </section>
        </div>

        <ClientQuickActionsRail
          client={client}
          onDocumentGenerated={setJustGeneratedDoc}
          onDraftsSent={() => setPipelineRefreshKey((k) => k + 1)}
        />
      </div>
    </div>
  );
}
