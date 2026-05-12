'use client';

import { use, useEffect, useState } from 'react';
import Link from 'next/link';

import { agencyGetClient, type AgencyClient } from '@/lib/api';
import { SiteAuditView } from '@/components/site-audit/SiteAuditView';

export default function AgencyClientAuditPage({
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

  if (client.brand_id === null) {
    return (
      <div className="p-8 text-[var(--text-primary)]">
        <Link
          href={`/agency/clients/${clientId}`}
          className="text-xs text-[var(--text-muted)] hover:underline"
        >
          ← Back to client
        </Link>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">{client.name}</h1>
        <p className="mt-6 text-sm text-[var(--text-muted)]">
          This client has no brand linked yet. Link a brand from the Overview tab to run a site audit.
        </p>
      </div>
    );
  }

  return (
    <div className="text-[var(--text-primary)]">
      <div className="px-8 pt-6">
        <Link
          href={`/agency/clients/${clientId}`}
          className="text-xs text-[var(--text-muted)] hover:underline"
        >
          ← Back to {client.name}
        </Link>
      </div>
      <SiteAuditView brandId={client.brand_id} />
    </div>
  );
}
