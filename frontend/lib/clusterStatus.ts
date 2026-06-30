/**
 * Shared cluster-status helpers. Used by the content list, the cluster card,
 * and the cluster detail page so "has this been generated yet?" and the
 * status chip read identically everywhere (DRY).
 */

export type ClusterChipTone = "idle" | "active" | "ready" | "warn" | "fail";

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
      return { label: "Needs review", tone: "warn" };
    case "ready_low_evidence":
      return { label: "Ready · thin sources", tone: "warn" };
    case "ready":
      if (enabled > 0 && posted >= enabled) return { label: "All posted", tone: "ready" };
      if (posted > 0) return { label: `${posted}/${enabled} posted`, tone: "ready" };
      return { label: "Ready to post", tone: "ready" };
    default:
      return { label: c.status.replace(/_/g, " "), tone: "idle" };
  }
}

/** Tailwind classes per chip tone — kept beside the labels so callers stay terse. */
export const CHIP_CLASSES: Record<ClusterChipTone, string> = {
  idle: "bg-[var(--bg-card)] text-[var(--text-faint)] border border-[var(--border-subtle)]",
  active: "bg-amber-500/10 text-amber-300 border border-amber-500/30",
  ready: "bg-emerald-500/10 text-emerald-300 border border-emerald-500/30",
  warn: "bg-amber-500/10 text-amber-300 border border-amber-500/30",
  fail: "bg-rose-500/10 text-rose-300 border border-rose-500/30",
};
