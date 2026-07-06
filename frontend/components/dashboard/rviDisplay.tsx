'use client';

/**
 * Shared display language for Relative Visibility.
 *
 * The backend metric is a ratio (RVI: 1.0 = parity with the peer pool). The UI
 * never shows the ratio — it always speaks in "% of your peers' citation rate"
 * (100% = parity), which is the same number ×100.
 */
import type { RVITrendPoint } from '@/lib/api';

/** 0.09 → "9%", 1.4 → "140%", 0.004 → "<1%" */
export function fmtPeerPct(rvi: number): string {
  const pct = rvi * 100;
  if (pct > 0 && pct < 1) return '<1%';
  return `${Math.round(pct)}%`;
}

export function peerPctColor(rvi: number | null): string {
  if (rvi === null) return 'var(--text-faint)';
  return rvi >= 1 ? 'var(--success-text)' : 'var(--danger-text)';
}

export interface PeerRatePoint {
  date: string;
  formattedDate: string;
  pct: number;
}

export function rviTrendToPct(trend: RVITrendPoint[]): PeerRatePoint[] {
  return trend.map((t) => {
    const d = new Date(`${t.date}T00:00:00Z`);
    return {
      date: t.date,
      formattedDate: d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }),
      pct: Math.round(t.rvi * 100),
    };
  });
}

interface TooltipProps {
  active?: boolean;
  payload?: Array<{ value: number; payload: PeerRatePoint }>;
}

export function PeerRateTooltip({ active, payload }: TooltipProps) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <div className="bg-[var(--bg-base)] border border-[var(--accent-border)] rounded-lg p-2 shadow-lg text-xs">
      <p className="text-[var(--text-muted)]">{d.formattedDate}</p>
      <p className="text-[var(--text-primary)] font-bold">
        {d.pct}% <span className="font-normal text-[var(--text-muted)]">of peer rate</span>
      </p>
    </div>
  );
}

/**
 * Recharts dot renderer that marks only the most recent point: a filled dot
 * with a 2px surface-colored ring so it stays legible over the line.
 */
export function EndpointDot(props: {
  cx?: number; cy?: number; index?: number; lastIndex: number; stroke?: string;
}) {
  const { cx, cy, index, lastIndex } = props;
  if (index !== lastIndex || cx === undefined || cy === undefined) return null;
  return (
    <circle
      cx={cx}
      cy={cy}
      r={4}
      fill="var(--accent)"
      stroke="var(--bg-card)"
      strokeWidth={2}
    />
  );
}
