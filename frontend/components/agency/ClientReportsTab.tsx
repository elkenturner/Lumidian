'use client';

interface Props {
  brandId: number | null;
}

export function ClientReportsTab({ brandId }: Props) {
  if (brandId == null) {
    return <p className="text-sm text-[var(--text-muted)]">No brand attached to this client.</p>;
  }
  return (
    <div className="space-y-4 text-[var(--text-primary)]">
      <div className="rounded-lg border border-dashed border-[var(--border-subtle)] p-6 text-sm text-[var(--text-muted)]">
        Monthly client reports, on-demand audits, and per-client performance summaries will live
        here. Coming soon.
      </div>
    </div>
  );
}
