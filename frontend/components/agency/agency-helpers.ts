/**
 * Shared helpers for the agency portal UI.
 *
 * Stale-draft computation, message templates for "send to client" and "nudge."
 */

export const STALE_DAYS = 3;

function normalizeIso(iso: string): string {
  return /[Zz]|[+-]\d{2}:?\d{2}$/.test(iso) ? iso : iso + 'Z';
}

/**
 * True when a draft has been with the client for > STALE_DAYS days.
 *
 * Uses the draft's `updated_at` if available (set whenever status changes via
 * the agency router), else falls back to `created_at`. Caller must verify the
 * draft is actually in `awaiting_client` status before treating "stale" as
 * meaningful.
 */
export function isDraftStale(draft: { updated_at?: string | null; created_at: string }): boolean {
  const stamp = draft.updated_at || draft.created_at;
  const t = new Date(normalizeIso(stamp)).getTime();
  const ageDays = (Date.now() - t) / 86_400_000;
  return ageDays > STALE_DAYS;
}

/**
 * Pre-filled message for "send drafts to client" flow.
 */
export function sendDraftsMessageText(
  contactName: string | null,
  draftCount: number,
  reviewLinkUrl: string,
): string {
  const greeting = contactName ? `Hey ${contactName},` : 'Hey there,';
  const plural = draftCount === 1 ? 'piece' : 'pieces';
  return `${greeting}

I've got ${draftCount} new ${plural} for your review. Take a look and approve, request changes, or reject inline:

${reviewLinkUrl}

Quick turnaround appreciated — happy to iterate.`;
}

/**
 * Pre-filled message for "nudge" — a draft has sat in awaiting_client too long.
 */
export function nudgeMessageText(
  contactName: string | null,
  reviewLinkUrl: string,
): string {
  const greeting = contactName ? `Hey ${contactName},` : 'Quick ping —';
  return `${greeting} the drafts at ${reviewLinkUrl} are still waiting on your review. Let me know if you need anything from me to help wrap them up.`;
}
