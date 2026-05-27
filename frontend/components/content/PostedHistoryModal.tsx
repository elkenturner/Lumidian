"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { X } from "lucide-react";
import {
  getDrafts,
  getDraftAttributions,
  deleteDraft as apiDeleteDraft,
  type ContentDraft,
  type DraftAttribution,
} from "@/lib/api";
import PlatformBadge from "@/components/PlatformBadge";

interface Props {
  brandId: number;
  open: boolean;
  onClose: () => void;
}

interface Row {
  draft: ContentDraft;
  delta: number | null;
}

export function PostedHistoryModal({ brandId, open, onClose }: Props) {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    async function load() {
      setLoading(true);
      const [drafts, attributions] = await Promise.all([
        getDrafts(brandId, undefined, "posted"),
        getDraftAttributions(brandId).catch(() => [] as DraftAttribution[]),
      ]);
      if (cancelled) return;
      const deltaById = new Map<number, number | null>(
        attributions.map((a) => [a.draft_id, a.delta ?? null]),
      );
      const out: Row[] = drafts.map((d) => ({ draft: d, delta: deltaById.get(d.id) ?? null }));
      out.sort((a, b) => {
        const ad = a.draft.posted_at ?? a.draft.created_at ?? "";
        const bd = b.draft.posted_at ?? b.draft.created_at ?? "";
        return bd.localeCompare(ad);
      });
      setRows(out);
      setLoading(false);
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [brandId, open]);

  if (!open) return null;

  async function handleDelete(id: number) {
    if (!confirm("Delete this posted record? Attribution data will be lost.")) return;
    await apiDeleteDraft(id);
    setRows((prev) => prev.filter((r) => r.draft.id !== id));
  }

  return (
    <div
      className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-[var(--bg-card)] border border-[var(--border-subtle)] rounded-xl w-full max-w-3xl max-h-[80vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between p-4 border-b border-[var(--border-subtle)]">
          <h2 className="text-base font-semibold text-[var(--text-primary)]">Posted history</h2>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded-md text-[var(--text-faint)] hover:text-[var(--text-secondary)] hover:bg-[var(--bg-base)]"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="overflow-y-auto p-4">
          {loading ? (
            <p className="text-sm text-[var(--text-faint)]">Loading…</p>
          ) : rows.length === 0 ? (
            <p className="text-sm text-[var(--text-faint)]">Nothing posted yet.</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {rows.map((r) => {
                const positive = r.delta != null && r.delta >= 0;
                return (
                  <li key={r.draft.id} className="flex items-center gap-3 text-sm">
                    <span
                      className={`text-xs font-semibold w-14 text-right ${
                        r.delta == null
                          ? "text-[var(--text-faint)]"
                          : positive
                          ? "text-[#4ade80]"
                          : "text-[#fb7185]"
                      }`}
                    >
                      {r.delta == null ? "—" : `${positive ? "+" : ""}${r.delta.toFixed(1)}pp`}
                    </span>
                    <PlatformBadge platform={r.draft.platform} size="sm" />
                    <span className="flex-1 truncate text-[var(--text-secondary)]">
                      {r.draft.title || `${r.draft.platform} piece`}
                    </span>
                    {r.draft.cluster_id != null ? (
                      <Link
                        href={`/content/${brandId}/cluster/${r.draft.cluster_id}`}
                        className="text-xs text-[var(--accent-foreground)] hover:text-[var(--text-primary)]"
                      >
                        Jump to cluster →
                      </Link>
                    ) : (
                      <span className="text-xs text-[var(--text-faint)]">Legacy</span>
                    )}
                    <button
                      type="button"
                      onClick={() => handleDelete(r.draft.id)}
                      className="text-xs text-[var(--text-faint)] hover:text-[#fb7185]"
                    >
                      Delete
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
