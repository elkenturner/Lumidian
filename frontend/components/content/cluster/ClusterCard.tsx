"use client";

import Link from "next/link";
import { ArrowUpRight, TrendingUp, TrendingDown, RefreshCw } from "lucide-react";
import PlatformBadge from "@/components/PlatformBadge";
import type { ContentClusterSummary } from "@/lib/api";

interface Props {
  cluster: ContentClusterSummary;
  brandId: number;
  onRegenerate: (clusterId: number) => void;
  regenerating: boolean;
}

const PIECE_TONE: Record<string, string> = {
  draft: "bg-[rgba(148,163,184,0.10)] text-[var(--text-secondary)] border-[rgba(148,163,184,0.18)]",
  approved: "bg-[rgba(34,197,94,0.10)] text-[#4ade80] border-[rgba(34,197,94,0.22)]",
  posted: "bg-[rgba(56,189,248,0.10)] text-[#7dd3fc] border-[rgba(56,189,248,0.22)]",
  failed: "bg-[rgba(244,63,94,0.10)] text-[#fb7185] border-[rgba(244,63,94,0.22)]",
  missing:
    "bg-transparent text-[var(--text-faint)] border-dashed border-[var(--border-subtle)]",
};

const STATUS_LABEL: Record<string, string> = {
  pending: "Pending",
  briefing: "Briefing",
  generating: "Generating",
  ready: "Ready",
  partial_failed: "Partial failure",
};

export function ClusterCard({ cluster, brandId, onRegenerate, regenerating }: Props) {
  const totalEnabled = cluster.pieces.length || 5;
  const completed = cluster.pieces.filter((p) => p.status !== "missing").length;
  const visibility = Math.round(cluster.visibility_pct);
  const visibilityTone =
    visibility >= 60
      ? "text-[#4ade80]"
      : visibility >= 30
      ? "text-[#fbbf24]"
      : "text-[#fb7185]";
  const statusLabel = STATUS_LABEL[cluster.status] ?? cluster.status.replace("_", " ");

  return (
    <div className="card card-hover flex flex-col gap-4">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <h3 className="text-base font-semibold text-[var(--text-primary)] leading-snug line-clamp-2">
            {cluster.prompt_text}
          </h3>
          <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[var(--text-faint)]">
            <span>
              <span className="text-[var(--text-muted)]">Status</span>{" "}
              <span className="text-[var(--text-secondary)] font-medium">{statusLabel}</span>
            </span>
            <span className="text-[var(--text-faint)]">·</span>
            <span>
              {completed} of {totalEnabled} pieces
            </span>
            {cluster.pillar_mode === "attached" && (
              <>
                <span className="text-[var(--text-faint)]">·</span>
                <span className="text-[#4ade80] font-medium">Pillar attached</span>
              </>
            )}
            {cluster.pillar_mode === "proposed" && (
              <>
                <span className="text-[var(--text-faint)]">·</span>
                <span className="text-[#fbbf24] font-medium">Pillar proposed</span>
              </>
            )}
          </div>
        </div>
        <div className={`shrink-0 flex items-center gap-1 text-xl font-bold ${visibilityTone}`}>
          {visibility >= 50 ? (
            <TrendingUp className="h-4 w-4" />
          ) : (
            <TrendingDown className="h-4 w-4" />
          )}
          {visibility}%
        </div>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {cluster.pieces.map((piece) => {
          const tone = PIECE_TONE[piece.status] ?? PIECE_TONE.missing;
          return (
            <span
              key={piece.platform}
              className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-md text-[11px] font-medium border ${tone}`}
              title={`${piece.platform} — ${piece.status}`}
            >
              <PlatformBadge platform={piece.platform} size="sm" />
              <span className="opacity-70">·</span>
              <span className="capitalize">{piece.status}</span>
            </span>
          );
        })}
      </div>

      <div className="flex items-center justify-between pt-1 border-t border-[var(--border-subtle)]">
        <Link
          href={`/content/${brandId}/cluster/${cluster.id}`}
          className="inline-flex items-center gap-1 text-sm font-medium text-[var(--accent-foreground)] hover:text-[var(--text-primary)]"
        >
          View cluster <ArrowUpRight className="h-3.5 w-3.5" />
        </Link>
        <button
          type="button"
          onClick={() => onRegenerate(cluster.id)}
          disabled={regenerating}
          className="btn btn-secondary !py-1.5 !px-3 text-xs"
        >
          <RefreshCw className={`h-3 w-3 ${regenerating ? "animate-spin" : ""}`} />
          {regenerating ? "Regenerating…" : "Regenerate"}
        </button>
      </div>
    </div>
  );
}
