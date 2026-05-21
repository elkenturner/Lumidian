'use client';

import { useState } from 'react';
import { Loader2, ArrowUpRight } from 'lucide-react';
import { draftWikipediaCandidate, type WikipediaCandidate } from '@/lib/api';
import { SuggestedEditPanel } from './SuggestedEditPanel';

interface Props {
  index: number;
  brandId: number;
  candidate: WikipediaCandidate;
  onUpdated: (c: WikipediaCandidate) => void;
}

const STATUS_LABEL: Record<WikipediaCandidate['status'], string> = {
  new: 'New',
  drafted: 'Drafted',
  submitted: 'Submitted',
  accepted: 'Accepted',
  reverted: 'Reverted',
  dismissed: 'Dismissed',
};

const STATUS_DOT: Record<WikipediaCandidate['status'], string> = {
  new: 'bg-[var(--text-muted)]',
  drafted: 'bg-[#7dd3fc]',
  submitted: 'bg-[#fbbf24]',
  accepted: 'bg-[#4ade80]',
  reverted: 'bg-[#fb7185]',
  dismissed: 'bg-[var(--text-faint)]',
};

function scoreColor(score: number) {
  if (score >= 80) return 'text-[#4ade80]';
  if (score >= 65) return 'text-[#fbbf24]';
  return 'text-[var(--text-muted)]';
}

function articlePath(url: string) {
  try {
    const u = new URL(url);
    return { host: u.hostname.replace(/^www\./, ''), path: u.pathname };
  } catch {
    return { host: url, path: '' };
  }
}

const MONO = { fontFamily: 'var(--font-geist-mono)' } as const;

export function CandidateCard({ index, brandId, candidate, onUpdated }: Props) {
  const [drafting, setDrafting] = useState(false);
  const [expanded, setExpanded] = useState(candidate.status !== 'new');
  const [error, setError] = useState<string | null>(null);

  async function generateDraft() {
    setDrafting(true);
    setError(null);
    try {
      const updated = await draftWikipediaCandidate(brandId, candidate.id);
      onUpdated(updated);
      setExpanded(true);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to generate draft';
      setError(msg);
    } finally {
      setDrafting(false);
    }
  }

  const score = Math.round(candidate.legitimacy_score * 100);
  const isLocked = candidate.status === 'accepted' || candidate.status === 'dismissed';
  const { host, path } = articlePath(candidate.article_url);

  return (
    <article className={`relative grid grid-cols-[2.25rem_1fr] gap-5 py-8 transition-opacity ${isLocked ? 'opacity-55' : ''}`}>
      {/* Index */}
      <div
        className="pt-[5px] text-[11px] font-medium tabular-nums text-[var(--text-faint)] tracking-[0.08em]"
        style={MONO}
      >
        {index.toString().padStart(2, '0')}
      </div>

      {/* Body */}
      <div className="min-w-0">
        {/* Title row with score meta */}
        <div className="flex items-start justify-between gap-6">
          <h2 className="min-w-0 text-[19px] font-semibold leading-[1.3] tracking-[-0.01em] text-[var(--text-primary)]">
            <a
              href={candidate.article_url}
              target="_blank"
              rel="noopener noreferrer"
              className="group inline-flex items-baseline gap-2 hover:text-[var(--accent-foreground)] transition-colors"
            >
              <span>{candidate.article_title}</span>
              <ArrowUpRight className="h-3.5 w-3.5 shrink-0 self-center text-[var(--text-faint)] transition-colors group-hover:text-[var(--accent-foreground)]" />
            </a>
          </h2>
          <div
            className="shrink-0 pt-[3px] text-[11px] font-medium uppercase tracking-[0.22em] text-[var(--text-faint)]"
            style={MONO}
            title="Legitimacy score"
          >
            <span className="mr-1.5">Score</span>
            <span className={`text-[14px] tracking-[0.02em] ${scoreColor(score)}`}>{score}</span>
          </div>
        </div>

        {/* URL */}
        <div
          className="mt-1.5 truncate text-[12px] text-[var(--text-faint)]"
          style={MONO}
        >
          {host}
          <span className="text-[var(--text-secondary)]">{path}</span>
        </div>

        {/* Summary */}
        <p className="mt-4 max-w-[64ch] text-[14.5px] leading-[1.6] text-[var(--text-secondary)]">
          {candidate.article_summary}
        </p>

        {/* Reasoning — quiet editorial annotation */}
        <p className="mt-3 max-w-[64ch] text-[13px] leading-[1.65] italic text-[var(--text-muted)]">
          {candidate.legitimacy_reasoning}
        </p>

        {/* Status + action footer */}
        <div className="mt-6 flex items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <span className={`inline-block h-1.5 w-1.5 rounded-full ${STATUS_DOT[candidate.status]}`} />
            <span
              className="text-[10.5px] font-medium uppercase tracking-[0.22em] text-[var(--text-secondary)]"
              style={MONO}
            >
              {STATUS_LABEL[candidate.status]}
            </span>
          </div>

          {!candidate.suggested_wikitext && candidate.status === 'new' && (
            <button
              type="button"
              onClick={generateDraft}
              disabled={drafting}
              className="group inline-flex cursor-pointer items-center gap-1.5 text-[13px] font-medium text-[var(--accent-foreground)] transition-colors hover:text-[var(--text-primary)] disabled:cursor-wait disabled:opacity-60 active:scale-[0.98] [transition:transform_160ms_cubic-bezier(0.23,1,0.32,1),color_0.15s_ease]"
            >
              {drafting && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              {drafting ? 'Drafting' : 'Draft suggested edit'}
              <span className="transition-transform group-hover:translate-x-0.5">→</span>
            </button>
          )}

          {candidate.suggested_wikitext && !expanded && (
            <button
              type="button"
              onClick={() => setExpanded(true)}
              className="cursor-pointer text-[13px] font-medium text-[var(--accent-foreground)] transition-colors hover:text-[var(--text-primary)]"
            >
              View suggested edit ↓
            </button>
          )}

          {candidate.suggested_wikitext && expanded && (
            <div className="flex items-center gap-4">
              {(candidate.status === 'drafted' || candidate.status === 'reverted') && (
                <button
                  type="button"
                  onClick={generateDraft}
                  disabled={drafting}
                  className="cursor-pointer text-[12px] text-[var(--text-muted)] transition-colors hover:text-[var(--text-secondary)] disabled:opacity-50"
                >
                  {drafting ? 'Regenerating…' : 'Regenerate'}
                </button>
              )}
              <button
                type="button"
                onClick={() => setExpanded(false)}
                className="cursor-pointer text-[13px] font-medium text-[var(--text-muted)] transition-colors hover:text-[var(--text-primary)]"
              >
                Collapse ↑
              </button>
            </div>
          )}
        </div>

        {error && (
          <p className="mt-3 text-[12px] text-[var(--danger-text)]">{error}</p>
        )}

        {/* Expanding panel via grid-template-rows */}
        <div
          className="grid transition-[grid-template-rows] duration-300"
          style={{
            gridTemplateRows: expanded && candidate.suggested_wikitext ? '1fr' : '0fr',
            transitionTimingFunction: 'cubic-bezier(0.23, 1, 0.32, 1)',
          }}
          aria-hidden={!expanded}
        >
          <div className="overflow-hidden">
            {candidate.suggested_wikitext && (
              <div className="pt-6">
                <SuggestedEditPanel brandId={brandId} candidate={candidate} onUpdated={onUpdated} />
              </div>
            )}
          </div>
        </div>
      </div>
    </article>
  );
}
