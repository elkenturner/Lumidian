"use client";

import Link from "next/link";
import { ArrowUpRight, MoreHorizontal, RefreshCw } from "lucide-react";
import { useState } from "react";
import type { ContentClusterSummary } from "@/lib/api";

interface Props {
  cluster: ContentClusterSummary;
  brandId: number;
  onRegenerate: (clusterId: number) => void;
  regenerating: boolean;
}

export function ClusterCard({ cluster, brandId, onRegenerate, regenerating }: Props) {
  // Derived: 1 card per prompt always — pending shells get a Generate CTA
  const isShell = cluster.status === "pending" && cluster.pieces.length === 0;
  const enabledPlatformCount = cluster.pieces.length;
  const postedCount = cluster.posted_count;
  // Clamp green dots to the number of visible pieces. No-op when nothing is
  // hidden; prevents rendering more "posted" dots than pieces once the list
  // view filters a platform out.
  const postedDots = Math.min(postedCount, enabledPlatformCount);
  const isFullyLive = enabledPlatformCount > 0 && postedCount >= enabledPlatformCount;
  const isPartial = postedCount > 0 && postedCount < enabledPlatformCount;
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

  return (
    <div className="card card-hover flex flex-col gap-4">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <h3 className="text-base font-semibold text-[var(--text-primary)] leading-snug line-clamp-2 min-w-0 flex-1">
          {cluster.prompt_text}
        </h3>
        <div
          className="shrink-0 text-right"
          title="Cluster lift = current visibility minus the visibility at the time the first post for this prompt went live. Includes Wikipedia and legacy posts."
        >
          <div className={`text-xl font-bold ${deltaTone}`}>{deltaLabel}</div>
          <div className="text-[10px] uppercase tracking-wider text-[var(--text-faint)] font-semibold">
            AI visibility lift
          </div>
        </div>
      </div>

      {/* Composed progress bar */}
      {isShell ? (
        <div className="text-sm text-[var(--text-secondary)]">
          No drafts yet for this prompt.
        </div>
      ) : (
        <div className="flex items-center gap-3 text-xs">
          <div className="flex items-center gap-1 text-[var(--text-secondary)]">
            {Array.from({ length: enabledPlatformCount }).map((_, i) => (
              <span
                key={i}
                className={`inline-block h-2 w-2 rounded-full ${
                  i < postedDots
                    ? "bg-[#4ade80]"
                    : "border border-[var(--border-subtle)]"
                }`}
              />
            ))}
            <span className="ml-1 text-[var(--text-faint)]">
              {postedCount} of {enabledPlatformCount} posts live
            </span>
          </div>
          <span className="text-[var(--text-faint)]">·</span>
          <span className="text-[var(--text-secondary)]">
            {cluster.pieces.length - postedCount} drafts to review
          </span>
        </div>
      )}

      {/* Partial-coverage one-liner */}
      {isPartial && (
        <p className="text-[11px] text-[var(--text-faint)]">
          Lift only counts what&apos;s posted. Publish the remaining platforms to capture full impact.
        </p>
      )}

      {/* Footer: View link + Push v2 / Generate CTA */}
      <div className="flex items-center justify-between pt-1 border-t border-[var(--border-subtle)]">
        <Link
          href={`/content/${brandId}/cluster/${cluster.id}`}
          className="inline-flex items-center gap-1 text-sm font-medium text-[var(--accent-foreground)] hover:text-[var(--text-primary)]"
        >
          {isShell ? "Generate cluster" : "View cluster"}{" "}
          <ArrowUpRight className="h-3.5 w-3.5" />
        </Link>
        {isFullyLive && (
          <button
            type="button"
            disabled={regenerating}
            onClick={() => onRegenerate(cluster.id)}
            className="inline-flex items-center gap-1.5 text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)] disabled:opacity-40 disabled:cursor-not-allowed"
            title="Generate a fresh round of drafts (v2). Old posts stay live and keep their lift attribution."
          >
            <RefreshCw className={`h-3 w-3 ${regenerating ? "animate-spin" : ""}`} />
            {regenerating ? "Drafting v2…" : "Push v2"}
          </button>
        )}
        {!isFullyLive && !isShell && (
          <ClusterCardKebab
            regenerating={regenerating}
            onRegenerate={() => onRegenerate(cluster.id)}
          />
        )}
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
            {regenerating ? "Regenerating…" : "Regenerate all pieces"}
          </button>
        </div>
      )}
    </div>
  );
}
