"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft, Loader2 } from "lucide-react";
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
      <div className="p-8 flex items-center gap-2 text-slate-500">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading cluster…
      </div>
    );
  }
  if (!cluster) {
    return <div className="p-8 text-rose-700">Cluster not found.</div>;
  }

  const draftsByPlatform = new Map(cluster.drafts.map((d) => [d.platform, d]));

  function updateDraft(updated: ContentDraft) {
    setCluster((prev) => {
      if (!prev) return prev;
      const drafts = prev.drafts.filter((d) => d.platform !== updated.platform).concat(updated);
      return { ...prev, drafts };
    });
  }

  return (
    <div className="max-w-6xl mx-auto p-6 space-y-6">
      <button
        onClick={() => router.push(`/content/${brandId}`)}
        className="flex items-center gap-1 text-sm text-slate-600 hover:text-slate-900"
      >
        <ArrowLeft className="h-4 w-4" /> Back to content
      </button>

      <header>
        <h1 className="text-2xl font-bold text-slate-900">{cluster.prompt_text}</h1>
        <p className="mt-1 text-sm text-slate-500">
          Status: <span className="font-medium capitalize">{cluster.status.replace("_", " ")}</span>
          {" · "}Visibility: <span className="font-medium">{Math.round(cluster.visibility_pct)}%</span>
        </p>
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
  );
}
