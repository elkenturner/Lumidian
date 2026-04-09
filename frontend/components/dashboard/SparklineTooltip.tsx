'use client';

import { TrendPoint } from '@/lib/api';

interface SparklineTooltipProps {
  active?: boolean;
  payload?: Array<{ value: number; payload: TrendPoint & { formattedDate: string } }>;
}

export default function SparklineTooltip({ active, payload }: SparklineTooltipProps) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <div className="bg-[var(--bg-base)] border border-[var(--accent-border)] rounded-lg p-2 shadow-lg text-xs">
      <p className="text-[var(--text-muted)]">{d.formattedDate}</p>
      <p className="text-[var(--accent)] font-bold">{Math.round(d.score)}%</p>
    </div>
  );
}
