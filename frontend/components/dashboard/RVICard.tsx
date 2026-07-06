'use client';

import { ResponsiveContainer, Area, AreaChart, Tooltip, YAxis } from 'recharts';
import { ArrowRight, ShieldCheck, Users } from 'lucide-react';
import type { RVIResponse, RVIWindow } from '@/lib/api';
import HelpTooltip from './HelpTooltip';
import { fmtPeerPct, peerPctColor, rviTrendToPct, PeerRateTooltip, EndpointDot } from './rviDisplay';

interface Props {
  data: RVIResponse | null;
  loading: boolean;
  window: RVIWindow;
  onWindowChange: (w: RVIWindow) => void;
  onExpand: () => void;
  onAddCompetitorsClick: () => void;
}

const WINDOWS: RVIWindow[] = ['7d', '30d', '90d'];

const HELP_TEXT =
  'How often AI cites you compared to the average of your competitors, on prompts ' +
  'where at least one of them shows up. 100% = cited as often as a typical peer. ' +
  "It's a share of their rate, so market-wide citation shifts don't distort it.";

function poolFootnote(data: RVIResponse): string {
  const names = data.peers.map((p) => p.name);
  const shown = names.slice(0, 3).join(', ');
  const more = names.length > 3 ? ` +${names.length - 3}` : '';
  const excluded = data.excluded.length > 0
    ? ` · ${data.excluded.map((e) => e.name).join(', ')} excluded`
    : '';
  return `Peers: ${shown}${more}${excluded}`;
}

/** "Up from 4% in the prior 7d" — the delta as a plain sentence. */
function deltaSentence(data: RVIResponse, window: RVIWindow): string | null {
  if (data.rvi === null || data.rvi_delta === null) return null;
  if (data.rvi_delta === 0) return `No change vs the prior ${window}`;
  const prior = Math.round((data.rvi - data.rvi_delta) * 100);
  return data.rvi_delta > 0
    ? `Up from ${prior}% in the prior ${window}`
    : `Down from ${prior}% in the prior ${window}`;
}

export function RVICard({
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

  // ── Fetch failed — keep the grid slot filled, never collapse the hero row
  if (!data) {
    return (
      <div className="card p-5 h-full flex flex-col">
        <CardHeader window={window} onWindowChange={onWindowChange} />
        <p className="text-3xl font-bold text-[var(--text-primary)] mt-2">&mdash;</p>
        <p className="text-xs text-[var(--text-faint)] mt-1">
          Relative visibility couldn&apos;t be loaded — refresh to try again.
        </p>
      </div>
    );
  }

  // ── Competitors exist but every one is excluded from the pool
  if (!data.has_peers) {
    return (
      <div className="card p-5 h-full flex flex-col">
        <CardHeader window={window} onWindowChange={onWindowChange} />
        <div className="flex flex-col items-start gap-3 mt-3">
          <p className="text-xs text-[var(--text-faint)] leading-relaxed">
            {data.excluded.length > 0
              ? 'All competitors are excluded from the peer pool, so there is no one to compare against.'
              : 'Add competitors to see how your AI visibility compares to your peers.'}
          </p>
          <button
            onClick={onAddCompetitorsClick}
            className="flex items-center gap-1.5 text-xs text-[var(--text-muted)] hover:text-[var(--text-secondary)] bg-[var(--bg-tinted)] hover:bg-[var(--accent-muted)] border border-[var(--border-faint)] rounded-lg px-2.5 py-1.5 transition-colors"
          >
            <Users size={12} />
            {data.excluded.length > 0 ? 'Manage competitors' : 'Add competitors'}
          </button>
        </div>
      </div>
    );
  }

  // ── No runs / results in window
  if (!data.has_data) {
    return (
      <div className="card p-5 h-full flex flex-col">
        <CardHeader window={window} onWindowChange={onWindowChange} />
        <p className="text-3xl font-bold text-[var(--text-primary)] mt-2">&mdash;</p>
        <p className="text-xs text-[var(--text-faint)] mt-1">
          No runs in this window — run a report or try 30d / 90d.
        </p>
      </div>
    );
  }

  // ── Full owned territory: no competitor registers anywhere
  if (data.rvi === null) {
    return (
      <div
        role="button"
        tabIndex={0}
        onClick={onExpand}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onExpand(); } }}
        className="card p-5 h-full flex flex-col text-left hover:border-[var(--accent-border)] transition-colors group relative cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
      >
        <ArrowRight size={14} className="absolute top-4 right-4 text-[var(--text-faint)] group-hover:text-[var(--accent)] transition-colors" aria-hidden="true" />
        <CardHeader window={window} onWindowChange={onWindowChange} />
        <div className="flex items-center gap-2 mt-3">
          <ShieldCheck size={18} className="text-[var(--success)]" />
          <p className="text-lg font-bold text-[var(--text-primary)]">Territory owned</p>
        </div>
        <p className="text-xs text-[var(--text-muted)] mt-1.5 leading-relaxed">
          No competitor appears on any prompt you track — you hold{' '}
          {data.owned_prompt_count} prompt{data.owned_prompt_count !== 1 ? 's' : ''} uncontested.
        </p>
        <p className="text-[10px] text-[var(--text-faint)] mt-auto pt-3">{poolFootnote(data)}</p>
      </div>
    );
  }

  const trendPct = rviTrendToPct(data.trend);
  const delta = deltaSentence(data, window);

  return (
    // Not a <button>: it contains the window-toggle buttons, and a button
    // inside a button is invalid HTML (hydration error).
    <div
      role="button"
      tabIndex={0}
      onClick={onExpand}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onExpand(); } }}
      className="card p-5 h-full flex flex-col text-left hover:border-[var(--accent-border)] transition-colors group relative cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
    >
      <ArrowRight
        size={14}
        className="absolute top-4 right-4 text-[var(--text-faint)] group-hover:text-[var(--accent)] transition-colors"
        aria-hidden="true"
      />
      <CardHeader window={window} onWindowChange={onWindowChange} />

      <div className="mt-2">
        <p className="text-3xl font-bold" style={{ color: peerPctColor(data.rvi) }}>
          {fmtPeerPct(data.rvi)}
        </p>
        <p className="text-xs text-[var(--text-muted)] mt-1 leading-relaxed">
          of your peers&apos; citation rate on prompts you&apos;re competing for
        </p>
      </div>

      {trendPct.length >= 2 && (
        <div className="mt-3 border-b border-[rgba(255,255,255,0.07)]" style={{ height: 44 }}>
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={trendPct} margin={{ top: 6, right: 6, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="rviSparkGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="var(--accent)" stopOpacity={0.22} />
                  <stop offset="95%" stopColor="var(--accent)" stopOpacity={0} />
                </linearGradient>
              </defs>
              <YAxis hide domain={[0, (dataMax: number) => Math.max(dataMax * 1.25, 10)]} />
              <Tooltip content={<PeerRateTooltip />} cursor={{ stroke: 'rgba(255,255,255,0.15)', strokeWidth: 1 }} />
              <Area
                type="monotone"
                dataKey="pct"
                stroke="var(--accent)"
                strokeWidth={2}
                fill="url(#rviSparkGrad)"
                dot={<EndpointDot lastIndex={trendPct.length - 1} />}
                activeDot={{ r: 4, strokeWidth: 2, stroke: 'var(--bg-card)' }}
                isAnimationActive={false}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}

      {delta && (
        <p className="text-xs mt-2" style={{
          color: data.rvi_delta === 0 || data.rvi_delta === null
            ? 'var(--text-faint)'
            : data.rvi_delta > 0 ? 'var(--success-text)' : 'var(--danger-text)',
        }}>
          {data.rvi_delta !== null && data.rvi_delta !== 0 && (data.rvi_delta > 0 ? '↑ ' : '↓ ')}
          {delta}
        </p>
      )}

      {data.owned_prompt_count > 0 && (
        <p className="text-xs mt-2 flex items-center gap-1.5">
          <ShieldCheck size={12} className="text-[var(--success)] flex-shrink-0" />
          <span className="text-[var(--text-muted)]">
            Owns {data.owned_prompt_count} prompt{data.owned_prompt_count !== 1 ? 's' : ''} uncontested
          </span>
        </p>
      )}

      <p className="text-[10px] text-[var(--text-faint)] mt-auto pt-3">{poolFootnote(data)}</p>
    </div>
  );
}

function CardHeader({
  window, onWindowChange,
}: { window: RVIWindow; onWindowChange: (w: RVIWindow) => void }) {
  return (
    <div className="flex items-center justify-between">
      <p className="text-sm font-medium text-[var(--text-secondary)] flex items-center">
        Relative Visibility
        <HelpTooltip text={HELP_TEXT} />
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
