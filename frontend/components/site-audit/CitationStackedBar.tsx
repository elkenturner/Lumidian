'use client';

import HelpTooltip from '@/components/dashboard/HelpTooltip';

interface Props {
  ownPct: number;
  competitorPct: number;
  thirdPartyPct: number;
  unknownPct: number;
}

const SEGMENTS = [
  { key: 'own', label: 'You', color: 'var(--success)', explanation: 'Citations where AI search linked back to a page on your own domain.' },
  { key: 'competitor', label: 'Competitor', color: 'var(--danger-text)', explanation: 'Citations to a domain you tagged as a competitor.' },
  { key: 'thirdParty', label: 'Third-party authority', color: 'var(--color-perplexity)', explanation: 'Wikipedia, G2, LinkedIn, YouTube, Reddit, Producthunt, etc.' },
  { key: 'unknown', label: 'Other', color: 'var(--text-muted)', explanation: 'Other domains — could be news outlets, niche sites, etc.' },
] as const;

export function CitationStackedBar({ ownPct, competitorPct, thirdPartyPct, unknownPct }: Props) {
  const values: Record<string, number> = {
    own: ownPct,
    competitor: competitorPct,
    thirdParty: thirdPartyPct,
    unknown: unknownPct,
  };

  return (
    <div className="card">
      <div className="flex items-baseline justify-between mb-3">
        <h3 className="text-base font-semibold text-[var(--text-primary)]">Citation share</h3>
        <p className="text-[11px] text-[var(--text-muted)]">
          Where AI search points users — last 30 days
        </p>
      </div>
      <div className="h-3 w-full rounded-full overflow-hidden flex bg-[var(--bg-base)] border border-[var(--border-subtle)]">
        {SEGMENTS.map((s) => {
          const pct = values[s.key] ?? 0;
          if (pct <= 0) return null;
          return (
            <div
              key={s.key}
              className="h-full"
              style={{ width: `${pct}%`, background: s.color }}
              title={`${s.label}: ${pct.toFixed(1)}%`}
            />
          );
        })}
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-4">
        {SEGMENTS.map((s) => {
          const pct = values[s.key] ?? 0;
          return (
            <div key={s.key} className="flex items-start gap-2">
              <span
                className="inline-block w-2.5 h-2.5 rounded-sm shrink-0 mt-1"
                style={{ background: s.color }}
              />
              <div className="min-w-0">
                <p className="text-[10px] uppercase tracking-wider text-[var(--text-muted)] flex items-center gap-1">
                  {s.label}
                  <HelpTooltip text={s.explanation} />
                </p>
                <p className="text-lg font-semibold tabular-nums text-[var(--text-primary)]">
                  {pct.toFixed(1)}<span className="text-xs text-[var(--text-faint)]">%</span>
                </p>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
