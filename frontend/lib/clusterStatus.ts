/**
 * Shared cluster-status helpers. Used by the content list, the cluster card,
 * and the cluster detail page so "has this been generated yet?" and the
 * status chip read identically everywhere (DRY).
 */

export type ClusterChipTone = "idle" | "active" | "ready" | "review" | "thin" | "fail";

export interface ClusterChip {
  label: string;
  tone: ClusterChipTone;
}

interface ClusterLike {
  status: string;
  version?: number;
  posted_count?: number;
  pieces?: { platform: string }[];
}

/**
 * Translate a raw machine failure_reason (e.g. "insufficient_authority: T1+T2 = 2,
 * need at least 3") into plain language for end users. Matched on prefix since the
 * backend appends free-form detail after a colon. Never surfaces "cluster"/"brief"/
 * "T1"/"T2" — those are internal implementation names.
 */
export function translateFailureReason(reason: string | null | undefined): string | null {
  if (!reason) return null;
  if (reason.startsWith("insufficient_authority") || reason.startsWith("insufficient_T1_sources")) {
    return "Not enough credible sources found for this question";
  }
  if (reason.startsWith("no_sources_found")) {
    return "No usable sources found for this question";
  }
  if (reason.startsWith("search_unavailable")) {
    return "The search provider was busy — try again in a few minutes";
  }
  if (reason.startsWith("brief_llm_failure") || reason.startsWith("no_brief_to_reuse")) {
    return "Strategy generation failed — try again";
  }
  if (reason.startsWith("timeout")) {
    return "Generation timed out — try again";
  }
  return "Generation failed";
}

/**
 * True once a cluster has actually been generated (has a version, has posts,
 * or has moved past the eager "pending" shell). A brand whose clusters are ALL
 * `false` here has never generated anything → show the first-run experience.
 */
export function clusterHasContent(c: ClusterLike): boolean {
  return c.status !== "pending" || (c.version ?? 0) > 0 || (c.pieces?.length ?? 0) > 0;
}

/** A short, plain-language status chip for a cluster. */
export function clusterChip(c: ClusterLike): ClusterChip {
  const enabled = c.pieces?.length ?? 0;
  const posted = c.posted_count ?? 0;
  switch (c.status) {
    case "pending":
      return { label: "Not started", tone: "idle" };
    case "briefing":
    case "generating":
      return { label: "Generating…", tone: "active" };
    case "briefing_failed":
      return { label: "Failed", tone: "fail" };
    case "generation_partial":
    case "partial_failed":
      return { label: "Needs review", tone: "review" };
    case "ready_low_evidence":
      return { label: "Ready · thin sources", tone: "thin" };
    case "ready":
      if (enabled > 0 && posted >= enabled) return { label: "All posted", tone: "ready" };
      if (posted > 0) return { label: `${posted}/${enabled} posted`, tone: "ready" };
      return { label: "Ready to post", tone: "ready" };
    default:
      return { label: c.status.replace(/_/g, " "), tone: "idle" };
  }
}

/**
 * Tailwind classes per chip tone — kept beside the labels so callers stay terse.
 * Reuses the app-wide status hue convention (amber/blue/sky/emerald/rose) so each
 * tone reads as visually distinct rather than three shades of the same amber.
 */
export const CHIP_CLASSES: Record<ClusterChipTone, string> = {
  idle: "bg-[var(--bg-card)] text-[var(--text-faint)] border border-[var(--border-subtle)]",
  active: "bg-amber-500/10 text-amber-300 border border-amber-500/30",
  ready: "bg-emerald-500/10 text-emerald-300 border border-emerald-500/30",
  // "Needs review" — a partial generation failure, distinct from the amber
  // in-progress state and the rose full-failure state. Matches the blue used
  // for other in-between states (RunStatusBadge "running", account "trialing").
  review: "bg-blue-500/10 text-blue-300 border border-blue-500/30",
  // "Ready · thin sources" — cluster IS usable, just flagged. Matches the sky
  // used elsewhere for informational/measuring states (e.g. "Posted · measuring").
  thin: "bg-sky-500/10 text-sky-300 border border-sky-500/30",
  fail: "bg-rose-500/10 text-rose-300 border border-rose-500/30",
};
