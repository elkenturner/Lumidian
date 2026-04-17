'use client';

import { useState } from 'react';
import {
  ArrowRight,
  BarChart2,
  ChevronRight,
  ChevronDown,
} from 'lucide-react';
import { ContentDraft, DraftAttribution } from '@/lib/api';
import PlatformBadge from '@/components/PlatformBadge';
import { relativeTime, PLATFORM_DISPLAY } from '../helpers';

export function PostedCard({ draft, attribution }: { draft: ContentDraft; attribution?: DraftAttribution }) {
  const [expanded, setExpanded] = useState(false);
  const title = draft.title ?? draft.content_text.slice(0, 80) + (draft.content_text.length > 80 ? '…' : '');
  const isReply = draft.opportunity_id != null || draft.source === 'opportunity';

  type ConfidenceTier = 'awaiting' | 'early' | 'developing' | 'established';
  function getConfidenceTier(runs: number): ConfidenceTier {
    if (runs === 0) return 'awaiting';
    if (runs <= 2) return 'early';
    if (runs <= 5) return 'developing';
    return 'established';
  }
  const TIER_LABELS: Record<ConfidenceTier, string> = {
    awaiting: 'Awaiting next report',
    early: 'Early data',
    developing: 'Developing',
    established: 'Established',
  };
  const TIER_COLORS: Record<ConfidenceTier, string> = {
    awaiting: 'var(--text-faint)',
    early: 'var(--text-muted)',
    developing: 'var(--accent-foreground)',
    established: 'var(--success)',
  };

  let attributionNode: JSX.Element | null = null;
  if (attribution) {
    const tier = getConfidenceTier(attribution.runs_since_posting);
    const tierColor = TIER_COLORS[tier];
    const tierLabel = TIER_LABELS[tier];

    if (tier === 'awaiting') {
      attributionNode = (
        <div className="flex items-center gap-1.5 mt-1">
          <span className="text-[10px] px-1.5 py-0.5 rounded-full border" style={{ color: tierColor, borderColor: `color-mix(in srgb, ${tierColor} 25%, transparent)`, backgroundColor: `color-mix(in srgb, ${tierColor} 6%, transparent)` }}>
            {tierLabel}
          </span>
          <span className="text-xs text-[var(--text-faint)]">Next tracking run will measure visibility change.</span>
        </div>
      );
    } else {
      const scoreBefore = attribution.score_at_posting;
      const scoreNow = attribution.current_score ?? 0;
      const delta = attribution.delta;
      const deltaColor = delta == null ? 'var(--text-secondary)' : delta > 0 ? 'var(--success)' : delta < 0 ? 'var(--danger)' : 'var(--text-secondary)';
      const deltaLabel = delta == null ? '—' : delta > 0 ? `+${delta.toFixed(1)}pp` : `${delta.toFixed(1)}pp`;
      const runs = attribution.runs_since_posting;

      attributionNode = (
        <div className="mt-2 flex flex-col gap-1.5">
          <div className="flex items-center gap-3 flex-wrap">
            {scoreBefore != null && (
              <div className="flex items-center gap-1">
                <span className="text-[10px] text-[var(--text-faint)]">At posting</span>
                <span className="text-xs font-medium font-mono text-[var(--text-secondary)]">{scoreBefore.toFixed(1)}%</span>
              </div>
            )}
            {scoreBefore != null && <ArrowRight size={10} className="text-[var(--text-faint)]" />}
            <div className="flex items-center gap-1">
              <span className="text-[10px] text-[var(--text-faint)]">Now</span>
              <span className="text-xs font-medium font-mono text-[var(--text-primary)]">{scoreNow.toFixed(1)}%</span>
            </div>
            {delta != null && (
              <span className="text-xs font-semibold font-mono" style={{ color: deltaColor }}>{deltaLabel}</span>
            )}
            <span className="text-[10px] px-1.5 py-0.5 rounded-full border ml-auto" style={{ color: tierColor, borderColor: `color-mix(in srgb, ${tierColor} 25%, transparent)`, backgroundColor: `color-mix(in srgb, ${tierColor} 6%, transparent)` }}>
              {tierLabel}
            </span>
          </div>
          <p className="text-[10px] text-[var(--text-faint)] leading-relaxed">
            Based on {runs} tracking run{runs !== 1 ? 's' : ''} since posting.{' '}
            {tier === 'early' && 'More data needed before drawing conclusions.'}
            {tier === 'developing' && 'Trend is forming — keep an eye on the next few runs.'}
            {tier === 'established' && 'Sufficient data to observe a trend (correlation, not causation).'}
          </p>
        </div>
      );
    }
  } else if (draft.visibility_at_post != null) {
    attributionNode = (
      <div className="flex items-center gap-1 mt-1">
        <span className="text-[10px] text-[var(--text-faint)]">Brand visibility at time of posting:</span>
        <span className="text-xs font-medium font-mono text-[var(--text-secondary)]">{draft.visibility_at_post.toFixed(1)}%</span>
      </div>
    );
  }

  if (!expanded) {
    return (
      <button
        onClick={() => setExpanded(true)}
        className={`card w-full text-left px-4 py-3 flex items-center gap-3 transition-colors hover:border-[rgba(255,255,255,0.14)] cursor-pointer ${isReply ? 'border-l-[3px] border-l-[#6366f1]' : ''}`}
      >
        {isReply ? (
          <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-[rgba(99,102,241,0.12)] text-[#818cf8] shrink-0">
            Reply
          </span>
        ) : (
          <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-[rgba(74,222,128,0.10)] text-[#4ade80] shrink-0">
            Original
          </span>
        )}
        <p className="text-sm text-[var(--text-secondary)] truncate flex-1 min-w-0">{title}</p>
        <span className="text-[11px] text-[var(--text-faint)] shrink-0">{PLATFORM_DISPLAY[draft.platform] ?? draft.platform}</span>
        <span className="text-xs text-[var(--text-faint)] shrink-0">{relativeTime(draft.updated_at)}</span>
        <ChevronRight size={14} className="text-[var(--text-faint)] shrink-0" />
      </button>
    );
  }

  return (
    <div className={`card p-4 flex flex-col gap-2 transition-colors ${isReply ? 'border-l-[3px] border-l-[#6366f1]' : ''}`}>
      <div className="flex items-center gap-2">
        <PlatformBadge platform={draft.platform} />
        {isReply ? (
          <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-[rgba(99,102,241,0.12)] text-[#818cf8]">
            Thread Reply
          </span>
        ) : (
          <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-[rgba(74,222,128,0.10)] text-[#4ade80]">
            Original Content
          </span>
        )}
        <p className="flex-1 text-sm text-[var(--text-secondary)] truncate">{title}</p>
        <span className="text-xs text-[var(--text-faint)] shrink-0">{relativeTime(draft.updated_at)}</span>
        <button
          onClick={() => setExpanded(false)}
          className="text-[var(--text-faint)] hover:text-[var(--text-secondary)] transition-colors"
          aria-label="Collapse"
        >
          <ChevronDown size={14} />
        </button>
      </div>

      <div className="bg-[var(--bg-base)] border border-[var(--border-subtle)] rounded-lg p-3">
        <pre className="text-xs text-[var(--text-muted)] whitespace-pre-wrap leading-relaxed font-mono">{draft.content_text}</pre>
      </div>

      {attributionNode && (
        <div className="border-t border-[var(--border-subtle)] pt-2">
          <p className="text-[10px] text-[var(--text-faint)] uppercase tracking-wide mb-1 flex items-center gap-1">
            <BarChart2 size={9} />
            Visibility change since posting
          </p>
          {attributionNode}
        </div>
      )}
    </div>
  );
}
