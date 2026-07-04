"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { Loader2, ChevronDown } from "lucide-react";
import {
  getBrand,
  listClusters,
  regenerateClusterByPrompt,
  type BrandDetail,
  type ContentClusterSummary,
} from "@/lib/api";
import { ClusterCard } from "@/components/content/cluster/ClusterCard";
import { useHiddenPlatforms } from "@/lib/useHiddenPlatforms";
import { CLUSTER_PLATFORMS, CLUSTER_PLATFORM_LABELS } from "@/lib/clusterPlatforms";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuCheckboxItem,
} from "@/components/ui/dropdown-menu";

type SortKey = "visibility" | "updated" | "version";
type FilterKey = "all" | "needs_attention" | "ready" | "in_progress" | "failed";

const FILTER_LABEL: Record<FilterKey, string> = {
  all: "All",
  needs_attention: "Needs attention",
  ready: "Ready",
  in_progress: "In progress",
  failed: "Failed",
};

const SORT_LABEL: Record<SortKey, string> = {
  visibility: "Visibility ↑",
  updated: "Last updated",
  version: "Latest version",
};

// Shared trigger styling for the toolbar dropdowns.
const TOOLBAR_TRIGGER =
  "inline-flex items-center gap-1.5 rounded-md border border-[var(--border-subtle)] " +
  "px-2.5 py-1.5 text-xs text-[var(--text-secondary)] transition-colors " +
  "hover:text-[var(--text-primary)] hover:border-[var(--text-faint)] cursor-pointer " +
  "focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--text-faint)]/40 " +
  "data-[state=open]:border-[var(--text-faint)] data-[state=open]:text-[var(--text-primary)]";

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
  const { hidden, toggle, isVisible } = useHiddenPlatforms(brandId);
  const platformsVisible = CLUSTER_PLATFORMS.filter((p) => !hidden.has(p)).length;

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

      <div className="flex flex-wrap items-center gap-2">
        {/* Sort */}
        <DropdownMenu>
          <DropdownMenuTrigger className={TOOLBAR_TRIGGER}>
            <span className="text-[var(--text-faint)]">Sort</span>
            <span className="font-medium text-[var(--text-primary)]">{SORT_LABEL[sortBy]}</span>
            <ChevronDown className="h-3.5 w-3.5 text-[var(--text-faint)]" aria-hidden />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="min-w-[9rem]">
            <DropdownMenuRadioGroup value={sortBy} onValueChange={(v) => setSortBy(v as SortKey)}>
              {(Object.keys(SORT_LABEL) as SortKey[]).map((k) => (
                <DropdownMenuRadioItem key={k} value={k}>
                  {SORT_LABEL[k]}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>

        {/* Status filter */}
        <DropdownMenu>
          <DropdownMenuTrigger className={TOOLBAR_TRIGGER}>
            <span className="text-[var(--text-faint)]">Status</span>
            <span className="font-medium text-[var(--text-primary)]">{FILTER_LABEL[filter]}</span>
            <ChevronDown className="h-3.5 w-3.5 text-[var(--text-faint)]" aria-hidden />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="min-w-[10rem]">
            <DropdownMenuRadioGroup value={filter} onValueChange={(v) => setFilter(v as FilterKey)}>
              {(Object.keys(FILTER_LABEL) as FilterKey[]).map((k) => (
                <DropdownMenuRadioItem key={k} value={k}>
                  {FILTER_LABEL[k]}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>

        {/* Platform visibility — view only, hides pieces inside cards */}
        <DropdownMenu>
          <DropdownMenuTrigger className={TOOLBAR_TRIGGER}>
            <span className="text-[var(--text-faint)]">Platforms</span>
            <span className="font-medium text-[var(--text-primary)]">
              {platformsVisible === CLUSTER_PLATFORMS.length
                ? "All"
                : `${platformsVisible}/${CLUSTER_PLATFORMS.length}`}
            </span>
            <ChevronDown className="h-3.5 w-3.5 text-[var(--text-faint)]" aria-hidden />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="min-w-[10rem]">
            <DropdownMenuLabel className="text-[10px] font-normal uppercase tracking-wider text-[var(--text-faint)]">
              Show in cards
            </DropdownMenuLabel>
            {CLUSTER_PLATFORMS.map((p) => (
              <DropdownMenuCheckboxItem
                key={p}
                checked={!hidden.has(p)}
                onCheckedChange={() => toggle(p)}
                onSelect={(e) => e.preventDefault()}
              >
                {CLUSTER_PLATFORM_LABELS[p]}
              </DropdownMenuCheckboxItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
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
              cluster={{ ...c, pieces: c.pieces.filter((p) => isVisible(p.platform)) }}
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
