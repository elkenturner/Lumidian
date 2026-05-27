"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { getDrafts, getDraftAttributions, type ContentDraft, type DraftAttribution } from "@/lib/api";
import PlatformBadge from "@/components/PlatformBadge";

interface Props {
  brandId: number;
  onSeeAll: () => void;
}

interface Row {
  draft: ContentDraft;
  delta: number | null;
  isLegacy: boolean;
}

const LIVE_LIMIT = 5;
const LEGACY_LIMIT = 3;

function formatPostedAt(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  const now = new Date();
  const diff = (now.getTime() - d.getTime()) / (1000 * 60 * 60 * 24);
  if (diff < 1) return "today";
  if (diff < 2) return "1d ago";
  if (diff < 14) return `${Math.floor(diff)}d ago`;
  return d.toLocaleDateString();
}

export function ImpactStrip({ brandId, onSeeAll }: Props) {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [legacyRows, setLegacyRows] = useState<Row[]>([]);
  const [legacyTotal, setLegacyTotal] = useState(0);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const [drafts, attributions] = await Promise.all([
        getDrafts(brandId, undefined, "posted"),
        getDraftAttributions(brandId).catch(() => [] as DraftAttribution[]),
      ]);
      if (cancelled) return;
      const deltaById = new Map<number, number | null>(
        attributions.map((a) => [a.draft_id, a.delta ?? null]),
      );
      const live: Row[] = [];
      const legacy: Row[] = [];
      for (const d of drafts) {
        const row: Row = {
          draft: d,
          delta: deltaById.get(d.id) ?? null,
          isLegacy: d.cluster_id == null,
        };
        if (row.isLegacy) legacy.push(row);
        else live.push(row);
      }
      live.sort((a, b) => (b.delta ?? -Infinity) - (a.delta ?? -Infinity));
      legacy.sort((a, b) => {
        const ad = a.draft.posted_at ?? a.draft.created_at ?? "";
        const bd = b.draft.posted_at ?? b.draft.created_at ?? "";
        return bd.localeCompare(ad);
      });
      setRows(live.slice(0, LIVE_LIMIT));
      setLegacyRows(legacy.slice(0, LEGACY_LIMIT));
      setLegacyTotal(legacy.length);
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [brandId]);

  if (rows === null) {
    return null;
  }
  if (rows.length === 0 && legacyRows.length === 0) {
    return (
      <div className="card mb-6">
        <div className="text-[11px] uppercase tracking-wider text-[var(--text-faint)] font-semibold mb-2">
          Impact
        </div>
        <p className="text-sm text-[var(--text-faint)]">
          No measured impact yet — post a piece and we&apos;ll track lift here after the next tracking run.
        </p>
      </div>
    );
  }

  return (
    <div className="card mb-6">
      <div className="flex items-center justify-between mb-3">
        <div className="text-[11px] uppercase tracking-wider text-[var(--text-faint)] font-semibold">
          Impact
        </div>
        <button
          type="button"
          onClick={onSeeAll}
          className="text-xs text-[var(--accent-foreground)] hover:text-[var(--text-primary)]"
        >
          See all posted →
        </button>
      </div>
      <ul className="flex flex-col gap-2">
        {rows.map((r) => (
          <li key={r.draft.id} className="flex items-center gap-3 text-sm">
            <DeltaChip delta={r.delta} />
            <PlatformBadge platform={r.draft.platform} size="sm" />
            <span className="flex-1 truncate text-[var(--text-secondary)]">
              {r.draft.title || `${r.draft.platform} piece`}
            </span>
            <span className="text-xs text-[var(--text-faint)] whitespace-nowrap">
              {formatPostedAt(r.draft.posted_at)}
            </span>
            {r.draft.cluster_id != null && (
              <Link
                href={`/content/${brandId}/cluster/${r.draft.cluster_id}`}
                className="text-xs text-[var(--accent-foreground)] hover:text-[var(--text-primary)] whitespace-nowrap"
              >
                Jump to cluster →
              </Link>
            )}
          </li>
        ))}
        {legacyRows.length > 0 && (
          <>
            <li className="text-[10px] uppercase tracking-wider text-[var(--text-faint)] font-semibold mt-2 mb-1">
              ─── Legacy ───
            </li>
            {legacyRows.map((r) => (
              <li key={r.draft.id} className="flex items-center gap-3 text-sm opacity-70">
                <span className="text-xs text-[var(--text-faint)] px-2 py-0.5 rounded-md border border-[var(--border-subtle)]">
                  Legacy
                </span>
                <PlatformBadge platform={r.draft.platform} size="sm" />
                <span className="flex-1 truncate text-[var(--text-secondary)]">
                  {r.draft.title || `${r.draft.platform} piece`}
                </span>
                <span className="text-xs text-[var(--text-faint)] whitespace-nowrap">
                  {formatPostedAt(r.draft.posted_at)}
                </span>
              </li>
            ))}
            {legacyTotal > LEGACY_LIMIT && (
              <li className="text-xs text-[var(--text-faint)]">
                +{legacyTotal - LEGACY_LIMIT} more in history
              </li>
            )}
          </>
        )}
      </ul>
    </div>
  );
}

function DeltaChip({ delta }: { delta: number | null }) {
  if (delta === null) {
    return (
      <span className="text-xs font-medium text-[var(--text-faint)] w-14 text-right">—</span>
    );
  }
  const positive = delta >= 0;
  return (
    <span
      className={`text-xs font-semibold w-14 text-right ${
        positive ? "text-[#4ade80]" : "text-[#fb7185]"
      }`}
    >
      {positive ? "+" : ""}{delta.toFixed(1)}pp
    </span>
  );
}
