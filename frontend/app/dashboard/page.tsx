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
  getBrand,
  getOverview,
  getTrends,
  getDashboardAnalytics,
  getResponses,
  getRecentRuns,
  triggerRun,
  getRunStatus,
  generateNow,
  triggerScan,
  Brand,
  BrandDetail,
  OverviewData,
  TrendPoint,
  DashboardAnalytics,
  QueryResult,
  TrackingRun,
  Prompt,
} from '@/lib/api';
import TrendChart from '@/components/TrendChart';
import {
  AreaChart,
  Area,
  PieChart,
  Pie,
  Sector,
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
  gemini:     { label: 'Gemini',     bg: '#1e3a5f', text: '#60a5fa' },
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
        <span className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-60 bg-[rgba(15,20,40,0.95)] border border-[rgba(255,255,255,0.12)] rounded-lg p-3 text-xs text-[#94A3B8] leading-relaxed shadow-lg z-50 pointer-events-none whitespace-normal">
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
    <div className="bg-[rgba(15,20,40,0.95)] border border-[rgba(255,255,255,0.12)] rounded-lg p-2 shadow-lg text-xs">
      <p className="text-[#64748B]">{d.formattedDate}</p>
      <p className="text-[#6366f1] font-bold">{Math.round(d.score)}%</p>
    </div>
  );
}

// ── Pie domain chart ───────────────────────────────────────────────────────────

const PIE_COLORS = ['#6366f1', '#10b981', '#f59e0b', '#8b5cf6', '#f43f5e', '#06b6d4'];

function PieTooltip({ active, payload }: { active?: boolean; payload?: Array<{ payload: { domain: string; pct: number; domain_type: string } }> }) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <div className="bg-[rgba(15,20,40,0.95)] border border-[rgba(255,255,255,0.12)] rounded-lg px-3 py-2 shadow-xl text-xs pointer-events-none">
      <p className="text-[#F0F4F8] font-semibold truncate max-w-[180px]">{d.domain}</p>
      <p className="text-[#6366f1] font-bold mt-1">{d.pct.toFixed(1)}% of responses</p>
    </div>
  );
}

function ActivePieSlice(props: Record<string, unknown>) {
  const { cx, cy, innerRadius, outerRadius, startAngle, endAngle, fill } = props as {
    cx: number; cy: number; innerRadius: number; outerRadius: number;
    startAngle: number; endAngle: number; fill: string;
  };
  return (
    <Sector
      cx={cx} cy={cy}
      innerRadius={innerRadius}
      outerRadius={(outerRadius as number) + 6}
      startAngle={startAngle} endAngle={endAngle}
      fill={fill}
      stroke="#6366f1"
      strokeWidth={1}
    />
  );
}

function DonutDomains({ domains }: { domains: Array<{ domain: string; pct: number; count: number; domain_type: string }> }) {
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const data = domains.map((d) => ({ ...d, value: d.count }));
  const total = data.reduce((s, d) => s + d.count, 0);

  return (
    <div className="flex items-center gap-4 flex-1">
      <div className="flex-shrink-0">
        <ResponsiveContainer width={120} height={120}>
          <PieChart>
            <Pie
              data={data}
              cx="50%"
              cy="50%"
              innerRadius={0}
              outerRadius={52}
              paddingAngle={1}
              dataKey="value"
              stroke="rgba(255,255,255,0.10)"
              strokeWidth={1}
              activeIndex={activeIndex ?? undefined}
              activeShape={ActivePieSlice}
              onMouseEnter={(_, index) => setActiveIndex(index)}
              onMouseLeave={() => setActiveIndex(null)}
            >
              {data.map((_, i) => (
                <Cell
                  key={i}
                  fill={PIE_COLORS[i % PIE_COLORS.length]}
                  opacity={activeIndex === null || activeIndex === i ? 1 : 0.5}
                />
              ))}
            </Pie>
            <Tooltip content={<PieTooltip />} />
          </PieChart>
        </ResponsiveContainer>
      </div>
      <div className="flex-1 min-w-0 space-y-1.5">
        {data.map((d, i) => {
          const pct = total > 0 ? ((d.count / total) * 100) : 0;
          return (
            <div
              key={d.domain}
              className="flex items-center gap-2 min-w-0 cursor-default"
              onMouseEnter={() => setActiveIndex(i)}
              onMouseLeave={() => setActiveIndex(null)}
            >
              <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: PIE_COLORS[i % PIE_COLORS.length], opacity: activeIndex === null || activeIndex === i ? 1 : 0.4 }} />
              <span className="text-xs truncate flex-1 min-w-0" style={{ color: activeIndex === i ? '#F0F4F8' : '#64748B' }}>{d.domain}</span>
              <span className="text-xs tabular-nums flex-shrink-0 font-medium" style={{ color: activeIndex === i ? '#818CF8' : '#94A3B8' }}>{pct.toFixed(1)}%</span>
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

// ── Gap explanation helpers ────────────────────────────────────────────────────

const STOPWORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
  'of', 'with', 'by', 'from', 'is', 'are', 'was', 'were', 'be', 'been',
  'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
  'should', 'may', 'might', 'can', 'that', 'this', 'these', 'those',
  'it', 'its', 'they', 'them', 'their', 'he', 'she', 'we', 'you', 'i',
  'as', 'if', 'when', 'then', 'than', 'so', 'also', 'both', 'each',
  'which', 'who', 'what', 'how', 'not', 'no', 'such', 'there', 'here',
  'more', 'most', 'other', 'some', 'any', 'all', 'between', 'into',
  'through', 'however', 'while', 'after', 'before', 'about', 'above',
  'medical', 'clinical', 'based', 'used', 'using', 'include', 'including',
  'provides', 'provide', 'patient', 'patients', 'health', 'care', 'test',
  'testing', 'research', 'study', 'studies', 'available', 'company',
  'companies', 'technology', 'detection', 'blood', 'cancer', 'early',
]);

function extractGapMentions(group: PromptGroup, brandName: string): string {
  const nonMentioned = group.responses.filter((r) => !r.mentioned && r.response_text);
  if (nonMentioned.length === 0) return '';

  const brandLower = brandName.toLowerCase();
  const counts = new Map<string, number>();

  for (const r of nonMentioned) {
    const text = r.response_text!;
    // Match sequences of 1-3 capitalized words (proper nouns)
    const matches = text.match(/\b[A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+){0,2}\b/g) ?? [];
    const seen = new Set<string>();
    for (const m of matches) {
      const lower = m.toLowerCase();
      // Skip the brand name itself, single stopwords, and very short words
      if (lower === brandLower || lower.split(' ').every((w) => STOPWORDS.has(w)) || m.length < 3) continue;
      // Skip single words that are in stopwords
      if (!m.includes(' ') && STOPWORDS.has(lower)) continue;
      if (!seen.has(lower)) {
        seen.add(lower);
        counts.set(m, (counts.get(m) ?? 0) + 1);
      }
    }
  }

  if (counts.size === 0) return '';

  // Pick top 3 by frequency, minimum 2 occurrences
  const top = Array.from(counts.entries())
    .filter(([, n]) => n >= 2)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([name]) => name);

  if (top.length === 0) return '';

  if (top.length === 1) return `${top[0]} is mentioned instead.`;
  if (top.length === 2) return `${top[0]} and ${top[1]} are mentioned instead.`;
  return `${top[0]}, ${top[1]}, and ${top[2]} are mentioned instead.`;
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
    for (const [, p] of map) {
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
    <div className="bg-[rgba(255,255,255,0.08)] backdrop-blur-md border border-[rgba(255,255,255,0.12)] rounded-xl p-5 shadow-[0_4px_24px_rgba(0,0,0,0.20)] flex flex-col">
      <div className="flex items-start justify-between mb-2">
        <p className="text-sm font-medium text-[#94A3B8] flex items-center">
          Best Performing Prompt
          <HelpTooltip text="The prompt where your brand is mentioned most often across AI models." />
        </p>
        <div className="w-8 h-8 rounded-lg bg-[rgba(255,255,255,0.06)] flex items-center justify-center text-[#6366f1] flex-shrink-0">
          <MessageSquare size={15} />
        </div>
      </div>
      {loading ? (
        <div className="h-8 w-full bg-[rgba(255,255,255,0.06)] rounded animate-pulse mt-1" />
      ) : best ? (
        <>
          <p className="text-xs text-[#F0F4F8] leading-relaxed mt-1 line-clamp-2 flex-1">
            &ldquo;{best.text}&rdquo;
          </p>
          <p className="text-2xl font-bold text-[#10b981] mt-2">
            {Math.round((best.mentioned / best.total) * 100)}%
            <span className="text-sm font-normal text-[#475569] ml-1">visibility</span>
          </p>
          {best.models.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-2">
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
        </>
      ) : (
        <>
          <p className="text-3xl font-bold text-[#F0F4F8] mt-1">—</p>
          <p className="text-xs text-[#475569] mt-1">No data yet</p>
        </>
      )}
      <p className="text-[10px] text-[#475569] mt-3 pt-2 border-t border-[rgba(255,255,255,0.12)]">
        Add competitors to enable Share of Voice
      </p>
    </div>
  );
}

// ── Page ───────────────────────────────────────────────────────────────────────

export default function DashboardPage() {
  const [brands, setBrands] = useState<Brand[]>([]);
  const [selectedBrandId, setSelectedBrandId] = useState<number | null>(null);
  const [activeTab, setActiveTab] = useState<Tab>('overview');
  const [newBrandMode, setNewBrandMode] = useState(false);
  const [newBrandStep, setNewBrandStep] = useState<'running' | 'drafting' | 'done'>('running');
  const newBrandHandledRef = useRef(false);

  // Overview data
  const [overview, setOverview] = useState<OverviewData | null>(null);
  const [trends, setTrends] = useState<TrendPoint[]>([]);
  const [analytics, setAnalytics] = useState<DashboardAnalytics | null>(null);
  const [loadingBrands, setLoadingBrands] = useState(true);
  const [loadingAnalytics, setLoadingAnalytics] = useState(false);

  // Reports data
  const [responses, setResponses] = useState<QueryResult[]>([]);
  const [loadingResponses, setLoadingResponses] = useState(false);
  const [brandDetail, setBrandDetail] = useState<BrandDetail | null>(null);

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
      const [ov, tr, an, runs, detail] = await Promise.all([
        getOverview(brandId),
        getTrends(brandId),
        getDashboardAnalytics(brandId),
        getRecentRuns(brandId),
        getBrand(brandId).catch(() => null),
      ]);
      setOverview(ov);
      setTrends(Array.isArray(tr) ? tr : []);
      setAnalytics(an);
      setBrandDetail(detail);
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
        setNewBrandMode(true);
        setNewBrandStep('running');
        // Clean URL without reload
        window.history.replaceState({}, '', '/dashboard');
      }
    }
  }, []);

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
          if (selectedBrandId) {
            loadData(selectedBrandId);
            // Auto-generate drafts for new brand onboarding
            if (newBrandMode && !newBrandHandledRef.current && run.status === 'completed') {
              newBrandHandledRef.current = true;
              setNewBrandStep('drafting');
              try {
                await generateNow(selectedBrandId, 3);
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
  const isRunning = activeRunId !== null || latestRun?.status === 'running' || latestRun?.status === 'pending' || (newBrandMode && newBrandStep !== 'done');

  const sparkData = trends.map((p) => ({
    ...p,
    formattedDate: format(parseUTCISO(p.completed_at), 'MMM d'),
    score: Math.round(p.score),
  }));

  const scoreDelta = sparkData.length >= 2
    ? sparkData[sparkData.length - 1].score - sparkData[sparkData.length - 2].score
    : null;

  const nextReportHours: number | null = (() => {
    if (!latestRun?.completed_at) return null;
    const completedAt = parseUTCISO(latestRun.completed_at);
    const nextAt = new Date(completedAt.getTime() + 7 * 24 * 3600 * 1000);
    const h = Math.round((nextAt.getTime() - Date.now()) / 3600000);
    return h > 0 && h < 24 * 8 ? h : null;
  })();

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

  // Sort prompt groups by visibility score descending (fix 5)
  const promptGroups = buildPromptGroups(responses).sort((a, b) => {
    const pctA = a.total > 0 ? a.mentioned / a.total : -1;
    const pctB = b.total > 0 ? b.mentioned / b.total : -1;
    return pctB - pctA;
  });

  // Prompts with no run data yet (fix 4)
  const trackedPromptIds = new Set(promptGroups.map((g) => g.promptId));
  const untrackedPrompts: Prompt[] = (brandDetail?.prompts ?? []).filter(
    (p) => !trackedPromptIds.has(p.id)
  );

  return (
    <div className="px-8 py-8 max-w-7xl">
      {/* New brand onboarding progress banner */}
      {newBrandMode && (
        <div className="mb-6 bg-[rgba(99,102,241,0.10)] border border-[rgba(99,102,241,0.25)] rounded-xl px-5 py-4 flex items-center gap-4">
          {newBrandStep !== 'done' ? (
            <Loader2 size={18} className="animate-spin text-[#6366f1] shrink-0" />
          ) : (
            <div className="w-4.5 h-4.5 rounded-full bg-[#10b981] flex items-center justify-center shrink-0">
              <span className="text-white text-xs font-bold">✓</span>
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
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-[#F0F4F8]">
            {selectedBrand ? selectedBrand.name : 'Dashboard'}
          </h1>
          <p className="text-sm text-[#64748B] mt-1">AI visibility analytics</p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => selectedBrandId && loadData(selectedBrandId)}
            className="flex items-center gap-2 bg-[rgba(255,255,255,0.08)] hover:bg-[rgba(255,255,255,0.08)] border border-[rgba(255,255,255,0.12)] hover:border-[rgba(255,255,255,0.14)] text-[#64748B] hover:text-[#94A3B8] rounded-lg px-3 py-2 transition-all duration-150"
          >
            <RefreshCw size={14} />
          </button>
          <button
            onClick={handleRunReport}
            disabled={triggering || isRunning || !selectedBrandId}
            className="flex items-center gap-2 bg-[#6366f1] hover:bg-[#4f46e5] disabled:opacity-50 text-white rounded-lg px-4 py-2 text-sm font-semibold transition-all duration-150"
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
        </div>
      </div>

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
            <div key={i} className="h-28 bg-[rgba(255,255,255,0.08)] border border-[rgba(255,255,255,0.12)] rounded-xl animate-pulse" />
          ))}
        </div>
      ) : brands.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-24 text-center">
          <div className="w-16 h-16 bg-[rgba(255,255,255,0.06)] border border-[rgba(255,255,255,0.10)] rounded-2xl flex items-center justify-center mb-4">
            <Zap size={28} className="text-[#6366f1]" />
          </div>
          <h3 className="text-lg font-semibold text-[#F0F4F8] mb-2">No brands tracked yet</h3>
          <p className="text-sm text-[#64748B] mb-6 max-w-sm">
            Start tracking your first brand to see how it&apos;s being mentioned across AI models.
          </p>
          <Link
            href="/tracker"
            className="flex items-center gap-2 bg-[#6366f1] hover:bg-[#4f46e5] text-white rounded-lg px-5 py-2.5 text-sm font-medium transition-colors"
          >
            <Plus size={16} />
            Track Your First Brand
          </Link>
        </div>
      ) : (
        <>
          {/* Tab navigation */}
          <div className="flex gap-1 border-b border-[rgba(255,255,255,0.12)] mb-6">
            {([['overview', 'Overview'], ['reports', 'Reports']] as [Tab, string][]).map(([tab, label]) => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`px-5 py-2.5 text-sm font-medium rounded-t-lg border-b-2 -mb-px transition-colors ${
                  activeTab === tab
                    ? 'text-[#818CF8] border-[#6366f1] bg-[rgba(255,255,255,0.06)]'
                    : 'text-[#64748B] border-transparent hover:text-[#94A3B8]'
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
                <div className="col-span-2 bg-[rgba(255,255,255,0.08)] backdrop-blur-md border border-[rgba(255,255,255,0.12)] border-t-2 border-t-[#6366f1] rounded-xl p-5 shadow-[0_4px_24px_rgba(0,0,0,0.20)]">
                  <div className="flex items-start justify-between mb-3">
                    <div>
                      <p className="text-sm font-medium text-[#94A3B8]">Visibility Score</p>
                      {loadingAnalytics ? (
                        <div className="h-14 w-28 bg-[rgba(255,255,255,0.06)] rounded animate-pulse mt-2" />
                      ) : (
                        <>
                          <p className="text-6xl font-bold text-[#F0F4F8] mt-1 leading-none">
                            {score != null ? `${Math.round(score)}%` : 'N/A'}
                          </p>
                          {scoreDelta !== null && (
                            <p className={`text-xs font-medium mt-2 ${scoreDelta > 0 ? 'text-[#10b981]' : scoreDelta < 0 ? 'text-[#f87171]' : 'text-[#64748B]'}`}>
                              {scoreDelta > 0 ? `+${scoreDelta}%` : scoreDelta < 0 ? `${scoreDelta}%` : '—'} since last run
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
                  {nextReportHours !== null && (
                    <p className="text-[11px] text-[#475569] mt-2">
                      Next report in {nextReportHours}h
                    </p>
                  )}
                </div>

                {/* SOV or Best Performing Prompt */}
                {analytics?.sov.has_competitors ? (
                  <div className="bg-[rgba(255,255,255,0.08)] backdrop-blur-md border border-[rgba(255,255,255,0.12)] rounded-xl p-5 shadow-[0_4px_24px_rgba(0,0,0,0.20)]">
                    <div className="flex items-start justify-between mb-2">
                      <p className="text-sm font-medium text-[#94A3B8] flex items-center">
                        Share of Voice
                        <HelpTooltip text="The percentage of total AI brand mentions in your category that belong to your brand." />
                      </p>
                      <div className="w-8 h-8 rounded-lg bg-[rgba(255,255,255,0.06)] flex items-center justify-center text-[#6366f1] flex-shrink-0">
                        <Users size={15} />
                      </div>
                    </div>
                    {loadingAnalytics ? (
                      <div className="h-8 w-16 bg-[rgba(255,255,255,0.06)] rounded animate-pulse mt-1" />
                    ) : (
                      <>
                        <p className="text-3xl font-bold text-[#F0F4F8]">
                          {Math.round(analytics.sov.percentage)}%
                        </p>
                        <p className="text-xs text-[#475569] mt-1">
                          {analytics.sov.brand_mentions} / {analytics.sov.total_mentions} mentions
                        </p>
                      </>
                    )}
                  </div>
                ) : (
                  <BestPromptCard responses={responses} loading={loadingAnalytics} />
                )}

                {/* Sentiment */}
                <div className="bg-[rgba(255,255,255,0.08)] backdrop-blur-md border border-[rgba(255,255,255,0.12)] rounded-xl p-5 shadow-[0_4px_24px_rgba(0,0,0,0.20)]">
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

              {/* Row 2: Avg Position + Top Domains */}
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-4">
                {/* Avg Position */}
                <div className="bg-[rgba(255,255,255,0.08)] backdrop-blur-md border border-[rgba(255,255,255,0.12)] rounded-xl p-5 shadow-[0_4px_24px_rgba(0,0,0,0.20)]">
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
                <div className="lg:col-span-2 bg-[rgba(255,255,255,0.08)] backdrop-blur-md border border-[rgba(255,255,255,0.12)] rounded-xl p-5 shadow-[0_4px_24px_rgba(0,0,0,0.20)] flex flex-col">
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

              {/* Recent Conversations */}
              <div className="bg-[rgba(255,255,255,0.08)] backdrop-blur-md border border-[rgba(255,255,255,0.12)] rounded-xl overflow-hidden shadow-[0_4px_24px_rgba(0,0,0,0.20)]">
                <div className="px-5 py-4 border-b border-[rgba(255,255,255,0.12)] flex items-center justify-between bg-[rgba(255,255,255,0.08)]">
                  <div className="flex items-center gap-2">
                    <MessageSquare size={16} className="text-[#6366f1]" />
                    <h3 className="text-base font-semibold text-[#F0F4F8]">Recent Conversations</h3>
                    {analytics && (
                      <span className="text-xs text-[#64748B] bg-[rgba(255,255,255,0.06)] border border-[rgba(255,255,255,0.10)] px-2 py-0.5 rounded-full">
                        {analytics.total_responses_analyzed.toLocaleString()} analyzed
                      </span>
                    )}
                  </div>
                </div>

                {loadingAnalytics ? (
                  <div className="divide-y divide-[rgba(255,255,255,0.08)]">
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
                  <div className="divide-y divide-[rgba(255,255,255,0.08)]">
                    {analytics.recent_conversations.map((conv) => {
                      const modelKey = conv.model.toLowerCase().replace(/[-_\s]/g, '');
                      const mc = Object.entries(MODEL_CONFIG).find(([k]) => modelKey.includes(k))?.[1]
                        ?? { bg: '#1e293b', text: '#94a3b8' };
                      const label = Object.entries(MODEL_CONFIG).find(([k]) => modelKey.includes(k))
                        ? MODEL_CONFIG[Object.keys(MODEL_CONFIG).find(k => modelKey.includes(k))!].label
                        : conv.model;

                      return (
                        <div key={conv.id}>
                          <button
                            className="w-full px-5 py-4 hover:bg-[rgba(255,255,255,0.06)] transition-colors text-left"
                            onClick={() => setExpandedConvId(expandedConvId === conv.id ? null : conv.id)}
                          >
                            <div className="flex items-start justify-between gap-3 mb-1.5">
                              <span className="text-xs font-medium text-[#94A3B8] leading-relaxed flex-1 min-w-0">
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
                                      : 'bg-[rgba(255,255,255,0.08)] text-[#64748B]'
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
                            <div className="px-5 pb-4 pt-3 border-t border-[rgba(255,255,255,0.12)] bg-[rgba(255,255,255,0.08)]">
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
                  <div className="bg-[rgba(255,255,255,0.08)] backdrop-blur-md border border-[rgba(255,255,255,0.12)] rounded-xl p-6 shadow-[0_4px_24px_rgba(0,0,0,0.20)] animate-pulse">
                    <div className="h-5 bg-[rgba(255,255,255,0.06)] rounded w-32 mb-4" />
                    <div className="h-48 bg-[rgba(255,255,255,0.06)] rounded-lg" />
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
              <div className="bg-[rgba(255,255,255,0.08)] backdrop-blur-md border border-[rgba(255,255,255,0.12)] rounded-xl overflow-hidden shadow-[0_4px_24px_rgba(0,0,0,0.20)]">
                <div className="px-5 py-3.5 border-b border-[rgba(255,255,255,0.12)] bg-[rgba(255,255,255,0.08)] flex items-center justify-between">
                  <h3 className="text-sm font-semibold text-[#F0F4F8]">Prompt Visibility</h3>
                  {!loadingResponses && (promptGroups.length + untrackedPrompts.length) > 0 && (
                    <span className="text-xs text-[#64748B]">
                      {promptGroups.length + untrackedPrompts.length} prompt{(promptGroups.length + untrackedPrompts.length) !== 1 ? 's' : ''}
                    </span>
                  )}
                </div>

                {loadingResponses ? (
                  <div className="divide-y divide-[rgba(255,255,255,0.08)]">
                    {[1,2,3].map(i => (
                      <div key={i} className="px-5 py-5 animate-pulse">
                        <div className="h-4 bg-[rgba(255,255,255,0.06)] rounded w-3/4 mb-3" />
                        <div className="flex gap-2">
                          {[1,2,3,4].map(j => <div key={j} className="h-7 w-28 bg-[rgba(255,255,255,0.06)] rounded-lg" />)}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : promptGroups.length === 0 && untrackedPrompts.length === 0 ? (
                  <div className="px-5 py-12 text-center text-[#475569] text-sm">
                    No report data yet. Run a report to see prompt visibility.
                  </div>
                ) : (
                  <div className="divide-y divide-[rgba(255,255,255,0.08)]">
                    {promptGroups.map((g) => {
                      const overallPct = g.total > 0 ? Math.round((g.mentioned / g.total) * 100) : 0;
                      const overallColor = overallPct >= 60 ? '#10b981' : overallPct >= 30 ? '#f59e0b' : '#ef4444';
                      const isExpanded = expandedPromptId === g.promptId;

                      return (
                        <div key={g.promptId}>
                          <button
                            className="w-full px-5 py-4 hover:bg-[rgba(255,255,255,0.06)] transition-colors text-left"
                            onClick={() => setExpandedPromptId(isExpanded ? null : g.promptId)}
                          >
                            <div className="flex items-start gap-3 mb-3">
                              <p className="text-sm text-[#94A3B8] leading-snug font-medium flex-1">
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
                                    className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-[rgba(255,255,255,0.10)] bg-[rgba(255,255,255,0.08)]"
                                  >
                                    <span className="text-xs font-semibold" style={{ color: cfg.text }}>
                                      {cfg.label}
                                    </span>
                                    <span className="text-[rgba(255,255,255,0.15)]">·</span>
                                    <span className="text-xs font-bold tabular-nums" style={{ color: mentionColor }}>
                                      {pct}%
                                    </span>
                                  </div>
                                );
                              })}
                            </div>
                            {/* Gap explanation — shown when overall visibility < 50% */}
                            {overallPct < 50 && selectedBrand && (() => {
                              const explanation = extractGapMentions(g, selectedBrand.name);
                              return explanation ? (
                                <p className="text-xs text-[#475569] mt-2 italic">
                                  {explanation}
                                </p>
                              ) : null;
                            })()}
                          </button>

                          {/* Expanded: individual query responses */}
                          {isExpanded && (
                            <div className="border-t border-[rgba(255,255,255,0.12)] bg-[rgba(255,255,255,0.08)] divide-y divide-[rgba(255,255,255,0.08)]">
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
                                        <p className="text-xs text-[#64748B] leading-relaxed line-clamp-3">
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
                                          : 'bg-[rgba(255,255,255,0.08)] text-[#64748B]'
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
                    {/* Untracked prompts — added since last run */}
                    {untrackedPrompts.map((p) => {
                      const isRunning = pendingRuns.has(p.id);
                      return (
                        <div key={`untracked-${p.id}`} className="px-5 py-4">
                          <div className="flex items-start gap-3 mb-2">
                            <p className="text-sm text-[#64748B] leading-snug font-medium flex-1">
                              {p.text}
                            </p>
                            {isRunning ? (
                              <span className="flex-shrink-0 flex items-center gap-1.5 text-[10px] font-semibold px-2 py-1 rounded-full bg-[rgba(99,102,241,0.10)] border border-[rgba(99,102,241,0.25)] text-[#6366f1]">
                                <Loader2 size={10} className="animate-spin" />
                                Running…
                              </span>
                            ) : (
                              <span className="flex-shrink-0 text-[10px] font-semibold px-2 py-0.5 rounded-full bg-[rgba(255,255,255,0.06)] border border-[rgba(255,255,255,0.10)] text-[#475569]">
                                Not yet tracked
                              </span>
                            )}
                          </div>
                          <p className="text-xs text-[#475569]">
                            {isRunning ? 'Collecting AI responses for this prompt…' : 'Will be included in your next report run.'}
                          </p>
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
