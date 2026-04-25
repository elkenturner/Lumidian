'use client';

import Link from 'next/link';
import { CitationGap } from '@/lib/api';

interface CitationGapsProps {
  gaps: CitationGap[];
  brandId: number;
}

const DOMAIN_TYPE_COLORS: Record<string, string> = {
  Editorial: 'var(--color-perplexity)',
  UGC: 'var(--color-chatgpt)',
  Reference: 'var(--color-gemini)',
  Institutional: 'var(--color-claude)',
  Corporate: 'var(--accent)',
};

const PLATFORM_LABELS: Record<string, string> = {
  reddit: 'Draft for Reddit',
  quora: 'Draft for Quora',
  medium: 'Draft for Medium',
  linkedin: 'Draft for LinkedIn',
  x: 'Draft for X',
  wikipedia: 'Edit Wikipedia',
};

export default function CitationGaps({ gaps, brandId }: CitationGapsProps) {
  if (!gaps.length) {
    return (
      <div className="flex flex-col items-center justify-center py-8 text-center">
        <div className="text-2xl mb-2 opacity-40">✓</div>
        <p className="text-sm font-medium text-[var(--text-secondary)] mb-1">
          No actionable gaps this run
        </p>
        <p className="text-xs text-[var(--text-faint)] max-w-md">
          AI didn&apos;t cite any draftable sources (Reddit, Quora, Medium, Wikipedia, LinkedIn, X)
          in prompts where your brand was absent. Check Top Cited Domains above for the broader
          source landscape.
        </p>
      </div>
    );
  }

  return (
    <div className="divide-y divide-[rgba(255,255,255,0.06)]">
      {gaps.map((g, idx) => {
        const platform = g.platform;
        if (!platform) return null;

        const partial = g.cited_with_brand > 0;
        const ctaLabel = PLATFORM_LABELS[platform] ?? `Draft for ${platform}`;
        const isWiki = platform === 'wikipedia';
        const typeColor = DOMAIN_TYPE_COLORS[g.domain_type] ?? 'var(--accent)';
        const presenceClass = partial ? 'text-[var(--warning,#f59e0b)]' : 'text-[var(--danger-text,#f87171)]';

        return (
          <div
            key={g.domain}
            className="grid grid-cols-[20px_1fr_auto_auto_auto] items-center gap-3 py-2.5 text-xs"
          >
            <span className="text-[10px] tabular-nums text-[var(--text-faint)]">{idx + 1}</span>

            <span className="font-medium text-[var(--text-primary)] truncate">{g.domain}</span>

            <span
              className="text-[10px] px-2 py-0.5 rounded-full font-medium whitespace-nowrap"
              style={{
                backgroundColor: `color-mix(in srgb, ${typeColor} 15%, transparent)`,
                color: typeColor,
              }}
            >
              {g.domain_type}
            </span>

            <span className="tabular-nums text-[var(--text-faint)] whitespace-nowrap">
              cited {g.cited_total}× · <span className={`font-medium ${presenceClass}`}>you in {g.cited_with_brand}</span>
            </span>

            <Link
              href={`/content/${brandId}?platform=${encodeURIComponent(platform)}`}
              className={`text-[10px] font-medium px-2.5 py-1.5 rounded-md whitespace-nowrap transition-colors ${
                isWiki
                  ? 'bg-[rgba(255,255,255,0.06)] text-[var(--text-primary)] hover:bg-[rgba(255,255,255,0.10)]'
                  : 'bg-[var(--accent)] text-white hover:opacity-90'
              }`}
            >
              {ctaLabel}
            </Link>
          </div>
        );
      })}
    </div>
  );
}
