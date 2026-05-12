'use client';

import { ClientBrandTab } from './ClientBrandTab';
import { TaskList } from './TaskList';

interface Props {
  brandId: number | null;
  clientId: number;
}

export function ClientStrategyTab({ brandId, clientId }: Props) {
  return (
    <div className="space-y-6 text-[var(--text-primary)]">
      <TaskList clientId={clientId} />
      <ClientBrandTab brandId={brandId} />
      <div className="rounded-lg border border-dashed border-[var(--border-subtle)] p-6 text-sm text-[var(--text-muted)]">
        Content gaps will live here. Coming soon.
      </div>
    </div>
  );
}
