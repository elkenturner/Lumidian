import React from 'react';
import {
  Brand,
  Prompt,
  ContentDraft,
  ContentOpportunity,
  BrandProfile,
  DraftQueueStatus,
  DraftAttribution,
} from '@/lib/api';
import { formatDistanceToNow, parseISO } from 'date-fns';

// ── Constants ────────────────────────────────────────────────────────────────

export const PLATFORM_DISPLAY: Record<string, string> = {
  reddit: 'Reddit', quora: 'Quora', medium: 'Medium', wikipedia: 'Wikipedia',
  linkedin: 'LinkedIn', linkedin_article: 'LinkedIn', linkedin_post: 'LinkedIn', linkedin_reply: 'LinkedIn',
  x: 'X', x_thread: 'X', x_post: 'X', x_reply: 'X',
};

// ── Types ────────────────────────────────────────────────────────────────────

export type QueueTab = 'drafts' | 'scheduled' | 'opportunities' | 'posted';
export type PrimaryTab = 'opportunities' | 'content_drafts' | 'posted';
export type ContentDraftsSubTab = 'queue' | 'scheduled';

export interface QualityCheck {
  label: string;
  passed: boolean | 'warning';
  detail?: string;
}

// ── Props interface ──────────────────────────────────────────────────────────

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
  visiblePostedItems: ContentDraft[];
  draftAttributions: DraftAttribution[];
  opportunities: ContentOpportunity[];
  visibleOpportunities: ContentOpportunity[];
  // Profile / prompts
  brandProfile: BrandProfile | null;
  brandPrompts: Prompt[];
  // Platform filters (independent per tab)
  draftPlatformFilter: string;
  setDraftPlatformFilter: (v: string) => void;
  oppPlatformFilter: string;
  setOppPlatformFilter: (v: string) => void;
  _disabledPlatforms: Set<string>;
  // Status
  draftStatus: DraftQueueStatus | null;
  generating: boolean;
  reportRunning: boolean;
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
  // Request Draft
  onRequestDraft?: () => void;
  // Bulk actions
  handleApproveAll?: () => Promise<void>;
  onNavigateToQueueDraft?: (draftId: number) => void;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

export function relativeTime(iso: string | null): string {
  if (!iso) return 'Unknown';
  try {
    return formatDistanceToNow(parseISO(iso), { addSuffix: true });
  } catch {
    return iso;
  }
}

/** Human-readable label for when "Generate Drafts Now" becomes available again. */
export function generateAvailableLabel(nextGenerateAt: string | null): string | null {
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

// ── Subreddit promotion restriction ─────────────────────────────────────────

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

export function isPromoRestricted(subreddit: string): boolean {
  const sub = subreddit.toLowerCase().replace(/^r\//, '');
  if (PROMO_RESTRICTED_SUBREDDITS.has(sub)) return true;
  return RESTRICTED_NAME_SIGNALS.some((kw) => sub.includes(kw));
}

/** Extract subreddit name from draft content_brief (opportunity or standalone format). */
export function extractSubreddit(contentBrief: string | null | undefined): string | null {
  if (!contentBrief) return null;
  const m = contentBrief.match(/(?:^|\bin )r\/([A-Za-z0-9_]+)/i);
  return m ? m[1] : null;
}

// ── Urgency scoring ─────────────────────────────────────────────────────────

export function computeUrgency(
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

// ── Draft quality checklist logic ───────────────────────────────────────────

export function runQualityChecks(
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

// ── Simple markdown-to-html renderer for preview mode ───────────────────────
//
// SECURITY NOTE — escaping order matters:
// 1. HTML entity escaping (&, <, >) MUST happen FIRST to neutralize any raw HTML
//    in the input text. After this step, no user-supplied content can produce
//    HTML tags or attributes.
// 2. Markdown-to-HTML transforms (bold, italic, headings) run AFTER escaping,
//    so only our controlled markup is injected — never user content as raw HTML.
// 3. Paragraph/line-break transforms run last.
// Do NOT reorder these steps or insert user content after step 1.

export function renderPreviewHtml(text: string): string {
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

// ── Wikipedia helpers ───────────────────────────────────────────────────────

export function wikiToPlain(wiki: string): string {
  return wiki
    .replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, '$2')
    .replace(/\[\[([^\]]+)\]\]/g, '$1')
    .replace(/<ref[^>]*>[\s\S]*?<\/ref>/g, '')
    .replace(/<ref[^>]*\/>/g, '')
    .replace(/'{2,3}/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

export function extractCitations(wiki: string): string[] {
  const refs: string[] = [];
  const re = /<ref[^>]*>[\s\S]*?<\/ref>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(wiki)) !== null) refs.push(m[0]);
  return refs;
}

export function extractWikiLinks(wiki: string): Map<string, string> {
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

export function plainToWikiFormat(
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

// ── Shared empty state ──────────────────────────────────────────────────────

export function EmptyState({
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
      <div className="w-16 h-16 rounded-2xl bg-[var(--bg-raised)] border border-[var(--border-subtle)] flex items-center justify-center mb-4">
        {icon}
      </div>
      <p className="text-[15px] font-semibold text-[var(--text-primary)] mb-2">{title}</p>
      <p className="text-[13px] text-[var(--text-muted)] mb-6 max-w-xs leading-relaxed">{description}</p>
      {action}
    </div>
  );
}
