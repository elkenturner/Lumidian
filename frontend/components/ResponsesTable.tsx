'use client';

import { QueryResult } from '@/lib/api';

interface ResponsesTableProps {
  responses: QueryResult[];
  loading: boolean;
}

const MODEL_CONFIG: Record<string, { label: string; bg: string; text: string }> = {
  chatgpt:    { label: 'ChatGPT',    bg: '#064e3b', text: '#10b981' },
  claude:     { label: 'Claude',     bg: '#451a03', text: '#f59e0b' },
  perplexity: { label: 'Perplexity', bg: '#2e1065', text: '#a78bfa' },
  gemini:     { label: 'Gemini',     bg: '#172554', text: '#60a5fa' },
};

const MODEL_ORDER = ['chatgpt', 'claude', 'perplexity', 'gemini'];

function getModelConfig(model: string) {
  const key = model.toLowerCase().replace(/[-_\s]/g, '');
  for (const [k, v] of Object.entries(MODEL_CONFIG)) {
    if (key.includes(k)) return { ...v, key: k };
  }
  return { label: model, bg: '#1a1a24', text: '#64748b', key: model };
}

interface ModelStat {
  model: string;
  total: number;
  mentioned: number;
}

interface PromptGroup {
  promptId: number;
  promptText: string;
  total: number;
  mentioned: number;
  modelStats: Map<string, ModelStat>;
}

function buildGroups(responses: QueryResult[]): PromptGroup[] {
  const promptMap = new Map<number, PromptGroup>();

  for (const r of responses) {
    if (!promptMap.has(r.prompt_id)) {
      promptMap.set(r.prompt_id, {
        promptId: r.prompt_id,
        promptText: r.prompt_text ?? '',
        total: 0,
        mentioned: 0,
        modelStats: new Map(),
      });
    }
    const pg = promptMap.get(r.prompt_id)!;
    pg.total++;
    if (r.mentioned) pg.mentioned++;

    if (!pg.modelStats.has(r.model)) {
      pg.modelStats.set(r.model, { model: r.model, total: 0, mentioned: 0 });
    }
    const ms = pg.modelStats.get(r.model)!;
    ms.total++;
    if (r.mentioned) ms.mentioned++;
  }

  return Array.from(promptMap.values());
}

function SkeletonRow() {
  return (
    <div className="border-b border-[#1e1e2e] px-5 py-4 animate-pulse">
      <div className="flex items-center gap-4">
        <div className="flex-1 h-4 bg-[#1a1a24] rounded" />
        <div className="flex gap-2">
          {[1, 2, 3, 4].map(i => <div key={i} className="h-6 w-16 bg-[#1a1a24] rounded-md" />)}
        </div>
        <div className="h-5 w-12 bg-[#1a1a24] rounded" />
      </div>
    </div>
  );
}

export default function ResponsesTable({ responses, loading }: ResponsesTableProps) {
  const groups = buildGroups(responses);

  const modelsPresent = MODEL_ORDER.filter(m =>
    groups.some(g => g.modelStats.has(m))
  );

  return (
    <div className="bg-[#111118] border border-[#1e1e2e] rounded-xl overflow-hidden">
      {/* Header */}
      <div className="px-5 py-3.5 border-b border-[#1e1e2e] flex items-center justify-between bg-[#0d0d14]">
        <h3 className="text-sm font-semibold text-[#e2e8f0]">Query Responses</h3>
        {!loading && groups.length > 0 && (
          <div className="flex items-center gap-3">
            {modelsPresent.map(m => {
              const cfg = getModelConfig(m);
              return (
                <span
                  key={m}
                  className="text-xs font-medium px-2 py-0.5 rounded-full"
                  style={{ backgroundColor: cfg.bg, color: cfg.text }}
                >
                  {cfg.label}
                </span>
              );
            })}
            <span className="text-xs text-[#64748b] border-l border-[#1e1e2e] pl-3">
              {groups.length} prompt{groups.length !== 1 ? 's' : ''}
            </span>
          </div>
        )}
      </div>

      {/* Body */}
      {loading ? (
        <div>
          {Array.from({ length: 3 }).map((_, i) => <SkeletonRow key={i} />)}
        </div>
      ) : groups.length === 0 ? (
        <div className="px-5 py-12 text-center text-[#64748b] text-sm">
          No responses found for this run.
        </div>
      ) : (
        <div className="divide-y divide-[#1e1e2e]">
          {groups.map((g) => {
            const overallPct = g.total > 0 ? Math.round((g.mentioned / g.total) * 100) : 0;
            const overallColor = overallPct >= 60 ? '#10b981' : overallPct >= 30 ? '#f59e0b' : '#ef4444';

            return (
              <div key={g.promptId} className="px-5 py-4 hover:bg-[#0d0d14] transition-colors">
                {/* Prompt text */}
                <p className="text-sm text-[#94a3b8] mb-3 leading-snug font-medium">
                  {g.promptText}
                </p>

                {/* Model badges row */}
                <div className="flex items-center gap-2 flex-wrap">
                  {MODEL_ORDER.map(modelKey => {
                    const ms = g.modelStats.get(modelKey);
                    const cfg = getModelConfig(modelKey);
                    if (!ms) return null;
                    const pct = ms.total > 0 ? Math.round((ms.mentioned / ms.total) * 100) : 0;
                    const mentionColor = pct >= 60 ? '#10b981' : pct >= 30 ? '#f59e0b' : '#ef4444';

                    return (
                      <div
                        key={modelKey}
                        className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-[#2a2a3a] bg-[#111118]"
                      >
                        <span
                          className="text-xs font-semibold"
                          style={{ color: cfg.text }}
                        >
                          {cfg.label}
                        </span>
                        <span className="text-[#2a2a3a]">·</span>
                        <span
                          className="text-xs font-bold tabular-nums"
                          style={{ color: mentionColor }}
                        >
                          {pct}%
                        </span>
                        <span className="text-[10px] text-[#475569] tabular-nums">
                          ({ms.mentioned}/{ms.total})
                        </span>
                      </div>
                    );
                  })}

                  {/* Overall */}
                  <div className="ml-auto flex items-center gap-1.5">
                    <span className="text-xs text-[#64748b]">Overall</span>
                    <span
                      className="text-sm font-bold tabular-nums"
                      style={{ color: overallColor }}
                    >
                      {overallPct}%
                    </span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
