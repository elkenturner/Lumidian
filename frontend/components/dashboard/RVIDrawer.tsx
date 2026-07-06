'use client';

import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import {
  Area, AreaChart, CartesianGrid, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import { ShieldCheck } from 'lucide-react';
import type { RVIResponse, RVIWindow } from '@/lib/api';
import { setCompetitorPeerPool } from '@/lib/api';
import { AskCoachButton } from '@/components/coach/AskCoachButton';
import { fmtPeerPct, peerPctColor, rviTrendToPct, PeerRateTooltip } from './rviDisplay';

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

/** Horizontal comparison bar: label · track · value. Track max is shared so bars compare. */
function CompareBar({
  label, pct, max, accent = false, coach,
}: { label: string; pct: number; max: number; accent?: boolean; coach?: React.ReactNode }) {
  const width = max > 0 ? Math.max((pct / max) * 100, pct > 0 ? 2 : 0) : 0;
  return (
    <div className="flex items-center gap-3">
      <div className="w-32 flex-shrink-0 flex items-center gap-1.5 min-w-0">
        <span className={`text-xs truncate ${accent ? 'text-[var(--text-primary)] font-medium' : 'text-[var(--text-secondary)]'}`}>
          {label}
        </span>
        {coach}
      </div>
      <div className="flex-1 h-2 rounded-full bg-[var(--bg-tinted)] overflow-hidden">
        <div
          className="h-full rounded-full"
          style={{ width: `${width}%`, background: accent ? 'var(--accent)' : 'rgba(148,163,184,0.45)' }}
        />
      </div>
      <span className="w-12 text-right text-xs tabular-nums text-[var(--text-muted)] flex-shrink-0">
        {pct.toFixed(0)}%
      </span>
    </div>
  );
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

  const trendPct = rviTrendToPct(data.trend);
  const trendMax = trendPct.length ? Math.max(...trendPct.map((t) => t.pct)) : 0;
  // Show the 100% parity line only when the data gets near it — pinning the
  // axis to 100 when you're at 9% would flatten the trend into noise.
  const showParity = trendMax >= 70;
  const yMax = showParity ? Math.max(Math.ceil(trendMax * 1.15), 110) : Math.max(Math.ceil(trendMax * 1.25), 10);

  // Shared scale for all comparison bars: everything relative to the biggest value shown
  const barMax = Math.max(
    data.brand_pct ?? 0,
    data.peer_avg_pct ?? 0,
    ...data.peers.map((p) => p.pct ?? 0),
    1,
  );

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
            Based on {data.sample_count} answers so far — this number steadies as more reports run.
          </div>
        )}

        {/* Headline: the % of peer rate, said plainly, then shown as two bars */}
        {data.rvi !== null ? (
          <div>
            <div className="flex items-baseline gap-3 flex-wrap">
              <p className="text-3xl font-bold" style={{ color: peerPctColor(data.rvi) }}>
                {fmtPeerPct(data.rvi)}
              </p>
              <p className="text-sm text-[var(--text-secondary)]">
                of your peers&apos; citation rate
              </p>
            </div>
            <p className="text-xs text-[var(--text-faint)] mt-1">
              On the {data.contested_prompt_count} prompt{data.contested_prompt_count !== 1 ? 's' : ''} where
              a competitor shows up, AI mentions you in {data.brand_pct?.toFixed(0)}% of answers — your
              peers average {data.peer_avg_pct?.toFixed(0)}%.
            </p>
            <div className="mt-3 space-y-2">
              <CompareBar label="You" pct={data.brand_pct ?? 0} max={barMax} accent />
              <CompareBar label="Peer average" pct={data.peer_avg_pct ?? 0} max={barMax} />
            </div>
          </div>
        ) : (
          <p className="text-xs text-[var(--text-muted)]">
            No competitor appears on any prompt you track in this window — there is nothing to compare against yet.
          </p>
        )}

        {/* Trend */}
        {trendPct.length >= 2 && (
          <div>
            <p className="text-xs font-semibold text-[var(--text-secondary)] uppercase tracking-wider mb-2">
              Trend
            </p>
            <div className="w-full" style={{ height: 180 }}>
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={trendPct} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="rviDrawerGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="var(--accent)" stopOpacity={0.2} />
                      <stop offset="95%" stopColor="var(--accent)" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid stroke="rgba(255,255,255,0.05)" vertical={false} />
                  <XAxis
                    dataKey="formattedDate"
                    tick={{ fontSize: 10, fill: 'var(--text-faint)' }}
                    axisLine={{ stroke: 'rgba(255,255,255,0.08)' }}
                    tickLine={false}
                  />
                  <YAxis
                    tick={{ fontSize: 10, fill: 'var(--text-faint)' }}
                    tickFormatter={(v: number) => `${v}%`}
                    domain={[0, yMax]}
                    axisLine={false}
                    tickLine={false}
                    width={40}
                  />
                  <Tooltip content={<PeerRateTooltip />} cursor={{ stroke: 'rgba(255,255,255,0.15)', strokeWidth: 1 }} />
                  {showParity && (
                    <ReferenceLine
                      y={100}
                      stroke="rgba(255,255,255,0.25)"
                      strokeDasharray="4 3"
                      label={{ value: 'even with peers', position: 'insideTopRight', fontSize: 9, fill: 'var(--text-faint)' }}
                    />
                  )}
                  <Area
                    type="monotone"
                    dataKey="pct"
                    stroke="var(--accent)"
                    strokeWidth={2}
                    fill="url(#rviDrawerGrad)"
                    dot={false}
                    activeDot={{ r: 4, strokeWidth: 2, stroke: 'var(--bg-card)' }}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
            <p className="text-[10px] text-[var(--text-faint)] mt-1">
              Your citations as a share of the peer average, by day. 100% = even with peers.
            </p>
          </div>
        )}

        {/* Contested prompts — worst first, as You-vs-peers bars */}
        {data.contested_prompts.length > 0 && (
          <div>
            <p className="text-xs font-semibold text-[var(--text-secondary)] uppercase tracking-wider mb-1">
              Prompts you&apos;re competing for
            </p>
            <p className="text-[10px] text-[var(--text-faint)] mb-3">
              Biggest gaps first — these are where content work moves the number.
            </p>
            <div className="space-y-4">
              {data.contested_prompts.map((p) => {
                const rowMax = Math.max(p.brand_pct, p.peer_avg_pct, 1);
                return (
                  <div key={p.prompt_id}>
                    <p className="text-xs text-[var(--text-primary)] mb-1.5">{p.text}</p>
                    <div className="space-y-1.5">
                      <CompareBar label="You" pct={p.brand_pct} max={rowMax} accent />
                      <CompareBar label="Peers" pct={p.peer_avg_pct} max={rowMax} />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Owned territory */}
        {data.owned_prompts.length > 0 && (
          <div>
            <p className="text-xs font-semibold text-[var(--text-secondary)] uppercase tracking-wider mb-2 flex items-center gap-1.5">
              <ShieldCheck size={12} className="text-[var(--success)]" />
              Prompts you own
            </p>
            <div className="space-y-1">
              {data.owned_prompts.map((p) => (
                <div key={p.prompt_id} className="flex items-center justify-between gap-3 py-1.5 border-t border-[rgba(255,255,255,0.04)]">
                  <span className="text-xs text-[var(--text-secondary)]">{p.text}</span>
                  <span className="text-xs tabular-nums text-[var(--text-muted)] flex-shrink-0">
                    you: {p.brand_pct.toFixed(0)}% · no competitor appears
                  </span>
                </div>
              ))}
            </div>
            <p className="text-[10px] text-[var(--text-faint)] mt-2">
              These stay out of the comparison — no competitor registers, so it&apos;s yours to defend.
            </p>
          </div>
        )}

        {/* Peer pool management */}
        <div>
          <p className="text-xs font-semibold text-[var(--text-secondary)] uppercase tracking-wider mb-2">
            Who counts as a peer
          </p>
          <div className="space-y-2">
            {data.brand_pct !== null && (
              <div className="flex items-center gap-2">
                <div className="flex-1 min-w-0">
                  <CompareBar label="You" pct={data.brand_pct} max={barMax} accent />
                </div>
                {/* spacer matches the Exclude button column so all bar tracks share one scale */}
                <span className="w-14 flex-shrink-0" aria-hidden="true" />
              </div>
            )}
            {data.peers.map((p) => (
              <div key={p.competitor_id} className="flex items-center gap-2">
                <div className="flex-1 min-w-0">
                  <CompareBar
                    label={p.name}
                    pct={p.pct ?? 0}
                    max={barMax}
                    coach={
                      data.brand_pct !== null && p.pct !== null && p.pct > data.brand_pct ? (
                        <AskCoachButton
                          brandId={brandId}
                          question={`Why is ${p.name} cited more often than us by AI models over the last ${window}?`}
                          className="text-[10px] text-[var(--text-faint)] hover:text-[var(--accent)] underline underline-offset-2 flex-shrink-0"
                        >
                          Why?
                        </AskCoachButton>
                      ) : undefined
                    }
                  />
                </div>
                <button
                  type="button"
                  disabled={togglingId === p.competitor_id}
                  onClick={() => handleToggle(p.competitor_id, false)}
                  className="w-14 text-center text-[10px] text-[var(--text-faint)] hover:text-[var(--warning)] bg-[var(--bg-tinted)] rounded px-2 py-0.5 transition-colors disabled:opacity-50 flex-shrink-0"
                  title="Stop comparing against this competitor (still tracked everywhere else)"
                >
                  Exclude
                </button>
              </div>
            ))}
            {data.excluded.map((e) => (
              <div key={e.competitor_id} className="flex items-center justify-between gap-3 py-1 opacity-60">
                <span className="text-xs text-[var(--text-faint)]">
                  {e.name}
                  <span className="ml-2 text-[10px] uppercase tracking-wider">not compared</span>
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
            Excluded competitors stay tracked but don&apos;t count toward the comparison —
            useful for giants that aren&apos;t really your weight class.
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
