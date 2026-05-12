'use client';

import { ClientBrandTab } from './ClientBrandTab';

interface Props {
  brandId: number | null;
}

export function ClientStrategyTab({ brandId }: Props) {
  return (
    <div className="space-y-6 text-[var(--text-primary)]">
      <ClientBrandTab brandId={brandId} />
      <div className="rounded-lg border border-dashed border-[var(--border-subtle)] p-6 text-sm text-[var(--text-muted)]">
        Content gaps, AIO website audit, and internal notes will live here. Coming soon.
      </div>
    </div>
  );
}
