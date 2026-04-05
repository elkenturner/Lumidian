'use client';

import { useEffect, useState, useRef, useCallback, useMemo } from 'react';
import Link from 'next/link';
import {
  Plus,
  BarChart2,
  TrendingUp,
  Users,
  MessageSquare,
  Globe,
  Zap,
  ChevronDown,
  Building2,
  Play,
  Loader2,
  RefreshCw,
  CheckCircle2,
} from 'lucide-react';
import BrandAvatar from '@/components/BrandAvatar';
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
  CompetitorStat,
  ModelStat,
  BillingStatus,
  BillingUsage,
  parseApiError,
} from '@/lib/api';
import { AppToast, ToastData } from '@/components/AppToast';
import TrendChart from '@/components/TrendChart';
import SubscriptionBanner from '@/components/SubscriptionBanner';
import { ManagePromptsModal } from '@/components/ManagePromptsModal';
import { CompetitorModal } from '@/components/CompetitorModal';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useAuth } from '@/contexts/AuthContext';
import { useBrand } from '@/contexts/BrandContext';
import {
  AreaChart,
  Area,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
import { format } from 'date-fns';
import { MODEL_ORDER, MODEL_CONFIG as MODEL_CONFIG_SHARED, getModelConfig } from '@/lib/constants/models';
import { parseUTCISO } from '@/lib/utils/formatting';

const MODEL_CONFIG: Record<string, { label: string; bg: string; text: string }> = Object.fromEntries(
  Object.entries(MODEL_CONFIG_SHARED).map(([k, v]) => [k, { label: v.label, bg: v.mutedBg, text: v.color }])
);

function getModelCfg(model: string) {
  const cfg = getModelConfig(model);
  return { label: cfg.label, bg: cfg.mutedBg, text: cfg.color, key: cfg.key };
}

function stripMarkdown(text: string): string {
  return text
    .replace(/^#+\s+/gm, '')
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/\*(.+?)\*/g, '$1')
    .replace(/\[(\d+)\]/g, '')
    .replace(/\n+/g, ' ')
    .trim();
}

// ── Tooltip help icon ──────────────────────────────────────────────────────────

function HelpTooltip({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  return (
    <span
      className="relative inline-flex ml-1.5 align-middle"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <span className="w-4 h-4 rounded-full bg-[rgba(255,255,255,0.06)] border border-[rgba(255,255,255,0.10)] text-[var(--text-faint)] text-[10px] font-bold flex items-center justify-center cursor-help select-none">
        ?
      </span>
      {open && (
        <span className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-60 bg-[var(--bg-base)] border border-[var(--accent-border)] rounded-lg p-3 text-xs text-[var(--text-secondary)] leading-relaxed shadow-lg z-50 pointer-events-none whitespace-normal">
          {text}
        </span>
      )}
    </span>
  );
}

// ── Sparkline tooltip ──────────────────────────────────────────────────────────

function SparklineTooltip({ active, payload }: { active?: boolean; payload?: Array<{ value: number; payload: TrendPoint & { formattedDate: string } }> }) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <div className="bg-[var(--bg-base)] border border-[var(--accent-border)] rounded-lg p-2 shadow-lg text-xs">
      <p className="text-[var(--text-muted)]">{d.formattedDate}</p>
      <p className="text-[var(--accent)] font-bold">{Math.round(d.score)}%</p>
    </div>
  );
}

// ── Top domains donut chart ─────────────────────────────────────────────────────

const DOMAIN_COLORS = ['var(--accent)', 'var(--success)', 'var(--warning)', 'var(--color-perplexity)', '#f43f5e', '#06b6d4'];

function DonutDomains({ domains }: { domains: Array<{ domain: string; pct: number; count: number; domain_type: string }> }) {
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const total = domains.reduce((s, d) => s + d.count, 0);
  const data = domains.map((d) => ({ ...d, value: d.count }));
  const active = activeIndex !== null ? data[activeIndex] : null;
  const activePct = active && total > 0 ? ((active.count / total) * 100).toFixed(1) : null;

  return (
    <div className="flex items-center gap-5 flex-1 min-h-0">
      {/* Donut */}
      <div className="relative flex-shrink-0" style={{ width: 130, height: 130 }}>
        <PieChart width={130} height={130}>
          <Pie
            data={data}
            cx={65}
            cy={65}
            innerRadius={42}
            outerRadius={60}
            paddingAngle={2}
            dataKey="value"
            strokeWidth={0}
            startAngle={90}
            endAngle={-270}
            onMouseEnter={(_, i) => setActiveIndex(i)}
            onMouseLeave={() => setActiveIndex(null)}
          >
            {data.map((_, i) => (
              <Cell
                key={i}
                fill={DOMAIN_COLORS[i % DOMAIN_COLORS.length]}
                opacity={activeIndex === null || activeIndex === i ? 1 : 0.25}
                style={{ cursor: 'default', outline: 'none' }}
              />
            ))}
          </Pie>
        </PieChart>
        {/* Centre label */}
        <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
          {active && activePct ? (
            <>
              <span className="text-base font-bold text-[var(--text-primary)] leading-none">{activePct}%</span>
              <span className="text-[10px] text-[var(--text-muted)] mt-0.5 max-w-[60px] text-center leading-tight truncate">{active.domain.replace(/^www\./, '')}</span>
            </>
          ) : (
            <>
              <span className="text-base font-bold text-[var(--text-primary)] leading-none">{data.length}</span>
              <span className="text-[10px] text-[var(--text-muted)] mt-0.5">sources</span>
            </>
          )}
        </div>
      </div>

      {/* Legend */}
      <div className="flex-1 min-w-0 space-y-2">
        {data.map((d, i) => {
          const pct = total > 0 ? (d.count / total) * 100 : 0;
          const color = DOMAIN_COLORS[i % DOMAIN_COLORS.length];
          const isActive = activeIndex === i;
          return (
            <div
              key={d.domain}
              className="flex items-center gap-2 min-w-0 cursor-default"
              onMouseEnter={() => setActiveIndex(i)}
              onMouseLeave={() => setActiveIndex(null)}
              style={{ opacity: activeIndex === null || isActive ? 1 : 0.4, transition: 'opacity 0.15s' }}
            >
              <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: color }} />
              <span className="text-xs truncate flex-1 min-w-0" style={{ color: isActive ? 'var(--text-primary)' : 'var(--text-secondary)' }}>{d.domain}</span>
              <span className="text-xs tabular-nums font-semibold flex-shrink-0" style={{ color: isActive ? color : 'var(--text-muted)' }}>{pct.toFixed(1)}%</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Model breakdown bars ───────────────────────────────────────────────────────

const MODEL_BAR_COLORS: Record<string, string> = {
  chatgpt: 'var(--color-chatgpt)',
  claude: 'var(--color-claude)',
  perplexity: 'var(--color-perplexity)',
  gemini: 'var(--color-gemini)',
};

function ModelBreakdown({ models, deltas }: { models: ModelStat[]; deltas?: Record<string, number> }) {
  if (!models.length) return <p className="text-xs text-[var(--text-faint)]">No model data yet</p>;
  return (
    <div className="space-y-3 w-full">
      {models.map((m) => {
        const pct = Math.round(m.mention_rate * 100);
        const barColor = MODEL_BAR_COLORS[m.model] ?? 'var(--accent)';
        const barWidth = `${pct}%`;
        const delta = deltas?.[m.model];
        return (
          <div key={m.model}>
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs font-medium text-[var(--text-secondary)]">{m.label}</span>
              <span className="text-xs tabular-nums text-[var(--text-secondary)] flex items-center gap-1">
                {delta !== undefined && delta !== 0 && (
                  <span style={{ color: delta > 0 ? 'var(--success)' : 'var(--danger-text)', fontWeight: 600 }}>
                    {delta > 0 ? `↑${delta}%` : `↓${Math.abs(delta)}%`}
                  </span>
                )}
                {pct}% <span className="text-[var(--text-faint)]">({m.mention_count}/{m.total})</span>
              </span>
            </div>
            <div className="h-1.5 w-full bg-[rgba(255,255,255,0.06)] rounded-full overflow-hidden">
              <div className="h-full rounded-full transition-all duration-500" style={{ width: barWidth, background: barColor }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── Reports tab prompt groups ──────────────────────────────────────────────────

interface PromptGroup {
  promptId: number;
  promptText: string;
  total: number;
  mentioned: number;
  modelStats: Map<string, { total: number; mentioned: number }>;
  responses: QueryResult[];
}

function buildPromptGroups(responses: QueryResult[]): PromptGroup[] {
  const map = new Map<number, PromptGroup>();
  for (const r of responses) {
    if (!map.has(r.prompt_id)) {
      map.set(r.prompt_id, { promptId: r.prompt_id, promptText: r.prompt_text ?? '', total: 0, mentioned: 0, modelStats: new Map(), responses: [] });
    }
    const pg = map.get(r.prompt_id)!;
    pg.total++;
    if (r.mentioned) pg.mentioned++;
    pg.responses.push(r);
    if (!pg.modelStats.has(r.model)) pg.modelStats.set(r.model, { total: 0, mentioned: 0 });
    const ms = pg.modelStats.get(r.model)!;
    ms.total++;
    if (r.mentioned) ms.mentioned++;
  }
  return Array.from(map.values());
}

// ── Best Performing Prompt card ────────────────────────────────────────────────

function BestPromptCard({ responses, loading }: { responses: QueryResult[]; loading: boolean }) {
  // Compute the top prompt by mention rate from available responses
  const best = (() => {
    if (!responses.length) return null;
    const map = new Map<number, { text: string; total: number; mentioned: number; models: Set<string> }>();
    for (const r of responses) {
      if (r.error) continue;
      if (!map.has(r.prompt_id)) {
        map.set(r.prompt_id, { text: r.prompt_text ?? '', total: 0, mentioned: 0, models: new Set() });
      }
      const p = map.get(r.prompt_id)!;
      p.total++;
      if (r.mentioned) { p.mentioned++; p.models.add(r.model); }
    }
    let top: { text: string; total: number; mentioned: number; models: string[] } | null = null;
    let topRate = -1;
    for (const [, p] of Array.from(map)) {
      if (p.total === 0) continue;
      const rate = p.mentioned / p.total;
      if (rate > topRate || (rate === topRate && top && p.mentioned > top.mentioned)) {
        topRate = rate;
        top = { text: p.text, total: p.total, mentioned: p.mentioned, models: Array.from(p.models) };
      }
    }
    return top;
  })();

  return (
    <div className="self-start card p-5" style={{ borderLeft: '2px solid var(--accent-muted)' }}>
      <p className="text-sm font-medium text-[var(--text-secondary)] flex items-center mb-3">
        Best Performing Prompt
        <HelpTooltip text="The prompt where your brand is mentioned most often across AI models." />
      </p>
      {loading ? (
        <div className="space-y-2 flex-1">
          <div className="h-3 w-full bg-[rgba(255,255,255,0.06)] rounded animate-pulse" />
          <div className="h-3 w-2/3 bg-[rgba(255,255,255,0.06)] rounded animate-pulse" />
        </div>
      ) : best ? (
        <>
          <p className="text-sm text-[var(--text-primary)] leading-relaxed line-clamp-2 flex-1">
            &ldquo;{best.text}&rdquo;
          </p>
          <div className="flex items-end justify-between mt-3">
            <p className="text-2xl font-bold text-[var(--success)] leading-none">
              {Math.round((best.mentioned / best.total) * 100)}%
              <span className="text-xs font-normal text-[var(--text-faint)] ml-1">visibility</span>
            </p>
            {best.models.length > 0 && (
              <div className="flex flex-wrap gap-1 justify-end">
                {best.models.map((m) => {
                  const cfg = getModelCfg(m);
                  return (
                    <span key={m} className="text-[10px] font-medium px-1.5 py-0.5 rounded" style={{ background: cfg.bg, color: cfg.text }}>
                      {cfg.label}
                    </span>
                  );
                })}
              </div>
            )}
          </div>
        </>
      ) : (
        <>
          <p className="text-3xl font-bold text-[var(--text-primary)] mt-1">—</p>
          <p className="text-xs text-[var(--text-faint)] mt-1">No data yet</p>
        </>
      )}
    </div>
  );
}

// ── Page ───────────────────────────────────────────────────────────────────────

export default function DashboardPage() {
  const { user } = useAuth();
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
      // Start getRecentRuns first and chain getResponses off it immediately —
      // so response fetching begins as soon as run IDs are known, without
      // waiting for the slower analytics/trends fetches to complete.
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

      // Bail out if the user has already switched to a different brand
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
    // Cancel any in-flight request for a previous brand
    loadAbortRef.current?.abort();
    const controller = new AbortController();
    loadAbortRef.current = controller;
    loadData(selectedBrandId, controller.signal);
    return () => controller.abort();
  }, [selectedBrandId, loadData]);

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
        // Persist updated list to localStorage
        if (typeof window !== 'undefined') {
          const key = 'pendingPromptRuns';
          try {
            const stored: Array<{ promptId: number; runId: number }> = JSON.parse(localStorage.getItem(key) ?? '[]');
            const updated = stored.filter(({ promptId }) => !completed.includes(promptId));
            localStorage.setItem(key, JSON.stringify(updated));
          } catch { /* ignore */ }
        }
        // Refresh dashboard data
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
          // Write to localStorage first so fetchBrands selects the right brand
          setActiveBrandId(newBrandId);
        }
        // Refetch brands — the new brand won't be in BrandContext's stale list
        refetchBrands();
        setNewBrandMode(true);
        setNewBrandStep('running');
        // Clean URL without reload
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
            // Auto-generate drafts for new brand onboarding
            if (newBrandMode && !newBrandHandledRef.current && run.status === 'completed') {
              newBrandHandledRef.current = true;
              setNewBrandStep('drafting');
              try {
                await generateNow(selectedBrandId, 20);
              } catch { /* non-fatal */ }
              // Fire-and-forget Reddit scan
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
  // Use overview?.latest_run?.status directly — latestRun is declared later in render
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
    if (!selectedBrandId) return;
    setTriggering(true);
    try {
      const result = await triggerRun(selectedBrandId);
      setActiveRunId(result.run_id);
      // Refresh usage after a successful run
      getBillingUsage().then(setUsage).catch((err) => logError(err, 'Dashboard: refresh billing usage after run'));
    } catch (err: unknown) {
      const e = err as { response?: { status?: number; data?: { detail?: string } } };
      const httpStatus = e?.response?.status;
      const detail = parseApiError(err);
      if (httpStatus === 429 || httpStatus === 402) {
        setUpgradeModalReason(detail);
        setUpgradeModalOpen(true);
      } else {
        setToast({ message: detail, type: 'error' });
      }
    } finally {
      setTriggering(false);
    }
  }

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

  // Next auto-report: scheduled once daily at 08:00 UTC
  const nextReportHours: number | null = (() => {
    const now = new Date();
    let next = new Date(Date.UTC(
      now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 8, 0, 0, 0
    ));
    if (next.getTime() <= now.getTime()) next = new Date(next.getTime() + 86400000);
    const h = Math.round((next.getTime() - now.getTime()) / 3600000);
    return h > 0 ? h : null;
  })();

  // Time elapsed since last completed run
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

  // Sort: prompts where brand IS mentioned appear first, then by mention rate within each group
  const promptGroups = useMemo(() => buildPromptGroups(responses).sort((a, b) => {
    const aMentioned = a.mentioned > 0 ? 1 : 0;
    const bMentioned = b.mentioned > 0 ? 1 : 0;
    if (bMentioned !== aMentioned) return bMentioned - aMentioned;
    const pctA = a.total > 0 ? a.mentioned / a.total : 0;
    const pctB = b.total > 0 ? b.mentioned / b.total : 0;
    return pctB - pctA;
  }), [responses]);

  // Prompts with no run data yet (fix 4)
  const trackedPromptIds = new Set(promptGroups.map((g) => g.promptId));
  const untrackedPrompts: Prompt[] = (brandDetail?.prompts ?? []).filter(
    (p) => !trackedPromptIds.has(p.id)
  );

  // Free-plan daily run limit
  const isAtRunLimit = !user?.is_admin && usage !== null && usage.manual_run_limit !== null && usage.manual_runs_today >= usage.manual_run_limit;

  // Quick stats
  const totalPrompts = (brandDetail?.prompts ?? []).length;
  const totalRuns = trends.length;
  const totalResponses = trends.reduce((acc, t) => acc + (t.total_queries ?? 0), 0);

  // Live vs Index sub-scores — derived from analytics.model_breakdown (all-time aggregate)
  // so they stay consistent with the Performance by Model section.
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

  // Model trend deltas: compare last two trend points' model_scores
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

  return (
    <div className="px-4 sm:px-8 py-6 sm:py-8 max-w-7xl">
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
          <span className="text-[var(--bg-elevated)]">·</span>
          <span className="flex items-center gap-1.5">
            <span className="text-[var(--text-muted)]">Runs today</span>
            <span className="font-semibold tabular-nums text-[var(--text-secondary)]">{usage.manual_runs_today}/{usage.manual_run_limit}</span>
          </span>
        </div>
      )}

      {/* Upgrade modal — shown when a plan limit is hit */}
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
              <span className="text-white text-xs font-bold" aria-hidden="true">✓</span>
            </div>
          )}
          <div>
            {newBrandStep === 'drafting' && (
              <>
                <p className="text-sm font-medium text-[var(--text-primary)]">Report complete! Generating content drafts…</p>
                <p className="text-xs text-[var(--text-muted)] mt-0.5">Creating drafts for your top visibility gaps.</p>
              </>
            )}
            {newBrandStep === 'done' && (
              <>
                <p className="text-sm font-medium text-[var(--success)]">All set! Your report and drafts are ready.</p>
                <p className="text-xs text-[var(--text-muted)] mt-0.5">
                  Your first content drafts are waiting —{' '}
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
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-6">
        <div className="flex items-center gap-3">
          {selectedBrand && (
            <BrandAvatar
              name={selectedBrand.name}
              websiteUrl={selectedBrand.website_url ?? undefined}
              size={36}
              className="rounded-xl bg-[var(--accent-muted)] border border-[var(--accent-border)]"
              style={{ padding: 5 }}
              textClassName="text-sm font-bold text-[var(--accent)]"
            />
          )}
          <div>
            <h1 className="text-xl sm:text-2xl font-bold text-[var(--text-primary)]" style={{ fontFamily: 'var(--font-syne)', fontWeight: 800, letterSpacing: '-0.3px' }}>
              {selectedBrand ? selectedBrand.name : 'Dashboard'}
            </h1>
            <p className="text-[13px] text-[var(--text-muted)] mt-1.5">AI visibility analytics</p>
          </div>
        </div>
        <div className="flex items-center gap-2 sm:gap-3">
          <button
            onClick={() => setPromptModalOpen(true)}
            disabled={!selectedBrandId}
            className="flex items-center gap-2 bg-[var(--accent-muted)] hover:bg-[var(--accent-muted)] border border-[var(--accent-border)] hover:border-[rgba(255,255,255,0.14)] text-[var(--text-muted)] hover:text-[var(--text-secondary)] rounded-lg px-3 py-2 text-xs transition-all duration-150"
          >
            <MessageSquare size={14} />
            Prompts
          </button>
          <button
            onClick={() => selectedBrandId && loadData(selectedBrandId)}
            aria-label="Refresh dashboard"
            className="flex items-center gap-2 bg-[var(--accent-muted)] hover:bg-[var(--accent-muted)] border border-[var(--accent-border)] hover:border-[rgba(255,255,255,0.14)] text-[var(--text-muted)] hover:text-[var(--text-secondary)] rounded-lg px-3 py-2 transition-all duration-150"
          >
            <RefreshCw size={14} />
          </button>
          <div className="flex flex-col items-end gap-1">
            <button
              onClick={isAtRunLimit ? () => { setUpgradeModalReason("You've used your 1 daily report run. Upgrade to run reports any time."); setUpgradeModalOpen(true); } : handleRunReport}
              disabled={triggering || isRunning || !selectedBrandId}
              title={isAtRunLimit ? 'Daily run limit reached — resets at midnight UTC' : undefined}
              className={`flex items-center gap-2 rounded-lg px-5 py-2.5 text-sm font-semibold transition-all duration-200 ${
                isAtRunLimit
                  ? 'bg-[var(--accent-muted)] border border-[var(--accent-border)] text-[var(--text-faint)] cursor-default'
                  : 'bg-[var(--accent)] hover:bg-[var(--accent-hover)] disabled:opacity-50 text-white shadow-lg shadow-[var(--accent)]/25 hover:shadow-[var(--accent)]/40 hover:shadow-xl'
              }`}
            >
              {triggering || isRunning ? (
                <>
                  <Loader2 size={14} className="animate-spin" />
                  {isRunning ? 'Running...' : 'Starting...'}
                </>
              ) : isAtRunLimit ? (
                <>
                  <Zap size={14} className="text-[var(--accent)]/60" />
                  1 run / day
                </>
              ) : (
                <>
                  <Play size={14} />
                  Run Report Now
                </>
              )}
            </button>
            {isAtRunLimit && (
              <p className="text-[11px] text-[var(--text-faint)]">
                Resets midnight UTC ·{' '}
                <button
                  onClick={() => { setUpgradeModalReason("You've used your 1 daily report run. Upgrade to run reports any time."); setUpgradeModalOpen(true); }}
                  className="text-[var(--accent)] hover:text-[var(--accent-light)] transition-colors"
                >
                  Upgrade
                </button>
              </p>
            )}
          </div>
        </div>
      </div>



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
          {/* Step cards */}
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
          {/* ── EMPTY STATE: brand selected but no runs yet ──────────────── */}
          {!loadingBrands && !loadingAnalytics && !isRunning && selectedBrandId && trends.length === 0 && overview?.latest_run == null && (
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
                disabled={triggering}
                className="flex items-center gap-2 bg-[var(--accent)] hover:bg-[var(--accent-hover)] disabled:opacity-50 text-white rounded-lg px-6 py-3 text-sm font-semibold transition-colors shadow-lg shadow-[var(--accent)]/25"
              >
                {triggering ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />}
                Run First Report
              </button>
            </div>
          )}

          {/* ── FIRST-RUN EMPTY STATE ──────────────────────────────────── */}
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

          {/* ── OVERVIEW ─────────────────────────────────────────────────── */}
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
                    Complete profile →
                  </Link>
                </div>
              )}

              {/* Quick stats row */}
              {!loadingAnalytics && totalRuns > 0 && (
                <div className="grid grid-cols-3 gap-3 mb-4">
                  {([
                    { label: 'Prompts Tracked',   value: totalPrompts || '—',   icon: MessageSquare, accent: 'var(--color-gemini)', iconBg: 'var(--color-gemini-muted)',  borderTop: 'var(--color-gemini)', sub: null, subColor: '' },
                    { label: 'Days Tracking',     value: daysSinceFirst != null ? daysSinceFirst : '—', icon: TrendingUp, accent: 'var(--warning-text)', iconBg: 'var(--warning-muted)', borderTop: 'var(--warning)', sub: null, subColor: '' },
                    { label: 'Content Published', value: publishedCount || '—', icon: CheckCircle2, accent: 'var(--success-text)', iconBg: 'var(--success-muted)', borderTop: 'var(--success)', sub: null, subColor: '' },
                  ] as Array<{ label: string; value: string | number; icon: React.ElementType; accent: string; iconBg: string; borderTop: string; sub: string | null; subColor: string }>).map(({ label, value, icon: Icon, accent, iconBg, borderTop, sub, subColor }) => (
                    <div
                      key={label}
                      className="bg-[var(--accent-muted)] border border-[var(--accent-border)] rounded-xl px-4 py-4 flex items-center gap-3"
                      style={{ borderTopColor: borderTop, borderTopWidth: 2 }}
                    >
                      <div
                        className="w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0"
                        style={{ background: iconBg, border: `1px solid ${accent}33` }}
                      >
                        <Icon size={15} style={{ color: accent }} />
                      </div>
                      <div className="min-w-0">
                        <p className="text-xl font-bold text-[var(--text-primary)] leading-tight tabular-nums">{value}</p>
                        {sub && (
                          <p className="text-[10px] font-medium leading-tight mt-0.5" style={{ color: subColor }}>{sub}</p>
                        )}
                        <p className="text-[11px] text-[var(--text-muted)] mt-0.5 truncate">{label}</p>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* Row 1: visibility (left) + prompt/sentiment/sov (right) */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                {/* Visibility score + sparkline */}
                <div className="card border-t-2 border-t-[var(--accent)] p-6 shadow-[0_8px_32px_rgba(0,0,0,0.25),0_0_40px_var(--accent-muted),inset_0_1px_0_rgba(255,255,255,0.07)]">
                  <div className="flex items-start justify-between mb-3">
                    <div>
                      <p className="text-[13px] font-medium text-[var(--text-secondary)] flex items-center">
                        Visibility Score
                        <HelpTooltip text="Percentage of AI responses that mention your brand when answering your tracked prompts. A higher score means AI models are more aware of your brand." />
                      </p>
                      {loadingAnalytics ? (
                        <div className="h-14 w-28 bg-[rgba(255,255,255,0.06)] rounded animate-pulse mt-2" />
                      ) : (
                        <>
                          <p className="text-6xl font-bold text-[var(--text-primary)] mt-1 leading-none">
                            {score != null ? `${Math.round(score)}%` : 'N/A'}
                          </p>
                          {scoreDelta !== null && (
                            <p className={`text-xs font-medium mt-2 ${scoreDelta > 0 ? 'text-[var(--success)]' : scoreDelta < 0 ? 'text-[var(--danger-text)]' : 'text-[var(--text-muted)]'}`}>
                              {scoreDelta > 0 ? `+${scoreDelta}%` : scoreDelta < 0 ? `${scoreDelta}%` : '—'} since {sinceLastRun ?? 'last run'}
                            </p>
                          )}
                        </>
                      )}
                    </div>
                    <div className="w-10 h-10 rounded-xl bg-[rgba(255,255,255,0.06)] flex items-center justify-center text-[var(--accent)]">
                      <BarChart2 size={18} />
                    </div>
                  </div>
                  {sparkData.length > 1 ? (
                    <ResponsiveContainer width="100%" height={44}>
                      <AreaChart data={sparkData} margin={{ top: 0, right: 0, left: 0, bottom: 0 }}>
                        <defs>
                          <linearGradient id="sparkGrad" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="var(--accent)" stopOpacity={0.3} />
                            <stop offset="95%" stopColor="var(--accent)" stopOpacity={0} />
                          </linearGradient>
                        </defs>
                        <Tooltip content={<SparklineTooltip />} />
                        <Area type="monotone" dataKey="score" stroke="var(--accent)" strokeWidth={2.5} fill="url(#sparkGrad)" dot={false} />
                      </AreaChart>
                    </ResponsiveContainer>
                  ) : (
                    <p className="text-xs text-[var(--text-faint)] mt-2">
                      {sparkData.length === 1 ? '1 run recorded' : 'No trend data yet'}
                    </p>
                  )}
                  {nextReportHours !== null && (
                    <p className="text-[11px] text-[var(--text-faint)] mt-2">
                      Next report in {nextReportHours}h
                    </p>
                  )}

                  {/* Live / Index sub-score breakdown */}
                  {!loadingAnalytics && score !== null && (liveScore !== null || indexScore !== null) && (
                    <div className="mt-3 space-y-2 border-t border-[rgba(255,255,255,0.06)] pt-3">
                      {([
                        { label: 'Live Search', s: liveScore,  models: 'Perplexity · Gemini',  color: 'var(--success)' },
                        { label: 'AI Index',    s: indexScore, models: 'GPT-4o-mini · Claude', color: 'var(--accent-light)' },
                      ] as Array<{ label: string; s: number | null; models: string; color: string }>).map(({ label, s, models, color }) => (
                        <div key={label}>
                          <div className="flex items-center gap-3 mb-0.5">
                            <div className="flex items-center gap-1.5 w-24 flex-shrink-0">
                              <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: color }} />
                              <span className="text-[11px] font-medium text-[var(--text-muted)] truncate">{label}</span>
                            </div>
                            <div className="flex-1 h-1.5 bg-[rgba(255,255,255,0.08)] rounded-full overflow-hidden">
                              <div className="h-full rounded-full transition-all duration-500" style={{ width: `${s ?? 0}%`, background: color }} />
                            </div>
                            <span className="text-xs font-bold tabular-nums w-9 text-right flex-shrink-0" style={{ color }}>
                              {s !== null ? `${s}%` : '—'}
                            </span>
                          </div>
                          <p className="text-[9px] text-[var(--text-faint)] pl-[108px] truncate">{models}</p>
                        </div>
                      ))}
                      {liveScore !== null && indexScore !== null && (
                        <p className="text-[10px] text-[var(--text-muted)] italic pt-0.5">
                          {liveScore >= 50 && indexScore >= 50
                            ? 'Strong across live search and AI knowledge.'
                            : liveScore >= 50 && indexScore < 50
                              ? 'Trending online — not yet embedded in AI training data.'
                              : liveScore < 50 && indexScore >= 50
                                ? 'AI-recognized brand — boost recent content for live visibility.'
                                : 'Low visibility across channels — more content and coverage needed.'}
                        </p>
                      )}
                    </div>
                  )}
                </div>

                {/* Right column: Best Prompt + Sentiment on top, SOV below */}
                <div className="flex flex-col gap-3">
                  {/* Top row */}
                  <div className="grid grid-cols-2 gap-3">
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
                            {Math.round(sentData.neutral_pct)}% neutral · {Math.round(sentData.negative_pct)}% negative
                          </p>
                        </>
                      ) : (
                        <>
                          <p className="text-3xl font-bold text-[var(--text-primary)] mt-1">—</p>
                          <p className="text-xs text-[var(--text-faint)] mt-1">No mentions to analyze</p>
                        </>
                      )}
                    </div>
                  </div>

                  {/* SOV — fills remaining height */}
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
                      const maxRate = Math.max(...allStats.map((s) => s.mention_rate));
                      return (
                        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                          {allStats.map((s) => {
                            const pct = Math.round(s.mention_rate * 100);
                            const isLeading = s.mention_rate === maxRate && maxRate > 0;
                            const barColor = s.is_primary ? (isLeading ? 'var(--success)' : 'var(--accent)') : (isLeading ? 'var(--danger)' : 'var(--text-faint)');
                            const textColor = s.is_primary ? (isLeading ? 'var(--success)' : 'var(--accent-light)') : (isLeading ? 'var(--danger-text)' : 'var(--text-muted)');
                            return (
                              <div key={s.name} className="flex flex-col gap-1.5">
                                <div className="flex items-center justify-between">
                                  <span className={`text-xs font-medium truncate ${s.is_primary ? 'text-[var(--text-primary)]' : 'text-[var(--text-secondary)]'}`}>{s.name}</span>
                                  <span className="text-xs font-bold tabular-nums ml-2 flex-shrink-0" style={{ color: textColor }}>{pct}%</span>
                                </div>
                                <div className="h-1.5 rounded-full bg-[rgba(255,255,255,0.08)] overflow-hidden">
                                  <div className="h-full rounded-full transition-all" style={{ width: `${maxRate > 0 ? (s.mention_rate / maxRate) * 100 : 0}%`, background: barColor }} />
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
                          : 'Mentioned late in responses'} · {analytics.position.sample_count} samples
                      </p>
                    </>
                  ) : (
                    <>
                      <p className="text-3xl font-bold text-[var(--text-primary)]">—</p>
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
                    <ModelBreakdown models={analytics?.model_breakdown ?? []} deltas={modelDeltas} />
                  )}
                </div>
              </div>

              {/* Recent Conversations */}
              <div className="card overflow-hidden">
                <div className="px-5 py-4 border-b border-[var(--accent-border)] flex items-center justify-between bg-[var(--accent-muted)]">
                  <div className="flex items-center gap-2">
                    <MessageSquare size={16} className="text-[var(--accent)]" />
                    <h3 className="text-[15px] font-medium text-[var(--text-primary)]">Recent Conversations</h3>
                    {analytics && (
                      <span className="text-xs text-[var(--text-muted)] bg-[rgba(255,255,255,0.06)] border border-[rgba(255,255,255,0.10)] px-2 py-0.5 rounded-full">
                        {analytics.total_responses_analyzed.toLocaleString()} analyzed
                      </span>
                    )}
                  </div>
                  {/* Model filter tabs */}
                  {analytics && analytics.recent_conversations.length > 0 && (() => {
                    const models = Array.from(new Set(analytics.recent_conversations.map((c) => {
                      const key = c.model.toLowerCase().replace(/[-_\s]/g, '');
                      return Object.keys(MODEL_CONFIG).find((k) => key.includes(k)) ?? c.model;
                    })));
                    if (models.length < 2) return null;
                    return (
                      <div className="flex items-center gap-1 bg-[rgba(255,255,255,0.04)] border border-[var(--accent-border)] rounded-lg p-0.5">
                        <button
                          onClick={() => setConvModelFilter('all')}
                          className={`px-2.5 py-1 rounded-md text-xs font-medium transition-all ${convModelFilter === 'all' ? 'bg-[var(--accent-muted)] text-[var(--accent-light)]' : 'text-[var(--text-faint)] hover:text-[var(--text-secondary)]'}`}
                        >
                          All
                        </button>
                        {models.map((mk) => {
                          const cfg = MODEL_CONFIG[mk] ?? { label: mk, text: 'var(--text-secondary)' };
                          return (
                            <button
                              key={mk}
                              onClick={() => setConvModelFilter(convModelFilter === mk ? 'all' : mk)}
                              className={`px-2.5 py-1 rounded-md text-xs font-medium transition-all ${convModelFilter === mk ? 'bg-[var(--accent-muted)]' : 'text-[var(--text-faint)] hover:text-[var(--text-secondary)]'}`}
                              style={convModelFilter === mk ? { color: cfg.text } : {}}
                            >
                              {cfg.label}
                            </button>
                          );
                        })}
                      </div>
                    );
                  })()}
                </div>

                {loadingAnalytics || isRunning ? (
                  <div className="divide-y divide-[var(--accent-muted)]">
                    {[1,2,3,4].map(i => (
                      <div key={i} className="px-5 py-4 animate-pulse">
                        <div className="flex items-center justify-between mb-2">
                          <div className="h-3.5 bg-[rgba(255,255,255,0.06)] rounded w-2/5" />
                          <div className="flex gap-2">
                            <div className="w-16 h-5 bg-[rgba(255,255,255,0.06)] rounded" />
                            <div className="w-20 h-5 bg-[rgba(255,255,255,0.06)] rounded" />
                          </div>
                        </div>
                        <div className="h-3 bg-[rgba(255,255,255,0.06)] rounded w-4/5" />
                      </div>
                    ))}
                  </div>
                ) : analytics && analytics.recent_conversations.length > 0 ? (
                  <div className="divide-y divide-[var(--accent-muted)]">
                    {analytics.recent_conversations.filter((conv) => {
                      if (convModelFilter === 'all') return true;
                      const key = conv.model.toLowerCase().replace(/[-_\s]/g, '');
                      return key.includes(convModelFilter);
                    }).sort((a, b) => (b.mentioned ? 1 : 0) - (a.mentioned ? 1 : 0))
                    .map((conv) => {
                      const modelKey = conv.model.toLowerCase().replace(/[-_\s]/g, '');
                      const mc = Object.entries(MODEL_CONFIG).find(([k]) => modelKey.includes(k))?.[1]
                        ?? { bg: 'var(--bg-card)', text: 'var(--text-secondary)' };
                      const label = Object.entries(MODEL_CONFIG).find(([k]) => modelKey.includes(k))
                        ? MODEL_CONFIG[Object.keys(MODEL_CONFIG).find(k => modelKey.includes(k))!].label
                        : conv.model;

                      return (
                        <div key={conv.id}>
                          <button
                            className="w-full px-5 py-4 hover:bg-[var(--accent-muted)] transition-colors text-left"
                            onClick={() => setExpandedConvId(expandedConvId === conv.id ? null : conv.id)}
                          >
                            <div className="flex items-start justify-between gap-3 mb-1.5">
                              <span className="text-xs font-medium text-[var(--text-secondary)] leading-relaxed flex-1 min-w-0">
                                {conv.prompt_text.length > 80 ? conv.prompt_text.slice(0, 80) + '…' : conv.prompt_text}
                              </span>
                              <div className="flex items-center gap-1.5 flex-shrink-0">
                                <Badge style={{ backgroundColor: mc.bg, color: mc.text, borderColor: 'transparent' }}>
                                  {label}
                                </Badge>
                                <Badge variant={conv.mentioned ? "success" : "secondary"}>
                                  {conv.mentioned ? 'Mentioned' : 'Not mentioned'}
                                </Badge>
                                <ChevronDown
                                  size={12}
                                  className={`text-[var(--text-faint)] transition-transform ${expandedConvId === conv.id ? 'rotate-180' : ''}`}
                                />
                              </div>
                            </div>
                            {conv.response_preview && (
                              <p className="text-xs text-[var(--text-faint)] leading-relaxed line-clamp-2">
                                {(() => {
                                  const clean = stripMarkdown(conv.response_preview);
                                  return clean.length > 120 ? clean.slice(0, 120) + '…' : clean;
                                })()}
                              </p>
                            )}
                          </button>
                          {expandedConvId === conv.id && conv.response_text && (
                            <div className="px-5 pb-4 pt-3 border-t border-[var(--accent-border)] bg-[var(--accent-muted)]">
                              <p className="text-xs text-[var(--text-muted)] leading-relaxed whitespace-pre-wrap">
                                {conv.response_text}
                              </p>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="flex flex-col items-center justify-center py-16 text-center">
                    <div
                      className="w-14 h-14 rounded-2xl flex items-center justify-center mb-4"
                      style={{
                        background: 'linear-gradient(135deg, var(--accent-muted), var(--accent-muted))',
                        border: '1px solid var(--accent-border)',
                        boxShadow: '0 0 28px var(--accent-muted)',
                      }}
                    >
                      <MessageSquare size={24} className="text-[var(--accent-light)]" />
                    </div>
                    <p className="text-base font-semibold text-[var(--text-primary)] mb-1.5">No conversations yet</p>
                    <p className="text-[13px] text-[var(--text-muted)] max-w-xs leading-relaxed">Run a report to start tracking how AI models respond to your prompts.</p>
                  </div>
                )}
              </div>
            </>
          )}
        </>
      )}

      {/* Modals */}
      {promptModalOpen && selectedBrandId && brandDetail && (
        <ManagePromptsModal
          brandId={selectedBrandId}
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
    </div>
  );
}
