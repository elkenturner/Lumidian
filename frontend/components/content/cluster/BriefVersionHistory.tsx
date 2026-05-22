"use client";

import { useEffect, useState } from "react";
import { getClusterBriefHistory, type ContentBrief } from "@/lib/api";

interface Props {
  brandId: number;
  clusterId: number;
  currentVersion: number;
  onRevert: (brief: ContentBrief) => void;
}

export function BriefVersionHistory({ brandId, clusterId, currentVersion, onRevert }: Props) {
  const [briefs, setBriefs] = useState<ContentBrief[]>([]);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    let mounted = true;
    getClusterBriefHistory(brandId, clusterId).then((b) => {
      if (mounted) setBriefs(b);
    });
    return () => {
      mounted = false;
    };
  }, [brandId, clusterId, open]);

  return (
    <div className="text-xs">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="text-[var(--text-faint)] hover:text-[var(--text-primary)]"
      >
        {open ? "▾" : "▸"} History
      </button>
      {open && briefs.length > 0 && (
        <ul className="mt-2 space-y-1">
          {briefs.map((b) => (
            <li key={b.id} className="flex items-center justify-between gap-3">
              <span className="text-[var(--text-secondary)]">
                v{b.version}
                {b.version === currentVersion && (
                  <span className="ml-1 text-[var(--text-faint)]">(current)</span>
                )}
              </span>
              <button
                type="button"
                onClick={() => onRevert(b)}
                disabled={b.version === currentVersion}
                className="text-emerald-300 hover:text-emerald-200 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Revert to v{b.version}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
