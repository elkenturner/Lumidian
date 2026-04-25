'use client';

import { motion } from 'framer-motion';
import { fadeIn } from '@/lib/motion';
import { useEffect, useState, useCallback, useRef } from 'react';
import { logError } from '@/lib/utils/errors';
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
  Trash2,
  Edit2,
  AlertTriangle,
  Info,
  RefreshCw,
  Sparkles,
  HelpCircle,
  Copy,
  Check,
  PenLine,
  BookOpen,
  Lightbulb,
  Shield,
} from 'lucide-react';
import {
  getBrand,
  getDrafts,
  updateDraft,
  deleteDraft,
  generateDraft,
  getOpportunities,
  dismissOpportunity,
  draftOpportunity,
  generateNow,
  approveAllDrafts,
  getDraftStatus,
  getDraftStatusFresh,
  getBrandProfile,
  getContentSettings,
  getDraftAttributions,
  getQuoraQuestions,
  triggerScan,
  invalidateCache,
  Brand,
  BrandDetail,
  Prompt,
  ContentDraft,
  ContentOpportunity,
  BrandProfile,
  BrandContentSettings,
  DraftQueueStatus,
  DraftAttribution,
  QuoraQuestion,
} from '@/lib/api';
import PlatformBadge from '@/components/PlatformBadge';
import PlatformIcon from '@/components/PlatformIcon';
import SubscriptionBanner from '@/components/SubscriptionBanner';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/contexts/AuthContext';
import { useBrand } from '@/contexts/BrandContext';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { ContentTabPanels } from '@/components/content/ContentTabPanels';
import { AppToast, ToastData } from '@/components/AppToast';
import {
  AttachPromptPopover,
  HelpModal,
  ImpactExplainerModal,
  MarkAsPostedModal,
  QualityChecklist,
  runQualityChecks,
} from './components';
import {
  relativeTime,
  generateAvailableLabel,
  isPromoRestricted,
  extractSubreddit,
  computeUrgency,
} from './utils';
import { renderPreviewHtml } from '@/components/content/helpers';

// ── Types ─────────────────────────────────────────────────────────────────────

type QueueTab = 'drafts' | 'scheduled' | 'opportunities' | 'posted';
type PrimaryTab = 'opportunities' | 'content_drafts' | 'posted';
type ContentDraftsSubTab = 'queue' | 'scheduled';

// ── Draft card (Drafts tab) ───────────────────────────────────────────────────

function DraftCard({
  draft,
  profile,
  brandName,
  postedItems,
  prompts,
  brandId,
  onApprove,
  onDelete,
  onSaved,
  onRegenerated,
}: {
  draft: ContentDraft;
  profile: BrandProfile | null;
  brandName: string;
  postedItems: ContentDraft[];
  prompts: Prompt[];
  brandId: number;
  onApprove: (id: number) => void;
  onDelete: (id: number) => void;
  onSaved: (d: ContentDraft) => void;
  onRegenerated: (d: ContentDraft) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [previewMode, setPreviewMode] = useState(false);
  const [editTitle, setEditTitle] = useState(draft.title ?? '');
  const [editContent, setEditContent] = useState(draft.content_text);
  const [saving, setSaving] = useState(false);
  const [copied, setCopied] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const [showQuoraPicker, setShowQuoraPicker] = useState(false);
  const [pendingQuestion, setPendingQuestion] = useState<QuoraQuestion | null>(null);

  async function handleCopy() {
    await navigator.clipboard.writeText(draft.content_text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  async function handleRegenerate(question?: QuoraQuestion) {
    setRegenerating(true);
    setShowQuoraPicker(false);
    try {
      const fresh = await generateDraft(brandId, {
        platform: draft.platform,
        prompt_id: draft.prompt_id ?? undefined,
        quora_question_url: question?.url,
        quora_question_title: question?.title,
        quora_question_snippet: question?.snippet,
      });
      onRegenerated(fresh);
    } catch {
      // ignore — user can retry
    } finally {
      setRegenerating(false);
    }
  }

  // Word count
  const wordCount = draft.content_text.trim().split(/\s+/).filter(Boolean).length;

  // Target prompt text
  const targetPrompt = prompts.find((p) => p.id === draft.prompt_id);

  // Quality score for border/prominence — based on hard fails only (warnings don't trigger red border)
  const qualityChecks = runQualityChecks(draft, profile, brandName);
  const isLowQuality = qualityChecks.filter((c) => c.passed === false).length >= 2;

  // No truncation — show full text in a scrollable window so users can read without clicking Edit

  async function handleSave() {
    setSaving(true);
    try {
      const updated = await updateDraft(draft.id, {
        title: editTitle || undefined,
        content_text: editContent,
      });
      onSaved(updated);
      setEditing(false);
    } catch {
      alert('Failed to save draft. Please try again.');
    } finally {
      setSaving(false);
    }
  }

  const qualityClass = isLowQuality
    ? 'bg-[oklch(0.55_0.22_29_/_0.04)]'
    : '';

  return (
    <div className={`card p-5 flex flex-col gap-3 hover:border-[rgba(255,255,255,0.14)] transition-colors ${qualityClass}`}>
      {/* Top row */}
      <div className="flex items-center gap-2 flex-wrap">
        <PlatformBadge platform={draft.platform} />
      </div>

      {/* Target prompt / posting instruction */}
      {draft.opportunity_id != null && draft.platform === 'reddit' &&
       draft.platform_guidelines_applied?.startsWith('http') ? (
        /* Reddit opportunity reply: single linked element with full thread context */
        <>
          <a
            href={draft.platform_guidelines_applied}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2 bg-[rgba(249,115,22,0.07)] border border-[rgba(249,115,22,0.20)] rounded-lg px-3 py-2 group transition-colors hover:border-[rgba(249,115,22,0.35)] hover:bg-[rgba(249,115,22,0.11)]"
          >
            <span className="text-[var(--color-claude)] text-xs flex-shrink-0">↗</span>
            <span className="text-xs text-[var(--color-claude)] font-medium flex-1 min-w-0 truncate">
              {draft.content_brief ?? 'Reply directly in this thread'}
            </span>
            <ExternalLink size={11} className="text-[var(--color-claude)]/60 flex-shrink-0 group-hover:text-[var(--color-claude)]" />
          </a>
          {(() => {
            const sub = extractSubreddit(draft.content_brief);
            if (!sub || !isPromoRestricted(sub)) return null;
            return (
              <div className="flex items-center gap-1.5 text-[10px] text-[var(--warning)] bg-[rgba(245,158,11,0.08)] border border-[rgba(245,158,11,0.20)] rounded-md px-2.5 py-1.5">
                <AlertTriangle size={10} className="flex-shrink-0" />
                <span>
                  <span className="font-semibold">r/{sub} bans promotion</span>
                  {' '}— this draft avoids direct brand mentions. You may cite sources or reference research indirectly.
                </span>
              </div>
            );
          })()}
        </>
      ) : draft.platform === 'quora' && draft.content_brief?.startsWith('https://www.quora.com') ? (
        /* Targeted Quora draft — content_brief = question URL, guidelines_applied = question title */
        <div className="flex flex-col gap-2">
          <a
            href={draft.content_brief}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2 bg-[#172554]/30 border border-[#1d4ed8]/25 rounded-lg px-3 py-2 group transition-colors hover:border-[#1d4ed8]/50 hover:bg-[#172554]/50"
          >
            <span className="text-[#60a5fa] text-xs flex-shrink-0">Q</span>
            <span className="text-xs text-[#93c5fd] font-medium flex-1 min-w-0 line-clamp-2">
              {draft.platform_guidelines_applied || draft.content_brief}
            </span>
            <ExternalLink size={11} className="text-[#60a5fa]/50 flex-shrink-0 group-hover:text-[#60a5fa]" />
          </a>
          {/* Change question inline picker */}
          {showQuoraPicker ? (
            <div className="border border-[var(--border-subtle)] rounded-lg p-3 bg-[rgba(0,0,0,0.2)]">
              <QuoraQuestionPicker
                brandId={brandId}
                promptId={draft.prompt_id ?? ''}
                selected={pendingQuestion}
                onSelect={setPendingQuestion}
              />
              <div className="flex items-center gap-2 mt-3">
                <button
                  onClick={() => pendingQuestion && handleRegenerate(pendingQuestion)}
                  disabled={!pendingQuestion || regenerating}
                  className="flex items-center gap-1.5 text-xs bg-[rgba(95,126,166,0.15)] hover:bg-[rgba(95,126,166,0.22)] border border-[rgba(95,126,166,0.30)] hover:border-[rgba(95,126,166,0.45)] text-[var(--accent-foreground)] hover:text-[var(--text-primary)] hover:shadow-[0_0_24px_rgba(95,126,166,0.18)] disabled:opacity-40 rounded-lg px-3 py-1.5 transition-colors"
                >
                  {regenerating ? <Loader2 size={11} className="animate-spin" /> : <RefreshCw size={11} />}
                  Regenerate with this question
                </button>
                <button
                  onClick={() => { setShowQuoraPicker(false); setPendingQuestion(null); }}
                  className="text-xs text-[var(--text-faint)] hover:text-[var(--text-secondary)] transition-colors px-2 py-1.5"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <button
              onClick={() => setShowQuoraPicker(true)}
              className="flex items-center gap-1.5 text-[10px] text-[var(--text-faint)] hover:text-[var(--accent-foreground)] transition-colors self-start"
            >
              <RefreshCw size={10} />
              Find different question
            </button>
          )}
        </div>
      ) : draft.content_brief && draft.platform === 'quora' ? (
        <div className="flex items-start gap-2 bg-[#172554]/30 border border-[#1d4ed8]/25 rounded-lg px-3 py-2">
          <span className="text-[var(--accent)] text-xs mt-0.5">→</span>
          <p className="text-xs text-[#60a5fa] leading-relaxed">{draft.content_brief}</p>
        </div>
      ) : draft.content_brief && draft.platform === 'reddit' ? (
        <p className="text-xs text-[var(--text-faint)] leading-relaxed">
          <span className="text-[var(--color-claude)] font-medium">{draft.content_brief.split(' — ')[0]}</span>
          {draft.content_brief.includes(' — ') && (
            <span className="text-[var(--text-faint)]"> — {draft.content_brief.split(' — ').slice(1).join(' — ')}</span>
          )}
        </p>
      ) : draft.content_brief ? (
        <p className="text-xs text-[var(--text-faint)] leading-relaxed line-clamp-2">
          <span className="text-[var(--text-muted)]">Targeting: </span>
          {draft.content_brief}
        </p>
      ) : null}

      {/* Standalone Reddit draft: link to subreddit */}
      {draft.opportunity_id == null && draft.platform === 'reddit' && (() => {
        const sub = extractSubreddit(draft.content_brief);
        const url = sub ? `https://reddit.com/r/${sub}` : 'https://reddit.com/submit';
        const label = sub ? `Post to r/${sub}` : 'Post to Reddit';
        return (
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2 bg-[rgba(249,115,22,0.07)] border border-[rgba(249,115,22,0.20)] rounded-lg px-3 py-2 group transition-colors hover:border-[rgba(249,115,22,0.35)] hover:bg-[rgba(249,115,22,0.11)]"
          >
            <span className="text-[var(--color-claude)] text-xs flex-shrink-0">↗</span>
            <span className="text-xs text-[var(--color-claude)] font-medium flex-1 min-w-0 truncate">
              {label}
            </span>
            <ExternalLink size={11} className="text-[var(--color-claude)]/60 flex-shrink-0 group-hover:text-[var(--color-claude)]" />
          </a>
        );
      })()}

      {/* Title or inline editor */}
      {editing ? (
        <div className="flex flex-col gap-2">
          {/* Live quality checklist while editing */}
          <QualityChecklist
            draft={draft}
            profile={profile}
            brandName={brandName}
            autoExpand={true}
            liveText={editContent}
          />
          <input
            type="text"
            value={editTitle}
            onChange={(e) => setEditTitle(e.target.value)}
            placeholder="Title (optional)"
            className="w-full bg-[rgba(255,255,255,0.05)] border border-[rgba(255,255,255,0.10)] text-[var(--text-primary)] rounded-lg px-3 py-2 text-sm placeholder:text-[var(--text-faint)] focus:outline-none focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--accent)]/50"
          />
          <textarea
            value={editContent}
            onChange={(e) => setEditContent(e.target.value)}
            rows={8}
            className="w-full bg-[rgba(255,255,255,0.05)] border border-[rgba(255,255,255,0.10)] text-[var(--text-primary)] rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--accent)]/50 resize-none font-mono"
          />
          <div className="flex gap-2">
            <button
              onClick={handleSave}
              disabled={saving}
              className="flex items-center gap-1.5 text-xs bg-[rgba(95,126,166,0.15)] hover:bg-[rgba(95,126,166,0.22)] border border-[rgba(95,126,166,0.30)] hover:border-[rgba(95,126,166,0.45)] text-[var(--accent-foreground)] hover:text-[var(--text-primary)] hover:shadow-[0_0_24px_rgba(95,126,166,0.18)] disabled:opacity-50 rounded-lg px-3 py-1.5 transition-colors"
            >
              {saving ? <Loader2 size={11} className="animate-spin" /> : null}
              Save
            </button>
            <button
              onClick={() => setEditing(false)}
              className="text-xs text-[var(--text-muted)] hover:text-[var(--text-secondary)] px-3 py-1.5 transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div>
          {/* Target prompt line */}
          {targetPrompt && (
            <div className="flex items-start gap-1.5 mb-2">
              <span className="text-[10px] text-[var(--text-faint)] uppercase tracking-wide font-medium mt-0.5 flex-shrink-0">Targeting</span>
              <span className="text-[11px] text-[var(--accent)] bg-[rgba(95,126,166,0.08)] border border-[var(--border-subtle)] rounded-md px-2 py-0.5 leading-relaxed">{targetPrompt.text}</span>
            </div>
          )}
          {draft.title && (
            <p className="text-sm font-semibold text-[var(--text-primary)] leading-snug mb-1">{draft.title}</p>
          )}
          {/* Preview / Raw toggle */}
          <div className="flex items-center justify-between mb-1.5">
            <div className="flex items-center gap-1 bg-[rgba(255,255,255,0.04)] border border-[rgba(255,255,255,0.08)] rounded-md p-0.5">
              <button
                onClick={() => setPreviewMode(false)}
                className={`px-2 py-0.5 rounded text-[10px] font-medium transition-colors ${!previewMode ? 'bg-[rgba(95,126,166,0.25)] text-[var(--accent-foreground)]' : 'text-[var(--text-faint)] hover:text-[var(--text-muted)]'}`}
              >Raw</button>
              <button
                onClick={() => setPreviewMode(true)}
                className={`px-2 py-0.5 rounded text-[10px] font-medium transition-colors ${previewMode ? 'bg-[rgba(95,126,166,0.25)] text-[var(--accent-foreground)]' : 'text-[var(--text-faint)] hover:text-[var(--text-muted)]'}`}
              >Preview</button>
            </div>
            <span className="text-[10px] text-[var(--text-faint)] font-mono">{wordCount} words</span>
          </div>
          {previewMode ? (
            <div
              className="text-sm text-[var(--text-secondary)] leading-relaxed overflow-y-auto bg-[rgba(255,255,255,0.04)] border border-[rgba(255,255,255,0.06)] rounded-lg p-3"
              style={{ maxHeight: '12rem', scrollbarWidth: 'thin', scrollbarColor: 'rgba(255,255,255,0.10) transparent' }}
              dangerouslySetInnerHTML={{ __html: `<p style="margin:0">${renderPreviewHtml(draft.content_text)}</p>` }}
            />
          ) : (
            <div
              className="text-sm text-[var(--text-muted)] leading-relaxed overflow-y-auto"
              style={{ maxHeight: '9rem', scrollbarWidth: 'thin', scrollbarColor: 'rgba(255,255,255,0.10) transparent' }}
            >
              {draft.content_text}
            </div>
          )}
        </div>
      )}

      {/* Quality checklist — always shown when not editing */}
      {!editing && (
        <QualityChecklist draft={draft} profile={profile} brandName={brandName} />
      )}

      {/* Actions */}
      {!editing && (
        <div className="flex items-center gap-2 pt-1 flex-wrap">
          <button
            onClick={() => setEditing(true)}
            className="flex items-center gap-1.5 text-xs bg-[rgba(255,255,255,0.06)] hover:bg-[rgba(255,255,255,0.10)] border border-[rgba(255,255,255,0.10)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] rounded-lg px-3 py-1.5 transition-colors"
          >
            <Edit2 size={11} />
            Edit
          </button>
          <button
            onClick={handleCopy}
            className={`flex items-center gap-1.5 text-xs rounded-lg px-3 py-1.5 transition-colors border ${
              copied
                ? 'bg-[#064e3b]/20 border-[#065f46]/25 text-[var(--success)]'
                : 'bg-[rgba(255,255,255,0.06)] border-[rgba(255,255,255,0.10)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[rgba(255,255,255,0.10)]'
            }`}
          >
            {copied ? <Check size={11} /> : <Copy size={11} />}
            {copied ? 'Copied!' : 'Copy'}
          </button>
          <button
            onClick={() => onApprove(draft.id)}
            className="flex items-center gap-1.5 text-xs bg-[#064e3b]/20 hover:bg-[#064e3b]/30 border border-[#065f46]/25 text-[var(--success)] rounded-lg px-3 py-1.5 transition-colors"
          >
            <CheckCircle2 size={11} />
            Approve
          </button>
          <button
            onClick={() => onDelete(draft.id)}
            className="flex items-center gap-1.5 text-xs text-[var(--danger)]/70 hover:text-[var(--danger)] rounded-lg px-3 py-1.5 transition-colors ml-auto"
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
  profile,
  onDelete,
  onSaved,
}: {
  draft: ContentDraft;
  brandName: string;
  profile: BrandProfile | null;
  onDelete: (id: number) => void;
  onSaved: (d: ContentDraft) => void;
}) {
  const originalWiki = draft.content_text;
  const citations = extractCitations(originalWiki);

  const [plainText, setPlainText] = useState(() => wikiToPlain(originalWiki));
  const [hasEdited, setHasEdited] = useState(false);
  const [editing, setEditing] = useState(false);
  const [viewMode, setViewMode] = useState<'preview' | 'raw'>('preview');
  const [copied, setCopied] = useState(false);
  const [saving, setSaving] = useState(false);

  // If the user hasn't edited yet, show the original wiki (links intact).
  // Once they edit, rebuild from their plain text with proper wiki conversion.
  const wikiFormat = hasEdited
    ? plainToWikiFormat(plainText, originalWiki, citations, brandName)
    : originalWiki;

  const wordCount = plainText.trim().split(/\s+/).filter(Boolean).length;
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
      setEditing(false);
    } catch {
      alert('Failed to save draft. Please try again.');
    } finally {
      setSaving(false);
    }
  }

  const articleUrl = draft.content_brief ?? '';
  const articleTitle = draft.title ?? 'Unknown Wikipedia article';

  // insert_location is stored in platform_guidelines_applied for Wikipedia drafts.
  // Old drafts have a JSON array of rules there — detect and ignore those.
  const rawGuidelines = draft.platform_guidelines_applied ?? '';
  const insertLocation: string = (() => {
    if (!rawGuidelines) return '';
    try {
      const parsed = JSON.parse(rawGuidelines);
      if (Array.isArray(parsed)) return '';
      return String(parsed);
    } catch {
      return rawGuidelines;
    }
  })();

  return (
    <>
      {/* COI banner — slim line above the card, only when draft mentions brand */}
      {showCOI && (
        <div className="flex items-center gap-2 text-xs text-[var(--text-secondary)] px-1 -mb-1">
          <Info size={11} className="shrink-0 opacity-60" />
          <span>
            Conflict of interest disclosure may be required if this content references your brand.{' '}
            <a
              href="https://en.wikipedia.org/wiki/Wikipedia:Conflict_of_interest"
              target="_blank"
              rel="noopener noreferrer"
              className="underline decoration-[var(--text-muted)]/50 hover:decoration-[var(--text-secondary)]"
            >
              See Wikipedia&apos;s COI guidelines.
            </a>
          </span>
        </div>
      )}

      <div className="card p-5 flex flex-col gap-3 hover:border-[rgba(255,255,255,0.14)] transition-colors">
        {/* Platform badge + article link */}
        <div className="flex items-start gap-2 flex-wrap">
          <PlatformBadge platform="wikipedia" />
          <div className="flex-1 min-w-0">
            {articleUrl ? (
              <a
                href={articleUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm font-medium text-[var(--text-primary)] hover:text-[var(--accent)] transition-colors flex items-center gap-1 leading-snug"
              >
                {articleTitle}
                <ExternalLink size={11} className="shrink-0 text-[var(--text-faint)]" />
              </a>
            ) : (
              <p className="text-sm font-medium text-[var(--text-primary)] leading-snug">{articleTitle}</p>
            )}
          </div>
        </div>

        {/* Where to insert */}
        {insertLocation && (
          <div className="bg-[rgba(255,255,255,0.06)] border border-[var(--border-subtle)] rounded-lg px-3 py-2.5">
            <p className="text-xs text-[var(--text-muted)] uppercase tracking-wide mb-1 font-medium">Where to insert</p>
            <p className="text-xs text-[var(--text-secondary)] leading-relaxed">{insertLocation}</p>
          </div>
        )}

        {/* Content — edit mode or view mode */}
        {editing ? (
          <div className="flex flex-col gap-2">
            <QualityChecklist draft={draft} profile={profile} brandName={brandName} autoExpand liveText={wikiFormat} />
            <textarea
              value={plainText}
              onChange={(e) => handlePlainChange(e.target.value)}
              rows={7}
              className="w-full bg-[rgba(255,255,255,0.05)] border border-[rgba(255,255,255,0.10)] text-[var(--text-primary)] rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--accent)]/50 resize-none leading-relaxed font-sans"
              placeholder="Edit the plain text. Wiki formatting and citations are applied automatically."
            />
            <p className="text-[10px] text-[var(--text-faint)]">
              Edit in plain text — wiki links, citations, and markup are applied automatically when you copy.
            </p>
            <div className="flex gap-2">
              <button
                onClick={handleSave}
                disabled={saving}
                className="flex items-center gap-1.5 text-xs bg-[rgba(95,126,166,0.15)] hover:bg-[rgba(95,126,166,0.22)] border border-[rgba(95,126,166,0.30)] hover:border-[rgba(95,126,166,0.45)] text-[var(--accent-foreground)] hover:text-[var(--text-primary)] hover:shadow-[0_0_24px_rgba(95,126,166,0.18)] disabled:opacity-50 rounded-lg px-3 py-1.5 transition-colors"
              >
                {saving ? <Loader2 size={11} className="animate-spin" /> : null}
                Save
              </button>
              <button
                onClick={() => setEditing(false)}
                className="text-xs text-[var(--text-muted)] hover:text-[var(--text-secondary)] px-3 py-1.5 transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <div>
            {/* Raw / Preview toggle */}
            <div className="flex items-center justify-between mb-1.5">
              <div className="flex items-center gap-1 bg-[rgba(255,255,255,0.04)] border border-[rgba(255,255,255,0.08)] rounded-md p-0.5">
                <button
                  onClick={() => setViewMode('preview')}
                  className={`px-2 py-0.5 rounded text-[10px] font-medium transition-colors ${viewMode === 'preview' ? 'bg-[rgba(95,126,166,0.25)] text-[var(--accent-foreground)]' : 'text-[var(--text-faint)] hover:text-[var(--text-muted)]'}`}
                >Preview</button>
                <button
                  onClick={() => setViewMode('raw')}
                  className={`px-2 py-0.5 rounded text-[10px] font-medium transition-colors ${viewMode === 'raw' ? 'bg-[rgba(95,126,166,0.25)] text-[var(--accent-foreground)]' : 'text-[var(--text-faint)] hover:text-[var(--text-muted)]'}`}
                >Raw</button>
              </div>
              <span className="text-[10px] text-[var(--text-faint)] font-mono">{wordCount} words</span>
            </div>

            {viewMode === 'raw' ? (
              <pre
                className="text-xs text-[var(--text-secondary)] leading-relaxed overflow-y-auto bg-[rgba(255,255,255,0.03)] border border-[rgba(255,255,255,0.06)] rounded-lg p-3 whitespace-pre-wrap font-mono"
                style={{ maxHeight: '12rem', scrollbarWidth: 'thin', scrollbarColor: 'rgba(255,255,255,0.10) transparent' }}
              >
                {wikiFormat}
              </pre>
            ) : (
              <div
                className="text-sm text-[var(--text-secondary)] leading-relaxed overflow-y-auto bg-[rgba(255,255,255,0.04)] border border-[rgba(255,255,255,0.06)] rounded-lg p-3"
                style={{ maxHeight: '12rem', scrollbarWidth: 'thin', scrollbarColor: 'rgba(255,255,255,0.10) transparent' }}
                dangerouslySetInnerHTML={{ __html: `<p style="margin:0">${renderPreviewHtml(plainText)}</p>` }}
              />
            )}
          </div>
        )}

        {/* Quality checklist — only shown in view mode */}
        {!editing && (
          <QualityChecklist draft={draft} profile={profile} brandName={brandName} liveText={wikiFormat} />
        )}

        {/* Actions */}
        {!editing && (
          <div className="flex items-center gap-2 pt-1 flex-wrap">
            <button
              onClick={handleCopy}
              className={`flex items-center gap-1.5 text-xs rounded-lg px-3 py-1.5 transition-colors ${
                copied
                  ? 'bg-[#064e3b]/20 border border-[#065f46]/25 text-[var(--success)]'
                  : 'bg-[rgba(95,126,166,0.15)] hover:bg-[rgba(95,126,166,0.22)] border border-[rgba(95,126,166,0.30)] hover:border-[rgba(95,126,166,0.45)] text-[var(--accent-foreground)] hover:text-[var(--text-primary)] hover:shadow-[0_0_24px_rgba(95,126,166,0.18)]'
              }`}
            >
              {copied ? <Check size={11} /> : <Copy size={11} />}
              {copied ? 'Copied!' : 'Copy Wiki Format'}
            </button>
            <button
              onClick={() => setEditing(true)}
              className="flex items-center gap-1.5 text-xs bg-[rgba(255,255,255,0.06)] hover:bg-[rgba(255,255,255,0.10)] border border-[rgba(255,255,255,0.10)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] rounded-lg px-3 py-1.5 transition-colors"
            >
              <Edit2 size={11} />
              Edit
            </button>
            <button
              onClick={() => onDelete(draft.id)}
              className="flex items-center gap-1.5 text-xs text-[var(--text-faint)] hover:text-[var(--danger)] rounded-lg px-3 py-1.5 transition-colors ml-auto"
            >
              <Trash2 size={11} />
              Dismiss
            </button>
          </div>
        )}
      </div>
    </>
  );
}

// ── Quora question picker ─────────────────────────────────────────────────────

function QuoraQuestionPicker({
  brandId,
  promptId,
  selected,
  onSelect,
}: {
  brandId: number;
  promptId: number | '';
  selected: QuoraQuestion | null;
  onSelect: (q: QuoraQuestion | null) => void;
}) {
  const [questions, setQuestions] = useState<QuoraQuestion[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);

  useEffect(() => {
    if (!promptId) { setQuestions([]); setSearched(false); return; }
    setLoading(true);
    setSearched(false);
    getQuoraQuestions(brandId, promptId as number)
      .then((qs) => { setQuestions(qs); setSearched(true); })
      .catch((err) => { logError(err, 'Content: fetch Quora questions'); setQuestions([]); setSearched(true); })
      .finally(() => setLoading(false));
  }, [brandId, promptId]);

  if (!promptId) return null;

  if (loading) {
    return (
      <div className="flex items-center gap-2 py-2 text-xs text-[var(--text-muted)]">
        <Loader2 size={12} className="animate-spin" />
        Finding relevant Quora questions…
      </div>
    );
  }

  if (selected) {
    return (
      <div className="flex items-start gap-2 bg-[#172554]/30 border border-[#1d4ed8]/30 rounded-lg px-3 py-2.5">
        <span className="text-[#60a5fa] text-xs mt-0.5 flex-shrink-0">↗</span>
        <div className="flex-1 min-w-0">
          <a
            href={selected.url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-[#93c5fd] font-medium hover:text-white transition-colors line-clamp-2"
          >
            {selected.title}
          </a>
          {selected.snippet && (
            <p className="text-[10px] text-[var(--text-faint)] mt-1 line-clamp-2 leading-relaxed">{selected.snippet}</p>
          )}
        </div>
        <button
          onClick={() => onSelect(null)}
          className="flex-shrink-0 text-[var(--text-faint)] hover:text-[var(--text-secondary)] transition-colors ml-1"
          aria-label="Remove selected question"
        >
          <X size={12} />
        </button>
      </div>
    );
  }

  if (searched && questions.length === 0) {
    return (
      <p className="text-xs text-[var(--text-faint)] py-1">
        No Quora questions found — the draft will be a general answer. You can find a question manually at quora.com.
      </p>
    );
  }

  return (
    <div className="space-y-1.5">
      <p className="text-[10px] text-[var(--text-muted)] uppercase tracking-wide font-medium">
        Select a Quora question to target
      </p>
      {questions.map((q) => (
        <button
          key={q.url}
          onClick={() => onSelect(q)}
          className="w-full text-left flex items-start gap-2.5 bg-[rgba(255,255,255,0.03)] hover:bg-[rgba(95,126,166,0.08)] border border-[rgba(255,255,255,0.08)] hover:border-[rgba(95,126,166,0.25)] rounded-lg px-3 py-2.5 transition-colors group"
        >
          <span className="text-[var(--accent)] text-xs mt-0.5 flex-shrink-0">Q</span>
          <div className="flex-1 min-w-0">
            <span className="text-xs text-[var(--text-primary)] group-hover:text-[var(--text-primary)] transition-colors line-clamp-2 block">
              {q.title}
            </span>
            {q.snippet && (
              <span className="text-[10px] text-[var(--text-faint)] line-clamp-1 block mt-0.5 leading-relaxed">
                {q.snippet}
              </span>
            )}
          </div>
          <span className="text-[10px] text-[var(--text-faint)] group-hover:text-[var(--accent)] flex-shrink-0 mt-0.5 transition-colors">
            Select →
          </span>
        </button>
      ))}
    </div>
  );
}

// ── Request Draft modal ───────────────────────────────────────────────────────

const DRAFT_PLATFORMS = ['reddit', 'quora', 'medium', 'wikipedia', 'linkedin', 'x'] as const;

const PLATFORM_DISPLAY: Record<string, string> = {
  reddit: 'Reddit',
  quora: 'Quora',
  medium: 'Medium',
  wikipedia: 'Wikipedia',
  linkedin: 'LinkedIn',
  linkedin_article: 'LinkedIn',
  linkedin_post: 'LinkedIn',
  linkedin_reply: 'LinkedIn',
  x: 'X',
  x_thread: 'X',
  x_post: 'X',
  x_reply: 'X',
};

function RequestDraftModal({
  brandId,
  prompts,
  onClose,
  onCreated,
}: {
  brandId: number;
  prompts: Prompt[];
  onClose: () => void;
  onCreated: (draft: ContentDraft) => void;
}) {
  const { user } = useAuth();
  const [platform, setPlatform] = useState<string>('reddit');
  const [subPlatform, setSubPlatform] = useState<string>('linkedin_article');
  const [promptId, setPromptId] = useState<number | ''>('');
  const [customTopic, setCustomTopic] = useState('');
  const [notes, setNotes] = useState('');
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedQuestion, setSelectedQuestion] = useState<QuoraQuestion | null>(null);

  // When platform changes, set default sub-platform
  useEffect(() => {
    if (platform === 'linkedin') setSubPlatform('linkedin_article');
    else if (platform === 'x') setSubPlatform('x_thread');
  }, [platform]);

  async function handleSubmit() {
    setCreating(true);
    setError(null);
    try {
      const parts: string[] = [];
      if (customTopic.trim()) parts.push(customTopic.trim());
      if (notes.trim()) parts.push(`Additional notes: ${notes.trim()}`);
      const brief = parts.length > 0 ? parts.join('\n\n') : undefined;

      const effectivePlatform = (platform === 'linkedin' || platform === 'x') ? subPlatform : platform;

      const draft = await generateDraft(brandId, {
        platform: effectivePlatform,
        prompt_id: promptId !== '' ? (promptId as number) : undefined,
        custom_brief: brief,
        quora_question_url: selectedQuestion?.url,
        quora_question_title: selectedQuestion?.title,
        quora_question_snippet: selectedQuestion?.snippet,
      });
      onCreated(draft);
      onClose();
    } catch (e: unknown) {
      const err = e as { response?: { data?: { detail?: string | Array<{ msg?: string }> } } };
      const detail = err?.response?.data?.detail;
      // Handle both string details (HTTPException) and array details (validation errors)
      let message = 'Draft generation failed. Check that API keys are configured.';
      if (typeof detail === 'string') {
        message = detail;
      } else if (Array.isArray(detail) && detail.length > 0 && detail[0]?.msg) {
        message = detail[0].msg;
      }
      setError(message);
    } finally {
      setCreating(false);
    }
  }

  return (
    <Dialog open={true} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Request a Draft</DialogTitle>
          <p className="text-xs text-[var(--text-muted)] mt-0.5">Generate a targeted draft for a specific prompt or topic</p>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          {/* Platform */}
          <div>
            <label className="text-xs text-[var(--text-muted)] font-medium uppercase tracking-wide mb-1.5 block">Platform</label>
            <div className="grid grid-cols-3 gap-2">
              {DRAFT_PLATFORMS.map((p) => {
                const isPaidOnly = p === 'linkedin' || p === 'x';
                const isLocked = isPaidOnly && !user?.subscription_tier && !user?.is_admin;
                const label = PLATFORM_DISPLAY[p] ?? p;

                if (isLocked) {
                  return (
                    <button
                      key={p}
                      disabled
                      className="py-2 rounded-lg text-xs font-medium capitalize transition-colors border bg-[rgba(255,255,255,0.03)] border-[rgba(255,255,255,0.06)] text-[var(--text-faint)] opacity-50 cursor-not-allowed flex items-center justify-center gap-1.5"
                    >
                      <PlatformIcon platform={p} size={12} color="var(--text-faint)" />
                      {label}
                      <span className="text-[9px] bg-[rgba(95,126,166,0.2)] text-[var(--accent)] px-1.5 py-0.5 rounded-full font-semibold">UPGRADE</span>
                    </button>
                  );
                }

                return (
                  <button
                    key={p}
                    onClick={() => { setPlatform(p); if (p !== 'quora') setSelectedQuestion(null); }}
                    className={`py-2 rounded-lg text-xs font-medium capitalize transition-colors border flex items-center justify-center gap-1.5 ${
                      platform === p
                        ? 'bg-[var(--accent)]/20 border-[var(--accent)]/50 text-[var(--accent)]'
                        : 'bg-[rgba(255,255,255,0.06)] border-[rgba(255,255,255,0.10)] text-[var(--text-muted)] hover:text-[var(--text-secondary)]'
                    }`}
                  >
                    <PlatformIcon platform={p} size={12} color={platform === p ? 'var(--accent)' : 'var(--text-muted)'} />
                    {label}
                  </button>
                );
              })}
            </div>

            {/* LinkedIn sub-selector */}
            {platform === 'linkedin' && (
              <div className="flex gap-2 mt-2">
                <button
                  onClick={() => setSubPlatform('linkedin_article')}
                  className={`px-3 py-1.5 text-xs rounded-lg border transition-colors ${
                    subPlatform === 'linkedin_article'
                      ? 'border-[var(--accent)] bg-[rgba(95,126,166,0.1)] text-[var(--accent)]'
                      : 'border-[rgba(255,255,255,0.1)] text-[var(--text-muted)] hover:border-[rgba(255,255,255,0.2)]'
                  }`}
                >
                  Article
                </button>
                <button
                  onClick={() => setSubPlatform('linkedin_post')}
                  className={`px-3 py-1.5 text-xs rounded-lg border transition-colors ${
                    subPlatform === 'linkedin_post'
                      ? 'border-[var(--accent)] bg-[rgba(95,126,166,0.1)] text-[var(--accent)]'
                      : 'border-[rgba(255,255,255,0.1)] text-[var(--text-muted)] hover:border-[rgba(255,255,255,0.2)]'
                  }`}
                >
                  Post
                </button>
              </div>
            )}

            {/* X sub-selector */}
            {platform === 'x' && (
              <div className="flex gap-2 mt-2">
                <button
                  onClick={() => setSubPlatform('x_thread')}
                  className={`px-3 py-1.5 text-xs rounded-lg border transition-colors ${
                    subPlatform === 'x_thread'
                      ? 'border-[var(--accent)] bg-[rgba(95,126,166,0.1)] text-[var(--accent)]'
                      : 'border-[rgba(255,255,255,0.1)] text-[var(--text-muted)] hover:border-[rgba(255,255,255,0.2)]'
                  }`}
                >
                  Thread
                </button>
                <button
                  onClick={() => setSubPlatform('x_post')}
                  className={`px-3 py-1.5 text-xs rounded-lg border transition-colors ${
                    subPlatform === 'x_post'
                      ? 'border-[var(--accent)] bg-[rgba(95,126,166,0.1)] text-[var(--accent)]'
                      : 'border-[rgba(255,255,255,0.1)] text-[var(--text-muted)] hover:border-[rgba(255,255,255,0.2)]'
                  }`}
                >
                  Post
                </button>
              </div>
            )}
          </div>

          {/* Target prompt */}
          <div>
            <label className="text-xs text-[var(--text-muted)] font-medium uppercase tracking-wide mb-1.5 block">
              Target Prompt <span className="text-[var(--text-faint)] normal-case font-normal">(optional)</span>
            </label>
            <div className="relative">
              <select
                value={promptId}
                onChange={(e) => setPromptId(e.target.value === '' ? '' : Number(e.target.value))}
                className="w-full appearance-none bg-[rgba(255,255,255,0.05)] border border-[rgba(255,255,255,0.10)] text-[var(--text-primary)] rounded-lg pl-3 pr-8 py-2 text-sm focus:outline-none focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--accent)]/50"
              >
                <option value="">— Select tracked prompt —</option>
                {prompts.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.text.length > 60 ? p.text.slice(0, 60) + '…' : p.text}
                  </option>
                ))}
              </select>
              <ChevronDown size={13} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[var(--text-faint)] pointer-events-none" />
            </div>
          </div>

          {/* Quora question picker */}
          {platform === 'quora' && (
            <div>
              <label className="text-xs text-[var(--text-muted)] font-medium uppercase tracking-wide mb-2 block">
                Target Question <span className="text-[var(--text-faint)] normal-case font-normal">(optional — picks a real Quora question)</span>
              </label>
              <QuoraQuestionPicker
                brandId={brandId}
                promptId={promptId}
                selected={selectedQuestion}
                onSelect={setSelectedQuestion}
              />
            </div>
          )}

          {/* Custom topic */}
          <div>
            <label className="text-xs text-[var(--text-muted)] font-medium uppercase tracking-wide mb-1.5 block">
              Custom Topic <span className="text-[var(--text-faint)] normal-case font-normal">(or leave blank to use prompt)</span>
            </label>
            <input
              type="text"
              value={customTopic}
              onChange={(e) => setCustomTopic(e.target.value)}
              maxLength={500}
              placeholder="e.g. Why Rainbow Study matters for oncologists"
              className="w-full bg-[rgba(255,255,255,0.05)] border border-[rgba(255,255,255,0.10)] text-[var(--text-primary)] rounded-lg px-3 py-2 text-sm placeholder:text-[var(--text-faint)] focus:outline-none focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--accent)]/50"
            />
          </div>

          {/* Notes */}
          <div>
            <label className="text-xs text-[var(--text-muted)] font-medium uppercase tracking-wide mb-1.5 block">
              Notes <span className="text-[var(--text-faint)] normal-case font-normal">(optional)</span>
            </label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              maxLength={1000}
              placeholder="Focus on clinical data, write for a non-technical audience…"
              className="w-full bg-[rgba(255,255,255,0.05)] border border-[rgba(255,255,255,0.10)] text-[var(--text-primary)] rounded-lg px-3 py-2 text-sm placeholder:text-[var(--text-faint)] focus:outline-none focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--accent)]/50 resize-none"
            />
          </div>

          {error && (
            <p className="text-xs text-[var(--danger)] bg-[#7f1d1d]/15 border border-[#991b1b]/25 rounded-lg px-3 py-2">
              {error}
            </p>
          )}

          <button
            onClick={handleSubmit}
            disabled={creating || (promptId === '' && !customTopic.trim())}
            className="w-full flex items-center justify-center gap-2 bg-[rgba(95,126,166,0.15)] hover:bg-[rgba(95,126,166,0.22)] border border-[rgba(95,126,166,0.30)] hover:border-[rgba(95,126,166,0.45)] text-[var(--accent-foreground)] hover:text-[var(--text-primary)] hover:shadow-[0_0_24px_rgba(95,126,166,0.18)] disabled:opacity-50 rounded-lg px-4 py-2.5 text-sm font-medium transition-colors"
          >
            {creating ? (
              <><Loader2 size={14} className="animate-spin" /> Generating…</>
            ) : (
              <><Sparkles size={14} /> Generate Draft</>
            )}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── Opportunity card (Visibility Opportunities tab) ──────────────────────────

function OpportunityCard({
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
    <div className="card p-4 flex flex-col gap-3 hover:border-[rgba(255,255,255,0.14)] transition-colors">
      {/* Top row */}
      <div className="flex items-center gap-2 flex-wrap">
        <PlatformBadge platform={opp.platform} />
        {opp.subreddit && (
          <span className="text-xs text-[var(--text-muted)] font-medium">r/{opp.subreddit}</span>
        )}
        <span className={`text-xs font-semibold font-mono ml-auto ${relevanceColor}`}>
          {Math.round(opp.relevance_score)}% relevance
        </span>
      </div>

      {/* Thread title */}
      <a
        href={opp.thread_url}
        target="_blank"
        rel="noopener noreferrer"
        className="text-sm font-medium text-[var(--text-primary)] hover:text-[var(--accent)] transition-colors leading-snug flex items-start gap-1.5"
      >
        {opp.thread_title || opp.thread_url}
        <ExternalLink size={11} className="shrink-0 mt-0.5 text-[var(--text-faint)]" />
      </a>

      {/* Body preview */}
      {opp.body_preview && (
        <p className="text-xs text-[var(--text-faint)] leading-relaxed line-clamp-2">{opp.body_preview}</p>
      )}

      {/* Meta */}
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

      {/* Actions */}
      <div className="flex items-center gap-2 pt-1">
        <button
          onClick={handleDraft}
          disabled={drafting || queueFull}
          title={queueFull ? 'Draft queue full — approve or dismiss drafts to make room' : undefined}
          className="flex items-center gap-1.5 text-xs bg-[rgba(95,126,166,0.15)] hover:bg-[rgba(95,126,166,0.22)] border border-[rgba(95,126,166,0.30)] hover:border-[rgba(95,126,166,0.45)] text-[var(--accent-foreground)] hover:text-[var(--text-primary)] hover:shadow-[0_0_24px_rgba(95,126,166,0.18)] disabled:opacity-50 disabled:cursor-not-allowed rounded-lg px-3 py-1.5 transition-colors"
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

// ── Posting guidance ──────────────────────────────────────────────────────────

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

// ── Scheduled card ────────────────────────────────────────────────────────────

function ScheduledCard({
  draft,
  onMarkPosted,
  onMoveToDrafts,
}: {
  draft: ContentDraft;
  onMarkPosted: (id: number) => void;
  onMoveToDrafts: (id: number) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [guideOpen, setGuideOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const title = draft.title ?? draft.content_text.slice(0, 80) + (draft.content_text.length > 80 ? '…' : '');

  async function handleCopy() {
    await navigator.clipboard.writeText(draft.content_text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  const guidance = POSTING_GUIDANCE[draft.platform];

  return (
    <div className="card p-4 flex flex-col gap-3 hover:border-[rgba(255,255,255,0.14)] transition-colors">
      {/* Top row */}
      <div className="flex items-center gap-2 flex-wrap">
        <PlatformBadge platform={draft.platform} />
        {draft.approved_at && (
          <span className="text-xs text-[var(--text-muted)] flex items-center gap-1">
            <CheckCircle2 size={11} className="text-[var(--success)]" />
            Approved {relativeTime(draft.approved_at)}
          </span>
        )}
      </div>

      {/* Target prompt */}
      {draft.content_brief && (
        <p className="text-xs text-[var(--text-faint)] leading-relaxed line-clamp-2">
          <span className="text-[var(--text-muted)]">Targeting: </span>
          {draft.content_brief}
        </p>
      )}

      {/* Title / preview */}
      <div>
        {draft.title && (
          <p className="text-sm font-semibold text-[var(--text-primary)] leading-snug mb-1">{draft.title}</p>
        )}
        {!draft.title && (
          <p className="text-sm text-[var(--text-secondary)] leading-relaxed truncate">{title}</p>
        )}
      </div>

      {/* Expandable full draft */}
      {expanded && (
        <div className="bg-[rgba(95,126,166,0.06)] border border-[rgba(255,255,255,0.10)] rounded-lg p-3 relative">
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

      {/* How to Post guidance */}
      {guidance && (
        <div className="border border-[var(--border-subtle)] rounded-lg overflow-hidden">
          <button
            onClick={() => setGuideOpen(!guideOpen)}
            className="w-full flex items-center justify-between px-3 py-2 bg-[rgba(95,126,166,0.06)] hover:bg-[rgba(255,255,255,0.06)] text-left transition-colors"
          >
            <span className="flex items-center gap-1.5 text-xs text-[var(--text-muted)] font-medium">
              <BookOpen size={11} />
              How to Post on {PLATFORM_DISPLAY[draft.platform] ?? draft.platform.charAt(0).toUpperCase() + draft.platform.slice(1)}
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

      {/* Manual posting reminder */}
      <div className="bg-[rgba(16,185,129,0.05)] border border-[rgba(16,185,129,0.12)] rounded-lg px-3 py-2 flex items-start gap-2">
        <HelpCircle size={11} className="text-[var(--success)] mt-0.5 shrink-0" />
        <p className="text-[11px] text-[var(--text-faint)] leading-relaxed">
          <span className="text-[var(--text-muted)] font-medium">This draft needs to be posted manually.</span>
          {' '}Use the View Draft button to copy the content, post it on {PLATFORM_DISPLAY[draft.platform] ?? draft.platform.charAt(0).toUpperCase() + draft.platform.slice(1)}, then click{' '}
          <span className="text-[var(--success)]">Mark as Posted</span> to record it and start tracking visibility changes.
        </p>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-2 pt-1 flex-wrap">
        <button
          onClick={() => setExpanded(!expanded)}
          className="flex items-center gap-1.5 text-xs bg-[rgba(255,255,255,0.06)] hover:bg-[rgba(255,255,255,0.10)] border border-[rgba(255,255,255,0.10)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] rounded-lg px-3 py-1.5 transition-colors"
        >
          <FileText size={11} />
          {expanded ? 'Hide Draft' : 'View Draft'}
        </button>
        <button
          onClick={() => onMarkPosted(draft.id)}
          className="flex items-center gap-1.5 text-xs bg-[#064e3b]/20 hover:bg-[#064e3b]/30 border border-[#065f46]/25 text-[var(--success)] rounded-lg px-3 py-1.5 transition-colors duration-150"
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

// ── Main page ─────────────────────────────────────────────────────────────────

export default function ContentHubPage() {
  const { user } = useAuth();
  const { brands, activeBrandId: selectedBrandId, setActiveBrandId: setSelectedBrandId, loading: brandsLoading } = useBrand();
  const [activePrimaryTab, setActivePrimaryTab] = useState<PrimaryTab>('content_drafts');
  const [activeSubTab, setActiveSubTab] = useState<ContentDraftsSubTab>('queue');
  const activeTab: QueueTab = activePrimaryTab === 'content_drafts'
    ? (activeSubTab === 'scheduled' ? 'scheduled' : 'drafts')
    : activePrimaryTab === 'opportunities'
    ? 'opportunities'
    : 'posted';
  const [toast, setToast] = useState<ToastData | null>(null);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3000);
    return () => clearTimeout(t);
  }, [toast]);

  // Sync tab from URL after mount — avoids SSR/client hydration mismatch
  useEffect(() => { document.title = 'Content Hub — Lumidian'; }, []);

  useEffect(() => {
    const tab = new URLSearchParams(window.location.search).get('tab');
    if (tab === 'opportunities') {
      setActivePrimaryTab('opportunities');
    } else if (tab === 'drafts') {
      setActivePrimaryTab('content_drafts');
      setActiveSubTab('queue');
    } else if (tab === 'scheduled' || tab === 'saved') {
      setActivePrimaryTab('content_drafts');
      setActiveSubTab('scheduled');
    } else if (tab === 'posted') {
      setActivePrimaryTab('posted');
    }
  }, []);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Content data
  const [draftItems, setDraftItems] = useState<ContentDraft[]>([]);
  const [scheduledItems, setScheduledItems] = useState<ContentDraft[]>([]);
  const [postedItems, setPostedItems] = useState<ContentDraft[]>([]);
  const [draftAttributions, setDraftAttributions] = useState<DraftAttribution[]>([]);
  const [opportunities, setOpportunities] = useState<ContentOpportunity[]>([]);
  const [pinnedDraftId, setPinnedDraftId] = useState<number | null>(null);
  const [brandProfile, setBrandProfile] = useState<BrandProfile | null>(null);
  const [brandPrompts, setBrandPrompts] = useState<Prompt[]>([]);
  const [contentSettings, setContentSettings] = useState<BrandContentSettings[]>([]); // backend draft-generation prefs (loaded but not used for sidebar toggles)

  // Report-running guard (set by dashboard via localStorage)
  const [reportRunning, setReportRunning] = useState(false);
  useEffect(() => {
    const check = () => setReportRunning(!!localStorage.getItem('clarity_report_running'));
    check();
    const interval = setInterval(check, 2000);
    return () => clearInterval(interval);
  }, []);

  // Right panel
  const [generating, setGenerating] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [generateError, setGenerateError] = useState<string | null>(null);
  const generatePollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // Broadcast drafts-generating state to other pages via localStorage
  useEffect(() => {
    try {
      if (generating) localStorage.setItem('clarity_drafts_generating', '1');
      else localStorage.removeItem('clarity_drafts_generating');
    } catch {}
  }, [generating]);

  const [requestDraftOpen, setRequestDraftOpen] = useState(false);
  const [draftStatus, setDraftStatus] = useState<DraftQueueStatus | null>(null);

  // Help modals
  const [hubHelpOpen, setHubHelpOpen] = useState(false);
  const [oppHelpOpen, setOppHelpOpen] = useState(false);
  const [postingGuideOpen, setPostingGuideOpen] = useState(false);
  const [postingPlatform, setPostingPlatform] = useState<'reddit' | 'quora' | 'medium' | 'wikipedia'>('reddit');
  const [explainerOpen, setExplainerOpen] = useState(false);
  const [attachPopoverDraftId, setAttachPopoverDraftId] = useState<number | null>(null);
  const [markPostedModalDraftId, setMarkPostedModalDraftId] = useState<number | null>(null);

  // Upgrade modal (shown on 402 responses)
  const [upgradeModalOpen, setUpgradeModalOpen] = useState(false);
  const [upgradeModalReason, setUpgradeModalReason] = useState('');

  // Per-tab platform toggles (local view filters, independent per tab)
  const [tabDisabledPlatforms, setTabDisabledPlatforms] = useState<Record<QueueTab, string[]>>({
    drafts: [],
    scheduled: [],
    opportunities: [],
    posted: [],
  });

  // Disabled platforms for the active tab
  const _disabledPlatforms = new Set(tabDisabledPlatforms[activeTab]);

  // Active platform filters (independent per tab)
  const [draftPlatformFilter, setDraftPlatformFilter] = useState<string>('all');
  const [oppPlatformFilter, setOppPlatformFilter] = useState<string>('all');

  const searchParams = useSearchParams();

  // Capture ?platform= query param at first render — consumed once after the brand loads
  // (see the selectedBrandId effect below). This survives the activeTab/selectedBrandId
  // resets that fire on initial mount.
  const _initialPlatformParam = searchParams?.get('platform');
  const _SUPPORTED_PLATFORMS = ['reddit', 'quora', 'medium', 'wikipedia', 'linkedin', 'x'];
  const pendingPlatformRef = useRef<string | null>(
    _initialPlatformParam && _SUPPORTED_PLATFORMS.includes(_initialPlatformParam)
      ? _initialPlatformParam
      : null
  );

  useEffect(() => {
    setDraftPlatformFilter('all');
    setOppPlatformFilter('all');
  }, [activeTab]);

  // Tab counts (total per tab, unaffected by toggles)
  const tabCounts = {
    drafts: draftItems.length,
    scheduled: scheduledItems.length,
    opportunities: opportunities.length,
    posted: postedItems.length,
  };

  const primaryTabCounts = {
    opportunities: opportunities.length,
    content_drafts: draftItems.length + scheduledItems.length,
    posted: postedItems.length,
  };

  // ── Load data ──────────────────────────────────────────────────────────────

  const loadAbortRef = useRef<AbortController | null>(null);

  const loadAll = useCallback(async (brandId: number, signal?: AbortSignal) => {
    setLoading(true);
    setError(null);
    try {
      const [
        draftsData,
        scheduledData,
        postedData,
        oppsData,
        profileData,
        brandDetail,
        settingsData,
        statusData,
        attributionsData,
      ] = await Promise.all([
        getDrafts(brandId, undefined, 'draft'),
        getDrafts(brandId, undefined, 'approved'),
        getDrafts(brandId, undefined, 'posted'),
        getOpportunities(brandId),
        getBrandProfile(brandId).catch((err) => { logError(err, 'Content: fetch brand profile'); return null; }),
        getBrand(brandId).catch((err) => { logError(err, 'Content: fetch brand detail'); return null; }),
        getContentSettings(brandId).catch((err) => { logError(err, 'Content: fetch content settings'); return [] as BrandContentSettings[]; }),
        getDraftStatus(brandId).catch((err) => { logError(err, 'Content: fetch draft status'); return null; }),
        getDraftAttributions(brandId).catch((err) => { logError(err, 'Content: fetch draft attributions'); return [] as DraftAttribution[]; }),
      ]);

      // Ignore results if the user switched to a different brand while fetching
      if (signal?.aborted) return;

      setDraftItems(draftsData);
      setScheduledItems(scheduledData);
      setPostedItems(postedData);
      setDraftAttributions(attributionsData);
      setOpportunities(oppsData);
      setBrandProfile(profileData);
      setBrandPrompts(brandDetail?.prompts ?? []);
      setContentSettings(settingsData);
      setDraftStatus(statusData);
    } catch {
      if (signal?.aborted) return;
      setError('Failed to load content data. Check that the backend is running.');
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, []);


  useEffect(() => {
    if (!selectedBrandId) return;
    // Cancel any in-flight generation poll for the previous brand
    if (generatePollRef.current) {
      clearInterval(generatePollRef.current);
      generatePollRef.current = null;
      setGenerating(false);
    }
    if (pendingPlatformRef.current) {
      setDraftPlatformFilter(pendingPlatformRef.current);
      pendingPlatformRef.current = null;
    } else {
      setDraftPlatformFilter('all');
    }
    setOppPlatformFilter('all');
    loadAbortRef.current?.abort();
    const controller = new AbortController();
    loadAbortRef.current = controller;
    loadAll(selectedBrandId, controller.signal);
    return () => controller.abort();
  }, [selectedBrandId, loadAll]);

  // When brands finish loading and there are none, stop the loading spinner.
  useEffect(() => {
    if (!brandsLoading && !selectedBrandId) setLoading(false);
  }, [brandsLoading, selectedBrandId]);

  // Cleanup generate-now poll on unmount
  useEffect(() => () => { if (generatePollRef.current) clearInterval(generatePollRef.current); }, []);

  // ── Auto-poll when generation is already running on page load ─────────────
  // If the user navigates to the page while backend generation is in progress
  // (scheduled job, or they left mid-generation and came back), keep fetching
  // fresh drafts until generation completes.
  const generationPollActive = useRef(false);
  useEffect(() => {
    if (!selectedBrandId || !draftStatus?.generating || generating || generationPollActive.current) return;
    generationPollActive.current = true;
    setGenerating(true);

    const brandId = selectedBrandId;
    let cancelled = false;

    (async () => {
      const deadline = Date.now() + 360_000;
      let prevCount = draftStatus.draft_count;
      let unchangedStreak = 0;

      while (Date.now() < deadline && !cancelled) {
        await new Promise<void>((r) => setTimeout(r, 4000));
        if (cancelled) break;

        let status: DraftQueueStatus | null = null;
        try {
          status = await getDraftStatusFresh(brandId);
        } catch { break; }

        if (cancelled) break;
        setDraftStatus(status);

        if (status.draft_count !== prevCount) {
          prevCount = status.draft_count;
          unchangedStreak = 0;
          // Lightweight: only refresh drafts, not all 9 endpoints
          getDrafts(brandId, undefined, 'draft').then(setDraftItems).catch(() => {});
        } else {
          unchangedStreak++;
        }

        if (!status.generating && unchangedStreak >= 2) break;
      }

      if (!cancelled) {
        setGenerating(false);
        loadAll(brandId).catch(() => {});
      }
      generationPollActive.current = false;
    })();

    return () => { cancelled = true; generationPollActive.current = false; };
  // Only trigger on initial load / brand switch — not on every draftStatus change
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedBrandId, draftStatus?.generating]);

  // ── Draft actions ──────────────────────────────────────────────────────────

  async function handleApprove(id: number) {
    if (draftStatus?.scheduled_queue_full) {
      setToast({
        message: `Scheduled queue is full (${draftStatus.scheduled_cap}/${draftStatus.scheduled_cap}). Mark some drafts as posted first.`,
        type: 'error',
      });
      return;
    }
    try {
      await updateDraft(id, { status: 'approved' });
    } catch (e: unknown) {
      const err = e as { response?: { data?: { detail?: string | Array<{ msg?: string }> }; status?: number } };
      const rawDetail = err?.response?.data?.detail;
      const detail = typeof rawDetail === 'string' ? rawDetail : '';
      if (detail.includes('queue is full') || err?.response?.status === 409) {
        setToast({
          message: detail || 'Scheduled queue is full. Mark some drafts as posted first.',
          type: 'error',
        });
        return;
      }
      throw e;
    }
    if (selectedBrandId) loadAll(selectedBrandId);
    setToast({ message: 'Draft approved', type: 'success' });
  }

  async function handleApproveAll() {
    if (!selectedBrandId) return;
    const platform = draftPlatformFilter !== 'all' ? draftPlatformFilter : undefined;
    const count = visibleDraftItems.length;
    if (!confirm(`Approve ${count} draft${count !== 1 ? 's' : ''}?`)) return;
    try {
      const result = await approveAllDrafts(selectedBrandId, platform);
      loadAll(selectedBrandId);
      const msg = result.skipped > 0
        ? `${result.approved} approved, ${result.skipped} skipped (queue cap reached)`
        : `${result.approved} draft${result.approved !== 1 ? 's' : ''} approved`;
      setToast({ message: msg, type: 'success' });
    } catch (e: unknown) {
      const err = e as { response?: { data?: { detail?: string } } };
      const detail = typeof err?.response?.data?.detail === 'string' ? err.response.data.detail : 'Failed to approve drafts';
      setToast({ message: detail, type: 'error' });
    }
  }

  async function handleMarkAsPosted(id: number) {
    const draft = scheduledItems.find((d) => d.id === id);
    const isOrphan = draft && !draft.prompt_id;
    const hasPromptsToSuggest = brandPrompts.length > 0;
    if (isOrphan && hasPromptsToSuggest) {
      setMarkPostedModalDraftId(id);
      return;
    }
    await updateDraft(id, { status: 'posted' });
    if (selectedBrandId) loadAll(selectedBrandId);
  }

  async function handleMoveBackToDrafts(id: number) {
    await updateDraft(id, { status: 'draft' });
    if (selectedBrandId) loadAll(selectedBrandId);
  }

  async function handleDelete(id: number) {
    const wasInDraftQueue = draftItems.some((d) => d.id === id);
    await deleteDraft(id);
    setDraftItems((prev) => prev.filter((d) => d.id !== id));
    setScheduledItems((prev) => prev.filter((d) => d.id !== id));
    setPostedItems((prev) => prev.filter((d) => d.id !== id));
    if (wasInDraftQueue) {
      setDraftStatus((prev) => {
        if (!prev) return prev;
        const newCount = Math.max(0, prev.draft_count - 1);
        return { ...prev, draft_count: newCount, draft_queue_full: newCount >= prev.draft_cap };
      });
    }
    setToast({ message: 'Draft removed', type: 'info' });
  }

  function handleSaved(updated: ContentDraft) {
    setDraftItems((prev) => prev.map((d) => (d.id === updated.id ? updated : d)));
  }

  // ── Opportunity actions ────────────────────────────────────────────────────

  async function handleDraftOpportunity(oppId: number) {
    if (draftStatus?.draft_queue_full) {
      setToast({
        message: `Draft queue is full (${draftStatus.draft_cap}/${draftStatus.draft_cap}). Approve or dismiss drafts to make room.`,
        type: 'error',
      });
      return;
    }
    try {
      const draft = await draftOpportunity(oppId);
      setOpportunities((prev) => prev.filter((o) => o.id !== oppId));
      setDraftItems((prev) => [draft, ...prev]);
      setPinnedDraftId(draft.id);
      // Refresh status so the count is accurate
      if (selectedBrandId) getDraftStatus(selectedBrandId).then(setDraftStatus).catch((err) => logError(err, 'Content: refresh draft status after drafting opportunity'));
      setActivePrimaryTab('content_drafts'); setActiveSubTab('queue');
    } catch (e: unknown) {
      const err = e as { response?: { status?: number; data?: { detail?: string | Array<{ msg?: string }> } } };
      const rawDetail = err?.response?.data?.detail;
      const detail = typeof rawDetail === 'string'
        ? rawDetail
        : (Array.isArray(rawDetail) && rawDetail[0]?.msg)
          ? rawDetail[0].msg
          : 'Failed to draft reply. Try again.';
      const httpStatus = err?.response?.status;
      if (httpStatus === 402) {
        setUpgradeModalReason(detail);
        setUpgradeModalOpen(true);
      } else {
        setToast({ message: detail, type: 'error' });
      }
    }
  }

  async function handleDismissOpportunity(oppId: number) {
    await dismissOpportunity(oppId);
    setOpportunities((prev) => prev.filter((o) => o.id !== oppId));
    setToast({ message: 'Opportunity dismissed', type: 'info' });
  }

  function handleNavigateToQueueDraft(draftId: number) {
    setActivePrimaryTab('content_drafts');
    setActiveSubTab('queue');
    setPinnedDraftId(draftId);
  }

  // ── Right panel actions ────────────────────────────────────────────────────

  async function handleGenerateNow() {
    if (!selectedBrandId || scanning || generating || reportRunning) return;
    setGenerating(true);
    setGenerateError(null);

    const brandId = selectedBrandId;

    // Clear drafts UI immediately to show we're refreshing
    setDraftItems([]);
    setActivePrimaryTab('content_drafts'); setActiveSubTab('queue');

    try {
      // Backend starts generation in the background and returns 202 immediately.
      // Poll draft-status every 4 seconds until generation completes (up to 6 min).
      // Invalidate cached status so polling reads fresh data from the server.
      invalidateCache(`/content/${brandId}/draft-status`);
      await generateNow(brandId);

      const deadline = Date.now() + 360_000; // 6-minute max
      let prevCount = 0;
      let unchangedStreak = 0;

      while (Date.now() < deadline) {
        await new Promise<void>((r) => setTimeout(r, 4000));
        if (selectedBrandId !== brandId) break; // user switched brand

        let currentStatus: DraftQueueStatus | null = null;
        try {
          currentStatus = await getDraftStatusFresh(brandId);
        } catch {
          break;
        }

        setDraftStatus(currentStatus);

        if (currentStatus.draft_count !== prevCount) {
          prevCount = currentStatus.draft_count;
          unchangedStreak = 0;
          // Lightweight refresh: only fetch drafts, not all 9 endpoints
          getDrafts(brandId, undefined, 'draft').then(setDraftItems).catch((err) => logError(err, 'Content: refresh drafts during generation poll'));
        } else {
          unchangedStreak++;
        }

        // Stop when generation flag cleared AND count stable for 2 consecutive polls
        if (!currentStatus.generating && unchangedStreak >= 2) break;
      }

      setGenerating(false);
      loadAll(brandId).catch((err) => logError(err, 'Content: reload after generation complete'));

      const finalStatus = await getDraftStatusFresh(brandId).catch((err) => { logError(err, 'Content: fetch final draft status'); return null; });
      const count = finalStatus?.draft_count ?? prevCount;
      const promptCount = brandPrompts.length;
      if (count >= 20) {
        setToast({ message: `Generated ${count} new drafts`, type: 'success' });
      } else if (count === 0) {
        setToast({ message: 'No drafts generated. Add more prompts or run a tracking scan first.', type: 'info' });
      } else if (promptCount <= 3) {
        setToast({
          message: `Generated ${count} drafts (limited by ${promptCount} prompt${promptCount === 1 ? '' : 's'})`,
          type: 'success'
        });
      } else {
        setToast({ message: `Generated ${count} new drafts`, type: 'success' });
      }
    } catch (e: unknown) {
      const err = e as { response?: { data?: { detail?: string | Array<{ msg?: string }> }; status?: number }; message?: string };
      const httpStatus = err?.response?.status;
      const rawDetail = err?.response?.data?.detail;
      const raw = typeof rawDetail === 'string'
        ? rawDetail
        : (Array.isArray(rawDetail) && rawDetail[0]?.msg)
          ? rawDetail[0].msg
          : (err?.message ?? 'Generation failed. Check that API keys are configured in Settings.');
      if (httpStatus === 409) {
        setToast({ message: 'Draft generation is already in progress. Please wait.', type: 'info' });
      } else {
        const detail = raw.toLowerCase().includes('no content gaps')
          ? 'No content gaps found yet. Run a tracking scan first to identify gaps, then try again.'
          : raw;
        setGenerateError(detail);
      }
      setGenerating(false);
      getDraftStatusFresh(brandId).then(setDraftStatus).catch((err) => logError(err, 'Content: refresh draft status after generation error'));
      loadAll(brandId).catch((err) => logError(err, 'Content: reload after generation error'));
    }
  }

  const handleScanNow = useCallback(async () => {
    if (!selectedBrandId || scanning || generating || reportRunning) return;
    setScanning(true);

    // Clear existing opportunities immediately so UI shows loading state
    setOpportunities([]);

    try {
      await triggerScan(selectedBrandId);

      // Poll until scan completes (opportunities count stabilizes or timeout)
      const brandId = selectedBrandId;
      const deadline = Date.now() + 60_000; // 60s timeout
      const scanStart = Date.now();
      // Reddit scanner makes 7 HTTP queries (each with 1s sleep) + sequential Haiku
      // checks — total ~20-35s. Other scanners finish faster (~5-10s). We must wait
      // for all scanners before declaring the scan done.
      const SCAN_MIN_MS = 28_000; // don't declare done until at least 28s have elapsed
      let prevCount = -1; // -1 sentinel so first poll never starts a stableStreak
      let stableStreak = 0;

      const poll = async (): Promise<void> => {
        if (Date.now() > deadline) {
          // Timeout - fetch whatever we have
          invalidateCache('/opportunities/');
          const ops = await getOpportunities(brandId);
          setOpportunities(ops);
          setScanning(false);
          const count = ops.length;
          const promptCount = brandPrompts.length;
          if (count === 0 && promptCount <= 3) {
            setToast({ message: `No opportunities found. Add more prompts to expand the search.`, type: 'info' });
          } else {
            setToast({ message: `Found ${count} opportunities`, type: 'success' });
          }
          return;
        }

        await new Promise((r) => setTimeout(r, 2000)); // Poll every 2s
        invalidateCache('/opportunities/'); // bust cache so each poll hits the DB
        const ops = await getOpportunities(brandId);
        const count = ops.length;

        // Show live count as scanners complete (Quora first, then Reddit)
        setOpportunities(ops);

        // Only track stability after the minimum scan window has elapsed
        const elapsed = Date.now() - scanStart;
        if (elapsed >= SCAN_MIN_MS) {
          if (count === prevCount) {
            stableStreak++;
          } else {
            stableStreak = 0;
          }
        }
        prevCount = count;

        // Stable for 5 consecutive polls (10 seconds) = done
        // Requires 5 matches to ensure all platform scanners have finished
        if (stableStreak >= 5) {
          setOpportunities(ops);
          setScanning(false);

          // Show contextual message about results
          const promptCount = brandPrompts.length;
          if (count >= 10) {
            setToast({ message: `Found ${count} opportunities`, type: 'success' });
          } else if (count === 0) {
            setToast({
              message: promptCount <= 3
                ? `No opportunities found. Add more prompts to expand the search.`
                : `No matching threads found right now.`,
              type: 'info'
            });
          } else if (promptCount <= 3) {
            setToast({
              message: `Found ${count} opportunit${count === 1 ? 'y' : 'ies'} (limited by ${promptCount} prompt${promptCount === 1 ? '' : 's'})`,
              type: 'success'
            });
          } else {
            setToast({ message: `Found ${count} opportunities`, type: 'success' });
          }
          return;
        }

        // Keep polling
        return poll();
      };

      await poll();
    } catch (err: unknown) {
      console.error('Scan trigger failed:', err);
      setScanning(false);
      const e = err as { response?: { status?: number } };
      if (e?.response?.status === 409) {
        setToast({ message: 'A scan is already running. Please wait for it to finish.', type: 'info' });
      } else {
        setToast({ message: 'Scan failed. Please try again.', type: 'error' });
      }
    }
  }, [selectedBrandId, scanning, brandPrompts.length]);

  function handleTogglePlatform(platform: string) {
    setTabDisabledPlatforms((prev) => {
      const current = prev[activeTab];
      const isDisabled = current.includes(platform);
      return {
        ...prev,
        [activeTab]: isDisabled
          ? current.filter((p) => p !== platform)
          : [...current, platform],
      };
    });
  }

  // Filter drafts to only show enabled platforms + active platform filter
  const visibleDraftItems = draftItems.filter(
    (d) => !_disabledPlatforms.has(d.platform) && (draftPlatformFilter === 'all' || d.platform === draftPlatformFilter)
  );
  const visibleScheduledItems = scheduledItems.filter((d) => !_disabledPlatforms.has(d.platform));
  const visiblePostedItems = postedItems.filter((d) => !_disabledPlatforms.has(d.platform));
  const visibleOpportunities = opportunities.filter(
    (o) => !_disabledPlatforms.has(o.platform) && (oppPlatformFilter === 'all' || o.platform === oppPlatformFilter)
  );

  const PRIMARY_TABS: { key: PrimaryTab; label: string }[] = [
    { key: 'opportunities', label: 'Visibility Opportunities' },
    { key: 'content_drafts', label: 'Content Drafts' },
    { key: 'posted', label: 'Posted' },
  ];

  return (
    <motion.div
      variants={fadeIn}
      initial="hidden"
      animate="visible"
      className="px-4 sm:px-8 py-6 sm:py-8 max-w-[1400px]"
    >
      {/* Subscription status banner */}
      {user?.subscription_status && ['past_due', 'canceled', 'unpaid'].includes(user.subscription_status) && (
        <div className="-mx-8 -mt-8 mb-6">
          <SubscriptionBanner status={user.subscription_status} />
        </div>
      )}

      {/* Progress banners removed — AppShell shows global status banners for generating/scanning */}

      {/* Request Draft modal */}
      {requestDraftOpen && selectedBrandId && (
        <RequestDraftModal
          brandId={selectedBrandId}
          prompts={brandPrompts}
          onClose={() => setRequestDraftOpen(false)}
          onCreated={(draft) => {
            setDraftItems((prev) => [draft, ...prev]);
            setActivePrimaryTab('content_drafts'); setActiveSubTab('queue');
          }}
        />
      )}

      {/* Help modals */}
      {hubHelpOpen && (
        <HelpModal title="How Content Hub works" onClose={() => setHubHelpOpen(false)}>
          <p>Content Hub generates AI drafts for your brand and surfaces live threads across Reddit, Quora, LinkedIn, and X where you can contribute.</p>
          <ul className="space-y-2 mt-2">
            <li><span className="text-[var(--text-primary)] font-medium">Regenerate Drafts</span> — replaces all existing drafts with a fresh batch across your tracked prompts and platforms.</li>
            <li><span className="text-[var(--text-primary)] font-medium">Visibility Opportunities</span> tab shows threads across Reddit, Quora, LinkedIn, and X matching your tracked prompts. Use &quot;Scan for Opportunities&quot; to refresh.</li>
            <li><span className="text-[var(--text-primary)] font-medium">Queue</span> — review, edit, and approve AI drafts before they go live.</li>
            <li><span className="text-[var(--text-primary)] font-medium">Saved</span> — approved drafts ready to post. Copy the text, post it manually, then click Mark as Posted.</li>
            <li><span className="text-[var(--text-primary)] font-medium">Posted tab</span> — content that has been marked as posted.</li>
            <li><span className="text-[var(--text-primary)] font-medium">Brand Settings</span> — control which platforms generate drafts and how frequently.</li>
          </ul>
        </HelpModal>
      )}
      {explainerOpen && <ImpactExplainerModal onClose={() => setExplainerOpen(false)} />}
      {attachPopoverDraftId != null && (
        <div className="fixed inset-0 z-50 flex items-start justify-center pt-24 px-4">
          <button
            type="button"
            aria-label="Close attach prompt dialog"
            className="absolute inset-0 bg-black/40 cursor-default"
            onClick={() => setAttachPopoverDraftId(null)}
          />
          <div className="relative">
            <AttachPromptPopover
              draftId={attachPopoverDraftId}
              allPrompts={brandPrompts}
              onAttach={async (promptId) => {
                await updateDraft(attachPopoverDraftId, { prompt_id: promptId });
                if (selectedBrandId) loadAll(selectedBrandId);
                setToast({ message: 'Attached to prompt', type: 'success' });
              }}
              onClose={() => setAttachPopoverDraftId(null)}
            />
          </div>
        </div>
      )}
      {markPostedModalDraftId != null && (
        <MarkAsPostedModal
          draftId={markPostedModalDraftId}
          allPrompts={brandPrompts}
          onAttachAndPost={async (promptId) => {
            await updateDraft(markPostedModalDraftId, { prompt_id: promptId, status: 'posted' });
            if (selectedBrandId) loadAll(selectedBrandId);
            setToast({ message: 'Attached and marked as posted', type: 'success' });
          }}
          onPostWithoutAttach={async () => {
            await updateDraft(markPostedModalDraftId, { status: 'posted' });
            if (selectedBrandId) loadAll(selectedBrandId);
          }}
          onClose={() => setMarkPostedModalDraftId(null)}
        />
      )}
      {oppHelpOpen && (
        <HelpModal title="Visibility Opportunities" onClose={() => setOppHelpOpen(false)}>
          <p>Threads and discussions across Reddit, Quora, LinkedIn, and X where your brand can meaningfully contribute.</p>
          <p>Scanners search for content matching your tracked prompts. Only results with a relevance score of 40+ are shown.</p>
          <ul className="space-y-2 mt-2">
            <li><span className="text-[var(--text-primary)] font-medium">Relevance score</span> — how closely the thread or question matches your tracked prompts, based on keyword overlap, recency, and engagement.</li>
            <li><span className="text-[var(--text-primary)] font-medium">Draft Reply</span> — generates an AI reply using your brand voice guidelines.</li>
            <li><span className="text-[var(--text-primary)] font-medium">Dismiss</span> — removes the opportunity from this list.</li>
          </ul>
          <p className="text-[var(--text-muted)] text-xs mt-2">Use &quot;Scan for Opportunities&quot; to search for new threads on demand.</p>
        </HelpModal>
      )}

      {/* Posting Guide modal — centered */}
      {postingGuideOpen && (() => {
        const PLATFORMS = {
          reddit: {
            label: 'Reddit',
            subtitle: 'Discussion posts & replies',
            iconKey: 'reddit',
            color: '#ff4500',
            colorMuted: 'rgba(255,69,0,0.10)',
            colorBorder: 'rgba(255,69,0,0.20)',
            gradient: 'linear-gradient(135deg, rgba(255,69,0,0.08) 0%, rgba(255,69,0,0.02) 100%)',
            steps: [
              { title: 'Pick a subreddit', detail: 'Search your niche — r/entrepreneur, r/investing, etc. Target 10k+ member subs with active daily threads. Read the rules before posting; many ban all promotion.' },
              { title: 'Write a real title', detail: 'Frame a genuine question or insight, not a product pitch. Curiosity and controversy outperform announcements.' },
              { title: 'Paste & clean the draft', detail: 'Remove anything that reads like an ad before submitting. If it sounds promotional to you, it will to moderators too.' },
              { title: 'Engage in the first hour', detail: 'Reply to every comment — early engagement determines ranking. Set a reminder to check back 30 minutes after posting.' },
            ],
            disclosure: 'Add "Disclosure: I work at [Brand]" at the end of your post.',
            tip: 'Redditors check your post history. An account with only brand content will get flagged. Mix in genuine community participation.',
          },
          quora: {
            label: 'Quora',
            subtitle: 'Q&A answers',
            iconKey: 'quora',
            color: '#b92b27',
            colorMuted: 'rgba(185,43,39,0.10)',
            colorBorder: 'rgba(185,43,39,0.20)',
            gradient: 'linear-gradient(135deg, rgba(185,43,39,0.08) 0%, rgba(185,43,39,0.02) 100%)',
            steps: [
              { title: 'Find the right question', detail: 'Search with the exact phrasing of your tracked prompts. Favor questions with 1k+ views and fewer than 5 existing answers.' },
              { title: 'Lead with the answer', detail: "State your main point in the first sentence — don't bury the takeaway. Quora buries answers that take too long to get to the point." },
              { title: 'Use structure', detail: 'Short paragraphs and bold sub-headers make answers scannable and rank better in search.' },
              { title: 'Mention your brand in context', detail: 'Never as the opening line. Weave it in naturally where it genuinely adds value to the reader.' },
            ],
            disclosure: 'Add "I\'m on the team at [Brand]" in your Quora bio and in the answer itself.',
            tip: 'Answers posted within the first 24 hours of a question get 5-10x more views. Set alerts for new questions in your space.',
          },
          medium: {
            label: 'Medium',
            subtitle: 'Long-form articles',
            iconKey: 'medium',
            color: '#94a3b8',
            colorMuted: 'rgba(148,163,184,0.10)',
            colorBorder: 'rgba(148,163,184,0.18)',
            gradient: 'linear-gradient(135deg, rgba(148,163,184,0.06) 0%, rgba(148,163,184,0.01) 100%)',
            steps: [
              { title: 'Open a new story', detail: 'Go to medium.com/new-story and paste your draft. Clean up any formatting artifacts from the copy-paste.' },
              { title: 'Title & subtitle', detail: 'Both appear in search results — make them specific and search-friendly. Avoid vague headlines like "Lessons I Learned."' },
              { title: 'Header image', detail: 'Add a relevant image from Unsplash (free, no attribution needed). Articles with images get significantly more clicks.' },
              { title: 'Tags', detail: 'Add up to 5 specific tags, e.g. "Startup", "AI", "SaaS". Tags determine which readers see your story.' },
              { title: 'Pitch a publication', detail: 'Submitting to a publication multiplies your reach significantly. Look for publications with 10k+ followers in your niche.' },
            ],
            disclosure: null,
            tip: 'Publish on Tuesday–Thursday mornings for the highest engagement. Articles over 1,500 words perform best on Medium.',
          },
          wikipedia: {
            label: 'Wikipedia',
            subtitle: 'Article edits — handle with care',
            iconKey: 'wikipedia',
            color: '#64748b',
            colorMuted: 'rgba(100,116,139,0.10)',
            colorBorder: 'rgba(100,116,139,0.20)',
            gradient: 'linear-gradient(135deg, rgba(100,116,139,0.06) 0%, rgba(100,116,139,0.01) 100%)',
            steps: [
              { title: 'Declare your COI first', detail: 'On your user talk page, add the {{connected contributor}} template before doing anything else. Skipping this can get you permanently banned.' },
              { title: 'Propose on the Talk page', detail: "Open the article's Talk tab and post your suggested addition with sources. Do not self-publish COI edits directly — this violates policy." },
              { title: 'Wait for review', detail: 'A volunteer editor will review and merge (or decline) your suggestion. This can take days to weeks — do not bump or re-submit.' },
              { title: 'Iterate if declined', detail: 'Ask for specific feedback, revise with better sources, and re-submit. Patience is essential; editors respond poorly to pressure.' },
            ],
            disclosure: null,
            tip: 'Only cite secondary sources (news articles, reviews). Primary sources (your own website) are flagged as promotional by editors.',
          },
        } as const;

        const p = PLATFORMS[postingPlatform];

        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div
              className="absolute inset-0 bg-black/75 backdrop-blur-sm cursor-pointer"
              onClick={() => setPostingGuideOpen(false)}
            />
            <div className="relative w-full max-w-xl max-h-[88vh] flex flex-col bg-[rgba(8,12,20,0.98)] border border-[var(--border-subtle)] rounded-2xl shadow-[0_24px_80px_rgba(0,0,0,0.70),0_0_0_1px_rgba(95,126,166,0.08)] overflow-hidden">

              {/* Header with platform-colored accent line */}
              <div className="shrink-0" style={{ borderBottom: `1px solid rgba(255,255,255,0.06)` }}>
                <div className="h-[2px] w-full opacity-60" style={{ background: `linear-gradient(90deg, transparent 0%, ${p.color} 50%, transparent 100%)` }} />
                <div className="flex items-center justify-between px-6 pt-4 pb-3">
                  <div className="flex items-center gap-2.5">
                    <div className="w-8 h-8 rounded-xl flex items-center justify-center" style={{ background: p.colorMuted, border: `1px solid ${p.colorBorder}` }}>
                      <BookOpen size={15} style={{ color: p.color }} />
                    </div>
                    <div>
                      <h2 className="text-[15px] font-semibold text-[var(--text-primary)] leading-none">Posting Guide</h2>
                      <p className="text-[11px] text-[var(--text-faint)] mt-0.5">Step-by-step for each platform</p>
                    </div>
                  </div>
                  <button
                    onClick={() => setPostingGuideOpen(false)}
                    aria-label="Close"
                    className="w-7 h-7 rounded-lg flex items-center justify-center text-[var(--text-faint)] hover:text-[var(--text-secondary)] hover:bg-[rgba(255,255,255,0.06)] transition-[color,background-color]"
                  >
                    <X size={14} />
                  </button>
                </div>

                {/* Platform tabs */}
                <div className="px-6 pb-3">
                  <div className="flex gap-1 p-1 bg-[rgba(255,255,255,0.025)] border border-[rgba(255,255,255,0.06)] rounded-xl">
                    {(['reddit', 'quora', 'medium', 'wikipedia'] as const).map((key) => {
                      const active = postingPlatform === key;
                      const pl = PLATFORMS[key];
                      return (
                        <button
                          key={key}
                          onClick={() => setPostingPlatform(key)}
                          className="flex-1 flex items-center justify-center gap-1.5 py-2 px-2 rounded-lg text-xs font-medium transition-[color,background-color] duration-200"
                          style={{
                            background: active ? pl.colorMuted : 'transparent',
                            color: active ? pl.color : 'var(--text-faint)',
                            border: active ? `1px solid ${pl.colorBorder}` : '1px solid transparent',
                            boxShadow: active ? `0 0 12px ${pl.colorMuted}` : 'none',
                          }}
                        >
                          <PlatformIcon platform={key} size={12} color={active ? pl.color : 'var(--text-faint)'} />
                          {pl.label}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>

              {/* Scrollable body */}
              <div className="flex-1 overflow-y-auto px-6 py-5 space-y-3">

                {/* Platform hero */}
                <div className="flex items-center justify-between gap-3 mb-2 p-4 rounded-xl" style={{ background: p.gradient }}>
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0" style={{ background: p.colorMuted, border: `1px solid ${p.colorBorder}` }}>
                      <PlatformIcon platform={p.iconKey} size={18} color={p.color} />
                    </div>
                    <div>
                      <p className="text-[15px] font-semibold text-[var(--text-primary)]">{p.label}</p>
                      <p className="text-xs text-[var(--text-muted)]">{p.subtitle}</p>
                    </div>
                  </div>
                  {postingPlatform === 'medium' && (
                    <a
                      href="https://medium.com/new-story"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-1.5 hover:bg-[rgba(148,163,184,0.14)] border border-[rgba(148,163,184,0.18)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] rounded-lg px-3 py-1.5 text-xs font-medium transition-[color,background-color] shrink-0"
                    >
                      Open Medium
                      <ExternalLink size={11} />
                    </a>
                  )}
                </div>

                {/* Steps — with connected timeline */}
                <div className="relative">
                  {/* Vertical connector line */}
                  <div
                    className="absolute left-[19px] top-[28px] w-px"
                    style={{
                      height: `calc(100% - 56px)`,
                      background: `linear-gradient(180deg, ${p.colorBorder} 0%, transparent 100%)`,
                    }}
                  />

                  {p.steps.map((step, i) => (
                    <div
                      key={step.title}
                      className="group relative flex gap-4 p-3.5 pl-0 rounded-xl cursor-default"
                    >
                      {/* Step number */}
                      <div className="relative z-10 shrink-0 ml-1">
                        <div
                          className="w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-bold ring-[3px] ring-[rgba(8,12,20,0.98)] transition-transform group-hover:scale-110"
                          style={{
                            background: p.colorMuted,
                            border: `1.5px solid ${p.colorBorder}`,
                            color: p.color,
                          }}
                        >
                          {i + 1}
                        </div>
                      </div>
                      {/* Content */}
                      <div className="min-w-0 flex-1 pb-2">
                        <p className="text-sm font-medium text-[var(--text-primary)] mb-1 group-hover:text-white transition-colors">{step.title}</p>
                        <p className="text-[12.5px] text-[var(--text-muted)] leading-[1.6]">{step.detail}</p>
                      </div>
                    </div>
                  ))}
                </div>

                {/* Wikipedia accept/reject grid */}
                {postingPlatform === 'wikipedia' && (
                  <div className="grid grid-cols-2 gap-3 mt-1">
                    <div className="bg-[rgba(16,185,129,0.04)] border border-[rgba(16,185,129,0.14)] rounded-xl px-4 py-3">
                      <p className="text-xs text-[var(--success)] font-semibold mb-2.5 flex items-center gap-1.5">
                        <CheckCircle2 size={13} className="text-[var(--success)]" />
                        Editors accept
                      </p>
                      <div className="space-y-2">
                        {['Neutral, factual statements', 'Properly cited sources', 'Brand as one of several examples', 'Correcting factual errors'].map((t) => (
                          <div key={t} className="flex items-start gap-2">
                            <span className="text-[var(--success)] text-[10px] mt-0.5 shrink-0" aria-hidden="true">✓</span>
                            <span className="text-[11px] text-[var(--text-muted)] leading-snug">{t}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                    <div className="bg-[rgba(239,68,68,0.04)] border border-[rgba(239,68,68,0.14)] rounded-xl px-4 py-3">
                      <p className="text-xs text-[var(--danger)] font-semibold mb-2.5 flex items-center gap-1.5">
                        <X size={13} className="text-[var(--danger)]" />
                        Editors reject
                      </p>
                      <div className="space-y-2">
                        {['Promotional language', 'Uncited claims', 'Brand article without notability', 'Removing competitors'].map((t) => (
                          <div key={t} className="flex items-start gap-2">
                            <span className="text-[var(--danger)] text-[10px] mt-0.5 shrink-0" aria-hidden="true">✗</span>
                            <span className="text-[11px] text-[var(--text-muted)] leading-snug">{t}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                )}

                {/* Disclosure — only for platforms that require it */}
                {p.disclosure && (
                  <div className="flex items-start gap-3 p-4 rounded-xl border" style={{ background: 'rgba(251,191,36,0.04)', borderColor: 'rgba(251,191,36,0.16)' }}>
                    <div className="shrink-0 w-6 h-6 rounded-full flex items-center justify-center mt-0.5" style={{ background: 'rgba(251,191,36,0.12)', border: '1px solid rgba(251,191,36,0.25)' }}>
                      <Shield size={12} className="text-yellow-400" />
                    </div>
                    <div>
                      <p className="text-xs font-semibold text-yellow-300 mb-1">Required disclosure</p>
                      <p className="text-[12.5px] text-[var(--text-muted)] leading-relaxed">{p.disclosure}</p>
                    </div>
                  </div>
                )}

                {/* Pro tip */}
                {p.tip && (
                  <div className="flex items-start gap-3 p-4 rounded-xl bg-[rgba(95,126,166,0.04)] border border-[rgba(95,126,166,0.12)]">
                    <div className="shrink-0 w-6 h-6 rounded-full bg-[rgba(95,126,166,0.12)] border border-[rgba(95,126,166,0.22)] flex items-center justify-center mt-0.5">
                      <Lightbulb size={12} className="text-[var(--accent-foreground)]" />
                    </div>
                    <div>
                      <p className="text-xs font-semibold text-[var(--accent-foreground)] mb-1">Pro tip</p>
                      <p className="text-[12.5px] text-[var(--text-muted)] leading-relaxed">{p.tip}</p>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        );
      })()}

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-6">
        <div className="flex items-center gap-2">
          <div>
            <h1 className="text-xl sm:text-2xl font-bold text-[var(--text-primary)]">Content Hub</h1>
            <p className="text-[13px] text-[var(--text-muted)] mt-1.5">
              AI-powered content for every platform
            </p>
          </div>
          <button
            onClick={() => setHubHelpOpen(true)}
            aria-label="How does Content Hub work?"
            className="text-[var(--text-faint)] hover:text-[var(--accent)] transition-colors mt-1 ml-1"
            title="How does Content Hub work?"
          >
            <HelpCircle size={16} />
          </button>
        </div>

        <div className="flex items-center gap-3">
          {/* Posting Guide button */}
          <button
            onClick={() => setPostingGuideOpen(true)}
            className="flex items-center gap-1.5 text-sm bg-[rgba(255,255,255,0.06)] hover:bg-[rgba(255,255,255,0.10)] border border-[rgba(255,255,255,0.10)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] rounded-lg px-3 py-2 transition-[color,background-color] duration-150"
          >
            <BookOpen size={14} />
            Posting Guide
          </button>

        </div>
      </div>

      {!brandsLoading && brands.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-24 text-center">
          <div className="w-14 h-14 bg-[rgba(95,126,166,0.08)] border border-[var(--border-subtle)] rounded-2xl flex items-center justify-center mb-4">
            <PenLine size={24} className="text-[var(--accent)]" />
          </div>
          <h3 className="text-base font-semibold text-[var(--text-primary)] mb-2">No brands tracked yet</h3>
          <p className="text-sm text-[var(--text-muted)] max-w-sm mb-6">Add your first brand to start generating content drafts and finding opportunities.</p>
          <Link
            href="/onboarding"
            className="flex items-center gap-2 bg-[rgba(95,126,166,0.15)] hover:bg-[rgba(95,126,166,0.22)] border border-[rgba(95,126,166,0.30)] hover:border-[rgba(95,126,166,0.45)] text-[var(--accent-foreground)] hover:text-[var(--text-primary)] hover:shadow-[0_0_24px_rgba(95,126,166,0.18)] rounded-lg px-4 py-2 text-sm font-medium transition-colors"
          >
            <Plus size={16} />
            Track Your First Brand
          </Link>
        </div>
      ) : loading ? (
        <div className="animate-pulse space-y-4">
          <div className="h-10 card" />
          <div className="h-48 card" />
          <div className="h-48 card" />
        </div>
      ) : (
        <div className="flex flex-col md:flex-row gap-6">
          {/* ── Left panel (70%) — Content Queue ────────────────────────────── */}
          <div className="flex-1 min-w-0">
            {/* Primary tab bar */}
            <div className="flex gap-1 mb-3 overflow-x-auto" style={{ scrollbarWidth: 'none' }}>
              {PRIMARY_TABS.map((tab) => (
                <button
                  key={tab.key}
                  onClick={() => {
                    setActivePrimaryTab(tab.key);
                    if (tab.key === 'content_drafts') setActiveSubTab('queue');
                  }}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-[color,background-color,border-color] ${
                    activePrimaryTab === tab.key
                      ? 'bg-[rgba(95,126,166,0.18)] text-[var(--accent-foreground)] border border-[rgba(95,126,166,0.30)] shadow-[0_0_14px_rgba(95,126,166,0.14)]'
                      : 'text-[var(--text-faint)] bg-transparent border border-transparent hover:text-[var(--text-muted)]'
                  }`}
                >
                  {tab.label}
                  {primaryTabCounts[tab.key] > 0 && (
                    <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${
                      activePrimaryTab === tab.key
                        ? 'bg-[rgba(95,126,166,0.25)] text-[var(--accent-foreground)]'
                        : 'bg-[rgba(255,255,255,0.08)] text-[var(--text-faint)]'
                    }`}>
                      {primaryTabCounts[tab.key]}
                    </span>
                  )}
                </button>
              ))}
            </div>

            {/* Sub-tabs for Content Drafts */}
            {activePrimaryTab === 'content_drafts' && (
              <div className="flex gap-1 mb-5 pl-0.5">
                {([
                  { key: 'queue' as ContentDraftsSubTab, label: 'Queue', count: tabCounts.drafts },
                  { key: 'scheduled' as ContentDraftsSubTab, label: 'Saved', count: tabCounts.scheduled },
                ]).map((sub) => (
                  <button
                    key={sub.key}
                    onClick={() => setActiveSubTab(sub.key)}
                    className={`px-2.5 py-1 rounded-md text-xs font-medium transition-[color,background-color] ${
                      activeSubTab === sub.key
                        ? 'bg-[var(--bg-card)] text-[var(--text-primary)]'
                        : 'text-[var(--text-faint)] hover:text-[var(--text-secondary)]'
                    }`}
                  >
                    {sub.label}
                    {sub.count > 0 && (
                      <span className="text-[10px] ml-1 text-[var(--accent)]">{sub.count}</span>
                    )}
                  </button>
                ))}
              </div>
            )}

            {activePrimaryTab !== 'content_drafts' && <div className="mb-2" />}

            {/* Tab content */}
            <ContentTabPanels
              activeTab={activeTab}
              brands={brands}
              selectedBrandId={selectedBrandId}
              draftItems={draftItems}
              setDraftItems={setDraftItems}
              visibleDraftItems={visibleDraftItems}
              scheduledItems={scheduledItems}
              visibleScheduledItems={visibleScheduledItems}
              postedItems={postedItems}
              visiblePostedItems={visiblePostedItems}
              draftAttributions={draftAttributions}
              opportunities={opportunities}
              visibleOpportunities={visibleOpportunities}
              brandProfile={brandProfile}
              brandPrompts={brandPrompts}
              draftPlatformFilter={draftPlatformFilter}
              setDraftPlatformFilter={setDraftPlatformFilter}
              oppPlatformFilter={oppPlatformFilter}
              setOppPlatformFilter={setOppPlatformFilter}
              _disabledPlatforms={_disabledPlatforms}
              draftStatus={draftStatus}
              generating={generating}
              reportRunning={reportRunning}
              pinnedDraftId={pinnedDraftId}
              handleGenerateNow={handleGenerateNow}
              handleApprove={handleApprove}
              handleApproveAll={handleApproveAll}
              handleDelete={handleDelete}
              handleSaved={handleSaved}
              handleMarkAsPosted={handleMarkAsPosted}
              handleMoveBackToDrafts={handleMoveBackToDrafts}
              handleDraftOpportunity={handleDraftOpportunity}
              handleDismissOpportunity={handleDismissOpportunity}
              onNavigateToQueueDraft={handleNavigateToQueueDraft}
              setOppHelpOpen={setOppHelpOpen}
              user={user}
              onRequestDraft={() => setRequestDraftOpen(true)}
              onOpenAttach={(draftId) => setAttachPopoverDraftId(draftId)}
              onOpenExplainer={() => setExplainerOpen(true)}
            />
          </div>

          {/* ── Right panel (30%) — Settings ─────────────────────────────────── */}
          <div className="w-full md:w-72 shrink-0 flex flex-col gap-4 md:pl-4 md:border-l md:border-[var(--border-subtle)]">
            {/* Generate now */}
            <div className="card p-5">
              {!user?.subscription_tier && !user?.is_admin ? (
                <div className="flex flex-col items-center text-center gap-3">
                  <div className="w-10 h-10 bg-[rgba(95,126,166,0.08)] border border-[var(--border-subtle)] rounded-xl flex items-center justify-center">
                    <Zap size={16} className="text-[var(--accent)]/50" />
                  </div>
                  <div>
                    <p className="text-sm font-medium text-[var(--text-secondary)]">On-demand drafts</p>
                    <p className="text-xs text-[var(--text-faint)] mt-1 leading-relaxed">Available on paid plans. Free includes up to 5 auto-generated drafts.</p>
                  </div>
                  <Link
                    href="/settings/billing"
                    className="w-full flex items-center justify-center gap-2 bg-[rgba(95,126,166,0.10)] hover:bg-[rgba(95,126,166,0.16)] border border-[rgba(95,126,166,0.25)] text-[var(--accent-foreground)] hover:text-[var(--accent-foreground)] rounded-lg px-4 py-2 text-sm font-semibold transition-colors duration-150"
                  >
                    Upgrade to unlock
                  </Link>
                </div>
              ) : (
                <>
                  {null}
                  {(() => {
                    const cooldownLabel = generateAvailableLabel(draftStatus?.next_generate_at ?? null);
                    const onCooldown = !!cooldownLabel;
                    // Weekly quota exhausted: remaining=0 AND no pending drafts to reclaim
                    const weeklyExhausted =
                      draftStatus?.weekly_drafts_remaining !== null &&
                      draftStatus?.weekly_drafts_remaining !== undefined &&
                      draftStatus.weekly_drafts_remaining === 0 &&
                      draftStatus.draft_count === 0;
                    return (
                      <>
                        {activePrimaryTab === 'opportunities' ? (
                        <>
                          <button
                            onClick={handleScanNow}
                            disabled={scanning || generating || !selectedBrandId || reportRunning}
                            className="w-full flex items-center justify-center gap-2 bg-[var(--accent)] hover:bg-[var(--accent-hover)] disabled:opacity-40 disabled:cursor-not-allowed text-white rounded-lg px-5 py-2.5 text-sm font-medium transition-colors duration-150"
                          >
                            {scanning ? (
                              <>
                                <Loader2 size={14} className="animate-spin" />
                                Scanning…
                              </>
                            ) : (
                              <>
                                <RefreshCw size={14} />
                                Regenerate Visibility Opportunities
                              </>
                            )}
                          </button>
                          <p className="text-xs text-[var(--text-faint)] mt-2 text-center">
                            {scanning ? 'Scanning for new opportunities…' : 'Replaces all opportunities with a fresh scan'}
                          </p>
                        </>
                      ) : (
                        <>
                          <button
                            onClick={handleGenerateNow}
                            disabled={generating || scanning || onCooldown || weeklyExhausted || reportRunning}
                            className="w-full flex items-center justify-center gap-2 bg-[var(--accent)] hover:bg-[var(--accent-hover)] disabled:opacity-40 disabled:cursor-not-allowed text-white rounded-lg px-5 py-2.5 text-sm font-medium transition-colors duration-150"
                          >
                            {generating ? (
                              <>
                                <Loader2 size={14} className="animate-spin" />
                                Generating…
                              </>
                            ) : (
                              <>
                                <Zap size={14} />
                                Regenerate Drafts
                              </>
                            )}
                          </button>
                          {onCooldown ? (
                            <p className="flex items-center justify-center gap-1.5 text-xs text-[var(--text-secondary)] mt-2">
                              <Clock size={11} className="shrink-0" />
                              {cooldownLabel}
                            </p>
                          ) : weeklyExhausted ? (
                            <p className="text-xs text-[var(--danger)] mt-2 text-center">
                              Weekly draft limit reached ({draftStatus?.weekly_drafts_limit}/{draftStatus?.weekly_drafts_limit}). Resets in 7 days.
                            </p>
                          ) : (
                            <p className="text-xs text-[var(--text-faint)] mt-2 text-center">
                              {generating ? 'This takes ~20 seconds — drafts will all appear when ready' : draftStatus?.weekly_drafts_limit != null ? `Replaces all unapproved drafts · ${draftStatus.weekly_drafts_remaining}/${draftStatus.weekly_drafts_limit} weekly` : draftStatus?.draft_cap != null ? `Replaces all unapproved drafts · Approve any you want to keep first` : 'Replaces all unapproved drafts · Approve any you want to keep first'}
                            </p>
                          )}
                        </>
                      )}
                        {generateError && (
                          <div className="mt-2 bg-[#7f1d1d]/15 border border-[#991b1b]/30 rounded-lg px-3 py-2">
                            <p className="text-xs text-[var(--danger)] leading-relaxed">{generateError}</p>
                          </div>
                        )}
                      </>
                    );
                  })()}
                </>
              )}
            </div>

            {/* Queue stats */}
            <div className="card p-5">
              <div className="space-y-3">
                {draftStatus ? (
                  <>
                    {([
                      { label: 'Drafts', count: draftStatus.draft_count, cap: draftStatus.draft_cap },
                      { label: 'Saved', count: draftStatus.scheduled_count, cap: draftStatus.scheduled_cap },
                    ] as Array<{ label: string; count: number; cap: number }>).map(({ label, count, cap }) => {
                      const pct = cap > 0 ? count / cap : 0;
                      const barColor = 'var(--accent)';
                      const textColor = 'var(--text-secondary)';
                      return (
                        <div key={label}>
                          <div className="flex items-center justify-between mb-1">
                            <span className="text-xs text-[var(--text-muted)]">{label}</span>
                            <span className="text-xs font-semibold font-mono tabular-nums" style={{ color: textColor }}>
                              {count}/{cap}
                            </span>
                          </div>
                          <div className="h-1 bg-[rgba(255,255,255,0.06)] rounded-full overflow-hidden">
                            <div
                              className="h-full rounded-full transition-[width] duration-500"
                              style={{ width: `${Math.min(pct * 100, 100)}%`, backgroundColor: barColor }}
                            />
                          </div>
                        </div>
                      );
                    })}
                    {draftStatus.show_upgrade && (
                      <Link
                        href="/settings/billing"
                        className="flex items-center justify-center gap-1.5 text-[11px] text-[var(--accent)] hover:text-[var(--accent-hover)] transition-colors mt-1"
                      >
                        <Zap size={11} />
                        Upgrade for more
                      </Link>
                    )}
                  </>
                ) : (
                  <div className="space-y-3 animate-pulse">
                    <div className="h-8 bg-[rgba(95,126,166,0.06)] rounded" />
                    <div className="h-8 bg-[rgba(95,126,166,0.06)] rounded" />
                  </div>
                )}
                {draftStatus?.last_scan_at && (
                  <div className="border-t border-[rgba(255,255,255,0.06)] pt-2.5">
                    <p className="text-[11px] text-[var(--text-faint)] text-center">
                      Last opportunity scan: {relativeTime(draftStatus.last_scan_at)}
                    </p>
                  </div>
                )}
              </div>
            </div>

            {/* Platform toggles */}
            <div className="card p-5">
              <p className="text-[11px] font-semibold text-[var(--text-muted)] uppercase tracking-wide mb-3">Platforms</p>
              <div className="space-y-1">
                {([
                  { key: 'reddit', color: '#ff4500', paidOnly: false },
                  { key: 'quora', color: '#b92b27', paidOnly: false },
                  { key: 'medium', color: '#94a3b8', paidOnly: false },
                  { key: 'wikipedia', color: '#64748b', paidOnly: false },
                  { key: 'linkedin', color: '#0a66c2', paidOnly: true },
                  { key: 'x', color: '#94a3b8', paidOnly: true },
                ] as const).filter(({ key }) => {
                  if (activePrimaryTab === 'opportunities') return key !== 'medium' && key !== 'wikipedia';
                  return true;
                }).map(({ key, color, paidOnly }) => {
                  const isLocked = paidOnly && !user?.subscription_tier && !user?.is_admin;
                  const enabled = !_disabledPlatforms.has(key);
                  return (
                    <button
                      key={key}
                      onClick={() => {
                        if (isLocked) {
                          setUpgradeModalReason(`${PLATFORM_DISPLAY[key] ?? key} scanning and drafting requires a paid plan.`);
                          setUpgradeModalOpen(true);
                          return;
                        }
                        handleTogglePlatform(key);
                      }}
                      className={`w-full flex items-center justify-between py-2.5 px-3 -mx-3 rounded-lg transition-colors duration-200 group ${
                        isLocked ? 'opacity-50 cursor-not-allowed' : 'hover:bg-[rgba(255,255,255,0.03)]'
                      }`}
                      title={isLocked ? `${PLATFORM_DISPLAY[key] ?? key} requires a paid plan` : enabled ? `Hide ${PLATFORM_DISPLAY[key] ?? key}` : `Show ${PLATFORM_DISPLAY[key] ?? key}`}
                      aria-label={isLocked ? `${PLATFORM_DISPLAY[key] ?? key} requires a paid plan` : enabled ? `Hide ${PLATFORM_DISPLAY[key] ?? key}` : `Show ${PLATFORM_DISPLAY[key] ?? key}`}
                    >
                      <div className="flex items-center gap-2.5">
                        <div
                          className="w-6 h-6 rounded-md flex items-center justify-center transition-[background-color,border-color] duration-200"
                          style={{
                            background: enabled && !isLocked ? `${color}15` : 'rgba(255,255,255,0.04)',
                            border: `1px solid ${enabled && !isLocked ? `${color}30` : 'rgba(255,255,255,0.06)'}`,
                          }}
                        >
                          <PlatformIcon platform={key} size={14} color={enabled && !isLocked ? color : 'var(--text-faint)'} />
                        </div>
                        <span className={`text-[13px] font-medium transition-colors duration-200 ${enabled && !isLocked ? 'text-[var(--text-secondary)]' : 'text-[var(--text-faint)]'}`}>
                          {PLATFORM_DISPLAY[key] ?? key}
                        </span>
                        {isLocked && (
                          <span className="text-[9px] bg-[rgba(95,126,166,0.2)] text-[var(--accent)] px-1.5 py-0.5 rounded-full font-semibold">UPGRADE</span>
                        )}
                      </div>
                      {/* Custom toggle switch */}
                      <div
                        className="relative w-8 h-[18px] rounded-full transition-[background-color,box-shadow] duration-200 shrink-0"
                        style={{
                          background: enabled && !isLocked ? 'var(--accent)' : 'rgba(255,255,255,0.10)',
                          boxShadow: enabled && !isLocked ? '0 0 8px rgba(95,126,166,0.3)' : 'none',
                        }}
                      >
                        <div
                          className="absolute top-[2px] w-[14px] h-[14px] rounded-full bg-white shadow-sm transition-[left] duration-200"
                          style={{ left: enabled && !isLocked ? '14px' : '2px' }}
                        />
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      )}
      {toast && <AppToast {...toast} onDismiss={() => setToast(null)} />}

      {/* Upgrade modal — shown when pitch user tries to draft opportunity */}
      <Dialog open={upgradeModalOpen} onOpenChange={(o) => !o && setUpgradeModalOpen(false)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <Zap size={20} className="text-[var(--accent)] mb-1" />
            <DialogTitle>Upgrade to Draft Opportunities</DialogTitle>
          </DialogHeader>
          <p className="text-xs text-[var(--text-muted)]">{upgradeModalReason}</p>
          <DialogFooter className="mt-4">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setUpgradeModalOpen(false)}
              className="flex-1"
            >
              Dismiss
            </Button>
            <Button
              asChild
              size="sm"
              variant="default"
              className="flex-1"
            >
              <Link href="/settings/billing">View plans</Link>
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </motion.div>
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
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <div className="w-16 h-16 rounded-2xl bg-[rgba(95,126,166,0.08)] border border-[rgba(95,126,166,0.16)] flex items-center justify-center mb-4">
        {icon}
      </div>
      <p className="text-[15px] font-semibold text-[var(--text-primary)] mb-2">{title}</p>
      <p className="text-[13px] text-[var(--text-muted)] mb-6 max-w-xs leading-relaxed">{description}</p>
      {action}
    </div>
  );
}
