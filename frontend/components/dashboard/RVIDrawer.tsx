'use client';

import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import {
  CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import { ShieldCheck } from 'lucide-react';
import type { RVIResponse, RVIWindow } from '@/lib/api';
import { setCompetitorPeerPool } from '@/lib/api';
import { AskCoachButton } from '@/components/coach/AskCoachButton';

interface Props {
  open: boolean;
  onClose: () => void;
  brandId: number | null;
  brandName: string;
  data: RVIResponse | null;
  window: RVIWindow;
  onWindowChange: (w: RVIWindow) => void;
  /** Called after a peer-pool toggle succeeds so the parent refetches RVI + competitors. */
  onPoolChanged: () => void;
}

const WINDOWS: RVIWindow[] = ['7d', '30d', '90d'];

function rviColor(rvi: number | null): string {
  if (rvi === null) return 'var(--text-faint)';
  return rvi >= 1 ? 'var(--success-text)' : 'var(--danger-text)';
}

export function RVIDrawer({
  open, onClose, brandId, brandName, data, window, onWindowChange, onPoolChanged,
}: Props) {
  const [togglingId, setTogglingId] = useState<number | null>(null);

  if (!data || brandId === null) return null;

  const handleToggle = async (competitorId: number, nextInPool: boolean) => {
    setTogglingId(competitorId);
    try {
      await setCompetitorPeerPool(brandId, competitorId, nextInPool);
      onPoolChanged();
    } finally {
      setTogglingId(null);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center justify-between gap-4">
            <span>Relative Visibility — {brandName}</span>
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

        {data.confidence === 'low' && data.has_data && data.rvi !== null && (
          <div className="bg-[rgba(245,158,11,0.1)] border border-[rgba(245,158,11,0.3)] rounded-lg px-3 py-2 text-xs text-[var(--warning)]">
            Based on {data.sample_count} contested queries — the index stabilizes after more runs.
          </div>
        )}

        {/* Headline */}
        {data.rvi !== null ? (
          <div className="flex items-baseline gap-4 flex-wrap">
            <p className="text-3xl font-bold tabular-nums" style={{ color: rviColor(data.rvi) }}>
              {data.rvi.toFixed(2)}×
            </p>
            <p className="text-xs text-[var(--text-muted)]">
              You {data.brand_pct?.toFixed(1) ?? '—'}%
              {' · '}
              Peer average {data.peer_avg_pct?.toFixed(1) ?? '—'}%
              {' · '}
              {data.contested_prompt_count} contested prompt{data.contested_prompt_count !== 1 ? 's' : ''}
            </p>
            {data.rvi_delta !== null && (
              <p className="text-xs text-[var(--text-muted)] tabular-nums">
                <span style={{ color: data.rvi_delta === 0 ? 'var(--text-faint)' : data.rvi_delta > 0 ? 'var(--success-text)' : 'var(--danger-text)' }}>
                  {data.rvi_delta === 0 ? 'No change' : `${data.rvi_delta > 0 ? '↑' : '↓'}${Math.abs(data.rvi_delta).toFixed(2)}`}
                </span>{' '}
                vs prior {window}
              </p>
            )}
          </div>
        ) : (
          <p className="text-xs text-[var(--text-muted)]">
            No contested prompts in this window — no peer in the pool registers on any prompt you track.
          </p>
        )}

        {/* Trend */}
        {data.trend.length >= 2 && (
          <div className="w-full" style={{ height: 200 }}>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={data.trend}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--bg-tinted)" />
                <XAxis dataKey="date" tick={{ fontSize: 10, fill: 'var(--text-faint)' }} />
                <YAxis
                  tick={{ fontSize: 10, fill: 'var(--text-faint)' }}
                  domain={[0, (dataMax: number) => Math.max(1.2, Math.ceil(dataMax * 10) / 10)]}
                  tickFormatter={(v: number) => `${v}×`}
                />
                <Tooltip
                  contentStyle={{
                    background: 'var(--bg-elevated)',
                    border: '1px solid var(--border-faint)',
                    borderRadius: 6,
                    fontSize: 11,
                  }}
                  formatter={(value) => [`${Number(value).toFixed(2)}×`, 'RVI']}
                />
                <ReferenceLine
                  y={1}
                  stroke="rgba(255,255,255,0.25)"
                  strokeDasharray="4 3"
                  label={{ value: 'peer rate', position: 'insideTopRight', fontSize: 9, fill: 'var(--text-faint)' }}
                />
                <Line type="monotone" dataKey="rvi" stroke="var(--accent)" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}

        {/* Peer pool */}
        <div>
          <p className="text-xs font-semibold text-[var(--text-secondary)] uppercase tracking-wider mb-2">
            Peer pool
          </p>
          <div className="space-y-1.5">
            {data.peers.map((p) => (
              <div key={p.competitor_id} className="flex items-center justify-between gap-3 py-1.5 border-t border-[rgba(255,255,255,0.04)]">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="text-xs text-[var(--text-secondary)] truncate">{p.name}</span>
                  {data.brand_pct !== null && p.pct !== null && p.pct > data.brand_pct && (
                    <AskCoachButton
                      brandId={brandId}
                      question={`Why is ${p.name} cited more often than us by AI models over the last ${window}?`}
                      className="text-[10px] text-[var(--text-faint)] hover:text-[var(--accent)] underline underline-offset-2 flex-shrink-0"
                    >
                      Why ahead?
                    </AskCoachButton>
                  )}
                </div>
                <div className="flex items-center gap-3 flex-shrink-0">
                  <span className="text-xs tabular-nums text-[var(--text-muted)]">
                    {p.pct !== null ? `${p.pct.toFixed(1)}%` : '—'}
                    {p.prompt_hits > 0 && (
                      <span className="text-[var(--text-faint)]"> · {p.prompt_hits} prompt{p.prompt_hits !== 1 ? 's' : ''}</span>
                    )}
                  </span>
                  <button
                    type="button"
                    disabled={togglingId === p.competitor_id}
                    onClick={() => handleToggle(p.competitor_id, false)}
                    className="text-[10px] text-[var(--text-faint)] hover:text-[var(--warning)] bg-[var(--bg-tinted)] rounded px-2 py-0.5 transition-colors disabled:opacity-50"
                    title="Exclude from the RVI denominator (stays tracked everywhere else)"
                  >
                    Exclude
                  </button>
                </div>
              </div>
            ))}
            {data.excluded.map((e) => (
              <div key={e.competitor_id} className="flex items-center justify-between gap-3 py-1.5 border-t border-[rgba(255,255,255,0.04)] opacity-60">
                <span className="text-xs text-[var(--text-faint)]">
                  {e.name}
                  <span className="ml-2 text-[10px] uppercase tracking-wider">excluded</span>
                </span>
                <button
                  type="button"
                  disabled={togglingId === e.competitor_id}
                  onClick={() => handleToggle(e.competitor_id, true)}
                  className="text-[10px] text-[var(--text-faint)] hover:text-[var(--success)] bg-[var(--bg-tinted)] rounded px-2 py-0.5 transition-colors disabled:opacity-50"
                >
                  Include
                </button>
              </div>
            ))}
          </div>
          <p className="text-[10px] text-[var(--text-faint)] mt-2 leading-relaxed">
            Excluded competitors stay tracked but don&apos;t count toward the peer average —
            use this for incumbents in a different weight class.
          </p>
        </div>

        {/* Contested prompts */}
        {data.contested_prompts.length > 0 && (
          <div>
            <p className="text-xs font-semibold text-[var(--text-secondary)] uppercase tracking-wider mb-2">
              Contested prompts
            </p>
            <table className="w-full text-xs">
              <thead className="text-[var(--text-faint)] uppercase text-[10px]">
                <tr>
                  <th className="text-left py-2 font-medium">Prompt</th>
                  <th className="text-right py-2 font-medium">You</th>
                  <th className="text-right py-2 font-medium">Peers</th>
                  <th className="text-right py-2 font-medium">RVI</th>
                </tr>
              </thead>
              <tbody>
                {data.contested_prompts.map((p) => (
                  <tr key={p.prompt_id} className="border-t border-[rgba(255,255,255,0.04)]">
                    <td className="py-2 pr-3 text-[var(--text-secondary)]">{p.text}</td>
                    <td className="py-2 text-right tabular-nums text-[var(--text-secondary)]">{p.brand_pct.toFixed(0)}%</td>
                    <td className="py-2 text-right tabular-nums text-[var(--text-secondary)]">{p.peer_avg_pct.toFixed(0)}%</td>
                    <td className="py-2 text-right tabular-nums font-semibold" style={{ color: rviColor(p.rvi) }}>
                      {p.rvi.toFixed(2)}×
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Owned territory */}
        {data.owned_prompts.length > 0 && (
          <div>
            <p className="text-xs font-semibold text-[var(--text-secondary)] uppercase tracking-wider mb-2 flex items-center gap-1.5">
              <ShieldCheck size={12} className="text-[var(--success)]" />
              Owned territory
            </p>
            <div className="space-y-1">
              {data.owned_prompts.map((p) => (
                <div key={p.prompt_id} className="flex items-center justify-between gap-3 py-1.5 border-t border-[rgba(255,255,255,0.04)]">
                  <span className="text-xs text-[var(--text-secondary)]">{p.text}</span>
                  <span className="text-xs tabular-nums text-[var(--text-muted)] flex-shrink-0">
                    {p.brand_pct.toFixed(0)}% · no peer registers
                  </span>
                </div>
              ))}
            </div>
            <p className="text-[10px] text-[var(--text-faint)] mt-2">
              Defend these — they don&apos;t enter the index because there is no peer to compare against.
            </p>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
