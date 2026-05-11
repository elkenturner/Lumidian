'use client';

import { useEffect, useState } from 'react';
import { getDrafts, type ContentDraft } from '@/lib/api';

interface Props {
  brandId: number | null;
}

const COLUMNS: Array<{ key: string; label: string }> = [
  { key: 'draft', label: 'Draft' },
  { key: 'approved', label: 'Approved' },
  { key: 'posted', label: 'Posted' },
];

export function ClientPipelineTab({ brandId }: Props) {
  const [drafts, setDrafts] = useState<ContentDraft[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (brandId == null) {
      setLoading(false);
      return;
    }
    getDrafts(brandId)
      .then(setDrafts)
      .catch((e) => setError(String(e?.message ?? e)))
      .finally(() => setLoading(false));
  }, [brandId]);

  if (brandId == null) {
    return (
      <p className="text-sm text-[var(--text-muted)]">No brand attached to this client.</p>
    );
  }
  if (loading) return <p className="text-sm text-[var(--text-muted)]">Loading…</p>;
  if (error) return <p className="text-sm text-red-400">{error}</p>;

  if (drafts.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-[var(--border-subtle)] p-10 text-center text-sm text-[var(--text-muted)]">
        No drafts yet. Use the Lumidian Content section to generate some for this client&apos;s brand —
        they&apos;ll show up here.
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-4 text-[var(--text-primary)] md:grid-cols-3">
      {COLUMNS.map(({ key, label }) => {
        const items = drafts.filter((d) => d.status === key);
        return (
          <section
            key={key}
            className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-card)] p-4"
          >
            <h3 className="mb-3 flex items-center justify-between text-sm font-medium">
              <span>{label}</span>
              <span className="text-xs text-[var(--text-muted)]">{items.length}</span>
            </h3>
            <ul className="space-y-2">
              {items.map((d) => (
                <li
                  key={d.id}
                  className="rounded-md border border-[var(--border-subtle)] bg-[var(--bg-raised)] p-3 text-sm"
                >
                  <div className="font-medium">{d.title || `Draft #${d.id}`}</div>
                  <div className="text-xs text-[var(--text-muted)]">{d.platform}</div>
                  {d.content_text && (
                    <p className="mt-2 line-clamp-3 text-xs text-[var(--text-muted)]">
                      {d.content_text}
                    </p>
                  )}
                </li>
              ))}
              {items.length === 0 && (
                <li className="rounded-md border border-dashed border-[var(--border-subtle)] p-3 text-xs text-[var(--text-muted)]">
                  Empty
                </li>
              )}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
