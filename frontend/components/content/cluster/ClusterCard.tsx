"use client";

import Link from "next/link";
import { ArrowUpRight, MoreHorizontal, RefreshCw } from "lucide-react";
import { useState } from "react";
import type { ContentClusterSummary } from "@/lib/api";
import { CHIP_CLASSES, clusterChip, translateFailureReason } from "@/lib/clusterStatus";

interface Props {
  cluster: ContentClusterSummary;
  brandId: number;
  onRegenerate: (clusterId: number) => void;
  regenerating: boolean;
}

export function ClusterCard({ cluster, brandId, onRegenerate, regenerating }: Props) {
  // Derived: 1 card per prompt always — pending shells get a Generate CTA
  const isShell = cluster.status === "pending" && cluster.pieces.length === 0;
  // Count PLATFORMS, not draft rows: after a regeneration a platform can carry
  // both its live posted piece and a fresh replacement draft, so counting rows
  // produced nonsense like "5 of 11 posts live" (5 posted + 6 new = 11 rows).
  const platformCount = new Set(cluster.pieces.map((p) => p.platform)).size;
  const livePlatformCount = new Set(
    cluster.pieces.filter((p) => p.status === "posted").map((p) => p.platform),
  ).size;
  const draftsToReview = cluster.pieces.filter((p) => p.status !== "posted").length;
  // Failed pieces are excluded from board piece counts, so a briefing_failed
  // (or a generation_partial that somehow lost every piece) card would render
  // a nonsense "0 of 0 platforms live" row. Show the plain-language failure
  // reason in that slot instead — never a count row with nothing to count.
  const isBriefingFailed = cluster.status === "briefing_failed";
  const failureLine = translateFailureReason(cluster.failure_reason);
  const showFailureLine = !isShell && (isBriefingFailed || platformCount === 0) && !!failureLine;
  const showProgressRow = !isShell && !showFailureLine;
  const isFullyLive = platformCount > 0 && livePlatformCount >= platformCount && draftsToReview === 0;
  const isPartial = livePlatformCount > 0 && livePlatformCount < platformCount;
  const delta = cluster.cluster_delta;
  const hasDelta = delta !== null && delta !== undefined;
  // Round first so a 0.04 delta doesn't render as a green "+0.0 pts".
  const deltaRounded = hasDelta ? Math.round(delta! * 10) / 10 : null;
  const deltaTone = deltaRounded === null || deltaRounded === 0
    ? "text-[var(--text-faint)]"
    : deltaRounded > 0
    ? "text-[#4ade80]"
    : "text-[#fb7185]";
  // Textual +/- is the non-color cue (accessibility): never rely on colour alone.
  const deltaLabel = deltaRounded === null
    ? "—"
    : deltaRounded === 0
    ? "No lift yet"
    : `${deltaRounded > 0 ? "+" : ""}${deltaRounded.toFixed(1)} pts`;
  const chip = clusterChip(cluster);

  return (
    <div
      className="card card-hover flex flex-col gap-4"
      aria-label={`${cluster.prompt_text} — ${chip.label}`}
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <span
            className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${CHIP_CLASSES[chip.tone]}`}
            title={
              chip.tone === "thin"
                ? "These posts are usable but built on fewer credible sources than we'd like — add sources you trust, then rewrite to strengthen them"
                : undefined
            }
          >
            {chip.label}
          </span>
          <h3 className="mt-2 text-base font-semibold text-[var(--text-primary)] leading-snug line-clamp-2">
            {cluster.prompt_text}
          </h3>
        </div>
        {/* Lift only shows once it means something (a post has gone live). On
            unstarted/never-posted clusters the slot would read "—" forever, so
            we hide it rather than emphasise a dash. */}
        {hasDelta && (
          <div
            className="shrink-0 text-right"
            title="Change in this brand's AI-visibility score for this question since the first post went live. Includes Wikipedia and legacy posts."
          >
            <div className={`text-xl font-bold ${deltaTone}`}>{deltaLabel}</div>
            <div className="text-[10px] uppercase tracking-wider text-[var(--text-faint)] font-semibold">
              AI visibility lift
            </div>
          </div>
        )}
      </div>

      {/* Failure reason takes the place of the progress row — there's nothing
          to count when generation didn't produce any pieces. */}
      {showFailureLine && (
        <p className="text-xs text-rose-300 bg-rose-500/10 border border-rose-500/30 rounded px-2 py-1">
          {failureLine}
        </p>
      )}

      {/* Composed progress bar — one dot per platform */}
      {showProgressRow && (
        <div className="flex items-center gap-3 text-xs">
          <div className="flex items-center gap-1 text-[var(--text-secondary)]">
            {Array.from({ length: platformCount }).map((_, i) => (
              <span
                key={i}
                className={`inline-block h-2 w-2 rounded-full ${
                  i < livePlatformCount
                    ? "bg-[#4ade80]"
                    : "border border-[var(--border-subtle)]"
                }`}
              />
            ))}
            <span className="ml-1 text-[var(--text-faint)]">
              Live on {livePlatformCount} of {platformCount} platform{platformCount !== 1 ? 's' : ''}
            </span>
          </div>
          {draftsToReview > 0 && (
            <>
              <span className="text-[var(--text-faint)]">·</span>
              <span className="text-[var(--text-secondary)]">
                {draftsToReview} draft{draftsToReview !== 1 ? 's' : ''} to review
              </span>
            </>
          )}
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
          {isShell ? "Generate posts" : "View posts"}{" "}
          <ArrowUpRight className="h-3.5 w-3.5" />
        </Link>
        {isFullyLive && (
          <button
            type="button"
            disabled={regenerating}
            onClick={() => onRegenerate(cluster.id)}
            className="inline-flex items-center gap-1.5 text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)] disabled:opacity-40 disabled:cursor-not-allowed"
            title="Write a fresh round of drafts. Posted pieces stay live and keep their lift attribution."
          >
            <RefreshCw className={`h-3 w-3 ${regenerating ? "animate-spin" : ""}`} />
            {regenerating ? "Writing…" : "Write next round"}
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
        aria-label="Post actions"
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
