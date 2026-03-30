'use client';

import { useEffect, useState, useRef, useCallback } from 'react';
import {
  BarChart2,
  ChevronDown,
  Building2,
  Loader2,
  RefreshCw,
  Download,
  Search,
  ArrowUpDown,
} from 'lucide-react';
import {
  getBrand,
  getTrends,
  getResponses,
  getRecentRuns,
  exportReportPDF,
  getCaseStudyEligibility,
  exportCaseStudyPDF,
  getCompetitorAnalysis,
  Brand,
  BrandDetail,
  TrendPoint,
  QueryResult,
  TrackingRun,
  Prompt,
  CompetitorAnalysis,
  CaseStudyEligibility,
} from '@/lib/api';
import TrendChart from '@/components/TrendChart';
import { useBrand } from '@/contexts/BrandContext';
import { format, parseISO } from 'date-fns';
import { Badge } from '@/components/ui/badge';

const parseUTCISO = (s: string) => parseISO(s.endsWith('Z') ? s : s + 'Z');

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
    const matches = text.match(/\b[A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+){0,2}\b/g) ?? [];
    const seen = new Set<string>();
    for (const m of matches) {
      const lower = m.toLowerCase();
      if (lower === brandLower || lower.split(' ').every((w) => STOPWORDS.has(w)) || m.length < 3) continue;
      if (!m.includes(' ') && STOPWORDS.has(lower)) continue;
      if (!seen.has(lower)) {
        seen.add(lower);
        counts.set(m, (counts.get(m) ?? 0) + 1);
      }
    }
  }
  if (counts.size === 0) return '';
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

const MODEL_ORDER_REPORT = ['chatgpt', 'claude', 'perplexity', 'gemini'];

type SortBy = 'visibility' | 'alpha' | 'change';

export default function ReportsPage() {
  const { brands, activeBrandId: selectedBrandId, loading: loadingBrands, setActiveBrandId: setSelectedBrandId } = useBrand();
  const [brandDetail, setBrandDetail] = useState<BrandDetail | null>(null);
  const [trends, setTrends] = useState<(TrendPoint & { formattedDate: string; score: number })[]>([]);
  const [responses, setResponses] = useState<QueryResult[]>([]);
  const [prevResponses, setPrevResponses] = useState<QueryResult[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState<SortBy>('visibility');
  const [loading, setLoading] = useState(false);
  const [expandedPromptId, setExpandedPromptId] = useState<number | null>(null);
  const [brandDropdownOpen, setBrandDropdownOpen] = useState(false);
  const [exportingPDF, setExportingPDF] = useState(false);
  const [caseStudyEligibility, setCaseStudyEligibility] = useState<CaseStudyEligibility | null>(null);
  const [exportingCaseStudy, setExportingCaseStudy] = useState(false);
  const [competitorAnalysis, setCompetitorAnalysis] = useState<CompetitorAnalysis | null>(null);
  const [competitorModelFilter, setCompetitorModelFilter] = useState<string>('all');
  const brandDropdownRef = useRef<HTMLDivElement>(null);
  const loadAbortRef = useRef<AbortController | null>(null);

  // Close brand dropdown on outside click
  useEffect(() => { document.title = 'Reports — Lumidian'; }, []);

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (brandDropdownRef.current && !brandDropdownRef.current.contains(e.target as Node)) {
        setBrandDropdownOpen(false);
      }
    }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);


  const loadData = useCallback(async (brandId: number, signal?: AbortSignal) => {
    setLoading(true);
    setTrends([]);
    setResponses([]);
    setPrevResponses([]);
    setExpandedPromptId(null);
    setBrandDetail(null);
    setCompetitorAnalysis(null);
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
          getCompetitorAnalysis(brandId, latestCompleted.id).catch(() => null),
        ]).then(([resps, prevResps, compAnalysis]) => ({ resps, prevResps, compAnalysis }));
      });

      const [tr, , detail, runData] = await Promise.all([
        getTrends(brandId),
        runsPromise,
        getBrand(brandId).catch(() => null),
        runsDataPromise.catch(() => ({ resps: [], prevResps: [], compAnalysis: null })),
      ]);

      if (signal?.aborted) return;

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
      // Check case study eligibility
      getCaseStudyEligibility(brandId).then(setCaseStudyEligibility).catch(() => {});
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
      alert('Failed to generate PDF. Please try again.');
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
    <div className="px-4 sm:px-8 py-6 sm:py-8 max-w-5xl">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-6">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-[#F0F4F8]">Reports</h1>
          <p className="text-[13px] text-[#64748B] mt-1.5">Per-prompt visibility breakdown by AI model</p>
        </div>
        <div className="flex items-center gap-3">
          {/* Brand selector */}
          {!loadingBrands && brands.length > 1 && (
            <div className="relative" ref={brandDropdownRef}>
              <button
                onClick={() => setBrandDropdownOpen((v) => !v)}
                className="flex items-center gap-2 bg-[rgba(99,102,241,0.06)] hover:bg-[rgba(99,102,241,0.09)] border border-[rgba(99,102,241,0.22)] text-[#94A3B8] rounded-lg px-3 py-2 text-sm transition-colors"
              >
                <Building2 size={14} />
                <span>{selectedBrand?.name ?? 'Select brand'}</span>
                <ChevronDown size={14} />
              </button>
              {brandDropdownOpen && (
                <div className="absolute right-0 mt-1 w-52 bg-[rgba(10,14,24,0.96)] border border-[rgba(99,102,241,0.22)] rounded-xl shadow-xl z-20 overflow-hidden backdrop-blur-xl">
                  {brands.map((b) => (
                    <button
                      key={b.id}
                      onClick={() => { setSelectedBrandId(b.id); setBrandDropdownOpen(false); }}
                      className={`w-full text-left px-4 py-2.5 text-sm transition-colors ${b.id === selectedBrandId ? 'text-[#818CF8] bg-[rgba(99,102,241,0.12)]' : 'text-[#94A3B8] hover:bg-[rgba(255,255,255,0.06)]'}`}
                    >
                      {b.name}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
          {responses.length > 0 && (
            <button
              onClick={downloadCSV}
              className="flex items-center gap-2 bg-[rgba(99,102,241,0.06)] hover:bg-[rgba(99,102,241,0.09)] border border-[rgba(99,102,241,0.22)] text-[#64748B] hover:text-[#94A3B8] rounded-lg px-3 py-2 transition-colors text-xs font-medium"
              title="Export as CSV"
            >
              <Download size={14} />
              CSV
            </button>
          )}
          {selectedBrandId && (
            <div className="flex items-center gap-1">
              <button
                onClick={downloadPDF}
                disabled={exportingPDF}
                className="flex items-center gap-2 bg-[rgba(99,102,241,0.10)] hover:bg-[rgba(99,102,241,0.16)] border border-[rgba(99,102,241,0.25)] text-[#818cf8] hover:text-[#a5b4fc] rounded-lg px-3 py-2 transition-colors text-xs font-medium disabled:opacity-60"
                title="Export as PDF"
              >
                {exportingPDF
                  ? <Loader2 size={14} className="animate-spin" />
                  : <Download size={14} />}
                PDF
              </button>
              {caseStudyEligibility?.eligible && (
                <button
                  onClick={async () => {
                    if (!selectedBrandId) return;
                    setExportingCaseStudy(true);
                    try { await exportCaseStudyPDF(selectedBrandId); }
                    catch { alert('Failed to generate case study. Please try again.'); }
                    finally { setExportingCaseStudy(false); }
                  }}
                  disabled={exportingCaseStudy}
                  className="flex items-center gap-2 bg-[rgba(16,185,129,0.10)] hover:bg-[rgba(16,185,129,0.16)] border border-[rgba(16,185,129,0.25)] text-[#34d399] hover:text-[#6ee7b7] rounded-lg px-3 py-2 transition-colors text-xs font-medium disabled:opacity-60"
                  title="Export 90-day case study PDF"
                >
                  {exportingCaseStudy ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
                  Case Study
                </button>
              )}
            </div>
          )}
          <button
            onClick={() => selectedBrandId && loadData(selectedBrandId)}
            disabled={loading}
            className="flex items-center gap-2 bg-[rgba(99,102,241,0.06)] hover:bg-[rgba(99,102,241,0.09)] border border-[rgba(99,102,241,0.22)] text-[#64748B] hover:text-[#94A3B8] rounded-lg px-3 py-2 transition-colors disabled:opacity-50"
          >
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      {loadingBrands ? (
        <div className="space-y-4 animate-pulse">
          <div className="h-48 bg-[rgba(99,102,241,0.06)] border border-[rgba(99,102,241,0.22)] rounded-xl" />
          <div className="h-64 bg-[rgba(99,102,241,0.06)] border border-[rgba(99,102,241,0.22)] rounded-xl" />
        </div>
      ) : brands.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-24 text-center">
          <div className="w-14 h-14 bg-[rgba(99,102,241,0.08)] border border-[rgba(99,102,241,0.22)] rounded-2xl flex items-center justify-center mb-4">
            <BarChart2 size={24} className="text-[#6366f1]" />
          </div>
          <h3 className="text-base font-semibold text-[#F0F4F8] mb-2">No brands tracked yet</h3>
          <p className="text-sm text-[#64748B] max-w-sm">Add a brand and run a report to see prompt visibility data here.</p>
        </div>
      ) : (
        <>
          {/* Trend chart */}
          <div className="mb-4">
            {loading ? (
              <div className="bg-[rgba(99,102,241,0.06)] backdrop-blur-md border border-[rgba(99,102,241,0.22)] rounded-xl p-6 shadow-[0_4px_24px_rgba(0,0,0,0.30)] animate-pulse">
                <div className="h-5 bg-[rgba(255,255,255,0.06)] rounded w-32 mb-4" />
                <div className="h-48 bg-[rgba(255,255,255,0.06)] rounded-lg" />
              </div>
            ) : (
              <TrendChart data={trends} />
            )}
          </div>

          {/* Schedule note */}
          <p className="text-xs text-[#475569] mb-4 px-1">
            Reports update automatically once daily at 8:00 AM UTC.
          </p>

          {/* Search + sort controls */}
          {!loading && responses.length > 0 && (
            <div className="flex flex-wrap items-center gap-2 mb-3">
              {/* Search */}
              <div className="relative flex-1 min-w-[180px]">
                <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#475569] pointer-events-none" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search prompts…"
                  className="w-full bg-[rgba(99,102,241,0.06)] border border-[rgba(99,102,241,0.22)] text-[#94A3B8] placeholder:text-[#475569] rounded-lg pl-8 pr-3 py-2 text-xs focus:outline-none focus:border-[#6366f1] transition-colors"
                />
              </div>
              {/* Sort */}
              <div className="flex items-center gap-1 bg-[rgba(255,255,255,0.04)] border border-[rgba(99,102,241,0.12)] rounded-lg p-0.5">
                <ArrowUpDown size={11} className="text-[#475569] ml-1.5" />
                {(['visibility', 'alpha', 'change'] as SortBy[]).map((s) => (
                  <button
                    key={s}
                    onClick={() => setSortBy(s)}
                    className={`px-2.5 py-1 rounded-md text-[10px] font-medium transition-all capitalize ${sortBy === s ? 'bg-[rgba(99,102,241,0.25)] text-[#818cf8]' : 'text-[#475569] hover:text-[#94A3B8]'}`}
                  >
                    {s === 'visibility' ? 'Visibility %' : s === 'alpha' ? 'A–Z' : 'Biggest Δ'}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Live / Index score summary */}
          {!loading && responses.length > 0 && (() => {
            const liveR = responses.filter(r => r.model === 'perplexity' || r.model === 'gemini');
            const indexR = responses.filter(r => r.model === 'chatgpt' || r.model === 'claude');
            const liveS = liveR.length > 0 ? Math.round(liveR.filter(r => r.mentioned).length / liveR.length * 100) : null;
            const indexS = indexR.length > 0 ? Math.round(indexR.filter(r => r.mentioned).length / indexR.length * 100) : null;
            if (liveS === null && indexS === null) return null;
            return (
              <div className="mb-4 bg-[rgba(99,102,241,0.06)] border border-[rgba(99,102,241,0.22)] rounded-xl px-5 py-4 shadow-[0_4px_24px_rgba(0,0,0,0.20)]">
                <p className="text-[11px] font-semibold text-[#64748B] uppercase tracking-wider mb-3">Score Breakdown</p>
                <div className="grid grid-cols-2 gap-4">
                  {([
                    { label: 'Live Search', s: liveS,  models: 'Perplexity · Gemini',  color: '#10b981' },
                    { label: 'AI Index',    s: indexS, models: 'GPT-4o-mini · Claude', color: '#818cf8' },
                  ] as Array<{ label: string; s: number | null; models: string; color: string }>).map(({ label, s, models, color }) => (
                    <div key={label}>
                      <div className="flex items-center justify-between mb-1.5">
                        <div className="flex items-center gap-1.5">
                          <span className="w-1.5 h-1.5 rounded-full" style={{ background: color }} />
                          <span className="text-xs font-medium text-[#94A3B8]">{label}</span>
                        </div>
                        <span className="text-sm font-bold tabular-nums" style={{ color }}>
                          {s !== null ? `${s}%` : '—'}
                        </span>
                      </div>
                      <div className="h-1.5 bg-[rgba(255,255,255,0.08)] rounded-full overflow-hidden">
                        <div className="h-full rounded-full transition-all" style={{ width: `${s ?? 0}%`, background: color }} />
                      </div>
                      <p className="text-[10px] text-[#475569] mt-1">{models}</p>
                    </div>
                  ))}
                </div>
                {liveS !== null && indexS !== null && (
                  <p className="text-[11px] text-[#64748B] italic mt-3 border-t border-[rgba(255,255,255,0.05)] pt-2.5">
                    {liveS >= 50 && indexS >= 50
                      ? 'Strong across both live search and AI knowledge.'
                      : liveS >= 50 && indexS < 50
                        ? 'Trending online — not yet embedded in AI training data.'
                        : liveS < 50 && indexS >= 50
                          ? 'AI-recognized brand — boost recent content for live visibility.'
                          : 'Low visibility across channels — more content and coverage needed.'}
                  </p>
                )}
              </div>
            );
          })()}

          {/* Prompt visibility list */}
          <div className="bg-[rgba(99,102,241,0.06)] backdrop-blur-md border border-[rgba(99,102,241,0.22)] rounded-xl overflow-hidden shadow-[0_4px_24px_rgba(0,0,0,0.30),inset_0_1px_0_rgba(255,255,255,0.06)]">
            <div className="px-5 py-3.5 border-b border-[rgba(99,102,241,0.12)] bg-[rgba(99,102,241,0.05)] flex items-center justify-between">
              <h3 className="text-[15px] font-medium text-[#F0F4F8]">Prompt Visibility</h3>
              {!loading && (promptGroups.length + untrackedPrompts.length) > 0 && (
                <span className="text-xs text-[#64748B]">
                  {searchQuery ? `${promptGroups.length} of ${allPromptGroups.length}` : `${promptGroups.length + untrackedPrompts.length}`} prompt{(promptGroups.length + untrackedPrompts.length) !== 1 ? 's' : ''}
                </span>
              )}
            </div>

            {loading ? (
              <div className="divide-y divide-[rgba(99,102,241,0.10)]">
                {[1, 2, 3, 4].map(i => (
                  <div key={i} className="px-5 py-5 animate-pulse">
                    <div className="flex items-start justify-between gap-3 mb-3">
                      <div className="h-4 bg-[rgba(255,255,255,0.06)] rounded flex-1" style={{ width: `${55 + (i * 11) % 30}%` }} />
                      <div className="h-5 w-10 bg-[rgba(255,255,255,0.06)] rounded flex-shrink-0" />
                    </div>
                    <div className="flex gap-2">
                      {[1, 2, 3, 4].map(j => <div key={j} className="h-7 w-24 bg-[rgba(255,255,255,0.06)] rounded-lg" />)}
                    </div>
                  </div>
                ))}
              </div>
            ) : promptGroups.length === 0 && untrackedPrompts.length === 0 ? (
              <div className="px-5 py-12 text-center">
                <div className="w-10 h-10 rounded-xl bg-[rgba(99,102,241,0.06)] border border-[rgba(99,102,241,0.12)] flex items-center justify-center mx-auto mb-3">
                  <BarChart2 size={18} className="text-[#475569]" />
                </div>
                <p className="text-sm font-medium text-[#94A3B8] mb-1">No report data yet</p>
                <p className="text-sm text-[#475569]">Run a report from the Dashboard to see prompt visibility.</p>
              </div>
            ) : (
              <div className="divide-y divide-[rgba(99,102,241,0.10)]">
                {promptGroups.map((g) => {
                  const overallPct = g.total > 0 ? Math.round((g.mentioned / g.total) * 100) : 0;
                  const overallColor = overallPct >= 60 ? '#10b981' : overallPct >= 30 ? '#f59e0b' : '#ef4444';
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
                        className="w-full px-5 py-4 hover:bg-[rgba(99,102,241,0.05)] transition-colors text-left"
                        onClick={() => setExpandedPromptId(isExpanded ? null : g.promptId)}
                      >
                        <div className="flex items-start gap-3 mb-3">
                          <p className="text-sm text-[#94A3B8] leading-snug font-medium flex-1">{g.promptText}</p>
                          <div className="flex items-center gap-2 flex-shrink-0">
                            <span className="text-sm font-bold tabular-nums" style={{ color: overallColor }}>
                              {overallPct}%
                            </span>
                            {delta !== null && delta !== 0 && (
                              <span
                                className={`text-[10px] font-bold cursor-default ${delta > 0 ? 'text-[#10b981]' : 'text-[#f87171]'}`}
                                title={modelDeltaTooltip || undefined}
                              >
                                {delta > 0 ? `+${delta}%` : `${delta}%`}
                              </span>
                            )}
                            <ChevronDown
                              size={14}
                              className={`text-[#475569] transition-transform ${isExpanded ? 'rotate-180' : ''}`}
                            />
                          </div>
                        </div>

                        {/* Model breakdown badges — grouped by Live Search / AI Index */}
                        <div className="flex flex-col gap-1.5">
                          {([
                            { category: 'Live', models: ['perplexity', 'gemini'], color: '#10b981' },
                            { category: 'Index', models: ['chatgpt', 'claude'],   color: '#818cf8' },
                          ] as Array<{ category: string; models: string[]; color: string }>).map(({ category, models: catModels, color }) => (
                            <div key={category} className="flex items-center gap-2">
                              <span
                                className="text-[9px] font-bold uppercase tracking-wider flex-shrink-0 w-9"
                                style={{ color }}
                              >
                                {category}
                              </span>
                              <div className="flex items-center gap-1.5 flex-wrap">
                                {catModels.map(modelKey => {
                                  const ms = g.modelStats.get(modelKey);
                                  const cfg = getModelCfg(modelKey);
                                  const pct = ms && ms.total > 0 ? Math.round((ms.mentioned / ms.total) * 100) : null;
                                  const mentionColor = pct === null ? '#475569' : pct >= 60 ? '#10b981' : pct >= 30 ? '#f59e0b' : '#ef4444';
                                  return (
                                    <div
                                      key={modelKey}
                                      className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-[rgba(99,102,241,0.22)] bg-[rgba(99,102,241,0.06)]"
                                    >
                                      <span className="text-xs font-semibold" style={{ color: pct === null ? '#475569' : cfg.text }}>{cfg.label}</span>
                                      <span className="text-[rgba(255,255,255,0.10)]">·</span>
                                      <span className="text-xs font-bold tabular-nums" style={{ color: mentionColor }}>{pct !== null ? `${pct}%` : '—'}</span>
                                    </div>
                                  );
                                })}
                              </div>
                            </div>
                          ))}
                        </div>

                        {/* Gap explanation */}
                        {overallPct < 50 && selectedBrand && (() => {
                          const explanation = extractGapMentions(g, selectedBrand.name);
                          return explanation ? (
                            <p className="text-xs text-[#475569] mt-2 italic">{explanation}</p>
                          ) : null;
                        })()}
                      </button>

                      {/* Expanded: individual query responses */}
                      {isExpanded && (
                        <div className="border-t border-[rgba(99,102,241,0.12)] bg-[rgba(99,102,241,0.04)] divide-y divide-[rgba(99,102,241,0.10)]">
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
                                <Badge variant={r.mentioned ? "success" : "secondary"} className="flex-shrink-0">
                                  {r.mentioned ? 'Mentioned' : 'Not mentioned'}
                                </Badge>
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
                      <p className="text-sm text-[#64748B] leading-snug font-medium flex-1">{p.text}</p>
                      <Badge variant="secondary" className="flex-shrink-0">
                        Not yet tracked
                      </Badge>
                    </div>
                    <p className="text-xs text-[#475569]">Will be included in your next report run.</p>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Competitors section */}
          {!loading && competitorAnalysis && !competitorAnalysis.has_data && (
            <div className="mt-4 bg-[rgba(99,102,241,0.06)] backdrop-blur-md border border-[rgba(99,102,241,0.22)] rounded-xl p-8 text-center shadow-[0_4px_24px_rgba(0,0,0,0.30)]">
              <div className="w-10 h-10 bg-[rgba(99,102,241,0.10)] border border-[rgba(99,102,241,0.20)] rounded-xl flex items-center justify-center mb-3 mx-auto">
                <BarChart2 size={18} className="text-[#6366f1]" />
              </div>
              <p className="text-sm font-semibold text-[#CBD5E1] mb-1">No competitor data yet</p>
              <p className="text-xs text-[#64748B] max-w-xs mx-auto">Add competitors on the Dashboard to see a side-by-side share-of-voice comparison.</p>
            </div>
          )}
          {competitorAnalysis && competitorAnalysis.has_data && (
            <div className="mt-4 bg-[rgba(99,102,241,0.06)] backdrop-blur-md border border-[rgba(99,102,241,0.22)] rounded-xl overflow-hidden shadow-[0_4px_24px_rgba(0,0,0,0.30),inset_0_1px_0_rgba(255,255,255,0.06)]">
              <div className="px-5 py-3.5 border-b border-[rgba(99,102,241,0.12)] bg-[rgba(99,102,241,0.05)] flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-semibold text-[#F0F4F8]">Competitor Share of Voice</h3>
                  <p className="text-xs text-[#64748B] mt-0.5">
                    Overall: {selectedBrand?.name} {competitorAnalysis.overall.brand_pct}%
                    {competitorAnalysis.overall.competitors.map((c) => ` · ${c.name} ${c.pct}%`).join('')}
                  </p>
                </div>
                {/* Model filter toggle */}
                <div className="flex items-center gap-1">
                  {['all', ...MODEL_ORDER_REPORT].map((mk) => {
                    const cfg = mk === 'all' ? null : getModelCfg(mk);
                    return (
                      <button
                        key={mk}
                        onClick={() => setCompetitorModelFilter(mk)}
                        className={`text-[10px] font-medium px-2 py-1 rounded transition-colors ${
                          competitorModelFilter === mk
                            ? 'bg-[rgba(99,102,241,0.25)] text-[#818cf8]'
                            : 'text-[#475569] hover:text-[#94A3B8]'
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
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-[rgba(99,102,241,0.10)]">
                      <th className="text-left px-5 py-2.5 text-[#64748B] font-medium w-1/2">Prompt</th>
                      <th className="text-center px-3 py-2.5 text-[#6366f1] font-medium whitespace-nowrap">
                        {selectedBrand?.name ?? 'Your Brand'}
                      </th>
                      {competitorAnalysis.prompts[0]?.competitors.map((c) => (
                        <th key={c.name} className="text-center px-3 py-2.5 text-[#64748B] font-medium whitespace-nowrap">
                          {c.name}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[rgba(99,102,241,0.08)]">
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
                        <tr key={row.prompt_id} className="hover:bg-[rgba(99,102,241,0.04)] transition-colors">
                          <td className="px-5 py-3 text-[#94A3B8] leading-snug">
                            <p className="line-clamp-2">{row.prompt_text}</p>
                          </td>
                          <td className="px-3 py-3 text-center">
                            <span
                              className="font-bold tabular-nums text-sm"
                              style={{
                                color: brandWins ? '#10b981' : brandLoses ? '#f87171' : '#94A3B8',
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
                                  className="font-medium tabular-nums"
                                  style={{ color: compWins ? '#ef4444' : '#64748B' }}
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
        </>
      )}
    </div>
  );
}
