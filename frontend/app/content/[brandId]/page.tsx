"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { Loader2, ChevronDown, Sparkles, X } from "lucide-react";
import {
  getBrand,
  generateNow,
  getDraftStatusFresh,
  getContentReadiness,
  listClusters,
  regenerateClusterByPrompt,
  type BrandDetail,
  type ContentClusterSummary,
  type ContentReadiness,
  type ContentReadinessWarning,
} from "@/lib/api";
import { Button } from "@/components/ui/button";
import { ClusterCard } from "@/components/content/cluster/ClusterCard";
import { OpportunitiesPanel } from "@/components/content/OpportunitiesPanel";
import { clusterHasContent, translateFailureReason } from "@/lib/clusterStatus";
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
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";

// ── Readiness preflight (Task F3) ───────────────────────────────────────────
// Per-warning-code link shown next to each message in the confirm layer.
const READINESS_WARNING_LINK: Record<string, { href: (brandId: number) => string; label: string }> = {
  profile_empty: { href: () => "/settings?tab=profile", label: "Fix brand profile" },
  no_sources: { href: (brandId) => `/content/${brandId}/sources`, label: "Add sources" },
  no_tracking_run: { href: () => "/dashboard", label: "Run tracking" },
};

type SortKey = "visibility" | "updated" | "version";
type FilterKey = "all" | "not_started" | "needs_attention" | "ready" | "in_progress" | "failed";

const SORT_LABEL: Record<SortKey, string> = {
  visibility: "Lowest visibility",
  updated: "Last updated",
  version: "Latest version",
};

const FILTER_LABEL: Record<FilterKey, string> = {
  all: "All",
  not_started: "Not started",
  needs_attention: "Needs attention",
  ready: "Ready",
  in_progress: "In progress",
  failed: "Failed",
};

// Shared trigger styling for the toolbar dropdowns.
const TOOLBAR_TRIGGER =
  "inline-flex items-center gap-1.5 rounded-md border border-[var(--border-subtle)] " +
  "px-2.5 py-1.5 text-xs text-[var(--text-secondary)] transition-colors " +
  "hover:text-[var(--text-primary)] hover:border-[var(--text-faint)] cursor-pointer " +
  "focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--text-faint)]/40 " +
  "data-[state=open]:border-[var(--text-faint)] data-[state=open]:text-[var(--text-primary)]";

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

// ── Sweep result summary (Task F2) ──────────────────────────────────────────
// Populated either when a generation sweep finishes (kind "finished") or on
// page load when a previous sweep left failures on the board (kind "recap").

interface SweepSummary {
  kind: "finished" | "recap";
  total: number;
  /** Questions with usable posts — ready/ready_low_evidence, plus partial
   * clusters (they did produce at least one post, just not all platforms). */
  gotPosts: number;
  /** briefing_failed only — the brief itself never completed, so nothing was
   * written for this question. */
  failed: number;
  /** generation_partial / partial_failed — counted in gotPosts above, but
   * tracked separately since these are also eligible for retry. */
  partial: number;
  /** Never attempted (still "pending"). */
  pending: number;
  /** Most common translated failure reason among failed + partial clusters. */
  dominantReason: string | null;
}

function computeSweepSummary(
  clusters: ContentClusterSummary[],
  kind: SweepSummary["kind"],
): SweepSummary {
  const total = clusters.length;
  let succeeded = 0;
  let failed = 0;
  let partial = 0;
  let pending = 0;
  const reasonCounts = new Map<string, number>();

  for (const c of clusters) {
    if (isReadyStatus(c.status)) {
      succeeded++;
    } else if (c.status === "briefing_failed") {
      failed++;
    } else if (c.status === "generation_partial" || c.status === "partial_failed") {
      partial++;
    } else {
      pending++;
    }
    if (isFailedStatus(c.status)) {
      const translated = translateFailureReason(c.failure_reason);
      if (translated) reasonCounts.set(translated, (reasonCounts.get(translated) ?? 0) + 1);
    }
  }

  let dominantReason: string | null = null;
  let dominantCount = 0;
  Array.from(reasonCounts.entries()).forEach(([reason, count]) => {
    if (count > dominantCount) {
      dominantReason = reason;
      dominantCount = count;
    }
  });

  return {
    kind,
    total,
    gotPosts: succeeded + partial,
    failed,
    partial,
    pending,
    dominantReason,
  };
}

function sweepMessage(s: SweepSummary): string {
  if (s.kind === "recap") {
    const troubled = s.failed + s.partial;
    return `${troubled} question${troubled === 1 ? "" : "s"} failed last time.`;
  }
  if (s.failed === 0 && s.partial === 0 && s.pending === 0) {
    return `All ${s.total} questions have posts.`;
  }
  let msg = `${s.gotPosts} of ${s.total} questions got posts.`;
  if (s.failed > 0) {
    msg += ` ${s.failed} couldn't be written${s.dominantReason ? ` — most because ${s.dominantReason}` : ""}.`;
  }
  if (s.pending > 0) {
    msg += ` ${s.pending} still queued.`;
  }
  return msg;
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
  const [sweepSummary, setSweepSummary] = useState<SweepSummary | null>(null);
  const [sweepDismissed, setSweepDismissed] = useState(false);
  // Populated by the generate preflight (Task F3) so the sweep banner's "Fix
  // brand profile" link (F2) can light up once we know the brand's profile
  // state. Stays null until the user attempts a generate.
  const [readiness, setReadiness] = useState<ContentReadiness | null>(null);
  // Non-null while the "before you generate" confirm layer is showing.
  const [pendingWarnings, setPendingWarnings] = useState<ContentReadinessWarning[] | null>(null);
  const { hidden, toggle, isVisible } = useHiddenPlatforms(brandId);
  const platformsVisible = CLUSTER_PLATFORMS.filter((p) => !hidden.has(p)).length;
  // True only once a poll has actually observed the backend mid-sweep. Guards
  // against treating an immediate (pre-start) `generating: false` response as
  // a finished sweep.
  const observedGeneratingRef = useRef(false);
  // Synchronous in-flight guard for generateAll(): `generating` isn't set
  // until after the awaited readiness preflight resolves, so a fast
  // double-click could otherwise fire two concurrent preflights (and
  // potentially two generateNow POSTs). Reset on every exit path that
  // doesn't hand off to `generating` as the guard.
  const preflightRef = useRef(false);

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
          // Recap failures left over from a previous sweep — don't claim one
          // just finished, just surface the retry affordance.
          if (cs.some((c) => isFailedStatus(c.status))) {
            setSweepSummary(computeSweepSummary(cs, "recap"));
            setSweepDismissed(false);
          }
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
    if (!generating) {
      observedGeneratingRef.current = false;
      return;
    }
    let cancelled = false;
    async function tick() {
      try {
        const [st, cs] = await Promise.all([
          getDraftStatusFresh(brandId),
          listClusters(brandId),
        ]);
        if (cancelled) return;
        setClusters(cs);
        if (st.generating) {
          observedGeneratingRef.current = true;
        } else {
          // Only treat this as a finished sweep if we actually saw it running
          // at some point — an immediate false (e.g. before the backend job
          // starts) isn't a completion.
          if (observedGeneratingRef.current) {
            setSweepSummary(computeSweepSummary(cs, "finished"));
            setSweepDismissed(false);
          }
          setGenerating(false);
        }
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
    } else if (sortBy === "version") {
      arr.sort((a, b) => (b.version ?? 0) - (a.version ?? 0));
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

  async function runGenerateNow() {
    setGenError(null);
    try {
      // skipReady=true → only pending/failed clusters are (re)generated, never
      // clobbering work the user already has. Backend clamps to the plan's cap.
      await generateNow(brandId, Math.max(clusters.length, 1), { skipReady: true });
      setGenerating(true);
      preflightRef.current = false; // `generating` now guards further clicks
    } catch (e: unknown) {
      const status = (e as { response?: { status?: number } })?.response?.status;
      if (status === 409) {
        setGenerating(true); // already running — just watch it
        preflightRef.current = false;
      } else if (status === 402 || status === 403) {
        setGenError("Generating posts is available on paid plans.");
        preflightRef.current = false;
      } else {
        setGenError("Couldn't start generation. Please try again.");
        preflightRef.current = false;
      }
    }
  }

  // Entry point for both the first-run hero button and the toolbar "Generate
  // N not started" button. Runs a readiness preflight first: if it turns up
  // warnings, hold generation behind a confirm layer; if the preflight call
  // itself fails, don't let that block generation — just proceed.
  async function generateAll() {
    if (preflightRef.current || generating) return;
    preflightRef.current = true;
    try {
      const r = await getContentReadiness(brandId);
      setReadiness(r);
      if (r.warnings.length > 0) {
        setPendingWarnings(r.warnings);
        // Flow hands off to the confirm dialog here — don't reset yet.
        // cancelGenerate() resets on cancel; confirmGenerateAnyway()'s
        // runGenerateNow() resets on every one of its own exit paths.
        return;
      }
    } catch (e) {
      console.warn("Readiness preflight failed; proceeding without it.", e);
    }
    await runGenerateNow();
  }

  function confirmGenerateAnyway() {
    setPendingWarnings(null);
    void runGenerateNow();
  }

  function cancelGenerate() {
    setPendingWarnings(null);
    preflightRef.current = false;
  }

  async function retryFailed() {
    if (generating) return;
    setGenError(null);
    try {
      // retryFailed=true → only pending/briefing_failed/generation_partial
      // clusters are processed; takes precedence over skipReady on the backend.
      await generateNow(brandId, Math.max(clusters.length, 1), { retryFailed: true });
      setGenerating(true);
      setSweepDismissed(true);
    } catch (e: unknown) {
      const status = (e as { response?: { status?: number } })?.response?.status;
      if (status === 409) {
        setGenerating(true); // already running — just watch it
        setSweepDismissed(true);
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

  // The dropdown toolbar (sort / status / platforms) — shown once the brand has
  // content to organize.
  const toolbar = (
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

      <Link href={`/content/${brandId}/sources`} className={pendingCount > 0 ? TOOLBAR_TRIGGER : `${TOOLBAR_TRIGGER} ml-auto`}>
        Sources
      </Link>

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
  );

  return (
    <div className="px-4 sm:px-8 py-6 sm:py-8 max-w-[1400px] space-y-6">
      <header>
        <div className="text-[11px] uppercase tracking-wider text-[var(--text-faint)] font-semibold mb-1.5">
          Content
        </div>
        <h1 className="text-2xl font-display text-[var(--text-primary)] leading-tight capitalize">
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

      {!generating && sweepSummary && !sweepDismissed && (() => {
        const needsAttention = sweepSummary.failed + sweepSummary.partial > 0;
        const showRetry = sweepSummary.failed + sweepSummary.partial + sweepSummary.pending > 0;
        return (
          <div
            className={`relative rounded-md border px-4 py-3 pr-9 text-sm flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between ${
              needsAttention
                ? "border-rose-500/30 bg-rose-500/10 text-rose-200"
                : "border-emerald-500/30 bg-emerald-500/10 text-emerald-200"
            }`}
          >
            <span>{sweepMessage(sweepSummary)}</span>
            {(showRetry || readiness?.profile_empty) && (
              <div className="flex items-center gap-3 shrink-0">
                {showRetry && (
                  <Button size="sm" variant="outline" onClick={retryFailed} disabled={generating}>
                    Retry failed
                  </Button>
                )}
                {readiness?.profile_empty && (
                  <Link
                    href="/settings?tab=profile"
                    className="text-xs underline underline-offset-2 hover:opacity-80"
                  >
                    Fix brand profile
                  </Link>
                )}
              </div>
            )}
            <button
              type="button"
              onClick={() => setSweepDismissed(true)}
              aria-label="Dismiss"
              className="absolute top-2.5 right-2.5 p-1 rounded-md hover:bg-black/10 transition-colors"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        );
      })()}

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
        toolbar
      )}

      {!noPrompts && started && (
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

      {!noPrompts && (
        <OpportunitiesPanel brandId={brandId} defaultCollapsed={clusters.length > 0} />
      )}

      {/* Readiness preflight confirm layer — shown when the pre-generate check
          found gaps. Generation only proceeds via "Generate anyway". */}
      <Dialog open={pendingWarnings !== null} onOpenChange={(o) => !o && cancelGenerate()}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Before you generate</DialogTitle>
            <DialogDescription>
              Posts will still be written, but they&apos;ll be stronger if you fix these first.
            </DialogDescription>
          </DialogHeader>
          <ul className="space-y-2.5">
            {(pendingWarnings ?? []).map((w) => {
              const link = READINESS_WARNING_LINK[w.code];
              return (
                <li key={w.code} className="text-sm text-[var(--text-secondary)]">
                  {w.message}
                  {link && (
                    <>
                      {" "}
                      <Link
                        href={link.href(brandId)}
                        className="text-[var(--accent)] underline underline-offset-2 hover:opacity-80 whitespace-nowrap"
                      >
                        {link.label}
                      </Link>
                    </>
                  )}
                </li>
              );
            })}
          </ul>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={cancelGenerate}>
              Cancel
            </Button>
            <Button size="sm" onClick={confirmGenerateAnyway} className="gap-1.5">
              <Sparkles className="h-3.5 w-3.5" />
              Generate anyway
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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
