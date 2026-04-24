'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  ArrowRight,
  BarChart2,
  ChevronDown,
  Info,
  Link2,
  Trash2,
} from 'lucide-react';
import { ContentDraft, DraftAttribution } from '@/lib/api';
import PlatformBadge from '@/components/PlatformBadge';
import { relativeTime } from '../helpers';

export interface PostedCardProps {
  draft: ContentDraft;
  brandId: number;
  attribution?: DraftAttribution;
  onDelete: (draftId: number) => void;
  onOpenAttach: (draftId: number) => void;
  onOpenExplainer: () => void;
}

type ConfidenceTier = 'awaiting' | 'early' | 'developing' | 'established';

function getConfidenceTier(runs: number): ConfidenceTier {
  if (runs === 0) return 'awaiting';
  if (runs <= 2) return 'early';
  if (runs <= 5) return 'developing';
  return 'established';
}

const TIER_LABEL: Record<ConfidenceTier, string> = {
  awaiting: 'Awaiting next report',
  early: 'Early data',
  developing: 'Developing',
  established: 'Established',
};

const TIER_COLOR: Record<ConfidenceTier, string> = {
  awaiting: 'var(--text-faint)',
  early: 'var(--text-muted)',
  developing: 'var(--accent-foreground)',
  established: 'var(--success)',
};

function tierPillStyle(tier: ConfidenceTier) {
  return {
    color: TIER_COLOR[tier],
    borderColor: `color-mix(in srgb, ${TIER_COLOR[tier]} 25%, transparent)`,
    backgroundColor: `color-mix(in srgb, ${TIER_COLOR[tier]} 6%, transparent)`,
  };
}

export function PostedCard({
  draft,
  brandId,
  attribution,
  onDelete,
  onOpenAttach,
  onOpenExplainer,
}: PostedCardProps) {
  const router = useRouter();
  const [expanded, setExpanded] = useState(false);

  const isOrphan = !draft.prompt_id;
  const isLateAttach =
    !!attribution && draft.prompt_id != null && attribution.score_at_posting == null;
  const clickable = !isOrphan && draft.prompt_id != null;
  const title =
    draft.title ??
    draft.content_text.slice(0, 80) +
      (draft.content_text.length > 80 ? '…' : '');

  const href = draft.prompt_id
    ? `/tracker/${brandId}/prompt/${draft.prompt_id}?draft=${draft.id}`
    : null;

  function handleCardClick(e: React.MouseEvent<HTMLDivElement>) {
    const target = e.target as HTMLElement;
    if (target.closest('[data-no-nav]')) return;
    if (!href) return;
    router.push(href);
  }

  let attributionNode: JSX.Element | null = null;

  if (isLateAttach) {
    const tier = getConfidenceTier(attribution?.runs_since_posting ?? 0);
    attributionNode = (
      <div className="flex flex-col gap-1">
        <div className="flex items-center gap-3 text-sm">
          <span className="text-[var(--text-faint)]">—</span>
          <ArrowRight size={12} className="text-[var(--text-faint)]" aria-hidden="true" />
          <span className="font-mono">
            Now{' '}
            <span className="text-[var(--text-primary)]">
              {attribution?.current_score != null
                ? `${attribution.current_score.toFixed(1)}%`
                : '—'}
            </span>
          </span>
          <span
            className="text-xs px-1.5 py-0.5 rounded-full border ml-auto"
            style={tierPillStyle(tier)}
          >
            {TIER_LABEL[tier]}
          </span>
        </div>
        <p className="text-[11px] text-[var(--text-faint)]">
          Attached late — baseline unavailable
        </p>
      </div>
    );
  } else if (attribution) {
    const tier = getConfidenceTier(attribution.runs_since_posting);
    const scoreBefore = attribution.score_at_posting;
    const scoreNow = attribution.current_score ?? 0;
    const delta = attribution.delta;
    const deltaColor =
      delta == null
        ? 'var(--text-secondary)'
        : delta > 0
          ? 'var(--success)'
          : delta < 0
            ? 'var(--danger)'
            : 'var(--text-secondary)';
    const deltaLabel =
      delta == null
        ? '—'
        : delta > 0
          ? `+${delta.toFixed(1)}pp`
          : `${delta.toFixed(1)}pp`;

    attributionNode =
      tier === 'awaiting' ? (
        <div className="flex items-center gap-2 flex-wrap">
          <span
            className="text-xs px-1.5 py-0.5 rounded-full border"
            style={tierPillStyle(tier)}
          >
            {TIER_LABEL[tier]}
          </span>
          <span className="text-xs text-[var(--text-faint)]">
            Next tracking run will measure visibility change.
          </span>
        </div>
      ) : (
        <div className="flex items-center gap-3 flex-wrap text-sm">
          {scoreBefore != null && (
            <span className="font-mono text-[var(--text-secondary)]">
              At posting{' '}
              <span className="text-[var(--text-muted)]">
                {scoreBefore.toFixed(1)}%
              </span>
            </span>
          )}
          {scoreBefore != null && (
            <ArrowRight size={12} className="text-[var(--text-faint)]" aria-hidden="true" />
          )}
          <span className="font-mono">
            Now{' '}
            <span className="text-[var(--text-primary)] font-semibold">
              {scoreNow.toFixed(1)}%
            </span>
          </span>
          {delta != null && (
            <span className="font-semibold font-mono" style={{ color: deltaColor }}>
              {deltaLabel}
            </span>
          )}
          <span
            className="text-xs px-1.5 py-0.5 rounded-full border ml-auto"
            style={tierPillStyle(tier)}
          >
            {TIER_LABEL[tier]}
          </span>
        </div>
      );
  }

  return (
    <div
      onClick={clickable ? handleCardClick : undefined}
      className={[
        'card p-4 flex flex-col gap-3 transition-[border-color] duration-[120ms] ease-out',
        clickable ? 'cursor-pointer hover:border-[rgba(255,255,255,0.14)]' : '',
      ]
        .join(' ')
        .trim()}
      role={clickable ? 'link' : undefined}
      tabIndex={clickable ? 0 : undefined}
      onKeyDown={(e) => {
        if (!clickable) return;
        if (e.key === 'Enter' && href) router.push(href);
      }}
    >
      {/* Top row */}
      <div className="flex items-center gap-2">
        <PlatformBadge platform={draft.platform} />
        <span className="text-xs text-[var(--text-faint)]">
          {relativeTime(draft.updated_at)}
        </span>
        <div className="ml-auto flex items-center gap-1" data-no-nav>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onOpenExplainer();
            }}
            aria-label="How impact works"
            className="w-7 h-7 rounded-lg flex items-center justify-center text-[var(--text-faint)] hover:text-[var(--text-secondary)] hover:bg-[rgba(255,255,255,0.06)] transition-colors"
          >
            <Info size={13} aria-hidden="true" />
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              setExpanded(!expanded);
            }}
            aria-label={expanded ? 'Hide draft text' : 'Show draft text'}
            aria-expanded={expanded}
            className="w-7 h-7 rounded-lg flex items-center justify-center text-[var(--text-faint)] hover:text-[var(--text-secondary)] hover:bg-[rgba(255,255,255,0.06)] transition-colors"
          >
            <ChevronDown
              size={13}
              className={`transition-transform ${expanded ? 'rotate-180' : ''}`}
              aria-hidden="true"
            />
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              if (
                confirm(
                  'Delete this posted draft? Its attribution data will also be removed.',
                )
              ) {
                onDelete(draft.id);
              }
            }}
            aria-label="Delete"
            className="w-7 h-7 rounded-lg flex items-center justify-center text-[var(--text-faint)] hover:text-[var(--danger)] hover:bg-[rgba(255,255,255,0.06)] transition-colors"
          >
            <Trash2 size={13} aria-hidden="true" />
          </button>
        </div>
      </div>

      {/* Attribution — the card's visual anchor */}
      {isOrphan ? (
        <div className="flex items-center gap-3 flex-wrap" data-no-nav>
          <span className="text-sm text-[var(--text-muted)]">
            No prompt attached — impact not trackable
          </span>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onOpenAttach(draft.id);
            }}
            className="ml-auto flex items-center gap-1.5 text-xs bg-[rgba(255,255,255,0.06)] hover:bg-[rgba(255,255,255,0.10)] border border-[rgba(255,255,255,0.10)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] rounded-lg px-3 py-1.5 transition-colors"
          >
            <Link2 size={11} aria-hidden="true" />
            Attach to prompt
          </button>
        </div>
      ) : attributionNode ? (
        <div className="border border-[rgba(255,255,255,0.06)] bg-[rgba(255,255,255,0.02)] rounded-lg px-3 py-2.5">
          <p className="text-[10px] text-[var(--text-faint)] uppercase tracking-wide mb-1 flex items-center gap-1">
            <BarChart2 size={9} aria-hidden="true" />
            Visibility change since posting
          </p>
          {attributionNode}
        </div>
      ) : null}

      {/* Title / preview */}
      <p className="text-sm text-[var(--text-secondary)] leading-snug truncate">
        {title}
      </p>

      {/* Expandable content */}
      {expanded && (
        <div
          className="bg-[rgba(255,255,255,0.03)] border border-[rgba(255,255,255,0.06)] rounded-lg p-3"
          data-no-nav
        >
          <pre className="text-xs text-[var(--text-muted)] whitespace-pre-wrap leading-relaxed font-mono">
            {draft.content_text}
          </pre>
        </div>
      )}
    </div>
  );
}
