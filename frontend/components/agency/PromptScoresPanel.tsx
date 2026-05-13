'use client';

import { useEffect, useState } from 'react';
import { TrendingDown, TrendingUp, Minus } from 'lucide-react';
import { getPromptsOverview, type PromptsOverviewResponse } from '@/lib/api';

interface Props {
  brandId: number | null;
}

function trendIcon(trend: string) {
  if (trend === 'up') return <TrendingUp className="h-3 w-3 text-emerald-400" />;
  if (trend === 'down') return <TrendingDown className="h-3 w-3 text-rose-400" />;
  return <Minus className="h-3 w-3 text-[var(--text-muted)]" />;
}

function scoreColor(score: number): string {
  if (score >= 70) return 'text-emerald-300';
  if (score >= 40) return 'text-amber-300';
  return 'text-rose-300';
}

export function PromptScoresPanel({ brandId }: Props) {
  const [data, setData] = useState<PromptsOverviewResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (brandId == null) return;
    getPromptsOverview(brandId)
      .then(setData)
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load prompts'));
  }, [brandId]);

  if (brandId == null) return null;
  if (error) return <p className="mt-4 text-sm text-red-400">{error}</p>;
  if (!data) return <p className="mt-4 text-sm text-[var(--text-muted)]">Loading prompts…</p>;
  if (data.prompts.length === 0) {
    return (
      <p className="mt-4 text-sm text-[var(--text-muted)]">
        No tracked prompts yet. Add prompts in the Brand & prompts section.
      </p>
    );
  }

  const sorted = [...data.prompts].sort((a, b) => a.current_overall - b.current_overall);

  return (
    <section className="mt-4 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-card)] p-5">
      <h3 className="mb-3 text-sm font-medium text-[var(--text-secondary)]">
        Per-prompt scores (worst → best)
      </h3>
      <ul className="space-y-1.5">
        {sorted.map((p) => (
          <li key={p.prompt_id} className="flex items-center gap-3 text-sm">
            <span className={`w-12 font-mono font-medium ${scoreColor(p.current_overall)}`}>
              {Math.round(p.current_overall)}%
            </span>
            <span className="shrink-0">{trendIcon(p.trend)}</span>
            <span className="flex-1 truncate text-[var(--text-primary)]" title={p.prompt_text}>
              {p.prompt_text}
            </span>
            <span className="text-xs text-[var(--text-muted)]">
              {p.drafts_posted > 0 ? `${p.drafts_posted} posted` : '—'}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
