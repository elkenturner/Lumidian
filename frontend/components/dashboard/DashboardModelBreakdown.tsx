'use client';

import { ModelStat } from '@/lib/api';
import { MODEL_BAR_COLORS } from './helpers';

interface DashboardModelBreakdownProps {
  models: ModelStat[];
  deltas?: Record<string, number>;
}

export default function DashboardModelBreakdown({ models, deltas }: DashboardModelBreakdownProps) {
  if (!models.length) return <p className="text-xs text-[var(--text-faint)]">No model data yet</p>;
  return (
    <div className="space-y-3 w-full">
      {models.map((m) => {
        const pct = Math.round(m.mention_rate * 100);
        const barColor = MODEL_BAR_COLORS[m.model] ?? 'var(--accent)';
        const barWidth = `${pct}%`;
        const delta = deltas?.[m.model];
        return (
          <div key={m.model}>
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs font-medium text-[var(--text-secondary)]">{m.label}</span>
              <span className="text-xs tabular-nums text-[var(--text-secondary)] flex items-center gap-1">
                {delta !== undefined && delta !== 0 && (
                  <span style={{ color: delta > 0 ? 'var(--success)' : 'var(--danger-text)', fontWeight: 600 }}>
                    {delta > 0 ? `\u2191${delta}%` : `\u2193${Math.abs(delta)}%`}
                  </span>
                )}
                {pct}% <span className="text-[var(--text-faint)]">({m.mention_count}/{m.total})</span>
              </span>
            </div>
            <div className="h-1.5 w-full bg-[rgba(255,255,255,0.06)] rounded-full overflow-hidden">
              <div className="h-full rounded-full transition-[width] duration-500" style={{ width: barWidth, background: barColor }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}
