'use client';

import { useEffect, useState } from 'react';
import { siteAudit, type CitationsOverview } from '@/lib/api';
import { CitationStackedBar } from './CitationStackedBar';
import { CitationTopDomains } from './CitationTopDomains';
import { AuditHistoryList } from './AuditHistoryList';

interface Props {
  brandId: number;
}

export function CitationsTab({ brandId }: Props) {
  const [data, setData] = useState<CitationsOverview | null>(null);

  useEffect(() => {
    siteAudit.citations(brandId).then(setData).catch(() => setData(null));
  }, [brandId]);

  if (!data) {
    return <div className="card h-40 animate-pulse" style={{ background: 'rgba(255,255,255,0.02)' }} />;
  }

  // Compute third-party + unknown from full breakdown
  const total = data.by_domain.reduce((a, b) => a + b.count, 0) || 1;
  const thirdPartyCount = data.by_domain
    .filter((r) => r.kind === 'third_party')
    .reduce((a, b) => a + b.count, 0);
  const unknownCount = data.by_domain
    .filter((r) => r.kind === 'unknown')
    .reduce((a, b) => a + b.count, 0);
  const thirdPartyPct = (thirdPartyCount / total) * 100;
  const unknownPct = (unknownCount / total) * 100;

  return (
    <div className="space-y-6">
      <CitationStackedBar
        ownPct={data.own_pct}
        competitorPct={data.competitor_pct}
        thirdPartyPct={thirdPartyPct}
        unknownPct={unknownPct}
      />
      <CitationTopDomains rows={data.by_domain} />
      <AuditHistoryList brandId={brandId} />
    </div>
  );
}
