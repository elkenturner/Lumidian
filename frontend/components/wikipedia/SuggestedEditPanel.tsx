'use client';

import { useState } from 'react';
import { Copy, Check, ArrowUpRight, Loader2 } from 'lucide-react';
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

  const mono = { fontFamily: 'var(--font-geist-mono)' } as const;

  return (
    <div className="border-l border-[var(--border-subtle)] pl-5">
      {/* Manuscript meta */}
      <div className="mb-3 flex flex-wrap items-baseline gap-x-5 gap-y-1">
        <MetaItem label="Section" value={candidate.suggested_section ?? '—'} />
        {candidate.suggested_insert_location && (
          <MetaItem label="Position" value={candidate.suggested_insert_location} />
        )}
      </div>

      {/* Wikitext manuscript */}
      <div className="relative rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[rgba(2,6,23,0.6)]">
        <div
          className="flex items-center justify-between border-b border-[var(--border-subtle)] px-4 py-2"
          style={mono}
        >
          <span className="text-[10.5px] font-medium uppercase tracking-[0.22em] text-[var(--text-faint)]">
            Wikitext draft
          </span>
          <button
            type="button"
            onClick={copyText}
            className="group inline-flex cursor-pointer items-center gap-1.5 text-[11px] font-medium text-[var(--text-muted)] transition-colors hover:text-[var(--text-primary)] active:scale-[0.97] [transition:transform_160ms_cubic-bezier(0.23,1,0.32,1),color_0.15s_ease]"
          >
            <span className="relative inline-flex h-3.5 w-3.5 items-center justify-center">
              <Copy
                className={`absolute h-3.5 w-3.5 transition-[opacity,transform] duration-150 ${
                  copied ? 'opacity-0 scale-75' : 'opacity-100 scale-100'
                }`}
              />
              <Check
                className={`absolute h-3.5 w-3.5 text-[#4ade80] transition-[opacity,transform] duration-150 ${
                  copied ? 'opacity-100 scale-100' : 'opacity-0 scale-75'
                }`}
              />
            </span>
            <span className="min-w-[3rem]">{copied ? 'Copied' : 'Copy'}</span>
          </button>
        </div>
        <pre
          className="overflow-x-auto whitespace-pre-wrap break-words px-4 py-3.5 text-[12.5px] leading-[1.65] text-[var(--text-primary)]"
          style={mono}
        >
          {candidate.suggested_wikitext}
        </pre>
      </div>

      {/* Actions row */}
      <div className="mt-5 flex flex-wrap items-center gap-x-5 gap-y-3">
        <a
          href={candidate.article_url}
          target="_blank"
          rel="noopener noreferrer"
          className="group inline-flex cursor-pointer items-center gap-1.5 text-[13px] font-medium text-[var(--accent-foreground)] transition-colors hover:text-[var(--text-primary)]"
        >
          Open Wikipedia to edit
          <ArrowUpRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
        </a>

        <div className="ml-auto flex flex-wrap items-center gap-x-4 gap-y-2">
          {candidate.status === 'drafted' && (
            <button
              type="button"
              onClick={() => updateStatus('submitted')}
              disabled={updating}
              className="inline-flex cursor-pointer items-center gap-1.5 rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[rgba(255,255,255,0.03)] px-3 py-1.5 text-[12px] font-medium text-[var(--text-primary)] transition-colors hover:bg-[rgba(255,255,255,0.07)] hover:border-[var(--border-strong)] disabled:opacity-50 active:scale-[0.97] [transition:transform_160ms_cubic-bezier(0.23,1,0.32,1),background-color_0.15s_ease,border-color_0.15s_ease]"
            >
              {updating ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
              Mark submitted
            </button>
          )}

          {candidate.status === 'submitted' && (
            <>
              <button
                type="button"
                onClick={() => updateStatus('accepted')}
                disabled={updating}
                className="inline-flex cursor-pointer items-center gap-1.5 text-[12px] font-medium text-[#4ade80] transition-colors hover:text-[#86efac] disabled:opacity-50"
              >
                <Check className="h-3 w-3" />
                Accepted
              </button>
              <button
                type="button"
                onClick={() => updateStatus('reverted')}
                disabled={updating}
                className="cursor-pointer text-[12px] font-medium text-[#fb7185] transition-colors hover:text-[#fda4af] disabled:opacity-50"
              >
                Reverted
              </button>
            </>
          )}

          {candidate.status !== 'dismissed' && (
            <button
              type="button"
              onClick={() => updateStatus('dismissed')}
              disabled={updating}
              className="cursor-pointer text-[12px] text-[var(--text-faint)] transition-colors hover:text-[var(--text-muted)] disabled:opacity-50"
            >
              Dismiss
            </button>
          )}
        </div>
      </div>

      {/* COI as quiet editorial note, no colored callout */}
      <p
        className="mt-5 max-w-[58ch] border-t border-[var(--border-subtle)] pt-4 text-[11.5px] leading-[1.65] text-[var(--text-faint)]"
      >
        <span
          className="mr-2 font-medium uppercase tracking-[0.2em] text-[var(--text-muted)]"
          style={mono}
        >
          Note
        </span>
        Disclose your affiliation on the article&apos;s talk page before editing. Lumidian does
        not post to Wikipedia for you.
      </p>
    </div>
  );
}

function MetaItem({ label, value }: { label: string; value: string }) {
  const mono = { fontFamily: 'var(--font-geist-mono)' } as const;
  return (
    <div className="text-[12px]">
      <span
        className="mr-1.5 text-[10.5px] font-medium uppercase tracking-[0.22em] text-[var(--text-faint)]"
        style={mono}
      >
        {label}
      </span>
      <span className="text-[var(--text-secondary)]">{value}</span>
    </div>
  );
}
