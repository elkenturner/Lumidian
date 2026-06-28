'use client';

import { useState } from 'react';
import { Loader2, ArrowUpRight, ChevronDown } from 'lucide-react';
import { draftWikipediaCandidate, type WikipediaCandidate } from '@/lib/api';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { SuggestedEditPanel } from './SuggestedEditPanel';

interface Props {
  brandId: number;
  candidate: WikipediaCandidate;
  expanded: boolean;
  onToggleExpand: (open: boolean) => void;
  onUpdated: (c: WikipediaCandidate) => void;
}

type BadgeVariant = 'default' | 'secondary' | 'destructive' | 'success' | 'warning' | 'outline';

const STATUS_BADGE: Record<WikipediaCandidate['status'], { label: string; variant: BadgeVariant }> = {
  new: { label: 'New', variant: 'secondary' },
  drafted: { label: 'Drafted', variant: 'default' },
  submitted: { label: 'Submitted', variant: 'warning' },
  accepted: { label: 'Accepted', variant: 'success' },
  reverted: { label: 'Reverted', variant: 'destructive' },
  dismissed: { label: 'Dismissed', variant: 'outline' },
};

function scoreVariant(score: number): BadgeVariant {
  if (score >= 80) return 'success';
  if (score >= 65) return 'warning';
  return 'secondary';
}

function articlePath(url: string) {
  try {
    const u = new URL(url);
    return { host: u.hostname.replace(/^www\./, ''), path: u.pathname };
  } catch {
    return { host: url, path: '' };
  }
}

export function CandidateCard({ brandId, candidate, expanded, onToggleExpand, onUpdated }: Props) {
  const [drafting, setDrafting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function generateDraft() {
    setDrafting(true);
    setError(null);
    try {
      const updated = await draftWikipediaCandidate(brandId, candidate.id);
      onUpdated(updated);
      onToggleExpand(true);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to generate draft';
      setError(msg);
    } finally {
      setDrafting(false);
    }
  }

  const score = Math.round(candidate.legitimacy_score * 100);
  const isLocked = candidate.status === 'accepted' || candidate.status === 'dismissed';
  const status = STATUS_BADGE[candidate.status];
  const { host, path } = articlePath(candidate.article_url);
  const hasDraft = Boolean(candidate.suggested_wikitext);

  return (
    <article
      className={`card ${expanded ? '' : 'card-hover'} flex h-full flex-col gap-3 ${
        isLocked ? 'opacity-60' : ''
      }`}
    >
      {/* Title row + score */}
      <div className="flex items-start justify-between gap-3">
        <h3 className="min-w-0 text-base font-semibold leading-snug text-[var(--text-primary)]">
          <a
            href={candidate.article_url}
            target="_blank"
            rel="noopener noreferrer"
            className="group inline-flex items-baseline gap-1.5 hover:text-[var(--accent-foreground)] transition-colors"
          >
            <span className="line-clamp-2">{candidate.article_title}</span>
            <ArrowUpRight className="h-3.5 w-3.5 shrink-0 self-center text-[var(--text-faint)] transition-colors group-hover:text-[var(--accent-foreground)]" />
          </a>
        </h3>
        <Badge variant={scoreVariant(score)} className="shrink-0 tabular-nums" title="Legitimacy score">
          {score}
        </Badge>
      </div>

      {/* URL */}
      <div className="truncate text-xs text-[var(--text-faint)]">
        {host}
        <span className="text-[var(--text-muted)]">{path}</span>
      </div>

      {/* Summary */}
      <p className={`text-sm leading-relaxed text-[var(--text-secondary)] ${expanded ? '' : 'line-clamp-3'}`}>
        {candidate.article_summary}
      </p>

      {/* Reasoning */}
      {candidate.legitimacy_reasoning && (
        <p className={`text-xs leading-relaxed text-[var(--text-muted)] ${expanded ? '' : 'line-clamp-2'}`}>
          {candidate.legitimacy_reasoning}
        </p>
      )}

      {error && <p className="text-xs text-[var(--danger-text)]">{error}</p>}

      {/* Footer: status + action */}
      <div className="mt-auto flex items-center justify-between gap-3 pt-2">
        <Badge variant={status.variant}>{status.label}</Badge>

        {!hasDraft && candidate.status === 'new' && (
          <Button variant="secondary" size="sm" onClick={generateDraft} disabled={drafting}>
            {drafting && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            {drafting ? 'Drafting…' : 'Draft suggested edit'}
          </Button>
        )}

        {hasDraft && (
          <Button variant="ghost" size="sm" onClick={() => onToggleExpand(!expanded)}>
            {expanded ? 'Collapse' : 'View suggested edit'}
            <ChevronDown
              className={`h-3.5 w-3.5 transition-transform ${expanded ? 'rotate-180' : ''}`}
            />
          </Button>
        )}
      </div>

      {/* Expanding panel */}
      <div
        className="grid transition-[grid-template-rows] duration-300"
        style={{
          gridTemplateRows: expanded && hasDraft ? '1fr' : '0fr',
          transitionTimingFunction: 'cubic-bezier(0.23, 1, 0.32, 1)',
        }}
        aria-hidden={!expanded}
      >
        <div className="overflow-hidden">
          {hasDraft && (
            <div className="border-t border-[var(--border-subtle)] pt-4">
              <SuggestedEditPanel
                brandId={brandId}
                candidate={candidate}
                onUpdated={onUpdated}
                onRegenerate={generateDraft}
                regenerating={drafting}
              />
            </div>
          )}
        </div>
      </div>
    </article>
  );
}
