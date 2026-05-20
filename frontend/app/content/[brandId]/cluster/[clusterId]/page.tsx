"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft, Loader2, TrendingDown, TrendingUp } from "lucide-react";
import {
  getCluster,
  proposeClusterPillar,
  type ContentClusterDetail,
  type ContentDraft,
  type PillarCandidate,
} from "@/lib/api";
import { BriefPanel } from "@/components/content/cluster/BriefPanel";
import { PieceCard } from "@/components/content/cluster/PieceCard";
import { PillarCard } from "@/components/content/cluster/PillarCard";

const PLATFORMS = ["linkedin", "medium", "reddit", "quora", "x"] as const;

const STATUS_LABEL: Record<string, string> = {
  pending: "Pending",
  briefing: "Briefing",
  generating: "Generating",
  ready: "Ready",
  partial_failed: "Partial failure",
};

export default function ClusterDetailPage() {
  const router = useRouter();
  const params = useParams<{ brandId: string; clusterId: string }>();
  const brandId = Number(params.brandId);
  const clusterId = Number(params.clusterId);

  const [cluster, setCluster] = useState<ContentClusterDetail | null>(null);
  const [candidate, setCandidate] = useState<PillarCandidate | null>(null);
  const [loading, setLoading] = useState(true);

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

  const draftsByPlatform = new Map(cluster.drafts.map((d) => [d.platform, d]));
  const visibility = Math.round(cluster.visibility_pct);
  const visibilityTone =
    visibility >= 60
      ? "text-[#4ade80]"
      : visibility >= 30
      ? "text-[#fbbf24]"
      : "text-[#fb7185]";
  const statusLabel = STATUS_LABEL[cluster.status] ?? cluster.status.replace("_", " ");

  function updateDraft(updated: ContentDraft) {
    setCluster((prev) => {
      if (!prev) return prev;
      const drafts = prev.drafts
        .filter((d) => d.platform !== updated.platform)
        .concat(updated);
      return { ...prev, drafts };
    });
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

      <BriefPanel
        brandId={brandId}
        clusterId={cluster.id}
        brief={cluster.brief}
        onUpdated={(b) => setCluster((c) => (c ? { ...c, brief: b } : c))}
      />

      <PillarCard
        brandId={brandId}
        cluster={cluster}
        candidate={candidate}
        onClusterUpdated={(c) => setCluster(c)}
      />

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
    </div>
  );
}
