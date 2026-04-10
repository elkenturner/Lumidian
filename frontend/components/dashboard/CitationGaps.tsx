'use client';

import { CitationGap } from '@/lib/api';

interface CitationGapsProps {
  gaps: CitationGap[];
}

const DOMAIN_TYPE_COLORS: Record<string, string> = {
  Editorial: 'var(--color-perplexity)',
  UGC: 'var(--color-chatgpt)',
  Reference: 'var(--color-gemini)',
  Institutional: 'var(--color-claude)',
  Corporate: 'var(--accent)',
};

export default function CitationGaps({ gaps }: CitationGapsProps) {
  if (!gaps.length) return <p className="text-xs text-[var(--text-faint)]">No citation gap data yet</p>;

  return (
    <div className="space-y-2">
      {gaps.map((g) => {
        const gapPct = Math.round(g.gap_score * 100);
        const brandPct = g.cited_total > 0 ? Math.round((g.cited_with_brand / g.cited_total) * 100) : 0;
        const typeColor = DOMAIN_TYPE_COLORS[g.domain_type] ?? 'var(--accent)';

        return (
          <div key={g.domain} className="group flex items-center gap-3 py-1.5">
            {/* Domain info */}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-xs font-medium text-[var(--text-secondary)] truncate">{g.domain}</span>
                <span
                  className="text-[10px] px-1.5 py-0.5 rounded-full font-medium"
                  style={{ backgroundColor: `color-mix(in srgb, ${typeColor} 15%, transparent)`, color: typeColor }}
                >
                  {g.domain_type}
                </span>
              </div>
              <div className="flex items-center gap-2 mt-1">
                {/* Gap bar */}
                <div className="flex-1 h-1.5 bg-[rgba(255,255,255,0.06)] rounded-full overflow-hidden">
                  <div
                    className="h-full rounded-full transition-[width] duration-500"
                    style={{
                      width: `${100 - gapPct}%`,
                      background: brandPct > 50
                        ? 'var(--success)'
                        : brandPct > 20
                          ? 'var(--warning, #f59e0b)'
                          : 'var(--danger-text, #ef4444)',
                    }}
                  />
                </div>
              </div>
            </div>
            {/* Stats */}
            <div className="flex items-center gap-3 flex-shrink-0">
              <span className="text-xs tabular-nums text-[var(--text-faint)]">
                {g.cited_with_brand}/{g.cited_total}
              </span>
              <span
                className="text-xs tabular-nums font-semibold"
                style={{
                  color: gapPct > 70
                    ? 'var(--danger-text, #ef4444)'
                    : gapPct > 40
                      ? 'var(--warning, #f59e0b)'
                      : 'var(--success)',
                }}
              >
                {gapPct}% gap
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
