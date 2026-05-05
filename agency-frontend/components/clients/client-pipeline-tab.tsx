'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';

interface Props {
  brandId: number | null;
}

interface DraftRow {
  id: number;
  title: string | null;
  content_text: string | null;
  platform: string;
  status: string;
  assigned_to_user_id?: number | null;
  created_at: string;
}

const COLUMNS: Array<{ key: string; label: string }> = [
  { key: 'draft', label: 'Draft' },
  { key: 'approved', label: 'Approved' },
  { key: 'posted', label: 'Posted' },
];

export function ClientPipelineTab({ brandId }: Props) {
  const [drafts, setDrafts] = useState<DraftRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (brandId == null) {
      setLoading(false);
      return;
    }
    api
      .listDrafts(brandId)
      .then((data) => setDrafts((data as DraftRow[]) ?? []))
      .catch((e) => setError(String(e?.message ?? e)))
      .finally(() => setLoading(false));
  }, [brandId]);

  if (brandId == null) {
    return <p className="text-sm text-muted-foreground">No brand attached to this client.</p>;
  }
  if (loading) return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (error) return <p className="text-sm text-red-600">{error}</p>;

  if (drafts.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border p-10 text-center text-sm text-muted-foreground">
        No drafts yet. Generate some from Studio (V1) — for MVP, drafts created elsewhere on the
        backend will appear here.
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
      {COLUMNS.map(({ key, label }) => {
        const items = drafts.filter((d) => d.status === key);
        return (
          <section key={key} className="rounded-lg border border-border bg-white p-4">
            <h3 className="mb-3 flex items-center justify-between text-sm font-medium">
              <span>{label}</span>
              <span className="text-xs text-muted-foreground">{items.length}</span>
            </h3>
            <ul className="space-y-2">
              {items.map((d) => (
                <li key={d.id} className="rounded-md border border-border p-3 text-sm">
                  <div className="font-medium">{d.title || `Draft #${d.id}`}</div>
                  <div className="text-xs text-muted-foreground">{d.platform}</div>
                  {d.content_text && (
                    <p className="mt-2 line-clamp-3 text-xs text-muted-foreground">
                      {d.content_text}
                    </p>
                  )}
                </li>
              ))}
              {items.length === 0 && (
                <li className="rounded-md border border-dashed border-border p-3 text-xs text-muted-foreground">
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
