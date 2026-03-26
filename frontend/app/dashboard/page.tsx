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
  X,
  Trash2,
  Sparkles,
} from 'lucide-react';
import {
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
  addPrompt,
  deletePrompt,
  getSuggestedPrompts,
  getCompetitors,
  addCompetitor,
  removeCompetitor,
  getBrandProfile,
  Brand,
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
} from '@/lib/api';
import TrendChart from '@/components/TrendChart';
import SubscriptionBanner from '@/components/SubscriptionBanner';
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
        <span className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-60 bg-[rgba(15,20,40,0.95)] border border-[rgba(99,102,241,0.15)] rounded-lg p-3 text-xs text-[#94A3B8] leading-relaxed shadow-lg z-50 pointer-events-none whitespace-normal">
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
    <div className="bg-[rgba(15,20,40,0.95)] border border-[rgba(99,102,241,0.15)] rounded-lg p-2 shadow-lg text-xs">
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

function ModelBreakdown({ models }: { models: ModelStat[] }) {
  if (!models.length) return <p className="text-xs text-[#475569]">No model data yet</p>;
  const max = Math.max(...models.map((m) => m.mention_rate), 0.01);
  return (
    <div className="space-y-3 w-full">
      {models.map((m) => {
        const pct = Math.round(m.mention_rate * 100);
        const barColor = MODEL_BAR_COLORS[m.model] ?? '#6366f1';
        const barWidth = `${Math.round((m.mention_rate / max) * 100)}%`;
        return (
          <div key={m.model}>
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs font-medium text-[#CBD5E1]">{m.label}</span>
              <span className="text-xs tabular-nums text-[#94A3B8]">{pct}% <span className="text-[#475569]">({m.mention_count}/{m.total})</span></span>
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

function BestPromptCard({ responses, loading, onAddCompetitors }: { responses: QueryResult[]; loading: boolean; onAddCompetitors: () => void }) {
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
    <div className="bg-[rgba(99,102,241,0.06)] backdrop-blur-md border border-[rgba(99,102,241,0.15)] rounded-xl p-5 shadow-[0_4px_24px_rgba(0,0,0,0.20)] flex flex-col">
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
      <button
        onClick={onAddCompetitors}
        className="text-[10px] text-[#6366f1] hover:text-[#818cf8] mt-3 pt-2 border-t border-[rgba(99,102,241,0.15)] w-full text-left transition-colors"
      >
        + Add competitors to enable Share of Voice →
      </button>
    </div>
  );
}

// ── Manage Prompts Modal ───────────────────────────────────────────────────────

function ManagePromptsModal({
  brandId,
  prompts,
  onClose,
  onChanged,
}: {
  brandId: number;
  prompts: Prompt[];
  onClose: () => void;
  onChanged: (updated: Prompt[]) => void;
}) {
  const [localPrompts, setLocalPrompts] = useState(prompts);
  const [newText, setNewText] = useState('');
  const [adding, setAdding] = useState(false);
  const [suggesting, setSuggesting] = useState(false);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [deletingId, setDeletingId] = useState<number | null>(null);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose]);

  async function handleAdd() {
    if (!newText.trim()) return;
    setAdding(true);
    try {
      const p = await addPrompt(brandId, newText.trim());
      const updated = [...localPrompts, p];
      setLocalPrompts(updated);
      setNewText('');
      onChanged(updated);
    } finally {
      setAdding(false);
    }
  }

  async function handleDelete(promptId: number) {
    setDeletingId(promptId);
    try {
      await deletePrompt(brandId, promptId);
      const updated = localPrompts.filter((p) => p.id !== promptId);
      setLocalPrompts(updated);
      onChanged(updated);
    } finally {
      setDeletingId(null);
    }
  }

  async function handleSuggest() {
    setSuggesting(true);
    try {
      const s = await getSuggestedPrompts(brandId);
      setSuggestions(s);
    } catch { /* ignore */ } finally {
      setSuggesting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div role="dialog" aria-modal="true" className="relative bg-[rgba(10,14,24,0.96)] backdrop-blur-xl border border-[rgba(99,102,241,0.15)] rounded-2xl p-6 max-w-lg w-full shadow-2xl max-h-[80vh] flex flex-col">
        <div className="flex items-center justify-between mb-5 shrink-0">
          <div>
            <h3 className="text-base font-semibold text-[#F0F4F8]">Manage Prompts</h3>
            <p className="text-xs text-[#64748B] mt-0.5">Add or remove the prompts AI models are queried with</p>
          </div>
          <button onClick={onClose} aria-label="Close" className="text-[#475569] hover:text-[#94A3B8] transition-colors">
            <X size={16} />
          </button>
        </div>

        {/* Current prompts */}
        <div className="flex-1 overflow-y-auto space-y-2 mb-4">
          {localPrompts.length === 0 ? (
            <p className="text-sm text-[#475569] text-center py-4">No prompts yet</p>
          ) : (
            localPrompts.map((p) => (
              <div key={p.id} className="flex items-start gap-3 bg-[rgba(99,102,241,0.06)] border border-[rgba(99,102,241,0.12)] rounded-lg px-3 py-2.5">
                <p className="text-sm text-[#94A3B8] flex-1 leading-snug">{p.text}</p>
                <button
                  onClick={() => handleDelete(p.id)}
                  disabled={deletingId === p.id}
                  aria-label="Delete prompt"
                  className="text-[#475569] hover:text-[#f87171] transition-colors shrink-0 disabled:opacity-40"
                >
                  {deletingId === p.id ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />}
                </button>
              </div>
            ))
          )}
        </div>

        {/* Suggestions */}
        {suggestions.length > 0 && (
          <div className="mb-4 space-y-1.5 shrink-0">
            <p className="text-xs text-[#64748B] font-medium uppercase tracking-wide">Suggested prompts</p>
            {suggestions.map((s, i) => (
              <button
                key={i}
                onClick={() => { setNewText(s); setSuggestions([]); }}
                className="w-full text-left text-xs text-[#94A3B8] bg-[rgba(99,102,241,0.06)] border border-[rgba(99,102,241,0.12)] hover:border-[rgba(99,102,241,0.25)] rounded-lg px-3 py-2 transition-colors"
              >
                {s}
              </button>
            ))}
          </div>
        )}

        {/* Add new */}
        <div className="shrink-0 space-y-2">
          <div className="flex gap-2">
            <input
              type="text"
              value={newText}
              onChange={(e) => setNewText(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
              placeholder="e.g. What is the best tool for early cancer detection?"
              className="flex-1 bg-[rgba(255,255,255,0.05)] border border-[rgba(255,255,255,0.10)] text-[#F0F4F8] rounded-lg px-3 py-2 text-sm placeholder:text-[#475569] focus:outline-none focus:border-[#6366f1]"
            />
            <button
              onClick={handleAdd}
              disabled={adding || !newText.trim()}
              className="flex items-center gap-1.5 text-xs bg-[#6366f1] hover:bg-[#4f46e5] disabled:opacity-50 text-white rounded-lg px-3 py-2 transition-colors shrink-0"
            >
              {adding ? <Loader2 size={11} className="animate-spin" /> : <Plus size={11} />}
              Add
            </button>
          </div>
          <button
            onClick={handleSuggest}
            disabled={suggesting}
            className="w-full flex items-center justify-center gap-1.5 text-xs text-[#64748B] hover:text-[#94A3B8] border border-[rgba(255,255,255,0.08)] hover:border-[rgba(255,255,255,0.14)] rounded-lg py-2 transition-colors"
          >
            {suggesting ? <Loader2 size={11} className="animate-spin" /> : <Sparkles size={11} />}
            {suggesting ? 'Generating suggestions…' : 'Suggest prompts with AI'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Competitor Modal ───────────────────────────────────────────────────────────

function CompetitorModal({
  brandId,
  competitors,
  competitorStats,
  onClose,
  onChanged,
}: {
  brandId: number;
  competitors: Competitor[];
  competitorStats: CompetitorStat[];
  onClose: () => void;
  onChanged: (updated: Competitor[]) => void;
}) {
  const [local, setLocal] = useState(competitors);
  const [newName, setNewName] = useState('');
  const [newWebsite, setNewWebsite] = useState('');
  const [adding, setAdding] = useState(false);
  const [removingId, setRemovingId] = useState<number | null>(null);

  // Build a map of name -> mention_rate from last run analytics
  const rateByName = new Map(competitorStats.filter((s) => !s.is_primary).map((s) => [s.name.toLowerCase(), s.mention_rate]));

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose]);

  async function handleAdd() {
    if (!newName.trim()) return;
    setAdding(true);
    try {
      const c = await addCompetitor(brandId, newName.trim(), newWebsite.trim() || undefined);
      const updated = [...local, c];
      setLocal(updated);
      setNewName('');
      setNewWebsite('');
      onChanged(updated);
    } finally {
      setAdding(false);
    }
  }

  async function handleRemove(id: number) {
    setRemovingId(id);
    try {
      await removeCompetitor(brandId, id);
      const updated = local.filter((c) => c.id !== id);
      setLocal(updated);
      onChanged(updated);
    } finally {
      setRemovingId(null);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div role="dialog" aria-modal="true" className="relative bg-[rgba(10,14,24,0.96)] backdrop-blur-xl border border-[rgba(99,102,241,0.15)] rounded-2xl p-6 max-w-md w-full shadow-2xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-5">
          <div>
            <h3 className="text-base font-semibold text-[#F0F4F8]">Competitors</h3>
            <p className="text-xs text-[#64748B] mt-0.5">Track competitor mentions to unlock Share of Voice</p>
          </div>
          <button onClick={onClose} aria-label="Close" className="text-[#475569] hover:text-[#94A3B8] transition-colors">
            <X size={16} />
          </button>
        </div>

        <div className="space-y-2 mb-4 min-h-[40px]">
          {local.length === 0 ? (
            <p className="text-sm text-[#475569] text-center py-3">No competitors added yet</p>
          ) : local.map((c) => {
            const rate = rateByName.get(c.name.toLowerCase());
            return (
              <div key={c.id} className="flex items-center gap-3 bg-[rgba(99,102,241,0.06)] border border-[rgba(99,102,241,0.12)] rounded-lg px-3 py-2.5">
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-[#F0F4F8] font-medium truncate">{c.name}</p>
                  {c.website_url && (
                    <p className="text-[10px] text-[#475569] truncate">{c.website_url}</p>
                  )}
                </div>
                {rate !== undefined && (
                  <span className="text-xs font-bold tabular-nums text-[#94A3B8] flex-shrink-0">
                    {Math.round(rate * 100)}%
                  </span>
                )}
                <button
                  onClick={() => handleRemove(c.id)}
                  disabled={removingId === c.id}
                  aria-label="Remove competitor"
                  className="text-[#475569] hover:text-[#f87171] transition-colors disabled:opacity-40 flex-shrink-0"
                >
                  {removingId === c.id ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />}
                </button>
              </div>
            );
          })}
        </div>

        <div className="space-y-2">
          <div className="flex gap-2">
            <input
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
              placeholder="Competitor brand name"
              className="flex-1 bg-[rgba(255,255,255,0.05)] border border-[rgba(255,255,255,0.10)] text-[#F0F4F8] rounded-lg px-3 py-2 text-sm placeholder:text-[#475569] focus:outline-none focus:border-[#6366f1]"
            />
            <button
              onClick={handleAdd}
              disabled={adding || !newName.trim()}
              className="flex items-center gap-1.5 text-xs bg-[#6366f1] hover:bg-[#4f46e5] disabled:opacity-50 text-white rounded-lg px-3 py-2 transition-colors"
            >
              {adding ? <Loader2 size={11} className="animate-spin" /> : <Plus size={11} />}
              Add
            </button>
          </div>
          <input
            type="text"
            value={newWebsite}
            onChange={(e) => setNewWebsite(e.target.value)}
            placeholder="Website URL (optional)"
            className="w-full bg-[rgba(255,255,255,0.05)] border border-[rgba(255,255,255,0.10)] text-[#F0F4F8] rounded-lg px-3 py-2 text-sm placeholder:text-[#475569] focus:outline-none focus:border-[#6366f1]"
          />
        </div>

        {local.length > 0 && (
          <p className="text-xs text-[#475569] mt-3">Run a new report to see updated Share of Voice data.</p>
        )}
      </div>
    </div>
  );
}

// ── Page ───────────────────────────────────────────────────────────────────────

export default function DashboardPage() {
  const { user } = useAuth();
  const { brands, activeBrandId: selectedBrandId, loading: loadingBrands, setActiveBrandId } = useBrand();
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

  // Toast
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'info' } | null>(null);

  // Brand profile completeness
  const [brandProfile, setBrandProfile] = useState<BrandProfile | null>(null);

  // Prompt modal
  const [promptModalOpen, setPromptModalOpen] = useState(false);

  // Competitor modal
  const [competitors, setCompetitors] = useState<Competitor[]>([]);
  const [competitorModalOpen, setCompetitorModalOpen] = useState(false);

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

  useEffect(() => { document.title = 'Dashboard — ClarityAI'; }, []);

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

  // Next auto-report: scheduled at 08:00 and 20:00 UTC daily, regardless of manual runs
  const nextReportHours: number | null = (() => {
    const now = new Date();
    let minMs = Infinity;
    for (const h of [8, 20]) {
      let next = new Date(Date.UTC(
        now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), h, 0, 0, 0
      ));
      if (next.getTime() <= now.getTime()) next = new Date(next.getTime() + 86400000);
      const diff = next.getTime() - now.getTime();
      if (diff < minMs) minMs = diff;
    }
    const h = Math.round(minMs / 3600000);
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

  // Quick stats
  const totalPrompts = (brandDetail?.prompts ?? []).length;
  const totalRuns = trends.length;
  const totalResponses = trends.reduce((acc, t) => acc + (t.total_queries ?? 0), 0);
  const daysSinceFirst = trends.length > 0 && trends[0].completed_at
    ? Math.max(0, Math.floor((Date.now() - parseUTCISO(trends[0].completed_at).getTime()) / 86_400_000))
    : null;

  return (
    <div className="px-4 sm:px-8 py-6 sm:py-8 max-w-7xl">
      {/* Subscription status banner */}
      {user?.subscription_status && ['past_due', 'canceled', 'unpaid'].includes(user.subscription_status) && (
        <div className="-mx-8 -mt-8 mb-6">
          <SubscriptionBanner status={user.subscription_status} />
        </div>
      )}

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
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-6">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-[#F0F4F8]">
            {selectedBrand ? selectedBrand.name : 'Dashboard'}
          </h1>
          <p className="text-sm text-[#64748B] mt-1">AI visibility analytics</p>
        </div>
        <div className="flex items-center gap-2 sm:gap-3">
          <button
            onClick={() => setPromptModalOpen(true)}
            disabled={!selectedBrandId}
            className="flex items-center gap-2 bg-[rgba(99,102,241,0.06)] hover:bg-[rgba(99,102,241,0.09)] border border-[rgba(99,102,241,0.15)] hover:border-[rgba(255,255,255,0.14)] text-[#64748B] hover:text-[#94A3B8] rounded-lg px-3 py-2 text-xs transition-all duration-150"
          >
            <MessageSquare size={14} />
            Prompts
          </button>
          <button
            onClick={() => selectedBrandId && loadData(selectedBrandId)}
            aria-label="Refresh dashboard"
            className="flex items-center gap-2 bg-[rgba(99,102,241,0.06)] hover:bg-[rgba(99,102,241,0.06)] border border-[rgba(99,102,241,0.15)] hover:border-[rgba(255,255,255,0.14)] text-[#64748B] hover:text-[#94A3B8] rounded-lg px-3 py-2 transition-all duration-150"
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
            <div key={i} className="h-28 bg-[rgba(99,102,241,0.06)] border border-[rgba(99,102,241,0.15)] rounded-xl animate-pulse" />
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
              <div key={n} className="flex-1 bg-[rgba(99,102,241,0.06)] border border-[rgba(99,102,241,0.15)] rounded-xl p-4">
                <div className="w-6 h-6 rounded-full bg-[rgba(99,102,241,0.20)] text-[#818cf8] text-xs font-bold flex items-center justify-center mb-2">{n}</div>
                <p className="text-sm font-semibold text-[#F0F4F8] mb-1">{title}</p>
                <p className="text-xs text-[#64748B] leading-relaxed">{body}</p>
              </div>
            ))}
          </div>
          <Link
            href="/tracker/new"
            className="flex items-center gap-2 bg-[#6366f1] hover:bg-[#4f46e5] text-white rounded-lg px-6 py-3 text-sm font-semibold transition-colors shadow-lg shadow-[#6366f1]/20"
          >
            <Plus size={16} />
            Get Started
          </Link>
        </div>
      ) : (
        <>
          {/* ── OVERVIEW ─────────────────────────────────────────────────── */}
          <>
              {/* Brand profile completeness nudge */}
              {brandProfile && brandProfile.completion_pct < 100 && (
                <div className="mb-4 flex items-center gap-4 bg-[rgba(99,102,241,0.06)] border border-[rgba(99,102,241,0.15)] rounded-xl px-5 py-3">
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
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
                  {[
                    { label: 'Prompts tracked', value: totalPrompts || '—', icon: MessageSquare },
                    { label: 'Runs completed', value: totalRuns || '—', icon: RefreshCw },
                    { label: 'Responses analyzed', value: totalResponses >= 1000 ? `${(totalResponses / 1000).toFixed(1)}k` : totalResponses || '—', icon: BarChart2 },
                    { label: 'Days tracking', value: daysSinceFirst != null ? daysSinceFirst : '—', icon: TrendingUp },
                  ].map(({ label, value, icon: Icon }) => (
                    <div key={label} className="bg-[rgba(99,102,241,0.04)] border border-[rgba(99,102,241,0.12)] rounded-xl px-4 py-3 flex items-center gap-3">
                      <div className="w-8 h-8 rounded-lg bg-[rgba(99,102,241,0.10)] flex items-center justify-center flex-shrink-0">
                        <Icon size={14} className="text-[#6366f1]" />
                      </div>
                      <div>
                        <p className="text-lg font-bold text-[#F0F4F8] leading-tight">{value}</p>
                        <p className="text-[11px] text-[#475569] mt-0.5">{label}</p>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* Row 1: visibility + SOV + sentiment */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
                {/* Visibility score + sparkline */}
                <div className="col-span-2 bg-[rgba(99,102,241,0.06)] backdrop-blur-md border border-[rgba(99,102,241,0.15)] border-t-2 border-t-[#6366f1] rounded-xl p-5 shadow-[0_4px_24px_rgba(0,0,0,0.20)]">
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

                {/* Best Performing Prompt — always shown */}
                <BestPromptCard responses={responses} loading={loadingAnalytics} onAddCompetitors={() => setCompetitorModalOpen(true)} />

                {/* Sentiment */}
                <div className="bg-[rgba(99,102,241,0.06)] backdrop-blur-md border border-[rgba(99,102,241,0.15)] rounded-xl p-5 shadow-[0_4px_24px_rgba(0,0,0,0.20)]">
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

              {/* Share of Voice — shown separately when competitors are tracked */}
              {analytics?.sov.has_competitors && (
                <div className="bg-[rgba(99,102,241,0.06)] backdrop-blur-md border border-[rgba(99,102,241,0.15)] rounded-xl p-5 shadow-[0_4px_24px_rgba(0,0,0,0.20)] mb-4">
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
                      Manage
                    </button>
                  </div>
                  {loadingAnalytics ? (
                    <div className="flex gap-3">
                      {[1, 2, 3].map(i => <div key={i} className="h-5 flex-1 bg-[rgba(255,255,255,0.06)] rounded animate-pulse" />)}
                    </div>
                  ) : (() => {
                    const allStats = analytics.competitor_comparison;
                    const maxRate = Math.max(...allStats.map((s) => s.mention_rate));
                    return (
                      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3">
                        {allStats.map((s) => {
                          const pct = Math.round(s.mention_rate * 100);
                          const isLeading = s.mention_rate === maxRate && maxRate > 0;
                          const barColor = s.is_primary
                            ? (isLeading ? '#10b981' : '#6366f1')
                            : (isLeading ? '#ef4444' : '#475569');
                          const textColor = s.is_primary
                            ? (isLeading ? '#10b981' : '#818cf8')
                            : (isLeading ? '#f87171' : '#64748B');
                          return (
                            <div key={s.name} className="flex flex-col gap-1.5">
                              <div className="flex items-center justify-between">
                                <span className={`text-xs font-medium truncate ${s.is_primary ? 'text-[#F0F4F8]' : 'text-[#94A3B8]'}`}>
                                  {s.name}
                                </span>
                                <span className="text-xs font-bold tabular-nums ml-2 flex-shrink-0" style={{ color: textColor }}>
                                  {pct}%
                                </span>
                              </div>
                              <div className="h-1.5 rounded-full bg-[rgba(255,255,255,0.08)] overflow-hidden">
                                <div
                                  className="h-full rounded-full transition-all"
                                  style={{ width: `${maxRate > 0 ? (s.mention_rate / maxRate) * 100 : 0}%`, background: barColor }}
                                />
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    );
                  })()}
                </div>
              )}

              {/* Row 2: Avg Position + Top Domains */}
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-4">
                {/* Avg Position */}
                <div className="bg-[rgba(99,102,241,0.06)] backdrop-blur-md border border-[rgba(99,102,241,0.15)] rounded-xl p-5 shadow-[0_4px_24px_rgba(0,0,0,0.20)]">
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
                <div className="lg:col-span-2 bg-[rgba(99,102,241,0.06)] backdrop-blur-md border border-[rgba(99,102,241,0.15)] rounded-xl p-5 shadow-[0_4px_24px_rgba(0,0,0,0.20)] flex flex-col">
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
                <div className="bg-[rgba(99,102,241,0.06)] backdrop-blur-md border border-[rgba(99,102,241,0.15)] rounded-xl p-5 shadow-[0_4px_24px_rgba(0,0,0,0.20)]">
                  <div className="flex items-center gap-2 mb-4">
                    <BarChart2 size={15} className="text-[#6366f1]" />
                    <h3 className="text-sm font-semibold text-[#F0F4F8]">Performance by Model</h3>
                    <HelpTooltip text="How often each AI model mentions your brand when answering relevant prompts." />
                  </div>
                  {loadingAnalytics ? (
                    <div className="space-y-3">
                      {[1,2,3,4].map(i => <div key={i} className="h-6 bg-[rgba(255,255,255,0.06)] rounded animate-pulse" />)}
                    </div>
                  ) : (
                    <ModelBreakdown models={analytics?.model_breakdown ?? []} />
                  )}
                </div>
              </div>

              {/* Recent Conversations */}
              <div className="bg-[rgba(99,102,241,0.06)] backdrop-blur-md border border-[rgba(99,102,241,0.15)] rounded-xl overflow-hidden shadow-[0_4px_24px_rgba(0,0,0,0.20)]">
                <div className="px-5 py-4 border-b border-[rgba(99,102,241,0.15)] flex items-center justify-between bg-[rgba(99,102,241,0.06)]">
                  <div className="flex items-center gap-2">
                    <MessageSquare size={16} className="text-[#6366f1]" />
                    <h3 className="text-base font-semibold text-[#F0F4F8]">Recent Conversations</h3>
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
                                      : 'bg-[rgba(99,102,241,0.06)] text-[#64748B]'
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
                            <div className="px-5 pb-4 pt-3 border-t border-[rgba(99,102,241,0.15)] bg-[rgba(99,102,241,0.06)]">
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
        </>
      )}

      {/* Modals */}
      {promptModalOpen && selectedBrandId && brandDetail && (
        <ManagePromptsModal
          brandId={selectedBrandId}
          prompts={brandDetail.prompts}
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

      {/* Toast notification */}
      {toast && (
        <div className={`fixed bottom-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 px-4 py-3 rounded-xl shadow-2xl border text-sm font-medium transition-all ${
          toast.type === 'success'
            ? 'bg-[rgba(6,78,59,0.90)] border-[#065f46]/50 text-[#34d399]'
            : 'bg-[rgba(10,14,24,0.95)] border-[rgba(99,102,241,0.25)] text-[#94A3B8]'
        } backdrop-blur-xl`}>
          {toast.type === 'success' ? <span className="text-[#34d399]">✓</span> : <span className="text-[#6366f1]">ℹ</span>}
          {toast.message}
          <button onClick={() => setToast(null)} className="ml-2 text-current opacity-50 hover:opacity-100 transition-opacity text-xs">✕</button>
        </div>
      )}
    </div>
  );
}
