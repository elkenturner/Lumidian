"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import {
  ArrowLeft,
  Loader2,
  RefreshCw,
  RotateCw,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  deleteDraft,
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
import { MarkdownContent } from "@/components/content/MarkdownContent";
import { bodyWithoutDuplicateH1, splitOwnedSiteDraft } from "@/lib/ownedSiteDraft";
import { DeletePostedDialog } from "@/components/content/cluster/DeletePostedDialog";
import { OwnedSiteCard } from "@/components/content/cluster/OwnedSiteCard";
import { PieceCard } from "@/components/content/cluster/PieceCard";
import { SourceSpinePanel } from "@/components/content/cluster/SourceSpinePanel";
import PlatformBadge from "@/components/PlatformBadge";
import { useClusterStatus } from "@/hooks/useClusterStatus";
import { CLUSTER_PLATFORMS } from "@/lib/clusterPlatforms";
import { useHiddenPlatforms } from "@/lib/useHiddenPlatforms";
import { CHIP_CLASSES, clusterChip, translateFailureReason } from "@/lib/clusterStatus";
import { parseUTCISO } from "@/lib/utils/formatting";

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
  // Posted-history rows open the archived text in a read-only modal.
  const [viewingDraft, setViewingDraft] = useState<ContentDraft | null>(null);
  // Posted record pending delete confirmation.
  const [deletingDraft, setDeletingDraft] = useState<ContentDraft | null>(null);
  const [savingAngle, setSavingAngle] = useState(false);
  // Which regeneration is awaiting confirmation (only asked once content exists).
  const [confirmRegen, setConfirmRegen] = useState<null | "pieces" | "rebuild">(null);

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

  // Always render the canonical platform set (plus any unknown platforms a
  // draft carries, appended after). Deriving the set from existing drafts
  // alone made a platform's card vanish once its only draft was deleted,
  // taking the per-platform Generate button with it.
  const platformSet = new Set<string>([
    ...(liveStatus?.pieces.map((p) => p.platform) ?? []),
    ...cluster.drafts.map((d) => d.platform),
  ]);
  const platforms = [
    ...PLATFORM_ORDER,
    ...Array.from(platformSet).filter((p) => !PLATFORM_ORDER.includes(p)),
  ];

  // Failed shells are placeholders, not posts — count only drafts that
  // actually produced content. Counted over the VISIBLE platforms so the
  // header agrees with the number of cards rendered below when the user has
  // hidden platforms via the view filter.
  const visiblePlatforms = platforms.filter((p) => isVisible(p));
  const completedDraftsCount = visiblePlatforms.filter((p) => {
    const d = draftsByPlatform.get(p);
    return d && d.generation_state !== "failed";
  }).length;

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
  const statusChip = clusterChip({ status: effectiveStatus, version: cluster.version, posted_count: cluster.posted_count, pieces: cluster.drafts.map((d) => ({ platform: d.platform, status: d.status })) });

  function updateDraft(updated: ContentDraft) {
    setCluster((prev) => {
      if (!prev) return prev;
      const drafts = prev.drafts
        .filter((d) => d.platform !== updated.platform)
        .concat(updated);
      return { ...prev, drafts };
    });
  }

  // Deletions change more than the draft list (posted counts, pillar state),
  // so refetch the whole cluster rather than patching locally.
  async function refetchCluster() {
    setCluster(await getCluster(brandId, clusterId));
  }

  async function confirmDeletePosted() {
    if (!deletingDraft) return;
    await deleteDraft(deletingDraft.id);
    setDeletingDraft(null);
    if (viewingDraft?.id === deletingDraft.id) setViewingDraft(null);
    await refetchCluster();
  }

  async function onRegeneratePieces() {
    setConfirmRegen(null);
    setRegenAction("pieces");
    try {
      const updated = await regenerateClusterPieces(brandId, clusterId);
      setCluster(updated);
    } finally {
      setRegenAction(null);
    }
  }

  async function onRebuild() {
    setConfirmRegen(null);
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
            Tracked question
          </div>
          <h1 className="text-2xl font-display text-[var(--text-primary)] leading-tight">
            {cluster.prompt_text}
          </h1>
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-[var(--text-faint)]">
            <span className={`text-[11px] px-2 py-0.5 rounded-md ${CHIP_CLASSES[statusChip.tone]}`}>
              {statusChip.label}
            </span>
            <span>·</span>
            <span>
              {completedDraftsCount} of {visiblePlatforms.length} post{visiblePlatforms.length !== 1 ? 's' : ''} written
            </span>
            {cluster.last_generated_at && (
              <>
                <span>·</span>
                <span>
                  Updated {parseUTCISO(cluster.last_generated_at).toLocaleDateString()}
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
                  onClick={() => setConfirmRegen("pieces")}
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
                  onClick={() => setConfirmRegen("rebuild")}
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
          {/* The voice choice decides which account the user should post from,
              so its meaning can't live in hover tooltips alone. */}
          <div className="mt-1.5 text-xs text-[var(--text-faint)]">
            {ANGLES.find((a) => a.key === cluster.angle)?.tip}. Takes effect when posts are written or rewritten.
          </div>
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
            <div className="text-[10px] text-[var(--text-faint)]">
              percentage points, since posting
            </div>
          </div>
        )}
      </header>

      <Dialog open={confirmRegen !== null} onOpenChange={(open) => !open && setConfirmRegen(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {confirmRegen === "rebuild" ? "Start fresh?" : "Rewrite all posts?"}
            </DialogTitle>
            <DialogDescription>
              {confirmRegen === "rebuild"
                ? "This re-researches sources and strategy from scratch, then replaces every unposted draft. Use it after adding new sources or if the current posts miss the mark entirely. Posted pieces stay live."
                : "This keeps the current strategy and sources and writes fresh versions of every unposted draft. Posted pieces stay live and keep their measured lift."}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" size="sm" onClick={() => setConfirmRegen(null)}>
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={confirmRegen === "rebuild" ? onRebuild : onRegeneratePieces}
            >
              {confirmRegen === "rebuild" ? "Start fresh" : "Rewrite all posts"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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
          {visiblePlatforms.map((platform) =>
            platform === "owned_site" ? (
              <OwnedSiteCard
                key={platform}
                brandId={brandId}
                cluster={cluster}
                candidate={candidate}
                draft={draftsByPlatform.get(platform) ?? null}
                onClusterUpdated={(c) => setCluster(c)}
                onDraftUpdated={updateDraft}
                onDraftDeleted={refetchCluster}
              />
            ) : (
              <PieceCard
                key={platform}
                brandId={brandId}
                clusterId={cluster.id}
                platform={platform}
                draft={draftsByPlatform.get(platform) ?? null}
                onUpdated={updateDraft}
                onDeleted={refetchCluster}
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
          <div className="card !p-0 overflow-hidden divide-y divide-[var(--border-subtle)]">
            {cluster.drafts
              .filter(d => d.status === "posted" && isVisible(d.platform))
              .sort((a, b) => (b.posted_at ?? "").localeCompare(a.posted_at ?? ""))
              .map(d => (
                // div-with-role rather than <button>: the row contains its own
                // interactive children (live link, delete), and nesting those
                // inside a real button is invalid HTML that breaks hydration.
                <div
                  key={d.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => setViewingDraft(d)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      setViewingDraft(d);
                    }
                  }}
                  title="Read what was posted"
                  className="w-full px-4 py-2.5 flex items-center gap-3 text-left cursor-pointer hover:bg-[var(--bg-card)] transition-colors"
                >
                  <PlatformBadge platform={d.platform} size="sm" />
                  <span className="min-w-0 flex-1 truncate text-sm text-[var(--text-secondary)]">
                    {d.title && d.title !== "(untitled)" ? d.title : (d.content_text || "").slice(0, 90)}
                  </span>
                  <span className="shrink-0 text-xs text-[var(--text-faint)]">
                    {d.posted_at ? parseUTCISO(d.posted_at).toLocaleDateString() : "—"}
                  </span>
                  {d.attribution_delta != null && (() => {
                    const r = Math.round(d.attribution_delta * 10) / 10;
                    return (
                      <span className={`shrink-0 text-xs ${r === 0 ? "text-[var(--text-faint)]" : r > 0 ? "text-[#4ade80]" : "text-[#fb7185]"}`}>
                        {r === 0 ? "no lift yet" : `${r > 0 ? "+" : ""}${r.toFixed(1)} pts`}
                      </span>
                    );
                  })()}
                  {d.posted_url && (
                    <a
                      href={d.posted_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={(e) => e.stopPropagation()}
                      className="shrink-0 text-xs text-[var(--accent-foreground)] hover:underline"
                    >
                      View live ↗
                    </a>
                  )}
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setDeletingDraft(d);
                    }}
                    title="Delete this posted record (the live post stays up)"
                    aria-label="Delete this posted record"
                    className="shrink-0 p-1 rounded text-[var(--text-faint)] hover:text-[#fb7185] hover:bg-[rgba(244,63,94,0.10)] transition-colors"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
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
      {viewingDraft && createPortal(
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
          onClick={() => setViewingDraft(null)}
        >
          <div
            className="card-elevated w-full max-w-2xl max-h-[85vh] flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3 mb-4">
              <div className="flex items-center gap-2 min-w-0 flex-wrap">
                <PlatformBadge platform={viewingDraft.platform} />
                <span className="text-xs text-[var(--text-faint)]">
                  Posted {viewingDraft.posted_at ? parseUTCISO(viewingDraft.posted_at).toLocaleDateString() : "—"}
                  {viewingDraft.brief_version != null ? ` · strategy v${viewingDraft.brief_version}` : ""}
                </span>
              </div>
              <Button variant="ghost" size="sm" onClick={() => setViewingDraft(null)} className="!px-1.5" aria-label="Close">
                <X className="h-4 w-4" />
              </Button>
            </div>
            {viewingDraft.title && viewingDraft.title !== "(untitled)" && (
              <h3 className="text-lg font-bold text-[var(--text-primary)] mb-3">{viewingDraft.title}</h3>
            )}
            <div className="flex-1 min-h-0 overflow-y-auto pr-2">
              {viewingDraft.platform === "owned_site" ? (
                <MarkdownContent
                  markdown={bodyWithoutDuplicateH1(
                    splitOwnedSiteDraft(viewingDraft.content_text).body,
                    viewingDraft.title
                  )}
                />
              ) : (
                <div className="whitespace-pre-wrap text-sm text-[var(--text-secondary)] leading-relaxed">
                  {viewingDraft.content_text}
                </div>
              )}
            </div>
            {viewingDraft.posted_url && (
              <div className="mt-4 pt-4 border-t border-[var(--border-subtle)]">
                <a href={viewingDraft.posted_url} target="_blank" rel="noopener noreferrer" className="text-sm text-[var(--accent-foreground)] hover:underline">
                  View live post ↗
                </a>
              </div>
            )}
          </div>
        </div>,
        document.body
      )}
      {deletingDraft && (
        <DeletePostedDialog
          draft={deletingDraft}
          onConfirm={confirmDeletePosted}
          onClose={() => setDeletingDraft(null)}
        />
      )}
    </div>
  );
}
