'use client';

import { QueryResult } from '@/lib/api';
import HelpTooltip from './HelpTooltip';
import { getModelCfg } from './helpers';

// ── Prompt group builder ─────────────────────────────────────────────────────

export interface PromptGroup {
  promptId: number;
  promptText: string;
  total: number;
  mentioned: number;
  modelStats: Map<string, { total: number; mentioned: number }>;
  responses: QueryResult[];
}

export function buildPromptGroups(responses: QueryResult[]): PromptGroup[] {
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

// ── Best Performing Prompt card ──────────────────────────────────────────────

interface BestPromptCardProps {
  responses: QueryResult[];
  loading: boolean;
}

export default function BestPromptCard({ responses, loading }: BestPromptCardProps) {
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
    <div className="card p-6">
      <p className="text-sm font-medium text-[var(--text-secondary)] flex items-center mb-3">
        Best Performing Prompt
        <HelpTooltip text="The prompt where your brand is mentioned most often across AI models." />
      </p>
      {loading ? (
        <div className="space-y-2 flex-1">
          <div className="h-3 w-full bg-[var(--bg-tinted)] rounded animate-pulse" />
          <div className="h-3 w-2/3 bg-[var(--bg-tinted)] rounded animate-pulse" />
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
          <p className="text-3xl font-bold text-[var(--text-primary)] mt-1">&mdash;</p>
          <p className="text-xs text-[var(--text-faint)] mt-1">No data yet</p>
        </>
      )}
    </div>
  );
}
