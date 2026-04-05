import { formatDistanceToNow, parseISO } from 'date-fns';
import type { ContentDraft } from '@/lib/api';

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
    // Show time-of-day in local time
    const label = next.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    const isToday = next.toDateString() === now.toDateString();
    return isToday ? `Try again today at ${label}` : `Try again tomorrow at ${label}`;
  } catch {
    return 'Try again tomorrow';
  }
}

// ── Subreddit promotion restriction (mirrors backend classification) ──────────

export const PROMO_RESTRICTED_SUBREDDITS = new Set([
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

export const RESTRICTED_NAME_SIGNALS = ['help','advice','support','care','recover','survivor','anon'];

export function isPromoRestricted(subreddit: string): boolean {
  const sub = subreddit.toLowerCase().replace(/^r\//, '');
  if (PROMO_RESTRICTED_SUBREDDITS.has(sub)) return true;
  return RESTRICTED_NAME_SIGNALS.some((kw) => sub.includes(kw));
}

/** Extract subreddit name from opportunity draft content_brief. */
export function extractSubreddit(contentBrief: string | null | undefined): string | null {
  if (!contentBrief) return null;
  const m = contentBrief.match(/\bin r\/([A-Za-z0-9_]+)/i);
  return m ? m[1] : null;
}

// ── Urgency scoring ───────────────────────────────────────────────────────────

export function computeUrgency(
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
