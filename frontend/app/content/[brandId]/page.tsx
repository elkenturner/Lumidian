"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import {
  getBrand,
  listClusters,
  regenerateClusterByPrompt,
  type BrandDetail,
  type ContentClusterSummary,
} from "@/lib/api";
import { ClusterCard } from "@/components/content/cluster/ClusterCard";

type SortKey = "visibility" | "updated" | "version";
type FilterKey = "all" | "needs_attention" | "ready" | "in_progress" | "failed";

const FILTER_LABEL: Record<FilterKey, string> = {
  all: "All",
  needs_attention: "Needs attention",
  ready: "Ready",
  in_progress: "In progress",
  failed: "Failed",
};

function filterPredicate(cluster: ContentClusterSummary, f: FilterKey): boolean {
  if (f === "all") return true;
  if (f === "ready") return cluster.status === "ready";
  if (f === "in_progress") return cluster.status === "briefing" || cluster.status === "generating";
  if (f === "failed") return cluster.status === "briefing_failed" || cluster.status === "generation_partial" || cluster.status === "partial_failed";
  // needs_attention = ready but low visibility
  if (f === "needs_attention") return cluster.status === "ready" && cluster.visibility_pct < 50;
  return true;
}

export default function ContentBrandPage() {
  const params = useParams<{ brandId: string }>();
  const router = useRouter();
  const brandId = Number(params?.brandId);

  const [brand, setBrand] = useState<BrandDetail | null>(null);
  const [clusters, setClusters] = useState<ContentClusterSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [sortBy, setSortBy] = useState<SortKey>("visibility");
  const [filter, setFilter] = useState<FilterKey>("all");
  const [regeneratingPromptId, setRegeneratingPromptId] = useState<number | null>(null);

  useEffect(() => {
    if (!Number.isFinite(brandId)) return;
    let cancelled = false;
    async function load() {
      try {
        const [b, cs] = await Promise.all([
          getBrand(brandId),
          listClusters(brandId),
        ]);
        if (!cancelled) {
          setBrand(b);
          setClusters(cs);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [brandId]);

  const visible = useMemo(() => {
    const arr = clusters.filter((c) => filterPredicate(c, filter));
    if (sortBy === "visibility") {
      arr.sort((a, b) => a.visibility_pct - b.visibility_pct);
    } else if (sortBy === "updated") {
      arr.sort((a, b) => {
        const at = a.last_generated_at ? new Date(a.last_generated_at).getTime() : 0;
        const bt = b.last_generated_at ? new Date(b.last_generated_at).getTime() : 0;
        return bt - at;
      });
    } else if (sortBy === "version") {
      arr.sort((a, b) => b.version - a.version);
    }
    return arr;
  }, [clusters, filter, sortBy]);

  async function onRegenerate(clusterId: number) {
    const cluster = clusters.find((c) => c.id === clusterId);
    if (!cluster) return;
    setRegeneratingPromptId(cluster.prompt_id);
    try {
      await regenerateClusterByPrompt(brandId, cluster.prompt_id);
      const fresh = await listClusters(brandId);
      setClusters(fresh);
    } finally {
      setRegeneratingPromptId(null);
    }
  }

  if (!Number.isFinite(brandId)) {
    return (
      <div className="px-4 sm:px-8 py-8 max-w-[1400px] text-[#fb7185]">
        Invalid brand.
      </div>
    );
  }

  if (loading) {
    return (
      <div className="px-4 sm:px-8 py-8 max-w-[1400px] flex items-center gap-2 text-[var(--text-secondary)]">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading clusters…
      </div>
    );
  }

  return (
    <div className="px-4 sm:px-8 py-6 sm:py-8 max-w-[1400px] space-y-6">
      <header>
        <div className="text-[11px] uppercase tracking-wider text-[var(--text-faint)] font-semibold mb-1.5">
          Content
        </div>
        <h1 className="text-2xl font-bold text-[var(--text-primary)] leading-tight">
          {brand?.name ?? "Brand"}
        </h1>
        <p className="mt-1.5 text-sm text-[var(--text-secondary)]">
          One cluster per tracked prompt. Click into a cluster to view brief, sources, and pieces.
        </p>
      </header>

      <div className="flex flex-wrap items-center gap-3 text-xs">
        <div className="flex items-center gap-1.5 text-[var(--text-faint)]">
          <span>Sort:</span>
          {(["visibility", "updated", "version"] as SortKey[]).map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => setSortBy(k)}
              className={`px-2 py-1 rounded ${sortBy === k ? "bg-[var(--bg-card)] text-[var(--text-primary)] font-medium" : "text-[var(--text-secondary)] hover:text-[var(--text-primary)]"}`}
            >
              {k === "visibility" ? "Visibility ↑" : k === "updated" ? "Last updated" : "Latest version"}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1.5 text-[var(--text-faint)]">
          <span>Filter:</span>
          {(Object.keys(FILTER_LABEL) as FilterKey[]).map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => setFilter(k)}
              className={`px-2 py-1 rounded ${filter === k ? "bg-[var(--bg-card)] text-[var(--text-primary)] font-medium" : "text-[var(--text-secondary)] hover:text-[var(--text-primary)]"}`}
            >
              {FILTER_LABEL[k]}
            </button>
          ))}
        </div>
      </div>

      {visible.length === 0 ? (
        <div className="card border-dashed text-sm text-[var(--text-secondary)] text-center py-10">
          {clusters.length === 0
            ? "No clusters yet. Generate one from a tracked prompt to get started."
            : "No clusters match the current filter."}
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {visible.map((c) => (
            <ClusterCard
              key={c.id}
              brandId={brandId}
              cluster={c}
              onRegenerate={onRegenerate}
              regenerating={regeneratingPromptId === c.prompt_id}
            />
          ))}
        </div>
      )}

      <div className="pt-8 mt-8 border-t border-[var(--border-subtle)]">
        <button
          type="button"
          onClick={() => router.push(`/content/${brandId}/archive`)}
          className="text-xs text-[var(--text-faint)] hover:text-[var(--text-secondary)]"
        >
          View legacy posted drafts ↗
        </button>
      </div>
    </div>
  );
}
