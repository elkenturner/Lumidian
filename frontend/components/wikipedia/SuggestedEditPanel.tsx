'use client';

import { useState } from 'react';
import { Copy, Check, ExternalLink, AlertCircle } from 'lucide-react';
import {
  updateWikipediaCandidateStatus,
  type WikipediaCandidate,
  type WikipediaCandidateStatusUpdate,
} from '@/lib/api';

interface Props {
  brandId: number;
  candidate: WikipediaCandidate;
  onUpdated: (c: WikipediaCandidate) => void;
}

export function SuggestedEditPanel({ brandId, candidate, onUpdated }: Props) {
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

  return (
    <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm">
      <div className="mb-2 text-xs uppercase tracking-wide text-slate-500">
        Insert into section: <span className="font-medium text-slate-800">{candidate.suggested_section ?? '(unspecified)'}</span>
        {candidate.suggested_insert_location && (
          <>
            {' · '}Position: <span className="font-medium text-slate-800">{candidate.suggested_insert_location}</span>
          </>
        )}
      </div>

      <pre className="whitespace-pre-wrap rounded border border-slate-200 bg-white p-3 font-mono text-xs text-slate-800">
        {candidate.suggested_wikitext}
      </pre>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={copyText}
          className="inline-flex items-center gap-1 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium hover:bg-slate-50"
        >
          {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
          {copied ? 'Copied' : 'Copy wikitext'}
        </button>
        <a
          href={candidate.article_url}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium hover:bg-slate-50"
        >
          <ExternalLink className="h-3 w-3" />
          Open Wikipedia to edit
        </a>
      </div>

      <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 p-2 text-xs text-amber-900 flex items-start gap-2">
        <AlertCircle className="mt-0.5 h-3 w-3 shrink-0" />
        <span>
          COI reminder: Disclose your affiliation on the article talk page before editing. We do not post to Wikipedia for you.
        </span>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {candidate.status === 'drafted' && (
          <button
            type="button"
            onClick={() => updateStatus('submitted')}
            disabled={updating}
            className="rounded-md bg-slate-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-800 disabled:opacity-50"
          >
            I submitted this ✓
          </button>
        )}
        {candidate.status === 'submitted' && (
          <>
            <button
              type="button"
              onClick={() => updateStatus('accepted')}
              disabled={updating}
              className="rounded-md bg-emerald-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-800 disabled:opacity-50"
            >
              Mark accepted
            </button>
            <button
              type="button"
              onClick={() => updateStatus('reverted')}
              disabled={updating}
              className="rounded-md bg-rose-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-rose-800 disabled:opacity-50"
            >
              Mark reverted
            </button>
          </>
        )}
        {candidate.status !== 'dismissed' && (
          <button
            type="button"
            onClick={() => updateStatus('dismissed')}
            disabled={updating}
            className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium hover:bg-slate-50 disabled:opacity-50"
          >
            Dismiss
          </button>
        )}
      </div>
    </div>
  );
}
