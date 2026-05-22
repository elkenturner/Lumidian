"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  ArrowLeft,
  Loader2,
  RefreshCw,
  RotateCw,
  TrendingDown,
  TrendingUp,
} from "lucide-react";
import {
  getCluster,
  proposeClusterPillar,
  rebuildCluster,
  regenerateClusterPieces,
  type ContentClusterDetail,
  type ContentDraft,
  type PillarCandidate,
} from "@/lib/api";
import { BriefPanel } from "@/components/content/cluster/BriefPanel";
import { InputsZone } from "@/components/content/cluster/InputsZone";
import { PieceCard } from "@/components/content/cluster/PieceCard";
import { PillarCard } from "@/components/content/cluster/PillarCard";
import { SourceSpinePanel } from "@/components/content/cluster/SourceSpinePanel";
import { useClusterStatus } from "@/hooks/useClusterStatus";

const PLATFORMS = ["linkedin", "medium", "reddit", "quora", "x"] as const;

const STATUS_LABEL: Record<string, string> = {
  pending: "Pending",
  briefing: "Briefing",
  briefing_failed: "Briefing failed",
  generating: "Generating",
  generation_partial: "Partial generation",
  ready: "Ready",
  // Legacy — superseded by `generation_partial`. Kept for one release of
  // grace until any in-flight clusters from before the migration drain.
  partial_failed: "Partial failure",
};

const ACTIVE_STATUSES = new Set(["briefing", "generating"]);

export default function ClusterDetailPage() {
  const router = useRouter();
  const params = useParams<{ brandId: string; clusterId: string }>();
  const brandId = Number(params.brandId);
  const clusterId = Number(params.clusterId);

  const [cluster, setCluster] = useState<ContentClusterDetail | null>(null);
  const [candidate, setCandidate] = useState<PillarCandidate | null>(null);
  const [loading, setLoading] = useState(true);
  const [regenAction, setRegenAction] = useState<null | "pieces" | "rebuild">(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const [c, cand] = await Promise.all([
        getCluster(brandId, clusterId),
        proposeClusterPillar(brandId, clusterId).catch(() => null),
      ]);
      if (!cancelled) {
        setCluster(c);
        setCandidate(cand);
        setLoading(false);
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
  const isActive = ACTIVE_STATUSES.has(effectiveStatus);
  const isFailed = effectiveStatus === "briefing_failed";

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

  const visibility = Math.round(cluster.visibility_pct);
  const visibilityTone =
    visibility >= 60
      ? "text-[#4ade80]"
      : visibility >= 30
      ? "text-[#fbbf24]"
      : "text-[#fb7185]";
  const statusLabel = STATUS_LABEL[effectiveStatus] ?? effectiveStatus.replace("_", " ");

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
    setRegenAction("pieces");
    try {
      const updated = await regenerateClusterPieces(brandId, clusterId);
      setCluster(updated);
    } finally {
      setRegenAction(null);
    }
  }

  async function onRebuild() {
    setRegenAction("rebuild");
    try {
      const updated = await rebuildCluster(brandId, clusterId);
      setCluster(updated);
    } finally {
      setRegenAction(null);
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
          <h1 className="text-2xl font-bold text-[var(--text-primary)] leading-tight">
            {cluster.prompt_text}
          </h1>
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-[var(--text-faint)]">
            <span>
              <span className="text-[var(--text-muted)]">Status</span>{" "}
              <span className="text-[var(--text-secondary)] font-medium">{statusLabel}</span>
              {failureReason && (
                <span className="ml-2 text-[#fb7185]">— {failureReason}</span>
              )}
            </span>
            <span>·</span>
            <span>
              {cluster.drafts.length} of {PLATFORMS.length} pieces
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
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={onRegeneratePieces}
              disabled={isActive || regenAction !== null}
              className="btn btn-primary !py-1.5 text-xs inline-flex items-center gap-1.5"
              title="Reuse the current brief and evidence pack; rewrite all 5 pieces"
            >
              {regenAction === "pieces" ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <RefreshCw className="h-3 w-3" />
              )}
              Regenerate pieces
            </button>
            <button
              type="button"
              onClick={onRebuild}
              disabled={isActive || regenAction !== null}
              className="btn btn-secondary !py-1.5 text-xs inline-flex items-center gap-1.5"
              title="Re-run the brief LLM, rebuild the evidence pack, then rewrite all 5 pieces"
            >
              {regenAction === "rebuild" ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <RotateCw className="h-3 w-3" />
              )}
              Rebuild brief &amp; pieces
            </button>
          </div>
        </div>
        <div className={`shrink-0 text-right ${visibilityTone}`}>
          <div className="flex items-center justify-end gap-1.5 text-3xl font-bold">
            {visibility >= 50 ? (
              <TrendingUp className="h-6 w-6" />
            ) : (
              <TrendingDown className="h-6 w-6" />
            )}
            {visibility}%
          </div>
          <div className="text-[11px] uppercase tracking-wider text-[var(--text-faint)] font-semibold">
            Visibility
          </div>
        </div>
      </header>

      {isFailed && failureReason && (
        <div className="rounded-md border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
          <strong>Briefing failed:</strong> {failureReason}. Edit the brief or try rebuilding.
        </div>
      )}

      {/* ZONE 1 — Brief + Source spine */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <BriefPanel
          brandId={brandId}
          clusterId={cluster.id}
          brief={cluster.brief}
          currentVersion={cluster.brief?.version}
          onUpdated={(b) => setCluster((c) => (c ? { ...c, brief: b } : c))}
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

      {/* ZONE 2 — Pieces */}
      <div>
        <div className="text-[11px] uppercase tracking-wider text-[var(--text-faint)] font-semibold mb-3">
          Pieces
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {PLATFORMS.map((platform) => (
            <PieceCard
              key={platform}
              brandId={brandId}
              clusterId={cluster.id}
              platform={platform}
              draft={draftsByPlatform.get(platform) ?? null}
              onUpdated={updateDraft}
            />
          ))}
        </div>
      </div>

      {/* ZONE 3 — Inputs (Pillar / Opportunities / Gaps) */}
      <InputsZone
        pillar={
          candidate || cluster.pillar_mode !== "none" ? (
            <PillarCard
              brandId={brandId}
              cluster={cluster}
              candidate={candidate}
              onClusterUpdated={(c) => setCluster(c)}
            />
          ) : undefined
        }
        opportunities={undefined}
        gaps={undefined}
      />
    </div>
  );
}
