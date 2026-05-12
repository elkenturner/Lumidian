'use client';

import { ClientPipelineTab } from './ClientPipelineTab';

interface Props {
  brandId: number | null;
}

export function ClientContentTab({ brandId }: Props) {
  return (
    <div className="space-y-6 text-[var(--text-primary)]">
      <ClientPipelineTab brandId={brandId} />
      <div className="rounded-lg border border-dashed border-[var(--border-subtle)] p-6 text-sm text-[var(--text-muted)]">
        Per-client calendar, opportunities, and YouTube queue will appear here. Coming soon.
      </div>
    </div>
  );
}
