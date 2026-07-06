'use client';

import { ResponsiveContainer, Line, LineChart, ReferenceLine } from 'recharts';
import { ArrowRight, ShieldCheck, Users } from 'lucide-react';
import type { RVIResponse, RVIWindow } from '@/lib/api';
import HelpTooltip from './HelpTooltip';

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
  'Relative Visibility Index: how often AI cites you vs the average of your peer pool, ' +
  'on prompts where at least one peer shows up. 1.0× = cited at the peer rate. ' +
  'A ratio, so category-wide citation shifts cancel out.';

function rviColor(rvi: number | null): string {
  if (rvi === null) return 'var(--text-faint)';
  return rvi >= 1 ? 'var(--success-text)' : 'var(--danger-text)';
}

/** The plain-English sentence is the product; the × index is the compact form. */
function rviSentence(rvi: number): string {
  if (rvi >= 1) {
    return `Cited ${rvi.toFixed(1)}× as often as your typical peer on contested prompts`;
  }
  return `Cited at ${Math.round(rvi * 100)}% of your peers' rate on contested prompts`;
}

function poolFootnote(data: RVIResponse): string {
  const names = data.peers.map((p) => p.name);
  const shown = names.slice(0, 3).join(', ');
  const more = names.length > 3 ? ` +${names.length - 3}` : '';
  const excluded = data.excluded.length > 0
    ? ` · ${data.excluded.map((e) => e.name).join(', ')} excluded`
    : '';
  return `Peers: ${shown}${more}${excluded}`;
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

  // ── Full owned territory: no contested prompts, so no ratio to show
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
          No peer registers on any prompt you track — you hold{' '}
          {data.owned_prompt_count} prompt{data.owned_prompt_count !== 1 ? 's' : ''} uncontested.
        </p>
        <p className="text-[10px] text-[var(--text-faint)] mt-auto pt-3">{poolFootnote(data)}</p>
      </div>
    );
  }

  const showSparkline = data.trend.length >= 2;

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
        <p className="text-3xl font-bold tabular-nums" style={{ color: rviColor(data.rvi) }}>
          {data.rvi.toFixed(2)}
          <span className="text-xl font-semibold">×</span>
        </p>
        <p className="text-xs text-[var(--text-muted)] mt-1 leading-relaxed">
          {rviSentence(data.rvi)}
        </p>
      </div>

      {showSparkline && (
        <div className="mt-3" style={{ height: 36 }}>
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data.trend}>
              <ReferenceLine y={1} stroke="rgba(255,255,255,0.12)" strokeDasharray="2 2" />
              <Line
                type="monotone"
                dataKey="rvi"
                stroke={rviColor(data.rvi)}
                strokeWidth={1.5}
                dot={false}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}

      {data.rvi_delta !== null && (
        <p className="text-xs text-[var(--text-muted)] mt-2 tabular-nums">
          <span style={{ color: data.rvi_delta === 0 ? 'var(--text-faint)' : data.rvi_delta > 0 ? 'var(--success-text)' : 'var(--danger-text)' }}>
            {data.rvi_delta === 0
              ? 'No change'
              : `${data.rvi_delta > 0 ? '↑' : '↓'}${Math.abs(data.rvi_delta).toFixed(2)}`}
          </span>{' '}
          vs prior {window}
        </p>
      )}

      {data.owned_prompt_count > 0 && (
        <p className="text-xs mt-2 flex items-center gap-1.5">
          <ShieldCheck size={12} className="text-[var(--success)] flex-shrink-0" />
          <span className="text-[var(--text-muted)]">
            Owns {data.owned_prompt_count} prompt{data.owned_prompt_count !== 1 ? 's' : ''} — no peer registers
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
