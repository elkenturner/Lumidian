"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { Loader2, Sparkles } from "lucide-react";
import {
  getBrand,
  generateNow,
  getDraftStatusFresh,
  listClusters,
  regenerateClusterByPrompt,
  type BrandDetail,
  type ContentClusterSummary,
} from "@/lib/api";
import { Button } from "@/components/ui/button";
import { ClusterCard } from "@/components/content/cluster/ClusterCard";
import { PlatformFilter } from "@/components/content/cluster/PlatformFilter";
import { clusterHasContent } from "@/lib/clusterStatus";
import { useHiddenPlatforms } from "@/lib/useHiddenPlatforms";

type SortKey = "visibility" | "updated";
type FilterKey = "all" | "not_started" | "needs_attention" | "ready" | "in_progress" | "failed";

const SORT_LABEL: Record<SortKey, string> = {
  visibility: "Lowest visibility",
  updated: "Last updated",
};

const FILTER_LABEL: Record<FilterKey, string> = {
  all: "All",
  not_started: "Not started",
  needs_attention: "Needs attention",
  ready: "Ready",
  in_progress: "In progress",
  failed: "Failed",
};

function isFailedStatus(status: string): boolean {
  return (
    status === "briefing_failed" ||
    status === "generation_partial" ||
    status === "partial_failed"
  );
}

function isReadyStatus(status: string): boolean {
  return status === "ready" || status === "ready_low_evidence";
}

function filterPredicate(cluster: ContentClusterSummary, f: FilterKey): boolean {
  if (f === "all") return true;
  if (f === "not_started") return !clusterHasContent(cluster);
  if (f === "ready") return isReadyStatus(cluster.status);
  if (f === "in_progress") return cluster.status === "briefing" || cluster.status === "generating";
  if (f === "failed") return isFailedStatus(cluster.status);
  // needs_attention = anything that wants the user: never started, failed, or
  // ready-but-underperforming. (The old definition excluded all of these.)
  if (f === "needs_attention") {
    return (
      !clusterHasContent(cluster) ||
      isFailedStatus(cluster.status) ||
      (isReadyStatus(cluster.status) && cluster.visibility_pct < 50)
    );
  }
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
  const [generating, setGenerating] = useState(false);
  const [genError, setGenError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState(false);
  const { hidden, toggle, isVisible } = useHiddenPlatforms(brandId);

  useEffect(() => {
    if (!Number.isFinite(brandId)) return;
    let cancelled = false;
    async function load() {
      try {
        const [b, cs] = await Promise.all([getBrand(brandId), listClusters(brandId)]);
        if (!cancelled) {
          setBrand(b);
          setClusters(cs);
          setLoadError(false);
        }
      } catch {
        if (!cancelled) setLoadError(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [brandId]);

  // Live polling while a brand-level generation sweep runs: refresh clusters so
  // cards flip Not started → Generating → Ready as each prompt finishes, and
  // stop once the backend clears its `generating` flag.
  useEffect(() => {
    if (!generating) return;
    let cancelled = false;
    async function tick() {
      try {
        const [st, cs] = await Promise.all([
          getDraftStatusFresh(brandId),
          listClusters(brandId),
        ]);
        if (cancelled) return;
        setClusters(cs);
        if (!st.generating) setGenerating(false);
      } catch {
        // transient — keep polling
      }
    }
    tick();
    const id = setInterval(tick, 4000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [generating, brandId]);

  const started = useMemo(() => clusters.some(clusterHasContent), [clusters]);
  const pendingCount = useMemo(
    () => clusters.filter((c) => !clusterHasContent(c)).length,
    [clusters],
  );
  const appearsIn = useMemo(
    () => clusters.filter((c) => c.visibility_pct > 0).length,
    [clusters],
  );

  const visible = useMemo(() => {
    const arr = clusters.filter((c) => filterPredicate(c, started ? filter : "all"));
    if (sortBy === "visibility") {
      arr.sort((a, b) => a.visibility_pct - b.visibility_pct);
    } else if (sortBy === "updated") {
      arr.sort((a, b) => {
        const at = a.last_generated_at ? new Date(a.last_generated_at).getTime() : 0;
        const bt = b.last_generated_at ? new Date(b.last_generated_at).getTime() : 0;
        return bt - at;
      });
    }
    return arr;
  }, [clusters, filter, sortBy, started]);

  async function onRegenerate(clusterId: number) {
    const cluster = clusters.find((c) => c.id === clusterId);
    if (!cluster) return;
    setRegeneratingPromptId(cluster.prompt_id);
    setGenError(null);
    try {
      await regenerateClusterByPrompt(brandId, cluster.prompt_id);
      const fresh = await listClusters(brandId);
      setClusters(fresh);
    } catch (e: unknown) {
      const status = (e as { response?: { status?: number } })?.response?.status;
      if (status === 402 || status === 403) setGenError("Regenerating posts is available on paid plans.");
      else if (status === 429) setGenError("You've hit a regeneration limit. Please wait and try again.");
      else if (status === 409) setGenError("Content is already generating for this brand.");
      else setGenError("Couldn't regenerate. Please try again.");
    } finally {
      setRegeneratingPromptId(null);
    }
  }

  async function generateAll() {
    if (generating) return;
    setGenError(null);
    try {
      // skip_ready=true → only pending/failed clusters are (re)generated, never
      // clobbering work the user already has. Backend clamps to the plan's cap.
      await generateNow(brandId, Math.max(clusters.length, 1), true);
      setGenerating(true);
    } catch (e: unknown) {
      const status = (e as { response?: { status?: number } })?.response?.status;
      if (status === 409) {
        setGenerating(true); // already running — just watch it
      } else if (status === 402 || status === 403) {
        setGenError("Generating posts is available on paid plans.");
      } else {
        setGenError("Couldn't start generation. Please try again.");
      }
    }
  }

  if (!Number.isFinite(brandId)) {
    return (
      <div className="px-4 sm:px-8 py-8 max-w-[1400px] text-[#fb7185]">Invalid brand.</div>
    );
  }

  if (loading) {
    return (
      <div className="px-4 sm:px-8 py-8 max-w-[1400px] flex items-center gap-2 text-[var(--text-secondary)]">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading content…
      </div>
    );
  }

  const noPrompts = clusters.length === 0;

  return (
    <div className="px-4 sm:px-8 py-6 sm:py-8 max-w-[1400px] space-y-6">
      <header>
        <div className="text-[11px] uppercase tracking-wider text-[var(--text-faint)] font-semibold mb-1.5">
          Content
        </div>
        <h1 className="text-2xl font-bold text-[var(--text-primary)] leading-tight capitalize">
          {brand?.name ?? "Brand"}
        </h1>
        <p className="mt-1.5 text-sm text-[var(--text-secondary)]">
          Posts that get {brand?.name ?? "your brand"} mentioned in AI answers — one set per
          tracked question, across LinkedIn, Medium, Reddit, Quora, and X.
        </p>
      </header>

      {generating && (
        <div className="rounded-md border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-200 flex items-center gap-2">
          <Loader2 className="h-4 w-4 animate-spin shrink-0" />
          Generating posts… this can take a few minutes. Cards update as each prompt finishes.
        </div>
      )}

      {loadError ? (
        <div className="card border-dashed text-sm text-[var(--text-secondary)] text-center py-10">
          Couldn&apos;t load this brand&apos;s content.{" "}
          <button onClick={() => { setLoading(true); setLoadError(false); location.reload(); }} className="text-[var(--accent)] underline underline-offset-2">
            Try again
          </button>
        </div>
      ) : noPrompts ? (
        <div className="card border-dashed text-sm text-[var(--text-secondary)] text-center py-10">
          No tracked questions yet. Add prompts in Settings to start creating content.
        </div>
      ) : !started ? (
        /* ── First run: name the goal, show the gap, one primary action ── */
        <div className="card flex flex-col items-start gap-4">
          <div>
            <h2 className="text-lg font-semibold text-[var(--text-primary)]">
              Create your first posts
            </h2>
            <p className="mt-1 text-sm text-[var(--text-secondary)] max-w-2xl">
              For each tracked question we&apos;ll write a coordinated set of posts — LinkedIn,
              Medium, Reddit, Quora, and X — designed to get{" "}
              {brand?.name ?? "your brand"} mentioned when people ask AI tools about your space.
            </p>
          </div>
          <div className="text-sm text-[var(--text-secondary)]">
            Right now {brand?.name ?? "your brand"} appears in{" "}
            <strong className={appearsIn === 0 ? "text-[#fb7185]" : "text-[var(--text-primary)]"}>
              {appearsIn} of {clusters.length}
            </strong>{" "}
            tracked AI answers.
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Button onClick={generateAll} disabled={generating} className="gap-1.5">
              {generating ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Sparkles className="h-4 w-4" />
              )}
              Generate posts for all questions
            </Button>
            <span className="text-xs text-[var(--text-faint)]">
              or open any question below to generate it on its own.
            </span>
          </div>
          {genError && <p className="text-xs text-[#fb7185]">{genError}</p>}
        </div>
      ) : (
        /* ── Started: real controls over a board that has content ── */
        <div className="flex flex-wrap items-center gap-3 text-xs">
          <div className="flex items-center gap-1.5 text-[var(--text-faint)]">
            <span>Sort:</span>
            {(Object.keys(SORT_LABEL) as SortKey[]).map((k) => (
              <button
                key={k}
                type="button"
                onClick={() => setSortBy(k)}
                className={`px-2 py-1 rounded ${sortBy === k ? "bg-[var(--bg-card)] text-[var(--text-primary)] font-medium" : "text-[var(--text-secondary)] hover:text-[var(--text-primary)]"}`}
              >
                {SORT_LABEL[k]}
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
          <PlatformFilter hidden={hidden} onToggle={toggle} />
          {pendingCount > 0 && (
            <Button
              size="sm"
              variant="outline"
              onClick={generateAll}
              disabled={generating}
              className="ml-auto gap-1.5"
            >
              {generating ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Sparkles className="h-3.5 w-3.5" />
              )}
              Generate {pendingCount} not started
            </Button>
          )}
        </div>
      )}

      {!noPrompts && (
        <>
          {visible.length === 0 ? (
            <div className="card border-dashed text-sm text-[var(--text-secondary)] text-center py-10">
              No questions match the current filter.
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
        </>
      )}

      {started && genError && <p className="text-xs text-[#fb7185]">{genError}</p>}

      <div className="pt-8 mt-8 border-t border-[var(--border-subtle)]">
        <button
          type="button"
          onClick={() => router.push(`/content/${brandId}/archive`)}
          className="text-xs text-[var(--text-faint)] hover:text-[var(--text-secondary)]"
        >
          Earlier drafts ↗
        </button>
      </div>
    </div>
  );
}
