'use client';

import { useState } from 'react';
import { Copy, Check, ArrowUpRight, Loader2 } from 'lucide-react';
import {
  updateWikipediaCandidateStatus,
  type WikipediaCandidate,
  type WikipediaCandidateStatusUpdate,
} from '@/lib/api';
import { Button } from '@/components/ui/button';

interface Props {
  brandId: number;
  candidate: WikipediaCandidate;
  onUpdated: (c: WikipediaCandidate) => void;
  onRegenerate?: () => void;
  regenerating?: boolean;
}

export function SuggestedEditPanel({ brandId, candidate, onUpdated, onRegenerate, regenerating }: Props) {
  const [copied, setCopied] = useState(false);
  const [updating, setUpdating] = useState(false);

  if (!candidate.suggested_wikitext) return null;

  async function copyText() {
    if (!candidate.suggested_wikitext) return;
    await navigator.clipboard.writeText(candidate.suggested_wikitext);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  async function updateStatus(status: WikipediaCandidateStatusUpdate) {
    setUpdating(true);
    try {
      const updated = await updateWikipediaCandidateStatus(brandId, candidate.id, status);
      onUpdated(updated);
    } finally {
      setUpdating(false);
    }
  }

  const canRegenerate =
    onRegenerate && (candidate.status === 'drafted' || candidate.status === 'reverted');

  return (
    <div className="space-y-4">
      {/* Meta */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
        <MetaItem label="Section" value={candidate.suggested_section ?? '—'} />
        {candidate.suggested_insert_location && (
          <MetaItem label="Position" value={candidate.suggested_insert_location} />
        )}
      </div>

      {/* Wikitext draft */}
      <div className="overflow-hidden rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-base)]">
        <div className="flex items-center justify-between border-b border-[var(--border-subtle)] px-4 py-2">
          <span className="text-[11px] uppercase tracking-wider font-semibold text-[var(--text-faint)]">
            Wikitext draft
          </span>
          <button
            type="button"
            onClick={copyText}
            className="inline-flex cursor-pointer items-center gap-1.5 text-xs font-medium text-[var(--text-muted)] transition-colors hover:text-[var(--text-primary)]"
          >
            {copied ? (
              <Check className="h-3.5 w-3.5 text-[var(--success-text)]" />
            ) : (
              <Copy className="h-3.5 w-3.5" />
            )}
            {copied ? 'Copied' : 'Copy'}
          </button>
        </div>
        <pre className="overflow-x-auto whitespace-pre-wrap break-words px-4 py-3.5 font-mono text-xs leading-relaxed text-[var(--text-primary)]">
          {candidate.suggested_wikitext}
        </pre>
      </div>

      {/* Actions */}
      <div className="flex flex-wrap items-center gap-2">
        <Button asChild variant="secondary" size="sm">
          <a href={candidate.article_url} target="_blank" rel="noopener noreferrer">
            Open Wikipedia to edit
            <ArrowUpRight className="h-3.5 w-3.5" />
          </a>
        </Button>

        {canRegenerate && (
          <Button variant="ghost" size="sm" onClick={onRegenerate} disabled={regenerating}>
            {regenerating && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            {regenerating ? 'Regenerating…' : 'Regenerate'}
          </Button>
        )}

        <div className="ml-auto flex flex-wrap items-center gap-2">
          {candidate.status === 'drafted' && (
            <Button variant="secondary" size="sm" onClick={() => updateStatus('submitted')} disabled={updating}>
              {updating ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
              Mark submitted
            </Button>
          )}

          {candidate.status === 'submitted' && (
            <>
              <Button variant="success" size="sm" onClick={() => updateStatus('accepted')} disabled={updating}>
                <Check className="h-3 w-3" />
                Accepted
              </Button>
              <Button variant="ghost" size="sm" onClick={() => updateStatus('reverted')} disabled={updating}>
                Reverted
              </Button>
            </>
          )}

          {candidate.status !== 'dismissed' && (
            <Button variant="ghost" size="sm" onClick={() => updateStatus('dismissed')} disabled={updating}>
              Dismiss
            </Button>
          )}
        </div>
      </div>

      {/* COI note */}
      <p className="border-t border-[var(--border-subtle)] pt-3 text-xs leading-relaxed text-[var(--text-faint)]">
        <span className="mr-1.5 font-semibold uppercase tracking-wider text-[var(--text-muted)]">Note</span>
        Disclose your affiliation on the article&apos;s talk page before editing. Lumidian does not
        post to Wikipedia for you.
      </p>
    </div>
  );
}

function MetaItem({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <span className="mr-1.5 uppercase tracking-wider font-semibold text-[var(--text-faint)]">
        {label}
      </span>
      <span className="text-[var(--text-secondary)]">{value}</span>
    </div>
  );
}
