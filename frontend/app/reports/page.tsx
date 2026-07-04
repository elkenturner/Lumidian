'use client';

import { motion } from 'framer-motion';
import { fadeIn, slideIn } from '@/lib/motion';
import Link from 'next/link';
import { useEffect, useState, useRef, useCallback } from 'react';
import { logError } from '@/lib/utils/errors';
import {
  BarChart2,
  ChevronDown,
  ChevronRight,
  Loader2,
  RefreshCw,
  Download,
  Search,
  ArrowUpDown,
  Plus,
} from 'lucide-react';
import ProgressBanner from '@/components/ProgressBanner';
import ModelIcon from '@/components/ModelIcon';
import { AppToast, ToastData } from '@/components/AppToast';
import {
  getBrand,
  getTrends,
  getResponses,
  getRecentRuns,
  exportReportPDF,
  getCompetitorAnalysis,
  Brand,
  BrandDetail,
  TrendPoint,
  QueryResult,
  TrackingRun,
  Prompt,
  CompetitorAnalysis,
} from '@/lib/api';
import dynamic from 'next/dynamic';
const TrendChart = dynamic(() => import('@/components/TrendChart'), { ssr: false, loading: () => <div className="min-h-[280px] animate-pulse" /> });
import { useBrand } from '@/contexts/BrandContext';
import { format } from 'date-fns';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { MODEL_ORDER, MODEL_CONFIG as MODEL_CONFIG_SHARED, getModelConfig } from '@/lib/constants/models';
import { parseUTCISO } from '@/lib/utils/formatting';
import { useIsMobile } from '@/hooks/useIsMobile';
import ResponseText from '@/components/ui/ResponseText';

const MODEL_CONFIG: Record<string, { label: string; bg: string; text: string }> = Object.fromEntries(
  Object.entries(MODEL_CONFIG_SHARED).map(([k, v]) => [k, { label: v.label, bg: v.mutedBg, text: v.color }])
);

function getModelCfg(model: string) {
  const cfg = getModelConfig(model);
  return { label: cfg.label, bg: cfg.mutedBg, text: cfg.color, key: cfg.key };
}


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

function extractGapMentions(group: PromptGroup, competitorNames: string[]): string {
  if (competitorNames.length === 0) return '';
  const nonMentioned = group.responses.filter((r) => !r.mentioned && r.response_text);
  if (nonMentioned.length === 0) return '';

  const counts = new Map<string, number>();
  for (const name of competitorNames) {
    const nameLower = name.toLowerCase();
    let count = 0;
    for (const r of nonMentioned) {
      if (r.response_text!.toLowerCase().includes(nameLower)) count++;
    }
    if (count > 0) counts.set(name, count);
  }

  if (counts.size === 0) return '';

  const top = Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([name]) => name);

  if (top.length === 1) return `${top[0]} is mentioned instead.`;
  if (top.length === 2) return `${top[0]} and ${top[1]} are mentioned instead.`;
  return `${top[0]}, ${top[1]}, and ${top[2]} are mentioned instead.`;
}

type SortBy = 'visibility' | 'alpha' | 'change';

export default function ReportsPage() {
  const { brands, activeBrandId: selectedBrandId, loading: loadingBrands } = useBrand();
  const isMobile = useIsMobile();
  const [brandDetail, setBrandDetail] = useState<BrandDetail | null>(null);
  const [trends, setTrends] = useState<(TrendPoint & { formattedDate: string; score: number })[]>([]);
  const [responses, setResponses] = useState<QueryResult[]>([]);
  const [prevResponses, setPrevResponses] = useState<QueryResult[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState<SortBy>('visibility');
  const [loading, setLoading] = useState(false);
  const [expandedPromptId, setExpandedPromptId] = useState<number | null>(null);
  const [exportingPDF, setExportingPDF] = useState(false);
  const [toast, setToast] = useState<ToastData | null>(null);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3000);
    return () => clearTimeout(t);
  }, [toast]);
  const [latestRun, setLatestRun] = useState<TrackingRun | null>(null);
  const [competitorAnalysis, setCompetitorAnalysis] = useState<CompetitorAnalysis | null>(null);
  const [competitorModelFilter, setCompetitorModelFilter] = useState<string>('all');
  const [activeTab, setActiveTab] = useState<'prompts' | 'competitors'>('prompts');
  const loadAbortRef = useRef<AbortController | null>(null);

  useEffect(() => { document.title = 'Reports — Lumidian'; }, []);


  const loadData = useCallback(async (brandId: number, signal?: AbortSignal) => {
    setLoading(true);
    setTrends([]);
    setResponses([]);
    setPrevResponses([]);
    setExpandedPromptId(null);
    setBrandDetail(null);
    setCompetitorAnalysis(null);
    setLatestRun(null);
    setSearchQuery('');
    try {
      const runsPromise = getRecentRuns(brandId);
      const runsDataPromise = runsPromise.then((runs) => {
        const completedRuns = [...(Array.isArray(runs) ? runs : [])]
          .filter((r: TrackingRun) => r.status === 'completed')
          .sort((a: TrackingRun, b: TrackingRun) => b.id - a.id);
        const latestCompleted = completedRuns[0];
        const prevCompleted = completedRuns[1];
        if (!latestCompleted) return { resps: [], prevResps: [], compAnalysis: null };
        return Promise.all([
          getResponses(brandId, latestCompleted.id),
          prevCompleted ? getResponses(brandId, prevCompleted.id) : Promise.resolve([]),
          getCompetitorAnalysis(brandId, latestCompleted.id).catch((err) => { logError(err, 'Reports: fetch competitor analysis'); return null; }),
        ]).then(([resps, prevResps, compAnalysis]) => ({ resps, prevResps, compAnalysis }));
      });

      const [tr, allRuns, detail, runData] = await Promise.all([
        getTrends(brandId),
        runsPromise,
        getBrand(brandId).catch((err) => { logError(err, 'Reports: fetch brand detail'); return null; }),
        runsDataPromise.catch((err) => { logError(err, 'Reports: fetch runs data'); return { resps: [], prevResps: [], compAnalysis: null }; }),
      ]);

      if (signal?.aborted) return;

      const sortedRuns = [...(Array.isArray(allRuns) ? allRuns : [])].sort(
        (a: TrackingRun, b: TrackingRun) => b.id - a.id
      );
      setLatestRun(sortedRuns[0] ?? null);

      setTrends(
        (Array.isArray(tr) ? tr : []).map((p) => ({
          ...p,
          formattedDate: format(parseUTCISO(p.completed_at), 'MMM d'),
          score: Math.round(p.score),
        }))
      );
      setBrandDetail(detail);
      const { resps, prevResps, compAnalysis } = runData as {
        resps: QueryResult[];
        prevResps: QueryResult[];
        compAnalysis: CompetitorAnalysis | null;
      };
      setResponses(Array.isArray(resps) ? resps.filter((r: QueryResult) => r.response_text) : []);
      setPrevResponses(Array.isArray(prevResps) ? prevResps.filter((r: QueryResult) => r.response_text) : []);
      if (compAnalysis?.has_data) setCompetitorAnalysis(compAnalysis);
    } catch { /* ignore */ } finally {
      if (!signal?.aborted) setLoading(false);
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

  const selectedBrand = brands.find((b) => b.id === selectedBrandId);

  async function downloadPDF() {
    if (!selectedBrandId) return;
    setExportingPDF(true);
    try {
      await exportReportPDF(selectedBrandId, 0);
    } catch {
      setToast({ message: 'Failed to generate PDF. Please try again.', type: 'error' });
    } finally {
      setExportingPDF(false);
    }
  }

  function downloadCSV() {
    const groups = buildPromptGroups(responses).sort((a, b) => {
      const pctA = a.total > 0 ? a.mentioned / a.total : -1;
      const pctB = b.total > 0 ? b.mentioned / b.total : -1;
      return pctB - pctA;
    });

    const rows: string[] = [
      ['Prompt', 'Overall %', ...MODEL_ORDER.flatMap((m) => [`${MODEL_CONFIG[m]?.label ?? m} Mentioned`, `${MODEL_CONFIG[m]?.label ?? m} Total`, `${MODEL_CONFIG[m]?.label ?? m} %`])].join(',')
    ];

    for (const g of groups) {
      const overallPct = g.total > 0 ? Math.round((g.mentioned / g.total) * 100) : 0;
      const modelCols = MODEL_ORDER.flatMap((mk) => {
        const ms = g.modelStats.get(mk);
        if (!ms) return ['', '', ''];
        return [String(ms.mentioned), String(ms.total), String(ms.total > 0 ? Math.round((ms.mentioned / ms.total) * 100) : 0)];
      });
      rows.push([`"${g.promptText.replace(/"/g, '""')}"`, overallPct, ...modelCols].join(','));
    }

    const csv = rows.join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${selectedBrand?.name ?? 'report'}-visibility-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const allPromptGroups = buildPromptGroups(responses);
  const prevGroups = buildPromptGroups(prevResponses);

  const promptGroups = allPromptGroups
    .filter((g) => !searchQuery || g.promptText.toLowerCase().includes(searchQuery.toLowerCase()))
    .sort((a, b) => {
      if (sortBy === 'alpha') return a.promptText.localeCompare(b.promptText);
      const pctA = a.total > 0 ? a.mentioned / a.total : -1;
      const pctB = b.total > 0 ? b.mentioned / b.total : -1;
      if (sortBy === 'visibility') return pctB - pctA;
      // biggest change
      const prevPctA = prevGroups.find((g) => g.promptId === a.promptId);
      const prevPctB = prevGroups.find((g) => g.promptId === b.promptId);
      const dA = prevPctA ? Math.abs(pctA * 100 - (prevPctA.total > 0 ? prevPctA.mentioned / prevPctA.total * 100 : 0)) : 0;
      const dB = prevPctB ? Math.abs(pctB * 100 - (prevPctB.total > 0 ? prevPctB.mentioned / prevPctB.total * 100 : 0)) : 0;
      return dB - dA;
    });

  const prevScoreMap = new Map(prevGroups.map((g) => [g.promptId, g.total > 0 ? Math.round((g.mentioned / g.total) * 100) : 0]));
  // Per-model previous scores: promptId → modelKey → pct
  const prevModelScoreMap = new Map(prevGroups.map((g) => {
    const modelMap = new Map<string, number>();
    g.modelStats.forEach((ms, mk) => {
      modelMap.set(mk, ms.total > 0 ? Math.round((ms.mentioned / ms.total) * 100) : 0);
    });
    return [g.promptId, modelMap] as const;
  }));
  const trackedPromptIds = new Set(promptGroups.map((g) => g.promptId));
  const untrackedPrompts: Prompt[] = (brandDetail?.prompts ?? []).filter(
    (p) => !trackedPromptIds.has(p.id)
  );

  return (
    <motion.div
      variants={fadeIn}
      initial="hidden"
      animate="visible"
      className="px-3 sm:px-8 py-4 sm:py-8 max-w-7xl"
    >
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-6">
        <div>
          <h1 className="text-lg sm:text-2xl font-bold text-[var(--text-primary)]">Reports</h1>
          <p className="hidden sm:block text-[13px] text-[var(--text-muted)] mt-1.5">Per-prompt visibility breakdown by AI model</p>
        </div>
        <div className={`flex ${isMobile ? 'flex-col w-full' : 'items-center'} gap-2 md:gap-3`}>
          {responses.length > 0 && (
            <button
              onClick={downloadCSV}
              className={`flex items-center gap-2 bg-[var(--bg-raised)] hover:bg-[var(--bg-card)] border border-[var(--border-subtle)] text-[var(--text-muted)] hover:text-[var(--text-secondary)] rounded-lg px-3 py-2 transition-colors text-xs font-medium ${isMobile ? 'w-full justify-center min-h-[44px]' : ''}`}
              title="Export as CSV"
            >
              <Download size={14} />
              CSV
            </button>
          )}
          {selectedBrandId && (
            <div className={`flex items-center gap-1 ${isMobile ? 'w-full' : ''}`}>
              <button
                onClick={downloadPDF}
                disabled={exportingPDF}
                className={`w-full sm:w-auto flex items-center gap-2 bg-[rgba(95,126,166,0.10)] hover:bg-[rgba(95,126,166,0.16)] border border-[rgba(95,126,166,0.25)] text-[var(--accent-light)] hover:text-[var(--accent-light)] rounded-lg px-3 py-2 transition-colors text-xs font-medium disabled:opacity-60 ${isMobile ? 'flex-1 justify-center min-h-[44px]' : ''}`}
                title="Export as PDF"
              >
                {exportingPDF
                  ? <Loader2 size={14} className="animate-spin" />
                  : <Download size={14} />}
                PDF
              </button>
            </div>
          )}
          <button
            onClick={() => selectedBrandId && loadData(selectedBrandId)}
            disabled={loading}
            className={`flex items-center gap-2 bg-[var(--bg-raised)] hover:bg-[var(--bg-card)] border border-[var(--border-subtle)] text-[var(--text-muted)] hover:text-[var(--text-secondary)] rounded-lg px-3 py-2 transition-colors disabled:opacity-50 ${isMobile ? 'w-full justify-center min-h-[44px]' : ''}`}
          >
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      {loadingBrands ? (
        <div className="space-y-4 animate-pulse">
          <div className="h-48 bg-[var(--bg-raised)] border border-[var(--border-subtle)] rounded-xl" />
          <div className="h-64 bg-[var(--bg-raised)] border border-[var(--border-subtle)] rounded-xl" />
        </div>
      ) : brands.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-24 text-center">
          <div className="w-14 h-14 bg-[var(--accent-muted)] border border-[rgba(95,126,166,0.22)] rounded-2xl flex items-center justify-center mb-4">
            <BarChart2 size={24} className="text-[var(--accent)]" />
          </div>
          <h3 className="text-base font-semibold text-[var(--text-primary)] mb-2">No brands tracked yet</h3>
          <p className="text-sm text-[var(--text-muted)] max-w-sm mb-6">Add a brand and run a report to see prompt visibility data here.</p>
          <Link href="/onboarding" className="flex items-center gap-2 bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-white rounded-lg px-4 py-2 text-sm font-medium transition-colors">
            <Plus size={16} />
            Track Your First Brand
          </Link>
        </div>
      ) : (
        <>
          {/* Trend chart */}
          <div className="mb-4">
            {loading ? (
              <ProgressBanner
                title="Loading report data…"
                subtitle="Pulling latest visibility scores across models."
                items={[
                  { key: 'chatgpt', label: 'ChatGPT', icon: <ModelIcon model="chatgpt" size={18} />, color: 'var(--color-chatgpt)' },
                  { key: 'claude', label: 'Claude', icon: <ModelIcon model="claude" size={18} />, color: 'var(--color-claude)' },
                  { key: 'perplexity', label: 'Perplexity', icon: <ModelIcon model="perplexity" size={18} />, color: 'var(--color-perplexity)' },
                  { key: 'gemini', label: 'Gemini', icon: <ModelIcon model="gemini" size={18} />, color: 'var(--color-gemini)' },
                ]}
              />
            ) : (
              <TrendChart data={trends} />
            )}
          </div>

          {/* Schedule note */}
          <p className="text-xs text-[var(--text-faint)] mb-4 px-1">
            Reports update automatically once daily at 8:00 AM UTC.
          </p>

          {/* Tabs for Prompt Breakdown and Competitor Analysis */}
          <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as 'prompts' | 'competitors')} className="mt-4">
            <TabsList className="bg-[rgba(255,255,255,0.04)] border border-[rgba(95,126,166,0.12)] rounded-lg p-0.5 h-auto gap-0 mb-4">
              <TabsTrigger
                value="prompts"
                className="px-4 py-2 rounded-md text-sm font-medium h-auto data-[state=active]:bg-[rgba(95,126,166,0.25)] data-[state=active]:text-[var(--accent-light)] data-[state=inactive]:text-[var(--text-faint)]"
              >
                Prompt Breakdown
              </TabsTrigger>
              <TabsTrigger
                value="competitors"
                className="px-4 py-2 rounded-md text-sm font-medium h-auto data-[state=active]:bg-[rgba(95,126,166,0.25)] data-[state=active]:text-[var(--accent-light)] data-[state=inactive]:text-[var(--text-faint)]"
              >
                Competitor Analysis
              </TabsTrigger>
            </TabsList>

            <TabsContent key="prompts" value="prompts" className="mt-0">
              <motion.div variants={slideIn} initial="hidden" animate="visible">
          {/* Search + sort controls */}
          {!loading && responses.length > 0 && (
            <div className={`flex ${isMobile ? 'flex-col' : 'flex-wrap items-center'} gap-2 mb-3`}>
              {/* Search */}
              <div className="relative flex-1 min-w-[180px]">
                <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-faint)] pointer-events-none" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search prompts…"
                  className="w-full bg-[var(--bg-raised)] border border-[var(--border-subtle)] text-[var(--text-secondary)] placeholder:text-[var(--text-faint)] rounded-lg pl-8 pr-3 py-2 text-xs focus:outline-none focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--accent)]/50 transition-colors"
                />
              </div>
              {/* Sort */}
              <div className="flex items-center gap-1 bg-[rgba(255,255,255,0.04)] border border-[var(--border-subtle)] rounded-lg p-0.5">
                <ArrowUpDown size={11} className="text-[var(--text-faint)] ml-1.5" />
                {(['visibility', 'alpha', 'change'] as SortBy[]).map((s) => (
                  <button
                    key={s}
                    onClick={() => setSortBy(s)}
                    className={`px-2.5 py-1 rounded-md text-[10px] font-medium transition-[color,background-color] capitalize ${sortBy === s ? 'bg-[rgba(95,126,166,0.25)] text-[var(--accent-light)]' : 'text-[var(--text-faint)] hover:text-[var(--text-secondary)]'}`}
                  >
                    {s === 'visibility' ? 'Visibility %' : s === 'alpha' ? 'A–Z' : 'Biggest Δ'}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Prompt visibility list */}
          <div className="bg-[var(--bg-raised)] border border-[var(--border-subtle)] rounded-xl overflow-hidden shadow-[0_4px_24px_rgba(0,0,0,0.30),inset_0_1px_0_var(--bg-tinted)]">
            <div className="px-5 py-3.5 border-b border-[var(--border-subtle)] bg-[rgba(255,255,255,0.02)] flex items-center justify-between">
              <h3 className="text-[15px] font-medium text-[var(--text-primary)]">Prompt Visibility</h3>
              {!loading && (promptGroups.length + untrackedPrompts.length) > 0 && (
                <span className="text-xs text-[var(--text-muted)]">
                  {searchQuery ? `${promptGroups.length} of ${allPromptGroups.length}` : `${promptGroups.length + untrackedPrompts.length}`} prompt{(promptGroups.length + untrackedPrompts.length) !== 1 ? 's' : ''}
                </span>
              )}
            </div>

            {loading ? (
              <div className="divide-y divide-[var(--bg-tinted)]">
                {[1, 2, 3, 4].map(i => (
                  <div key={i} className="px-5 py-5 animate-pulse">
                    <div className="flex items-start justify-between gap-3 mb-3">
                      <div className="h-4 bg-[var(--bg-tinted)] rounded flex-1" style={{ width: `${55 + (i * 11) % 30}%` }} />
                      <div className="h-5 w-10 bg-[var(--bg-tinted)] rounded flex-shrink-0" />
                    </div>
                    <div className="flex gap-2">
                      {[1, 2, 3, 4].map(j => <div key={j} className="h-7 w-24 bg-[var(--bg-tinted)] rounded-lg" />)}
                    </div>
                  </div>
                ))}
              </div>
            ) : promptGroups.length === 0 && untrackedPrompts.length === 0 ? (
              <div className="px-5 py-12 text-center">
                <div className="w-10 h-10 rounded-xl bg-[var(--accent-muted)] border border-[rgba(95,126,166,0.22)] flex items-center justify-center mx-auto mb-3">
                  <BarChart2 size={18} className="text-[var(--text-faint)]" />
                </div>
                <p className="text-sm font-medium text-[var(--text-secondary)] mb-1">No report data yet</p>
                <p className="text-sm text-[var(--text-faint)]">Run a report from the Dashboard to see prompt visibility.</p>
              </div>
            ) : (
              <div className="divide-y divide-[var(--bg-tinted)]">
                {promptGroups.map((g) => {
                  const overallPct = g.total > 0 ? Math.round((g.mentioned / g.total) * 100) : 0;
                  const overallColor = overallPct >= 60 ? 'var(--success)' : overallPct >= 30 ? 'var(--warning)' : 'var(--danger)';
                  const isExpanded = expandedPromptId === g.promptId;
                  const prevPct = prevScoreMap.get(g.promptId);
                  const delta = prevPct !== undefined ? overallPct - prevPct : null;

                  // Build per-model delta tooltip
                  const prevModelScores = prevModelScoreMap.get(g.promptId);
                  const modelDeltaTooltip = delta !== null && delta !== 0 && prevModelScores
                    ? MODEL_ORDER.flatMap((mk) => {
                        const ms = g.modelStats.get(mk);
                        const prevMs = prevModelScores.get(mk);
                        if (!ms || prevMs === undefined) return [];
                        const curPct = ms.total > 0 ? Math.round((ms.mentioned / ms.total) * 100) : 0;
                        const d = curPct - prevMs;
                        if (d === 0) return [];
                        const cfg = getModelCfg(mk);
                        return [`${cfg.label} ${d > 0 ? '+' : ''}${d}%`];
                      }).join(', ')
                    : '';

                  return (
                    <div key={g.promptId}>
                      <button
                        className="w-full px-5 py-4 hover:bg-[rgba(255,255,255,0.02)] transition-colors text-left"
                        onClick={() => setExpandedPromptId(isExpanded ? null : g.promptId)}
                      >
                        <div className="flex items-start gap-3 mb-3">
                          <p className="text-sm text-[var(--text-secondary)] leading-snug font-medium flex-1">{g.promptText}</p>
                          <div className="flex items-center gap-2 flex-shrink-0">
                            <span className="text-sm font-bold tabular-nums font-mono" style={{ color: overallColor }}>
                              {overallPct}%
                            </span>
                            {delta !== null && delta !== 0 && (
                              <span
                                className={`text-[10px] font-bold cursor-default ${delta > 0 ? 'text-[var(--success)]' : 'text-[var(--danger)]'}`}
                                title={modelDeltaTooltip || undefined}
                              >
                                {delta > 0 ? `+${delta}%` : `${delta}%`}
                              </span>
                            )}
                            <ChevronDown
                              size={14}
                              className={`text-[var(--text-faint)] transition-transform ${isExpanded ? 'rotate-180' : ''}`}
                            />
                          </div>
                        </div>

                        {/* Model breakdown badges */}
                        <div className="flex items-center gap-1.5 flex-wrap">
                          {MODEL_ORDER.map((modelKey) => {
                            const ms = g.modelStats.get(modelKey);
                            const cfg = getModelCfg(modelKey);
                            const pct = ms && ms.total > 0 ? Math.round((ms.mentioned / ms.total) * 100) : null;
                            const mentionColor = pct === null ? 'var(--text-faint)' : pct >= 60 ? 'var(--success)' : pct >= 30 ? 'var(--warning)' : 'var(--danger)';
                            return (
                              <div
                                key={modelKey}
                                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-[var(--border-subtle)] bg-[rgba(255,255,255,0.04)]"
                              >
                                <span className="text-xs font-semibold" style={{ color: pct === null ? 'var(--text-faint)' : cfg.text }}>{cfg.label}</span>
                                <span className="text-[var(--bg-tinted-hover)]">·</span>
                                <span className="text-xs font-bold tabular-nums font-mono" style={{ color: mentionColor }}>{pct !== null ? `${pct}%` : '—'}</span>
                              </div>
                            );
                          })}
                        </div>

                        {/* View details link */}
                        <div className="flex justify-end mt-2.5">
                          <Link
                            href={`/tracker/${selectedBrandId}/prompt/${g.promptId}`}
                            className="flex items-center gap-1 text-[10px] text-[var(--accent-light)] hover:text-[var(--accent)] transition-colors"
                            onClick={(e) => e.stopPropagation()}
                          >
                            View details
                            <ChevronRight size={12} />
                          </Link>
                        </div>

                        {/* Gap explanation */}
                        {overallPct < 50 && selectedBrand && (() => {
                          const competitorNames = competitorAnalysis?.overall.competitors.map((c) => c.name) ?? [];
                          const explanation = extractGapMentions(g, competitorNames);
                          return explanation ? (
                            <p className="text-xs text-[var(--text-faint)] mt-2 italic">{explanation}</p>
                          ) : null;
                        })()}
                      </button>

                      {/* Expanded: individual query responses */}
                      {isExpanded && (
                        <div className="border-t border-[var(--border-subtle)] bg-[rgba(255,255,255,0.02)] divide-y divide-[var(--bg-tinted)]">
                          {g.responses.map((r) => {
                            const cfg = getModelCfg(r.model);
                            return (
                              <div key={r.id} className="px-5 py-4">
                                <div className="flex items-center gap-2 mb-2">
                                  <span
                                    className="text-[10px] font-semibold px-2 py-0.5 rounded-full flex-shrink-0"
                                    style={{ backgroundColor: cfg.bg, color: cfg.text }}
                                  >
                                    {cfg.label}
                                  </span>
                                  <Badge variant={r.mentioned ? "success" : "secondary"} className="flex-shrink-0">
                                    {r.mentioned ? 'Mentioned' : 'Not mentioned'}
                                  </Badge>
                                </div>
                                {r.response_text ? (
                                  <ResponseText
                                    text={r.response_text}
                                    brandName={selectedBrand?.name ?? ''}
                                    competitors={competitorAnalysis?.overall.competitors.map((c) => c.name) ?? []}
                                    className="text-xs text-[var(--text-muted)]"
                                  />
                                ) : (
                                  <p className="text-xs text-[var(--text-faint)] italic">No response text</p>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })}

                {/* Untracked prompts */}
                {untrackedPrompts.map((p) => (
                  <div key={`untracked-${p.id}`} className="px-5 py-4">
                    <div className="flex items-start gap-3 mb-2">
                      <p className="text-sm text-[var(--text-muted)] leading-snug font-medium flex-1">{p.text}</p>
                      <Badge variant="secondary" className="flex-shrink-0">
                        {latestRun?.status === 'running' || latestRun?.status === 'pending' ? 'Tracking now...' : 'Not yet tracked'}
                      </Badge>
                    </div>
                    <p className="text-xs text-[var(--text-faint)]">
                      {latestRun?.status === 'running' || latestRun?.status === 'pending'
                        ? 'Currently being queried across AI models.'
                        : 'Will be included in your next report run.'}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </div>
              </motion.div>
            </TabsContent>

            <TabsContent key="competitors" value="competitors" className="mt-0">
              <motion.div variants={slideIn} initial="hidden" animate="visible">
          {/* Competitors section */}
          {!loading && (!competitorAnalysis || !competitorAnalysis.has_data) && (
            <div className="bg-[var(--bg-raised)] border border-[var(--border-subtle)] rounded-xl p-8 text-center shadow-[0_4px_24px_rgba(0,0,0,0.30)]">
              <div className="w-10 h-10 bg-[rgba(95,126,166,0.10)] border border-[rgba(95,126,166,0.20)] rounded-xl flex items-center justify-center mb-3 mx-auto">
                <BarChart2 size={18} className="text-[var(--accent)]" />
              </div>
              <p className="text-sm font-semibold text-[var(--text-primary)] mb-1">No competitor data yet</p>
              <p className="text-xs text-[var(--text-muted)] max-w-xs mx-auto">Add competitors on the Dashboard to see a side-by-side share-of-voice comparison.</p>
            </div>
          )}
          {competitorAnalysis && competitorAnalysis.has_data && (
            <div className="bg-[var(--bg-raised)] border border-[var(--border-subtle)] rounded-xl overflow-hidden shadow-[0_4px_24px_rgba(0,0,0,0.30),inset_0_1px_0_var(--bg-tinted)]">
              <div className="px-5 py-3.5 border-b border-[var(--border-subtle)] bg-[rgba(255,255,255,0.02)] flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-semibold text-[var(--text-primary)]">Competitor Share of Voice</h3>
                  <p className="text-xs text-[var(--text-muted)] mt-0.5">
                    Overall: {selectedBrand?.name} {competitorAnalysis.overall.brand_pct}%
                    {competitorAnalysis.overall.competitors.map((c) => ` · ${c.name} ${c.pct}%`).join('')}
                  </p>
                </div>
                {/* Model filter toggle */}
                <div className="flex items-center gap-1">
                  {['all', ...MODEL_ORDER].map((mk) => {
                    const cfg = mk === 'all' ? null : getModelCfg(mk);
                    return (
                      <button
                        key={mk}
                        onClick={() => setCompetitorModelFilter(mk)}
                        className={`text-[10px] font-medium px-2 py-1 rounded transition-colors ${
                          competitorModelFilter === mk
                            ? 'bg-[rgba(95,126,166,0.25)] text-[var(--accent-light)]'
                            : 'text-[var(--text-faint)] hover:text-[var(--text-secondary)]'
                        }`}
                        style={cfg && competitorModelFilter === mk ? { color: cfg.text } : {}}
                      >
                        {mk === 'all' ? 'All' : cfg?.label}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Table header */}
              <div className="overflow-x-auto scroll-hint-right">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-[var(--bg-tinted)]">
                      <th className="text-left px-5 py-2.5 text-[var(--text-muted)] font-medium w-1/2">Prompt</th>
                      <th className="text-center px-3 py-2.5 text-[var(--accent)] font-medium whitespace-nowrap">
                        {selectedBrand?.name ?? 'Your Brand'}
                      </th>
                      {competitorAnalysis.prompts[0]?.competitors.map((c) => (
                        <th key={c.name} className="text-center px-3 py-2.5 text-[var(--text-muted)] font-medium whitespace-nowrap">
                          {c.name}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--bg-tinted)]">
                    {competitorAnalysis.prompts.map((row) => {
                      const brandRate = competitorModelFilter === 'all'
                        ? row.brand_rate
                        : (row.brand_by_model[competitorModelFilter] ?? 0);
                      const compRates = row.competitors.map((c) => ({
                        name: c.name,
                        rate: competitorModelFilter === 'all'
                          ? c.rate
                          : (c.by_model[competitorModelFilter] ?? 0),
                      }));
                      const maxRate = Math.max(brandRate, ...compRates.map((c) => c.rate));
                      const brandWins = brandRate >= maxRate && brandRate > 0;
                      const brandLoses = compRates.some((c) => c.rate > brandRate);

                      return (
                        <tr key={row.prompt_id} className="hover:bg-[rgba(255,255,255,0.03)] transition-colors">
                          <td className="px-5 py-3 text-[var(--text-secondary)] leading-snug">
                            <p className="line-clamp-2">{row.prompt_text}</p>
                          </td>
                          <td className="px-3 py-3 text-center">
                            <span
                              className="font-bold tabular-nums font-mono text-sm"
                              style={{
                                color: brandWins ? 'var(--success)' : brandLoses ? 'var(--danger)' : 'var(--text-secondary)',
                              }}
                            >
                              {Math.round(brandRate)}%
                            </span>
                          </td>
                          {compRates.map((c) => {
                            const compWins = c.rate > brandRate;
                            return (
                              <td key={c.name} className="px-3 py-3 text-center">
                                <span
                                  className="font-medium tabular-nums font-mono"
                                  style={{ color: compWins ? 'var(--danger)' : 'var(--text-muted)' }}
                                >
                                  {Math.round(c.rate)}%
                                </span>
                              </td>
                            );
                          })}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
              {loading && (
                <div className="bg-[var(--bg-raised)] border border-[var(--border-subtle)] rounded-xl p-6 animate-pulse">
                  <div className="h-5 bg-[var(--bg-tinted)] rounded w-48 mb-4" />
                  <div className="h-32 bg-[var(--bg-tinted)] rounded-lg" />
                </div>
              )}
              </motion.div>
            </TabsContent>
          </Tabs>
        </>
      )}
      {toast && <AppToast {...toast} onDismiss={() => setToast(null)} />}
    </motion.div>
  );
}
