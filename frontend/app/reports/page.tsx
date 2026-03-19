'use client';

import { useEffect, useState, useRef, useCallback } from 'react';
import {
  BarChart2,
  ChevronDown,
  Building2,
  Loader2,
  RefreshCw,
  Download,
} from 'lucide-react';
import {
  getBrands,
  getBrand,
  getTrends,
  getResponses,
  getRecentRuns,
  Brand,
  BrandDetail,
  TrendPoint,
  QueryResult,
  TrackingRun,
  Prompt,
} from '@/lib/api';
import TrendChart from '@/components/TrendChart';
import { format, parseISO } from 'date-fns';

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

export default function ReportsPage() {
  const [brands, setBrands] = useState<Brand[]>([]);
  const [selectedBrandId, setSelectedBrandId] = useState<number | null>(null);
  const [loadingBrands, setLoadingBrands] = useState(true);
  const [brandDetail, setBrandDetail] = useState<BrandDetail | null>(null);
  const [trends, setTrends] = useState<(TrendPoint & { formattedDate: string; score: number })[]>([]);
  const [responses, setResponses] = useState<QueryResult[]>([]);
  const [prevResponses, setPrevResponses] = useState<QueryResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [expandedPromptId, setExpandedPromptId] = useState<number | null>(null);
  const [brandDropdownOpen, setBrandDropdownOpen] = useState(false);
  const brandDropdownRef = useRef<HTMLDivElement>(null);

  // Close brand dropdown on outside click
  useEffect(() => {
    function handler(e: MouseEvent) {
      if (brandDropdownRef.current && !brandDropdownRef.current.contains(e.target as Node)) {
        setBrandDropdownOpen(false);
      }
    }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  useEffect(() => {
    getBrands().then((b) => {
      setBrands(b);
      if (b.length > 0) setSelectedBrandId(b[0].id);
      setLoadingBrands(false);
    }).catch(() => setLoadingBrands(false));
  }, []);

  const loadData = useCallback(async (brandId: number) => {
    setLoading(true);
    setTrends([]);
    setResponses([]);
    setPrevResponses([]);
    setExpandedPromptId(null);
    setBrandDetail(null);
    try {
      const [tr, runs, detail] = await Promise.all([
        getTrends(brandId),
        getRecentRuns(brandId),
        getBrand(brandId).catch(() => null),
      ]);
      setTrends(
        (Array.isArray(tr) ? tr : []).map((p) => ({
          ...p,
          formattedDate: format(parseUTCISO(p.completed_at), 'MMM d'),
          score: Math.round(p.score),
        }))
      );
      setBrandDetail(detail);
      const normalizedRuns = Array.isArray(runs) ? runs : [];
      const completedRuns = [...normalizedRuns]
        .filter((r: TrackingRun) => r.status === 'completed')
        .sort((a: TrackingRun, b: TrackingRun) => b.id - a.id);
      const latestCompleted = completedRuns[0];
      const prevCompleted = completedRuns[1];
      if (latestCompleted) {
        const fetchLatest = getResponses(brandId, latestCompleted.id);
        const fetchPrev = prevCompleted ? getResponses(brandId, prevCompleted.id) : Promise.resolve([]);
        const [resps, prevResps] = await Promise.all([fetchLatest, fetchPrev]);
        setResponses(
          Array.isArray(resps)
            ? resps.filter((r) => r.error !== 'api_key_not_configured')
            : []
        );
        setPrevResponses(
          Array.isArray(prevResps)
            ? prevResps.filter((r) => r.error !== 'api_key_not_configured')
            : []
        );
      }
    } catch { /* ignore */ } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!selectedBrandId) return;
    loadData(selectedBrandId);
  }, [selectedBrandId, loadData]);

  const selectedBrand = brands.find((b) => b.id === selectedBrandId);

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
        return [ms.mentioned, ms.total, ms.total > 0 ? Math.round((ms.mentioned / ms.total) * 100) : 0];
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

  const promptGroups = buildPromptGroups(responses).sort((a, b) => {
    const pctA = a.total > 0 ? a.mentioned / a.total : -1;
    const pctB = b.total > 0 ? b.mentioned / b.total : -1;
    return pctB - pctA;
  });

  const prevGroups = buildPromptGroups(prevResponses);
  const prevScoreMap = new Map(prevGroups.map((g) => [g.promptId, g.total > 0 ? Math.round((g.mentioned / g.total) * 100) : 0]));
  const trackedPromptIds = new Set(promptGroups.map((g) => g.promptId));
  const untrackedPrompts: Prompt[] = (brandDetail?.prompts ?? []).filter(
    (p) => !trackedPromptIds.has(p.id)
  );

  return (
    <div className="px-8 py-8 max-w-5xl">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-[#F0F4F8]">Reports</h1>
          <p className="text-sm text-[#64748B] mt-1">Per-prompt visibility breakdown by AI model</p>
        </div>
        <div className="flex items-center gap-3">
          {/* Brand selector */}
          {!loadingBrands && brands.length > 1 && (
            <div className="relative" ref={brandDropdownRef}>
              <button
                onClick={() => setBrandDropdownOpen((v) => !v)}
                className="flex items-center gap-2 bg-[rgba(99,102,241,0.06)] hover:bg-[rgba(99,102,241,0.09)] border border-[rgba(99,102,241,0.15)] text-[#94A3B8] rounded-lg px-3 py-2 text-sm transition-colors"
              >
                <Building2 size={14} />
                <span>{selectedBrand?.name ?? 'Select brand'}</span>
                <ChevronDown size={14} />
              </button>
              {brandDropdownOpen && (
                <div className="absolute right-0 mt-1 w-52 bg-[rgba(10,14,24,0.96)] border border-[rgba(99,102,241,0.15)] rounded-xl shadow-xl z-20 overflow-hidden backdrop-blur-xl">
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
              className="flex items-center gap-2 bg-[rgba(99,102,241,0.06)] hover:bg-[rgba(99,102,241,0.09)] border border-[rgba(99,102,241,0.15)] text-[#64748B] hover:text-[#94A3B8] rounded-lg px-3 py-2 transition-colors text-xs font-medium"
              title="Export as CSV"
            >
              <Download size={14} />
              Export
            </button>
          )}
          <button
            onClick={() => selectedBrandId && loadData(selectedBrandId)}
            disabled={loading}
            className="flex items-center gap-2 bg-[rgba(99,102,241,0.06)] hover:bg-[rgba(99,102,241,0.09)] border border-[rgba(99,102,241,0.15)] text-[#64748B] hover:text-[#94A3B8] rounded-lg px-3 py-2 transition-colors disabled:opacity-50"
          >
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      {loadingBrands ? (
        <div className="space-y-4 animate-pulse">
          <div className="h-48 bg-[rgba(99,102,241,0.06)] border border-[rgba(99,102,241,0.15)] rounded-xl" />
          <div className="h-64 bg-[rgba(99,102,241,0.06)] border border-[rgba(99,102,241,0.15)] rounded-xl" />
        </div>
      ) : brands.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-24 text-center">
          <div className="w-14 h-14 bg-[rgba(99,102,241,0.08)] border border-[rgba(99,102,241,0.15)] rounded-2xl flex items-center justify-center mb-4">
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
              <div className="bg-[rgba(99,102,241,0.06)] backdrop-blur-md border border-[rgba(99,102,241,0.15)] rounded-xl p-6 shadow-[0_4px_24px_rgba(0,0,0,0.30)] animate-pulse">
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

          {/* Prompt visibility list */}
          <div className="bg-[rgba(99,102,241,0.06)] backdrop-blur-md border border-[rgba(99,102,241,0.15)] rounded-xl overflow-hidden shadow-[0_4px_24px_rgba(0,0,0,0.30),inset_0_1px_0_rgba(255,255,255,0.06)]">
            <div className="px-5 py-3.5 border-b border-[rgba(99,102,241,0.12)] bg-[rgba(99,102,241,0.05)] flex items-center justify-between">
              <h3 className="text-sm font-semibold text-[#F0F4F8]">Prompt Visibility</h3>
              {!loading && (promptGroups.length + untrackedPrompts.length) > 0 && (
                <span className="text-xs text-[#64748B]">
                  {promptGroups.length + untrackedPrompts.length} prompt{(promptGroups.length + untrackedPrompts.length) !== 1 ? 's' : ''}
                </span>
              )}
            </div>

            {loading ? (
              <div className="divide-y divide-[rgba(99,102,241,0.10)]">
                {[1, 2, 3].map(i => (
                  <div key={i} className="px-5 py-5 animate-pulse">
                    <div className="h-4 bg-[rgba(255,255,255,0.06)] rounded w-3/4 mb-3" />
                    <div className="flex gap-2">
                      {[1, 2, 3, 4].map(j => <div key={j} className="h-7 w-28 bg-[rgba(255,255,255,0.06)] rounded-lg" />)}
                    </div>
                  </div>
                ))}
              </div>
            ) : promptGroups.length === 0 && untrackedPrompts.length === 0 ? (
              <div className="px-5 py-12 text-center text-[#475569] text-sm">
                No report data yet. Run a report from the Dashboard to see prompt visibility.
              </div>
            ) : (
              <div className="divide-y divide-[rgba(99,102,241,0.10)]">
                {promptGroups.map((g) => {
                  const overallPct = g.total > 0 ? Math.round((g.mentioned / g.total) * 100) : 0;
                  const overallColor = overallPct >= 60 ? '#10b981' : overallPct >= 30 ? '#f59e0b' : '#ef4444';
                  const isExpanded = expandedPromptId === g.promptId;
                  const prevPct = prevScoreMap.get(g.promptId);
                  const delta = prevPct !== undefined ? overallPct - prevPct : null;

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
                              <span className={`text-[10px] font-bold ${delta > 0 ? 'text-[#10b981]' : 'text-[#f87171]'}`}>
                                {delta > 0 ? `+${delta}` : delta}
                              </span>
                            )}
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
                                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-[rgba(99,102,241,0.15)] bg-[rgba(99,102,241,0.06)]"
                              >
                                <span className="text-xs font-semibold" style={{ color: cfg.text }}>{cfg.label}</span>
                                <span className="text-[rgba(255,255,255,0.15)]">·</span>
                                <span className="text-xs font-bold tabular-nums" style={{ color: mentionColor }}>{pct}%</span>
                              </div>
                            );
                          })}
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
                                <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full flex-shrink-0 ${r.mentioned ? 'bg-[#064e3b]/30 text-[#10b981]' : 'bg-[rgba(255,255,255,0.08)] text-[#64748B]'}`}>
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

                {/* Untracked prompts */}
                {untrackedPrompts.map((p) => (
                  <div key={`untracked-${p.id}`} className="px-5 py-4">
                    <div className="flex items-start gap-3 mb-2">
                      <p className="text-sm text-[#64748B] leading-snug font-medium flex-1">{p.text}</p>
                      <span className="flex-shrink-0 text-[10px] font-semibold px-2 py-0.5 rounded-full bg-[rgba(255,255,255,0.06)] border border-[rgba(255,255,255,0.10)] text-[#475569]">
                        Not yet tracked
                      </span>
                    </div>
                    <p className="text-xs text-[#475569]">Will be included in your next report run.</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
