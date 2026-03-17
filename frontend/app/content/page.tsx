'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import {
  Plus,
  FileText,
  Loader2,
  X,
  ChevronDown,
  ExternalLink,
  Zap,
  Radio,
  Clock,
  CheckCircle2,
  Send,
  Trash2,
  Edit2,
  BarChart2,
  AlertTriangle,
  RefreshCw,
  ToggleLeft,
  ToggleRight,
  Sparkles,
  HelpCircle,
  Copy,
  Check,
} from 'lucide-react';
import {
  getBrands,
  getDrafts,
  updateDraft,
  postDraft,
  deleteDraft,
  getContentSettings,
  updateContentSettings,
  getAttribution,
  getOpportunities,
  dismissOpportunity,
  draftOpportunity,
  generateNow,
  triggerScan,
  Brand,
  ContentDraft,
  ContentOpportunity,
  BrandContentSettings,
  ContentAttribution,
} from '@/lib/api';
import PlatformBadge from '@/components/PlatformBadge';
import { formatDistanceToNow, parseISO, format } from 'date-fns';

// ── Types ─────────────────────────────────────────────────────────────────────

type QueueTab = 'drafts' | 'opportunities' | 'scheduled' | 'posted';

const PLATFORMS = ['reddit', 'quora', 'medium', 'wikipedia', 'linkedin', 'twitter'];

const FREQ_OPTIONS = [
  { value: 'daily', label: 'Daily' },
  { value: 'every_3_days', label: 'Every 3 days' },
  { value: 'weekly', label: 'Weekly' },
  { value: 'manual', label: 'Manual only' },
];

// ── Helpers ───────────────────────────────────────────────────────────────────

function relativeTime(iso: string | null): string {
  if (!iso) return 'Unknown';
  try {
    return formatDistanceToNow(parseISO(iso), { addSuffix: true });
  } catch {
    return iso;
  }
}

// ── Help modal ────────────────────────────────────────────────────────────────

function HelpModal({
  title,
  children,
  onClose,
}: {
  title: string;
  children: React.ReactNode;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div className="relative bg-[#111118] border border-[#1e1e2e] rounded-2xl p-6 max-w-md w-full shadow-2xl">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-base font-semibold text-[#e2e8f0]">{title}</h3>
          <button onClick={onClose} className="text-[#475569] hover:text-[#94a3b8] transition-colors">
            <X size={16} />
          </button>
        </div>
        <div className="text-sm text-[#94a3b8] leading-relaxed space-y-3">{children}</div>
      </div>
    </div>
  );
}

// ── Draft card (Drafts tab) ───────────────────────────────────────────────────

function DraftCard({
  draft,
  onApprove,
  onDelete,
  onSaved,
}: {
  draft: ContentDraft;
  onApprove: (id: number) => void;
  onDelete: (id: number) => void;
  onSaved: (d: ContentDraft) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [editTitle, setEditTitle] = useState(draft.title ?? '');
  const [editContent, setEditContent] = useState(draft.content_text);
  const [saving, setSaving] = useState(false);

  const preview = draft.content_text.slice(0, 200) + (draft.content_text.length > 200 ? '…' : '');

  async function handleSave() {
    setSaving(true);
    try {
      const updated = await updateDraft(draft.id, {
        title: editTitle || undefined,
        content_text: editContent,
      });
      onSaved(updated);
      setEditing(false);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="bg-[#111118] border border-[#1e1e2e] rounded-xl p-4 flex flex-col gap-3 hover:border-[#2a2a3a] transition-colors">
      {/* Top row */}
      <div className="flex items-center gap-2 flex-wrap">
        <PlatformBadge platform={draft.platform} />
        {draft.visibility_score_at_draft != null && (
          <span className="text-xs text-[#64748b] flex items-center gap-1">
            <BarChart2 size={11} />
            Current visibility: {Math.round(draft.visibility_score_at_draft)}%
          </span>
        )}
      </div>

      {/* Target prompt / posting instruction */}
      {draft.content_brief && draft.platform === 'quora' ? (
        <div className="flex items-start gap-2 bg-[#172554]/30 border border-[#1d4ed8]/30 rounded-lg px-3 py-2">
          <span className="text-[#60a5fa] text-xs mt-0.5">→</span>
          <p className="text-xs text-[#93c5fd] leading-relaxed">{draft.content_brief}</p>
        </div>
      ) : draft.content_brief && draft.platform === 'reddit' ? (
        <p className="text-xs text-[#475569] leading-relaxed">
          <span className="text-[#f97316] font-medium">{draft.content_brief.split(' — ')[0]}</span>
          {draft.content_brief.includes(' — ') && (
            <span className="text-[#475569]"> — {draft.content_brief.split(' — ').slice(1).join(' — ')}</span>
          )}
        </p>
      ) : draft.content_brief ? (
        <p className="text-xs text-[#475569] leading-relaxed line-clamp-2">
          <span className="text-[#64748b]">Targeting: </span>
          {draft.content_brief}
        </p>
      ) : null}

      {/* Title or inline editor */}
      {editing ? (
        <div className="flex flex-col gap-2">
          <input
            type="text"
            value={editTitle}
            onChange={(e) => setEditTitle(e.target.value)}
            placeholder="Title (optional)"
            className="w-full bg-[#1a1a24] border border-[#1e1e2e] text-[#e2e8f0] rounded-lg px-3 py-2 text-sm placeholder:text-[#475569] focus:outline-none focus:border-[#6366f1]"
          />
          <textarea
            value={editContent}
            onChange={(e) => setEditContent(e.target.value)}
            rows={8}
            className="w-full bg-[#1a1a24] border border-[#1e1e2e] text-[#e2e8f0] rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#6366f1] resize-none font-mono"
          />
          <div className="flex gap-2">
            <button
              onClick={handleSave}
              disabled={saving}
              className="flex items-center gap-1.5 text-xs bg-[#6366f1] hover:bg-[#4f46e5] disabled:opacity-50 text-white rounded-lg px-3 py-1.5 transition-colors"
            >
              {saving ? <Loader2 size={11} className="animate-spin" /> : null}
              Save
            </button>
            <button
              onClick={() => setEditing(false)}
              className="text-xs text-[#64748b] hover:text-[#94a3b8] px-3 py-1.5 transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div>
          {draft.title && (
            <p className="text-sm font-semibold text-[#e2e8f0] leading-snug mb-1">{draft.title}</p>
          )}
          <p className="text-sm text-[#64748b] leading-relaxed">{preview}</p>
        </div>
      )}

      {/* Actions */}
      {!editing && (
        <div className="flex items-center gap-2 pt-1 flex-wrap">
          <button
            onClick={() => setEditing(true)}
            className="flex items-center gap-1.5 text-xs bg-[#1a1a24] hover:bg-[#2a2a3a] border border-[#2a2a3a] text-[#94a3b8] hover:text-[#e2e8f0] rounded-lg px-3 py-1.5 transition-colors"
          >
            <Edit2 size={11} />
            Edit
          </button>
          <button
            onClick={() => onApprove(draft.id)}
            className="flex items-center gap-1.5 text-xs bg-[#064e3b]/30 hover:bg-[#064e3b]/50 border border-[#065f46]/40 text-[#10b981] rounded-lg px-3 py-1.5 transition-colors"
          >
            <CheckCircle2 size={11} />
            Approve
          </button>
          <button
            onClick={() => onDelete(draft.id)}
            className="flex items-center gap-1.5 text-xs bg-[#7f1d1d]/20 hover:bg-[#7f1d1d]/30 border border-[#991b1b]/30 text-[#f87171] rounded-lg px-3 py-1.5 transition-colors ml-auto"
          >
            <Trash2 size={11} />
            Dismiss
          </button>
        </div>
      )}
    </div>
  );
}

// ── Wikipedia helpers ─────────────────────────────────────────────────────────

/** Strip wiki markup to produce editable plain text. */
function wikiToPlain(wiki: string): string {
  return wiki
    .replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, '$2')   // [[Article|Text]] → Text
    .replace(/\[\[([^\]]+)\]\]/g, '$1')               // [[Article]] → Article
    .replace(/<ref[^>]*>[\s\S]*?<\/ref>/g, '')        // remove <ref>…</ref>
    .replace(/<ref[^>]*\/>/g, '')                     // remove <ref … />
    .replace(/'{2,3}/g, '')                           // remove '' and '''
    .replace(/\s{2,}/g, ' ')
    .trim();
}

/** Pull all <ref>…</ref> tags out of a wiki string. */
function extractCitations(wiki: string): string[] {
  const refs: string[] = [];
  const re = /<ref[^>]*>[\s\S]*?<\/ref>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(wiki)) !== null) refs.push(m[0]);
  return refs;
}

/**
 * Extract [[wikilinks]] targets from the original LLM wiki output.
 * Returns a map of lowercased term → full [[...]] link markup.
 */
function extractWikiLinks(wiki: string): Map<string, string> {
  const map = new Map<string, string>();
  const re = /\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(wiki)) !== null) {
    const target = m[1];
    const display = m[2] ?? m[1];
    // Store by lowercased display text so we can re-link matching terms in plain text
    map.set(display.toLowerCase(), m[0]);
    map.set(target.toLowerCase(), m[0]);
  }
  return map;
}

/**
 * Convert plain text back to Wikipedia wikitext.
 * - Re-links terms that had [[wikilinks]] in the original LLM output
 * - Converts markdown **bold** → '''bold''', *italic* → ''italic''
 * - Converts markdown ## headers → == Header ==
 * - Reinserts citations at sentence boundaries
 * - Auto-links first occurrence of brandName if not already linked
 */
function plainToWikiFormat(
  plain: string,
  originalWiki: string,
  citations: string[],
  brandName: string,
): string {
  const wikiLinks = extractWikiLinks(originalWiki);
  let out = plain;

  // Convert markdown headers first (before other substitutions)
  out = out.replace(/^#{1,6}\s+(.+)$/gm, (_, title) => `== ${title.trim()} ==`);

  // Convert markdown bold/italic
  out = out.replace(/\*\*\*(.+?)\*\*\*/g, "'''$1'''");   // ***bold italic***
  out = out.replace(/\*\*(.+?)\*\*/g, "'''$1'''");        // **bold**
  out = out.replace(/\*(.+?)\*/g, "''$1''");              // *italic*

  // Re-apply wikilinks from original — replace first occurrence of each linked term
  const linkedTerms = new Set<string>();
  wikiLinks.forEach((markup, term) => {
    if (linkedTerms.has(term)) return;
    // Only link the first occurrence (case-insensitive)
    const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(`(?<![\\[|])\\b${escaped}\\b(?![\\]|])`, 'i');
    const replaced = out.replace(re, markup);
    if (replaced !== out) {
      linkedTerms.add(term);
      out = replaced;
    }
  });

  // Auto-link first occurrence of brand name if not already linked
  if (brandName) {
    const escaped = brandName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(`(?<!\\[\\[)\\b${escaped}\\b(?!\\]\\])`, 'i');
    out = out.replace(re, `[[${brandName}]]`);
  }

  // Reinsert citations before trailing period of each sentence that had one
  if (citations.length > 0) {
    const t = out.trimEnd();
    out = t.endsWith('.') ? t.slice(0, -1) + citations.join('') + '.' : t + citations.join('');
  }

  return out;
}

// ── Wikipedia draft card ──────────────────────────────────────────────────────

function WikipediaDraftCard({
  draft,
  brandName,
  onDelete,
  onSaved,
}: {
  draft: ContentDraft;
  brandName: string;
  onDelete: (id: number) => void;
  onSaved: (d: ContentDraft) => void;
}) {
  const originalWiki = draft.content_text;
  const citations = extractCitations(originalWiki);

  const [plainText, setPlainText] = useState(() => wikiToPlain(originalWiki));
  const [hasEdited, setHasEdited] = useState(false);
  const [copied, setCopied] = useState(false);
  const [saving, setSaving] = useState(false);

  // If the user hasn't edited yet, show the original wiki (links intact).
  // Once they edit, rebuild from their plain text with proper wiki conversion.
  const wikiFormat = hasEdited
    ? plainToWikiFormat(plainText, originalWiki, citations, brandName)
    : originalWiki;

  const showCOI = plainText.toLowerCase().includes((brandName ?? '').toLowerCase()) && brandName.length > 0;

  function handlePlainChange(val: string) {
    setPlainText(val);
    setHasEdited(true);
  }

  async function handleCopy() {
    await navigator.clipboard.writeText(wikiFormat);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  async function handleSave() {
    setSaving(true);
    try {
      // Save the rebuilt wiki format so refreshing restores the latest edit
      const updated = await updateDraft(draft.id, { content_text: wikiFormat });
      onSaved(updated);
    } finally {
      setSaving(false);
    }
  }

  const articleUrl = draft.content_brief ?? '';
  const articleTitle = draft.title ?? 'Unknown Wikipedia article';
  // insert_location is stored in platform_guidelines_applied for Wikipedia drafts
  const insertLocation = draft.platform_guidelines_applied ?? '';

  return (
    <div className="bg-[#111118] border border-[#1e1e2e] rounded-xl p-4 flex flex-col gap-3 hover:border-[#2a2a3a] transition-colors">
      {/* Platform badge + article link */}
      <div className="flex items-start gap-2 flex-wrap">
        <PlatformBadge platform="wikipedia" />
        <div className="flex-1 min-w-0">
          {articleUrl ? (
            <a
              href={articleUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm font-medium text-[#e2e8f0] hover:text-[#818cf8] transition-colors flex items-center gap-1 leading-snug"
            >
              {articleTitle}
              <ExternalLink size={11} className="shrink-0 text-[#475569]" />
            </a>
          ) : (
            <p className="text-sm font-medium text-[#e2e8f0] leading-snug">{articleTitle}</p>
          )}
          {draft.visibility_score_at_draft != null && (
            <p className="text-xs text-[#64748b] mt-0.5 flex items-center gap-1">
              <BarChart2 size={10} />
              Current visibility: {Math.round(draft.visibility_score_at_draft)}%
            </p>
          )}
        </div>
      </div>

      {/* Insertion location guide */}
      {insertLocation && (
        <div className="bg-[#0d1117] border border-[#1e2d3d] rounded-lg px-3 py-2.5">
          <p className="text-xs text-[#64748b] uppercase tracking-wide mb-1 font-medium">Where to insert</p>
          <p className="text-xs text-[#94a3b8] leading-relaxed">{insertLocation}</p>
        </div>
      )}

      {/* COI disclaimer — only when draft mentions the brand */}
      {showCOI && (
        <div className="flex items-start gap-2 bg-[#451a03]/20 border border-[#78350f]/40 rounded-lg px-3 py-2.5">
          <AlertTriangle size={13} className="text-[#f59e0b] shrink-0 mt-0.5" />
          <p className="text-xs text-[#fbbf24] leading-relaxed">
            <span className="font-semibold">COI disclosure required.</span>{' '}
            You must disclose your conflict of interest on the article&apos;s talk page before
            editing.{' '}
            <a
              href="https://en.wikipedia.org/wiki/Wikipedia:Conflict_of_interest"
              target="_blank"
              rel="noopener noreferrer"
              className="underline decoration-[#f59e0b]/50 hover:decoration-[#f59e0b]"
            >
              See Wikipedia&apos;s COI guidelines.
            </a>
          </p>
        </div>
      )}

      {/* Plain-text editor */}
      <div>
        <label className="text-xs text-[#64748b] uppercase tracking-wide mb-1.5 block">
          Text to insert
        </label>
        <textarea
          value={plainText}
          onChange={(e) => handlePlainChange(e.target.value)}
          rows={5}
          className="w-full bg-[#1a1a24] border border-[#1e1e2e] text-[#e2e8f0] rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-[#6366f1] resize-none leading-relaxed font-sans"
          placeholder="Edit the plain text. Wiki formatting and citations are applied automatically."
        />
        <p className="text-xs text-[#475569] mt-1">
          Edit in plain text. Wiki links and citation are added when you copy.
        </p>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-2 pt-1 flex-wrap">
        <button
          onClick={handleCopy}
          className={`flex items-center gap-1.5 text-xs rounded-lg px-3 py-1.5 transition-colors ${
            copied
              ? 'bg-[#052e16]/50 border border-[#065f46]/60 text-[#34d399]'
              : 'bg-[#6366f1] hover:bg-[#4f46e5] text-white'
          }`}
        >
          {copied ? <Check size={11} /> : <Copy size={11} />}
          {copied ? 'Copied!' : 'Copy Wiki Format'}
        </button>
        <button
          onClick={handleSave}
          disabled={saving}
          className="flex items-center gap-1.5 text-xs bg-[#1a1a24] hover:bg-[#2a2a3a] border border-[#2a2a3a] text-[#94a3b8] hover:text-[#e2e8f0] rounded-lg px-3 py-1.5 transition-colors disabled:opacity-50"
        >
          {saving ? <Loader2 size={11} className="animate-spin" /> : null}
          Save
        </button>
        <button
          onClick={() => onDelete(draft.id)}
          className="flex items-center gap-1.5 text-xs text-[#475569] hover:text-[#f87171] rounded-lg px-3 py-1.5 transition-colors ml-auto"
        >
          <Trash2 size={11} />
          Dismiss
        </button>
      </div>
    </div>
  );
}

// ── Opportunity card (Live Opportunities tab) ─────────────────────────────────

function OpportunityCard({
  opp,
  onDraft,
  onDismiss,
}: {
  opp: ContentOpportunity;
  onDraft: (id: number) => void;
  onDismiss: (id: number) => void;
}) {
  const [drafting, setDrafting] = useState(false);

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
      ? 'text-[#10b981]'
      : opp.relevance_score >= 40
      ? 'text-[#f59e0b]'
      : 'text-[#64748b]';

  return (
    <div className="bg-[#111118] border border-[#1e1e2e] rounded-xl p-4 flex flex-col gap-3 hover:border-[#2a2a3a] transition-colors">
      {/* Top row */}
      <div className="flex items-center gap-2 flex-wrap">
        <PlatformBadge platform={opp.platform} />
        {opp.subreddit && (
          <span className="text-xs text-[#64748b] font-medium">r/{opp.subreddit}</span>
        )}
        <span className={`text-xs font-semibold ml-auto ${relevanceColor}`}>
          {Math.round(opp.relevance_score)}% relevance
        </span>
      </div>

      {/* Thread title */}
      <a
        href={opp.thread_url}
        target="_blank"
        rel="noopener noreferrer"
        className="text-sm font-medium text-[#e2e8f0] hover:text-[#818cf8] transition-colors leading-snug flex items-start gap-1.5"
      >
        {opp.thread_title || opp.thread_url}
        <ExternalLink size={11} className="shrink-0 mt-0.5 text-[#475569]" />
      </a>

      {/* Body preview */}
      {opp.body_preview && (
        <p className="text-xs text-[#475569] leading-relaxed line-clamp-2">{opp.body_preview}</p>
      )}

      {/* Meta */}
      <div className="flex items-center gap-3 text-xs text-[#475569]">
        <span className="flex items-center gap-1">
          <Clock size={10} />
          {relativeTime(opp.posted_at)}
        </span>
        {opp.prompt_text && (
          <span className="text-[#475569] truncate max-w-[200px]">
            Prompt: {opp.prompt_text}
          </span>
        )}
      </div>

      {/* Actions */}
      <div className="flex items-center gap-2 pt-1">
        <button
          onClick={handleDraft}
          disabled={drafting}
          className="flex items-center gap-1.5 text-xs bg-[#6366f1] hover:bg-[#4f46e5] disabled:opacity-50 text-white rounded-lg px-3 py-1.5 transition-colors"
        >
          {drafting ? <Loader2 size={11} className="animate-spin" /> : <Sparkles size={11} />}
          {drafting ? 'Drafting…' : 'Draft Reply'}
        </button>
        <button
          onClick={() => onDismiss(opp.id)}
          className="flex items-center gap-1.5 text-xs text-[#475569] hover:text-[#64748b] rounded-lg px-3 py-1.5 transition-colors ml-auto"
        >
          <X size={11} />
          Dismiss
        </button>
      </div>
    </div>
  );
}

// ── Scheduled card (Approved, waiting to post) ────────────────────────────────

function ScheduledCard({
  draft,
  onPost,
  onDelete,
}: {
  draft: ContentDraft;
  onPost: (id: number) => void;
  onDelete: (id: number) => void;
}) {
  const [posting, setPosting] = useState(false);

  async function handlePost() {
    setPosting(true);
    try {
      await onPost(draft.id);
    } finally {
      setPosting(false);
    }
  }

  return (
    <div className="bg-[#111118] border border-[#1e1e2e] rounded-xl p-4 flex flex-col gap-3 hover:border-[#2a2a3a] transition-colors">
      <div className="flex items-center gap-2 flex-wrap">
        <PlatformBadge platform={draft.platform} />
        <span className="text-xs font-semibold text-[#10b981] bg-[#064e3b]/30 border border-[#065f46]/40 rounded-full px-2 py-0.5">
          Approved
        </span>
        {draft.visibility_score_at_draft != null && (
          <span className="text-xs text-[#64748b] flex items-center gap-1 ml-auto">
            <BarChart2 size={11} />
            Current visibility: {Math.round(draft.visibility_score_at_draft)}%
          </span>
        )}
      </div>

      {draft.title && (
        <p className="text-sm font-semibold text-[#e2e8f0] leading-snug">{draft.title}</p>
      )}
      <p className="text-sm text-[#64748b] leading-relaxed line-clamp-3">
        {draft.content_text.slice(0, 200)}{draft.content_text.length > 200 ? '…' : ''}
      </p>

      <div className="text-xs text-[#475569]">Approved {relativeTime(draft.updated_at)}</div>

      <div className="flex items-center gap-2 pt-1">
        <button
          onClick={handlePost}
          disabled={posting}
          className="flex items-center gap-1.5 text-xs bg-[#6366f1] hover:bg-[#4f46e5] disabled:opacity-50 text-white rounded-lg px-3 py-1.5 transition-colors"
        >
          {posting ? <Loader2 size={11} className="animate-spin" /> : <Send size={11} />}
          {posting ? 'Posting…' : 'Mark as Posted'}
        </button>
        <button
          onClick={() => onDelete(draft.id)}
          className="flex items-center gap-1.5 text-xs text-[#f87171] hover:text-[#ef4444] rounded-lg px-3 py-1.5 transition-colors ml-auto"
        >
          <Trash2 size={11} />
          Remove
        </button>
      </div>
    </div>
  );
}

// ── Posted card ───────────────────────────────────────────────────────────────

function PostedCard({
  draft,
  attribution,
}: {
  draft: ContentDraft;
  attribution: ContentAttribution | null;
}) {
  return (
    <div className="bg-[#111118] border border-[#1e1e2e] rounded-xl p-4 flex flex-col gap-3">
      <div className="flex items-center gap-2 flex-wrap">
        <PlatformBadge platform={draft.platform} />
        <span className="text-xs font-semibold text-[#60a5fa] bg-[#172554]/40 border border-[#1d4ed8]/30 rounded-full px-2 py-0.5">
          Posted
        </span>
        <span className="text-xs text-[#475569] ml-auto">{relativeTime(draft.updated_at)}</span>
      </div>

      {draft.title && (
        <p className="text-sm font-semibold text-[#e2e8f0] leading-snug">{draft.title}</p>
      )}
      <p className="text-sm text-[#64748b] leading-relaxed line-clamp-2">
        {draft.content_text.slice(0, 160)}{draft.content_text.length > 160 ? '…' : ''}
      </p>

      {/* Attribution */}
      {attribution && attribution.improvement_pct != null && (
        <div className="bg-[#0d0d14] border border-[#1e1e2e] rounded-lg px-3 py-2">
          <p className="text-xs text-[#64748b] mb-1">Visibility attribution</p>
          <div className="flex items-center gap-4 text-xs">
            <span className="text-[#475569]">
              Before: <span className="text-[#94a3b8]">{attribution.visibility_before?.toFixed(0)}%</span>
            </span>
            <span className="text-[#475569]">
              After: <span className="text-[#94a3b8]">{attribution.visibility_after?.toFixed(0)}%</span>
            </span>
            <span className={`font-semibold ${(attribution.improvement_pct ?? 0) >= 0 ? 'text-[#10b981]' : 'text-[#f87171]'}`}>
              {(attribution.improvement_pct ?? 0) >= 0 ? '+' : ''}{attribution.improvement_pct?.toFixed(1)}%
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Platform toggle row (right panel) ─────────────────────────────────────────

function PlatformSettingRow({
  platform,
  setting,
  isConnected,
  onToggleEnabled,
  onToggleAutoPost,
  onFreqChange,
}: {
  platform: string;
  setting: BrandContentSettings | undefined;
  isConnected: boolean;
  onToggleEnabled: (platform: string, enabled: boolean) => void;
  onToggleAutoPost: (platform: string, autoPost: boolean) => void;
  onFreqChange: (platform: string, freq: string) => void;
}) {
  const enabled = setting?.enabled ?? true;
  const autoPost = setting?.auto_post ?? false;
  const freq = setting?.drafting_frequency ?? 'weekly';

  return (
    <div className="py-3 border-b border-[#1e1e2e] last:border-0">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <PlatformBadge platform={platform} size="sm" />
          {isConnected && (
            <span className="w-1.5 h-1.5 rounded-full bg-[#10b981]" title="Connected" />
          )}
        </div>
        <button
          onClick={() => onToggleEnabled(platform, !enabled)}
          className="text-[#475569] hover:text-[#94a3b8] transition-colors"
          title={enabled ? 'Disable platform' : 'Enable platform'}
        >
          {enabled ? (
            <ToggleRight size={20} className="text-[#6366f1]" />
          ) : (
            <ToggleLeft size={20} />
          )}
        </button>
      </div>

      {enabled && (
        <div className="flex flex-col gap-1.5">
          <select
            value={freq}
            onChange={(e) => onFreqChange(platform, e.target.value)}
            className="w-full appearance-none bg-[#1a1a24] border border-[#1e1e2e] text-[#94a3b8] text-xs rounded-lg px-2 py-1.5 focus:outline-none focus:border-[#6366f1]"
          >
            {FREQ_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>

          <button
            onClick={() => {
              if (!autoPost) {
                if (!confirm('Enabling auto-post will publish content without human approval. Continue?'))
                  return;
              }
              onToggleAutoPost(platform, !autoPost);
            }}
            className={`flex items-center gap-1.5 text-xs px-2 py-1.5 rounded-lg border transition-colors ${
              autoPost
                ? 'bg-[#f59e0b]/10 border-[#f59e0b]/30 text-[#f59e0b]'
                : 'bg-[#1a1a24] border-[#1e1e2e] text-[#475569] hover:text-[#64748b]'
            }`}
          >
            {autoPost ? (
              <>
                <AlertTriangle size={10} />
                Auto-post ON
              </>
            ) : (
              <>
                <Clock size={10} />
                Auto-post OFF
              </>
            )}
          </button>
        </div>
      )}
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function ContentHubPage() {
  const [brands, setBrands] = useState<Brand[]>([]);
  const [selectedBrandId, setSelectedBrandId] = useState<number | null>(null);
  const [activeTab, setActiveTab] = useState<QueueTab>('drafts');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Content data
  const [draftItems, setDraftItems] = useState<ContentDraft[]>([]);
  const [scheduledItems, setScheduledItems] = useState<ContentDraft[]>([]);
  const [postedItems, setPostedItems] = useState<ContentDraft[]>([]);
  const [opportunities, setOpportunities] = useState<ContentOpportunity[]>([]);
  const [attributions, setAttributions] = useState<ContentAttribution[]>([]);
  const [settings, setSettings] = useState<BrandContentSettings[]>([]);

  // Right panel
  const [connectedPlatforms, setConnectedPlatforms] = useState<Set<string>>(new Set());
  const [generating, setGenerating] = useState(false);
  const [scanning, setScanning] = useState(false);

  // Help modals
  const [hubHelpOpen, setHubHelpOpen] = useState(false);
  const [oppHelpOpen, setOppHelpOpen] = useState(false);

  // Tab counts
  const tabCounts = {
    drafts: draftItems.length,
    opportunities: opportunities.length,
    scheduled: scheduledItems.length,
    posted: postedItems.length,
  };

  // ── Load data ──────────────────────────────────────────────────────────────

  const loadAll = useCallback(async (brandId: number) => {
    setLoading(true);
    setError(null);
    try {
      const [
        draftsData,
        approvedData,
        postedData,
        oppsData,
        attrData,
        settingsData,
      ] = await Promise.all([
        getDrafts(brandId, undefined, 'draft'),
        getDrafts(brandId, undefined, 'approved'),
        getDrafts(brandId, undefined, 'posted'),
        getOpportunities(brandId),
        getAttribution(brandId),
        getContentSettings(brandId),
      ]);

      setDraftItems(draftsData);
      setScheduledItems(approvedData);
      setPostedItems(postedData);
      setOpportunities(oppsData);
      setAttributions(attrData);
      setSettings(settingsData);
    } catch {
      setError('Failed to load content data. Check that the backend is running.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    getBrands()
      .then((bs) => {
        setBrands(bs);
        if (bs.length > 0) setSelectedBrandId(bs[0].id);
        else setLoading(false);
      })
      .catch(() => {
        setError('Unable to connect to server.');
        setLoading(false);
      });
  }, []);

  useEffect(() => {
    if (selectedBrandId) loadAll(selectedBrandId);
  }, [selectedBrandId, loadAll]);

  // ── Draft actions ──────────────────────────────────────────────────────────

  async function handleApprove(id: number) {
    await updateDraft(id, { status: 'approved' });
    if (selectedBrandId) loadAll(selectedBrandId);
  }

  async function handlePost(id: number) {
    await postDraft(id, {});
    if (selectedBrandId) loadAll(selectedBrandId);
  }

  async function handleDelete(id: number) {
    if (!confirm('Remove this draft?')) return;
    await deleteDraft(id);
    if (selectedBrandId) loadAll(selectedBrandId);
  }

  function handleSaved(updated: ContentDraft) {
    setDraftItems((prev) => prev.map((d) => (d.id === updated.id ? updated : d)));
  }

  // ── Opportunity actions ────────────────────────────────────────────────────

  async function handleDraftOpportunity(oppId: number) {
    const draft = await draftOpportunity(oppId);
    setOpportunities((prev) => prev.filter((o) => o.id !== oppId));
    setDraftItems((prev) => [draft, ...prev]);
    setActiveTab('drafts');
  }

  async function handleDismissOpportunity(oppId: number) {
    await dismissOpportunity(oppId);
    setOpportunities((prev) => prev.filter((o) => o.id !== oppId));
  }

  // ── Right panel actions ────────────────────────────────────────────────────

  async function handleGenerateNow() {
    if (!selectedBrandId) return;
    setGenerating(true);
    try {
      const newDrafts = await generateNow(selectedBrandId, 3);
      setDraftItems((prev) => [...newDrafts, ...prev]);
      setActiveTab('drafts');
    } catch (e: any) {
      alert(e?.response?.data?.detail || 'Generation failed. Check that API keys are configured.');
    } finally {
      setGenerating(false);
    }
  }

  async function handleScan() {
    if (!selectedBrandId) return;
    setScanning(true);
    try {
      await triggerScan(selectedBrandId);
      // Poll after a short delay
      setTimeout(() => {
        if (selectedBrandId) loadAll(selectedBrandId);
        setScanning(false);
      }, 4000);
    } catch {
      setScanning(false);
    }
  }

  async function handleToggleEnabled(platform: string, enabled: boolean) {
    if (!selectedBrandId) return;
    const updated = await updateContentSettings(selectedBrandId, platform, { enabled });
    setSettings((prev) =>
      prev.map((s) => (s.platform === platform ? { ...s, ...updated } : s))
    );
  }

  async function handleToggleAutoPost(platform: string, autoPost: boolean) {
    if (!selectedBrandId) return;
    const updated = await updateContentSettings(selectedBrandId, platform, { auto_post: autoPost });
    setSettings((prev) =>
      prev.map((s) => (s.platform === platform ? { ...s, ...updated } : s))
    );
  }

  async function handleFreqChange(platform: string, freq: string) {
    if (!selectedBrandId) return;
    const updated = await updateContentSettings(selectedBrandId, platform, {
      drafting_frequency: freq as any,
    });
    setSettings((prev) =>
      prev.map((s) => (s.platform === platform ? { ...s, ...updated } : s))
    );
  }

  // ── Tab content ────────────────────────────────────────────────────────────

  function renderDraftsTab() {
    if (draftItems.length === 0) {
      return (
        <EmptyState
          icon={<FileText size={22} className="text-[#475569]" />}
          title="No drafts waiting"
          description='Click "Generate Drafts Now" to create drafts targeting your top visibility gaps.'
        />
      );
    }
    const selectedBrand = brands.find((b) => b.id === selectedBrandId);
    return (
      <div className="flex flex-col gap-3">
        {draftItems.map((d) =>
          d.platform === 'wikipedia' ? (
            <WikipediaDraftCard
              key={d.id}
              draft={d}
              brandName={selectedBrand?.name ?? ''}
              onDelete={handleDelete}
              onSaved={handleSaved}
            />
          ) : (
            <DraftCard
              key={d.id}
              draft={d}
              onApprove={handleApprove}
              onDelete={handleDelete}
              onSaved={handleSaved}
            />
          )
        )}
      </div>
    );
  }

  function renderOpportunitiesTab() {
    const header = (
      <div className="flex items-center justify-between mb-4">
        <p className="text-xs text-[#64748b]">
          Reddit threads matched to your tracked prompts
        </p>
        <button
          onClick={() => setOppHelpOpen(true)}
          className="text-[#475569] hover:text-[#6366f1] transition-colors"
          title="How do Live Opportunities work?"
        >
          <HelpCircle size={14} />
        </button>
      </div>
    );

    if (opportunities.length === 0) {
      return (
        <>
          {header}
          <EmptyState
            icon={<Radio size={22} className="text-[#475569]" />}
            title="No live opportunities"
            description="The Reddit scanner runs daily at 2:00 AM UTC. Click Scan Now to find threads immediately."
            action={
              <button
                onClick={handleScan}
                disabled={scanning}
                className="flex items-center gap-2 text-sm bg-[#1a1a24] hover:bg-[#2a2a3a] border border-[#2a2a3a] text-[#94a3b8] rounded-lg px-4 py-2 transition-colors"
              >
                {scanning ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
                {scanning ? 'Scanning…' : 'Scan Now'}
              </button>
            }
          />
        </>
      );
    }
    return (
      <>
        {header}
        <div className="flex flex-col gap-3">
          {opportunities.map((o) => (
            <OpportunityCard
              key={o.id}
              opp={o}
              onDraft={handleDraftOpportunity}
              onDismiss={handleDismissOpportunity}
            />
          ))}
        </div>
      </>
    );
  }

  function renderScheduledTab() {
    if (scheduledItems.length === 0) {
      return (
        <EmptyState
          icon={<Clock size={22} className="text-[#475569]" />}
          title="Nothing scheduled"
          description="Approve drafts from the Drafts tab to move them here."
        />
      );
    }
    return (
      <div className="flex flex-col gap-3">
        {scheduledItems.map((d) => (
          <ScheduledCard key={d.id} draft={d} onPost={handlePost} onDelete={handleDelete} />
        ))}
      </div>
    );
  }

  function renderPostedTab() {
    if (postedItems.length === 0) {
      return (
        <EmptyState
          icon={<CheckCircle2 size={22} className="text-[#475569]" />}
          title="Nothing posted yet"
          description="Posted content and its visibility attribution will appear here."
        />
      );
    }
    const attrByPost = new Map<number, ContentAttribution>();
    for (const a of attributions) {
      if (!attrByPost.has(a.content_post_id)) {
        attrByPost.set(a.content_post_id, a);
      }
    }
    return (
      <div className="flex flex-col gap-3">
        {postedItems.map((d) => {
          // best-effort: find attribution for any post on this draft
          const attr = attributions.find((a) => a.prompt_id === d.prompt_id) ?? null;
          return <PostedCard key={d.id} draft={d} attribution={attr} />;
        })}
      </div>
    );
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  if (error && brands.length === 0) {
    return (
      <div className="px-8 py-8 max-w-7xl">
        <h1 className="text-2xl font-bold text-[#e2e8f0] mb-8">Content Hub</h1>
        <div className="flex flex-col items-center justify-center py-24 text-center">
          <div className="w-14 h-14 bg-[#7f1d1d]/20 border border-[#991b1b]/30 rounded-2xl flex items-center justify-center mb-4">
            <X size={24} className="text-[#f87171]" />
          </div>
          <p className="text-base font-medium text-[#e2e8f0] mb-1">Unable to connect</p>
          <p className="text-sm text-[#64748b]">{error}</p>
        </div>
      </div>
    );
  }

  const settingMap = new Map(settings.map((s) => [s.platform, s]));

  const TABS: { key: QueueTab; label: string }[] = [
    { key: 'drafts', label: 'Drafts' },
    { key: 'opportunities', label: 'Live Opportunities' },
    { key: 'scheduled', label: 'Scheduled' },
    { key: 'posted', label: 'Posted' },
  ];

  return (
    <div className="px-8 py-8 max-w-[1400px]">
      {/* Help modals */}
      {hubHelpOpen && (
        <HelpModal title="How Content Hub works" onClose={() => setHubHelpOpen(false)}>
          <p>Content Hub generates AI drafts targeting your visibility gaps and surfaces Reddit threads where your brand can contribute.</p>
          <ul className="space-y-2 mt-2">
            <li><span className="text-[#e2e8f0] font-medium">Generate Drafts Now</span> — creates AI drafts based on your top-scoring content gaps (prompts where your brand is least visible).</li>
            <li><span className="text-[#e2e8f0] font-medium">Scan Reddit Now</span> — searches subreddits relevant to your brand&apos;s industry for recent threads matching your tracked prompts.</li>
            <li><span className="text-[#e2e8f0] font-medium">Drafts tab</span> — review, edit, and approve AI drafts before they go live.</li>
            <li><span className="text-[#e2e8f0] font-medium">Live Opportunities</span> — Reddit threads where a thoughtful reply could improve your brand&apos;s visibility.</li>
            <li><span className="text-[#e2e8f0] font-medium">Scheduled tab</span> — approved drafts waiting to be posted.</li>
            <li><span className="text-[#e2e8f0] font-medium">Platform Settings</span> — control which platforms generate drafts and how frequently.</li>
          </ul>
        </HelpModal>
      )}
      {oppHelpOpen && (
        <HelpModal title="Live Opportunities" onClose={() => setOppHelpOpen(false)}>
          <p>Reddit threads where your brand can meaningfully contribute.</p>
          <p>The scanner searches subreddits relevant to your brand&apos;s industry for threads matching your tracked prompts. Only threads with a relevance score of 40+ are shown.</p>
          <ul className="space-y-2 mt-2">
            <li><span className="text-[#e2e8f0] font-medium">Relevance score</span> — how closely the thread matches your tracked prompts, based on keyword overlap, recency, and engagement.</li>
            <li><span className="text-[#e2e8f0] font-medium">Draft Reply</span> — generates an AI reply using your brand voice guidelines.</li>
            <li><span className="text-[#e2e8f0] font-medium">Dismiss</span> — removes the opportunity from this list.</li>
          </ul>
          <p className="text-[#64748b] text-xs mt-2">The scanner runs automatically every night at 2:00 AM UTC.</p>
        </HelpModal>
      )}

      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-2">
          <div>
            <h1 className="text-2xl font-bold text-[#e2e8f0]">Content Hub</h1>
            <p className="text-sm text-[#64748b] mt-1">
              AI-powered content to close visibility gaps across every platform
            </p>
          </div>
          <button
            onClick={() => setHubHelpOpen(true)}
            className="text-[#475569] hover:text-[#6366f1] transition-colors mt-1 ml-1"
            title="How does Content Hub work?"
          >
            <HelpCircle size={16} />
          </button>
        </div>

        {/* Brand selector */}
        {brands.length > 1 && (
          <div className="relative">
            <select
              value={selectedBrandId ?? ''}
              onChange={(e) => setSelectedBrandId(Number(e.target.value))}
              className="appearance-none bg-[#1a1a24] border border-[#1e1e2e] text-[#e2e8f0] rounded-lg pl-3 pr-8 py-2 text-sm focus:outline-none focus:border-[#6366f1]"
            >
              {brands.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
            <ChevronDown
              size={13}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[#475569] pointer-events-none"
            />
          </div>
        )}
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-32">
          <Loader2 size={24} className="animate-spin text-[#6366f1]" />
        </div>
      ) : (
        <div className="flex gap-6">
          {/* ── Left panel (70%) — Content Queue ────────────────────────────── */}
          <div className="flex-1 min-w-0">
            {/* Tab bar */}
            <div className="flex gap-0 mb-5 border-b border-[#1e1e2e]">
              {TABS.map((tab) => (
                <button
                  key={tab.key}
                  onClick={() => setActiveTab(tab.key)}
                  className={`flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
                    activeTab === tab.key
                      ? 'text-[#818cf8] border-[#6366f1] bg-[#111118]'
                      : 'text-[#64748b] border-transparent hover:text-[#94a3b8]'
                  }`}
                >
                  {tab.label}
                  {tabCounts[tab.key] > 0 && (
                    <span
                      className={`text-xs rounded-full px-1.5 py-0.5 font-semibold ${
                        activeTab === tab.key
                          ? 'bg-[#6366f1]/20 text-[#818cf8]'
                          : 'bg-[#1a1a24] text-[#64748b]'
                      }`}
                    >
                      {tabCounts[tab.key]}
                    </span>
                  )}
                </button>
              ))}
            </div>

            {/* Tab content */}
            {activeTab === 'drafts' && renderDraftsTab()}
            {activeTab === 'opportunities' && renderOpportunitiesTab()}
            {activeTab === 'scheduled' && renderScheduledTab()}
            {activeTab === 'posted' && renderPostedTab()}
          </div>

          {/* ── Right panel (30%) — Settings ─────────────────────────────────── */}
          <div className="w-72 shrink-0 flex flex-col gap-4">
            {/* Generate now */}
            <div className="bg-[#111118] border border-[#1e1e2e] rounded-xl p-4">
              <button
                onClick={handleGenerateNow}
                disabled={generating}
                className="w-full flex items-center justify-center gap-2 bg-[#6366f1] hover:bg-[#4f46e5] disabled:opacity-50 text-white rounded-lg px-4 py-2.5 text-sm font-medium transition-colors"
              >
                {generating ? (
                  <>
                    <Loader2 size={14} className="animate-spin" />
                    Generating…
                  </>
                ) : (
                  <>
                    <Zap size={14} />
                    Generate Drafts Now
                  </>
                )}
              </button>
              <p className="text-xs text-[#475569] mt-2 text-center">
                Drafts for your top 3 visibility gaps
              </p>
            </div>

            {/* Scan Reddit */}
            <div className="bg-[#111118] border border-[#1e1e2e] rounded-xl p-4">
              <button
                onClick={handleScan}
                disabled={scanning}
                className="w-full flex items-center justify-center gap-2 bg-[#1a1a24] hover:bg-[#2a2a3a] border border-[#2a2a3a] disabled:opacity-50 text-[#94a3b8] rounded-lg px-4 py-2.5 text-sm font-medium transition-colors"
              >
                {scanning ? (
                  <>
                    <Loader2 size={14} className="animate-spin" />
                    Scanning…
                  </>
                ) : (
                  <>
                    <RefreshCw size={14} />
                    Scan Reddit Now
                  </>
                )}
              </button>
              <p className="text-xs text-[#475569] mt-2 text-center">
                Scans automatically daily at 2:00 AM UTC
              </p>
            </div>

            {/* Platform settings */}
            <div className="bg-[#111118] border border-[#1e1e2e] rounded-xl p-4">
              <h3 className="text-xs font-semibold text-[#64748b] uppercase tracking-wider mb-3">
                Platform Settings
              </h3>
              <div>
                {PLATFORMS.map((platform) => (
                  <PlatformSettingRow
                    key={platform}
                    platform={platform}
                    setting={settingMap.get(platform)}
                    isConnected={connectedPlatforms.has(platform)}
                    onToggleEnabled={handleToggleEnabled}
                    onToggleAutoPost={handleToggleAutoPost}
                    onFreqChange={handleFreqChange}
                  />
                ))}
              </div>
            </div>

            {/* Auto-post warning */}
            <div className="bg-[#451a03]/20 border border-[#78350f]/30 rounded-xl p-3">
              <div className="flex gap-2">
                <AlertTriangle size={14} className="text-[#f59e0b] shrink-0 mt-0.5" />
                <p className="text-xs text-[#fbbf24]">
                  Auto-post publishes content without approval. Keep it off until you trust the
                  output quality.
                </p>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Shared empty state ────────────────────────────────────────────────────────

function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center py-20 text-center">
      <div className="w-14 h-14 bg-[#1a1a24] border border-[#2a2a3a] rounded-2xl flex items-center justify-center mb-4">
        {icon}
      </div>
      <p className="text-base font-medium text-[#e2e8f0] mb-1">{title}</p>
      <p className="text-sm text-[#64748b] mb-5 max-w-sm">{description}</p>
      {action}
    </div>
  );
}
