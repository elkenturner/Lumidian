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
  ModelScore,
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
import { format, parseISO } from 'date-fns';

const parseUTCISO = (s: string) => parseISO(s.endsWith('Z') ? s : s + 'Z');

// ── Usage bar sub-component ────────────────────────────────────────────────────
function UsageBar({ label, used, limit }: { label: string; used: number; limit: number | null }) {
  if (limit === null) return null; // unlimited (Pro / admin) — don't render
  const pct = limit > 0 ? Math.min(100, Math.round((used / limit) * 100)) : 0;
  const color = pct >= 90 ? '#ef4444' : pct >= 70 ? '#f59e0b' : '#6366f1';
  return (
    <div className="flex-1 min-w-0">
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs text-[#64748b]">{label}</span>
        <span className="text-xs font-semibold tabular-nums" style={{ color }}>
          {used}/{limit}
        </span>
      </div>
      <div className="h-1.5 w-full bg-[rgba(255,255,255,0.06)] rounded-full overflow-hidden">
        <div
          className="h-full rounded-full transition-all duration-500"
          style={{ width: `${pct}%`, background: color }}
        />
      </div>
    </div>
  );
}

const MODEL_ORDER = ['chatgpt', 'claude', 'perplexity', 'gemini'];
const MODEL_CONFIG: Record<string, { label: string; bg: string; text: string }> = {
  chatgpt:    { label: 'ChatGPT',    bg: 'rgba(34,197,94,0.12)',   text: '#22c55e' },
  claude:     { label: 'Claude',     bg: 'rgba(249,115,22,0.12)',  text: '#f97316' },
  perplexity: { label: 'Perplexity', bg: 'rgba(139,92,246,0.12)',  text: '#8b5cf6' },
  gemini:     { label: 'Gemini',     bg: 'rgba(59,130,246,0.12)',  text: '#3b82f6' },
};

function getModelCfg(model: string) {
  const key = model.toLowerCase().replace(/[-_\s]/g, '');
  for (const [k, v] of Object.entries(MODEL_CONFIG)) {
    if (key.includes(k)) return { ...v, key: k };
  }
  return { label: model, bg: '#1e293b', text: '#94a3b8', key: model };
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
      <span className="w-4 h-4 rounded-full bg-[rgba(255,255,255,0.06)] border border-[rgba(255,255,255,0.10)] text-[#475569] text-[10px] font-bold flex items-center justify-center cursor-help select-none">
        ?
      </span>
      {open && (
        <span className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-60 bg-[rgba(15,20,40,0.95)] border border-[rgba(99,102,241,0.22)] rounded-lg p-3 text-xs text-[#94A3B8] leading-relaxed shadow-lg z-50 pointer-events-none whitespace-normal">
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
    <div className="bg-[rgba(15,20,40,0.95)] border border-[rgba(99,102,241,0.22)] rounded-lg p-2 shadow-lg text-xs">
      <p className="text-[#64748B]">{d.formattedDate}</p>
      <p className="text-[#6366f1] font-bold">{Math.round(d.score)}%</p>
    </div>
  );
}

// ── Top domains donut chart ─────────────────────────────────────────────────────

const DOMAIN_COLORS = ['#6366f1', '#10b981', '#f59e0b', '#8b5cf6', '#f43f5e', '#06b6d4'];

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
              <span className="text-base font-bold text-[#F0F4F8] leading-none">{activePct}%</span>
              <span className="text-[10px] text-[#64748B] mt-0.5 max-w-[60px] text-center leading-tight truncate">{active.domain.replace(/^www\./, '')}</span>
            </>
          ) : (
            <>
              <span className="text-base font-bold text-[#F0F4F8] leading-none">{data.length}</span>
              <span className="text-[10px] text-[#64748B] mt-0.5">sources</span>
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
              <span className="text-xs truncate flex-1 min-w-0" style={{ color: isActive ? '#F0F4F8' : '#94A3B8' }}>{d.domain}</span>
              <span className="text-xs tabular-nums font-semibold flex-shrink-0" style={{ color: isActive ? color : '#64748B' }}>{pct.toFixed(1)}%</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Model breakdown bars ───────────────────────────────────────────────────────

const MODEL_BAR_COLORS: Record<string, string> = {
  chatgpt: '#10b981',
  claude: '#f59e0b',
  perplexity: '#a78bfa',
  gemini: '#60a5fa',
};

function ModelBreakdown({ models, deltas }: { models: ModelStat[]; deltas?: Record<string, number> }) {
  if (!models.length) return <p className="text-xs text-[#475569]">No model data yet</p>;
  return (
    <div className="space-y-3 w-full">
      {models.map((m) => {
        const pct = Math.round(m.mention_rate * 100);
        const barColor = MODEL_BAR_COLORS[m.model] ?? '#6366f1';
        const barWidth = `${pct}%`;
        const delta = deltas?.[m.model];
        return (
          <div key={m.model}>
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs font-medium text-[#CBD5E1]">{m.label}</span>
              <span className="text-xs tabular-nums text-[#94A3B8] flex items-center gap-1">
                {delta !== undefined && delta !== 0 && (
                  <span style={{ color: delta > 0 ? '#10b981' : '#f87171', fontWeight: 600 }}>
                    {delta > 0 ? `↑${delta}%` : `↓${Math.abs(delta)}%`}
                  </span>
                )}
                {pct}% <span className="text-[#475569]">({m.mention_count}/{m.total})</span>
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
    <div className="self-start bg-[rgba(99,102,241,0.06)] backdrop-blur-md border border-[rgba(99,102,241,0.22)] rounded-xl p-5 shadow-[0_4px_24px_rgba(0,0,0,0.20)]" style={{ borderLeft: '2px solid rgba(99,102,241,0.5)' }}>
      <p className="text-sm font-medium text-[#94A3B8] flex items-center mb-3">
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
          <p className="text-sm text-[#F0F4F8] leading-relaxed line-clamp-2 flex-1">
            &ldquo;{best.text}&rdquo;
          </p>
          <div className="flex items-end justify-between mt-3">
            <p className="text-2xl font-bold text-[#10b981] leading-none">
              {Math.round((best.mentioned / best.total) * 100)}%
              <span className="text-xs font-normal text-[#475569] ml-1">visibility</span>
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
          <p className="text-3xl font-bold text-[#F0F4F8] mt-1">—</p>
          <p className="text-xs text-[#475569] mt-1">No data yet</p>
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
  const [runModelScores, setRunModelScores] = useState<ModelScore[]>([]);
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
    getBillingStatus().then(setBillingStatus).catch(() => {});
    getBillingUsage().then(setUsage).catch(() => {});
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
        getBrand(brandId).catch(() => null),
        getBrandProfile(brandId).catch(() => null),
        getCompetitors(brandId).catch(() => []),
        responsesPromise.catch(() => []),
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
      getDrafts(brandId, undefined, 'posted').then((d) => setPublishedCount(d.length)).catch(() => {});
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
        if (run.model_scores?.length) setRunModelScores(run.model_scores);
        if (run.status === 'completed' || run.status === 'failed') {
          setActiveRunId(null);
          setRunModelScores([]);
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
              triggerScan(selectedBrandId).catch(() => {});
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
      getBillingUsage().then(setUsage).catch(() => {});
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
    ? sentData.positive_pct > 0 ? '#10b981'
    : sentData.negative_pct > 0 ? '#ef4444'
    : '#f59e0b'
    : '#475569';

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

      {/* Usage indicator (non-admin, Starter plan) */}
      {usage && !user?.is_admin && (usage.manual_run_limit !== null || usage.prompt_limit < 999999) && (
        <div className="flex items-center gap-4 bg-[rgba(255,255,255,0.03)] border border-[rgba(255,255,255,0.07)] rounded-xl px-4 py-3 mb-6">
          <UsageBar label="Prompts" used={usage.prompt_count} limit={usage.prompt_limit < 999999 ? usage.prompt_limit : null} />
          {usage.manual_run_limit !== null && (
            <>
              <div className="w-px h-8 bg-[rgba(255,255,255,0.08)] flex-shrink-0" />
              <UsageBar label="Manual runs today" used={usage.manual_runs_today} limit={usage.manual_run_limit} />
            </>
          )}
          {usage.standard_brand_limit > 0 && usage.standard_brand_limit < 999 && (
            <>
              <div className="w-px h-8 bg-[rgba(255,255,255,0.08)] flex-shrink-0" />
              <UsageBar label="Brands" used={usage.standard_brand_count} limit={usage.standard_brand_limit} />
            </>
          )}
        </div>
      )}

      {/* Upgrade modal — shown when a plan limit is hit */}
      <Dialog open={upgradeModalOpen} onOpenChange={(o) => !o && setUpgradeModalOpen(false)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <Zap size={20} className="text-[#6366f1] mb-1" />
            <DialogTitle>Upgrade your plan</DialogTitle>
          </DialogHeader>
          <p className="text-xs text-[#64748b]">{upgradeModalReason}</p>
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
        <div className="mb-6 bg-[rgba(99,102,241,0.10)] border border-[rgba(99,102,241,0.25)] rounded-xl px-5 py-4 flex items-center gap-4">
          {newBrandStep !== 'done' ? (
            <Loader2 size={18} className="animate-spin text-[#6366f1] shrink-0" />
          ) : (
            <div className="w-4.5 h-4.5 rounded-full bg-[#10b981] flex items-center justify-center shrink-0">
              <span className="text-white text-xs font-bold" aria-hidden="true">✓</span>
            </div>
          )}
          <div>
            {newBrandStep === 'running' && (
              <>
                <p className="text-sm font-medium text-[#F0F4F8]">Running your first AI visibility report…</p>
                <p className="text-xs text-[#64748B] mt-0.5">This takes 1–2 minutes. We&apos;ll auto-generate content drafts when it&apos;s done.</p>
              </>
            )}
            {newBrandStep === 'drafting' && (
              <>
                <p className="text-sm font-medium text-[#F0F4F8]">Report complete! Generating content drafts…</p>
                <p className="text-xs text-[#64748B] mt-0.5">Creating drafts for your top visibility gaps.</p>
              </>
            )}
            {newBrandStep === 'done' && (
              <>
                <p className="text-sm font-medium text-[#10b981]">All set! Your report and drafts are ready.</p>
                <p className="text-xs text-[#64748B] mt-0.5">
                  Your first content drafts are waiting —{' '}
                  <Link href="/content" className="text-[#6366f1] hover:text-[#6366f1] underline">
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
              className="rounded-xl bg-[rgba(99,102,241,0.06)] border border-[rgba(99,102,241,0.18)]"
              style={{ padding: 5 }}
              textClassName="text-sm font-bold text-[#6366f1]"
            />
          )}
          <div>
            <h1 className="text-xl sm:text-2xl font-bold text-[#F0F4F8]" style={{ fontFamily: 'var(--font-syne)', fontWeight: 800, letterSpacing: '-0.3px' }}>
              {selectedBrand ? selectedBrand.name : 'Dashboard'}
            </h1>
            <p className="text-[13px] text-[#64748B] mt-1.5">AI visibility analytics</p>
          </div>
        </div>
        <div className="flex items-center gap-2 sm:gap-3">
          <button
            onClick={() => setPromptModalOpen(true)}
            disabled={!selectedBrandId}
            className="flex items-center gap-2 bg-[rgba(99,102,241,0.06)] hover:bg-[rgba(99,102,241,0.09)] border border-[rgba(99,102,241,0.22)] hover:border-[rgba(255,255,255,0.14)] text-[#64748B] hover:text-[#94A3B8] rounded-lg px-3 py-2 text-xs transition-all duration-150"
          >
            <MessageSquare size={14} />
            Prompts
          </button>
          <button
            onClick={() => selectedBrandId && loadData(selectedBrandId)}
            aria-label="Refresh dashboard"
            className="flex items-center gap-2 bg-[rgba(99,102,241,0.06)] hover:bg-[rgba(99,102,241,0.10)] border border-[rgba(99,102,241,0.22)] hover:border-[rgba(255,255,255,0.14)] text-[#64748B] hover:text-[#94A3B8] rounded-lg px-3 py-2 transition-all duration-150"
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
                  ? 'bg-[rgba(99,102,241,0.10)] border border-[rgba(99,102,241,0.25)] text-[#475569] cursor-default'
                  : 'bg-[#5b5ef4] hover:bg-[#4f46e5] disabled:opacity-50 text-white shadow-lg shadow-[#6366f1]/25 hover:shadow-[#6366f1]/40 hover:shadow-xl'
              }`}
            >
              {triggering || isRunning ? (
                <>
                  <Loader2 size={14} className="animate-spin" />
                  {isRunning ? 'Running...' : 'Starting...'}
                </>
              ) : isAtRunLimit ? (
                <>
                  <Zap size={14} className="text-[#6366f1]/60" />
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
              <p className="text-[11px] text-[#475569]">
                Resets midnight UTC ·{' '}
                <button
                  onClick={() => { setUpgradeModalReason("You've used your 1 daily report run. Upgrade to run reports any time."); setUpgradeModalOpen(true); }}
                  className="text-[#6366f1] hover:text-[#818cf8] transition-colors"
                >
                  Upgrade
                </button>
              </p>
            )}
          </div>
        </div>
      </div>

      {/* Recent runs strip */}
      {trends && trends.length > 0 && (
        <div className="flex items-center gap-2 mb-5 flex-wrap">
          <span className="text-[10px] font-semibold text-[#2d3a55] uppercase tracking-[0.08em] mr-1">
            Recent Runs
          </span>
          {[...trends].reverse().slice(0, 4).map((t, i) => (
            <div
              key={t.run_id ?? i}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[10px] font-semibold"
              style={i === 0
                ? { background: 'rgba(16,185,129,0.07)', border: '1px solid rgba(16,185,129,0.18)', color: '#34d399' }
                : { background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)', color: '#475569' }
              }
            >
              <span
                className="w-1.5 h-1.5 rounded-full flex-shrink-0"
                style={{ background: i === 0 ? '#34d399' : 'rgba(255,255,255,0.2)' }}
              />
              {t.completed_at
                ? format(parseUTCISO(t.completed_at), 'MMM d')
                : 'Running'
              } · {Math.round(t.score)}
            </div>
          ))}
        </div>
      )}

      {/* Running banner */}
      {isRunning && (
        <div className="bg-[rgba(99,102,241,0.10)] border border-[rgba(99,102,241,0.25)] rounded-xl p-4 mb-6">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-[#6366f1]/10 flex items-center justify-center flex-shrink-0">
              <Loader2 size={16} className="text-[#6366f1] animate-spin" />
            </div>
            <div className="flex-1">
              <p className="text-sm font-semibold text-[#F0F4F8]">Report in progress</p>
              <p className="text-xs text-[#6366f1] mt-0.5">Querying AI models with your prompts. This may take a minute...</p>
              {runModelScores.length > 0 && (
                <div className="flex items-center gap-3 mt-2 flex-wrap">
                  {runModelScores.map((ms) => {
                    const cfg = getModelCfg(ms.model);
                    const pct = ms.total_queries > 0 ? Math.round((ms.total_mentions / ms.total_queries) * 100) : 0;
                    return (
                      <span key={ms.model} className="flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded-full" style={{ background: cfg.bg, color: cfg.text }}>
                        <CheckCircle2 size={9} />
                        {cfg.label}: {pct}%
                      </span>
                    );
                  })}
                </div>
              )}
            </div>
            <span className="flex items-center gap-2 text-xs text-[#6366f1] font-medium">
              <span className="w-2 h-2 rounded-full bg-[#6366f1] animate-pulse" />
              Auto-updating every 3s
            </span>
          </div>
        </div>
      )}

      {loadingBrands ? (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[1,2,3,4].map(i => (
            <div key={i} className="h-28 bg-[rgba(99,102,241,0.06)] border border-[rgba(99,102,241,0.22)] rounded-xl animate-pulse" />
          ))}
        </div>
      ) : brands.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center max-w-xl mx-auto">
          <div className="w-16 h-16 bg-[rgba(99,102,241,0.10)] border border-[rgba(99,102,241,0.25)] rounded-2xl flex items-center justify-center mb-5">
            <Zap size={28} className="text-[#6366f1]" />
          </div>
          <h3 className="text-xl font-bold text-[#F0F4F8] mb-2">Track your first brand</h3>
          <p className="text-sm text-[#64748B] mb-8 max-w-sm leading-relaxed">
            Add your brand, define the prompts you want AI models to mention you for, and we&apos;ll run an instant visibility report and generate content drafts automatically.
          </p>
          {/* Step cards */}
          <div className="flex flex-col sm:flex-row items-start gap-3 mb-8 text-left w-full">
            {[
              { n: '1', title: 'Add your brand', body: 'Name, website, and the prompts you want to rank for.' },
              { n: '2', title: 'Auto-run report', body: 'We instantly query ChatGPT, Claude, Perplexity, and Gemini.' },
              { n: '3', title: 'Get content drafts', body: 'AI-generated posts targeting your top visibility gaps.' },
            ].map(({ n, title, body }) => (
              <div key={n} className="flex-1 bg-[rgba(99,102,241,0.06)] border border-[rgba(99,102,241,0.22)] rounded-xl p-4">
                <div className="w-6 h-6 rounded-full bg-[rgba(99,102,241,0.20)] text-[#818cf8] text-xs font-bold flex items-center justify-center mb-2">{n}</div>
                <p className="text-sm font-semibold text-[#F0F4F8] mb-1">{title}</p>
                <p className="text-xs text-[#64748B] leading-relaxed">{body}</p>
              </div>
            ))}
          </div>
          <Link
            href="/onboarding"
            className="flex items-center gap-2 bg-[rgba(99,102,241,0.15)] hover:bg-[rgba(99,102,241,0.22)] border border-[rgba(99,102,241,0.30)] hover:border-[rgba(99,102,241,0.45)] text-[#a5b4fc] hover:text-[#c7d2fe] hover:shadow-[0_0_24px_rgba(99,102,241,0.18)] rounded-lg px-6 py-3 text-sm font-semibold transition-colors"
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
              <div className="w-14 h-14 bg-[rgba(99,102,241,0.10)] border border-[rgba(99,102,241,0.25)] rounded-2xl flex items-center justify-center mb-4">
                <BarChart2 size={24} className="text-[#6366f1]" />
              </div>
              <h3 className="text-lg font-bold text-[#F0F4F8] mb-2">No data yet</h3>
              <p className="text-sm text-[#64748B] mb-6 leading-relaxed">
                Run your first AI visibility report to see how often your brand appears across ChatGPT, Claude, Perplexity, and Gemini.
              </p>
              <button
                onClick={handleRunReport}
                disabled={triggering}
                className="flex items-center gap-2 bg-[#5b5ef4] hover:bg-[#4f46e5] disabled:opacity-50 text-white rounded-lg px-6 py-3 text-sm font-semibold transition-colors shadow-lg shadow-[#6366f1]/25"
              >
                {triggering ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />}
                Run First Report
              </button>
            </div>
          )}

          {/* ── OVERVIEW ─────────────────────────────────────────────────── */}
          <>
              {/* Brand profile completeness nudge */}
              {brandProfile && brandProfile.completion_pct < 100 && (
                <div className="mb-4 flex items-center gap-4 bg-[rgba(99,102,241,0.06)] border border-[rgba(99,102,241,0.22)] rounded-xl px-5 py-3">
                  <div className="flex-1">
                    <div className="flex items-center justify-between mb-1.5">
                      <p className="text-xs font-medium text-[#94A3B8]">Brand Profile — {brandProfile.completion_pct}% complete</p>
                      <Link href="/settings?tab=profile" className="text-xs text-[#6366f1] hover:text-[#818cf8] transition-colors font-medium">Complete profile →</Link>
                    </div>
                    <div className="h-1.5 bg-[rgba(255,255,255,0.06)] rounded-full overflow-hidden">
                      <div className="h-full bg-[#6366f1] rounded-full transition-all" style={{ width: `${brandProfile.completion_pct}%` }} />
                    </div>
                    <p className="text-[11px] text-[#475569] mt-1">A complete brand profile improves draft quality and visibility tracking accuracy.</p>
                  </div>
                </div>
              )}

              {/* Quick stats row */}
              {!loadingAnalytics && totalRuns > 0 && (
                <div className="grid grid-cols-3 gap-3 mb-4">
                  {([
                    { label: 'Prompts Tracked',   value: totalPrompts || '—',   icon: MessageSquare, accent: '#60a5fa', iconBg: 'rgba(96,165,250,0.12)',  borderTop: '#3b82f6', sub: null, subColor: '' },
                    { label: 'Days Tracking',     value: daysSinceFirst != null ? daysSinceFirst : '—', icon: TrendingUp, accent: '#fbbf24', iconBg: 'rgba(251,191,36,0.12)', borderTop: '#f59e0b', sub: null, subColor: '' },
                    { label: 'Content Published', value: publishedCount || '—', icon: CheckCircle2, accent: '#34d399', iconBg: 'rgba(52,211,153,0.12)', borderTop: '#10b981', sub: null, subColor: '' },
                  ] as Array<{ label: string; value: string | number; icon: React.ElementType; accent: string; iconBg: string; borderTop: string; sub: string | null; subColor: string }>).map(({ label, value, icon: Icon, accent, iconBg, borderTop, sub, subColor }) => (
                    <div
                      key={label}
                      className="bg-[rgba(99,102,241,0.06)] border border-[rgba(99,102,241,0.18)] rounded-xl px-4 py-4 flex items-center gap-3"
                      style={{ borderTopColor: borderTop, borderTopWidth: 2 }}
                    >
                      <div
                        className="w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0"
                        style={{ background: iconBg, border: `1px solid ${accent}33` }}
                      >
                        <Icon size={15} style={{ color: accent }} />
                      </div>
                      <div className="min-w-0">
                        <p className="text-xl font-bold text-[#F0F4F8] leading-tight tabular-nums">{value}</p>
                        {sub && (
                          <p className="text-[10px] font-medium leading-tight mt-0.5" style={{ color: subColor }}>{sub}</p>
                        )}
                        <p className="text-[11px] text-[#64748b] mt-0.5 truncate">{label}</p>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* Row 1: visibility (left) + prompt/sentiment/sov (right) */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                {/* Visibility score + sparkline */}
                <div className="bg-[rgba(99,102,241,0.08)] backdrop-blur-md border border-[rgba(99,102,241,0.28)] border-t-2 border-t-[#6366f1] rounded-xl p-6 shadow-[0_8px_32px_rgba(0,0,0,0.25),0_0_40px_rgba(99,102,241,0.10),inset_0_1px_0_rgba(255,255,255,0.07)]">
                  <div className="flex items-start justify-between mb-3">
                    <div>
                      <p className="text-[13px] font-medium text-[#94A3B8] flex items-center">
                        Visibility Score
                        <HelpTooltip text="Percentage of AI responses that mention your brand when answering your tracked prompts. A higher score means AI models are more aware of your brand." />
                      </p>
                      {loadingAnalytics ? (
                        <div className="h-14 w-28 bg-[rgba(255,255,255,0.06)] rounded animate-pulse mt-2" />
                      ) : (
                        <>
                          <p className="text-6xl font-bold text-[#F0F4F8] mt-1 leading-none">
                            {score != null ? `${Math.round(score)}%` : 'N/A'}
                          </p>
                          {scoreDelta !== null && (
                            <p className={`text-xs font-medium mt-2 ${scoreDelta > 0 ? 'text-[#10b981]' : scoreDelta < 0 ? 'text-[#f87171]' : 'text-[#64748B]'}`}>
                              {scoreDelta > 0 ? `+${scoreDelta}%` : scoreDelta < 0 ? `${scoreDelta}%` : '—'} since {sinceLastRun ?? 'last run'}
                            </p>
                          )}
                        </>
                      )}
                    </div>
                    <div className="w-10 h-10 rounded-xl bg-[rgba(255,255,255,0.06)] flex items-center justify-center text-[#6366f1]">
                      <BarChart2 size={18} />
                    </div>
                  </div>
                  {sparkData.length > 1 ? (
                    <ResponsiveContainer width="100%" height={44}>
                      <AreaChart data={sparkData} margin={{ top: 0, right: 0, left: 0, bottom: 0 }}>
                        <defs>
                          <linearGradient id="sparkGrad" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="#6366f1" stopOpacity={0.3} />
                            <stop offset="95%" stopColor="#6366f1" stopOpacity={0} />
                          </linearGradient>
                        </defs>
                        <Tooltip content={<SparklineTooltip />} />
                        <Area type="monotone" dataKey="score" stroke="#6366f1" strokeWidth={2.5} fill="url(#sparkGrad)" dot={false} />
                      </AreaChart>
                    </ResponsiveContainer>
                  ) : (
                    <p className="text-xs text-[#475569] mt-2">
                      {sparkData.length === 1 ? '1 run recorded' : 'No trend data yet'}
                    </p>
                  )}
                  {nextReportHours !== null && (
                    <p className="text-[11px] text-[#475569] mt-2">
                      Next report in {nextReportHours}h
                    </p>
                  )}

                  {/* Live / Index sub-score breakdown */}
                  {!loadingAnalytics && score !== null && (liveScore !== null || indexScore !== null) && (
                    <div className="mt-3 space-y-2 border-t border-[rgba(255,255,255,0.06)] pt-3">
                      {([
                        { label: 'Live Search', s: liveScore,  models: 'Perplexity · Gemini',  color: '#10b981' },
                        { label: 'AI Index',    s: indexScore, models: 'GPT-4o-mini · Claude', color: '#818cf8' },
                      ] as Array<{ label: string; s: number | null; models: string; color: string }>).map(({ label, s, models, color }) => (
                        <div key={label}>
                          <div className="flex items-center gap-3 mb-0.5">
                            <div className="flex items-center gap-1.5 w-24 flex-shrink-0">
                              <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: color }} />
                              <span className="text-[11px] font-medium text-[#64748B] truncate">{label}</span>
                            </div>
                            <div className="flex-1 h-1.5 bg-[rgba(255,255,255,0.08)] rounded-full overflow-hidden">
                              <div className="h-full rounded-full transition-all duration-500" style={{ width: `${s ?? 0}%`, background: color }} />
                            </div>
                            <span className="text-xs font-bold tabular-nums w-9 text-right flex-shrink-0" style={{ color }}>
                              {s !== null ? `${s}%` : '—'}
                            </span>
                          </div>
                          <p className="text-[9px] text-[#475569] pl-[108px] truncate">{models}</p>
                        </div>
                      ))}
                      {liveScore !== null && indexScore !== null && (
                        <p className="text-[10px] text-[#64748B] italic pt-0.5">
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
                    <div className="bg-[rgba(99,102,241,0.06)] backdrop-blur-md border border-[rgba(99,102,241,0.22)] rounded-xl p-5 shadow-[0_4px_24px_rgba(0,0,0,0.20)]">
                      <div className="flex items-start justify-between mb-2">
                        <p className="text-sm font-medium text-[#94A3B8] flex items-center">
                          Sentiment
                          <HelpTooltip text="How positively AI models describe your brand when they mention it." />
                        </p>
                        <div className="w-8 h-8 rounded-lg bg-[rgba(255,255,255,0.06)] flex items-center justify-center text-[#6366f1] flex-shrink-0">
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
                            <div style={{ width: `${sentData.positive_pct}%`, background: '#10b981' }} />
                            <div style={{ width: `${sentData.neutral_pct}%`, background: '#f59e0b' }} />
                            <div style={{ width: `${sentData.negative_pct}%`, background: '#ef4444' }} />
                          </div>
                          <p className="text-xs text-[#475569] mt-1.5">
                            {Math.round(sentData.neutral_pct)}% neutral · {Math.round(sentData.negative_pct)}% negative
                          </p>
                        </>
                      ) : (
                        <>
                          <p className="text-3xl font-bold text-[#F0F4F8] mt-1">—</p>
                          <p className="text-xs text-[#475569] mt-1">No mentions to analyze</p>
                        </>
                      )}
                    </div>
                  </div>

                  {/* SOV — fills remaining height */}
                  <div className="flex-1 bg-[rgba(99,102,241,0.06)] backdrop-blur-md border border-[rgba(99,102,241,0.22)] rounded-xl p-5 shadow-[0_4px_24px_rgba(0,0,0,0.20)]">
                    <div className="flex items-center justify-between mb-3">
                      <p className="text-sm font-medium text-[#94A3B8] flex items-center">
                        Share of Voice
                        <HelpTooltip text="Percentage of total AI brand mentions in your category per entity." />
                      </p>
                      <button
                        onClick={() => setCompetitorModalOpen(true)}
                        aria-label="Manage competitors"
                        className="flex items-center gap-1.5 text-xs text-[#64748B] hover:text-[#94A3B8] bg-[rgba(255,255,255,0.06)] hover:bg-[rgba(99,102,241,0.12)] border border-[rgba(255,255,255,0.08)] rounded-lg px-2.5 py-1.5 transition-colors"
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
                      <p className="text-xs text-[#475569]">
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
                            const barColor = s.is_primary ? (isLeading ? '#10b981' : '#6366f1') : (isLeading ? '#ef4444' : '#475569');
                            const textColor = s.is_primary ? (isLeading ? '#10b981' : '#818cf8') : (isLeading ? '#f87171' : '#64748B');
                            return (
                              <div key={s.name} className="flex flex-col gap-1.5">
                                <div className="flex items-center justify-between">
                                  <span className={`text-xs font-medium truncate ${s.is_primary ? 'text-[#F0F4F8]' : 'text-[#94A3B8]'}`}>{s.name}</span>
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
                <div className="bg-[rgba(99,102,241,0.06)] backdrop-blur-md border border-[rgba(99,102,241,0.22)] rounded-xl p-5 shadow-[0_4px_24px_rgba(0,0,0,0.20)]">
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-sm font-medium text-[#94A3B8] flex items-center">
                      Avg Position
                      <HelpTooltip text="Position indicates where in the AI response your brand typically appears. Earlier is better." />
                    </p>
                    <div className="w-8 h-8 rounded-lg bg-[rgba(255,255,255,0.06)] flex items-center justify-center text-[#6366f1]">
                      <Building2 size={15} />
                    </div>
                  </div>
                  {loadingAnalytics ? (
                    <div className="h-8 w-16 bg-[rgba(255,255,255,0.06)] rounded animate-pulse" />
                  ) : analytics?.position.score != null ? (
                    <>
                      <p className="text-3xl font-bold text-[#F0F4F8]">
                        {analytics.position.score.toFixed(1)}
                        <span className="text-base font-normal text-[#475569]">/10</span>
                      </p>
                      <p className="text-xs text-[#475569] mt-1">
                        {analytics.position.score <= 4
                          ? 'Mentioned early in responses'
                          : analytics.position.score <= 7
                          ? 'Mentioned mid-way in responses'
                          : 'Mentioned late in responses'} · {analytics.position.sample_count} samples
                      </p>
                    </>
                  ) : (
                    <>
                      <p className="text-3xl font-bold text-[#F0F4F8]">—</p>
                      <p className="text-xs text-[#475569] mt-1">No mentions recorded</p>
                    </>
                  )}
                </div>

                {/* Top Domains */}
                <div className="lg:col-span-2 bg-[rgba(99,102,241,0.06)] backdrop-blur-md border border-[rgba(99,102,241,0.22)] rounded-xl p-5 shadow-[0_4px_24px_rgba(0,0,0,0.20)] flex flex-col">
                  <div className="flex items-center justify-between mb-3">
                    <p className="text-sm font-medium text-[#94A3B8] flex items-center">
                      Top Cited Domains (across all tracked prompts)
                      <HelpTooltip text="Websites that AI models cite most often across all tracked prompts — regardless of whether your brand was mentioned." />
                    </p>
                    <Globe size={14} className="text-[#475569]" />
                  </div>
                  {loadingAnalytics ? (
                    <div className="flex items-center justify-center flex-1 py-4">
                      <div className="w-24 h-24 rounded-full bg-[rgba(255,255,255,0.06)] animate-pulse" />
                    </div>
                  ) : analytics && analytics.top_domains.length > 0 ? (
                    <DonutDomains domains={analytics.top_domains.slice(0, 6)} />
                  ) : (
                    <div className="flex items-center justify-center flex-1 py-4">
                      <p className="text-xs text-[#475569]">No domain data yet</p>
                    </div>
                  )}
                </div>
              </div>

              {/* Row 3: Model breakdown */}
              <div className="mb-4">
                <div className="bg-[rgba(99,102,241,0.06)] backdrop-blur-md border border-[rgba(99,102,241,0.22)] rounded-xl p-5 shadow-[0_4px_24px_rgba(0,0,0,0.20)]">
                  <div className="flex items-center gap-2 mb-4">
                    <BarChart2 size={15} className="text-[#6366f1]" />
                    <h3 className="text-[15px] font-medium text-[#F0F4F8]">Performance by Model</h3>
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
              <div className="bg-[rgba(99,102,241,0.06)] backdrop-blur-md border border-[rgba(99,102,241,0.22)] rounded-xl overflow-hidden shadow-[0_4px_24px_rgba(0,0,0,0.20)]">
                <div className="px-5 py-4 border-b border-[rgba(99,102,241,0.22)] flex items-center justify-between bg-[rgba(99,102,241,0.06)]">
                  <div className="flex items-center gap-2">
                    <MessageSquare size={16} className="text-[#6366f1]" />
                    <h3 className="text-[15px] font-medium text-[#F0F4F8]">Recent Conversations</h3>
                    {analytics && (
                      <span className="text-xs text-[#64748B] bg-[rgba(255,255,255,0.06)] border border-[rgba(255,255,255,0.10)] px-2 py-0.5 rounded-full">
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
                      <div className="flex items-center gap-1 bg-[rgba(255,255,255,0.04)] border border-[rgba(99,102,241,0.12)] rounded-lg p-0.5">
                        <button
                          onClick={() => setConvModelFilter('all')}
                          className={`px-2.5 py-1 rounded-md text-xs font-medium transition-all ${convModelFilter === 'all' ? 'bg-[rgba(99,102,241,0.25)] text-[#818cf8]' : 'text-[#475569] hover:text-[#94A3B8]'}`}
                        >
                          All
                        </button>
                        {models.map((mk) => {
                          const cfg = MODEL_CONFIG[mk] ?? { label: mk, text: '#94a3b8' };
                          return (
                            <button
                              key={mk}
                              onClick={() => setConvModelFilter(convModelFilter === mk ? 'all' : mk)}
                              className={`px-2.5 py-1 rounded-md text-xs font-medium transition-all ${convModelFilter === mk ? 'bg-[rgba(99,102,241,0.25)]' : 'text-[#475569] hover:text-[#94A3B8]'}`}
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
                  <div className="divide-y divide-[rgba(99,102,241,0.10)]">
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
                  <div className="divide-y divide-[rgba(99,102,241,0.10)]">
                    {analytics.recent_conversations.filter((conv) => {
                      if (convModelFilter === 'all') return true;
                      const key = conv.model.toLowerCase().replace(/[-_\s]/g, '');
                      return key.includes(convModelFilter);
                    }).sort((a, b) => (b.mentioned ? 1 : 0) - (a.mentioned ? 1 : 0))
                    .map((conv) => {
                      const modelKey = conv.model.toLowerCase().replace(/[-_\s]/g, '');
                      const mc = Object.entries(MODEL_CONFIG).find(([k]) => modelKey.includes(k))?.[1]
                        ?? { bg: '#1e293b', text: '#94a3b8' };
                      const label = Object.entries(MODEL_CONFIG).find(([k]) => modelKey.includes(k))
                        ? MODEL_CONFIG[Object.keys(MODEL_CONFIG).find(k => modelKey.includes(k))!].label
                        : conv.model;

                      return (
                        <div key={conv.id}>
                          <button
                            className="w-full px-5 py-4 hover:bg-[rgba(99,102,241,0.05)] transition-colors text-left"
                            onClick={() => setExpandedConvId(expandedConvId === conv.id ? null : conv.id)}
                          >
                            <div className="flex items-start justify-between gap-3 mb-1.5">
                              <span className="text-xs font-medium text-[#94A3B8] leading-relaxed flex-1 min-w-0">
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
                                  className={`text-[#475569] transition-transform ${expandedConvId === conv.id ? 'rotate-180' : ''}`}
                                />
                              </div>
                            </div>
                            {conv.response_preview && (
                              <p className="text-xs text-[#475569] leading-relaxed line-clamp-2">
                                {(() => {
                                  const clean = stripMarkdown(conv.response_preview);
                                  return clean.length > 120 ? clean.slice(0, 120) + '…' : clean;
                                })()}
                              </p>
                            )}
                          </button>
                          {expandedConvId === conv.id && conv.response_text && (
                            <div className="px-5 pb-4 pt-3 border-t border-[rgba(99,102,241,0.22)] bg-[rgba(99,102,241,0.06)]">
                              <p className="text-xs text-[#64748B] leading-relaxed whitespace-pre-wrap">
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
                        background: 'linear-gradient(135deg, rgba(99,102,241,0.14), rgba(124,58,237,0.09))',
                        border: '1px solid rgba(99,102,241,0.26)',
                        boxShadow: '0 0 28px rgba(99,102,241,0.10)',
                      }}
                    >
                      <MessageSquare size={24} className="text-[#818cf8]" />
                    </div>
                    <p className="text-base font-semibold text-[#F0F4F8] mb-1.5">No conversations yet</p>
                    <p className="text-[13px] text-[#64748B] max-w-xs leading-relaxed">Run a report to start tracking how AI models respond to your prompts.</p>
                  </div>
                )}
              </div>
            </>
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
