'use client';

import { motion } from 'framer-motion';
import { fadeIn } from '@/lib/motion';
import { useEffect, useState, useRef, useCallback, useMemo } from 'react';
import Link from 'next/link';
import {
  Plus,
  BarChart2,
  TrendingUp,
  Users,
  Zap,
  Building2,
  Play,
  Loader2,
  Globe,
} from 'lucide-react';
import { logError } from '@/lib/utils/errors';
import {
  getBrand,
  getOverview,
  getTrends,
  getDashboardAnalytics,
  getResponses,
  getDrafts,
  getRecentRuns,
  triggerRun,
  getRunStatus,
  generateNow,
  triggerScan,
  getCompetitors,
  getBrandProfile,
  getBillingStatus,
  getBillingUsage,
  BrandDetail,
  OverviewData,
  TrendPoint,
  DashboardAnalytics,
  QueryResult,
  TrackingRun,
  Prompt,
  Competitor,
  BrandProfile,
  BillingStatus,
  BillingUsage,
  parseApiError,
} from '@/lib/api';
import { AppToast, ToastData } from '@/components/AppToast';
import SubscriptionBanner from '@/components/SubscriptionBanner';
import { ManagePromptsModal } from '@/components/ManagePromptsModal';
import { CompetitorModal } from '@/components/CompetitorModal';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/contexts/AuthContext';
import { useBrand } from '@/contexts/BrandContext';
import { format } from 'date-fns';
import { parseUTCISO } from '@/lib/utils/formatting';
import { useIsMobile } from '@/hooks/useIsMobile';
import { usePullToRefresh } from '@/hooks/usePullToRefresh';

import {
  DashboardHeader,
  StatsGrid,
  VisibilityChart,
  BrandTable,
  BestPromptCard,
  DonutDomains,
  DashboardModelBreakdown,
  HelpTooltip,
  buildPromptGroups,
} from '@/components/dashboard';

// ── Page ───────────────────────────────────────────────────────────────────────

export default function DashboardPage() {
  const { user } = useAuth();
  const isMobile = useIsMobile();
  const { brands, activeBrandId: selectedBrandId, loading: loadingBrands, setActiveBrandId, refetch: refetchBrands } = useBrand();
  const [newBrandMode, setNewBrandMode] = useState(false);
  const [newBrandStep, setNewBrandStep] = useState<'running' | 'drafting' | 'done'>('running');
  const newBrandHandledRef = useRef(false);

  // Overview data
  const [overview, setOverview] = useState<OverviewData | null>(null);
  const [trends, setTrends] = useState<TrendPoint[]>([]);
  const [analytics, setAnalytics] = useState<DashboardAnalytics | null>(null);
  const [loadingAnalytics, setLoadingAnalytics] = useState(false);

  // Reports data
  const [responses, setResponses] = useState<QueryResult[]>([]);
  const [loadingResponses, setLoadingResponses] = useState(false);
  const [brandDetail, setBrandDetail] = useState<BrandDetail | null>(null);
  const [publishedCount, setPublishedCount] = useState(0);

  // Toast
  const [toast, setToast] = useState<ToastData | null>(null);

  // Brand profile completeness
  const [brandProfile, setBrandProfile] = useState<BrandProfile | null>(null);

  // Prompt modal
  const [promptModalOpen, setPromptModalOpen] = useState(false);

  // Competitor modal
  const [competitors, setCompetitors] = useState<Competitor[]>([]);
  const [competitorModalOpen, setCompetitorModalOpen] = useState(false);

  // Billing and usage state
  const [billingStatus, setBillingStatus] = useState<BillingStatus | null>(null);
  const [usage, setUsage] = useState<BillingUsage | null>(null);
  const [upgradeModalOpen, setUpgradeModalOpen] = useState(false);
  const [upgradeModalReason, setUpgradeModalReason] = useState('');

  // Run state
  const [triggering, setTriggering] = useState(false);
  const [activeRunId, setActiveRunId] = useState<number | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Pending single-prompt mini-runs: promptId → runId
  const [pendingRuns, setPendingRuns] = useState<Map<number, number>>(new Map());
  const pendingPollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // UI state
  const [expandedPromptId, setExpandedPromptId] = useState<number | null>(null);
  const [expandedConvId, setExpandedConvId] = useState<number | null>(null);
  const [convModelFilter, setConvModelFilter] = useState<string>('all');

  // AbortController ref to cancel in-flight brand-specific fetches on brand switch
  const loadAbortRef = useRef<AbortController | null>(null);

  useEffect(() => { document.title = 'Dashboard — Lumidian'; }, []);

  // Fetch billing status and usage on mount (non-admin only)
  useEffect(() => {
    if (!user || user.is_admin) return;
    getBillingStatus().then(setBillingStatus).catch((err) => logError(err, 'Dashboard: fetch billing status'));
    getBillingUsage().then(setUsage).catch((err) => logError(err, 'Dashboard: fetch billing usage'));
  }, [user]);

  // If ?brandId=X is in the URL (new-brand onboarding), override the active brand
  useEffect(() => {
    if (!brands.length) return;
    const params = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : null;
    const urlBrandId = params ? parseInt(params.get('brandId') ?? '', 10) : NaN;
    if (!isNaN(urlBrandId) && brands.some((br) => br.id === urlBrandId)) {
      setActiveBrandId(urlBrandId);
    }
  }, [brands, setActiveBrandId]);

  const loadData = useCallback(async (brandId: number, signal?: AbortSignal) => {
    setLoadingAnalytics(true);
    setLoadingResponses(true);
    setExpandedPromptId(null);
    setExpandedConvId(null);

    try {
      const runsPromise = getRecentRuns(brandId);
      const responsesPromise = runsPromise.then((runs) => {
        const latestCompleted = [...(Array.isArray(runs) ? runs : [])]
          .filter((r: TrackingRun) => r.status === 'completed')
          .sort((a: TrackingRun, b: TrackingRun) => b.id - a.id)[0];
        return latestCompleted
          ? getResponses(brandId, latestCompleted.id)
          : Promise.resolve([]);
      });

      const [ov, tr, an, runs, detail, bp, comps, resps] = await Promise.all([
        getOverview(brandId),
        getTrends(brandId),
        getDashboardAnalytics(brandId),
        runsPromise,
        getBrand(brandId).catch((err) => { logError(err, 'Dashboard: fetch brand detail'); return null; }),
        getBrandProfile(brandId).catch((err) => { logError(err, 'Dashboard: fetch brand profile'); return null; }),
        getCompetitors(brandId).catch((err) => { logError(err, 'Dashboard: fetch competitors'); return []; }),
        responsesPromise.catch((err) => { logError(err, 'Dashboard: fetch responses'); return []; }),
      ]);

      if (signal?.aborted) return;

      setOverview(ov);
      setTrends(Array.isArray(tr) ? tr : []);
      setAnalytics(an);
      setBrandDetail(detail);
      setBrandProfile(bp);
      setCompetitors(Array.isArray(comps) ? comps : []);
      setLoadingAnalytics(false);
      setResponses(Array.isArray(resps) ? resps.filter((r) => r.response_text) : []);
      getDrafts(brandId, undefined, 'posted').then((d) => setPublishedCount(d.length)).catch((err) => logError(err, 'Dashboard: fetch posted drafts count'));
    } catch {
      if (signal?.aborted) return;
      setLoadingAnalytics(false);
    } finally {
      if (!signal?.aborted) setLoadingResponses(false);
    }
  }, []);

  useEffect(() => {
    if (!selectedBrandId) return;
    loadAbortRef.current?.abort();
    const controller = new AbortController();
    loadAbortRef.current = controller;
    loadData(selectedBrandId, controller.signal);
    return () => controller.abort();
  }, [selectedBrandId, loadData]);

  const handlePullRefresh = useCallback(async () => {
    if (selectedBrandId) await loadData(selectedBrandId);
  }, [selectedBrandId, loadData]);

  const { containerRef: pullRef, pullDistance, refreshing: pullRefreshing } = usePullToRefresh({
    onRefresh: handlePullRefresh,
    disabled: !isMobile || !selectedBrandId,
  });

  // Load pending prompt mini-runs from localStorage on mount
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const key = 'pendingPromptRuns';
    try {
      const stored: Array<{ promptId: number; runId: number }> = JSON.parse(localStorage.getItem(key) ?? '[]');
      if (stored.length > 0) {
        setPendingRuns(new Map(stored.map(({ promptId, runId }) => [promptId, runId])));
      }
    } catch { /* ignore */ }
  }, []);

  // Poll pending mini-runs every 3s; refresh data and clean up when completed
  useEffect(() => {
    if (pendingRuns.size === 0) {
      if (pendingPollRef.current) clearInterval(pendingPollRef.current);
      return;
    }
    pendingPollRef.current = setInterval(async () => {
      const completed: number[] = [];
      await Promise.all(
        Array.from(pendingRuns.entries()).map(async ([promptId, runId]) => {
          try {
            const run = await getRunStatus(runId);
            if (run.status === 'completed' || run.status === 'failed') {
              completed.push(promptId);
            }
          } catch { /* ignore */ }
        })
      );
      if (completed.length > 0) {
        setPendingRuns((prev) => {
          const next = new Map(prev);
          for (const pid of completed) next.delete(pid);
          return next;
        });
        if (typeof window !== 'undefined') {
          const key = 'pendingPromptRuns';
          try {
            const stored: Array<{ promptId: number; runId: number }> = JSON.parse(localStorage.getItem(key) ?? '[]');
            const updated = stored.filter(({ promptId }) => !completed.includes(promptId));
            localStorage.setItem(key, JSON.stringify(updated));
          } catch { /* ignore */ }
        }
        if (selectedBrandId) loadData(selectedBrandId);
      }
    }, 3000);
    return () => { if (pendingPollRef.current) clearInterval(pendingPollRef.current); };
  }, [pendingRuns, selectedBrandId, loadData]);

  // Detect new brand onboarding flow
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      if (params.get('newBrand') === 'true') {
        const newBrandId = parseInt(params.get('brandId') ?? '', 10);
        if (!isNaN(newBrandId)) {
          setActiveBrandId(newBrandId);
        }
        refetchBrands();
        setNewBrandMode(true);
        setNewBrandStep('running');
        window.history.replaceState({}, '', '/dashboard');
      }
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-start polling if the latest run is already in-progress when data loads
  useEffect(() => {
    if (!overview?.latest_run) return;
    const { id, status } = overview.latest_run;
    if ((status === 'running' || status === 'pending') && activeRunId === null) {
      setActiveRunId(id);
    }
  }, [overview]); // eslint-disable-line react-hooks/exhaustive-deps

  // Poll for active run completion
  useEffect(() => {
    if (activeRunId === null) {
      if (pollRef.current) clearInterval(pollRef.current);
      return;
    }
    pollRef.current = setInterval(async () => {
      try {
        const run = await getRunStatus(activeRunId);
        if (run.status === 'completed' || run.status === 'failed') {
          setActiveRunId(null);
          if (pollRef.current) clearInterval(pollRef.current);
          if (run.status === 'completed') {
            setToast({ message: 'Report complete! Data refreshed.', type: 'success' });
          } else if (run.status === 'failed') {
            setToast({ message: 'Report run failed. Check API keys in Settings.', type: 'info' });
          }
          if (selectedBrandId) {
            loadData(selectedBrandId);
            if (newBrandMode && !newBrandHandledRef.current && run.status === 'completed') {
              newBrandHandledRef.current = true;
              setNewBrandStep('drafting');
              try {
                await generateNow(selectedBrandId, 20);
              } catch { /* non-fatal */ }
              triggerScan(selectedBrandId).catch((err) => logError(err, 'Dashboard: trigger Reddit scan'));
              setNewBrandStep('done');
              setTimeout(() => setNewBrandMode(false), 10000);
            } else if (newBrandMode) {
              setNewBrandStep('done');
              setTimeout(() => setNewBrandMode(false), 5000);
            }
          }
        }
      } catch { /* ignore */ }
    }, 3000);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [activeRunId, selectedBrandId, loadData, newBrandMode]);

  // Broadcast report-running state to other pages via localStorage
  useEffect(() => {
    try {
      const status = overview?.latest_run?.status;
      if (activeRunId !== null || status === 'running' || status === 'pending') {
        localStorage.setItem('clarity_report_running', '1');
      } else {
        localStorage.removeItem('clarity_report_running');
      }
    } catch {}
  }, [activeRunId, overview?.latest_run?.status]);

  // Auto-clear toast after 4 seconds
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(t);
  }, [toast]);

  async function handleRunReport() {
    if (!selectedBrandId || triggering) return;
    const runStatus = overview?.latest_run?.status;
    if (activeRunId !== null || runStatus === 'running' || runStatus === 'pending') return;
    setTriggering(true);
    try {
      const result = await triggerRun(selectedBrandId);
      setActiveRunId(result.run_id);
      getBillingUsage().then(setUsage).catch((err) => logError(err, 'Dashboard: refresh billing usage after run'));
    } catch (err: unknown) {
      const e = err as { response?: { status?: number; data?: { detail?: string } } };
      const httpStatus = e?.response?.status;
      const detail = parseApiError(err);
      if (httpStatus === 409) {
        setToast({ message: 'A report is already running. Please wait for it to finish.', type: 'info' });
      } else if (httpStatus === 429 || httpStatus === 402) {
        setUpgradeModalReason(detail);
        setUpgradeModalOpen(true);
      } else {
        setToast({ message: detail, type: 'error' });
      }
    } finally {
      setTriggering(false);
    }
  }

  // ── Derived state ──────────────────────────────────────────────────────────

  const selectedBrand = brands.find((b) => b.id === selectedBrandId);
  const latestRun = overview?.latest_run;
  const score = latestRun?.overall_score ?? null;
  const isRunning = activeRunId !== null || latestRun?.status === 'running' || latestRun?.status === 'pending' || (newBrandMode && newBrandStep !== 'done');
  const isFirstRun = isRunning && !analytics?.total_responses_analyzed && trends.length === 0;

  const sparkData = trends.map((p) => ({
    ...p,
    formattedDate: format(parseUTCISO(p.completed_at), 'MMM d'),
    score: Math.round(p.score),
  }));

  const scoreDelta = sparkData.length >= 2
    ? sparkData[sparkData.length - 1].score - sparkData[sparkData.length - 2].score
    : null;

  const nextReportHours: number | null = (() => {
    const now = new Date();
    let next = new Date(Date.UTC(
      now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 8, 0, 0, 0
    ));
    if (next.getTime() <= now.getTime()) next = new Date(next.getTime() + 86400000);
    const h = Math.round((next.getTime() - now.getTime()) / 3600000);
    return h > 0 ? h : null;
  })();

  const sinceLastRun = latestRun?.completed_at ? (() => {
    const diffMs = Date.now() - parseUTCISO(latestRun.completed_at).getTime();
    const h = Math.floor(diffMs / 3600000);
    const m = Math.floor((diffMs % 3600000) / 60000);
    if (h >= 48) return `${Math.floor(h / 24)}d ago`;
    if (h >= 1) return `${h}h ago`;
    return `${m}m ago`;
  })() : null;

  const sentData = analytics?.sentiment;
  const sentHeadline = sentData?.has_data
    ? sentData.positive_pct > 0
      ? `${Math.round(sentData.positive_pct)}% Positive`
      : sentData.negative_pct > 0
        ? `${Math.round(sentData.negative_pct)}% Negative`
        : 'Neutral'
    : null;
  const sentColor = sentData?.has_data
    ? sentData.positive_pct > 0 ? 'var(--success)'
    : sentData.negative_pct > 0 ? 'var(--danger)'
    : 'var(--warning)'
    : 'var(--text-faint)';

  const promptGroups = useMemo(() => buildPromptGroups(responses).sort((a, b) => {
    const aMentioned = a.mentioned > 0 ? 1 : 0;
    const bMentioned = b.mentioned > 0 ? 1 : 0;
    if (bMentioned !== aMentioned) return bMentioned - aMentioned;
    const pctA = a.total > 0 ? a.mentioned / a.total : 0;
    const pctB = b.total > 0 ? b.mentioned / b.total : 0;
    return pctB - pctA;
  }), [responses]);

  const trackedPromptIds = new Set(promptGroups.map((g) => g.promptId));
  const untrackedPrompts: Prompt[] = (brandDetail?.prompts ?? []).filter(
    (p) => !trackedPromptIds.has(p.id)
  );

  const isAtRunLimit = !user?.is_admin && usage !== null && usage.manual_run_limit !== null && usage.manual_runs_today >= usage.manual_run_limit;

  const totalPrompts = (brandDetail?.prompts ?? []).length;
  const totalRuns = trends.length;

  const liveScore = (() => {
    const mods = (analytics?.model_breakdown ?? []).filter(m => m.model === 'perplexity' || m.model === 'gemini');
    if (!mods.length) return null;
    const mentions = mods.reduce((s, m) => s + m.mention_count, 0);
    const total = mods.reduce((s, m) => s + m.total, 0);
    return total > 0 ? Math.round(mentions / total * 100) : null;
  })();
  const indexScore = (() => {
    const mods = (analytics?.model_breakdown ?? []).filter(m => m.model === 'chatgpt' || m.model === 'claude');
    if (!mods.length) return null;
    const mentions = mods.reduce((s, m) => s + m.mention_count, 0);
    const total = mods.reduce((s, m) => s + m.total, 0);
    return total > 0 ? Math.round(mentions / total * 100) : null;
  })();
  const daysSinceFirst = trends.length > 0 && trends[0].completed_at
    ? Math.max(0, Math.floor((Date.now() - parseUTCISO(trends[0].completed_at).getTime()) / 86_400_000))
    : null;

  const modelDeltas: Record<string, number> = (() => {
    if (trends.length < 2) return {};
    const prev = trends[trends.length - 2].model_scores ?? {};
    const curr = trends[trends.length - 1].model_scores ?? {};
    const result: Record<string, number> = {};
    for (const model of Object.keys(curr)) {
      const prevScore = prev[model];
      if (prevScore !== undefined) {
        const d = Math.round(curr[model] - prevScore);
        if (d !== 0) result[model] = d;
      }
    }
    return result;
  })();

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <motion.div
      ref={isMobile ? pullRef : undefined}
      variants={fadeIn}
      initial="hidden"
      animate="visible"
      className="px-4 sm:px-8 py-6 sm:py-8 max-w-7xl"
      style={isMobile ? { overflowY: 'auto', minHeight: '100vh' } : undefined}
    >
      {/* Pull-to-refresh indicator */}
      {isMobile && (pullDistance > 0 || pullRefreshing) && (
        <div
          className="pull-indicator -mx-4 mb-2"
          style={{ height: pullDistance > 0 ? pullDistance : 40 }}
        >
          <Loader2
            size={18}
            className={pullRefreshing ? 'animate-spin' : ''}
            style={{
              color: 'var(--accent)',
              transform: `rotate(${pullDistance * 3}deg)`,
              opacity: Math.min(pullDistance / 60, 1),
            }}
          />
        </div>
      )}
      {/* Subscription status / trial banner */}
      {user?.subscription_status && ['past_due', 'canceled', 'unpaid', 'trialing'].includes(user.subscription_status) && (
        <div className="-mx-8 -mt-8 mb-6">
          <SubscriptionBanner
            status={user.subscription_status}
            daysRemaining={billingStatus?.days_remaining ?? null}
            trialEnd={billingStatus?.subscription_trial_end ?? null}
          />
        </div>
      )}

      {/* Usage indicator (non-admin, Starter plan) — compact inline */}
      {usage && !user?.is_admin && usage.manual_run_limit !== null && (
        <div className="flex items-center gap-3 text-[10px] text-[var(--text-faint)] mb-4">
          <span className="flex items-center gap-1.5">
            <span className="text-[var(--text-muted)]">{totalPrompts} prompt{totalPrompts !== 1 ? 's' : ''}</span>
          </span>
          <span className="text-[var(--bg-elevated)]">&middot;</span>
          <span className="flex items-center gap-1.5">
            <span className="text-[var(--text-muted)]">Runs today</span>
            <span className="font-semibold tabular-nums text-[var(--text-secondary)]">{usage.manual_runs_today}/{usage.manual_run_limit}</span>
          </span>
        </div>
      )}

      {/* Upgrade modal */}
      <Dialog open={upgradeModalOpen} onOpenChange={(o) => !o && setUpgradeModalOpen(false)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <Zap size={20} className="text-[var(--accent)] mb-1" />
            <DialogTitle>Upgrade your plan</DialogTitle>
          </DialogHeader>
          <p className="text-xs text-[var(--text-muted)]">{upgradeModalReason}</p>
          <DialogFooter className="mt-4">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setUpgradeModalOpen(false)}
              className="flex-1"
            >
              Dismiss
            </Button>
            <Button
              asChild
              size="sm"
              variant="default"
              className="flex-1"
            >
              <Link href="/settings/billing">View plans</Link>
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* New brand onboarding progress banner */}
      {newBrandMode && (
        <div className="mb-6 bg-[var(--accent-muted)] border border-[var(--accent-border)] rounded-xl px-5 py-4 flex items-center gap-4">
          {newBrandStep !== 'done' ? (
            <Loader2 size={18} className="animate-spin text-[var(--accent)] shrink-0" />
          ) : (
            <div className="w-4.5 h-4.5 rounded-full bg-[var(--success)] flex items-center justify-center shrink-0">
              <span className="text-white text-xs font-bold" aria-hidden="true">&#10003;</span>
            </div>
          )}
          <div>
            {newBrandStep === 'drafting' && (
              <>
                <p className="text-sm font-medium text-[var(--text-primary)]">Report complete! Generating content drafts&hellip;</p>
                <p className="text-xs text-[var(--text-muted)] mt-0.5">Creating drafts for your top visibility gaps.</p>
              </>
            )}
            {newBrandStep === 'done' && (
              <>
                <p className="text-sm font-medium text-[var(--success)]">All set! Your report and drafts are ready.</p>
                <p className="text-xs text-[var(--text-muted)] mt-0.5">
                  Your first content drafts are waiting &mdash;{' '}
                  <Link href="/content" className="text-[var(--accent)] hover:text-[var(--accent)] underline">
                    check the Content Hub
                  </Link>
                  .
                </p>
              </>
            )}
          </div>
        </div>
      )}

      {/* Header */}
      <DashboardHeader
        selectedBrand={selectedBrand}
        selectedBrandId={selectedBrandId}
        isMobile={isMobile}
        triggering={triggering}
        isRunning={isRunning}
        isAtRunLimit={isAtRunLimit}
        onOpenPromptModal={() => setPromptModalOpen(true)}
        onRefresh={() => selectedBrandId && loadData(selectedBrandId)}
        onRunReport={handleRunReport}
        onUpgradeClick={() => { setUpgradeModalReason("You've used your 1 daily report run. Upgrade to run reports any time."); setUpgradeModalOpen(true); }}
      />

      {loadingBrands ? (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[1,2,3,4].map(i => (
            <div key={i} className="h-28 card animate-pulse" />
          ))}
        </div>
      ) : brands.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center max-w-xl mx-auto">
          <div className="w-16 h-16 bg-[var(--accent-muted)] border border-[var(--accent-border)] rounded-2xl flex items-center justify-center mb-5">
            <Zap size={28} className="text-[var(--accent)]" />
          </div>
          <h3 className="text-xl font-bold text-[var(--text-primary)] mb-2">Track your first brand</h3>
          <p className="text-sm text-[var(--text-muted)] mb-8 max-w-sm leading-relaxed">
            Add your brand, define the prompts you want AI models to mention you for, and we&apos;ll run an instant visibility report and generate content drafts automatically.
          </p>
          <div className="flex flex-col sm:flex-row items-start gap-3 mb-8 text-left w-full">
            {[
              { n: '1', title: 'Add your brand', body: 'Name, website, and the prompts you want to rank for.' },
              { n: '2', title: 'Auto-run report', body: 'We instantly query ChatGPT, Claude, Perplexity, and Gemini.' },
              { n: '3', title: 'Get content drafts', body: 'AI-generated posts targeting your top visibility gaps.' },
            ].map(({ n, title, body }) => (
              <div key={n} className="flex-1 card p-4">
                <div className="w-6 h-6 rounded-full bg-[var(--accent-muted)] text-[var(--accent-light)] text-xs font-bold flex items-center justify-center mb-2">{n}</div>
                <p className="text-sm font-semibold text-[var(--text-primary)] mb-1">{title}</p>
                <p className="text-xs text-[var(--text-muted)] leading-relaxed">{body}</p>
              </div>
            ))}
          </div>
          <Link
            href="/onboarding"
            className="flex items-center gap-2 bg-[var(--accent-muted)] hover:bg-[var(--accent-muted)] border border-[var(--accent-border)] hover:border-[var(--accent-border)] text-[var(--accent-light)] hover:text-[var(--accent-light)] hover:shadow-[0_0_24px_var(--accent-muted)] rounded-lg px-6 py-3 text-sm font-semibold transition-colors"
          >
            <Plus size={16} />
            Get Started
          </Link>
        </div>
      ) : (
        <>
          {/* Empty state: brand selected but no runs */}
          {!loadingBrands && !loadingAnalytics && !isRunning && selectedBrandId && trends.length === 0 && overview !== null && overview?.latest_run == null && (
            <div className="flex flex-col items-center justify-center py-16 text-center max-w-lg mx-auto">
              <div className="w-14 h-14 bg-[var(--accent-muted)] border border-[var(--accent-border)] rounded-2xl flex items-center justify-center mb-4">
                <BarChart2 size={24} className="text-[var(--accent)]" />
              </div>
              <h3 className="text-lg font-bold text-[var(--text-primary)] mb-2">No data yet</h3>
              <p className="text-sm text-[var(--text-muted)] mb-6 leading-relaxed">
                Run your first AI visibility report to see how often your brand appears across ChatGPT, Claude, Perplexity, and Gemini.
              </p>
              <button
                onClick={handleRunReport}
                disabled={triggering || isRunning}
                className="flex items-center gap-2 bg-[var(--accent)] hover:bg-[var(--accent-hover)] disabled:opacity-50 text-white rounded-lg px-6 py-3 text-sm font-semibold transition-colors shadow-lg shadow-[var(--accent)]/25"
              >
                {triggering || isRunning ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />}
                {isRunning ? 'Running...' : 'Run First Report'}
              </button>
            </div>
          )}

          {/* First-run empty state */}
          {isFirstRun && (
            <div className="flex flex-col items-center justify-center py-20 text-center max-w-md mx-auto mb-8">
              <div className="w-16 h-16 bg-[var(--accent-muted)] border border-[var(--accent-border)] rounded-2xl flex items-center justify-center mb-5">
                <Loader2 size={28} className="text-[var(--accent)] animate-spin" />
              </div>
              <h3 className="text-lg font-bold text-[var(--text-primary)] mb-2">Running your first AI visibility report...</h3>
              <p className="text-sm text-[var(--text-muted)] leading-relaxed">
                This takes 1-2 minutes. We&apos;ll auto-generate content drafts when it&apos;s done.
              </p>
            </div>
          )}

          {/* Overview */}
          {!isFirstRun && (
          <>
              {/* Brand profile completeness notification */}
              {brandProfile && brandProfile.completion_pct < 100 && (
                <div
                  className="mb-4 flex items-center justify-between px-4 py-2 bg-[var(--accent-muted)] border border-[var(--accent-border)] rounded-lg"
                >
                  <p className="text-xs text-[var(--text-muted)]">
                    Complete your brand profile to improve draft quality
                  </p>
                  <Link
                    href="/settings?tab=profile"
                    className="text-xs text-[var(--accent)] hover:text-[var(--accent-light)] transition-colors font-medium whitespace-nowrap ml-4"
                  >
                    Complete profile &rarr;
                  </Link>
                </div>
              )}

              {/* Quick stats row */}
              {!loadingAnalytics && totalRuns > 0 && (
                <StatsGrid
                  totalPrompts={totalPrompts}
                  daysSinceFirst={daysSinceFirst}
                  publishedCount={publishedCount}
                  isMobile={isMobile}
                />
              )}

              {/* Row 1: visibility (left) + prompt/sentiment/sov (right) */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                {/* Visibility score + sparkline */}
                <VisibilityChart
                  score={score}
                  scoreDelta={scoreDelta}
                  sinceLastRun={sinceLastRun}
                  sparkData={sparkData}
                  nextReportHours={nextReportHours}
                  loadingAnalytics={loadingAnalytics}
                  liveScore={liveScore}
                  indexScore={indexScore}
                />

                {/* Right column: Best Prompt + Sentiment on top, SOV below */}
                <div className="flex flex-col gap-3">
                  {/* Top row */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <BestPromptCard responses={responses} loading={loadingAnalytics} />

                    {/* Sentiment */}
                    <div className="card p-5">
                      <div className="flex items-start justify-between mb-2">
                        <p className="text-sm font-medium text-[var(--text-secondary)] flex items-center">
                          Sentiment
                          <HelpTooltip text="How positively AI models describe your brand when they mention it." />
                        </p>
                        <div className="w-8 h-8 rounded-lg bg-[rgba(255,255,255,0.06)] flex items-center justify-center text-[var(--accent)] flex-shrink-0">
                          <TrendingUp size={15} />
                        </div>
                      </div>
                      {loadingAnalytics ? (
                        <div className="h-8 w-16 bg-[rgba(255,255,255,0.06)] rounded animate-pulse mt-1" />
                      ) : sentData?.has_data && sentHeadline ? (
                        <>
                          <p className="text-2xl font-bold mt-1" style={{ color: sentColor }}>
                            {sentHeadline}
                          </p>
                          <div className="mt-2 flex gap-0.5 h-1.5 rounded-full overflow-hidden">
                            <div style={{ width: `${sentData.positive_pct}%`, background: 'var(--success)' }} />
                            <div style={{ width: `${sentData.neutral_pct}%`, background: 'var(--warning)' }} />
                            <div style={{ width: `${sentData.negative_pct}%`, background: 'var(--danger)' }} />
                          </div>
                          <p className="text-xs text-[var(--text-faint)] mt-1.5">
                            {Math.round(sentData.neutral_pct)}% neutral &middot; {Math.round(sentData.negative_pct)}% negative
                          </p>
                        </>
                      ) : (
                        <>
                          <p className="text-3xl font-bold text-[var(--text-primary)] mt-1">&mdash;</p>
                          <p className="text-xs text-[var(--text-faint)] mt-1">No mentions to analyze</p>
                        </>
                      )}
                    </div>
                  </div>

                  {/* SOV */}
                  <div className="flex-1 card p-5">
                    <div className="flex items-center justify-between mb-3">
                      <p className="text-sm font-medium text-[var(--text-secondary)] flex items-center">
                        Share of Voice
                        <HelpTooltip text="Percentage of total AI brand mentions in your category per entity." />
                      </p>
                      <button
                        onClick={() => setCompetitorModalOpen(true)}
                        aria-label="Manage competitors"
                        className="flex items-center gap-1.5 text-xs text-[var(--text-muted)] hover:text-[var(--text-secondary)] bg-[rgba(255,255,255,0.06)] hover:bg-[var(--accent-muted)] border border-[rgba(255,255,255,0.08)] rounded-lg px-2.5 py-1.5 transition-colors"
                      >
                        <Users size={12} />
                        {analytics?.sov.has_competitors ? 'Manage' : 'Add competitors'}
                      </button>
                    </div>
                    {loadingAnalytics ? (
                      <div className="flex gap-3">
                        {[1, 2, 3].map(i => <div key={i} className="h-4 flex-1 bg-[rgba(255,255,255,0.06)] rounded animate-pulse" />)}
                      </div>
                    ) : !analytics?.sov.has_competitors ? (
                      <p className="text-xs text-[var(--text-faint)]">
                        Add competitors to see how your brand&apos;s AI visibility compares.
                      </p>
                    ) : (() => {
                      const allStats = analytics.competitor_comparison;
                      const sorted = [...allStats].sort((a, b) => (b.is_primary ? 1 : 0) - (a.is_primary ? 1 : 0));
                      const count = sorted.length;

                      return (
                        <div className={`grid gap-3 ${isMobile ? 'grid-cols-1' : count <= 2 ? 'grid-cols-1' : count <= 4 ? 'grid-cols-2' : 'grid-cols-2 sm:grid-cols-3'}`}>
                          {sorted.map((s) => {
                            const pct = Math.round(s.mention_rate * 100);
                            const barColor = s.is_primary ? 'var(--accent)' : 'var(--text-faint)';
                            const textColor = s.is_primary ? 'var(--accent-light)' : 'var(--text-muted)';
                            return (
                              <div key={s.name} className="flex flex-col gap-1.5">
                                <div className="flex items-center justify-between">
                                  <span className={`text-xs font-medium truncate ${s.is_primary ? 'text-[var(--text-primary)]' : 'text-[var(--text-secondary)]'}`}>{s.name}</span>
                                  <span className="text-xs font-semibold tabular-nums ml-2 flex-shrink-0" style={{ color: textColor }}>{pct}%</span>
                                </div>
                                <div className="h-1.5 rounded-full bg-[rgba(255,255,255,0.06)] overflow-hidden">
                                  <div
                                    className="h-full rounded-full transition-all duration-500"
                                    style={{ width: `${pct}%`, background: barColor }}
                                  />
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      );
                    })()}
                  </div>
                </div>
              </div>

              {/* Row 2: Avg Position + Top Domains */}
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-4">
                {/* Avg Position */}
                <div className="card p-5">
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-sm font-medium text-[var(--text-secondary)] flex items-center">
                      Avg Position
                      <HelpTooltip text="Position indicates where in the AI response your brand typically appears. Earlier is better." />
                    </p>
                    <div className="w-8 h-8 rounded-lg bg-[rgba(255,255,255,0.06)] flex items-center justify-center text-[var(--accent)]">
                      <Building2 size={15} />
                    </div>
                  </div>
                  {loadingAnalytics ? (
                    <div className="h-8 w-16 bg-[rgba(255,255,255,0.06)] rounded animate-pulse" />
                  ) : analytics?.position.score != null ? (
                    <>
                      <p className="text-3xl font-bold text-[var(--text-primary)]">
                        {analytics.position.score.toFixed(1)}
                        <span className="text-base font-normal text-[var(--text-faint)]">/10</span>
                      </p>
                      <p className="text-xs text-[var(--text-faint)] mt-1">
                        {analytics.position.score <= 4
                          ? 'Mentioned early in responses'
                          : analytics.position.score <= 7
                          ? 'Mentioned mid-way in responses'
                          : 'Mentioned late in responses'} &middot; {analytics.position.sample_count} samples
                      </p>
                    </>
                  ) : (
                    <>
                      <p className="text-3xl font-bold text-[var(--text-primary)]">&mdash;</p>
                      <p className="text-xs text-[var(--text-faint)] mt-1">No mentions recorded</p>
                    </>
                  )}
                </div>

                {/* Top Domains */}
                <div className="lg:col-span-2 card p-5 flex flex-col">
                  <div className="flex items-center justify-between mb-3">
                    <p className="text-sm font-medium text-[var(--text-secondary)] flex items-center">
                      Top Cited Domains (across all tracked prompts)
                      <HelpTooltip text="Websites that AI models cite most often across all tracked prompts — regardless of whether your brand was mentioned." />
                    </p>
                    <Globe size={14} className="text-[var(--text-faint)]" />
                  </div>
                  {loadingAnalytics ? (
                    <div className="flex items-center justify-center flex-1 py-4">
                      <div className="w-24 h-24 rounded-full bg-[rgba(255,255,255,0.06)] animate-pulse" />
                    </div>
                  ) : analytics && analytics.top_domains.length > 0 ? (
                    <DonutDomains domains={analytics.top_domains.slice(0, 6)} />
                  ) : (
                    <div className="flex items-center justify-center flex-1 py-4">
                      <p className="text-xs text-[var(--text-faint)]">No domain data yet</p>
                    </div>
                  )}
                </div>
              </div>

              {/* Row 3: Model breakdown */}
              <div className="mb-4">
                <div className="card p-5">
                  <div className="flex items-center gap-2 mb-4">
                    <BarChart2 size={15} className="text-[var(--accent)]" />
                    <h3 className="text-[15px] font-medium text-[var(--text-primary)]">Performance by Model</h3>
                    <HelpTooltip text="How often each AI model mentions your brand when answering relevant prompts." />
                  </div>
                  {loadingAnalytics ? (
                    <div className="space-y-3">
                      {[1,2,3,4].map(i => <div key={i} className="h-6 bg-[rgba(255,255,255,0.06)] rounded animate-pulse" />)}
                    </div>
                  ) : (
                    <DashboardModelBreakdown models={analytics?.model_breakdown ?? []} deltas={modelDeltas} />
                  )}
                </div>
              </div>

              {/* Recent Conversations */}
              <BrandTable
                analytics={analytics}
                loadingAnalytics={loadingAnalytics}
                isRunning={isRunning}
                isMobile={isMobile}
                expandedConvId={expandedConvId}
                setExpandedConvId={setExpandedConvId}
                convModelFilter={convModelFilter}
                setConvModelFilter={setConvModelFilter}
              />
            </>
          )}
        </>
      )}

      {/* Modals */}
      {promptModalOpen && selectedBrandId && brandDetail && (
        <ManagePromptsModal
          brandId={selectedBrandId}
          brandName={brandDetail.name}
          prompts={brandDetail.prompts}
          promptLimit={brandDetail.brand_type === 'pitch' ? 10 : (user?.prompt_limit ?? 10)}
          onClose={() => setPromptModalOpen(false)}
          onChanged={(updated) => setBrandDetail((prev) => prev ? { ...prev, prompts: updated } : prev)}
        />
      )}
      {competitorModalOpen && selectedBrandId && (
        <CompetitorModal
          brandId={selectedBrandId}
          competitors={competitors}
          competitorStats={analytics?.competitor_comparison ?? []}
          onClose={() => setCompetitorModalOpen(false)}
          onChanged={(updated) => setCompetitors(updated)}
        />
      )}

      {toast && <AppToast {...toast} onDismiss={() => setToast(null)} />}
    </motion.div>
  );
}
