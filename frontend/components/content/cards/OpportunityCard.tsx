'use client';

import { useState } from 'react';
import {
  Loader2,
  X,
  ExternalLink,
  Clock,
  Sparkles,
  Edit2,
  Copy,
  Check,
} from 'lucide-react';
import { ContentOpportunity, ContentDraft } from '@/lib/api';
import PlatformBadge from '@/components/PlatformBadge';
import { relativeTime } from '../helpers';

export function OpportunityCard({
  opp,
  onDraft,
  onDismiss,
  queueFull,
  draftedReply,
  onNavigateToDraft,
}: {
  opp: ContentOpportunity;
  onDraft: (id: number) => void;
  onDismiss: (id: number) => void;
  queueFull?: boolean;
  draftedReply?: ContentDraft | null;
  onNavigateToDraft?: (draftId: number) => void;
}) {
  const [drafting, setDrafting] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);

  async function handleDraft() {
    setDrafting(true);
    try {
      await onDraft(opp.id);
    } finally {
      setDrafting(false);
    }
  }

  async function handleCopy() {
    if (!draftedReply) return;
    try {
      await navigator.clipboard.writeText(draftedReply.content_text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // clipboard unavailable
    }
  }

  const relevanceColor =
    opp.relevance_score >= 70
      ? 'text-[var(--success)]'
      : opp.relevance_score >= 40
      ? 'text-[var(--warning)]'
      : 'text-[var(--text-muted)]';

  const hasDraft = !!draftedReply;

  return (
    <div className="card p-4 flex flex-col gap-3 transition-colors">
      <div className="flex items-center gap-2 flex-wrap">
        <PlatformBadge platform={opp.platform} />
        {opp.subreddit && (
          <span className="text-xs text-[var(--text-muted)] font-medium">r/{opp.subreddit}</span>
        )}
        {hasDraft && (
          <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-[rgba(251,191,36,0.12)] text-[#fbbf24]">
            Drafted
          </span>
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

      {/* Action buttons */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 pt-1">
        {!hasDraft && (
          <button
            onClick={handleDraft}
            disabled={drafting || queueFull}
            title={queueFull ? 'Draft queue full — approve or dismiss drafts to make room' : undefined}
            className="flex items-center gap-1.5 text-xs bg-[var(--accent)] hover:bg-[var(--accent-hover)] disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-lg px-3 py-1.5 transition-colors min-h-[44px] sm:min-h-0"
          >
            {drafting ? <Loader2 size={11} className="animate-spin" /> : <Sparkles size={11} />}
            {drafting ? 'Drafting…' : queueFull ? 'Queue full' : 'Draft Reply'}
          </button>
        )}
        <a
          href={opp.thread_url}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-1.5 text-xs text-[var(--text-secondary)] hover:text-[var(--accent)] rounded-lg px-3 py-1.5 transition-colors border border-[var(--border-subtle)] hover:border-[var(--accent)] min-h-[44px] sm:min-h-0"
        >
          <ExternalLink size={11} />
          Visit Thread
        </a>
        {!hasDraft && (
          <button
            onClick={() => onDismiss(opp.id)}
            className="flex items-center gap-1.5 text-xs text-[var(--danger)]/70 hover:text-[var(--danger)] rounded-lg px-3 py-1.5 transition-colors sm:ml-auto min-h-[44px] sm:min-h-0"
          >
            <X size={11} />
            Dismiss
          </button>
        )}
      </div>

      {/* Inline drafted reply */}
      {hasDraft && draftedReply && (
        <div className="bg-[rgba(99,102,241,0.05)] border border-[rgba(99,102,241,0.15)] rounded-lg p-3 mt-1">
          <p className="text-[11px] font-semibold text-[#818cf8] mb-2 flex items-center gap-1.5">
            <Edit2 size={10} />
            Your drafted reply
          </p>
          <p className="text-xs text-[var(--text-secondary)] leading-relaxed line-clamp-3">
            {draftedReply.content_text}
          </p>
          <div className="flex items-center gap-2 mt-3">
            <button
              onClick={() => onNavigateToDraft?.(draftedReply.id)}
              className="flex items-center gap-1.5 text-xs bg-[var(--bg-raised)] hover:bg-[var(--bg-card)] border border-[var(--border-subtle)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] rounded-lg px-3 py-1.5 transition-colors"
            >
              <Edit2 size={10} />
              Edit
            </button>
            <button
              onClick={handleCopy}
              className={`flex items-center gap-1.5 text-xs rounded-lg px-3 py-1.5 transition-colors border ${
                copied
                  ? 'bg-[color-mix(in_srgb,var(--success)_10%,transparent)] border-[color-mix(in_srgb,var(--success)_25%,transparent)] text-[var(--success)]'
                  : 'bg-[var(--bg-raised)] border-[var(--border-subtle)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-card)]'
              }`}
            >
              {copied ? <Check size={10} /> : <Copy size={10} />}
              {copied ? 'Copied!' : 'Copy'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
