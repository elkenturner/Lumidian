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
  AlertTriangle,
  RefreshCw,
  Sparkles,
  HelpCircle,
  Copy,
  Check,
  PenLine,
  BookOpen,
  ArrowRight,
  BarChart2,
  ToggleLeft,
  ToggleRight,
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
  getDraftStatus,
  getBrandProfile,
  getContentSettings,
  updateContentSettings,
  getDraftAttributions,
  getQuoraQuestions,
  triggerScan,
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
import SubscriptionBanner from '@/components/SubscriptionBanner';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useAuth } from '@/contexts/AuthContext';
import { useBrand } from '@/contexts/BrandContext';
import { formatDistanceToNow, parseISO } from 'date-fns';
import Link from 'next/link';
import { ContentTabPanels } from '@/components/content/ContentTabPanels';
import { AppToast, ToastData } from '@/components/AppToast';

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

/** Human-readable label for when "Generate Drafts Now" becomes available again. */
function generateAvailableLabel(nextGenerateAt: string | null): string | null {
  if (!nextGenerateAt) return null;
  try {
    const next = parseISO(nextGenerateAt);
    const now = new Date();
    const diffMs = next.getTime() - now.getTime();
    if (diffMs <= 0) return null;
    const diffHours = diffMs / (1000 * 60 * 60);
    if (diffHours < 1) {
      const mins = Math.ceil(diffMs / (1000 * 60));
      return `Try again in ${mins}m`;
    }
    // Show time-of-day in local time
    const label = next.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    const isToday = next.toDateString() === now.toDateString();
    return isToday ? `Try again today at ${label}` : `Try again tomorrow at ${label}`;
  } catch {
    return 'Try again tomorrow';
  }
}

// ── Subreddit promotion restriction (mirrors backend classification) ──────────

const PROMO_RESTRICTED_SUBREDDITS = new Set([
  'personalfinance','legaladvice','tax','investing','financialindependence',
  'frugal','povertyfinance','studentloans','debtfree','fire',
  'medicine','askdocs','medical','medicaladvice','nursing','pharmacy',
  'mentalhealth','depression','anxiety','bipolar','schizophrenia',
  'chronicpain','diabetes','cancer','epilepsy','ibs','autoimmune',
  'ems','emergencymedicine','veterinary',
  'science','biology','chemistry','physics','neuroscience',
  'psychology','datascience','statistics','academicphilosophy',
  'compsci','machinelearning','artificial',
  'relationships','amitheasshole','relationship_advice','tifu',
  'confessions','grief','survivorsofabuse','ptsd','addiction',
  'askreddit','todayilearned','explainlikeimfive','changemyview',
  'nostupidquestions','worldnews','news','nottheonion',
  'programming','learnprogramming','cscareerquestions','devops',
  'sysadmin','netsec','cybersecurity',
]);
const RESTRICTED_NAME_SIGNALS = ['help','advice','support','care','recover','survivor','anon'];

function isPromoRestricted(subreddit: string): boolean {
  const sub = subreddit.toLowerCase().replace(/^r\//, '');
  if (PROMO_RESTRICTED_SUBREDDITS.has(sub)) return true;
  return RESTRICTED_NAME_SIGNALS.some((kw) => sub.includes(kw));
}

/** Extract subreddit name from opportunity draft content_brief. */
function extractSubreddit(contentBrief: string | null | undefined): string | null {
  if (!contentBrief) return null;
  const m = contentBrief.match(/\bin r\/([A-Za-z0-9_]+)/i);
  return m ? m[1] : null;
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
    <Dialog open={true} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <div className="text-sm text-[#94A3B8] leading-relaxed space-y-3">{children}</div>
      </DialogContent>
    </Dialog>
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

  // ── Quora-specific checks ──────────────────────────────────────────────────
  if (platform === 'quora') {
    const quoraChecks: QualityCheck[] = [];

    // Word count: 250–550 words
    const inRange = wordCount >= 250 && wordCount <= 550;
    quoraChecks.push({
      label: `Length (${wordCount} words)`,
      passed: inRange ? true : 'warning',
      detail: !inRange
        ? wordCount < 250
          ? 'Too short — aim for at least 250 words for a useful Quora answer'
          : 'Getting long — consider trimming below 550 words'
        : undefined,
    });

    // First sentence must not start with filler
    const firstSentence = text.trim().split(/[.!?\n]/)[0].toLowerCase().trim();
    const FILLER_OPENERS = [
      'great question', 'good question', 'interesting question', 'that\'s a great',
      'i think', 'i believe', 'well,', 'so,', 'yes,', 'no,',
      'this is a', 'this is an', 'there are many', 'there are several',
      'it depends', 'it really depends', 'to answer this',
    ];
    const fillerFound = FILLER_OPENERS.find((f) => firstSentence.startsWith(f));
    quoraChecks.push({
      label: 'Direct opening sentence',
      passed: fillerFound ? false : true,
      detail: fillerFound
        ? `Starts with filler: "${fillerFound}" — first sentence must state the direct answer`
        : undefined,
    });

    // Quora-specific brand mention (soft warning, same threshold as generic but separate label)
    if (brandName) {
      const escaped = brandName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const occurrences = (lower.match(new RegExp(escaped, 'gi')) ?? []).length;
      quoraChecks.push({
        label: 'Brand mention',
        passed: occurrences > 3 ? 'warning' : true,
        detail: occurrences > 3
          ? `Mentioned ${occurrences}× — keep it to 1–2 natural mentions`
          : occurrences === 0 ? undefined : undefined,
      });
    }

    // Prohibited phrases + stats (shared checks, still apply)
    if (profile && profile.what_not_to_say.length > 0) {
      const found = profile.what_not_to_say
        .map((p) => p.trim())
        .filter((p) => p && lower.includes(p.toLowerCase()));
      quoraChecks.push({
        label: 'No prohibited phrases',
        passed: found.length === 0,
        detail: found.length > 0 ? `Found: "${found[0]}"` : undefined,
      });
    }
    if (profile && profile.key_stats.length > 0) {
      const textNums = text.match(/\d+(?:[.,]\d+)?%/g) ?? [];
      const unapproved = textNums.filter((n) => !profile.key_stats.some((s) => s.includes(n)));
      quoraChecks.push({
        label: 'Only approved statistics',
        passed: unapproved.length === 0,
        detail: unapproved.length > 0 ? `Unverified stat: ${unapproved[0]}` : undefined,
      });
    }

    return quoraChecks;
  }

  // ── Generic checks (Reddit, Medium) ────────────────────────────────────────
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

  // 3. No hedging phrases — enforced silently at generation time; not surfaced as a user check

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

  // Word count — enforced silently at generation time; not surfaced as a user check

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
        className="w-full flex items-center justify-between px-3 py-2 bg-[rgba(99,102,241,0.06)] hover:bg-[rgba(255,255,255,0.06)] transition-colors"
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
        <div className="divide-y divide-[rgba(99,102,241,0.10)]">
          {checks.map((check) => {
            const icon = check.passed === true ? '✓' : check.passed === 'warning' ? '~' : '⚠';
            const iconColor = check.passed === true
              ? 'text-[#10b981]'
              : check.passed === 'warning'
              ? 'text-[#f59e0b]'
              : 'text-[#ef4444]';
            return (
              <div key={check.label} className="flex items-start gap-2.5 px-3 py-2">
                <span className={`text-xs mt-0.5 flex-shrink-0 font-bold ${iconColor}`} aria-hidden="true">{icon}</span>
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

// ── Simple markdown-to-html renderer for preview mode ─────────────────────────

function renderPreviewHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/^#{3}\s+(.+)$/gm, '<h3 style="font-size:14px;font-weight:700;margin:10px 0 4px">$1</h3>')
    .replace(/^#{2}\s+(.+)$/gm, '<h2 style="font-size:16px;font-weight:700;margin:12px 0 6px">$1</h2>')
    .replace(/^#{1}\s+(.+)$/gm, '<h1 style="font-size:18px;font-weight:800;margin:14px 0 6px">$1</h1>')
    .replace(/\n{2,}/g, '</p><p style="margin:8px 0">')
    .replace(/\n/g, '<br/>');
}

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
    } finally {
      setSaving(false);
    }
  }

  const borderClass = isLowQuality
    ? 'border-l-[3px] border-l-[#ef4444]/50 border-[rgba(99,102,241,0.22)]'
    : 'border-[rgba(99,102,241,0.22)]';

  return (
    <div className={`bg-[rgba(99,102,241,0.06)] backdrop-blur-md border rounded-xl p-5 flex flex-col gap-3 hover:border-[rgba(255,255,255,0.14)] shadow-[0_4px_24px_rgba(0,0,0,0.20)] transition-colors ${borderClass}`}>
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
            <span className="text-[#f97316] text-xs flex-shrink-0">↗</span>
            <span className="text-xs text-[#f97316] font-medium flex-1 min-w-0 truncate">
              {draft.content_brief ?? 'Reply directly in this thread'}
            </span>
            <ExternalLink size={11} className="text-[#f97316]/60 flex-shrink-0 group-hover:text-[#f97316]" />
          </a>
          {(() => {
            const sub = extractSubreddit(draft.content_brief);
            if (!sub || !isPromoRestricted(sub)) return null;
            return (
              <div className="flex items-center gap-1.5 text-[10px] text-[#f59e0b] bg-[rgba(245,158,11,0.08)] border border-[rgba(245,158,11,0.20)] rounded-md px-2.5 py-1.5">
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
            <div className="border border-[rgba(99,102,241,0.22)] rounded-lg p-3 bg-[rgba(0,0,0,0.2)]">
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
                  className="flex items-center gap-1.5 text-xs bg-[#6366f1] hover:bg-[#4f46e5] disabled:opacity-40 text-white rounded-lg px-3 py-1.5 transition-colors"
                >
                  {regenerating ? <Loader2 size={11} className="animate-spin" /> : <RefreshCw size={11} />}
                  Regenerate with this question
                </button>
                <button
                  onClick={() => { setShowQuoraPicker(false); setPendingQuestion(null); }}
                  className="text-xs text-[#475569] hover:text-[#94A3B8] transition-colors px-2 py-1.5"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <button
              onClick={() => setShowQuoraPicker(true)}
              className="flex items-center gap-1.5 text-[10px] text-[#475569] hover:text-[#818cf8] transition-colors self-start"
            >
              <RefreshCw size={10} />
              Find different question
            </button>
          )}
        </div>
      ) : draft.content_brief && draft.platform === 'quora' ? (
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
            className="w-full bg-[rgba(255,255,255,0.05)] border border-[rgba(255,255,255,0.10)] text-[#F0F4F8] rounded-lg px-3 py-2 text-sm placeholder:text-[#475569] focus:outline-none focus:border-[#6366f1] focus:ring-2 focus:ring-[#6366f1]/50"
          />
          <textarea
            value={editContent}
            onChange={(e) => setEditContent(e.target.value)}
            rows={8}
            className="w-full bg-[rgba(255,255,255,0.05)] border border-[rgba(255,255,255,0.10)] text-[#F0F4F8] rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#6366f1] focus:ring-2 focus:ring-[#6366f1]/50 resize-none font-mono"
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
          {/* Target prompt line */}
          {targetPrompt && (
            <div className="flex items-start gap-1.5 mb-2">
              <span className="text-[10px] text-[#475569] uppercase tracking-wide font-medium mt-0.5 flex-shrink-0">Targeting</span>
              <span className="text-[11px] text-[#6366f1] bg-[rgba(99,102,241,0.08)] border border-[rgba(99,102,241,0.22)] rounded-md px-2 py-0.5 leading-relaxed">{targetPrompt.text}</span>
            </div>
          )}
          {draft.title && (
            <p className="text-sm font-semibold text-[#F0F4F8] leading-snug mb-1">{draft.title}</p>
          )}
          {/* Preview / Raw toggle */}
          <div className="flex items-center justify-between mb-1.5">
            <div className="flex items-center gap-1 bg-[rgba(255,255,255,0.04)] border border-[rgba(255,255,255,0.08)] rounded-md p-0.5">
              <button
                onClick={() => setPreviewMode(false)}
                className={`px-2 py-0.5 rounded text-[10px] font-medium transition-colors ${!previewMode ? 'bg-[rgba(99,102,241,0.25)] text-[#818cf8]' : 'text-[#475569] hover:text-[#64748B]'}`}
              >Raw</button>
              <button
                onClick={() => setPreviewMode(true)}
                className={`px-2 py-0.5 rounded text-[10px] font-medium transition-colors ${previewMode ? 'bg-[rgba(99,102,241,0.25)] text-[#818cf8]' : 'text-[#475569] hover:text-[#64748B]'}`}
              >Preview</button>
            </div>
            <span className="text-[10px] text-[#475569]">{wordCount} words</span>
          </div>
          {previewMode ? (
            <div
              className="text-sm text-[#94A3B8] leading-relaxed overflow-y-auto bg-[rgba(255,255,255,0.04)] border border-[rgba(255,255,255,0.06)] rounded-lg p-3"
              style={{ maxHeight: '12rem', scrollbarWidth: 'thin', scrollbarColor: 'rgba(255,255,255,0.10) transparent' }}
              dangerouslySetInnerHTML={{ __html: `<p style="margin:0">${renderPreviewHtml(draft.content_text)}</p>` }}
            />
          ) : (
            <div
              className="text-sm text-[#64748B] leading-relaxed overflow-y-auto"
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
            className="flex items-center gap-1.5 text-xs bg-[rgba(255,255,255,0.06)] hover:bg-[rgba(255,255,255,0.10)] border border-[rgba(255,255,255,0.10)] text-[#94A3B8] hover:text-[#F0F4F8] rounded-lg px-3 py-1.5 transition-colors"
          >
            <Edit2 size={11} />
            Edit
          </button>
          <button
            onClick={handleCopy}
            className={`flex items-center gap-1.5 text-xs rounded-lg px-3 py-1.5 transition-colors border ${
              copied
                ? 'bg-[#064e3b]/20 border-[#065f46]/25 text-[#34d399]'
                : 'bg-[rgba(255,255,255,0.06)] border-[rgba(255,255,255,0.10)] text-[#94A3B8] hover:text-[#F0F4F8] hover:bg-[rgba(255,255,255,0.10)]'
            }`}
          >
            {copied ? <Check size={11} /> : <Copy size={11} />}
            {copied ? 'Copied!' : 'Copy'}
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

      <div className="bg-[rgba(99,102,241,0.06)] backdrop-blur-md border border-[rgba(99,102,241,0.22)] rounded-xl p-5 flex flex-col gap-3 hover:border-[rgba(255,255,255,0.14)] shadow-[0_4px_24px_rgba(0,0,0,0.20)] transition-colors">
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
          </div>
        </div>

        {/* Where to insert */}
        {insertLocation && (
          <div className="bg-[rgba(255,255,255,0.06)] border border-[rgba(99,102,241,0.22)] rounded-lg px-3 py-2.5">
            <p className="text-xs text-[#64748B] uppercase tracking-wide mb-1 font-medium">Where to insert</p>
            <p className="text-xs text-[#94A3B8] leading-relaxed">{insertLocation}</p>
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
              className="w-full bg-[rgba(255,255,255,0.05)] border border-[rgba(255,255,255,0.10)] text-[#F0F4F8] rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-[#6366f1] focus:ring-2 focus:ring-[#6366f1]/50 resize-none leading-relaxed font-sans"
              placeholder="Edit the plain text. Wiki formatting and citations are applied automatically."
            />
            <p className="text-[10px] text-[#475569]">
              Edit in plain text — wiki links, citations, and markup are applied automatically when you copy.
            </p>
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
            {/* Raw / Preview toggle */}
            <div className="flex items-center justify-between mb-1.5">
              <div className="flex items-center gap-1 bg-[rgba(255,255,255,0.04)] border border-[rgba(255,255,255,0.08)] rounded-md p-0.5">
                <button
                  onClick={() => setViewMode('preview')}
                  className={`px-2 py-0.5 rounded text-[10px] font-medium transition-colors ${viewMode === 'preview' ? 'bg-[rgba(99,102,241,0.25)] text-[#818cf8]' : 'text-[#475569] hover:text-[#64748B]'}`}
                >Preview</button>
                <button
                  onClick={() => setViewMode('raw')}
                  className={`px-2 py-0.5 rounded text-[10px] font-medium transition-colors ${viewMode === 'raw' ? 'bg-[rgba(99,102,241,0.25)] text-[#818cf8]' : 'text-[#475569] hover:text-[#64748B]'}`}
                >Raw</button>
              </div>
              <span className="text-[10px] text-[#475569]">{wordCount} words</span>
            </div>

            {viewMode === 'raw' ? (
              <pre
                className="text-xs text-[#94A3B8] leading-relaxed overflow-y-auto bg-[rgba(255,255,255,0.03)] border border-[rgba(255,255,255,0.06)] rounded-lg p-3 whitespace-pre-wrap font-mono"
                style={{ maxHeight: '12rem', scrollbarWidth: 'thin', scrollbarColor: 'rgba(255,255,255,0.10) transparent' }}
              >
                {wikiFormat}
              </pre>
            ) : (
              <div
                className="text-sm text-[#94A3B8] leading-relaxed overflow-y-auto bg-[rgba(255,255,255,0.04)] border border-[rgba(255,255,255,0.06)] rounded-lg p-3"
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
                  ? 'bg-[#064e3b]/20 border border-[#065f46]/25 text-[#34d399]'
                  : 'bg-[#6366f1] hover:bg-[#4f46e5] text-white'
              }`}
            >
              {copied ? <Check size={11} /> : <Copy size={11} />}
              {copied ? 'Copied!' : 'Copy Wiki Format'}
            </button>
            <button
              onClick={() => setEditing(true)}
              className="flex items-center gap-1.5 text-xs bg-[rgba(255,255,255,0.06)] hover:bg-[rgba(255,255,255,0.10)] border border-[rgba(255,255,255,0.10)] text-[#94A3B8] hover:text-[#F0F4F8] rounded-lg px-3 py-1.5 transition-colors"
            >
              <Edit2 size={11} />
              Edit
            </button>
            <button
              onClick={() => onDelete(draft.id)}
              className="flex items-center gap-1.5 text-xs text-[#475569] hover:text-[#f87171] rounded-lg px-3 py-1.5 transition-colors ml-auto"
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
      .catch(() => { setQuestions([]); setSearched(true); })
      .finally(() => setLoading(false));
  }, [brandId, promptId]);

  if (!promptId) return null;

  if (loading) {
    return (
      <div className="flex items-center gap-2 py-2 text-xs text-[#64748B]">
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
            <p className="text-[10px] text-[#475569] mt-1 line-clamp-2 leading-relaxed">{selected.snippet}</p>
          )}
        </div>
        <button
          onClick={() => onSelect(null)}
          className="flex-shrink-0 text-[#475569] hover:text-[#94A3B8] transition-colors ml-1"
          aria-label="Remove selected question"
        >
          <X size={12} />
        </button>
      </div>
    );
  }

  if (searched && questions.length === 0) {
    return (
      <p className="text-xs text-[#475569] py-1">
        No Quora questions found — the draft will be a general answer. You can find a question manually at quora.com.
      </p>
    );
  }

  return (
    <div className="space-y-1.5">
      <p className="text-[10px] text-[#64748B] uppercase tracking-wide font-medium">
        Select a Quora question to target
      </p>
      {questions.map((q) => (
        <button
          key={q.url}
          onClick={() => onSelect(q)}
          className="w-full text-left flex items-start gap-2.5 bg-[rgba(255,255,255,0.03)] hover:bg-[rgba(99,102,241,0.08)] border border-[rgba(255,255,255,0.08)] hover:border-[rgba(99,102,241,0.25)] rounded-lg px-3 py-2.5 transition-colors group"
        >
          <span className="text-[#6366f1] text-xs mt-0.5 flex-shrink-0">Q</span>
          <div className="flex-1 min-w-0">
            <span className="text-xs text-[#CBD5E1] group-hover:text-[#F0F4F8] transition-colors line-clamp-2 block">
              {q.title}
            </span>
            {q.snippet && (
              <span className="text-[10px] text-[#475569] line-clamp-1 block mt-0.5 leading-relaxed">
                {q.snippet}
              </span>
            )}
          </div>
          <span className="text-[10px] text-[#475569] group-hover:text-[#6366f1] flex-shrink-0 mt-0.5 transition-colors">
            Select →
          </span>
        </button>
      ))}
    </div>
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
  const [selectedQuestion, setSelectedQuestion] = useState<QuoraQuestion | null>(null);

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
        quora_question_url: selectedQuestion?.url,
        quora_question_title: selectedQuestion?.title,
        quora_question_snippet: selectedQuestion?.snippet,
      });
      onCreated(draft);
      onClose();
    } catch (e: unknown) {
      const err = e as { response?: { data?: { detail?: string } } };
      setError(err?.response?.data?.detail ?? 'Draft generation failed. Check that API keys are configured.');
    } finally {
      setCreating(false);
    }
  }

  return (
    <Dialog open={true} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Request a Draft</DialogTitle>
          <p className="text-xs text-[#64748B] mt-0.5">Generate a targeted draft for a specific prompt or topic</p>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          {/* Platform */}
          <div>
            <label className="text-xs text-[#64748B] font-medium uppercase tracking-wide mb-1.5 block">Platform</label>
            <div className="grid grid-cols-4 gap-2">
              {DRAFT_PLATFORMS.map((p) => (
                <button
                  key={p}
                  onClick={() => { setPlatform(p); if (p !== 'quora') setSelectedQuestion(null); }}
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
                className="w-full appearance-none bg-[rgba(255,255,255,0.05)] border border-[rgba(255,255,255,0.10)] text-[#F0F4F8] rounded-lg pl-3 pr-8 py-2 text-sm focus:outline-none focus:border-[#6366f1] focus:ring-2 focus:ring-[#6366f1]/50"
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

          {/* Quora question picker */}
          {platform === 'quora' && (
            <div>
              <label className="text-xs text-[#64748B] font-medium uppercase tracking-wide mb-2 block">
                Target Question <span className="text-[#475569] normal-case font-normal">(optional — picks a real Quora question)</span>
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
            <label className="text-xs text-[#64748B] font-medium uppercase tracking-wide mb-1.5 block">
              Custom Topic <span className="text-[#475569] normal-case font-normal">(or leave blank to use prompt)</span>
            </label>
            <input
              type="text"
              value={customTopic}
              onChange={(e) => setCustomTopic(e.target.value)}
              placeholder="e.g. Why Rainbow Study matters for oncologists"
              className="w-full bg-[rgba(255,255,255,0.05)] border border-[rgba(255,255,255,0.10)] text-[#F0F4F8] rounded-lg px-3 py-2 text-sm placeholder:text-[#475569] focus:outline-none focus:border-[#6366f1] focus:ring-2 focus:ring-[#6366f1]/50"
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
              className="w-full bg-[rgba(255,255,255,0.05)] border border-[rgba(255,255,255,0.10)] text-[#F0F4F8] rounded-lg px-3 py-2 text-sm placeholder:text-[#475569] focus:outline-none focus:border-[#6366f1] focus:ring-2 focus:ring-[#6366f1]/50 resize-none"
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
      </DialogContent>
    </Dialog>
  );
}

// ── Opportunity card (Live Opportunities tab) ─────────────────────────────────

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
      ? 'text-[#10b981]'
      : opp.relevance_score >= 40
      ? 'text-[#f59e0b]'
      : 'text-[#64748B]';

  return (
    <div className="bg-[rgba(99,102,241,0.06)] backdrop-blur-md border border-[rgba(99,102,241,0.22)] rounded-xl p-4 flex flex-col gap-3 hover:border-[rgba(255,255,255,0.14)] shadow-[0_4px_24px_rgba(0,0,0,0.20)] transition-colors">
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
        {opp.posted_at && (
          <span className="flex items-center gap-1">
            <Clock size={10} />
            {relativeTime(opp.posted_at)}
          </span>
        )}
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
          disabled={drafting || queueFull}
          title={queueFull ? 'Draft queue full — approve or dismiss drafts to make room' : undefined}
          className="flex items-center gap-1.5 text-xs bg-[#6366f1] hover:bg-[#4f46e5] disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-lg px-3 py-1.5 transition-colors"
        >
          {drafting ? <Loader2 size={11} className="animate-spin" /> : <Sparkles size={11} />}
          {drafting ? 'Drafting…' : queueFull ? 'Queue full' : 'Draft Reply'}
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
      <li>Go to <a href="https://medium.com/new-story" target="_blank" rel="noopener noreferrer" className="text-[#6366f1] hover:underline">medium.com/new-story</a></li>
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
    <div className="bg-[rgba(99,102,241,0.06)] backdrop-blur-md border border-[rgba(99,102,241,0.22)] rounded-xl p-4 flex flex-col gap-3 hover:border-[rgba(255,255,255,0.14)] shadow-[0_4px_24px_rgba(0,0,0,0.20)] transition-colors">
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
        <div className="bg-[rgba(99,102,241,0.06)] border border-[rgba(255,255,255,0.10)] rounded-lg p-3 relative">
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
        <div className="border border-[rgba(99,102,241,0.22)] rounded-lg overflow-hidden">
          <button
            onClick={() => setGuideOpen(!guideOpen)}
            className="w-full flex items-center justify-between px-3 py-2 bg-[rgba(99,102,241,0.06)] hover:bg-[rgba(255,255,255,0.06)] text-left transition-colors"
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

      {/* Manual posting reminder */}
      <div className="bg-[rgba(16,185,129,0.05)] border border-[rgba(16,185,129,0.12)] rounded-lg px-3 py-2 flex items-start gap-2">
        <HelpCircle size={11} className="text-[#10b981] mt-0.5 shrink-0" />
        <p className="text-[11px] text-[#475569] leading-relaxed">
          <span className="text-[#64748B] font-medium">This draft needs to be posted manually.</span>
          {' '}Use the View Draft button to copy the content, post it on {draft.platform.charAt(0).toUpperCase() + draft.platform.slice(1)}, then click{' '}
          <span className="text-[#34d399]">Mark as Posted</span> to record it and start tracking visibility changes.
        </p>
      </div>

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

function PostedCard({ draft, attribution }: { draft: ContentDraft; attribution?: DraftAttribution }) {
  const [expanded, setExpanded] = useState(false);
  const title = draft.title ?? draft.content_text.slice(0, 80) + (draft.content_text.length > 80 ? '…' : '');

  // Confidence tier based on number of tracking runs since posting
  type ConfidenceTier = 'awaiting' | 'early' | 'developing' | 'established';
  function getConfidenceTier(runs: number): ConfidenceTier {
    if (runs === 0) return 'awaiting';
    if (runs <= 2) return 'early';
    if (runs <= 5) return 'developing';
    return 'established';
  }
  const TIER_LABELS: Record<ConfidenceTier, string> = {
    awaiting: 'Awaiting next report',
    early: 'Early data',
    developing: 'Developing',
    established: 'Established',
  };
  const TIER_COLORS: Record<ConfidenceTier, string> = {
    awaiting: '#475569',
    early: '#64748B',
    developing: '#818cf8',
    established: '#10b981',
  };

  let attributionNode: JSX.Element | null = null;
  if (attribution) {
    const tier = getConfidenceTier(attribution.runs_since_posting);
    const tierColor = TIER_COLORS[tier];
    const tierLabel = TIER_LABELS[tier];

    if (tier === 'awaiting') {
      attributionNode = (
        <div className="flex items-center gap-1.5 mt-1">
          <span className="text-[10px] px-1.5 py-0.5 rounded-full border" style={{ color: tierColor, borderColor: `${tierColor}40`, backgroundColor: `${tierColor}10` }}>
            {tierLabel}
          </span>
          <span className="text-xs text-[#475569]">Next tracking run will measure visibility change.</span>
        </div>
      );
    } else {
      const scoreBefore = attribution.score_at_posting;
      const scoreNow = attribution.current_score ?? 0;
      const delta = attribution.delta;
      const deltaColor = delta == null ? '#94A3B8' : delta > 0 ? '#10b981' : delta < 0 ? '#f87171' : '#94A3B8';
      const deltaLabel = delta == null ? '—' : delta > 0 ? `+${delta.toFixed(1)}pp` : `${delta.toFixed(1)}pp`;
      const runs = attribution.runs_since_posting;

      attributionNode = (
        <div className="mt-2 flex flex-col gap-1.5">
          <div className="flex items-center gap-3 flex-wrap">
            {scoreBefore != null && (
              <div className="flex items-center gap-1">
                <span className="text-[10px] text-[#475569]">At posting</span>
                <span className="text-xs font-medium text-[#94A3B8]">{scoreBefore.toFixed(1)}%</span>
              </div>
            )}
            {scoreBefore != null && <ArrowRight size={10} className="text-[#475569]" />}
            <div className="flex items-center gap-1">
              <span className="text-[10px] text-[#475569]">Now</span>
              <span className="text-xs font-medium text-[#E2E8F0]">{scoreNow.toFixed(1)}%</span>
            </div>
            {delta != null && (
              <span className="text-xs font-semibold" style={{ color: deltaColor }}>{deltaLabel}</span>
            )}
            <span className="text-[10px] px-1.5 py-0.5 rounded-full border ml-auto" style={{ color: tierColor, borderColor: `${tierColor}40`, backgroundColor: `${tierColor}10` }}>
              {tierLabel}
            </span>
          </div>
          <p className="text-[10px] text-[#475569] leading-relaxed">
            Based on {runs} tracking run{runs !== 1 ? 's' : ''} since posting.{' '}
            {tier === 'early' && 'More data needed before drawing conclusions.'}
            {tier === 'developing' && 'Trend is forming — keep an eye on the next few runs.'}
            {tier === 'established' && 'Sufficient data to observe a trend (correlation, not causation).'}
          </p>
        </div>
      );
    }
  } else if (draft.visibility_at_post != null) {
    attributionNode = (
      <div className="flex items-center gap-1 mt-1">
        <span className="text-[10px] text-[#475569]">Brand visibility at time of posting:</span>
        <span className="text-xs font-medium text-[#94A3B8]">{draft.visibility_at_post.toFixed(1)}%</span>
      </div>
    );
  }

  return (
    <div className="bg-[rgba(99,102,241,0.06)] backdrop-blur-md border border-[rgba(99,102,241,0.22)] rounded-xl p-4 flex flex-col gap-2 shadow-[0_4px_24px_rgba(0,0,0,0.20)] hover:border-[rgba(255,255,255,0.14)] transition-colors">
      {/* Top row */}
      <div className="flex items-center gap-2">
        <PlatformBadge platform={draft.platform} />
        <p className="flex-1 text-sm text-[#94A3B8] truncate">{title}</p>
        <button
          onClick={() => setExpanded(!expanded)}
          className="text-[10px] text-[#475569] hover:text-[#64748B] transition-colors shrink-0"
        >
          {expanded ? 'Hide' : 'View'}
        </button>
        <span className="text-xs text-[#475569] shrink-0">{relativeTime(draft.updated_at)}</span>
      </div>

      {/* Expanded content */}
      {expanded && (
        <div className="bg-[rgba(255,255,255,0.03)] border border-[rgba(255,255,255,0.06)] rounded-lg p-3">
          <pre className="text-xs text-[#64748B] whitespace-pre-wrap leading-relaxed font-mono">{draft.content_text}</pre>
        </div>
      )}

      {/* Attribution */}
      {attributionNode && (
        <div className="border-t border-[rgba(255,255,255,0.05)] pt-2">
          <p className="text-[10px] text-[#475569] uppercase tracking-wide mb-1 flex items-center gap-1">
            <BarChart2 size={9} />
            Visibility change since posting
          </p>
          {attributionNode}
        </div>
      )}
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function ContentHubPage() {
  const { user } = useAuth();
  const { brands, activeBrandId: selectedBrandId, setActiveBrandId: setSelectedBrandId, loading: brandsLoading } = useBrand();
  const [activeTab, setActiveTab] = useState<QueueTab>('drafts');
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
    if (tab === 'opportunities' || tab === 'scheduled' || tab === 'posted') {
      setActiveTab(tab as QueueTab);
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
  const [contentSettings, setContentSettings] = useState<BrandContentSettings[]>([]);

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

  const [savedPlatform, setSavedPlatform] = useState<string | null>(null);
  useEffect(() => {
    if (!savedPlatform) return;
    const t = setTimeout(() => setSavedPlatform(null), 2000);
    return () => clearTimeout(t);
  }, [savedPlatform]);

  // Platform filtering
  const _disabledPlatforms = new Set(
    contentSettings.filter((s) => !s.enabled).map((s) => s.platform)
  );

  // Active platform filter (All / specific platform)
  const [platformFilter, setPlatformFilter] = useState<string>('all');

  // Tab counts (using filtered draft/scheduled counts)
  const tabCounts = {
    drafts: draftItems.filter((d) => !_disabledPlatforms.has(d.platform)).length,
    scheduled: scheduledItems.filter((d) => !_disabledPlatforms.has(d.platform)).length,
    opportunities: opportunities.length,
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
        getBrandProfile(brandId).catch(() => null),
        getBrand(brandId).catch(() => null),
        getContentSettings(brandId).catch(() => [] as BrandContentSettings[]),
        getDraftStatus(brandId).catch(() => null),
        getDraftAttributions(brandId).catch(() => [] as DraftAttribution[]),
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

  // ── Draft actions ──────────────────────────────────────────────────────────

  async function handleApprove(id: number) {
    if (draftStatus?.scheduled_queue_full) {
      alert(`Scheduled queue is full (${draftStatus.scheduled_cap}/${draftStatus.scheduled_cap}). Mark some drafts as posted before approving more.`);
      return;
    }
    try {
      await updateDraft(id, { status: 'approved' });
    } catch (e: unknown) {
      const err = e as { response?: { data?: { detail?: string }; status?: number } };
      const detail = err?.response?.data?.detail ?? '';
      if (detail.includes('queue is full') || err?.response?.status === 409) {
        alert(detail || 'Scheduled queue is full. Mark some drafts as posted first.');
        return;
      }
      throw e;
    }
    if (selectedBrandId) loadAll(selectedBrandId);
    setToast({ message: 'Draft approved', type: 'success' });
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
    await deleteDraft(id);
    setDraftItems((prev) => prev.filter((d) => d.id !== id));
    setScheduledItems((prev) => prev.filter((d) => d.id !== id));
    setDraftStatus((prev) =>
      prev ? { ...prev, draft_count: Math.max(0, prev.draft_count - 1) } : prev
    );
    setToast({ message: 'Draft dismissed', type: 'info' });
  }

  function handleSaved(updated: ContentDraft) {
    setDraftItems((prev) => prev.map((d) => (d.id === updated.id ? updated : d)));
  }

  // ── Opportunity actions ────────────────────────────────────────────────────

  async function handleDraftOpportunity(oppId: number) {
    if (draftStatus?.draft_queue_full) {
      alert(`Draft queue is full (${draftStatus.draft_cap}/${draftStatus.draft_cap}). Approve or dismiss drafts to make room.`);
      return;
    }
    try {
      const draft = await draftOpportunity(oppId);
      setOpportunities((prev) => prev.filter((o) => o.id !== oppId));
      setDraftItems((prev) => [draft, ...prev]);
      setPinnedDraftId(draft.id);
      // Refresh status so the count is accurate
      if (selectedBrandId) getDraftStatus(selectedBrandId).then(setDraftStatus).catch(() => {});
      setActiveTab('drafts');
    } catch (e: unknown) {
      const err = e as { response?: { data?: { detail?: string } } };
      const detail = err?.response?.data?.detail ?? 'Failed to draft reply. Try again.';
      alert(detail);
    }
  }

  async function handleDismissOpportunity(oppId: number) {
    await dismissOpportunity(oppId);
    setOpportunities((prev) => prev.filter((o) => o.id !== oppId));
    setToast({ message: 'Opportunity dismissed', type: 'info' });
  }

  // ── Right panel actions ────────────────────────────────────────────────────

  async function handleGenerateNow() {
    if (!selectedBrandId) return;
    setGenerating(true);
    setGenerateError(null);

    const brandId = selectedBrandId;

    // Clear drafts UI immediately to show we're refreshing
    setDraftItems([]);
    setActiveTab('drafts');

    try {
      // Backend clears existing drafts and returns new ones synchronously
      const newDrafts = await generateNow(brandId);

      // Update draft status
      const status = await getDraftStatus(brandId);
      setDraftStatus(status);

      // Load all drafts fresh (including the new ones)
      await loadAll(brandId);

      setGenerating(false);

      // Show contextual message about results
      const promptCount = brandPrompts.length;
      if (newDrafts.length >= 20) {
        setToast({ message: `Generated ${newDrafts.length} new drafts`, type: 'success' });
      } else if (newDrafts.length === 0) {
        setToast({ message: 'No drafts generated. Add more prompts or run a tracking scan first.', type: 'info' });
      } else if (promptCount <= 3) {
        setToast({
          message: `Generated ${newDrafts.length} drafts (limited by ${promptCount} prompt${promptCount === 1 ? '' : 's'})`,
          type: 'success'
        });
      } else {
        setToast({ message: `Generated ${newDrafts.length} new drafts`, type: 'success' });
      }
    } catch (e: unknown) {
      const err = e as { response?: { data?: { detail?: string }; status?: number }; message?: string };
      const raw = err?.response?.data?.detail ?? err?.message ?? 'Generation failed. Check that API keys are configured in Settings.';
      const detail = raw.toLowerCase().includes('no content gaps')
        ? 'No content gaps found yet. Run a tracking scan first to identify gaps, then try again.'
        : raw;
      setGenerateError(detail);
      setGenerating(false);
      // Refresh drafts and status in case partial generation happened
      getDraftStatus(brandId).then(setDraftStatus).catch(() => {});
      loadAll(brandId).catch(() => {});
    }
  }

  const handleScanNow = useCallback(async () => {
    if (!selectedBrandId || scanning) return;
    setScanning(true);

    // Clear existing opportunities immediately so UI shows loading state
    setOpportunities([]);

    try {
      await triggerScan(selectedBrandId);

      // Poll until scan completes (opportunities count stabilizes or timeout)
      const brandId = selectedBrandId;
      const deadline = Date.now() + 60_000; // 60s timeout
      let prevCount = 0;
      let stableStreak = 0;

      const poll = async (): Promise<void> => {
        if (Date.now() > deadline) {
          // Timeout - fetch whatever we have
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
        const ops = await getOpportunities(brandId);
        const count = ops.length;

        // Track stability: count matches previous (including 0)
        if (count === prevCount) {
          stableStreak++;
        } else {
          stableStreak = 0;
        }
        prevCount = count;

        // Stable for 3 consecutive polls (6 seconds) = done
        // Use 3 polls to ensure backend scanner has finished
        if (stableStreak >= 3) {
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
                : `No matching threads found on Reddit or Quora right now.`,
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
      setToast({ message: 'Scan failed. Please try again.', type: 'error' });
    }
  }, [selectedBrandId, scanning, brandPrompts.length]);

  async function handleTogglePlatform(platform: string, enabled: boolean) {
    if (!selectedBrandId) return;
    const updated = await updateContentSettings(selectedBrandId, platform, { enabled }).catch(() => null);
    if (updated) {
      setContentSettings((prev) =>
        prev.map((s) => (s.platform === platform ? { ...s, ...updated } : s))
      );
      setSavedPlatform(platform);
    }
  }

  // Filter drafts to only show enabled platforms + active platform filter
  const oppScanEnabled = !_disabledPlatforms.has('reddit') || !_disabledPlatforms.has('quora');
  const visibleDraftItems = draftItems.filter(
    (d) => !_disabledPlatforms.has(d.platform) && (platformFilter === 'all' || d.platform === platformFilter)
  );
  const visibleScheduledItems = scheduledItems.filter((d) => !_disabledPlatforms.has(d.platform));
  const visibleOpportunities = opportunities.filter(
    (o) => platformFilter === 'all' || o.platform === platformFilter
  );

  const TABS: { key: QueueTab; label: string }[] = [
    ...(oppScanEnabled ? [{ key: 'opportunities' as QueueTab, label: 'Live Opportunities' }] : []),
    { key: 'drafts', label: 'Drafts' },
    { key: 'scheduled', label: 'Scheduled' },
    { key: 'posted', label: 'Posted' },
  ];

  return (
    <div className="px-4 sm:px-8 py-6 sm:py-8 max-w-[1400px]">
      {/* Subscription status banner */}
      {user?.subscription_status && ['past_due', 'canceled', 'unpaid'].includes(user.subscription_status) && (
        <div className="-mx-8 -mt-8 mb-6">
          <SubscriptionBanner status={user.subscription_status} />
        </div>
      )}

      {/* Progress banner for regeneration actions */}
      {(generating || scanning) && (
        <div className="mb-6 bg-[rgba(99,102,241,0.12)] border border-[rgba(99,102,241,0.3)] rounded-xl px-5 py-4 flex items-center gap-3">
          <Loader2 size={18} className="animate-spin text-[#818cf8]" />
          <div>
            <p className="text-sm font-medium text-[#F0F4F8]">
              {generating ? 'Generating fresh drafts…' : 'Scanning Reddit & Quora…'}
            </p>
            <p className="text-xs text-[#94A3B8] mt-0.5">
              {generating
                ? 'Creating up to 20 AI drafts. This takes about 30 seconds.'
                : 'Finding new content opportunities. This takes about 15 seconds.'}
            </p>
          </div>
        </div>
      )}

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
          <p>Content Hub generates AI drafts for your brand and surfaces Reddit and Quora threads where you can contribute.</p>
          <ul className="space-y-2 mt-2">
            <li><span className="text-[#F0F4F8] font-medium">Regenerate Drafts</span> — replaces all existing drafts with a fresh batch across your tracked prompts and platforms.</li>
            <li><span className="text-[#F0F4F8] font-medium">Live Opportunities</span> tab updates daily as Reddit and Quora are scanned overnight for threads matching your tracked prompts.</li>
            <li><span className="text-[#F0F4F8] font-medium">Drafts tab</span> — review, edit, and approve AI drafts before they go live.</li>
            <li><span className="text-[#F0F4F8] font-medium">Scheduled tab</span> — approved drafts ready to post. Copy the text, post it manually, then click Mark as Posted.</li>
            <li><span className="text-[#F0F4F8] font-medium">Live Opportunities</span> — Reddit threads and Quora questions where a thoughtful reply could improve your brand&apos;s visibility.</li>
            <li><span className="text-[#F0F4F8] font-medium">Posted tab</span> — content that has been marked as posted.</li>
            <li><span className="text-[#F0F4F8] font-medium">Brand Settings</span> — control which platforms generate drafts and how frequently.</li>
          </ul>
        </HelpModal>
      )}
      {oppHelpOpen && (
        <HelpModal title="Live Opportunities" onClose={() => setOppHelpOpen(false)}>
          <p>Reddit threads and Quora questions where your brand can meaningfully contribute.</p>
          <p>Scanners search for content matching your tracked prompts. Only results with a relevance score of 40+ are shown.</p>
          <ul className="space-y-2 mt-2">
            <li><span className="text-[#F0F4F8] font-medium">Relevance score</span> — how closely the thread or question matches your tracked prompts, based on keyword overlap, recency, and engagement.</li>
            <li><span className="text-[#F0F4F8] font-medium">Draft Reply</span> — generates an AI reply using your brand voice guidelines.</li>
            <li><span className="text-[#F0F4F8] font-medium">Dismiss</span> — removes the opportunity from this list.</li>
          </ul>
          <p className="text-[#64748B] text-xs mt-2">Scanners run automatically every night at 2:00 AM UTC.</p>
        </HelpModal>
      )}

      {/* Posting Guide modal — centered */}
      {postingGuideOpen && (() => {
        const PLATFORMS = {
          reddit: {
            label: 'Reddit',
            subtitle: 'Discussion posts & replies',
            color: '#ff4500',
            colorMuted: 'rgba(255,69,0,0.12)',
            colorBorder: 'rgba(255,69,0,0.22)',
            steps: [
              { title: 'Pick a subreddit', detail: 'Search your niche — r/entrepreneur, r/investing, etc. Target 10k+ member subs with active daily threads. Read the rules before posting; many ban all promotion.' },
              { title: 'Write a real title', detail: 'Frame a genuine question or insight, not a product pitch. Curiosity and controversy outperform announcements.' },
              { title: 'Paste & clean the draft', detail: 'Remove anything that reads like an ad before submitting. If it sounds promotional to you, it will to moderators too.' },
              { title: 'Engage in the first hour', detail: 'Reply to every comment — early engagement determines ranking. Set a reminder to check back 30 minutes after posting.' },
            ],
            disclosure: 'Add "Disclosure: I work at [Brand]" at the end of your post.',
            tip: null,
          },
          quora: {
            label: 'Quora',
            subtitle: 'Q&A answers',
            color: '#b92b27',
            colorMuted: 'rgba(185,43,39,0.12)',
            colorBorder: 'rgba(185,43,39,0.22)',
            steps: [
              { title: 'Find the right question', detail: 'Search with the exact phrasing of your tracked prompts. Favor questions with 1k+ views and fewer than 5 existing answers.' },
              { title: 'Lead with the answer', detail: "State your main point in the first sentence — don't bury the takeaway. Quora buries answers that take too long to get to the point." },
              { title: 'Use structure', detail: 'Short paragraphs and bold sub-headers make answers scannable and rank better in search.' },
              { title: 'Mention your brand in context', detail: 'Never as the opening line. Weave it in naturally where it genuinely adds value to the reader.' },
            ],
            disclosure: 'Add "I\'m on the team at [Brand]" in your Quora bio and in the answer itself.',
            tip: null,
          },
          medium: {
            label: 'Medium',
            subtitle: 'Long-form articles',
            color: '#94A3B8',
            colorMuted: 'rgba(148,163,184,0.10)',
            colorBorder: 'rgba(148,163,184,0.18)',
            steps: [
              { title: 'Open a new story', detail: 'Go to medium.com/new-story and paste your draft. Clean up any formatting artifacts from the copy-paste.' },
              { title: 'Title & subtitle', detail: 'Both appear in search results — make them specific and search-friendly. Avoid vague headlines like "Lessons I Learned."' },
              { title: 'Header image', detail: 'Add a relevant image from Unsplash (free, no attribution needed). Articles with images get significantly more clicks.' },
              { title: 'Tags', detail: 'Add up to 5 specific tags, e.g. "Startup", "AI", "SaaS". Tags determine which readers see your story.' },
              { title: 'Pitch a publication', detail: 'Submitting to a publication multiplies your reach significantly. Look for publications with 10k+ followers in your niche.' },
            ],
            disclosure: 'End the article with "Disclosure: The author is affiliated with [Brand]."',
            tip: null,
          },
          wikipedia: {
            label: 'Wikipedia',
            subtitle: 'Article edits — handle with care',
            color: '#64748b',
            colorMuted: 'rgba(100,116,139,0.10)',
            colorBorder: 'rgba(100,116,139,0.20)',
            steps: [
              { title: 'Declare your COI first', detail: 'On your user talk page, add the {{connected contributor}} template before doing anything else. Skipping this can get you permanently banned.' },
              { title: 'Propose on the Talk page', detail: "Open the article's Talk tab and post your suggested addition with sources. Do not self-publish COI edits directly — this violates policy." },
              { title: 'Wait for review', detail: 'A volunteer editor will review and merge (or decline) your suggestion. This can take days to weeks — do not bump or re-submit.' },
              { title: 'Iterate if declined', detail: 'Ask for specific feedback, revise with better sources, and re-submit. Patience is essential; editors respond poorly to pressure.' },
            ],
            disclosure: null,
            tip: null,
          },
        } as const;

        const p = PLATFORMS[postingPlatform];

        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div
              className="absolute inset-0 bg-black/75 backdrop-blur-sm cursor-pointer"
              onClick={() => setPostingGuideOpen(false)}
            />
            <div className="relative w-full max-w-xl max-h-[88vh] flex flex-col bg-[rgba(8,12,20,0.98)] border border-[rgba(99,102,241,0.22)] rounded-2xl shadow-[0_24px_80px_rgba(0,0,0,0.70),0_0_0_1px_rgba(99,102,241,0.08)] overflow-hidden">

              {/* Header */}
              <div className="flex items-center justify-between px-6 pt-5 pb-4 shrink-0">
                <div className="flex items-center gap-2.5">
                  <div className="w-7 h-7 rounded-lg bg-[rgba(99,102,241,0.12)] border border-[rgba(99,102,241,0.22)] flex items-center justify-center">
                    <BookOpen size={14} className="text-[#818cf8]" />
                  </div>
                  <div>
                    <h2 className="text-sm font-semibold text-[#F0F4F8] leading-none">Posting Guide</h2>
                    <p className="text-[11px] text-[#475569] mt-0.5">How to publish your draft on each platform</p>
                  </div>
                </div>
                <button
                  onClick={() => setPostingGuideOpen(false)}
                  aria-label="Close"
                  className="w-7 h-7 rounded-lg flex items-center justify-center text-[#475569] hover:text-[#94A3B8] hover:bg-[rgba(255,255,255,0.06)] transition-all"
                >
                  <X size={14} />
                </button>
              </div>

              {/* Platform tabs */}
              <div className="px-6 pb-0 shrink-0">
                <div className="flex gap-1 p-1 bg-[rgba(255,255,255,0.03)] border border-[rgba(99,102,241,0.12)] rounded-xl">
                  {(['reddit', 'quora', 'medium', 'wikipedia'] as const).map((key) => {
                    const active = postingPlatform === key;
                    const pl = PLATFORMS[key];
                    return (
                      <button
                        key={key}
                        onClick={() => setPostingPlatform(key)}
                        className="flex-1 py-1.5 px-2 rounded-lg text-xs font-medium transition-all"
                        style={{
                          background: active ? pl.colorMuted : 'transparent',
                          color: active ? pl.color : '#475569',
                          border: active ? `1px solid ${pl.colorBorder}` : '1px solid transparent',
                        }}
                      >
                        {pl.label}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Scrollable body */}
              <div className="flex-1 overflow-y-auto px-6 py-5 space-y-3">

                {/* Platform header */}
                <div className="flex items-center justify-between gap-3 mb-1">
                  <div className="flex items-center gap-3">
                    <div className="w-1 h-9 rounded-full shrink-0" style={{ background: p.color }} />
                    <div>
                      <p className="text-base font-semibold text-[#F0F4F8]">{p.label}</p>
                      <p className="text-xs text-[#475569]">{p.subtitle}</p>
                    </div>
                  </div>
                  {postingPlatform === 'medium' && (
                    <a
                      href="https://medium.com/new-story"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-1.5 bg-[rgba(148,163,184,0.08)] hover:bg-[rgba(148,163,184,0.14)] border border-[rgba(148,163,184,0.18)] text-[#94A3B8] hover:text-[#E2E8F0] rounded-lg px-3 py-1.5 text-xs font-medium transition-all shrink-0"
                    >
                      Open Medium
                      <ExternalLink size={11} />
                    </a>
                  )}
                </div>

                {/* Steps */}
                {p.steps.map((step, i) => (
                  <div
                    key={step.title}
                    className="group flex gap-4 p-4 rounded-xl border border-[rgba(255,255,255,0.05)] bg-[rgba(255,255,255,0.02)] hover:bg-[rgba(255,255,255,0.04)] hover:border-[rgba(99,102,241,0.18)] transition-all cursor-default"
                  >
                    <div
                      className="shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-bold transition-all"
                      style={{
                        background: p.colorMuted,
                        border: `1px solid ${p.colorBorder}`,
                        color: p.color,
                      }}
                    >
                      {i + 1}
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-[#E2E8F0] mb-1">{step.title}</p>
                      <p className="text-xs text-[#64748B] leading-relaxed">{step.detail}</p>
                    </div>
                  </div>
                ))}

                {/* Wikipedia accept/reject grid */}
                {postingPlatform === 'wikipedia' && (
                  <div className="grid grid-cols-2 gap-3 mt-1">
                    <div className="bg-[rgba(16,185,129,0.04)] border border-[rgba(16,185,129,0.14)] rounded-xl px-4 py-3">
                      <p className="text-xs text-[#10b981] font-semibold mb-2.5 flex items-center gap-1.5">
                        <span className="w-4 h-4 rounded-full bg-[rgba(16,185,129,0.15)] flex items-center justify-center text-[9px]" aria-hidden="true">✓</span>
                        Editors accept
                      </p>
                      <div className="space-y-2">
                        {['Neutral, factual statements', 'Properly cited sources', 'Brand as one of several examples', 'Correcting factual errors'].map((t) => (
                          <div key={t} className="flex items-start gap-2">
                            <span className="text-[#10b981] text-[10px] mt-0.5 shrink-0" aria-hidden="true">✓</span>
                            <span className="text-[11px] text-[#64748B] leading-snug">{t}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                    <div className="bg-[rgba(239,68,68,0.04)] border border-[rgba(239,68,68,0.14)] rounded-xl px-4 py-3">
                      <p className="text-xs text-[#ef4444] font-semibold mb-2.5 flex items-center gap-1.5">
                        <span className="w-4 h-4 rounded-full bg-[rgba(239,68,68,0.15)] flex items-center justify-center text-[9px]" aria-hidden="true">✗</span>
                        Editors reject
                      </p>
                      <div className="space-y-2">
                        {['Promotional language', 'Uncited claims', 'Brand article without notability', 'Removing competitors'].map((t) => (
                          <div key={t} className="flex items-start gap-2">
                            <span className="text-[#ef4444] text-[10px] mt-0.5 shrink-0" aria-hidden="true">✗</span>
                            <span className="text-[11px] text-[#64748B] leading-snug">{t}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                )}

                {/* Disclosure */}
                {p.disclosure && (
                  <div className="flex items-start gap-3 p-4 rounded-xl bg-[rgba(99,102,241,0.06)] border border-[rgba(99,102,241,0.16)]">
                    <div className="shrink-0 w-5 h-5 rounded-full bg-[rgba(99,102,241,0.15)] border border-[rgba(99,102,241,0.25)] flex items-center justify-center mt-0.5">
                      <span className="text-[9px] text-[#818cf8] font-bold">!</span>
                    </div>
                    <div>
                      <p className="text-xs font-semibold text-[#818cf8] mb-1">Required disclosure</p>
                      <p className="text-xs text-[#64748B] leading-relaxed">{p.disclosure}</p>
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
            <h1 className="text-xl sm:text-2xl font-bold text-[#F0F4F8]">Content Hub</h1>
            <p className="text-[13px] text-[#64748B] mt-1.5">
              AI-powered content for every platform
            </p>
          </div>
          <button
            onClick={() => setHubHelpOpen(true)}
            aria-label="How does Content Hub work?"
            className="text-[#475569] hover:text-[#6366f1] transition-colors mt-1 ml-1"
            title="How does Content Hub work?"
          >
            <HelpCircle size={16} />
          </button>
        </div>

        <div className="flex items-center gap-3">
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
                className="appearance-none bg-[rgba(255,255,255,0.05)] border border-[rgba(255,255,255,0.10)] text-[#F0F4F8] rounded-lg pl-3 pr-8 py-2 text-sm focus:outline-none focus:border-[#6366f1] focus:ring-2 focus:ring-[#6366f1]/50"
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

      {!brandsLoading && brands.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-24 text-center">
          <div className="w-14 h-14 bg-[rgba(99,102,241,0.08)] border border-[rgba(99,102,241,0.22)] rounded-2xl flex items-center justify-center mb-4">
            <PenLine size={24} className="text-[#6366f1]" />
          </div>
          <h3 className="text-base font-semibold text-[#F0F4F8] mb-2">No brands tracked yet</h3>
          <p className="text-sm text-[#64748B] max-w-sm mb-6">Add your first brand to start generating content drafts and finding opportunities.</p>
          <Link
            href="/onboarding"
            className="flex items-center gap-2 bg-[#6366f1] hover:bg-[#4f46e5] text-white rounded-lg px-4 py-2 text-sm font-medium transition-colors"
          >
            <Plus size={16} />
            Track Your First Brand
          </Link>
        </div>
      ) : loading ? (
        <div className="animate-pulse space-y-4">
          <div className="h-10 bg-[rgba(99,102,241,0.06)] border border-[rgba(99,102,241,0.22)] rounded-xl" />
          <div className="h-48 bg-[rgba(99,102,241,0.06)] border border-[rgba(99,102,241,0.22)] rounded-xl" />
          <div className="h-48 bg-[rgba(99,102,241,0.06)] border border-[rgba(99,102,241,0.22)] rounded-xl" />
        </div>
      ) : (
        <div className="flex flex-col md:flex-row gap-6">
          {/* ── Left panel (70%) — Content Queue ────────────────────────────── */}
          <div className="flex-1 min-w-0">
            {/* Tab bar */}
            <div className="flex gap-0.5 border-b border-[rgba(99,102,241,0.18)] mb-5">
              {TABS.map((tab) => (
                <button
                  key={tab.key}
                  onClick={() => setActiveTab(tab.key)}
                  className={`flex items-center gap-1.5 px-3.5 py-2.5 text-sm font-medium border-b-2 -mb-px transition-all ${
                    activeTab === tab.key
                      ? 'text-[#818cf8] border-[#6366f1]'
                      : 'text-[#475569] border-transparent hover:text-[#64748B] hover:border-[rgba(99,102,241,0.30)]'
                  }`}
                >
                  {tab.label}
                  {tabCounts[tab.key] > 0 && (
                    <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${
                      activeTab === tab.key
                        ? 'bg-[#6366f1]/25 text-[#818cf8]'
                        : 'bg-[rgba(255,255,255,0.08)] text-[#475569]'
                    }`}>
                      {tabCounts[tab.key]}
                    </span>
                  )}
                </button>
              ))}
            </div>

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
              draftAttributions={draftAttributions}
              opportunities={opportunities}
              visibleOpportunities={visibleOpportunities}
              brandProfile={brandProfile}
              brandPrompts={brandPrompts}
              platformFilter={platformFilter}
              setPlatformFilter={setPlatformFilter}
              _disabledPlatforms={_disabledPlatforms}
              draftStatus={draftStatus}
              generating={generating}
              pinnedDraftId={pinnedDraftId}
              handleGenerateNow={handleGenerateNow}
              handleApprove={handleApprove}
              handleDelete={handleDelete}
              handleSaved={handleSaved}
              handleMarkAsPosted={handleMarkAsPosted}
              handleMoveBackToDrafts={handleMoveBackToDrafts}
              handleDraftOpportunity={handleDraftOpportunity}
              handleDismissOpportunity={handleDismissOpportunity}
              setOppHelpOpen={setOppHelpOpen}
              user={user}
            />
          </div>

          {/* ── Right panel (30%) — Settings ─────────────────────────────────── */}
          <div className="w-full md:w-72 shrink-0 flex flex-col gap-4 md:pl-4 md:border-l md:border-[rgba(99,102,241,0.14)]">
            {/* Generate now */}
            <div className="bg-[rgba(99,102,241,0.06)] backdrop-blur-md border border-[rgba(99,102,241,0.22)] rounded-xl p-5 shadow-[0_4px_24px_rgba(0,0,0,0.20)]">
              {!user?.subscription_tier && !user?.is_admin ? (
                <div className="flex flex-col items-center text-center gap-3">
                  <div className="w-10 h-10 bg-[rgba(99,102,241,0.08)] border border-[rgba(99,102,241,0.22)] rounded-xl flex items-center justify-center">
                    <Zap size={16} className="text-[#6366f1]/50" />
                  </div>
                  <div>
                    <p className="text-sm font-medium text-[#94A3B8]">On-demand drafts</p>
                    <p className="text-xs text-[#475569] mt-1 leading-relaxed">Available on Starter and Pro plans. Drafts are generated automatically on free.</p>
                  </div>
                  <Link
                    href="/settings/billing"
                    className="w-full flex items-center justify-center gap-2 bg-[rgba(99,102,241,0.10)] hover:bg-[rgba(99,102,241,0.16)] border border-[rgba(99,102,241,0.25)] text-[#818cf8] hover:text-[#a5b4fc] rounded-lg px-4 py-2 text-sm font-semibold transition-all duration-150"
                  >
                    Upgrade to unlock
                  </Link>
                </div>
              ) : (
                <>
                  {draftStatus?.draft_queue_full ? (
                    <div className="bg-[#7f1d1d]/15 border border-[#991b1b]/30 rounded-lg px-3 py-2.5 mb-3">
                      <p className="text-xs text-[#f87171] font-medium leading-relaxed">
                        Draft queue full ({draftStatus.draft_cap}/{draftStatus.draft_cap}) — approve or dismiss drafts to generate new ones.
                      </p>
                    </div>
                  ) : null}
                  {(() => {
                    const cooldownLabel = generateAvailableLabel(draftStatus?.next_generate_at ?? null);
                    const onCooldown = !!cooldownLabel;
                    return (
                      <>
                        {activeTab === 'opportunities' ? (
                        <>
                          <button
                            onClick={handleScanNow}
                            disabled={scanning || !selectedBrandId}
                            className="w-full flex items-center justify-center gap-2 bg-[#5b5ef4] hover:bg-[#4f46e5] disabled:opacity-40 disabled:cursor-not-allowed text-white rounded-lg px-6 py-3 text-sm font-semibold transition-all duration-200 shadow-lg shadow-[#6366f1]/25 hover:shadow-[#6366f1]/40"
                          >
                            {scanning ? (
                              <>
                                <Loader2 size={14} className="animate-spin" />
                                Scanning…
                              </>
                            ) : (
                              <>
                                <RefreshCw size={14} />
                                Regenerate Live Opportunities
                              </>
                            )}
                          </button>
                          <p className="text-xs text-[#475569] mt-2 text-center">
                            {scanning ? 'Scanning Reddit & Quora for new opportunities…' : 'Replaces all opportunities with a fresh scan'}
                          </p>
                        </>
                      ) : (
                        <>
                          <button
                            onClick={handleGenerateNow}
                            disabled={generating || !!draftStatus?.draft_queue_full || onCooldown}
                            className="w-full flex items-center justify-center gap-2 bg-[#5b5ef4] hover:bg-[#4f46e5] disabled:opacity-40 disabled:cursor-not-allowed text-white rounded-lg px-6 py-3 text-sm font-semibold transition-all duration-200 shadow-lg shadow-[#6366f1]/25 hover:shadow-[#6366f1]/40"
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
                            <p className="flex items-center justify-center gap-1.5 text-xs text-[#94A3B8] mt-2">
                              <Clock size={11} className="shrink-0" />
                              {cooldownLabel}
                            </p>
                          ) : (
                            <p className="text-xs text-[#475569] mt-2 text-center">
                              {generating ? 'This takes ~20 seconds — drafts will all appear when ready' : 'Replaces all existing drafts with a fresh set of up to 20'}
                            </p>
                          )}
                        </>
                      )}
                        {generateError && (
                          <div className="mt-2 bg-[#7f1d1d]/15 border border-[#991b1b]/30 rounded-lg px-3 py-2">
                            <p className="text-xs text-[#f87171] leading-relaxed">{generateError}</p>
                          </div>
                        )}
                      </>
                    );
                  })()}
                </>
              )}
            </div>

            {/* Queue stats */}
            <div className="bg-[rgba(99,102,241,0.06)] backdrop-blur-md border border-[rgba(99,102,241,0.22)] rounded-xl p-5 shadow-[0_4px_24px_rgba(0,0,0,0.20)]">
              <div className="space-y-3">
                {draftStatus ? (
                  <>
                    {([
                      { label: 'Drafts', count: draftStatus.draft_count, cap: draftStatus.draft_cap },
                      { label: 'Scheduled', count: draftStatus.scheduled_count, cap: draftStatus.scheduled_cap },
                    ] as Array<{ label: string; count: number; cap: number }>).map(({ label, count, cap }) => {
                      const pct = cap > 0 ? count / cap : 0;
                      const barColor = pct >= 1 ? '#f87171' : pct >= 0.6 ? '#f59e0b' : '#10b981';
                      const textColor = pct >= 1 ? '#f87171' : pct >= 0.6 ? '#f59e0b' : '#94A3B8';
                      return (
                        <div key={label}>
                          <div className="flex items-center justify-between mb-1">
                            <span className="text-xs text-[#64748B]">{label}</span>
                            <span className="text-xs font-semibold tabular-nums" style={{ color: textColor }}>
                              {count}/{cap}
                            </span>
                          </div>
                          <div className="h-1 bg-[rgba(255,255,255,0.06)] rounded-full overflow-hidden">
                            <div
                              className="h-full rounded-full transition-all duration-500"
                              style={{ width: `${Math.min(pct * 100, 100)}%`, backgroundColor: barColor }}
                            />
                          </div>
                        </div>
                      );
                    })}
                  </>
                ) : (
                  <div className="space-y-3 animate-pulse">
                    <div className="h-8 bg-[rgba(99,102,241,0.06)] rounded" />
                    <div className="h-8 bg-[rgba(99,102,241,0.06)] rounded" />
                  </div>
                )}
                {draftStatus?.last_scan_at && (
                  <div className="border-t border-[rgba(255,255,255,0.06)] pt-2.5">
                    <p className="text-[11px] text-[#475569] text-center">
                      Last opportunity scan: {relativeTime(draftStatus.last_scan_at)}
                    </p>
                  </div>
                )}
              </div>
            </div>

            {/* Platform toggles */}
            <div className="bg-[rgba(99,102,241,0.06)] backdrop-blur-md border border-[rgba(99,102,241,0.22)] rounded-xl p-5 shadow-[0_4px_24px_rgba(0,0,0,0.20)]">
              <p className="text-[11px] font-semibold text-[#64748B] uppercase tracking-wide mb-3">Platforms</p>
              <div className="space-y-0.5">
                {(['reddit', 'quora', 'medium', 'wikipedia'] as const).map((platform) => {
                  const setting = contentSettings.find((s) => s.platform === platform);
                  const enabled = setting?.enabled ?? true;
                  return (
                    <div key={platform} className="flex items-center justify-between py-1.5">
                      <div className="flex items-center gap-2">
                        <span className={`text-xs capitalize ${enabled ? 'text-[#94A3B8]' : 'text-[#475569]'}`}>{platform}</span>
                        {savedPlatform === platform && (
                          <span className="text-[10px] text-[#34d399]">Saved</span>
                        )}
                      </div>
                      <button
                        onClick={() => handleTogglePlatform(platform, !enabled)}
                        className="transition-colors shrink-0"
                        title={enabled ? 'Disable' : 'Enable'}
                        aria-label={enabled ? `Disable ${platform}` : `Enable ${platform}`}
                      >
                        {enabled
                          ? <ToggleRight size={18} className="text-[#6366f1]" />
                          : <ToggleLeft size={18} className="text-[#334155]" />}
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      )}
      {toast && <AppToast {...toast} onDismiss={() => setToast(null)} />}
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
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <div className="w-16 h-16 rounded-2xl bg-[rgba(99,102,241,0.08)] border border-[rgba(99,102,241,0.16)] flex items-center justify-center mb-4">
        {icon}
      </div>
      <p className="text-[15px] font-semibold text-[#F0F4F8] mb-2">{title}</p>
      <p className="text-[13px] text-[#64748B] mb-6 max-w-xs leading-relaxed">{description}</p>
      {action}
    </div>
  );
}
