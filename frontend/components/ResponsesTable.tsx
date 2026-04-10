'use client';

import { QueryResult } from '@/lib/api';
import { MODEL_ORDER, getModelConfig as getModelConfigShared } from '@/lib/constants/models';

interface ResponsesTableProps {
  responses: QueryResult[];
  loading: boolean;
}

function getModelConfig(model: string) {
  const cfg = getModelConfigShared(model);
  return { label: cfg.label, bg: cfg.mutedBg, text: cfg.color, key: cfg.key };
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
    <div className="border-b border-[rgba(95,126,166,0.12)] px-5 py-4 animate-pulse">
      <div className="flex items-center gap-4">
        <div className="flex-1 h-4 skeleton rounded" />
        <div className="flex gap-2">
          {[1, 2, 3, 4].map(i => <div key={i} className="h-6 w-16 skeleton rounded-md" />)}
        </div>
        <div className="h-5 w-12 skeleton rounded" />
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
    <div className="bg-[rgba(95,126,166,0.06)] border border-[rgba(95,126,166,0.22)] rounded-xl overflow-hidden shadow-[0_4px_24px_rgba(0,0,0,0.20)]">
      {/* Header */}
      <div className="px-5 py-3.5 border-b border-[rgba(95,126,166,0.15)] flex items-center justify-between bg-[rgba(95,126,166,0.04)]">
        <h3 className="text-sm font-semibold text-[var(--text-primary)]">Query Responses</h3>
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
            <span className="text-xs text-[var(--text-muted)] border-l border-[rgba(95,126,166,0.20)] pl-3">
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
        <div className="px-5 py-12 text-center text-[var(--text-muted)] text-sm">
          No responses found for this run.
        </div>
      ) : (
        <div className="divide-y divide-[rgba(95,126,166,0.12)]">
          {groups.map((g) => {
            const overallPct = g.total > 0 ? Math.round((g.mentioned / g.total) * 100) : 0;
            const overallColor = overallPct >= 60 ? 'var(--success)' : overallPct >= 30 ? 'var(--warning)' : 'var(--danger)';

            return (
              <div key={g.promptId} className="stagger-row px-5 py-4 hover:bg-[rgba(95,126,166,0.04)] transition-colors">
                {/* Prompt text */}
                <p className="text-sm text-[var(--text-secondary)] mb-3 leading-snug font-medium">
                  {g.promptText}
                </p>

                {/* Model badges row */}
                <div className="flex items-center gap-2 flex-wrap">
                  {MODEL_ORDER.map(modelKey => {
                    const ms = g.modelStats.get(modelKey);
                    const cfg = getModelConfig(modelKey);
                    if (!ms) return null;
                    const pct = ms.total > 0 ? Math.round((ms.mentioned / ms.total) * 100) : 0;
                    const mentionColor = pct >= 60 ? 'var(--success)' : pct >= 30 ? 'var(--warning)' : 'var(--danger)';

                    return (
                      <div
                        key={modelKey}
                        className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-[rgba(95,126,166,0.22)] bg-[rgba(95,126,166,0.06)]"
                      >
                        <span
                          className="text-xs font-semibold"
                          style={{ color: cfg.text }}
                        >
                          {cfg.label}
                        </span>
                        <span className="text-[rgba(95,126,166,0.40)]">&middot;</span>
                        <span
                          className="text-xs font-bold tabular-nums font-mono"
                          style={{ color: mentionColor }}
                        >
                          {pct}%
                        </span>
                        <span className="text-[10px] text-[var(--text-faint)] tabular-nums font-mono">
                          ({ms.mentioned}/{ms.total})
                        </span>
                      </div>
                    );
                  })}

                  {/* Overall */}
                  <div className="ml-auto flex items-center gap-1.5">
                    <span className="text-xs text-[var(--text-muted)]">Overall</span>
                    <span
                      className="text-sm font-bold tabular-nums font-mono"
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
