'use client';

import { useEffect, useState, useRef, useCallback } from 'react';
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
} from 'lucide-react';
import {
  getBrands,
  getOverview,
  getTrends,
  getDashboardAnalytics,
  getResponses,
  getRecentRuns,
  triggerRun,
  getRunStatus,
  Brand,
  OverviewData,
  TrendPoint,
  DashboardAnalytics,
  QueryResult,
  TrackingRun,
} from '@/lib/api';
import TrendChart from '@/components/TrendChart';
import {
  AreaChart,
  Area,
  PieChart,
  Pie,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from 'recharts';
import { format, parseISO } from 'date-fns';

const parseUTCISO = (s: string) => parseISO(s.endsWith('Z') ? s : s + 'Z');

type Tab = 'overview' | 'reports';

const MODEL_ORDER = ['chatgpt', 'claude', 'perplexity', 'gemini'];
const MODEL_CONFIG: Record<string, { label: string; bg: string; text: string }> = {
  chatgpt:    { label: 'ChatGPT',    bg: '#064e3b', text: '#10b981' },
  claude:     { label: 'Claude',     bg: '#451a03', text: '#f59e0b' },
  perplexity: { label: 'Perplexity', bg: '#2e1065', text: '#a78bfa' },
  gemini:     { label: 'Gemini',     bg: '#172554', text: '#60a5fa' },
};

function getModelCfg(model: string) {
  const key = model.toLowerCase().replace(/[-_\s]/g, '');
  for (const [k, v] of Object.entries(MODEL_CONFIG)) {
    if (key.includes(k)) return { ...v, key: k };
  }
  return { label: model, bg: '#1a1a24', text: '#64748b', key: model };
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
      <span className="w-4 h-4 rounded-full bg-[#1a1a24] border border-[#2a2a3a] text-[#475569] text-[10px] font-bold flex items-center justify-center cursor-help select-none">
        ?
      </span>
      {open && (
        <span className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-60 bg-[#111118] border border-[#2a2a3a] rounded-lg p-3 text-xs text-[#94a3b8] leading-relaxed shadow-lg z-50 pointer-events-none whitespace-normal">
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
    <div className="bg-[#111118] border border-[#1e1e2e] rounded-lg p-2 shadow-lg text-xs">
      <p className="text-[#64748b]">{d.formattedDate}</p>
      <p className="text-[#818cf8] font-bold">{Math.round(d.score)}%</p>
    </div>
  );
}

// ── Donut domain chart ─────────────────────────────────────────────────────────

const DONUT_COLORS = ['#6366f1', '#10b981', '#f59e0b', '#8b5cf6', '#ec4899', '#14b8a6'];

function DonutTooltip({ active, payload }: { active?: boolean; payload?: Array<{ payload: { domain: string; pct: number; domain_type: string } }> }) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <div className="bg-[#111118] border border-[#1e1e2e] rounded-lg px-3 py-2 shadow-lg text-xs pointer-events-none">
      <p className="text-[#e2e8f0] font-semibold truncate max-w-[160px]">{d.domain}</p>
      <p className="text-[#64748b] mt-0.5">{d.domain_type}</p>
      <p className="text-[#818cf8] font-bold mt-1">{d.pct.toFixed(1)}% of responses</p>
    </div>
  );
}

function DonutDomains({ domains }: { domains: Array<{ domain: string; pct: number; count: number; domain_type: string }> }) {
  const data = domains.map((d) => ({ ...d, value: d.count }));
  const total = data.reduce((s, d) => s + d.count, 0);

  return (
    <div className="flex items-center gap-3 flex-1">
      <div className="flex-shrink-0">
        <ResponsiveContainer width={96} height={96}>
          <PieChart>
            <Pie data={data} cx="50%" cy="50%" innerRadius={30} outerRadius={44} paddingAngle={2} dataKey="value" stroke="none">
              {data.map((_, i) => (
                <Cell key={i} fill={DONUT_COLORS[i % DONUT_COLORS.length]} />
              ))}
            </Pie>
            <Tooltip content={<DonutTooltip />} />
          </PieChart>
        </ResponsiveContainer>
      </div>
      <div className="flex-1 min-w-0 space-y-1.5">
        {data.map((d, i) => {
          const pct = total > 0 ? Math.round((d.count / total) * 100) : 0;
          return (
            <div key={d.domain} className="flex items-center gap-1.5 min-w-0">
              <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: DONUT_COLORS[i % DONUT_COLORS.length] }} />
              <span className="text-xs text-[#64748b] truncate flex-1 min-w-0">{d.domain}</span>
              <span className="text-xs text-[#94a3b8] tabular-nums flex-shrink-0">{pct}%</span>
            </div>
          );
        })}
      </div>
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

// ── Page ───────────────────────────────────────────────────────────────────────

export default function DashboardPage() {
  const [brands, setBrands] = useState<Brand[]>([]);
  const [selectedBrandId, setSelectedBrandId] = useState<number | null>(null);
  const [activeTab, setActiveTab] = useState<Tab>('overview');

  // Overview data
  const [overview, setOverview] = useState<OverviewData | null>(null);
  const [trends, setTrends] = useState<TrendPoint[]>([]);
  const [analytics, setAnalytics] = useState<DashboardAnalytics | null>(null);
  const [loadingBrands, setLoadingBrands] = useState(true);
  const [loadingAnalytics, setLoadingAnalytics] = useState(false);

  // Reports data
  const [responses, setResponses] = useState<QueryResult[]>([]);
  const [loadingResponses, setLoadingResponses] = useState(false);

  // Run state
  const [triggering, setTriggering] = useState(false);
  const [activeRunId, setActiveRunId] = useState<number | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // UI state
  const [expandedPromptId, setExpandedPromptId] = useState<number | null>(null);
  const [expandedConvId, setExpandedConvId] = useState<number | null>(null);

  useEffect(() => {
    getBrands().then((b) => {
      setBrands(b);
      if (b.length > 0) setSelectedBrandId(b[0].id);
      setLoadingBrands(false);
    }).catch(() => setLoadingBrands(false));
  }, []);

  const loadData = useCallback(async (brandId: number) => {
    setLoadingAnalytics(true);
    setLoadingResponses(true);
    setOverview(null);
    setTrends([]);
    setAnalytics(null);
    setResponses([]);
    setExpandedPromptId(null);
    setExpandedConvId(null);

    try {
      const [ov, tr, an, runs] = await Promise.all([
        getOverview(brandId),
        getTrends(brandId),
        getDashboardAnalytics(brandId),
        getRecentRuns(brandId),
      ]);
      setOverview(ov);
      setTrends(Array.isArray(tr) ? tr : []);
      setAnalytics(an);
      setLoadingAnalytics(false);

      // Load responses from latest completed run
      const normalizedRuns = Array.isArray(runs) ? runs : [];
      const latestCompleted = [...normalizedRuns]
        .filter((r: TrackingRun) => r.status === 'completed')
        .sort((a: TrackingRun, b: TrackingRun) => b.id - a.id)[0];

      if (latestCompleted) {
        const resps = await getResponses(brandId, latestCompleted.id);
        setResponses(
          Array.isArray(resps)
            ? resps.filter((r) => r.error !== 'api_key_not_configured')
            : []
        );
      }
    } catch {
      setLoadingAnalytics(false);
    } finally {
      setLoadingResponses(false);
    }
  }, []);

  useEffect(() => {
    if (!selectedBrandId) return;
    loadData(selectedBrandId);
  }, [selectedBrandId, loadData]);

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
          if (selectedBrandId) loadData(selectedBrandId);
        }
      } catch { /* ignore */ }
    }, 3000);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [activeRunId, selectedBrandId, loadData]);

  async function handleRunReport() {
    if (!selectedBrandId) return;
    setTriggering(true);
    try {
      const result = await triggerRun(selectedBrandId);
      setActiveRunId(result.run_id);
    } catch { /* ignore */ } finally {
      setTriggering(false);
    }
  }

  const selectedBrand = brands.find((b) => b.id === selectedBrandId);
  const latestRun = overview?.latest_run;
  const score = latestRun?.overall_score ?? null;
  const isRunning = activeRunId !== null || latestRun?.status === 'running';

  const sparkData = trends.map((p) => ({
    ...p,
    formattedDate: format(parseUTCISO(p.completed_at), 'MMM d'),
    score: Math.round(p.score),
  }));

  const sentColor = analytics?.sentiment.has_data
    ? analytics.sentiment.positive_pct >= 60 ? '#10b981'
    : analytics.sentiment.positive_pct >= 30 ? '#f59e0b'
    : '#ef4444'
    : '#475569';

  const promptGroups = buildPromptGroups(responses);

  return (
    <div className="px-8 py-8 max-w-7xl">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-[#e2e8f0]">
            {selectedBrand ? selectedBrand.name : 'Dashboard'}
          </h1>
          <p className="text-sm text-[#64748b] mt-1">AI visibility analytics</p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => selectedBrandId && loadData(selectedBrandId)}
            className="flex items-center gap-2 bg-[#111118] hover:bg-[#1a1a24] border border-[#1e1e2e] text-[#64748b] rounded-lg px-3 py-2 text-sm transition-colors"
          >
            <RefreshCw size={14} />
          </button>
          <button
            onClick={handleRunReport}
            disabled={triggering || isRunning || !selectedBrandId}
            className="flex items-center gap-2 bg-[#6366f1] hover:bg-[#4f46e5] disabled:opacity-50 text-white rounded-lg px-4 py-2 text-sm font-medium transition-colors"
          >
            {triggering || isRunning ? (
              <>
                <Loader2 size={14} className="animate-spin" />
                {isRunning ? 'Running...' : 'Starting...'}
              </>
            ) : (
              <>
                <Play size={14} />
                Run Report Now
              </>
            )}
          </button>
          <Link
            href="/tracker/new"
            className="flex items-center gap-2 bg-[#111118] hover:bg-[#1a1a24] border border-[#1e1e2e] text-[#94a3b8] rounded-lg px-4 py-2 text-sm font-medium transition-colors"
          >
            <Plus size={16} />
            Add Brand
          </Link>
        </div>
      </div>

      {/* Running banner */}
      {isRunning && (
        <div className="bg-[#1a1a24] border border-[#6366f1]/30 rounded-xl p-4 mb-6">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-[#6366f1]/10 flex items-center justify-center flex-shrink-0">
              <Loader2 size={16} className="text-[#818cf8] animate-spin" />
            </div>
            <div className="flex-1">
              <p className="text-sm font-semibold text-[#e2e8f0]">Report in progress</p>
              <p className="text-xs text-[#818cf8] mt-0.5">Querying AI models with your prompts. This may take a minute...</p>
            </div>
            <span className="flex items-center gap-2 text-xs text-[#818cf8] font-medium">
              <span className="w-2 h-2 rounded-full bg-[#818cf8] animate-pulse" />
              Auto-updating every 3s
            </span>
          </div>
        </div>
      )}

      {loadingBrands ? (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[1,2,3,4].map(i => (
            <div key={i} className="h-28 bg-[#111118] border border-[#1e1e2e] rounded-xl animate-pulse" />
          ))}
        </div>
      ) : brands.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-24 text-center">
          <div className="w-16 h-16 bg-[#1a1a24] border border-[#2a2a3a] rounded-2xl flex items-center justify-center mb-4">
            <Zap size={28} className="text-[#6366f1]" />
          </div>
          <h3 className="text-lg font-semibold text-[#e2e8f0] mb-2">No brands tracked yet</h3>
          <p className="text-sm text-[#64748b] mb-6 max-w-sm">
            Start tracking your first brand to see how it&apos;s being mentioned across AI models.
          </p>
          <Link
            href="/tracker/new"
            className="flex items-center gap-2 bg-[#6366f1] hover:bg-[#4f46e5] text-white rounded-lg px-5 py-2.5 text-sm font-medium transition-colors"
          >
            <Plus size={16} />
            Track Your First Brand
          </Link>
        </div>
      ) : (
        <>
          {/* Tab navigation */}
          <div className="flex gap-1 border-b border-[#1e1e2e] mb-6">
            {([['overview', 'Overview'], ['reports', 'Reports']] as [Tab, string][]).map(([tab, label]) => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`px-5 py-2.5 text-sm font-medium rounded-t-lg border-b-2 -mb-px transition-colors ${
                  activeTab === tab
                    ? 'text-[#818cf8] border-[#6366f1] bg-[#111118]'
                    : 'text-[#64748b] border-transparent hover:text-[#94a3b8]'
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          {/* ── OVERVIEW TAB ──────────────────────────────────────────────── */}
          {activeTab === 'overview' && (
            <>
              {/* Row 1: visibility + SOV + sentiment */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
                {/* Visibility score + sparkline */}
                <div className="col-span-2 bg-[#111118] border border-[#1e1e2e] border-t-2 border-t-[#6366f1] rounded-xl p-5">
                  <div className="flex items-start justify-between mb-3">
                    <div>
                      <p className="text-sm font-medium text-[#94a3b8]">Visibility Score</p>
                      {loadingAnalytics ? (
                        <div className="h-9 w-20 bg-[#1a1a24] rounded animate-pulse mt-2" />
                      ) : (
                        <p className="text-4xl font-bold text-[#e2e8f0] mt-1">
                          {score != null ? `${Math.round(score)}%` : 'N/A'}
                        </p>
                      )}
                    </div>
                    <div className="w-10 h-10 rounded-xl bg-[#1a1a24] flex items-center justify-center text-[#6366f1]">
                      <BarChart2 size={18} />
                    </div>
                  </div>
                  {sparkData.length > 1 ? (
                    <ResponsiveContainer width="100%" height={60}>
                      <AreaChart data={sparkData} margin={{ top: 0, right: 0, left: 0, bottom: 0 }}>
                        <defs>
                          <linearGradient id="sparkGrad" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="#6366f1" stopOpacity={0.3} />
                            <stop offset="95%" stopColor="#6366f1" stopOpacity={0} />
                          </linearGradient>
                        </defs>
                        <Tooltip content={<SparklineTooltip />} />
                        <Area type="monotone" dataKey="score" stroke="#6366f1" strokeWidth={2} fill="url(#sparkGrad)" dot={false} />
                      </AreaChart>
                    </ResponsiveContainer>
                  ) : (
                    <p className="text-xs text-[#475569] mt-2">
                      {sparkData.length === 1 ? '1 run recorded' : 'No trend data yet'}
                    </p>
                  )}
                </div>

                {/* SOV */}
                <div className="bg-[#111118] border border-[#1e1e2e] rounded-xl p-5">
                  <div className="flex items-start justify-between mb-2">
                    <p className="text-sm font-medium text-[#94a3b8] flex items-center">
                      Share of Voice
                      <HelpTooltip text="The percentage of total AI brand mentions in your category that belong to your brand." />
                    </p>
                    <div className="w-8 h-8 rounded-lg bg-[#1a1a24] flex items-center justify-center text-[#6366f1] flex-shrink-0">
                      <Users size={15} />
                    </div>
                  </div>
                  {loadingAnalytics ? (
                    <div className="h-8 w-16 bg-[#1a1a24] rounded animate-pulse mt-1" />
                  ) : analytics ? (
                    <>
                      <p className="text-3xl font-bold text-[#e2e8f0]">
                        {Math.round(analytics.sov.percentage)}%
                      </p>
                      {analytics.sov.has_competitors ? (
                        <p className="text-xs text-[#475569] mt-1">
                          {analytics.sov.brand_mentions} / {analytics.sov.total_mentions} mentions
                        </p>
                      ) : (
                        <p className="text-xs text-[#475569] mt-1">Add competitors for SOV</p>
                      )}
                    </>
                  ) : (
                    <p className="text-3xl font-bold text-[#e2e8f0]">—</p>
                  )}
                </div>

                {/* Sentiment */}
                <div className="bg-[#111118] border border-[#1e1e2e] rounded-xl p-5">
                  <div className="flex items-start justify-between mb-2">
                    <p className="text-sm font-medium text-[#94a3b8] flex items-center">
                      Sentiment
                      <HelpTooltip text="How positively AI models describe your brand when they mention it." />
                    </p>
                    <div className="w-8 h-8 rounded-lg bg-[#1a1a24] flex items-center justify-center text-[#6366f1] flex-shrink-0">
                      <TrendingUp size={15} />
                    </div>
                  </div>
                  {loadingAnalytics ? (
                    <div className="h-8 w-16 bg-[#1a1a24] rounded animate-pulse mt-1" />
                  ) : analytics?.sentiment.has_data ? (
                    <>
                      <p className="text-2xl font-bold mt-1" style={{ color: sentColor }}>
                        {Math.round(analytics.sentiment.positive_pct)}% Positive
                      </p>
                      <div className="mt-2 flex gap-0.5 h-1.5 rounded-full overflow-hidden">
                        <div style={{ width: `${analytics.sentiment.positive_pct}%`, background: '#10b981' }} />
                        <div style={{ width: `${analytics.sentiment.neutral_pct}%`, background: '#f59e0b' }} />
                        <div style={{ width: `${analytics.sentiment.negative_pct}%`, background: '#ef4444' }} />
                      </div>
                      <p className="text-xs text-[#475569] mt-1.5">
                        {Math.round(analytics.sentiment.neutral_pct)}% neutral · {Math.round(analytics.sentiment.negative_pct)}% negative
                      </p>
                    </>
                  ) : (
                    <>
                      <p className="text-3xl font-bold text-[#e2e8f0] mt-1">—</p>
                      <p className="text-xs text-[#475569] mt-1">No mentions to analyze</p>
                    </>
                  )}
                </div>
              </div>

              {/* Row 2: Avg Position + Top Domains */}
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-4">
                {/* Avg Position */}
                <div className="bg-[#111118] border border-[#1e1e2e] rounded-xl p-5">
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-sm font-medium text-[#94a3b8] flex items-center">
                      Avg Position
                      <HelpTooltip text="Where in the AI response your brand typically appears. Lower is better." />
                    </p>
                    <div className="w-8 h-8 rounded-lg bg-[#1a1a24] flex items-center justify-center text-[#6366f1]">
                      <Building2 size={15} />
                    </div>
                  </div>
                  {loadingAnalytics ? (
                    <div className="h-8 w-16 bg-[#1a1a24] rounded animate-pulse" />
                  ) : analytics?.position.score != null ? (
                    <>
                      <p className="text-3xl font-bold text-[#e2e8f0]">
                        {analytics.position.score.toFixed(1)}
                        <span className="text-base font-normal text-[#475569]">/10</span>
                      </p>
                      <p className="text-xs text-[#475569] mt-1">
                        {analytics.position.label} · {analytics.position.sample_count} samples
                      </p>
                    </>
                  ) : (
                    <>
                      <p className="text-3xl font-bold text-[#e2e8f0]">—</p>
                      <p className="text-xs text-[#475569] mt-1">No mentions recorded</p>
                    </>
                  )}
                </div>

                {/* Top Domains */}
                <div className="lg:col-span-2 bg-[#111118] border border-[#1e1e2e] rounded-xl p-5 flex flex-col">
                  <div className="flex items-center justify-between mb-3">
                    <p className="text-sm font-medium text-[#94a3b8] flex items-center">
                      Top Domains
                      <HelpTooltip text="Websites that AI models cite most often when answering your tracked prompts." />
                    </p>
                    <Globe size={14} className="text-[#475569]" />
                  </div>
                  {loadingAnalytics ? (
                    <div className="flex items-center justify-center flex-1 py-4">
                      <div className="w-24 h-24 rounded-full bg-[#1a1a24] animate-pulse" />
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

              {/* Recent Conversations */}
              <div className="bg-[#111118] border border-[#1e1e2e] rounded-xl overflow-hidden">
                <div className="px-5 py-4 border-b border-[#1e1e2e] flex items-center justify-between bg-[#0d0d14]">
                  <div className="flex items-center gap-2">
                    <MessageSquare size={16} className="text-[#6366f1]" />
                    <h3 className="text-base font-semibold text-[#e2e8f0]">Recent Conversations</h3>
                    {analytics && (
                      <span className="text-xs text-[#64748b] bg-[#1a1a24] border border-[#2a2a3a] px-2 py-0.5 rounded-full">
                        {analytics.total_responses_analyzed.toLocaleString()} analyzed
                      </span>
                    )}
                  </div>
                </div>

                {loadingAnalytics ? (
                  <div className="divide-y divide-[#1e1e2e]">
                    {[1,2,3,4].map(i => (
                      <div key={i} className="px-5 py-4 animate-pulse">
                        <div className="flex items-center justify-between mb-2">
                          <div className="h-3.5 bg-[#1a1a24] rounded w-2/5" />
                          <div className="flex gap-2">
                            <div className="w-16 h-5 bg-[#1a1a24] rounded" />
                            <div className="w-20 h-5 bg-[#1a1a24] rounded" />
                          </div>
                        </div>
                        <div className="h-3 bg-[#1a1a24] rounded w-4/5" />
                      </div>
                    ))}
                  </div>
                ) : analytics && analytics.recent_conversations.length > 0 ? (
                  <div className="divide-y divide-[#1e1e2e]">
                    {analytics.recent_conversations.map((conv) => {
                      const modelKey = conv.model.toLowerCase().replace(/[-_\s]/g, '');
                      const mc = Object.entries(MODEL_CONFIG).find(([k]) => modelKey.includes(k))?.[1]
                        ?? { bg: '#1a1a24', text: '#64748b' };
                      const label = Object.entries(MODEL_CONFIG).find(([k]) => modelKey.includes(k))
                        ? MODEL_CONFIG[Object.keys(MODEL_CONFIG).find(k => modelKey.includes(k))!].label
                        : conv.model;

                      return (
                        <div key={conv.id}>
                          <button
                            className="w-full px-5 py-4 hover:bg-[#0d0d14] transition-colors text-left"
                            onClick={() => setExpandedConvId(expandedConvId === conv.id ? null : conv.id)}
                          >
                            <div className="flex items-start justify-between gap-3 mb-1.5">
                              <span className="text-xs font-medium text-[#94a3b8] leading-relaxed flex-1 min-w-0">
                                {conv.prompt_text.length > 80 ? conv.prompt_text.slice(0, 80) + '…' : conv.prompt_text}
                              </span>
                              <div className="flex items-center gap-1.5 flex-shrink-0">
                                <span
                                  className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full"
                                  style={{ backgroundColor: mc.bg, color: mc.text }}
                                >
                                  {label}
                                </span>
                                <span
                                  className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${
                                    conv.mentioned
                                      ? 'bg-[#064e3b]/30 text-[#10b981]'
                                      : 'bg-[#1e1e2e] text-[#64748b]'
                                  }`}
                                >
                                  {conv.mentioned ? 'Mentioned' : 'Not mentioned'}
                                </span>
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
                            <div className="px-5 pb-4 pt-3 border-t border-[#1e1e2e] bg-[#0d0d14]">
                              <p className="text-xs text-[#64748b] leading-relaxed whitespace-pre-wrap">
                                {conv.response_text}
                              </p>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <p className="text-sm text-[#475569] text-center py-10">
                    No conversation data yet. Run a report to start tracking.
                  </p>
                )}
              </div>
            </>
          )}

          {/* ── REPORTS TAB ───────────────────────────────────────────────── */}
          {activeTab === 'reports' && (
            <>
              {/* Trend chart */}
              <div className="mb-4">
                {loadingAnalytics ? (
                  <div className="bg-[#111118] border border-[#1e1e2e] rounded-xl p-6 animate-pulse">
                    <div className="h-5 bg-[#1a1a24] rounded w-32 mb-4" />
                    <div className="h-48 bg-[#1a1a24] rounded-lg" />
                  </div>
                ) : (
                  <TrendChart data={trends} />
                )}
              </div>

              {/* Schedule note */}
              <p className="text-xs text-[#475569] mb-4 px-1">
                Reports update automatically twice daily at 8:00 AM and 8:00 PM UTC.
              </p>

              {/* Prompt list */}
              <div className="bg-[#111118] border border-[#1e1e2e] rounded-xl overflow-hidden">
                <div className="px-5 py-3.5 border-b border-[#1e1e2e] bg-[#0d0d14] flex items-center justify-between">
                  <h3 className="text-sm font-semibold text-[#e2e8f0]">Prompt Visibility</h3>
                  {!loadingResponses && promptGroups.length > 0 && (
                    <span className="text-xs text-[#64748b]">
                      {promptGroups.length} prompt{promptGroups.length !== 1 ? 's' : ''}
                    </span>
                  )}
                </div>

                {loadingResponses ? (
                  <div className="divide-y divide-[#1e1e2e]">
                    {[1,2,3].map(i => (
                      <div key={i} className="px-5 py-5 animate-pulse">
                        <div className="h-4 bg-[#1a1a24] rounded w-3/4 mb-3" />
                        <div className="flex gap-2">
                          {[1,2,3,4].map(j => <div key={j} className="h-7 w-28 bg-[#1a1a24] rounded-lg" />)}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : promptGroups.length === 0 ? (
                  <div className="px-5 py-12 text-center text-[#475569] text-sm">
                    No report data yet. Run a report to see prompt visibility.
                  </div>
                ) : (
                  <div className="divide-y divide-[#1e1e2e]">
                    {promptGroups.map((g) => {
                      const overallPct = g.total > 0 ? Math.round((g.mentioned / g.total) * 100) : 0;
                      const overallColor = overallPct >= 60 ? '#10b981' : overallPct >= 30 ? '#f59e0b' : '#ef4444';
                      const isExpanded = expandedPromptId === g.promptId;

                      return (
                        <div key={g.promptId}>
                          <button
                            className="w-full px-5 py-4 hover:bg-[#0d0d14] transition-colors text-left"
                            onClick={() => setExpandedPromptId(isExpanded ? null : g.promptId)}
                          >
                            <div className="flex items-start gap-3 mb-3">
                              <p className="text-sm text-[#94a3b8] leading-snug font-medium flex-1">
                                {g.promptText}
                              </p>
                              <div className="flex items-center gap-2 flex-shrink-0">
                                <span className="text-sm font-bold tabular-nums" style={{ color: overallColor }}>
                                  {overallPct}%
                                </span>
                                <ChevronDown
                                  size={14}
                                  className={`text-[#475569] transition-transform ${isExpanded ? 'rotate-180' : ''}`}
                                />
                              </div>
                            </div>

                            {/* Model breakdown badges */}
                            <div className="flex items-center gap-2 flex-wrap">
                              {MODEL_ORDER.map(modelKey => {
                                const ms = g.modelStats.get(modelKey);
                                if (!ms) return null;
                                const cfg = getModelCfg(modelKey);
                                const pct = ms.total > 0 ? Math.round((ms.mentioned / ms.total) * 100) : 0;
                                const mentionColor = pct >= 60 ? '#10b981' : pct >= 30 ? '#f59e0b' : '#ef4444';
                                return (
                                  <div
                                    key={modelKey}
                                    className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-[#2a2a3a] bg-[#111118]"
                                  >
                                    <span className="text-xs font-semibold" style={{ color: cfg.text }}>
                                      {cfg.label}
                                    </span>
                                    <span className="text-[#2a2a3a]">·</span>
                                    <span className="text-xs font-bold tabular-nums" style={{ color: mentionColor }}>
                                      {pct}%
                                    </span>
                                  </div>
                                );
                              })}
                            </div>
                          </button>

                          {/* Expanded: individual query responses */}
                          {isExpanded && (
                            <div className="border-t border-[#1e1e2e] bg-[#0d0d14] divide-y divide-[#1e1e2e]">
                              {g.responses.map((r) => {
                                const cfg = getModelCfg(r.model);
                                return (
                                  <div key={r.id} className="px-5 py-3 flex items-start gap-3">
                                    <span
                                      className="text-[10px] font-semibold px-2 py-0.5 rounded-full flex-shrink-0 mt-0.5"
                                      style={{ backgroundColor: cfg.bg, color: cfg.text }}
                                    >
                                      {cfg.label}
                                    </span>
                                    <div className="flex-1 min-w-0">
                                      {r.response_text ? (
                                        <p className="text-xs text-[#64748b] leading-relaxed line-clamp-3">
                                          {stripMarkdown(r.response_text).slice(0, 200)}
                                          {r.response_text.length > 200 ? '…' : ''}
                                        </p>
                                      ) : (
                                        <p className="text-xs text-[#475569] italic">No response text</p>
                                      )}
                                    </div>
                                    <span
                                      className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full flex-shrink-0 ${
                                        r.mentioned
                                          ? 'bg-[#064e3b]/30 text-[#10b981]'
                                          : 'bg-[#1e1e2e] text-[#64748b]'
                                      }`}
                                    >
                                      {r.mentioned ? 'Mentioned' : 'Not mentioned'}
                                    </span>
                                  </div>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}
