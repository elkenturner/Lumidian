'use client';

import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { ResponsiveContainer, Line, LineChart, ReferenceLine } from 'recharts';
import type { CompetitiveGapResponse, CompetitiveGapWindow, CompetitorGapStat } from '@/lib/api';
import { CompetitiveGapTrendChart } from './CompetitiveGapTrendChart';
import { AskCoachButton } from '@/components/coach/AskCoachButton';

interface Props {
  open: boolean;
  onClose: () => void;
  brandId: number | null;
  brandName: string;
  data: CompetitiveGapResponse | null;
  window: CompetitiveGapWindow;
  onWindowChange: (w: CompetitiveGapWindow) => void;
}

const WINDOWS: CompetitiveGapWindow[] = ['7d', '30d', '90d'];

type SortKey = 'gap_pp' | 'name' | 'competitor_pct';

function formatPp(pp: number | null): string {
  if (pp === null) return '—';
  const sign = pp > 0 ? '+' : '';
  return `${sign}${pp.toFixed(1)} pts`;
}

function ppColor(pp: number | null): string {
  if (pp === null || pp === 0) return 'var(--text-faint)';
  return pp > 0 ? 'var(--success)' : 'var(--danger)';
}

export function CompetitiveGapDrawer({
  open, onClose, brandId, brandName, data, window, onWindowChange,
}: Props) {
  const [sortKey, setSortKey] = useState<SortKey>('gap_pp');
  const [sortDesc, setSortDesc] = useState(true);

  if (!data || brandId === null) return null;

  const sortedComps: CompetitorGapStat[] = [...data.competitors].sort((a, b) => {
    let cmp = 0;
    if (sortKey === 'name') cmp = a.name.localeCompare(b.name);
    else if (sortKey === 'competitor_pct') cmp = a.competitor_pct - b.competitor_pct;
    else cmp = Math.abs(a.gap_pp) - Math.abs(b.gap_pp);
    return sortDesc ? -cmp : cmp;
  });

  const toggleSort = (k: SortKey) => {
    if (k === sortKey) setSortDesc(!sortDesc);
    else { setSortKey(k); setSortDesc(true); }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center justify-between gap-4">
            <span>Competitive Gap — {brandName}</span>
            <div className="flex gap-1">
              {WINDOWS.map((w) => (
                <button
                  key={w}
                  type="button"
                  onClick={() => onWindowChange(w)}
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
          </DialogTitle>
        </DialogHeader>

        {data.confidence === 'low' && data.has_data && (
          <div className="bg-[rgba(245,158,11,0.1)] border border-[rgba(245,158,11,0.3)] rounded-lg px-3 py-2 text-xs text-[var(--warning)]">
            Based on {data.sample_count} queries — results stabilize after more runs.
          </div>
        )}

        <div className="flex items-baseline gap-4">
          <p className="text-3xl font-bold tabular-nums" style={{ color: ppColor(data.headline_gap_pp) }}>
            {formatPp(data.headline_gap_pp)}
          </p>
          <p className="text-xs text-[var(--text-muted)]">
            Your visibility {data.brand_visibility_pct?.toFixed(1) ?? '—'}%
            {' · '}
            Competitor average {data.competitor_avg_pct?.toFixed(1) ?? '—'}%
          </p>
          {data.headline_delta_pp !== null && (
            <p className="text-xs text-[var(--text-muted)] tabular-nums">
              <span style={{ color: ppColor(data.headline_delta_pp) }}>
                {data.headline_delta_pp === 0
                  ? 'No change'
                  : `${data.headline_delta_pp > 0 ? '↑' : '↓'}${Math.abs(data.headline_delta_pp).toFixed(1)} pts`}
              </span>{' '}
              vs prior {window}
            </p>
          )}
        </div>

        <div className="mt-2">
          <CompetitiveGapTrendChart data={data} />
        </div>

        <div className="mt-4">
          <table className="w-full text-xs">
            <thead className="text-[var(--text-faint)] uppercase text-[10px]">
              <tr>
                <th className="text-left py-2 cursor-pointer" onClick={() => toggleSort('name')}>Competitor</th>
                <th className="text-right py-2">You</th>
                <th className="text-right py-2 cursor-pointer" onClick={() => toggleSort('competitor_pct')}>Them</th>
                <th className="text-right py-2 cursor-pointer" onClick={() => toggleSort('gap_pp')}>Gap</th>
                <th className="text-right py-2">Δ</th>
                <th className="text-right py-2">Trend</th>
              </tr>
            </thead>
            <tbody>
              {sortedComps.map((c) => {
                if (!c.has_data) {
                  return (
                    <tr key={c.competitor_id} className="border-t border-[rgba(255,255,255,0.04)]">
                      <td className="py-2 text-[var(--text-secondary)]">{c.name}</td>
                      <td colSpan={5} className="py-2 text-[var(--text-faint)] text-right">
                        Added recently — needs more data
                      </td>
                    </tr>
                  );
                }
                return (
                  <tr key={c.competitor_id} className="border-t border-[rgba(255,255,255,0.04)]">
                    <td className="py-2 text-[var(--text-secondary)]">
                      {c.name}
                      {c.gap_pp < 0 && (
                        <AskCoachButton
                          brandId={brandId}
                          question={`Why is ${c.name} outperforming us in AI visibility over the last ${window}?`}
                          className="ml-2 text-[10px] text-[var(--text-faint)] hover:text-[var(--accent)] underline underline-offset-2"
                        >
                          Why are they ahead?
                        </AskCoachButton>
                      )}
                    </td>
                    <td className="py-2 text-right tabular-nums text-[var(--text-secondary)]">
                      {data.brand_visibility_pct?.toFixed(1) ?? '—'}%
                    </td>
                    <td className="py-2 text-right tabular-nums text-[var(--text-secondary)]">
                      {c.competitor_pct.toFixed(1)}%
                    </td>
                    <td className="py-2 text-right tabular-nums font-semibold" style={{ color: ppColor(c.gap_pp) }}>
                      {formatPp(c.gap_pp)}
                    </td>
                    <td className="py-2 text-right tabular-nums" style={{ color: ppColor(c.delta_pp) }}>
                      {c.delta_pp !== null ? formatPp(c.delta_pp) : '—'}
                    </td>
                    <td className="py-2" style={{ width: 80, height: 24 }}>
                      {c.trend.length >= 2 ? (
                        <ResponsiveContainer width="100%" height={24}>
                          <LineChart data={c.trend}>
                            <ReferenceLine y={0} stroke="rgba(255,255,255,0.1)" />
                            <Line type="monotone" dataKey="gap_pp" stroke={ppColor(c.gap_pp)} strokeWidth={1} dot={false} />
                          </LineChart>
                        </ResponsiveContainer>
                      ) : (
                        <span className="text-[var(--text-faint)] text-right block">—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </DialogContent>
    </Dialog>
  );
}
