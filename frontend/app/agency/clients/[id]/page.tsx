'use client';

import { use, useEffect, useState } from 'react';
import * as Tabs from '@radix-ui/react-tabs';
import Link from 'next/link';
import { agencyGetClient, type AgencyClient } from '@/lib/api';
import { ClientOverviewTab } from '@/components/agency/ClientOverviewTab';
import { ClientStrategyTab } from '@/components/agency/ClientStrategyTab';
import { ClientContentTab } from '@/components/agency/ClientContentTab';
import { ClientReportsTab } from '@/components/agency/ClientReportsTab';

const TABS: Array<[string, string]> = [
  ['overview', 'Overview'],
  ['strategy', 'Strategy'],
  ['content', 'Content'],
  ['reports', 'Reports'],
];

export default function AgencyClientDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const clientId = parseInt(id, 10);
  const [client, setClient] = useState<AgencyClient | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    agencyGetClient(clientId)
      .then(setClient)
      .catch((e) => setError(String(e?.message ?? e)));
  }, [clientId]);

  if (error) return <div className="p-8 text-sm text-red-400">{error}</div>;
  if (!client) {
    return <div className="p-8 text-sm text-[var(--text-muted)]">Loading…</div>;
  }

  return (
    <div className="p-8 text-[var(--text-primary)]">
      <Link href="/agency/clients" className="text-xs text-[var(--text-muted)] hover:underline">
        ← All clients
      </Link>
      <h1 className="mt-2 text-2xl font-semibold tracking-tight">{client.name}</h1>
      <p className="mb-6 text-sm text-[var(--text-muted)]">/{client.slug}</p>

      <Tabs.Root defaultValue="overview" className="w-full">
        <Tabs.List className="mb-6 flex gap-1 border-b border-[var(--border-subtle)]">
          {TABS.map(([value, label]) => (
            <Tabs.Trigger
              key={value}
              value={value}
              className="border-b-2 border-transparent px-4 py-2 text-sm text-[var(--text-muted)] data-[state=active]:border-[var(--text-primary)] data-[state=active]:text-[var(--text-primary)]"
            >
              {label}
            </Tabs.Trigger>
          ))}
        </Tabs.List>

        <Tabs.Content value="overview">
          <ClientOverviewTab client={client} onChange={setClient} />
        </Tabs.Content>
        <Tabs.Content value="strategy">
          <ClientStrategyTab brandId={client.brand_id} />
        </Tabs.Content>
        <Tabs.Content value="content">
          <ClientContentTab brandId={client.brand_id} />
        </Tabs.Content>
        <Tabs.Content value="reports">
          <ClientReportsTab brandId={client.brand_id} />
        </Tabs.Content>
      </Tabs.Root>
    </div>
  );
}
