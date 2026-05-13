"use client";

import Link from "next/link";
import { TrendingUp, TrendingDown } from "lucide-react";
import type { ContentClusterSummary } from "@/lib/api";

interface Props {
  cluster: ContentClusterSummary;
  brandId: number;
  onRegenerate: (clusterId: number) => void;
  regenerating: boolean;
}

const PIECE_BADGE_STYLES: Record<string, string> = {
  draft: "bg-slate-100 text-slate-700",
  approved: "bg-emerald-100 text-emerald-800",
  posted: "bg-sky-100 text-sky-800",
  failed: "bg-rose-100 text-rose-800",
  missing: "bg-slate-50 text-slate-400 border border-dashed border-slate-300",
};

export function ClusterCard({ cluster, brandId, onRegenerate, regenerating }: Props) {
  const totalEnabled = cluster.pieces.length || 5;
  const completed = cluster.pieces.filter((p) => p.status !== "missing").length;
  const visibility = Math.round(cluster.visibility_pct);
  const visibilityTone =
    visibility >= 60 ? "text-emerald-700" : visibility >= 30 ? "text-amber-700" : "text-rose-700";

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm hover:shadow transition-shadow">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <h3 className="text-base font-semibold text-slate-900 line-clamp-2">{cluster.prompt_text}</h3>
          <div className="mt-1 flex items-center gap-3 text-sm text-slate-500">
            <span>
              Status:{" "}
              <span className="font-medium text-slate-700 capitalize">{cluster.status.replace("_", " ")}</span>
            </span>
            <span>·</span>
            <span>
              {completed} of {totalEnabled} pieces
            </span>
            {cluster.pillar_mode === "attached" && (
              <>
                <span>·</span>
                <span className="text-emerald-700 font-medium">Pillar attached</span>
              </>
            )}
            {cluster.pillar_mode === "proposed" && (
              <>
                <span>·</span>
                <span className="text-amber-700 font-medium">Pillar proposed</span>
              </>
            )}
          </div>
        </div>
        <div className={`shrink-0 flex items-center gap-1 text-2xl font-bold ${visibilityTone}`}>
          {visibility >= 50 ? <TrendingUp className="h-5 w-5" /> : <TrendingDown className="h-5 w-5" />}
          {visibility}%
        </div>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        {cluster.pieces.map((piece) => (
          <span
            key={piece.platform}
            className={`px-2.5 py-1 rounded-md text-xs font-medium ${PIECE_BADGE_STYLES[piece.status] ?? PIECE_BADGE_STYLES.missing}`}
          >
            {piece.platform} · {piece.status}
          </span>
        ))}
      </div>

      <div className="mt-4 flex items-center justify-between">
        <Link
          href={`/content/${brandId}/cluster/${cluster.id}`}
          className="text-sm font-medium text-sky-700 hover:text-sky-900"
        >
          View cluster →
        </Link>
        <button
          type="button"
          onClick={() => onRegenerate(cluster.id)}
          disabled={regenerating}
          className="px-3 py-1.5 rounded-md border border-slate-200 text-sm hover:bg-slate-50 disabled:opacity-50"
        >
          {regenerating ? "Regenerating…" : "Regenerate"}
        </button>
      </div>
    </div>
  );
}
