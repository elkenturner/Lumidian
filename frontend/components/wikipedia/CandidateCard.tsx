'use client';

import { useState } from 'react';
import { Loader2, Star } from 'lucide-react';
import { draftWikipediaCandidate, type WikipediaCandidate } from '@/lib/api';
import { SuggestedEditPanel } from './SuggestedEditPanel';

interface Props {
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

const STATUS_TONE: Record<WikipediaCandidate['status'], string> = {
  new: 'bg-slate-100 text-slate-700',
  drafted: 'bg-sky-100 text-sky-800',
  submitted: 'bg-amber-100 text-amber-800',
  accepted: 'bg-emerald-100 text-emerald-800',
  reverted: 'bg-rose-100 text-rose-800',
  dismissed: 'bg-slate-100 text-slate-400',
};

export function CandidateCard({ brandId, candidate, onUpdated }: Props) {
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

  return (
    <div className={`rounded-xl border border-slate-200 bg-white p-5 shadow-sm transition-opacity ${isLocked ? 'opacity-60' : ''}`}>
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center gap-1 rounded-md bg-slate-900 px-2 py-0.5 text-xs font-mono font-semibold text-white">
              <Star className="h-3 w-3" /> {score}
            </span>
            <span className={`rounded-md px-2 py-0.5 text-xs font-medium ${STATUS_TONE[candidate.status]}`}>
              {STATUS_LABEL[candidate.status]}
            </span>
          </div>
          <h3 className="mt-2 text-base font-semibold text-slate-900">
            <a href={candidate.article_url} target="_blank" rel="noopener noreferrer" className="hover:underline">
              {candidate.article_title}
            </a>
          </h3>
          <p className="mt-1 text-xs text-slate-500 truncate">↗ {candidate.article_url}</p>
        </div>
      </div>

      <p className="mt-3 text-sm text-slate-700 line-clamp-3">{candidate.article_summary}</p>

      <p className="mt-2 text-xs text-slate-500 italic">
        Why this fits: {candidate.legitimacy_reasoning}
      </p>

      {!candidate.suggested_wikitext && candidate.status === 'new' && (
        <div className="mt-4">
          <button
            type="button"
            onClick={generateDraft}
            disabled={drafting}
            className="inline-flex items-center gap-1 rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
          >
            {drafting && <Loader2 className="h-3 w-3 animate-spin" />}
            {drafting ? 'Generating…' : 'Generate suggested edit →'}
          </button>
          {error && <p className="mt-2 text-xs text-rose-700">{error}</p>}
        </div>
      )}

      {candidate.suggested_wikitext && (
        <>
          {!expanded ? (
            <button
              type="button"
              onClick={() => setExpanded(true)}
              className="mt-4 text-sm font-medium text-sky-700 hover:text-sky-900"
            >
              View suggested edit →
            </button>
          ) : (
            <SuggestedEditPanel brandId={brandId} candidate={candidate} onUpdated={onUpdated} />
          )}
          {(candidate.status === 'drafted' || candidate.status === 'reverted') && (
            <button
              type="button"
              onClick={generateDraft}
              disabled={drafting}
              className="mt-2 text-xs text-slate-500 hover:text-slate-700 disabled:opacity-50"
            >
              {drafting ? 'Regenerating…' : 'Regenerate'}
            </button>
          )}
        </>
      )}
    </div>
  );
}
