"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import {
  ArrowLeft,
  Loader2,
  RefreshCw,
  RotateCw,
  Sparkles,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  getCluster,
  getContentGaps,
  proposeClusterPillar,
  rebuildCluster,
  regenerateClusterPieces,
  updateClusterAngle,
  type ContentClusterDetail,
  type ContentDraft,
  type ContentGap,
  type PillarCandidate,
} from "@/lib/api";
import { BriefPanel } from "@/components/content/cluster/BriefPanel";
import { OwnedSiteCard } from "@/components/content/cluster/OwnedSiteCard";
import { PieceCard } from "@/components/content/cluster/PieceCard";
import { SourceSpinePanel } from "@/components/content/cluster/SourceSpinePanel";
import PlatformBadge from "@/components/PlatformBadge";
import { useClusterStatus } from "@/hooks/useClusterStatus";
import { CLUSTER_PLATFORMS } from "@/lib/clusterPlatforms";
import { useHiddenPlatforms } from "@/lib/useHiddenPlatforms";
import { clusterChip, translateFailureReason } from "@/lib/clusterStatus";

// Display order. Actual set of platforms shown is derived at runtime from
// the cluster's live status + drafts, then filtered by the user's hidden-
// platform preferences. Uses the shared CLUSTER_PLATFORMS constant so the
// canonical order matches other cluster views.
const PLATFORM_ORDER = CLUSTER_PLATFORMS;

const ACTIVE_STATUSES = new Set(["briefing", "generating"]);

const ANGLES = [
  { key: "auto", label: "Auto", tip: "Insider voice on LinkedIn/Medium/X; neutral on Quora and strict subreddits" },
  { key: "insider", label: "Insider", tip: "Openly affiliated voice — first-person experience, casual disclosure when endorsing" },
  { key: "neutral", label: "Neutral", tip: "Independent-practitioner voice — the brand appears as one option among alternatives" },
] as const;

export default function ClusterDetailPage() {
  const router = useRouter();
  const params = useParams<{ brandId: string; clusterId: string }>();
  const brandId = Number(params.brandId);
  const clusterId = Number(params.clusterId);

  const [cluster, setCluster] = useState<ContentClusterDetail | null>(null);
  const [candidate, setCandidate] = useState<PillarCandidate | null>(null);
  const [gaps, setGaps] = useState<ContentGap[]>([]);
  const [loading, setLoading] = useState(true);
  const [regenAction, setRegenAction] = useState<null | "pieces" | "rebuild">(null);
  const [savingAngle, setSavingAngle] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const [c, cand, gapList] = await Promise.all([
          getCluster(brandId, clusterId),
          proposeClusterPillar(brandId, clusterId).catch(() => null),
          getContentGaps(brandId).catch(() => [] as ContentGap[]),
        ]);
        if (!cancelled) {
          setCluster(c);
          setCandidate(cand);
          setGaps(gapList.filter((g) => g.prompt_id === c.prompt_id));
        }
      } catch {
        // Deleted cluster / stale bookmark / 500 — fall through to the
        // "Cluster not found" state instead of spinning forever.
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [brandId, clusterId]);

  // Live-poll while the cluster is in an active phase. When it becomes
  // terminal we refetch the full detail so drafts/brief reflect the new state.
  const { data: liveStatus } = useClusterStatus(brandId, clusterId);
  // View-only platform filter (must be called before any early return — Rules of Hooks).
  const { isVisible } = useHiddenPlatforms(brandId);
  useEffect(() => {
    if (!liveStatus || !cluster) return;
    if (cluster.status === liveStatus.status) return;
    // status transitioned; refresh full detail
    getCluster(brandId, clusterId).then(setCluster);
  }, [liveStatus, brandId, clusterId, cluster]);

  if (loading) {
    return (
      <div className="px-4 sm:px-8 py-8 max-w-[1400px] flex items-center gap-2 text-[var(--text-secondary)]">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading cluster…
      </div>
    );
  }
  if (!cluster) {
    return (
      <div className="px-4 sm:px-8 py-8 max-w-[1400px] text-[#fb7185]">
        Cluster not found.
      </div>
    );
  }

  const effectiveStatus = liveStatus?.status ?? cluster.status;
  const failureReason = liveStatus?.failure_reason ?? null;
  const translatedFailureReason = translateFailureReason(failureReason);
  const isActive = ACTIVE_STATUSES.has(effectiveStatus);
  const isFailed = effectiveStatus === "briefing_failed";
  // Remedy matched by raw machine-reason prefix (translated copy varies too
  // much to match on) — determines which follow-up actions the failure
  // banner offers alongside the always-present Retry.
  const failureRemedy: "sources_or_profile" | "transient" | "generic" =
    failureReason?.startsWith("insufficient_") || failureReason?.startsWith("no_sources_found")
      ? "sources_or_profile"
      : failureReason?.startsWith("search_unavailable")
      ? "transient"
      : "generic";
  // Has this cluster ever been generated? Drives "Generate" vs "Rewrite" copy
  // and whether regeneration is destructive (needs a confirm).
  const hasContent = cluster.drafts.length > 0 || !!cluster.brief;

  const draftsByPlatform = new Map(cluster.drafts.map((d) => [d.platform, d]));
  // Merge any per-piece live state (generation_state, failure_reason) into the
  // detail-page drafts so PieceCard can show pulse pills mid-generation.
  if (liveStatus) {
    for (const p of liveStatus.pieces) {
      const existing = draftsByPlatform.get(p.platform);
      if (existing) {
        draftsByPlatform.set(p.platform, {
          ...existing,
          generation_state: p.generation_state as ContentDraft["generation_state"],
          failure_reason: p.failure_reason,
        });
      }
    }
  }

  // Canonical platform set for this cluster — live status pieces are
  // authoritative (they list every enabled platform); fall back to whatever
  // drafts exist, then to the known order. Ordered by PLATFORM_ORDER for a
  // stable layout, with any unknown platforms appended.
  const platformSet = new Set<string>([
    ...(liveStatus?.pieces.map((p) => p.platform) ?? []),
    ...cluster.drafts.map((d) => d.platform),
  ]);
  const platforms = platformSet.size
    ? [
        ...PLATFORM_ORDER.filter((p) => platformSet.has(p)),
        ...Array.from(platformSet).filter((p) => !PLATFORM_ORDER.includes(p)),
      ]
    : PLATFORM_ORDER;

  // Failed shells are placeholders, not posts — count only drafts that
  // actually produced content so the header doesn't read e.g. "5 of 5 posts"
  // for a cluster with 3 failed pieces.
  const completedDraftsCount = Array.from(draftsByPlatform.values()).filter(
    (d) => d.generation_state !== "failed",
  ).length;

  const delta = cluster.cluster_delta;
  const hasDelta = delta !== null && delta !== undefined;
  // Round first so a 0.04 delta doesn't render as a green "+0.0 pts".
  const deltaRounded = hasDelta ? Math.round(delta! * 10) / 10 : null;
  const deltaTone = deltaRounded === null || deltaRounded === 0
    ? "text-[var(--text-faint)]"
    : deltaRounded > 0
    ? "text-[#4ade80]"
    : "text-[#fb7185]";
  const deltaLabel = deltaRounded === null
    ? "—"
    : deltaRounded === 0
    ? "No lift yet"
    : `${deltaRounded > 0 ? "+" : ""}${deltaRounded.toFixed(1)} pts`;
  const statusLabel = clusterChip({ status: effectiveStatus, version: cluster.version, posted_count: cluster.posted_count, pieces: cluster.drafts.map((d) => ({ platform: d.platform })) }).label;

  function updateDraft(updated: ContentDraft) {
    setCluster((prev) => {
      if (!prev) return prev;
      const drafts = prev.drafts
        .filter((d) => d.platform !== updated.platform)
        .concat(updated);
      return { ...prev, drafts };
    });
  }

  async function onRegeneratePieces() {
    if (
      hasContent &&
      !window.confirm("This replaces the current posts with fresh versions. Continue?")
    ) {
      return;
    }
    setRegenAction("pieces");
    try {
      const updated = await regenerateClusterPieces(brandId, clusterId);
      setCluster(updated);
    } finally {
      setRegenAction(null);
    }
  }

  async function onRebuild() {
    if (
      hasContent &&
      !window.confirm(
        "Start fresh rebuilds the strategy and sources, then replaces every post. Continue?",
      )
    ) {
      return;
    }
    setRegenAction("rebuild");
    try {
      const updated = await rebuildCluster(brandId, clusterId);
      setCluster(updated);
    } finally {
      setRegenAction(null);
    }
  }

  async function setAngle(a: "auto" | "insider" | "neutral") {
    if (!cluster || a === cluster.angle) return;
    setSavingAngle(true);
    try {
      setCluster(await updateClusterAngle(brandId, clusterId, a));
    } finally {
      setSavingAngle(false);
    }
  }

  return (
    <div className="px-4 sm:px-8 py-6 sm:py-8 max-w-[1400px] space-y-6">
      <button
        onClick={() => router.push(`/content/${brandId}`)}
        className="inline-flex items-center gap-1.5 text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to content
      </button>

      <header className="flex items-start justify-between gap-6">
        <div className="min-w-0 flex-1">
          <div className="text-[11px] uppercase tracking-wider text-[var(--text-faint)] font-semibold mb-1.5">
            Cluster
          </div>
          <h1 className="text-2xl font-display text-[var(--text-primary)] leading-tight">
            {cluster.prompt_text}
          </h1>
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-[var(--text-faint)]">
            <span>
              <span className="text-[var(--text-muted)]">Status</span>{" "}
              <span className="text-[var(--text-secondary)] font-medium">{statusLabel}</span>
            </span>
            <span>·</span>
            <span>
              {completedDraftsCount} of {platforms.length} post{platforms.length !== 1 ? 's' : ''}
            </span>
            {cluster.last_generated_at && (
              <>
                <span>·</span>
                <span>
                  Updated {new Date(cluster.last_generated_at).toLocaleDateString()}
                </span>
              </>
            )}
          </div>
          {gaps.length > 0 && (() => {
            const g = gaps[0];
            const top = Object.entries(g.competitor_mentions ?? {})
              .sort((a, b) => b[1] - a[1]).slice(0, 2).map(([n]) => n);
            return (
              <div className="mt-1.5 text-sm text-[var(--text-muted)]">
                {g.prompt_visibility !== null && (
                  <>You appear in <span className="text-[var(--text-secondary)] font-medium">{Math.round(g.prompt_visibility)}%</span> of AI answers here</>
                )}
                {top.length > 0 && <> · <span className="text-[var(--text-secondary)]">{top.join(", ")}</span> {top.length === 1 ? "is" : "are"} winning this question</>}
              </div>
            );
          })()}
          <div className="mt-3 flex flex-wrap gap-2">
            {hasContent ? (
              <>
                <Button
                  size="sm"
                  onClick={onRegeneratePieces}
                  disabled={isActive || regenAction !== null}
                  className="gap-1.5"
                  title="Keep the same strategy and sources; rewrite all posts"
                >
                  {regenAction === "pieces" ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <RefreshCw className="h-3 w-3" />
                  )}
                  Rewrite all posts
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={onRebuild}
                  disabled={isActive || regenAction !== null}
                  className="gap-1.5"
                  title="Start over: rebuild the strategy and sources from scratch, then rewrite all posts"
                >
                  {regenAction === "rebuild" ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <RotateCw className="h-3 w-3" />
                  )}
                  Start fresh
                </Button>
              </>
            ) : (
              <Button
                size="sm"
                onClick={onRebuild}
                disabled={isActive || regenAction !== null}
                className="gap-1.5"
                title="Write a strategy, gather sources, and draft all posts for this question"
              >
                {regenAction !== null ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <Sparkles className="h-3 w-3" />
                )}
                Generate posts
              </Button>
            )}
            <div
              className="flex items-center gap-1 rounded-md border border-[var(--border-subtle)] p-0.5"
              role="radiogroup"
              aria-label="Content voice"
            >
              <span className="px-1.5 text-[11px] text-[var(--text-faint)] font-semibold uppercase tracking-wider">
                Voice
              </span>
              {ANGLES.map((a) => (
                <button
                  key={a.key}
                  role="radio"
                  aria-checked={cluster.angle === a.key}
                  title={a.tip}
                  disabled={savingAngle || isActive}
                  onClick={() => setAngle(a.key)}
                  className={`px-2 py-1 rounded text-xs font-medium transition-colors ${
                    cluster.angle === a.key
                      ? "bg-[var(--bg-card)] text-[var(--text-primary)] border border-[var(--border-subtle)]"
                      : "text-[var(--text-muted)] hover:text-[var(--text-secondary)]"
                  }`}
                >
                  {a.label}
                </button>
              ))}
            </div>
          </div>
          {hasContent && cluster.angle !== "auto" && (
            <div className="mt-1.5 text-xs text-[var(--text-faint)]">
              Applies when you rewrite the posts.
            </div>
          )}
        </div>
        {/* Lift only appears once a post has gone live and been measured —
            otherwise it reads "—" forever. Mirrors the cluster card. */}
        {hasDelta && (
          <div
            className="shrink-0 text-right"
            title="Change in this brand's AI-visibility score for this question since these posts went live"
          >
            <div className={`flex items-center justify-end gap-1.5 text-3xl font-bold ${deltaTone}`}>
              {deltaLabel}
            </div>
            <div className="text-[11px] uppercase tracking-wider text-[var(--text-faint)] font-semibold">
              AI visibility lift
            </div>
          </div>
        )}
      </header>

      {isFailed && (
        <div
          className="rounded-md border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-200 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between"
          title={failureReason ?? undefined}
        >
          <span>
            <strong>Generation failed:</strong>{" "}
            {translatedFailureReason ?? "Something went wrong."}{" "}
            {failureRemedy === "sources_or_profile"
              ? "Add sources you trust or fill in your brand profile, then retry."
              : failureRemedy === "transient"
              ? "This usually clears in a few minutes."
              : null}
          </span>
          <div className="flex items-center gap-3 shrink-0">
            {failureRemedy === "sources_or_profile" && (
              <>
                <Link
                  href={`/content/${brandId}/sources`}
                  className="text-xs underline underline-offset-2 hover:opacity-80"
                >
                  Add sources
                </Link>
                <Link
                  href="/settings?tab=profile"
                  className="text-xs underline underline-offset-2 hover:opacity-80"
                >
                  Fix brand profile
                </Link>
              </>
            )}
            <Button
              size="sm"
              variant="outline"
              onClick={onRebuild}
              disabled={isActive || regenAction !== null}
              className="gap-1.5"
            >
              {regenAction !== null ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <RotateCw className="h-3 w-3" />
              )}
              Retry
            </Button>
          </div>
        </div>
      )}

      {/* ZONE 1 — Posts (the primary action) */}
      <div>
        <div className="text-[11px] uppercase tracking-wider text-[var(--text-faint)] font-semibold mb-3">
          Posts
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {platforms.filter((p) => isVisible(p)).map((platform) =>
            platform === "owned_site" ? (
              <OwnedSiteCard
                key={platform}
                brandId={brandId}
                cluster={cluster}
                candidate={candidate}
                draft={draftsByPlatform.get(platform) ?? null}
                onClusterUpdated={(c) => setCluster(c)}
                onDraftUpdated={updateDraft}
              />
            ) : (
              <PieceCard
                key={platform}
                brandId={brandId}
                clusterId={cluster.id}
                platform={platform}
                draft={draftsByPlatform.get(platform) ?? null}
                onUpdated={updateDraft}
              />
            ),
          )}
        </div>
      </div>

      {cluster.drafts.some(d => d.status === "posted" && isVisible(d.platform)) && (
        <div>
          <div className="text-[11px] uppercase tracking-wider text-[var(--text-faint)] font-semibold mb-3">
            Posted history
          </div>
          <div className="space-y-2">
            {cluster.drafts
              .filter(d => d.status === "posted" && isVisible(d.platform))
              .sort((a, b) => (b.posted_at ?? "").localeCompare(a.posted_at ?? ""))
              .map(d => (
                <div key={d.id} className="flex items-center gap-3 text-xs text-[var(--text-secondary)]">
                  <PlatformBadge platform={d.platform} size="sm" />
                  <span>{d.posted_at ? new Date(d.posted_at).toLocaleDateString() : "—"}</span>
                  {d.posted_url && (
                    <a href={d.posted_url} target="_blank" rel="noopener noreferrer" className="text-[var(--accent-foreground)] hover:underline">
                      View ↗
                    </a>
                  )}
                  {d.brief_version != null && (
                    <span className="text-[var(--text-faint)]">from brief v{d.brief_version}</span>
                  )}
                  {d.attribution_delta != null && (() => {
                    const r = Math.round(d.attribution_delta * 10) / 10;
                    return (
                      <span className={r === 0 ? "text-[var(--text-faint)]" : r > 0 ? "text-[#4ade80]" : "text-[#fb7185]"}>
                        {r === 0 ? "no change" : `${r > 0 ? "+" : ""}${r.toFixed(1)} pts`}
                      </span>
                    );
                  })()}
                </div>
              ))}
          </div>
        </div>
      )}

      {/* ZONE 2 — Brief + Source spine (supporting context, collapsed by default) */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <BriefPanel
          brandId={brandId}
          clusterId={cluster.id}
          brief={cluster.brief}
          currentVersion={cluster.brief?.version}
          onUpdated={(b) => setCluster((c) => (c ? { ...c, brief: b } : c))}
          onRegeneratePieces={onRegeneratePieces}
        />
        <div className="card !p-0 overflow-hidden">
          <div className="px-5 py-3 border-b border-[var(--border-subtle)] flex items-center justify-between">
            <span className="text-[11px] uppercase tracking-wider text-[var(--text-faint)] font-semibold">
              Sources
            </span>
          </div>
          <div className="p-5">
            <SourceSpinePanel brandId={brandId} clusterId={cluster.id} />
          </div>
        </div>
      </div>
    </div>
  );
}
