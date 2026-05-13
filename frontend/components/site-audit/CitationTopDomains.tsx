'use client';

import { ExternalLink } from 'lucide-react';
import type { CitationDomainAgg } from '@/lib/api';

interface Props {
  rows: CitationDomainAgg[];
}

const KIND_COLOR: Record<string, string> = {
  own: 'var(--success-text)',
  competitor: 'var(--danger-text)',
  third_party: 'var(--color-perplexity)',
  unknown: 'var(--text-muted)',
};

const KIND_LABEL: Record<string, string> = {
  own: 'You',
  competitor: 'Competitor',
  third_party: 'Third-party',
  unknown: 'Other',
};

export function CitationTopDomains({ rows }: Props) {
  const top = rows.slice(0, 10);
  if (top.length === 0) {
    return (
      <p className="text-sm text-[var(--text-muted)] text-center py-8">
        No citations captured in the last 30 days. Run a tracking session to populate this.
      </p>
    );
  }
  const max = top[0].count;

  return (
    <div className="card">
      <h3 className="text-base font-semibold text-[var(--text-primary)] mb-3">
        Top cited domains
      </h3>
      <ul className="divide-y divide-[var(--border-subtle)]">
        {top.map((r) => {
          const color = KIND_COLOR[r.kind] ?? 'var(--text-muted)';
          const pct = (r.count / max) * 100;
          return (
            <li key={`${r.domain}-${r.kind}`} className="py-2 flex items-center gap-3">
              <a
                href={`https://${r.domain}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm font-mono text-[var(--text-primary)] hover:text-[var(--accent-light)] flex items-center gap-1 min-w-0 max-w-[40%]"
              >
                <span className="truncate">{r.domain}</span>
                <ExternalLink size={11} className="shrink-0" />
              </a>
              <div className="flex-1 h-1.5 rounded-full bg-[var(--bg-base)] overflow-hidden">
                <div className="h-full" style={{ width: `${pct}%`, background: color }} />
              </div>
              <span className="text-[10px] font-semibold uppercase tracking-wider tabular-nums shrink-0 w-20 text-right" style={{ color }}>
                {KIND_LABEL[r.kind]}
              </span>
              <span className="text-sm tabular-nums text-[var(--text-secondary)] shrink-0 w-8 text-right">
                {r.count}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
