'use client';

import { useState } from 'react';
import {
  Loader2,
  X,
  ExternalLink,
  Clock,
  Sparkles,
} from 'lucide-react';
import { ContentOpportunity } from '@/lib/api';
import PlatformBadge from '@/components/PlatformBadge';
import { relativeTime } from '../helpers';

export function OpportunityCard({
  opp,
  onDraft,
  onDismiss,
  queueFull,
}: {
  opp: ContentOpportunity;
  onDraft: (id: number) => void;
  onDismiss: (id: number) => void;
  queueFull?: boolean;
}) {
  const [drafting, setDrafting] = useState(false);
  const [expanded, setExpanded] = useState(false);

  async function handleDraft() {
    setDrafting(true);
    try {
      await onDraft(opp.id);
    } finally {
      setDrafting(false);
    }
  }

  const relevanceColor =
    opp.relevance_score >= 70
      ? 'text-[var(--success)]'
      : opp.relevance_score >= 40
      ? 'text-[var(--warning)]'
      : 'text-[var(--text-muted)]';

  return (
    <div className="card p-4 flex flex-col gap-3 transition-colors">
      <div className="flex items-center gap-2 flex-wrap">
        <PlatformBadge platform={opp.platform} />
        {opp.subreddit && (
          <span className="text-xs text-[var(--text-muted)] font-medium">r/{opp.subreddit}</span>
        )}
        <span className={`text-xs font-semibold font-mono ml-auto ${relevanceColor}`}>
          {Math.round(opp.relevance_score)}% relevance
        </span>
      </div>

      <a
        href={opp.thread_url}
        target="_blank"
        rel="noopener noreferrer"
        className="text-sm font-medium text-[var(--text-primary)] hover:text-[var(--accent)] transition-colors leading-snug flex items-start gap-1.5"
      >
        {opp.thread_title || opp.thread_url}
        <ExternalLink size={11} className="shrink-0 mt-0.5 text-[var(--text-faint)]" />
      </a>

      {opp.body_preview && (
        <div className="relative">
          <p
            className={`text-xs text-[var(--text-faint)] leading-relaxed cursor-pointer ${
              expanded ? 'max-h-48 overflow-y-auto pr-2' : 'line-clamp-2'
            }`}
            onClick={() => setExpanded(!expanded)}
          >
            {opp.body_preview}
          </p>
          {opp.body_preview.length > 150 && (
            <button
              onClick={() => setExpanded(!expanded)}
              className="text-[10px] text-[var(--accent)] hover:text-[var(--accent-foreground)] mt-1"
            >
              {expanded ? 'Show less' : 'Show more'}
            </button>
          )}
        </div>
      )}

      <div className="flex items-center gap-3 text-xs text-[var(--text-faint)]">
        {opp.posted_at && (
          <span className="flex items-center gap-1">
            <Clock size={10} />
            {relativeTime(opp.posted_at)}
          </span>
        )}
        {opp.prompt_text && (
          <span className="text-[var(--text-faint)] truncate max-w-[200px]">
            Prompt: {opp.prompt_text}
          </span>
        )}
      </div>

      <div className="flex items-center gap-2 pt-1">
        <button
          onClick={handleDraft}
          disabled={drafting || queueFull}
          title={queueFull ? 'Draft queue full — approve or dismiss drafts to make room' : undefined}
          className="flex items-center gap-1.5 text-xs bg-[var(--accent)] hover:bg-[var(--accent-hover)] disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-lg px-3 py-1.5 transition-colors"
        >
          {drafting ? <Loader2 size={11} className="animate-spin" /> : <Sparkles size={11} />}
          {drafting ? 'Drafting…' : queueFull ? 'Queue full' : 'Draft Reply'}
        </button>
        <button
          onClick={() => onDismiss(opp.id)}
          className="flex items-center gap-1.5 text-xs text-[var(--danger)]/70 hover:text-[var(--danger)] rounded-lg px-3 py-1.5 transition-colors ml-auto"
        >
          <X size={11} />
          Dismiss
        </button>
      </div>
    </div>
  );
}
