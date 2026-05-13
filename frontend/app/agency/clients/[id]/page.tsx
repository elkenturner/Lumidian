'use client';

import { use, useEffect, useState } from 'react';
import { agencyGetClient, agencyGetReviewLink, type AgencyClient } from '@/lib/api';
import { ClientCockpit } from '@/components/agency/ClientCockpit';

export default function AgencyClientDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const clientId = parseInt(id, 10);
  const [client, setClient] = useState<AgencyClient | null>(null);
  const [reviewLinkUrl, setReviewLinkUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    agencyGetClient(clientId).then(setClient).catch((e) => setError(String(e?.message ?? e)));
    agencyGetReviewLink(clientId)
      .then((link) => setReviewLinkUrl(link?.url ?? null))
      .catch(() => setReviewLinkUrl(null));
  }, [clientId]);

  if (error) return <div className="p-8 text-sm text-red-400">{error}</div>;
  if (!client) {
    return <div className="p-8 text-sm text-[var(--text-muted)]">Loading…</div>;
  }

  return <ClientCockpit client={client} onChange={setClient} reviewLinkUrl={reviewLinkUrl} />;
}
