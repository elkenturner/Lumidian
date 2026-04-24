'use client';

import { useMemo } from 'react';
import { HelpCircle } from 'lucide-react';
import type { ContentDraft, DraftAttribution } from '@/lib/api';

export interface PostedSummaryStripProps {
  postedItems: ContentDraft[];
  attributions: Record<number, DraftAttribution>; // keyed by draft_id
  onOpenExplainer: () => void;
}

interface Summary {
  count: number;
  avgDelta: number | null;
  best: { delta: number; platform: string; promptHint: string | null } | null;
  awaitingCount: number;
  unattachedCount: number;
}

function computeSummary(
  postedItems: ContentDraft[],
  attributions: Record<number, DraftAttribution>,
): Summary {
  const count = postedItems.length;
  let awaitingCount = 0;
  let unattachedCount = 0;
  const deltas: number[] = [];
  let best: Summary['best'] = null;

  for (const d of postedItems) {
    if (!d.prompt_id) {
      unattachedCount += 1;
    }
    const attr = attributions[d.id];
    if (!attr || attr.runs_since_posting === 0) {
      awaitingCount += 1;
      continue;
    }
    if (attr.delta != null) {
      deltas.push(attr.delta);
      if (!best || attr.delta > best.delta) {
        best = {
          delta: attr.delta,
          platform: d.platform,
          promptHint: d.content_brief ?? null,
        };
      }
    }
  }

  const avgDelta = deltas.length > 0
    ? Math.round((deltas.reduce((a, b) => a + b, 0) / deltas.length) * 10) / 10
    : null;

  return { count, avgDelta, best, awaitingCount, unattachedCount };
}

function formatDelta(n: number): string {
  const rounded = Math.round(n * 10) / 10;
  if (rounded > 0) return `+${rounded.toFixed(1)}pp`;
  if (rounded < 0) return `${rounded.toFixed(1)}pp`;
  return '0pp';
}

export function PostedSummaryStrip({
  postedItems,
  attributions,
  onOpenExplainer,
}: PostedSummaryStripProps) {
  const summary = useMemo(
    () => computeSummary(postedItems, attributions),
    [postedItems, attributions],
  );

  if (summary.count === 0) {
    return (
      <div className="mb-3 text-xs text-[var(--text-faint)] italic">
        Posted drafts will appear here with their visibility impact.
      </div>
    );
  }

  const parts: string[] = [`${summary.count} post${summary.count === 1 ? '' : 's'}`];
  if (summary.avgDelta !== null) {
    parts.push(`avg ${formatDelta(summary.avgDelta)}`);
  }
  if (summary.best) {
    const hint = summary.best.promptHint
      ? `${summary.best.platform}, ${summary.best.promptHint.slice(0, 40)}${summary.best.promptHint.length > 40 ? '…' : ''}`
      : summary.best.platform;
    parts.push(`best ${formatDelta(summary.best.delta)} (${hint})`);
  }
  if (summary.awaitingCount > 0) {
    parts.push(`${summary.awaitingCount} awaiting data`);
  }
  if (summary.unattachedCount > 0) {
    parts.push(`${summary.unattachedCount} unattached`);
  }

  return (
    <div className="mb-4 flex items-center gap-2 text-xs text-[var(--text-muted)] flex-wrap">
      <span className="leading-relaxed">
        {parts.map((p, i) => (
          <span key={i}>
            {i > 0 && <span className="mx-1.5 text-[var(--text-faint)]">·</span>}
            <span className={i === 0 ? 'text-[var(--text-primary)] font-medium' : ''}>{p}</span>
          </span>
        ))}
      </span>
      <button
        onClick={onOpenExplainer}
        className="ml-auto flex items-center gap-1 text-[11px] text-[var(--text-faint)] hover:text-[var(--text-secondary)] transition-colors"
      >
        <HelpCircle size={11} />
        How impact works
      </button>
    </div>
  );
}
