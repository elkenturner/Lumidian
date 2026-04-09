'use client';

import React, { useState } from 'react';
import {
  FileText,
  ChevronDown,
  ExternalLink,
  CheckCircle2,
  Edit2,
  AlertTriangle,
  Copy,
  Check,
  BookOpen,
  HelpCircle,
} from 'lucide-react';
import { ContentDraft } from '@/lib/api';
import PlatformBadge from '@/components/PlatformBadge';
import { relativeTime, PLATFORM_DISPLAY } from '../helpers';

// ── Posting guidance ────────────────────────────────────────────────────────

const POSTING_GUIDANCE: Record<string, (brief: string | null) => React.ReactNode> = {
  reddit: (brief) => {
    const subreddit = brief?.match(/r\/([^\s,)]+)/)?.[1] ?? 'relevant subreddit';
    return (
      <ol className="list-decimal list-inside space-y-1 text-xs text-[var(--text-secondary)] leading-relaxed">
        <li>Go to <span className="text-[var(--accent)]">reddit.com/r/{subreddit}</span></li>
        <li>Click <span className="text-[var(--text-primary)] font-medium">New Post</span></li>
        <li>Choose <span className="text-[var(--text-primary)] font-medium">Text post</span></li>
        <li>Paste the title and body from the draft above</li>
        <li>Add relevant flair if available</li>
        <li>Click <span className="text-[var(--text-primary)] font-medium">Submit</span></li>
        <p className="mt-1 text-[var(--text-faint)] not-italic">Tip: Post between 9 am–12 pm in your target audience&apos;s timezone for best engagement.</p>
      </ol>
    );
  },
  quora: (brief) => {
    const isDirectUrl = brief?.startsWith('https://www.quora.com') || brief?.startsWith('https://quora.com');
    if (isDirectUrl) {
      return (
        <ol className="list-decimal list-inside space-y-1 text-xs text-[var(--text-secondary)] leading-relaxed">
          <li>Open <a href={brief!} target="_blank" rel="noopener noreferrer" className="text-[var(--accent)] hover:underline break-all">{brief}</a></li>
          <li>Click <span className="text-[var(--text-primary)] font-medium">Answer</span></li>
          <li>Paste your draft</li>
          <li>Add your credentials if relevant</li>
          <li>Click <span className="text-[var(--text-primary)] font-medium">Submit</span></li>
          <p className="mt-1 text-[var(--text-faint)] not-italic">Tip: Answer questions posted within the last 30 days for maximum visibility.</p>
        </ol>
      );
    }
    const topic = brief ? brief.split(' — ')[0].replace(/^Targeting: /i, '') : 'your topic';
    return (
      <ol className="list-decimal list-inside space-y-1 text-xs text-[var(--text-secondary)] leading-relaxed">
        <li>Go to <span className="text-[var(--accent)]">quora.com</span> and search for <span className="text-[var(--text-primary)] font-medium">&ldquo;{topic.slice(0, 40)}&rdquo;</span></li>
        <li>Find a relevant question</li>
        <li>Click <span className="text-[var(--text-primary)] font-medium">Answer</span></li>
        <li>Paste your draft</li>
        <li>Add your credentials if relevant</li>
        <li>Click <span className="text-[var(--text-primary)] font-medium">Submit</span></li>
        <p className="mt-1 text-[var(--text-faint)] not-italic">Tip: Answer questions posted within the last 30 days for maximum visibility.</p>
      </ol>
    );
  },
  medium: () => (
    <ol className="list-decimal list-inside space-y-1 text-xs text-[var(--text-secondary)] leading-relaxed">
      <li>Go to <a href="https://medium.com/new-story" target="_blank" rel="noopener noreferrer" className="text-[var(--accent)] hover:underline">medium.com/new-story</a></li>
      <li>Paste your title and body</li>
      <li>Add tags relevant to your topic (up to 5)</li>
      <li>Set a featured image if possible</li>
      <li>Click <span className="text-[var(--text-primary)] font-medium">Publish</span></li>
      <p className="mt-1 text-[var(--text-faint)] not-italic">Tip: Add your company publication if you have one set up.</p>
    </ol>
  ),
  wikipedia: () => (
    <ol className="list-decimal list-inside space-y-1 text-xs text-[var(--text-secondary)] leading-relaxed">
      <li>Find the target article on Wikipedia</li>
      <li>Click <span className="text-[var(--text-primary)] font-medium">Edit</span></li>
      <li>Navigate to the suggested section</li>
      <li>Paste the wiki-formatted text (use Copy Wiki Format button)</li>
      <li>Add an edit summary explaining your addition</li>
      <li>Click <span className="text-[var(--text-primary)] font-medium">Save</span></li>
      <p className="mt-1 text-[var(--warning)] not-italic flex items-start gap-1"><AlertTriangle size={10} className="shrink-0 mt-0.5" />Disclose any conflict of interest on the article talk page first.</p>
    </ol>
  ),
};

// ── Scheduled card ──────────────────────────────────────────────────────────

export function ScheduledCard({
  draft,
  onMarkPosted,
  onMoveToDrafts,
}: {
  draft: ContentDraft;
  onMarkPosted: (id: number) => void;
  onMoveToDrafts: (id: number) => void;
}) {
  const [expanded, setExpanded] = useState(true);
  const [guideOpen, setGuideOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const title = draft.title ?? draft.content_text.slice(0, 80) + (draft.content_text.length > 80 ? '…' : '');

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(draft.content_text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // clipboard unavailable — fail silently
    }
  }

  const guidance = POSTING_GUIDANCE[draft.platform];

  return (
    <div className="card p-4 flex flex-col gap-3 transition-colors">
      <div className="flex items-center gap-2 flex-wrap">
        <PlatformBadge platform={draft.platform} />
        {draft.approved_at && (
          <span className="text-xs text-[var(--text-muted)] flex items-center gap-1">
            <CheckCircle2 size={11} className="text-[var(--success)]" />
            Approved {relativeTime(draft.approved_at)}
          </span>
        )}
      </div>

      {draft.content_brief && (
        <p className="text-xs text-[var(--text-faint)] leading-relaxed line-clamp-2">
          <span className="text-[var(--text-muted)]">Targeting: </span>
          {draft.content_brief}
        </p>
      )}

      <div>
        {draft.title && (
          <p className="text-sm font-semibold text-[var(--text-primary)] leading-snug mb-1">{draft.title}</p>
        )}
        {!draft.title && (
          <p className="text-sm text-[var(--text-secondary)] leading-relaxed truncate">{title}</p>
        )}
      </div>

      {expanded && (
        <div className="bg-[var(--bg-raised)] border border-[var(--border-subtle)] rounded-lg p-3 relative">
          <pre className="text-xs text-[var(--text-secondary)] whitespace-pre-wrap leading-relaxed font-mono pr-14">
            {draft.content_text}
          </pre>
          <button
            onClick={handleCopy}
            className="absolute top-2 right-2 flex items-center gap-1 text-[10px] text-[var(--text-faint)] hover:text-[var(--text-secondary)] transition-colors"
          >
            {copied ? <Check size={11} className="text-[var(--success)]" /> : <Copy size={11} />}
            {copied ? 'Copied' : 'Copy'}
          </button>
        </div>
      )}

      {guidance && (
        <div className="border border-[var(--border-default)] rounded-lg overflow-hidden">
          <button
            onClick={() => setGuideOpen(!guideOpen)}
            className="w-full flex items-center justify-between px-3 py-2 bg-[var(--bg-raised)] hover:bg-[var(--bg-card)] text-left transition-colors"
          >
            <span className="flex items-center gap-1.5 text-xs text-[var(--text-muted)] font-medium">
              <BookOpen size={11} />
              How to Post on {PLATFORM_DISPLAY[draft.platform] ?? draft.platform}
            </span>
            <ChevronDown size={11} className={`text-[var(--text-faint)] transition-transform ${guideOpen ? 'rotate-180' : ''}`} />
          </button>
          {guideOpen && (
            <div className="px-3 py-3 bg-transparent">
              {guidance(draft.content_brief)}
            </div>
          )}
        </div>
      )}

      <div className="bg-[color-mix(in_srgb,var(--success)_5%,transparent)] border border-[color-mix(in_srgb,var(--success)_12%,transparent)] rounded-lg px-3 py-2 flex items-start gap-2">
        <HelpCircle size={11} className="text-[var(--success)] mt-0.5 shrink-0" />
        <p className="text-[11px] text-[var(--text-faint)] leading-relaxed">
          <span className="text-[var(--text-muted)] font-medium">This draft needs to be posted manually.</span>
          {' '}Use the View Draft button to copy the content, post it on {PLATFORM_DISPLAY[draft.platform] ?? draft.platform}, then click{' '}
          <span className="text-[var(--success)]">Mark as Posted</span> to record it and start tracking visibility changes.
        </p>
      </div>

      <div className="flex items-center gap-2 pt-1 flex-wrap">
        <button
          onClick={() => setExpanded(!expanded)}
          className="flex items-center gap-1.5 text-xs bg-[var(--bg-raised)] hover:bg-[var(--bg-card)] border border-[var(--border-subtle)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] rounded-lg px-3 py-1.5 transition-colors"
        >
          <FileText size={11} />
          {expanded ? 'Hide Draft' : 'View Draft'}
        </button>
        <button
          onClick={() => onMarkPosted(draft.id)}
          className="flex items-center gap-1.5 text-xs bg-[color-mix(in_srgb,var(--success)_10%,transparent)] hover:bg-[color-mix(in_srgb,var(--success)_15%,transparent)] border border-[color-mix(in_srgb,var(--success)_25%,transparent)] text-[var(--success)] rounded-lg px-3 py-1.5 transition-colors duration-150"
        >
          <CheckCircle2 size={11} />
          Mark as Posted
        </button>
        <button
          onClick={() => onMoveToDrafts(draft.id)}
          className="flex items-center gap-1.5 text-xs text-[var(--text-faint)] hover:text-[var(--text-muted)] rounded-lg px-3 py-1.5 transition-colors ml-auto"
        >
          <Edit2 size={11} />
          Move back to Drafts
        </button>
      </div>
    </div>
  );
}
