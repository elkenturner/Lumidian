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
  Trash2,
  Edit2,
  BarChart2,
  AlertTriangle,
  RefreshCw,
  Sparkles,
  HelpCircle,
  Copy,
  Check,
  PenLine,
  BookOpen,
} from 'lucide-react';
import {
  getBrands,
  getBrand,
  getDrafts,
  updateDraft,
  deleteDraft,
  generateDraft,
  getOpportunities,
  dismissOpportunity,
  draftOpportunity,
  generateNow,
  getDraftStatus,
  triggerScan,
  getBrandProfile,
  getContentSettings,
  Brand,
  BrandDetail,
  Prompt,
  ContentDraft,
  ContentOpportunity,
  BrandProfile,
  BrandContentSettings,
  DraftQueueStatus,
} from '@/lib/api';
import PlatformBadge from '@/components/PlatformBadge';
import { formatDistanceToNow, parseISO } from 'date-fns';

// ── Types ─────────────────────────────────────────────────────────────────────

type QueueTab = 'drafts' | 'scheduled' | 'opportunities' | 'posted';

// ── Helpers ───────────────────────────────────────────────────────────────────

function relativeTime(iso: string | null): string {
  if (!iso) return 'Unknown';
  try {
    return formatDistanceToNow(parseISO(iso), { addSuffix: true });
  } catch {
    return iso;
  }
}

// ── Urgency scoring ───────────────────────────────────────────────────────────

function computeUrgency(
  draft: ContentDraft,
  postedItems: ContentDraft[],
): { score: number; level: 'High' | 'Medium' | 'Low' } {
  // Visibility component (70%): lower visibility → higher urgency
  const vis = draft.visibility_score_at_draft;
  const visUrgency = vis != null ? 100 - vis : 50;

  // Recency component (30%): days since this prompt last had content posted
  // If unknown, treat as 30 days. Cap at 60 days for normalisation.
  let daysSinceLast = 30;
  if (draft.prompt_id != null) {
    const promptPosts = postedItems.filter((p) => p.prompt_id === draft.prompt_id);
    if (promptPosts.length > 0) {
      const latest = promptPosts.reduce((best, p) => {
        const dt = p.posted_at ?? p.updated_at;
        const bestDt = best.posted_at ?? best.updated_at;
        return dt > bestDt ? p : best;
      });
      const dt = latest.posted_at ?? latest.updated_at;
      if (dt) {
        daysSinceLast = Math.max(0, (Date.now() - parseISO(dt).getTime()) / 86_400_000);
      }
    }
  }
  const recencyUrgency = Math.min(daysSinceLast / 60, 1) * 100;

  const score = visUrgency * 0.7 + recencyUrgency * 0.3;
  const level: 'High' | 'Medium' | 'Low' = score >= 60 ? 'High' : score >= 30 ? 'Medium' : 'Low';
  return { score, level };
}

const URGENCY_STYLES = {
  High:   { dot: 'bg-[#ef4444]', text: 'text-[#ef4444]', border: 'border-l-[#ef4444]/60' },
  Medium: { dot: 'bg-[#f59e0b]', text: 'text-[#f59e0b]', border: 'border-l-[#f59e0b]/40' },
  Low:    { dot: 'bg-[#10b981]', text: 'text-[#10b981]', border: 'border-l-transparent' },
};

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
      <div className="relative bg-[rgba(10,14,24,0.96)] backdrop-blur-xl border border-[rgba(255,255,255,0.12)] rounded-2xl p-6 max-w-md w-full shadow-2xl">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-base font-semibold text-[#F0F4F8]">{title}</h3>
          <button onClick={onClose} className="text-[#475569] hover:text-[#94A3B8] transition-colors">
            <X size={16} />
          </button>
        </div>
        <div className="text-sm text-[#94A3B8] leading-relaxed space-y-3">{children}</div>
      </div>
    </div>
  );
}

// ── Draft quality checklist ───────────────────────────────────────────────────

const HEDGING_PHRASES = [
  'it is worth noting', 'it should be noted', 'it is important to note',
  'it is crucial to', 'needless to say', 'as we all know',
  'it goes without saying', 'in conclusion', 'to summarize',
  'in summary', 'overall,', 'ultimately,',
];

// passed: true = pass, 'warning' = soft warning (counts as passed), false = hard fail
interface QualityCheck {
  label: string;
  passed: boolean | 'warning';
  detail?: string;
}

function runQualityChecks(
  draft: ContentDraft,
  profile: BrandProfile | null,
  brandName: string,
): QualityCheck[] {
  const text = draft.content_text;
  const lower = text.toLowerCase();
  const wordCount = text.trim().split(/\s+/).filter(Boolean).length;
  const platform = draft.platform;
  // Reddit reply = generated from a Reddit opportunity (thread reply, not standalone post)
  const isRedditReply = platform === 'reddit' && draft.opportunity_id != null;

  // ── Wikipedia-specific checks ──────────────────────────────────────────────
  if (platform === 'wikipedia') {
    const PROMO_WORDS = [
      'best', 'leading', 'top', 'premier', 'world-class', 'revolutionary',
      'groundbreaking', 'cutting-edge', 'innovative', 'unmatched', 'unrivaled',
      'superior', 'excellence', 'exceptional', 'outstanding',
    ];
    const SUPERLATIVES = ['most', 'fastest', 'largest', 'biggest', 'greatest', 'first-ever'];
    const MARKETING_PHRASES = [
      'we are proud', 'proud to', 'pleased to announce', 'excited to', 'thrilled to',
      'game-changer', 'game changer', 'disruptive', 'disrupting the', 'transform your',
    ];

    const promoFound = PROMO_WORDS.find((w) => lower.includes(w));
    const supFound = SUPERLATIVES.find((w) => lower.includes(w));
    const marketingFound = MARKETING_PHRASES.find((p) => lower.includes(p));
    const hasPromoBias = promoFound || supFound || marketingFound;

    const hasCitation = /\[\d+\]|\{\{cite|<ref|https?:\/\//.test(text);

    const inLengthRange = wordCount >= 50 && wordCount <= 300;

    return [
      {
        label: 'Neutral encyclopedic tone',
        passed: !hasPromoBias,
        detail: hasPromoBias
          ? `Promotional language detected: "${promoFound ?? supFound ?? marketingFound}"`
          : undefined,
      },
      {
        label: 'Citation included',
        passed: hasCitation,
        detail: !hasCitation ? 'Add a citation or source URL' : undefined,
      },
      {
        label: 'No superlatives or marketing claims',
        passed: !supFound && !marketingFound,
        detail: supFound ? `Superlative detected: "${supFound}"` : marketingFound ? `Marketing phrase: "${marketingFound}"` : undefined,
      },
      {
        label: `Appropriate length (50–300 words, currently ${wordCount})`,
        passed: inLengthRange,
        detail: !inLengthRange
          ? wordCount < 50 ? 'Too short for a meaningful Wikipedia addition' : 'May be too long — consider splitting'
          : undefined,
      },
      {
        // COI reminder — always shows as a soft warning regardless of content
        label: 'COI reminder: disclose your conflict of interest on the talk page before editing',
        passed: 'warning',
      },
    ];
  }

  // ── Generic checks (Reddit, Quora, Medium) ─────────────────────────────────
  const checks: QualityCheck[] = [];

  // 1. No prohibited phrases — compare against Brand Profile "What NOT to Say" (case-insensitive)
  if (profile && profile.what_not_to_say.length > 0) {
    const found = profile.what_not_to_say
      .map((p) => p.trim())
      .filter((p) => p && lower.includes(p.toLowerCase()));
    checks.push({
      label: 'No prohibited phrases',
      passed: found.length === 0,
      detail: found.length > 0 ? `Found: "${found[0]}"` : undefined,
    });
  } else {
    checks.push({ label: 'No prohibited phrases', passed: true });
  }

  // 2. Only approved statistics
  if (profile && profile.key_stats.length > 0) {
    const textNums = text.match(/\d+(?:[.,]\d+)?%/g) ?? [];
    const unapproved = textNums.filter((n) => !profile.key_stats.some((s) => s.includes(n)));
    checks.push({
      label: 'Only approved statistics',
      passed: unapproved.length === 0,
      detail: unapproved.length > 0 ? `Unverified stat: ${unapproved[0]}` : undefined,
    });
  } else {
    checks.push({ label: 'Only approved statistics', passed: true });
  }

  // 3. No hedging phrases (em dash enforcement is handled at generation time)
  const hedgingFound = HEDGING_PHRASES.find((p) => lower.includes(p));
  checks.push({
    label: 'No hedging phrases',
    passed: !hedgingFound,
    detail: hedgingFound ? `Contains: "${hedgingFound}"` : undefined,
  });

  // 4. Brand mention — platform-aware
  if (isRedditReply) {
    checks.push({ label: 'Brand mention', passed: true, detail: 'Optional for Reddit replies' });
  } else if (brandName) {
    const escaped = brandName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const occurrences = (lower.match(new RegExp(escaped, 'gi')) ?? []).length;
    const tooMany = occurrences > 4;

    if (platform === 'medium') {
      checks.push({
        label: 'Brand mentioned',
        passed: occurrences === 0 ? false : tooMany ? 'warning' : true,
        detail: occurrences === 0
          ? 'Brand not mentioned (required for Medium)'
          : tooMany ? `Mentioned ${occurrences}× (may feel forced)` : undefined,
      });
    } else {
      checks.push({
        label: 'Brand mentioned',
        passed: occurrences === 0 ? 'warning' : tooMany ? 'warning' : true,
        detail: occurrences === 0
          ? 'Brand not mentioned (recommended)'
          : tooMany ? `Mentioned ${occurrences}× (may feel forced)` : undefined,
      });
    }
  } else {
    checks.push({ label: 'Brand mentioned', passed: true });
  }

  // 5. Word count — platform and context aware
  type Limits = [number, number, string];
  const WORD_LIMITS: Record<string, Limits> = {
    reddit: [150, 400, 'Reddit post'],
    quora:  [200, 500, 'Quora'],
    medium: [800, 2000, 'Medium'],
  };
  const [minWords, maxWords, platformLabel]: Limits = isRedditReply
    ? [1, 100, 'Reddit reply']
    : WORD_LIMITS[platform] ?? [50, 500, platform];

  const inRange = wordCount >= minWords && wordCount <= maxWords;
  checks.push({
    label: `Word count (${minWords}–${maxWords} for ${platformLabel})`,
    passed: inRange,
    detail: !inRange ? `${wordCount} words` : undefined,
  });

  return checks;
}

function QualityChecklist({
  draft,
  profile,
  brandName,
  autoExpand = false,
  liveText,
}: {
  draft: ContentDraft;
  profile: BrandProfile | null;
  brandName: string;
  autoExpand?: boolean;
  liveText?: string;
}) {
  const [expanded, setExpanded] = useState(autoExpand);
  const effectiveDraft = liveText != null ? { ...draft, content_text: liveText } : draft;
  const checks = runQualityChecks(effectiveDraft, profile, brandName);
  const hardFails = checks.filter((c) => c.passed === false).length;
  const warnings = checks.filter((c) => c.passed === 'warning').length;
  const passed = checks.length - hardFails; // warnings count as passed
  const total = checks.length;
  const allPassed = hardFails === 0 && warnings === 0;
  const scoreColor = hardFails === 0 && warnings === 0
    ? 'text-[#10b981]'
    : hardFails === 0
    ? 'text-[#f59e0b]'
    : hardFails >= 2 ? 'text-[#ef4444]' : 'text-[#f59e0b]';

  return (
    <div className="border border-[rgba(255,255,255,0.10)] rounded-lg overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between px-3 py-2 bg-[rgba(255,255,255,0.08)] hover:bg-[rgba(255,255,255,0.06)] transition-colors"
      >
        <div className="flex items-center gap-2">
          <span className={`text-xs font-semibold ${scoreColor}`}>
            {passed}/{total} checks passed
          </span>
          {(hardFails > 0 || warnings > 0) && (
            <span className="text-[10px] text-[#64748B]">
              {hardFails > 0 && `${hardFails} fail${hardFails !== 1 ? 's' : ''}`}
              {hardFails > 0 && warnings > 0 && ', '}
              {warnings > 0 && `${warnings} warning${warnings !== 1 ? 's' : ''}`}
            </span>
          )}
        </div>
        <ChevronDown
          size={12}
          className={`text-[#475569] transition-transform ${expanded ? 'rotate-180' : ''}`}
        />
      </button>
      {expanded && (
        <div className="divide-y divide-[rgba(255,255,255,0.08)]">
          {checks.map((check, i) => {
            const icon = check.passed === true ? '✓' : check.passed === 'warning' ? '~' : '⚠';
            const iconColor = check.passed === true
              ? 'text-[#10b981]'
              : check.passed === 'warning'
              ? 'text-[#f59e0b]'
              : 'text-[#ef4444]';
            return (
              <div key={i} className="flex items-start gap-2.5 px-3 py-2">
                <span className={`text-xs mt-0.5 flex-shrink-0 font-bold ${iconColor}`}>{icon}</span>
                <div className="flex-1 min-w-0">
                  <span className="text-xs text-[#94A3B8]">{check.label}</span>
                  {check.detail && (
                    <span className="text-[10px] text-[#64748B] ml-2">{check.detail}</span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Draft card (Drafts tab) ───────────────────────────────────────────────────

function DraftCard({
  draft,
  profile,
  brandName,
  postedItems,
  onApprove,
  onDelete,
  onSaved,
}: {
  draft: ContentDraft;
  profile: BrandProfile | null;
  brandName: string;
  postedItems: ContentDraft[];
  onApprove: (id: number) => void;
  onDelete: (id: number) => void;
  onSaved: (d: ContentDraft) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [editTitle, setEditTitle] = useState(draft.title ?? '');
  const [editContent, setEditContent] = useState(draft.content_text);
  const [saving, setSaving] = useState(false);

  const urgency = computeUrgency(draft, postedItems);
  const ustyle = URGENCY_STYLES[urgency.level];

  // Quality score for border/prominence — based on hard fails only (warnings don't trigger red border)
  const qualityChecks = runQualityChecks(draft, profile, brandName);
  const isLowQuality = qualityChecks.filter((c) => c.passed === false).length >= 2;

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

  const borderClass = isLowQuality
    ? 'border-l-[3px] border-l-[#ef4444]/50 border-[rgba(255,255,255,0.12)]'
    : 'border-[rgba(255,255,255,0.12)]';

  return (
    <div className={`bg-[rgba(255,255,255,0.08)] backdrop-blur-md border rounded-xl p-5 flex flex-col gap-3 hover:border-[rgba(255,255,255,0.14)] shadow-[0_4px_24px_rgba(0,0,0,0.20)] transition-colors ${borderClass}`}>
      {/* Top row */}
      <div className="flex items-center gap-2 flex-wrap">
        <PlatformBadge platform={draft.platform} />
        {draft.visibility_score_at_draft != null && (
          <span
            className="text-xs text-[#64748B] flex items-center gap-1 cursor-help"
            title="How often your brand appears in AI responses for this prompt. This draft targets improving this score."
          >
            <BarChart2 size={11} />
            Prompt visibility: {Math.round(draft.visibility_score_at_draft)}%
          </span>
        )}
        {/* Urgency badge */}
        <span className={`ml-auto flex items-center gap-1 text-[10px] font-semibold ${ustyle.text}`}>
          <span className={`w-1.5 h-1.5 rounded-full ${ustyle.dot}`} />
          {urgency.level}
        </span>
      </div>

      {/* Target prompt / posting instruction */}
      {draft.content_brief && draft.platform === 'quora' ? (
        <div className="flex items-start gap-2 bg-[#172554]/30 border border-[#1d4ed8]/25 rounded-lg px-3 py-2">
          <span className="text-[#6366f1] text-xs mt-0.5">→</span>
          <p className="text-xs text-[#60a5fa] leading-relaxed">{draft.content_brief}</p>
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
          <span className="text-[#64748B]">Targeting: </span>
          {draft.content_brief}
        </p>
      ) : null}

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
            className="w-full bg-[rgba(255,255,255,0.05)] border border-[rgba(255,255,255,0.10)] text-[#F0F4F8] rounded-lg px-3 py-2 text-sm placeholder:text-[#475569] focus:outline-none focus:border-[#6366f1]"
          />
          <textarea
            value={editContent}
            onChange={(e) => setEditContent(e.target.value)}
            rows={8}
            className="w-full bg-[rgba(255,255,255,0.05)] border border-[rgba(255,255,255,0.10)] text-[#F0F4F8] rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#6366f1] resize-none font-mono"
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
              className="text-xs text-[#64748B] hover:text-[#94A3B8] px-3 py-1.5 transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div>
          {draft.title && (
            <p className="text-sm font-semibold text-[#F0F4F8] leading-snug mb-1">{draft.title}</p>
          )}
          <p className="text-sm text-[#64748B] leading-relaxed">{preview}</p>
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
            className="flex items-center gap-1.5 text-xs bg-[rgba(255,255,255,0.06)] hover:bg-[rgba(255,255,255,0.10)] border border-[rgba(255,255,255,0.10)] text-[#94A3B8] hover:text-[#F0F4F8] rounded-lg px-3 py-1.5 transition-colors"
          >
            <Edit2 size={11} />
            Edit
          </button>
          <button
            onClick={() => onApprove(draft.id)}
            className="flex items-center gap-1.5 text-xs bg-[#064e3b]/20 hover:bg-[#064e3b]/30 border border-[#065f46]/25 text-[#34d399] rounded-lg px-3 py-1.5 transition-colors"
          >
            <CheckCircle2 size={11} />
            Approve
          </button>
          <button
            onClick={() => onDelete(draft.id)}
            className="flex items-center gap-1.5 text-xs text-[#ef4444]/70 hover:text-[#f87171] rounded-lg px-3 py-1.5 transition-colors ml-auto"
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

  // insert_location is stored in platform_guidelines_applied for Wikipedia drafts.
  // Old drafts have a JSON array of rules there — detect and ignore those.
  const rawGuidelines = draft.platform_guidelines_applied ?? '';
  const insertLocation: string = (() => {
    if (!rawGuidelines) return '';
    try {
      const parsed = JSON.parse(rawGuidelines);
      // If it parses as an array it's the old platform rules, not an insert location
      if (Array.isArray(parsed)) return '';
      return String(parsed);
    } catch {
      // Plain string — this is the actual insert location
      return rawGuidelines;
    }
  })();

  return (
    <>
      {/* COI banner — slim line above the card, only when draft mentions brand */}
      {showCOI && (
        <div className="flex items-center gap-2 text-xs text-[#f59e0b] px-1 -mb-1">
          <AlertTriangle size={11} className="shrink-0" />
          <span>
            Conflict of interest disclosure may be required if this content references your brand.{' '}
            <a
              href="https://en.wikipedia.org/wiki/Wikipedia:Conflict_of_interest"
              target="_blank"
              rel="noopener noreferrer"
              className="underline decoration-[#f59e0b]/50 hover:decoration-[#f59e0b]"
            >
              See Wikipedia&apos;s COI guidelines.
            </a>
          </span>
        </div>
      )}

      <div className="bg-[rgba(255,255,255,0.08)] backdrop-blur-md border border-[rgba(255,255,255,0.12)] rounded-xl p-5 flex flex-col gap-3 hover:border-[rgba(255,255,255,0.14)] shadow-[0_4px_24px_rgba(0,0,0,0.20)] transition-colors">
        {/* Platform badge + article link */}
        <div className="flex items-start gap-2 flex-wrap">
          <PlatformBadge platform="wikipedia" />
          <div className="flex-1 min-w-0">
            {articleUrl ? (
              <a
                href={articleUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm font-medium text-[#F0F4F8] hover:text-[#6366f1] transition-colors flex items-center gap-1 leading-snug"
              >
                {articleTitle}
                <ExternalLink size={11} className="shrink-0 text-[#475569]" />
              </a>
            ) : (
              <p className="text-sm font-medium text-[#F0F4F8] leading-snug">{articleTitle}</p>
            )}
            {draft.visibility_score_at_draft != null && (
              <p
                className="text-xs text-[#64748B] mt-0.5 flex items-center gap-1 cursor-help"
                title="How often your brand appears in AI responses for this prompt. This draft targets improving this score."
              >
                <BarChart2 size={10} />
                Prompt visibility: {Math.round(draft.visibility_score_at_draft)}%
              </p>
            )}
          </div>
        </div>

        {/* Where to insert — only shown when we have a real placement instruction */}
        {insertLocation && (
          <div className="bg-[rgba(255,255,255,0.06)] border border-[rgba(255,255,255,0.12)] rounded-lg px-3 py-2.5">
            <p className="text-xs text-[#64748B] uppercase tracking-wide mb-1 font-medium">Where to insert</p>
            <p className="text-xs text-[#94A3B8] leading-relaxed">{insertLocation}</p>
          </div>
        )}

        {/* Plain-text editor */}
        <div>
          <label className="text-xs text-[#64748B] uppercase tracking-wide mb-1.5 block">
            Text to insert
          </label>
          <textarea
            value={plainText}
            onChange={(e) => handlePlainChange(e.target.value)}
            rows={5}
            className="w-full bg-[rgba(255,255,255,0.05)] border border-[rgba(255,255,255,0.10)] text-[#F0F4F8] rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-[#6366f1] resize-none leading-relaxed font-sans"
            placeholder="Edit the plain text. Wiki formatting and citations are applied automatically."
          />
          <p className="text-xs text-[#475569] mt-1">
            Edit in plain text. Wiki links and citations are added when you copy.
          </p>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2 pt-1 flex-wrap">
          <button
            onClick={handleCopy}
            className={`flex items-center gap-1.5 text-xs rounded-lg px-3 py-1.5 transition-colors ${
              copied
                ? 'bg-[#064e3b]/20 border border-[#065f46]/25 text-[#34d399]'
                : 'bg-[#6366f1] hover:bg-[#4f46e5] text-white'
            }`}
          >
            {copied ? <Check size={11} /> : <Copy size={11} />}
            {copied ? 'Copied!' : 'Copy Wiki Format'}
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex items-center gap-1.5 text-xs bg-[rgba(255,255,255,0.06)] hover:bg-[rgba(255,255,255,0.10)] border border-[rgba(255,255,255,0.10)] text-[#94A3B8] hover:text-[#F0F4F8] rounded-lg px-3 py-1.5 transition-colors disabled:opacity-50"
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
    </>
  );
}

// ── Request Draft modal ───────────────────────────────────────────────────────

const DRAFT_PLATFORMS = ['reddit', 'quora', 'medium', 'wikipedia'] as const;

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
  const [platform, setPlatform] = useState<string>('reddit');
  const [promptId, setPromptId] = useState<number | ''>('');
  const [customTopic, setCustomTopic] = useState('');
  const [notes, setNotes] = useState('');
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit() {
    setCreating(true);
    setError(null);
    try {
      const parts: string[] = [];
      if (customTopic.trim()) parts.push(customTopic.trim());
      if (notes.trim()) parts.push(`Additional notes: ${notes.trim()}`);
      const brief = parts.length > 0 ? parts.join('\n\n') : undefined;

      const draft = await generateDraft(brandId, {
        platform,
        prompt_id: promptId !== '' ? (promptId as number) : undefined,
        custom_brief: brief,
      });
      onCreated(draft);
      onClose();
    } catch (e: any) {
      setError(e?.response?.data?.detail ?? 'Draft generation failed. Check that API keys are configured.');
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div className="relative bg-[rgba(10,14,24,0.96)] backdrop-blur-xl border border-[rgba(255,255,255,0.12)] rounded-2xl p-6 max-w-md w-full shadow-2xl">
        <div className="flex items-center justify-between mb-5">
          <div>
            <h3 className="text-base font-semibold text-[#F0F4F8]">Request a Draft</h3>
            <p className="text-xs text-[#64748B] mt-0.5">Generate a targeted draft for a specific prompt or topic</p>
          </div>
          <button onClick={onClose} className="text-[#475569] hover:text-[#94A3B8] transition-colors">
            <X size={16} />
          </button>
        </div>

        <div className="flex flex-col gap-4">
          {/* Platform */}
          <div>
            <label className="text-xs text-[#64748B] font-medium uppercase tracking-wide mb-1.5 block">Platform</label>
            <div className="grid grid-cols-4 gap-2">
              {DRAFT_PLATFORMS.map((p) => (
                <button
                  key={p}
                  onClick={() => setPlatform(p)}
                  className={`py-2 rounded-lg text-xs font-medium capitalize transition-colors border ${
                    platform === p
                      ? 'bg-[#6366f1]/20 border-[#6366f1]/50 text-[#6366f1]'
                      : 'bg-[rgba(255,255,255,0.06)] border-[rgba(255,255,255,0.10)] text-[#64748B] hover:text-[#94A3B8]'
                  }`}
                >
                  {p}
                </button>
              ))}
            </div>
          </div>

          {/* Target prompt */}
          <div>
            <label className="text-xs text-[#64748B] font-medium uppercase tracking-wide mb-1.5 block">
              Target Prompt <span className="text-[#475569] normal-case font-normal">(optional)</span>
            </label>
            <div className="relative">
              <select
                value={promptId}
                onChange={(e) => setPromptId(e.target.value === '' ? '' : Number(e.target.value))}
                className="w-full appearance-none bg-[rgba(255,255,255,0.05)] border border-[rgba(255,255,255,0.10)] text-[#F0F4F8] rounded-lg pl-3 pr-8 py-2 text-sm focus:outline-none focus:border-[#6366f1]"
              >
                <option value="">— Select tracked prompt —</option>
                {prompts.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.text.length > 60 ? p.text.slice(0, 60) + '…' : p.text}
                  </option>
                ))}
              </select>
              <ChevronDown size={13} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[#475569] pointer-events-none" />
            </div>
          </div>

          {/* Custom topic */}
          <div>
            <label className="text-xs text-[#64748B] font-medium uppercase tracking-wide mb-1.5 block">
              Custom Topic <span className="text-[#475569] normal-case font-normal">(or leave blank to use prompt)</span>
            </label>
            <input
              type="text"
              value={customTopic}
              onChange={(e) => setCustomTopic(e.target.value)}
              placeholder="e.g. Why Rainbow Study matters for oncologists"
              className="w-full bg-[rgba(255,255,255,0.05)] border border-[rgba(255,255,255,0.10)] text-[#F0F4F8] rounded-lg px-3 py-2 text-sm placeholder:text-[#475569] focus:outline-none focus:border-[#6366f1]"
            />
          </div>

          {/* Notes */}
          <div>
            <label className="text-xs text-[#64748B] font-medium uppercase tracking-wide mb-1.5 block">
              Notes <span className="text-[#475569] normal-case font-normal">(optional)</span>
            </label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              placeholder="Focus on clinical data, write for a non-technical audience…"
              className="w-full bg-[rgba(255,255,255,0.05)] border border-[rgba(255,255,255,0.10)] text-[#F0F4F8] rounded-lg px-3 py-2 text-sm placeholder:text-[#475569] focus:outline-none focus:border-[#6366f1] resize-none"
            />
          </div>

          {error && (
            <p className="text-xs text-[#f87171] bg-[#7f1d1d]/15 border border-[#991b1b]/25 rounded-lg px-3 py-2">
              {error}
            </p>
          )}

          <button
            onClick={handleSubmit}
            disabled={creating || (promptId === '' && !customTopic.trim())}
            className="w-full flex items-center justify-center gap-2 bg-[#6366f1] hover:bg-[#4f46e5] disabled:opacity-50 text-white rounded-lg px-4 py-2.5 text-sm font-medium transition-colors"
          >
            {creating ? (
              <><Loader2 size={14} className="animate-spin" /> Generating…</>
            ) : (
              <><Sparkles size={14} /> Generate Draft</>
            )}
          </button>
        </div>
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
      : 'text-[#64748B]';

  return (
    <div className="bg-[rgba(255,255,255,0.08)] backdrop-blur-md border border-[rgba(255,255,255,0.12)] rounded-xl p-4 flex flex-col gap-3 hover:border-[rgba(255,255,255,0.14)] shadow-[0_4px_24px_rgba(0,0,0,0.20)] transition-colors">
      {/* Top row */}
      <div className="flex items-center gap-2 flex-wrap">
        <PlatformBadge platform={opp.platform} />
        {opp.subreddit && (
          <span className="text-xs text-[#64748B] font-medium">r/{opp.subreddit}</span>
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
        className="text-sm font-medium text-[#F0F4F8] hover:text-[#6366f1] transition-colors leading-snug flex items-start gap-1.5"
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
          className="flex items-center gap-1.5 text-xs text-[#ef4444]/70 hover:text-[#f87171] rounded-lg px-3 py-1.5 transition-colors ml-auto"
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
      <ol className="list-decimal list-inside space-y-1 text-xs text-[#94A3B8] leading-relaxed">
        <li>Go to <span className="text-[#6366f1]">reddit.com/r/{subreddit}</span></li>
        <li>Click <span className="text-[#F0F4F8] font-medium">New Post</span></li>
        <li>Choose <span className="text-[#F0F4F8] font-medium">Text post</span></li>
        <li>Paste the title and body from the draft above</li>
        <li>Add relevant flair if available</li>
        <li>Click <span className="text-[#F0F4F8] font-medium">Submit</span></li>
        <p className="mt-1 text-[#475569] not-italic">Tip: Post between 9 am–12 pm in your target audience&apos;s timezone for best engagement.</p>
      </ol>
    );
  },
  quora: (brief) => {
    const topic = brief ? brief.split(' — ')[0].replace(/^Targeting: /i, '') : 'your topic';
    return (
      <ol className="list-decimal list-inside space-y-1 text-xs text-[#94A3B8] leading-relaxed">
        <li>Go to <span className="text-[#6366f1]">quora.com</span> and search for <span className="text-[#F0F4F8] font-medium">&ldquo;{topic.slice(0, 40)}&rdquo;</span></li>
        <li>Find a relevant question</li>
        <li>Click <span className="text-[#F0F4F8] font-medium">Answer</span></li>
        <li>Paste your draft</li>
        <li>Add your credentials if relevant</li>
        <li>Click <span className="text-[#F0F4F8] font-medium">Submit</span></li>
        <p className="mt-1 text-[#475569] not-italic">Tip: Answer questions posted within the last 30 days for maximum visibility.</p>
      </ol>
    );
  },
  medium: () => (
    <ol className="list-decimal list-inside space-y-1 text-xs text-[#94A3B8] leading-relaxed">
      <li>Go to <span className="text-[#6366f1]">medium.com/new-story</span></li>
      <li>Paste your title and body</li>
      <li>Add tags relevant to your topic (up to 5)</li>
      <li>Set a featured image if possible</li>
      <li>Click <span className="text-[#F0F4F8] font-medium">Publish</span></li>
      <p className="mt-1 text-[#475569] not-italic">Tip: Add your company publication if you have one set up.</p>
    </ol>
  ),
  wikipedia: () => (
    <ol className="list-decimal list-inside space-y-1 text-xs text-[#94A3B8] leading-relaxed">
      <li>Find the target article on Wikipedia</li>
      <li>Click <span className="text-[#F0F4F8] font-medium">Edit</span></li>
      <li>Navigate to the suggested section</li>
      <li>Paste the wiki-formatted text (use Copy Wiki Format button)</li>
      <li>Add an edit summary explaining your addition</li>
      <li>Click <span className="text-[#F0F4F8] font-medium">Save</span></li>
      <p className="mt-1 text-[#f59e0b] not-italic flex items-start gap-1"><AlertTriangle size={10} className="shrink-0 mt-0.5" />Disclose any conflict of interest on the article talk page first.</p>
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
    <div className="bg-[rgba(255,255,255,0.08)] backdrop-blur-md border border-[rgba(255,255,255,0.12)] rounded-xl p-4 flex flex-col gap-3 hover:border-[rgba(255,255,255,0.14)] shadow-[0_4px_24px_rgba(0,0,0,0.20)] transition-colors">
      {/* Top row */}
      <div className="flex items-center gap-2 flex-wrap">
        <PlatformBadge platform={draft.platform} />
        {draft.approved_at && (
          <span className="text-xs text-[#64748B] flex items-center gap-1">
            <CheckCircle2 size={11} className="text-[#10b981]" />
            Approved {relativeTime(draft.approved_at)}
          </span>
        )}
      </div>

      {/* Target prompt */}
      {draft.content_brief && (
        <p className="text-xs text-[#475569] leading-relaxed line-clamp-2">
          <span className="text-[#64748B]">Targeting: </span>
          {draft.content_brief}
        </p>
      )}

      {/* Title / preview */}
      <div>
        {draft.title && (
          <p className="text-sm font-semibold text-[#F0F4F8] leading-snug mb-1">{draft.title}</p>
        )}
        {!draft.title && (
          <p className="text-sm text-[#94A3B8] leading-relaxed truncate">{title}</p>
        )}
      </div>

      {/* Expandable full draft */}
      {expanded && (
        <div className="bg-[rgba(255,255,255,0.08)] border border-[rgba(255,255,255,0.10)] rounded-lg p-3 relative">
          <pre className="text-xs text-[#94A3B8] whitespace-pre-wrap leading-relaxed font-mono pr-14">
            {draft.content_text}
          </pre>
          <button
            onClick={handleCopy}
            className="absolute top-2 right-2 flex items-center gap-1 text-[10px] text-[#475569] hover:text-[#94A3B8] transition-colors"
          >
            {copied ? <Check size={11} className="text-[#10b981]" /> : <Copy size={11} />}
            {copied ? 'Copied' : 'Copy'}
          </button>
        </div>
      )}

      {/* How to Post guidance */}
      {guidance && (
        <div className="border border-[rgba(255,255,255,0.12)] rounded-lg overflow-hidden">
          <button
            onClick={() => setGuideOpen(!guideOpen)}
            className="w-full flex items-center justify-between px-3 py-2 bg-[rgba(255,255,255,0.08)] hover:bg-[rgba(255,255,255,0.06)] text-left transition-colors"
          >
            <span className="flex items-center gap-1.5 text-xs text-[#64748B] font-medium">
              <BookOpen size={11} />
              How to Post on {draft.platform.charAt(0).toUpperCase() + draft.platform.slice(1)}
            </span>
            <ChevronDown size={11} className={`text-[#475569] transition-transform ${guideOpen ? 'rotate-180' : ''}`} />
          </button>
          {guideOpen && (
            <div className="px-3 py-3 bg-transparent">
              {guidance(draft.content_brief)}
            </div>
          )}
        </div>
      )}

      {/* Actions */}
      <div className="flex items-center gap-2 pt-1 flex-wrap">
        <button
          onClick={() => setExpanded(!expanded)}
          className="flex items-center gap-1.5 text-xs bg-[rgba(255,255,255,0.06)] hover:bg-[rgba(255,255,255,0.10)] border border-[rgba(255,255,255,0.10)] text-[#94A3B8] hover:text-[#F0F4F8] rounded-lg px-3 py-1.5 transition-colors"
        >
          <FileText size={11} />
          {expanded ? 'Hide Draft' : 'View Draft'}
        </button>
        <button
          onClick={() => onMarkPosted(draft.id)}
          className="flex items-center gap-1.5 text-xs bg-[#064e3b]/20 hover:bg-[#064e3b]/30 border border-[#065f46]/25 text-[#34d399] rounded-lg px-3 py-1.5 transition-all duration-150"
        >
          <CheckCircle2 size={11} />
          Mark as Posted
        </button>
        <button
          onClick={() => onMoveToDrafts(draft.id)}
          className="flex items-center gap-1.5 text-xs text-[#475569] hover:text-[#64748B] rounded-lg px-3 py-1.5 transition-colors ml-auto"
        >
          <Edit2 size={11} />
          Move back to Drafts
        </button>
      </div>
    </div>
  );
}

// ── Posted card ───────────────────────────────────────────────────────────────

function PostedCard({ draft }: { draft: ContentDraft }) {
  const title = draft.title ?? draft.content_text.slice(0, 80) + (draft.content_text.length > 80 ? '…' : '');
  return (
    <div className="bg-[rgba(255,255,255,0.08)] backdrop-blur-md border border-[rgba(255,255,255,0.12)] rounded-xl px-4 py-3 flex items-center gap-3 shadow-[0_4px_24px_rgba(0,0,0,0.20)]">
      <PlatformBadge platform={draft.platform} />
      <p className="flex-1 text-sm text-[#94A3B8] truncate">{title}</p>
      <span className="text-xs text-[#475569] shrink-0">{relativeTime(draft.updated_at)}</span>
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
  const [brandProfile, setBrandProfile] = useState<BrandProfile | null>(null);
  const [brandPrompts, setBrandPrompts] = useState<Prompt[]>([]);
  const [contentSettings, setContentSettings] = useState<BrandContentSettings[]>([]);

  // Right panel
  const [generating, setGenerating] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [requestDraftOpen, setRequestDraftOpen] = useState(false);
  const [draftStatus, setDraftStatus] = useState<DraftQueueStatus | null>(null);

  // Help modals
  const [hubHelpOpen, setHubHelpOpen] = useState(false);
  const [oppHelpOpen, setOppHelpOpen] = useState(false);
  const [postingGuideOpen, setPostingGuideOpen] = useState(false);

  // Platform filtering
  const _disabledPlatforms = new Set(
    contentSettings.filter((s) => !s.enabled).map((s) => s.platform)
  );

  // Tab counts (using filtered draft/scheduled counts)
  const tabCounts = {
    drafts: draftItems.filter((d) => !_disabledPlatforms.has(d.platform)).length,
    scheduled: scheduledItems.filter((d) => !_disabledPlatforms.has(d.platform)).length,
    opportunities: opportunities.length,
    posted: postedItems.length,
  };

  // ── Load data ──────────────────────────────────────────────────────────────

  const loadAll = useCallback(async (brandId: number) => {
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
      ] = await Promise.all([
        getDrafts(brandId, undefined, 'draft'),
        getDrafts(brandId, undefined, 'approved'),
        getDrafts(brandId, undefined, 'posted'),
        getOpportunities(brandId),
        getBrandProfile(brandId).catch(() => null),
        getBrand(brandId).catch(() => null),
        getContentSettings(brandId).catch(() => [] as BrandContentSettings[]),
        getDraftStatus(brandId).catch(() => null),
      ]);

      setDraftItems(draftsData);
      setScheduledItems(scheduledData);
      setPostedItems(postedData);
      setOpportunities(oppsData);
      setBrandProfile(profileData);
      setBrandPrompts(brandDetail?.prompts ?? []);
      setContentSettings(settingsData);
      setDraftStatus(statusData);
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
    if (draftStatus?.scheduled_queue_full) {
      alert(`Scheduled queue is full (${draftStatus.scheduled_cap}/${draftStatus.scheduled_cap}). Mark some drafts as posted before approving more.`);
      return;
    }
    try {
      await updateDraft(id, { status: 'approved' });
    } catch (e: any) {
      const detail = e?.response?.data?.detail ?? '';
      if (detail.includes('queue is full') || e?.response?.status === 409) {
        alert(detail || 'Scheduled queue is full. Mark some drafts as posted first.');
        return;
      }
      throw e;
    }
    if (selectedBrandId) loadAll(selectedBrandId);
  }

  async function handleMarkAsPosted(id: number) {
    await updateDraft(id, { status: 'posted' });
    if (selectedBrandId) loadAll(selectedBrandId);
  }

  async function handleMoveBackToDrafts(id: number) {
    await updateDraft(id, { status: 'draft' });
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
    if (draftStatus?.draft_queue_full) {
      alert(`Draft queue is full (${draftStatus.draft_cap}/${draftStatus.draft_cap}). Approve or dismiss drafts to generate new ones.`);
      return;
    }
    setGenerating(true);
    try {
      const newDrafts = await generateNow(selectedBrandId, 3);
      if (newDrafts.length > 0) {
        setDraftItems((prev) => [...newDrafts, ...prev]);
        setActiveTab('drafts');
      } else {
        // No drafts returned — reload in case they were created despite the error
        loadAll(selectedBrandId);
        setActiveTab('drafts');
      }
    } catch (e: any) {
      // Reload drafts — some may have been created before the error
      loadAll(selectedBrandId);
      setActiveTab('drafts');
      // Only surface the error if it's a genuine API key / config problem
      const status = e?.response?.status;
      const detail = e?.response?.data?.detail ?? '';
      if (status === 400 || detail.toLowerCase().includes('api key')) {
        alert(detail || 'Draft generation failed. Check that API keys are configured.');
      }
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

  // ── Tab content ────────────────────────────────────────────────────────────

  function renderDraftsTab() {
    if (visibleDraftItems.length === 0) {
      return (
        <EmptyState
          icon={<FileText size={22} className="text-[#475569]" />}
          title="No drafts waiting"
          description='Click "Generate Drafts Now" to create drafts targeting your top visibility gaps.'
        />
      );
    }
    const selectedBrand = brands.find((b) => b.id === selectedBrandId);
    const brandName = selectedBrand?.name ?? '';
    // Sort by urgency score descending (High first)
    const sorted = [...visibleDraftItems].sort(
      (a, b) => computeUrgency(b, postedItems).score - computeUrgency(a, postedItems).score
    );
    return (
      <div className="flex flex-col gap-3">
        {sorted.map((d) =>
          d.platform === 'wikipedia' ? (
            <WikipediaDraftCard
              key={d.id}
              draft={d}
              brandName={brandName}
              onDelete={handleDelete}
              onSaved={handleSaved}
            />
          ) : (
            <DraftCard
              key={d.id}
              draft={d}
              profile={brandProfile}
              brandName={brandName}
              postedItems={postedItems}
              onApprove={handleApprove}
              onDelete={handleDelete}
              onSaved={handleSaved}
            />
          )
        )}
      </div>
    );
  }

  function renderScheduledTab() {
    if (visibleScheduledItems.length === 0) {
      return (
        <EmptyState
          icon={<Clock size={22} className="text-[#475569]" />}
          title="Nothing scheduled yet"
          description="Approve a draft from the Drafts tab — it will appear here ready to post."
        />
      );
    }
    return (
      <div className="flex flex-col gap-3">
        {visibleScheduledItems.map((d) => (
          <ScheduledCard
            key={d.id}
            draft={d}
            onMarkPosted={handleMarkAsPosted}
            onMoveToDrafts={handleMoveBackToDrafts}
          />
        ))}
      </div>
    );
  }

  function renderOpportunitiesTab() {
    const header = (
      <div className="flex items-center justify-between mb-4">
        <p className="text-xs text-[#64748B]">
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
                className="flex items-center gap-2 text-sm bg-[rgba(255,255,255,0.06)] hover:bg-[rgba(255,255,255,0.10)] border border-[rgba(255,255,255,0.10)] text-[#94A3B8] rounded-lg px-4 py-2 transition-colors"
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

  function renderPostedTab() {
    if (postedItems.length === 0) {
      return (
        <EmptyState
          icon={<CheckCircle2 size={22} className="text-[#475569]" />}
          title="Nothing posted yet"
          description="Approved drafts will appear here once marked as posted."
        />
      );
    }
    return (
      <div className="flex flex-col gap-2">
        {postedItems.map((d) => (
          <PostedCard key={d.id} draft={d} />
        ))}
      </div>
    );
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  if (error && brands.length === 0) {
    return (
      <div className="px-8 py-8 max-w-7xl">
        <h1 className="text-2xl font-bold text-[#F0F4F8] mb-8">Content Hub</h1>
        <div className="flex flex-col items-center justify-center py-24 text-center">
          <div className="w-14 h-14 bg-[#7f1d1d]/15 border border-[#991b1b]/25 rounded-2xl flex items-center justify-center mb-4">
            <X size={24} className="text-[#f87171]" />
          </div>
          <p className="text-base font-medium text-[#F0F4F8] mb-1">Unable to connect</p>
          <p className="text-sm text-[#64748B]">{error}</p>
        </div>
      </div>
    );
  }

  // Filter drafts to only show enabled platforms
  const redditEnabled = !_disabledPlatforms.has('reddit');
  const visibleDraftItems = draftItems.filter((d) => !_disabledPlatforms.has(d.platform));
  const visibleScheduledItems = scheduledItems.filter((d) => !_disabledPlatforms.has(d.platform));

  const TABS: { key: QueueTab; label: string }[] = [
    { key: 'drafts', label: 'Drafts' },
    { key: 'scheduled', label: 'Scheduled' },
    ...(redditEnabled ? [{ key: 'opportunities' as QueueTab, label: 'Live Reddit Opportunities' }] : []),
    { key: 'posted', label: 'Posted' },
  ];

  return (
    <div className="px-8 py-8 max-w-[1400px]">
      {/* Request Draft modal */}
      {requestDraftOpen && selectedBrandId && (
        <RequestDraftModal
          brandId={selectedBrandId}
          prompts={brandPrompts}
          onClose={() => setRequestDraftOpen(false)}
          onCreated={(draft) => {
            setDraftItems((prev) => [draft, ...prev]);
            setActiveTab('drafts');
          }}
        />
      )}

      {/* Help modals */}
      {hubHelpOpen && (
        <HelpModal title="How Content Hub works" onClose={() => setHubHelpOpen(false)}>
          <p>Content Hub generates AI drafts targeting your visibility gaps and surfaces Reddit threads where your brand can contribute.</p>
          <ul className="space-y-2 mt-2">
            <li><span className="text-[#F0F4F8] font-medium">Generate Drafts Now</span> — creates AI drafts based on your top-scoring content gaps (prompts where your brand is least visible).</li>
            <li><span className="text-[#F0F4F8] font-medium">Scan Reddit Now</span> — searches subreddits relevant to your brand&apos;s industry for recent threads matching your tracked prompts.</li>
            <li><span className="text-[#F0F4F8] font-medium">Drafts tab</span> — review, edit, and approve AI drafts before they go live.</li>
            <li><span className="text-[#F0F4F8] font-medium">Scheduled tab</span> — approved drafts ready to post. Copy the text, post it manually, then click Mark as Posted.</li>
            <li><span className="text-[#F0F4F8] font-medium">Live Reddit Opportunities</span> — Reddit threads where a thoughtful reply could improve your brand&apos;s visibility.</li>
            <li><span className="text-[#F0F4F8] font-medium">Posted tab</span> — content that has been marked as posted.</li>
            <li><span className="text-[#F0F4F8] font-medium">Brand Settings</span> — control which platforms generate drafts and how frequently.</li>
          </ul>
        </HelpModal>
      )}
      {oppHelpOpen && (
        <HelpModal title="Live Reddit Opportunities" onClose={() => setOppHelpOpen(false)}>
          <p>Reddit threads where your brand can meaningfully contribute.</p>
          <p>The scanner searches subreddits relevant to your brand&apos;s industry for threads matching your tracked prompts. Only threads with a relevance score of 40+ are shown.</p>
          <ul className="space-y-2 mt-2">
            <li><span className="text-[#F0F4F8] font-medium">Relevance score</span> — how closely the thread matches your tracked prompts, based on keyword overlap, recency, and engagement.</li>
            <li><span className="text-[#F0F4F8] font-medium">Draft Reply</span> — generates an AI reply using your brand voice guidelines.</li>
            <li><span className="text-[#F0F4F8] font-medium">Dismiss</span> — removes the opportunity from this list.</li>
          </ul>
          <p className="text-[#64748B] text-xs mt-2">The scanner runs automatically every night at 2:00 AM UTC.</p>
        </HelpModal>
      )}

      {/* Posting Guide full-screen modal */}
      {postingGuideOpen && (
        <div className="fixed inset-0 z-50 flex">
          {/* Backdrop */}
          <div className="absolute inset-0 bg-black/60" onClick={() => setPostingGuideOpen(false)} />
          {/* Panel */}
          <div className="relative ml-auto w-full max-w-2xl h-full bg-[rgba(10,14,24,0.96)] backdrop-blur-xl border-l border-[rgba(255,255,255,0.12)] flex flex-col shadow-2xl">
            {/* Panel header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-[rgba(255,255,255,0.12)] shrink-0">
              <div className="flex items-center gap-2">
                <BookOpen size={16} className="text-[#6366f1]" />
                <h2 className="text-base font-semibold text-[#F0F4F8]">Posting Guide</h2>
              </div>
              <button onClick={() => setPostingGuideOpen(false)} className="text-[#475569] hover:text-[#94A3B8] transition-colors">
                <X size={18} />
              </button>
            </div>
            {/* Scrollable content */}
            <div className="flex-1 overflow-y-auto px-6 py-6 space-y-8 text-sm text-[#94A3B8]">

              {/* Reddit */}
              <section>
                <div className="flex items-center gap-2 mb-4">
                  <span className="px-2.5 py-1 rounded-full text-xs font-bold bg-[#ff4500]/15 text-[#ff6a33] border border-[#ff4500]/30">Reddit</span>
                  <div className="flex-1 h-px bg-[rgba(255,255,255,0.08)]" />
                </div>
                <div className="space-y-5">
                  <div>
                    <p className="text-[#F0F4F8] font-medium mb-1.5">Finding the right subreddit</p>
                    <ul className="space-y-1 list-disc list-inside text-[#64748B]">
                      <li>Search Reddit for your industry keywords (e.g. r/entrepreneur, r/investing)</li>
                      <li>Look for subreddits with 10k+ members and active daily posts</li>
                      <li>Read the subreddit rules — many ban self-promotion outright</li>
                      <li>Check recent posts to match the community&apos;s tone and format</li>
                    </ul>
                  </div>
                  <div>
                    <p className="text-[#F0F4F8] font-medium mb-1.5">How to post</p>
                    <ol className="space-y-1 list-decimal list-inside text-[#64748B]">
                      <li>Click <span className="text-[#94A3B8]">+ Create Post</span> in the subreddit</li>
                      <li>Choose <span className="text-[#94A3B8]">Text</span> for discussion posts</li>
                      <li>Write a title that frames a question or shares a genuine insight</li>
                      <li>Paste your draft, then read it again — remove anything that sounds like an ad</li>
                      <li>Submit and stay to reply to comments for the first hour</li>
                    </ol>
                  </div>
                  <div>
                    <p className="text-[#F0F4F8] font-medium mb-1.5">Community rules</p>
                    <ul className="space-y-1 list-disc list-inside text-[#64748B]">
                      <li>Never post the same content to multiple subreddits simultaneously</li>
                      <li>Don&apos;t upvote your own posts or ask others to</li>
                      <li>Engage genuinely — comments should add value, not just promote</li>
                      <li>Wait until you have karma before posting in stricter communities</li>
                    </ul>
                  </div>
                  <div>
                    <p className="text-[#F0F4F8] font-medium mb-1.5">Disclosure</p>
                    <p className="text-[#64748B]">If you&apos;re affiliated with the brand, say so. Add a note like: <span className="text-[#94A3B8] italic">"Disclosure: I work at [Brand]."</span> Reddit users reward honesty and penalize deception.</p>
                  </div>
                </div>
              </section>

              {/* Quora */}
              <section>
                <div className="flex items-center gap-2 mb-4">
                  <span className="px-2.5 py-1 rounded-full text-xs font-bold bg-[#b92b27]/15 text-[#e05a56] border border-[#b92b27]/30">Quora</span>
                  <div className="flex-1 h-px bg-[rgba(255,255,255,0.08)]" />
                </div>
                <div className="space-y-5">
                  <div>
                    <p className="text-[#F0F4F8] font-medium mb-1.5">Finding relevant questions</p>
                    <ul className="space-y-1 list-disc list-inside text-[#64748B]">
                      <li>Search for questions matching your tracked prompts — copy the exact phrasing</li>
                      <li>Filter by <span className="text-[#94A3B8]">Most Answered</span> to find high-traffic questions</li>
                      <li>Target questions with 1k+ views but fewer than 5 answers for best impact</li>
                      <li>Follow relevant topics so Quora surfaces opportunities automatically</li>
                    </ul>
                  </div>
                  <div>
                    <p className="text-[#F0F4F8] font-medium mb-1.5">Writing a good answer</p>
                    <ol className="space-y-1 list-decimal list-inside text-[#64748B]">
                      <li>Start with a direct answer to the question — don&apos;t bury the lede</li>
                      <li>Use short paragraphs and bold headers for scannability</li>
                      <li>Include one concrete example or data point</li>
                      <li>Mention your brand naturally, in context — never as the opening line</li>
                      <li>End with a clear takeaway or call to action</li>
                    </ol>
                  </div>
                  <div>
                    <p className="text-[#F0F4F8] font-medium mb-1.5">Getting upvotes</p>
                    <ul className="space-y-1 list-disc list-inside text-[#64748B]">
                      <li>Answer quickly — first answers on active questions get more exposure</li>
                      <li>Add an image or simple diagram if it clarifies your point</li>
                      <li>Respond to comments to boost engagement signals</li>
                    </ul>
                  </div>
                  <div>
                    <p className="text-[#F0F4F8] font-medium mb-1.5">Disclosure</p>
                    <p className="text-[#64748B]">Quora requires disclosure of affiliations. Add to your profile bio and state it in the answer: <span className="text-[#94A3B8] italic">"I&apos;m on the team at [Brand]."</span></p>
                  </div>
                </div>
              </section>

              {/* Medium */}
              <section>
                <div className="flex items-center gap-2 mb-4">
                  <span className="px-2.5 py-1 rounded-full text-xs font-bold bg-[rgba(255,255,255,0.06)] text-[#94A3B8] border border-[rgba(255,255,255,0.10)]">Medium</span>
                  <div className="flex-1 h-px bg-[rgba(255,255,255,0.08)]" />
                </div>
                <div className="space-y-5">
                  <div>
                    <p className="text-[#F0F4F8] font-medium mb-1.5">Publishing a story</p>
                    <ol className="space-y-1 list-decimal list-inside text-[#64748B]">
                      <li>Go to <span className="text-[#94A3B8]">medium.com/new-story</span> and paste your draft</li>
                      <li>Add a compelling title and subtitle — these appear in search results</li>
                      <li>Insert a header image (use Unsplash for free photos)</li>
                      <li>Click <span className="text-[#94A3B8]">Publish</span> → review the story preview</li>
                      <li>Set the publish date or post immediately</li>
                    </ol>
                  </div>
                  <div>
                    <p className="text-[#F0F4F8] font-medium mb-1.5">Tags for discoverability</p>
                    <ul className="space-y-1 list-disc list-inside text-[#64748B]">
                      <li>Add up to 5 tags — choose the most specific ones first</li>
                      <li>Use tags that match existing Medium topics (e.g. &quot;Startup&quot;, &quot;Health&quot;, &quot;AI&quot;)</li>
                      <li>Avoid overly generic tags like &quot;Technology&quot; — too competitive</li>
                    </ul>
                  </div>
                  <div>
                    <p className="text-[#F0F4F8] font-medium mb-1.5">Adding to a publication</p>
                    <ul className="space-y-1 list-disc list-inside text-[#64748B]">
                      <li>Find publications in your niche (e.g. <span className="text-[#94A3B8]">Towards Data Science</span>, <span className="text-[#94A3B8]">The Startup</span>)</li>
                      <li>Submit your story to the publication before publishing independently</li>
                      <li>Publications review submissions — expect 1–5 days</li>
                      <li>Publication placement dramatically increases reach</li>
                    </ul>
                  </div>
                  <div>
                    <p className="text-[#F0F4F8] font-medium mb-1.5">Disclosure</p>
                    <p className="text-[#64748B]">Add a disclosure at the end of the article: <span className="text-[#94A3B8] italic">"Disclosure: The author is affiliated with [Brand]."</span> Medium&apos;s guidelines require transparency about conflicts of interest.</p>
                  </div>
                </div>
              </section>

              {/* Wikipedia */}
              <section>
                <div className="flex items-center gap-2 mb-4">
                  <span className="px-2.5 py-1 rounded-full text-xs font-bold bg-[#64748b]/15 text-[#94A3B8] border border-[#64748b]/30">Wikipedia</span>
                  <div className="flex-1 h-px bg-[rgba(255,255,255,0.08)]" />
                </div>
                <div className="space-y-5">
                  <div>
                    <p className="text-[#F0F4F8] font-medium mb-1.5">Finding the right article to edit</p>
                    <ul className="space-y-1 list-disc list-inside text-[#64748B]">
                      <li>Target category or topic articles — not your brand&apos;s own page</li>
                      <li>Look for articles tagged <span className="text-[#94A3B8]">stub</span> or <span className="text-[#94A3B8]">needs expansion</span> in your industry</li>
                      <li>Avoid articles with active edit wars or protection flags</li>
                      <li>Your edit should add context to the topic, with your brand as one example among several</li>
                    </ul>
                  </div>
                  <div>
                    <p className="text-[#F0F4F8] font-medium mb-1.5">COI disclosure (step by step)</p>
                    <ol className="space-y-1 list-decimal list-inside text-[#64748B]">
                      <li>Go to your Wikipedia user talk page</li>
                      <li>Add the <span className="text-[#94A3B8]">&#123;&#123;connected contributor&#125;&#125;</span> template with your affiliation</li>
                      <li>On the article&apos;s <span className="text-[#94A3B8]">Talk</span> tab, post a note: <span className="text-[#94A3B8] italic">"I have a COI with [Brand] and propose the following addition: [your text]. Please review."</span></li>
                      <li>Wait for another editor to review and add it — do not self-publish COI edits</li>
                    </ol>
                  </div>
                  <div>
                    <p className="text-[#F0F4F8] font-medium mb-1.5">What Wikipedia will and won&apos;t accept</p>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <p className="text-[#10b981] text-xs font-semibold mb-1">✓ Accepted</p>
                        <ul className="space-y-1 list-disc list-inside text-[#64748B] text-xs">
                          <li>Neutral, factual statements</li>
                          <li>Cited sources (news, research)</li>
                          <li>Adding your brand as one of several examples</li>
                          <li>Correcting factual errors</li>
                        </ul>
                      </div>
                      <div>
                        <p className="text-[#ef4444] text-xs font-semibold mb-1">✗ Not accepted</p>
                        <ul className="space-y-1 list-disc list-inside text-[#64748B] text-xs">
                          <li>Promotional language or superlatives</li>
                          <li>Uncited claims</li>
                          <li>Creating a new article for your brand without notability</li>
                          <li>Removing competitors from articles</li>
                        </ul>
                      </div>
                    </div>
                  </div>
                  <div>
                    <p className="text-[#F0F4F8] font-medium mb-1.5">Using the talk page</p>
                    <ul className="space-y-1 list-disc list-inside text-[#64748B]">
                      <li>The talk page is your primary tool when you have a COI — always use it</li>
                      <li>Frame requests as improvements to the article, not promotions for your brand</li>
                      <li>Be patient — volunteer editors may take days or weeks to respond</li>
                      <li>If your edit is declined, ask for specific feedback and revise</li>
                    </ul>
                  </div>
                </div>
              </section>

            </div>
          </div>
        </div>
      )}

      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-2">
          <div>
            <h1 className="text-2xl font-bold text-[#F0F4F8]">Content Hub</h1>
            <p className="text-sm text-[#64748B] mt-1">
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

        <div className="flex items-center gap-2">
          {/* Posting Guide button */}
          <button
            onClick={() => setPostingGuideOpen(true)}
            className="flex items-center gap-1.5 text-sm bg-[rgba(255,255,255,0.06)] hover:bg-[rgba(255,255,255,0.10)] border border-[rgba(255,255,255,0.10)] text-[#94A3B8] hover:text-[#F0F4F8] rounded-lg px-3 py-2 transition-all duration-150"
          >
            <BookOpen size={14} />
            Posting Guide
          </button>

          {/* Request Draft button */}
          <button
            onClick={() => setRequestDraftOpen(true)}
            className="flex items-center gap-1.5 text-sm bg-[rgba(255,255,255,0.06)] hover:bg-[rgba(255,255,255,0.10)] border border-[rgba(255,255,255,0.10)] text-[#94A3B8] hover:text-[#F0F4F8] rounded-lg px-3 py-2 transition-all duration-150"
          >
            <PenLine size={14} />
            Request Draft
          </button>

          {/* Brand selector */}
          {brands.length > 1 && (
            <div className="relative">
              <select
                value={selectedBrandId ?? ''}
                onChange={(e) => setSelectedBrandId(Number(e.target.value))}
                className="appearance-none bg-[rgba(255,255,255,0.05)] border border-[rgba(255,255,255,0.10)] text-[#F0F4F8] rounded-lg pl-3 pr-8 py-2 text-sm focus:outline-none focus:border-[#6366f1]"
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
            <div className="flex gap-0 mb-5 border-b border-[rgba(255,255,255,0.12)]">
              {TABS.map((tab) => (
                <button
                  key={tab.key}
                  onClick={() => setActiveTab(tab.key)}
                  className={`flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
                    activeTab === tab.key
                      ? 'text-[#818CF8] border-[#6366f1] bg-[rgba(255,255,255,0.06)]'
                      : 'text-[#64748B] border-transparent hover:text-[#94A3B8]'
                  }`}
                >
                  {tab.label}
                  {tabCounts[tab.key] > 0 && (
                    <span
                      className={`text-xs rounded-full px-1.5 py-0.5 font-semibold ${
                        activeTab === tab.key
                          ? 'bg-[#6366f1]/20 text-[#6366f1]'
                          : 'bg-[rgba(255,255,255,0.06)] text-[#64748B]'
                      }`}
                    >
                      {tabCounts[tab.key]}
                    </span>
                  )}
                </button>
              ))}
            </div>

            {/* Tab content */}
            <>
              {activeTab === 'drafts' && renderDraftsTab()}
              {activeTab === 'scheduled' && renderScheduledTab()}
              {activeTab === 'opportunities' && renderOpportunitiesTab()}
              {activeTab === 'posted' && renderPostedTab()}
            </>
          </div>

          {/* ── Right panel (30%) — Settings ─────────────────────────────────── */}
          <div className="w-72 shrink-0 flex flex-col gap-4">
            {/* Generate now */}
            <div className="bg-[rgba(255,255,255,0.08)] backdrop-blur-md border border-[rgba(255,255,255,0.12)] rounded-xl p-5 shadow-[0_4px_24px_rgba(0,0,0,0.20)]">
              {draftStatus?.draft_queue_full ? (
                <div className="bg-[#7f1d1d]/15 border border-[#991b1b]/30 rounded-lg px-3 py-2.5 mb-3">
                  <p className="text-xs text-[#f87171] font-medium leading-relaxed">
                    Draft queue full ({draftStatus.draft_cap}/{draftStatus.draft_cap}) — approve or dismiss drafts to generate new ones.
                  </p>
                </div>
              ) : null}
              <button
                onClick={handleGenerateNow}
                disabled={generating || !!draftStatus?.draft_queue_full}
                className="w-full flex items-center justify-center gap-2 bg-[#6366f1] hover:bg-[#4f46e5] disabled:opacity-50 text-white rounded-lg px-4 py-2 text-sm font-semibold transition-all duration-150"
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

            {/* Queue stats */}
            <div className="bg-[rgba(255,255,255,0.08)] backdrop-blur-md border border-[rgba(255,255,255,0.12)] rounded-xl p-4 shadow-[0_4px_24px_rgba(0,0,0,0.20)]">
              <div className="space-y-2.5">
                {draftStatus ? (
                  <>
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-[#64748B]">Drafts</span>
                      <span className={`text-xs font-semibold ${draftStatus.draft_queue_full ? 'text-[#f87171]' : 'text-[#94A3B8]'}`}>
                        {draftStatus.draft_count}/{draftStatus.draft_cap}
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-[#64748B]">Scheduled</span>
                      <span className={`text-xs font-semibold ${draftStatus.scheduled_queue_full ? 'text-[#f87171]' : 'text-[#94A3B8]'}`}>
                        {draftStatus.scheduled_count}/{draftStatus.scheduled_cap}
                      </span>
                    </div>
                  </>
                ) : (
                  <div className="h-8 bg-[rgba(255,255,255,0.08)] rounded animate-pulse" />
                )}
                <div className="border-t border-[rgba(255,255,255,0.06)] pt-2.5 space-y-1.5">
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-[#475569]">Generation schedule</span>
                    <span className="text-xs text-[#475569]">Updated weekly</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-[#475569]">Reddit scan</span>
                    <span className="text-xs text-[#475569]">
                      {draftStatus?.last_scan_at
                        ? relativeTime(draftStatus.last_scan_at)
                        : 'Runs nightly'}
                    </span>
                  </div>
                </div>
              </div>
            </div>

            {/* Weekly refresh note */}
            <div className="bg-[rgba(255,255,255,0.08)] backdrop-blur-md border border-[rgba(255,255,255,0.12)] rounded-xl p-4 shadow-[0_4px_24px_rgba(0,0,0,0.20)]">
              <p className="text-xs text-[#475569] leading-relaxed">
                Draft queue refreshes weekly. Approve drafts before they are replaced.
              </p>
              <p className="text-xs text-[#475569] mt-2 leading-relaxed">
                Configure platforms and frequency in{' '}
                <span className="text-[#6366f1]">Brand Settings</span>.
              </p>
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
      <div className="w-10 h-10 bg-[rgba(255,255,255,0.06)] border border-[rgba(255,255,255,0.10)] rounded-xl flex items-center justify-center mb-3">
        {icon}
      </div>
      <p className="text-sm font-medium text-[#F0F4F8] mb-1">{title}</p>
      <p className="text-xs text-[#64748B] mb-5 max-w-sm">{description}</p>
      {action}
    </div>
  );
}
