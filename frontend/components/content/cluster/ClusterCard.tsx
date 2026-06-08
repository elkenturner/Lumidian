"use client";

import Link from "next/link";
import { ArrowUpRight, MoreHorizontal, RefreshCw } from "lucide-react";
import { useState } from "react";
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
  const postedCount = cluster.posted_count;
  const delta = cluster.cluster_delta;
  const hasDelta = delta !== null && delta !== undefined;
  const deltaTone = !hasDelta
    ? "text-[var(--text-faint)]"
    : delta! >= 0
    ? "text-[#4ade80]"
    : "text-[#fb7185]";
  const deltaLabel = !hasDelta
    ? "—"
    : `${delta! >= 0 ? "+" : ""}${delta!.toFixed(1)} pts`;
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
            <span>Posted {postedCount} of {totalEnabled} posts</span>
            {cluster.pillar_mode === "attached" && (
              <>
                <span className="text-[var(--text-faint)]">·</span>
                <span className="text-[#4ade80] font-medium" title="A page on the brand's own site that these posts link back to">Hub page linked</span>
              </>
            )}
            {cluster.pillar_mode === "proposed" && (
              <>
                <span className="text-[var(--text-faint)]">·</span>
                <span className="text-[#fbbf24] font-medium" title="A suggested page on the brand's own site for these posts to link back to">Hub page suggested</span>
              </>
            )}
          </div>
        </div>
        <div
          className="shrink-0 text-right"
          title={
            hasDelta
              ? "Change in this brand's AI-visibility score for this question since these posts went live"
              : "No posts measured yet — publish a post and run tracking to see the impact"
          }
        >
          <div className={`flex items-center justify-end gap-1 text-xl font-bold ${deltaTone}`}>
            {deltaLabel}
          </div>
          <div className="text-[10px] uppercase tracking-wider text-[var(--text-faint)] font-semibold">
            AI visibility lift
          </div>
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
        <ClusterCardKebab
          regenerating={regenerating}
          onRegenerate={() => onRegenerate(cluster.id)}
        />
      </div>
    </div>
  );
}

function ClusterCardKebab({
  regenerating,
  onRegenerate,
}: {
  regenerating: boolean;
  onRegenerate: () => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <button
        type="button"
        aria-label="Cluster actions"
        onClick={() => setOpen((o) => !o)}
        className="p-1.5 rounded-md text-[var(--text-faint)] hover:text-[var(--text-secondary)] hover:bg-[var(--bg-base)]"
      >
        <MoreHorizontal className="h-4 w-4" />
      </button>
      {open && (
        <div
          className="absolute right-0 mt-1 w-56 rounded-md border border-[var(--border-subtle)] bg-[var(--bg-card)] shadow-lg z-10"
          onMouseLeave={() => setOpen(false)}
        >
          <button
            type="button"
            disabled={regenerating}
            onClick={() => {
              onRegenerate();
              setOpen(false);
            }}
            className="w-full text-left px-3 py-2 text-sm text-[var(--text-secondary)] hover:bg-[var(--bg-base)] disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-2"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${regenerating ? "animate-spin" : ""}`} />
            {regenerating ? "Rewriting…" : "Rewrite all posts"}
          </button>
        </div>
      )}
    </div>
  );
}
