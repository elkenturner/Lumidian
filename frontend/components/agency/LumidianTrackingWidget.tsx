'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { getOverview, getTrends, type OverviewData, type TrendPoint } from '@/lib/api';

interface Props {
  brandId: number | null;
}

export function LumidianTrackingWidget({ brandId }: Props) {
  const [overview, setOverview] = useState<OverviewData | null>(null);
  const [trend, setTrend] = useState<number[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (brandId == null) return;
    getOverview(brandId)
      .then(setOverview)
      .catch((e: unknown) => {
        const msg = e instanceof Error ? e.message : String(e);
        setError(msg);
      });
    getTrends(brandId)
      .then((points: TrendPoint[]) => {
        setTrend(points.slice(-8).map((p) => p.score));
      })
      .catch(() => setTrend([]));
  }, [brandId]);

  if (brandId == null) {
    return (
      <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-card)] p-4 text-sm text-[var(--text-muted)]">
        No brand attached.
      </div>
    );
  }
  if (error) {
    return (
      <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-card)] p-4 text-sm text-red-400">
        {error}
      </div>
    );
  }
  if (!overview) {
    return (
      <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-card)] p-4 text-sm text-[var(--text-muted)]">
        Loading tracking…
      </div>
    );
  }

  const overall = Math.round((overview.latest_run?.overall_score ?? 0) * 100) / 100;

  const MODEL_LABELS: Record<string, string> = {
    chatgpt: 'ChatGPT',
    claude: 'Claude',
    perplexity: 'Perplexity',
    gemini: 'Gemini',
  };

  const modelBars = ['chatgpt', 'claude', 'perplexity', 'gemini'].map((key) => {
    const found = overview.model_breakdown.find((m) => m.model === key);
    return { label: MODEL_LABELS[key], value: found?.score ?? 0 };
  });

  const max = Math.max(1, ...trend);

  return (
    <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-card)] p-5 text-[var(--text-primary)]">
      <div className="flex items-baseline justify-between">
        <h3 className="text-sm font-medium text-[var(--text-secondary)]">Lumidian visibility</h3>
        <Link
          href={`/dashboard?brand=${brandId}`}
          className="text-xs text-[var(--text-muted)] hover:underline"
        >
          Open in Lumidian →
        </Link>
      </div>
      <div className="mt-2 text-3xl font-semibold">{overall}%</div>

      {modelBars.some((b) => b.value > 0) && (
        <div className="mt-4 grid grid-cols-4 gap-2 text-xs text-[var(--text-secondary)]">
          {modelBars.map(({ label, value }) => (
            <div key={label}>
              <div className="mb-1 truncate">{label}</div>
              <div className="h-2 overflow-hidden rounded-full bg-[var(--bg-raised)]">
                <div
                  className="h-full bg-[var(--text-secondary)]"
                  style={{ width: `${Math.min(100, value)}%` }}
                />
              </div>
              <div className="mt-1">{Math.round(value)}%</div>
            </div>
          ))}
        </div>
      )}

      {trend.length > 0 && (
        <div className="mt-4">
          <div className="mb-1 text-xs text-[var(--text-muted)]">Last {trend.length} runs</div>
          <div className="flex h-10 items-end gap-1">
            {trend.map((v, i) => (
              <div
                key={i}
                className="w-full bg-[var(--text-secondary)] opacity-60"
                style={{ height: `${(v / max) * 100}%` }}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
