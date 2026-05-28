'use client';

import { ResponsiveContainer, Line, LineChart, ReferenceLine } from 'recharts';
import { ArrowRight, Users } from 'lucide-react';
import type { CompetitiveGapResponse, CompetitiveGapWindow } from '@/lib/api';
import HelpTooltip from './HelpTooltip';

interface Props {
  data: CompetitiveGapResponse | null;
  loading: boolean;
  window: CompetitiveGapWindow;
  onWindowChange: (w: CompetitiveGapWindow) => void;
  onExpand: () => void;
  onAddCompetitorsClick: () => void;
}

const WINDOWS: CompetitiveGapWindow[] = ['7d', '30d', '90d'];

function formatGap(pp: number | null): string {
  if (pp === null) return '—';
  const sign = pp > 0 ? '+' : '';
  return `${sign}${pp.toFixed(1)}pp`;
}

function gapColor(pp: number | null): string {
  if (pp === null || pp === 0) return 'var(--text-faint)';
  return pp > 0 ? 'var(--success)' : 'var(--danger)';
}

function slopeColor(trend: { gap_pp: number }[]): string {
  if (trend.length < 2) return 'var(--text-faint)';
  const slope = trend[trend.length - 1].gap_pp - trend[0].gap_pp;
  return slope >= 0 ? 'var(--success)' : 'var(--danger)';
}

export function CompetitiveGapCard({
  data, loading, window, onWindowChange, onExpand, onAddCompetitorsClick,
}: Props) {
  // ── Loading
  if (loading) {
    return (
      <div className="card p-5 flex flex-col gap-3">
        <div className="h-4 w-32 bg-[var(--bg-tinted)] rounded animate-pulse" />
        <div className="h-10 w-24 bg-[var(--bg-tinted)] rounded animate-pulse" />
        <div className="h-12 w-full bg-[var(--bg-tinted)] rounded animate-pulse" />
      </div>
    );
  }

  // ── No competitors
  if (data && !data.has_competitors) {
    return (
      <div className="card p-5 flex flex-col">
        <div className="flex items-center justify-between mb-3">
          <p className="text-sm font-medium text-[var(--text-secondary)] flex items-center">
            Competitive Gap
            <HelpTooltip text="How far ahead or behind you are vs the average competitor — and whether the gap is closing." />
          </p>
        </div>
        <div className="flex flex-col items-start gap-3 mt-2">
          <p className="text-xs text-[var(--text-faint)]">
            Add competitors to see your AI-visibility gap.
          </p>
          <button
            onClick={onAddCompetitorsClick}
            className="flex items-center gap-1.5 text-xs text-[var(--text-muted)] hover:text-[var(--text-secondary)] bg-[var(--bg-tinted)] hover:bg-[var(--accent-muted)] border border-[var(--border-faint)] rounded-lg px-2.5 py-1.5 transition-colors"
          >
            <Users size={12} />
            Add competitors
          </button>
        </div>
      </div>
    );
  }

  const oneCompetitor = data && data.competitors.length === 1 ? data.competitors[0] : null;
  const subLabel = oneCompetitor ? `vs ${oneCompetitor.name}` : 'vs competitor avg';

  // ── No data yet
  if (data && !data.has_data) {
    return (
      <div className="card p-5 flex flex-col">
        <CardHeader window={window} onWindowChange={onWindowChange} />
        <p className="text-3xl font-bold text-[var(--text-primary)] mt-2">—</p>
        <p className="text-xs text-[var(--text-faint)] mt-1">
          {data.has_competitors
            ? 'Run a report to see your competitive position.'
            : 'No data in this window — try 30d or 90d.'}
        </p>
      </div>
    );
  }

  // ── Window has no data (has competitors + has_data was false handled above)
  if (data && data.trend.length === 0) {
    return (
      <div className="card p-5 flex flex-col">
        <CardHeader window={window} onWindowChange={onWindowChange} />
        <p className="text-3xl font-bold text-[var(--text-primary)] mt-2">—</p>
        <p className="text-xs text-[var(--text-faint)] mt-1">
          No runs in this window — try 30d or 90d.
        </p>
      </div>
    );
  }

  if (!data) return null;

  const headlineGap = data.headline_gap_pp;
  const delta = data.headline_delta_pp;
  const sparkData = data.trend;
  const showSparkline = sparkData.length >= 2;
  const topThree = [...data.competitors]
    .filter((c) => c.has_data)
    .sort((a, b) => Math.abs(b.gap_pp) - Math.abs(a.gap_pp))
    .slice(0, 3);
  const remaining = data.competitors.filter((c) => c.has_data).length - topThree.length;

  return (
    <button
      type="button"
      onClick={onExpand}
      className="card p-5 flex flex-col text-left hover:border-[var(--accent-border)] transition-colors group relative"
    >
      <ArrowRight
        size={14}
        className="absolute top-4 right-4 text-[var(--text-faint)] group-hover:text-[var(--accent)] transition-colors"
        aria-hidden="true"
      />
      <CardHeader
        window={window}
        onWindowChange={(w) => { onWindowChange(w); /* don't expand */ }}
      />

      <div className="mt-2">
        <p
          className="text-3xl font-bold tabular-nums"
          style={{ color: gapColor(headlineGap) }}
        >
          {formatGap(headlineGap)}
        </p>
        <p className="text-xs text-[var(--text-faint)] mt-1">{subLabel}</p>
      </div>

      {showSparkline && (
        <div className="mt-3" style={{ height: 36 }}>
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={sparkData}>
              <ReferenceLine y={0} stroke="rgba(255,255,255,0.12)" strokeDasharray="2 2" />
              <Line
                type="monotone"
                dataKey="gap_pp"
                stroke={slopeColor(sparkData)}
                strokeWidth={1.5}
                dot={false}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}

      {delta !== null && delta !== undefined && (
        <p className="text-xs text-[var(--text-muted)] mt-2 tabular-nums">
          <span style={{ color: gapColor(delta) }}>
            {delta > 0 ? '↑ +' : delta < 0 ? '↓ ' : ''}{delta.toFixed(1)}pp
          </span>{' '}
          vs prior {window}
        </p>
      )}

      {topThree.length > 0 && (
        <p className="text-[10px] text-[var(--text-faint)] mt-2">
          {topThree.map((c, i) => (
            <span key={c.competitor_id}>
              {i > 0 && <span className="mx-1">·</span>}
              <span className="text-[var(--text-muted)]">{c.name} </span>
              <span style={{ color: gapColor(c.gap_pp) }} className="tabular-nums">
                {formatGap(c.gap_pp)}
              </span>
            </span>
          ))}
          {remaining > 0 && <span className="ml-1">…and {remaining} more</span>}
        </p>
      )}
    </button>
  );
}

function CardHeader({
  window, onWindowChange,
}: { window: CompetitiveGapWindow; onWindowChange: (w: CompetitiveGapWindow) => void }) {
  return (
    <div className="flex items-center justify-between">
      <p className="text-sm font-medium text-[var(--text-secondary)] flex items-center">
        Competitive Gap
        <HelpTooltip text="How far ahead or behind you are vs the average competitor — and whether the gap is closing." />
      </p>
      <div className="flex gap-1">
        {WINDOWS.map((w) => (
          <button
            key={w}
            type="button"
            onClick={(e) => { e.stopPropagation(); onWindowChange(w); }}
            className={`px-2 py-0.5 rounded text-[10px] tabular-nums transition-colors ${
              w === window
                ? 'bg-[var(--accent)] text-white'
                : 'bg-[var(--bg-tinted)] text-[var(--text-muted)] hover:text-[var(--text-secondary)]'
            }`}
          >
            {w}
          </button>
        ))}
      </div>
    </div>
  );
}
