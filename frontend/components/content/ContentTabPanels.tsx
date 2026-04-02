'use client';

import { useState, useEffect, useMemo } from 'react';
import {
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
  Copy,
  Check,
  BookOpen,
  ArrowRight,
  BarChart2,
  Sparkles,
  HelpCircle,
} from 'lucide-react';
import {
  generateDraft,
  updateDraft,
  getQuoraQuestions,
  Brand,
  Prompt,
  ContentDraft,
  ContentOpportunity,
  BrandProfile,
  DraftQueueStatus,
  DraftAttribution,
  QuoraQuestion,
} from '@/lib/api';
import PlatformBadge from '@/components/PlatformBadge';
import { formatDistanceToNow, parseISO } from 'date-fns';

// ── Types ─────────────────────────────────────────────────────────────────────

type QueueTab = 'drafts' | 'scheduled' | 'opportunities' | 'posted';

// ── Props interface ───────────────────────────────────────────────────────────

export interface ContentTabPanelsProps {
  activeTab: QueueTab;
  // Brand context
  brands: Brand[];
  selectedBrandId: number | null;
  // Draft data
  draftItems: ContentDraft[];
  setDraftItems: React.Dispatch<React.SetStateAction<ContentDraft[]>>;
  visibleDraftItems: ContentDraft[];
  scheduledItems: ContentDraft[];
  visibleScheduledItems: ContentDraft[];
  postedItems: ContentDraft[];
  draftAttributions: DraftAttribution[];
  opportunities: ContentOpportunity[];
  visibleOpportunities: ContentOpportunity[];
  // Profile / prompts
  brandProfile: BrandProfile | null;
  brandPrompts: Prompt[];
  // Platform filter
  platformFilter: string;
  setPlatformFilter: (v: string) => void;
  _disabledPlatforms: Set<string>;
  // Status
  draftStatus: DraftQueueStatus | null;
  generating: boolean;
  pinnedDraftId: number | null;
  // Handlers
  handleGenerateNow: () => void;
  handleApprove: (id: number) => Promise<void>;
  handleDelete: (id: number) => void;
  handleSaved: (d: ContentDraft) => void;
  handleMarkAsPosted: (id: number) => void;
  handleMoveBackToDrafts: (id: number) => void;
  handleDraftOpportunity: (oppId: number) => void;
  handleDismissOpportunity: (oppId: number) => void;
  setOppHelpOpen: (v: boolean) => void;
  // User
  user: { subscription_tier?: string | null; is_admin?: boolean } | null;
}

// ── Router ────────────────────────────────────────────────────────────────────

export function ContentTabPanels(props: ContentTabPanelsProps) {
  const { activeTab } = props;
  if (activeTab === 'drafts') return <DraftsPanel {...props} />;
  if (activeTab === 'scheduled') return <ScheduledPanel {...props} />;
  if (activeTab === 'opportunities') return <OpportunitiesPanel {...props} />;
  if (activeTab === 'posted') return <PostedPanel {...props} />;
  return null;
}

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
    const label = next.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    const isToday = next.toDateString() === now.toDateString();
    return isToday ? `Try again today at ${label}` : `Try again tomorrow at ${label}`;
  } catch {
    return 'Try again tomorrow';
  }
}

// ── Subreddit promotion restriction ──────────────────────────────────────────

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
  const vis = draft.visibility_score_at_draft;
  const visUrgency = vis != null ? 100 - vis : 50;

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

// ── Draft quality checklist ───────────────────────────────────────────────────

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
  const isRedditReply = platform === 'reddit' && draft.opportunity_id != null;

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
        label: 'COI reminder: disclose your conflict of interest on the talk page before editing',
        passed: 'warning',
      },
    ];
  }

  if (platform === 'quora') {
    const quoraChecks: QualityCheck[] = [];

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

  // Generic checks (Reddit, Medium)
  const checks: QualityCheck[] = [];

  // 1. No prohibited phrases
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

// ── Quality checklist component ───────────────────────────────────────────────

function QualityChecklist({
  draft,
  profile,
  brandName,
  autoExpand = false,
  liveText,
  precomputedChecks,
}: {
  draft: ContentDraft;
  profile: BrandProfile | null;
  brandName: string;
  autoExpand?: boolean;
  liveText?: string;
  precomputedChecks?: QualityCheck[];
}) {
  const [expanded, setExpanded] = useState(autoExpand);
  // Use precomputed checks when no live editing is in progress (avoids double computation)
  const effectiveDraft = liveText != null ? { ...draft, content_text: liveText } : draft;
  const checks = (liveText == null && precomputedChecks)
    ? precomputedChecks
    : runQualityChecks(effectiveDraft, profile, brandName);
  const hardFails = checks.filter((c) => c.passed === false).length;
  const warnings = checks.filter((c) => c.passed === 'warning').length;
  const passed = checks.length - hardFails;
  const total = checks.length;
  const scoreColor = hardFails === 0 && warnings === 0
    ? 'text-[#10b981]'
    : hardFails === 0
    ? 'text-[#f59e0b]'
    : hardFails >= 2 ? 'text-[#ef4444]' : 'text-[#f59e0b]';

  return (
    <div className="border border-[rgba(255,255,255,0.10)] rounded-lg overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between px-3 py-2 bg-[#0f172a] hover:bg-[#1e293b] transition-colors"
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
        <div className="divide-y divide-[#334155]">
          {checks.map((check) => {
            const icon = check.passed === true ? '✓' : check.passed === 'warning' ? '⚠' : '✕';
            const iconColor = check.passed === true
              ? 'text-[#10b981]'
              : check.passed === 'warning'
              ? 'text-[#f59e0b]'
              : 'text-[#ef4444]';
            return (
              <div key={check.label} className="flex items-start gap-2.5 px-3 py-2">
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
  onApprove: (id: number) => Promise<void>;
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
  const [approving, setApproving] = useState(false);

  async function handleApproveClick() {
    setApproving(true);
    try {
      await onApprove(draft.id);
    } catch {
      // onApprove may re-throw on unexpected errors; spinner still clears via finally
    } finally {
      setApproving(false);
    }
  }

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(draft.content_text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // clipboard unavailable (no focus, insecure context, etc.) — fail silently
    }
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

  const wordCount = draft.content_text.trim().split(/\s+/).filter(Boolean).length;
  const targetPrompt = prompts.find((p) => p.id === draft.prompt_id);
  const qualityChecks = useMemo(
    () => runQualityChecks(draft, profile, brandName),
    [draft, profile, brandName],
  );
  const isLowQuality = qualityChecks.filter((c) => c.passed === false).length >= 2;

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
    ? 'border-l-[3px] border-l-[#ef4444]/50 border-[#334155]'
    : 'border-[#334155]';

  return (
    <div className={`bg-[#0f172a] border rounded-xl p-5 flex flex-col gap-3 hover:border-[#475569] shadow-[0_4px_24px_rgba(0,0,0,0.20)] transition-colors ${borderClass}`}>
      {/* Top row */}
      <div className="flex items-center justify-between gap-2">
        <PlatformBadge platform={draft.platform} />
        <span className="text-[10px] text-[#475569] shrink-0">
          {relativeTime(draft.created_at)}
        </span>
      </div>

      {/* Target prompt / posting instruction */}
      {draft.opportunity_id != null && draft.platform === 'reddit' &&
       draft.platform_guidelines_applied?.startsWith('http') ? (
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
          {showQuoraPicker ? (
            <div className="border border-[#334155] rounded-lg p-3 bg-[#0f172a]">
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
          {targetPrompt && (
            <div className="flex items-start gap-1.5 mb-2">
              <span className="text-[10px] text-[#475569] uppercase tracking-wide font-medium mt-0.5 flex-shrink-0">Targeting</span>
              <span className="text-[11px] text-[#6366f1] bg-[#1e293b] border border-[#334155] rounded-md px-2 py-0.5 leading-relaxed">{targetPrompt.text}</span>
            </div>
          )}
          {draft.title && (
            <p className="text-sm font-semibold text-[#F0F4F8] leading-snug mb-1">{draft.title}</p>
          )}
          <div className="flex items-center justify-between mb-1.5">
            <div className="flex items-center gap-1 bg-[rgba(255,255,255,0.04)] border border-[rgba(255,255,255,0.08)] rounded-md p-0.5">
              <button
                onClick={() => setPreviewMode(false)}
                className={`px-2 py-0.5 rounded text-[10px] font-medium transition-colors ${!previewMode ? 'bg-[#1e293b] text-[#818cf8]' : 'text-[#475569] hover:text-[#64748B]'}`}
              >Raw</button>
              <button
                onClick={() => setPreviewMode(true)}
                className={`px-2 py-0.5 rounded text-[10px] font-medium transition-colors ${previewMode ? 'bg-[#1e293b] text-[#818cf8]' : 'text-[#475569] hover:text-[#64748B]'}`}
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

      {!editing && (
        <QualityChecklist draft={draft} profile={profile} brandName={brandName} precomputedChecks={qualityChecks} />
      )}

      {!editing && (
        <div className="flex items-center gap-2 pt-1 flex-wrap">
          <button
            onClick={() => setEditing(true)}
            aria-label="Edit draft"
            className="flex items-center gap-1.5 text-xs bg-[rgba(255,255,255,0.06)] hover:bg-[rgba(255,255,255,0.10)] border border-[rgba(255,255,255,0.10)] text-[#94A3B8] hover:text-[#F0F4F8] rounded-lg px-3 py-1.5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#6366f1]/60 focus-visible:ring-offset-1 focus-visible:ring-offset-[#0a0e18]"
          >
            <Edit2 size={11} />
            Edit
          </button>
          <button
            onClick={handleCopy}
            aria-label="Copy draft to clipboard"
            className={`flex items-center gap-1.5 text-xs rounded-lg px-3 py-1.5 transition-colors border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#6366f1]/60 focus-visible:ring-offset-1 focus-visible:ring-offset-[#0a0e18] ${
              copied
                ? 'bg-[#064e3b]/20 border-[#065f46]/25 text-[#34d399]'
                : 'bg-[rgba(255,255,255,0.06)] border-[rgba(255,255,255,0.10)] text-[#94A3B8] hover:text-[#F0F4F8] hover:bg-[rgba(255,255,255,0.10)]'
            }`}
          >
            {copied ? <Check size={11} /> : <Copy size={11} />}
            {copied ? 'Copied!' : 'Copy'}
            <span className="sr-only" role="status">{copied ? 'Copied to clipboard' : ''}</span>
          </button>
          <button
            onClick={handleApproveClick}
            disabled={approving}
            aria-label={approving ? 'Approving, please wait' : 'Approve draft'}
            className="flex items-center gap-1.5 text-xs bg-[#064e3b]/20 hover:bg-[#064e3b]/30 disabled:opacity-50 border border-[#065f46]/25 text-[#34d399] rounded-lg px-3 py-1.5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#6366f1]/60 focus-visible:ring-offset-1 focus-visible:ring-offset-[#0a0e18]"
          >
            {approving ? <Loader2 size={11} className="animate-spin" /> : <CheckCircle2 size={11} />}
            {approving ? 'Approving…' : 'Approve'}
          </button>
          <button
            onClick={() => onDelete(draft.id)}
            disabled={approving}
            aria-label="Dismiss draft"
            className="flex items-center gap-1.5 text-xs text-[#ef4444]/70 hover:text-[#f87171] disabled:opacity-50 rounded-lg px-3 py-1.5 transition-colors ml-auto focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#6366f1]/60 focus-visible:ring-offset-1 focus-visible:ring-offset-[#0a0e18]"
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

function wikiToPlain(wiki: string): string {
  return wiki
    .replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, '$2')
    .replace(/\[\[([^\]]+)\]\]/g, '$1')
    .replace(/<ref[^>]*>[\s\S]*?<\/ref>/g, '')
    .replace(/<ref[^>]*\/>/g, '')
    .replace(/'{2,3}/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function extractCitations(wiki: string): string[] {
  const refs: string[] = [];
  const re = /<ref[^>]*>[\s\S]*?<\/ref>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(wiki)) !== null) refs.push(m[0]);
  return refs;
}

function extractWikiLinks(wiki: string): Map<string, string> {
  const map = new Map<string, string>();
  const re = /\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(wiki)) !== null) {
    const target = m[1];
    const display = m[2] ?? m[1];
    map.set(display.toLowerCase(), m[0]);
    map.set(target.toLowerCase(), m[0]);
  }
  return map;
}

function plainToWikiFormat(
  plain: string,
  originalWiki: string,
  citations: string[],
  brandName: string,
): string {
  const wikiLinks = extractWikiLinks(originalWiki);
  let out = plain;

  out = out.replace(/^#{1,6}\s+(.+)$/gm, (_, title) => `== ${title.trim()} ==`);
  out = out.replace(/\*\*\*(.+?)\*\*\*/g, "'''$1'''");
  out = out.replace(/\*\*(.+?)\*\*/g, "'''$1'''");
  out = out.replace(/\*(.+?)\*/g, "''$1''");

  const linkedTerms = new Set<string>();
  wikiLinks.forEach((markup, term) => {
    if (linkedTerms.has(term)) return;
    const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(`(?<![\\[|])\\b${escaped}\\b(?![\\]|])`, 'i');
    const replaced = out.replace(re, markup);
    if (replaced !== out) {
      linkedTerms.add(term);
      out = replaced;
    }
  });

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
    try {
      await navigator.clipboard.writeText(wikiFormat);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // clipboard unavailable — fail silently
    }
  }

  async function handleSave() {
    setSaving(true);
    try {
      const updated = await updateDraft(draft.id, { content_text: wikiFormat });
      onSaved(updated);
      setEditing(false);
    } finally {
      setSaving(false);
    }
  }

  const articleUrl = draft.content_brief ?? '';
  const articleTitle = draft.title ?? 'Unknown Wikipedia article';

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

      <div className="bg-[#0f172a] border border-[#334155] rounded-xl p-5 flex flex-col gap-3 hover:border-[#475569] shadow-[0_4px_24px_rgba(0,0,0,0.20)] transition-colors">
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

        {insertLocation && (
          <div className="bg-[#1e293b] border border-[#334155] rounded-lg px-3 py-2.5">
            <p className="text-xs text-[#64748B] uppercase tracking-wide mb-1 font-medium">Where to insert</p>
            <p className="text-xs text-[#94A3B8] leading-relaxed">{insertLocation}</p>
          </div>
        )}

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
            <div className="flex items-center justify-between mb-1.5">
              <div className="flex items-center gap-1 bg-[rgba(255,255,255,0.04)] border border-[rgba(255,255,255,0.08)] rounded-md p-0.5">
                <button
                  onClick={() => setViewMode('preview')}
                  className={`px-2 py-0.5 rounded text-[10px] font-medium transition-colors ${viewMode === 'preview' ? 'bg-[#1e293b] text-[#818cf8]' : 'text-[#475569] hover:text-[#64748B]'}`}
                >Preview</button>
                <button
                  onClick={() => setViewMode('raw')}
                  className={`px-2 py-0.5 rounded text-[10px] font-medium transition-colors ${viewMode === 'raw' ? 'bg-[#1e293b] text-[#818cf8]' : 'text-[#475569] hover:text-[#64748B]'}`}
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

        {!editing && (
          <QualityChecklist draft={draft} profile={profile} brandName={brandName} liveText={wikiFormat} />
        )}

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
          className="w-full text-left flex items-start gap-2.5 bg-[#0f172a] hover:bg-[#1e293b] border border-[#334155] hover:border-[#475569] rounded-lg px-3 py-2.5 transition-colors group"
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
    const isDirectUrl = brief?.startsWith('https://www.quora.com') || brief?.startsWith('https://quora.com');
    if (isDirectUrl) {
      return (
        <ol className="list-decimal list-inside space-y-1 text-xs text-[#94A3B8] leading-relaxed">
          <li>Open <a href={brief!} target="_blank" rel="noopener noreferrer" className="text-[#6366f1] hover:underline break-all">{brief}</a></li>
          <li>Click <span className="text-[#F0F4F8] font-medium">Answer</span></li>
          <li>Paste your draft</li>
          <li>Add your credentials if relevant</li>
          <li>Click <span className="text-[#F0F4F8] font-medium">Submit</span></li>
          <p className="mt-1 text-[#475569] not-italic">Tip: Answer questions posted within the last 30 days for maximum visibility.</p>
        </ol>
      );
    }
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
    <div className="bg-[#0f172a] border border-[#334155] rounded-xl p-4 flex flex-col gap-3 hover:border-[#475569] shadow-[0_4px_24px_rgba(0,0,0,0.20)] transition-colors">
      <div className="flex items-center gap-2 flex-wrap">
        <PlatformBadge platform={draft.platform} />
        {draft.approved_at && (
          <span className="text-xs text-[#64748B] flex items-center gap-1">
            <CheckCircle2 size={11} className="text-[#10b981]" />
            Approved {relativeTime(draft.approved_at)}
          </span>
        )}
      </div>

      {draft.content_brief && (
        <p className="text-xs text-[#475569] leading-relaxed line-clamp-2">
          <span className="text-[#64748B]">Targeting: </span>
          {draft.content_brief}
        </p>
      )}

      <div>
        {draft.title && (
          <p className="text-sm font-semibold text-[#F0F4F8] leading-snug mb-1">{draft.title}</p>
        )}
        {!draft.title && (
          <p className="text-sm text-[#94A3B8] leading-relaxed truncate">{title}</p>
        )}
      </div>

      {expanded && (
        <div className="bg-[#0f172a] border border-[#334155] rounded-lg p-3 relative">
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

      {guidance && (
        <div className="border border-[#334155] rounded-lg overflow-hidden">
          <button
            onClick={() => setGuideOpen(!guideOpen)}
            className="w-full flex items-center justify-between px-3 py-2 bg-[#0f172a] hover:bg-[#1e293b] text-left transition-colors"
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

      <div className="bg-[rgba(16,185,129,0.05)] border border-[rgba(16,185,129,0.12)] rounded-lg px-3 py-2 flex items-start gap-2">
        <HelpCircle size={11} className="text-[#10b981] mt-0.5 shrink-0" />
        <p className="text-[11px] text-[#475569] leading-relaxed">
          <span className="text-[#64748B] font-medium">This draft needs to be posted manually.</span>
          {' '}Use the View Draft button to copy the content, post it on {draft.platform.charAt(0).toUpperCase() + draft.platform.slice(1)}, then click{' '}
          <span className="text-[#34d399]">Mark as Posted</span> to record it and start tracking visibility changes.
        </p>
      </div>

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
    <div className="bg-[#0f172a] border border-[#334155] rounded-xl p-4 flex flex-col gap-2 shadow-[0_4px_24px_rgba(0,0,0,0.20)] hover:border-[#475569] transition-colors">
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

      {expanded && (
        <div className="bg-[rgba(255,255,255,0.03)] border border-[rgba(255,255,255,0.06)] rounded-lg p-3">
          <pre className="text-xs text-[#64748B] whitespace-pre-wrap leading-relaxed font-mono">{draft.content_text}</pre>
        </div>
      )}

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

// ── Opportunity card ──────────────────────────────────────────────────────────

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
      ? 'text-[#10b981]'
      : opp.relevance_score >= 40
      ? 'text-[#f59e0b]'
      : 'text-[#64748B]';

  return (
    <div className="bg-[#0f172a] border border-[#334155] rounded-xl p-4 flex flex-col gap-3 hover:border-[#475569] shadow-[0_4px_24px_rgba(0,0,0,0.20)] transition-colors">
      <div className="flex items-center gap-2 flex-wrap">
        <PlatformBadge platform={opp.platform} />
        {opp.subreddit && (
          <span className="text-xs text-[#64748B] font-medium">r/{opp.subreddit}</span>
        )}
        <span className={`text-xs font-semibold ml-auto ${relevanceColor}`}>
          {Math.round(opp.relevance_score)}% relevance
        </span>
      </div>

      <a
        href={opp.thread_url}
        target="_blank"
        rel="noopener noreferrer"
        className="text-sm font-medium text-[#F0F4F8] hover:text-[#6366f1] transition-colors leading-snug flex items-start gap-1.5"
      >
        {opp.thread_title || opp.thread_url}
        <ExternalLink size={11} className="shrink-0 mt-0.5 text-[#475569]" />
      </a>

      {opp.body_preview && (
        <div className="relative">
          <p
            className={`text-xs text-[#475569] leading-relaxed cursor-pointer ${
              expanded ? 'max-h-48 overflow-y-auto pr-2' : 'line-clamp-2'
            }`}
            onClick={() => setExpanded(!expanded)}
          >
            {opp.body_preview}
          </p>
          {opp.body_preview.length > 150 && (
            <button
              onClick={() => setExpanded(!expanded)}
              className="text-[10px] text-[#6366f1] hover:text-[#818cf8] mt-1"
            >
              {expanded ? 'Show less' : 'Show more'}
            </button>
          )}
        </div>
      )}

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
      <div className="w-16 h-16 rounded-2xl bg-[#1e293b] border border-[#334155] flex items-center justify-center mb-4">
        {icon}
      </div>
      <p className="text-[15px] font-semibold text-[#F0F4F8] mb-2">{title}</p>
      <p className="text-[13px] text-[#64748B] mb-6 max-w-xs leading-relaxed">{description}</p>
      {action}
    </div>
  );
}

// ── Panel implementations ─────────────────────────────────────────────────────

function DraftsPanel(props: ContentTabPanelsProps) {
  const {
    brands, selectedBrandId, draftItems, _disabledPlatforms, platformFilter,
    setPlatformFilter, visibleDraftItems, pinnedDraftId, brandProfile, brandPrompts,
    postedItems, draftStatus, generating, handleGenerateNow, handleApprove,
    handleDelete, handleSaved, setDraftItems, user,
  } = props;

  const selectedBrand = brands.find((b) => b.id === selectedBrandId);
  const brandName = selectedBrand?.name ?? '';

  const draftPlatforms = Array.from(new Set(
    draftItems.filter((d) => !_disabledPlatforms.has(d.platform)).map((d) => d.platform)
  )).sort();

  const filterBar = draftPlatforms.length >= 2 ? (
    <div className="flex items-center gap-1 bg-[#0f172a] border border-[#334155] rounded-lg p-0.5 mb-4 self-start">
      <button
        onClick={() => setPlatformFilter('all')}
        className={`px-2.5 py-1 rounded-md text-xs font-medium transition-all ${platformFilter === 'all' ? 'bg-[#1e293b] text-[#818cf8]' : 'text-[#475569] hover:text-[#94A3B8]'}`}
      >
        All
      </button>
      {draftPlatforms.map((p) => (
        <button
          key={p}
          onClick={() => setPlatformFilter(platformFilter === p ? 'all' : p)}
          className={`px-2.5 py-1 rounded-md text-xs font-medium capitalize transition-all ${platformFilter === p ? 'bg-[#1e293b] text-[#818cf8]' : 'text-[#475569] hover:text-[#94A3B8]'}`}
        >
          {p}
        </button>
      ))}
    </div>
  ) : null;

  if (visibleDraftItems.length === 0) {
    return (
      <>
        {filterBar}
        <EmptyState
          icon={<FileText size={48} className="text-[#818cf8]" />}
          title={platformFilter !== 'all' ? `No ${platformFilter} drafts` : 'No drafts yet'}
          description={platformFilter !== 'all' ? 'Try switching to "All" or generate new drafts.' : 'Use "Regenerate Drafts" or request a custom draft to get started.'}
          action={platformFilter === 'all' && (user?.subscription_tier || user?.is_admin) ? (() => {
            const cooldownLabel = generateAvailableLabel(draftStatus?.next_generate_at ?? null);
            const onCooldown = !!cooldownLabel;
            return (
              <div className="flex flex-col items-center gap-1.5">
                <button
                  onClick={handleGenerateNow}
                  disabled={generating || !!draftStatus?.draft_queue_full || onCooldown}
                  className="flex items-center gap-2 bg-[#5b5ef4] hover:bg-[#4f46e5] disabled:opacity-40 disabled:cursor-not-allowed text-white rounded-xl px-6 py-3 text-sm font-semibold transition-all duration-200 shadow-lg shadow-[#6366f1]/30 hover:shadow-[#6366f1]/45"
                >
                  {generating ? <Loader2 size={14} className="animate-spin" /> : <Zap size={14} />}
                  {generating ? 'Generating…' : 'Regenerate Drafts'}
                </button>
                {onCooldown && (
                  <p className="text-xs text-[#475569]">{cooldownLabel}</p>
                )}
              </div>
            );
          })() : undefined}
        />
      </>
    );
  }

  const sorted = [...visibleDraftItems].sort((a, b) => {
    if (a.id === pinnedDraftId) return -1;
    if (b.id === pinnedDraftId) return 1;
    return computeUrgency(b, postedItems).score - computeUrgency(a, postedItems).score;
  });

  return (
    <div className="flex flex-col gap-3">
      {filterBar}
      <div className="flex items-start gap-2 bg-[rgba(255,255,255,0.03)] border border-[rgba(255,255,255,0.07)] rounded-lg px-3 py-2.5">
        <RefreshCw size={12} className="text-[#475569] flex-shrink-0 mt-0.5" />
        <p className="text-xs text-[#475569]">
          Unreviewed drafts are replaced when new drafts are generated. Move anything you want to keep to <span className="text-[#94A3B8]">Scheduled</span> first.
        </p>
      </div>
      {sorted.map((d) =>
        d.platform === 'wikipedia' ? (
          <WikipediaDraftCard
            key={d.id}
            draft={d}
            brandName={brandName}
            profile={brandProfile}
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
            prompts={brandPrompts}
            brandId={selectedBrandId!}
            onApprove={handleApprove}
            onDelete={handleDelete}
            onSaved={handleSaved}
            onRegenerated={(fresh) => setDraftItems((prev) => [fresh, ...prev])}
          />
        )
      )}
    </div>
  );
}

function ScheduledPanel(props: ContentTabPanelsProps) {
  const { visibleScheduledItems, handleMarkAsPosted, handleMoveBackToDrafts } = props;

  if (visibleScheduledItems.length === 0) {
    return (
      <EmptyState
        icon={<Clock size={26} className="text-[#818cf8]" />}
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

function OpportunitiesPanel(props: ContentTabPanelsProps) {
  const {
    opportunities, visibleOpportunities, platformFilter, setPlatformFilter,
    handleDraftOpportunity, handleDismissOpportunity, draftStatus, setOppHelpOpen,
  } = props;

  const header = (
    <>
      <div className="flex items-center justify-between mb-4">
        <p className="text-xs text-[#64748B]">
          Threads and questions matched to your tracked prompts
        </p>
        <button
          onClick={() => setOppHelpOpen(true)}
          className="text-[#475569] hover:text-[#6366f1] transition-colors"
          title="How do Live Opportunities work?"
        >
          <HelpCircle size={14} />
        </button>
      </div>
    </>
  );

  const oppPlatforms = Array.from(new Set(opportunities.map((o) => o.platform))).sort();
  const oppFilterBar = oppPlatforms.length >= 2 ? (
    <div className="flex items-center gap-1 bg-[#0f172a] border border-[#334155] rounded-lg p-0.5 mb-4 self-start">
      <button
        onClick={() => setPlatformFilter('all')}
        className={`px-2.5 py-1 rounded-md text-xs font-medium transition-all ${platformFilter === 'all' ? 'bg-[#1e293b] text-[#818cf8]' : 'text-[#475569] hover:text-[#94A3B8]'}`}
      >
        All
      </button>
      {oppPlatforms.map((p) => (
        <button
          key={p}
          onClick={() => setPlatformFilter(platformFilter === p ? 'all' : p)}
          className={`px-2.5 py-1 rounded-md text-xs font-medium capitalize transition-all ${platformFilter === p ? 'bg-[#1e293b] text-[#818cf8]' : 'text-[#475569] hover:text-[#94A3B8]'}`}
        >
          {p}
        </button>
      ))}
    </div>
  ) : null;

  if (opportunities.length === 0) {
    return (
      <>
        {header}
        <EmptyState
          icon={<Radio size={26} className="text-[#818cf8]" />}
          title="No live opportunities"
          description="Reddit and Quora are scanned daily. Check back after the next scan or run a tracking report to generate fresh prompts."
        />
      </>
    );
  }
  return (
    <>
      {header}
      {oppFilterBar}
      <div className="flex flex-col gap-3">
        {visibleOpportunities.map((o) => (
          <OpportunityCard
            key={o.id}
            opp={o}
            onDraft={handleDraftOpportunity}
            onDismiss={handleDismissOpportunity}
            queueFull={!!draftStatus?.draft_queue_full}
          />
        ))}
        {visibleOpportunities.length === 0 && (
          <EmptyState
            icon={<Radio size={26} className="text-[#818cf8]" />}
            title={`No ${platformFilter} opportunities`}
            description='Try "All" or switch platform.'
          />
        )}
      </div>
    </>
  );
}

function PostedPanel(props: ContentTabPanelsProps) {
  const { postedItems, draftAttributions } = props;

  if (postedItems.length === 0) {
    return (
      <EmptyState
        icon={<CheckCircle2 size={26} className="text-[#818cf8]" />}
        title="Nothing posted yet"
        description="Approved drafts will appear here once marked as posted."
      />
    );
  }
  const attributionByDraftId = new Map(draftAttributions.map((a) => [a.draft_id, a]));
  return (
    <div className="flex flex-col gap-2">
      {postedItems.map((d) => (
        <PostedCard key={d.id} draft={d} attribution={attributionByDraftId.get(d.id)} />
      ))}
    </div>
  );
}
