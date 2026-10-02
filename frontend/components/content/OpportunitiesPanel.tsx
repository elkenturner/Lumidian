"use client";

import { useEffect, useState } from "react";
import {
  ArrowUpRight,
  Check,
  ChevronDown,
  ChevronRight,
  Copy,
  Loader2,
  Send,
  Sparkles,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import PlatformBadge from "@/components/PlatformBadge";
import {
  getOpportunities,
  draftOpportunity,
  dismissOpportunity,
  updateDraft,
  parseApiError,
  type ContentOpportunity,
  type ContentDraft,
} from "@/lib/api";

interface Props {
  brandId: number;
  /** Collapsed by default when the brand already has cluster content. */
}

export function OpportunitiesPanel({ brandId }: Props) {
  const [expanded, setExpanded] = useState(false);
  const [opportunities, setOpportunities] = useState<ContentOpportunity[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [drafts, setDrafts] = useState<Record<number, ContentDraft>>({});
  // Sets, not scalars: two rows can be in flight at once, and a scalar would
  // re-enable row A's button as soon as row B starts (duplicate LLM drafts).
  const [draftingIds, setDraftingIds] = useState<Set<number>>(new Set());
  const [postingIds, setPostingIds] = useState<Set<number>>(new Set());
  const addTo = (setter: React.Dispatch<React.SetStateAction<Set<number>>>, id: number) =>
    setter((prev) => new Set(prev).add(id));
  const removeFrom = (setter: React.Dispatch<React.SetStateAction<Set<number>>>, id: number) =>
    setter((prev) => { const next = new Set(prev); next.delete(id); return next; });
  const [dismissingIds, setDismissingIds] = useState<Set<number>>(new Set());
  const [copiedId, setCopiedId] = useState<number | null>(null);
  const [rowErrors, setRowErrors] = useState<Record<number, string>>({});

  useEffect(() => {
    if (!Number.isFinite(brandId)) return;
    let cancelled = false;
    getOpportunities(brandId)
      .then((opps) => {
        if (!cancelled) setOpportunities(opps);
      })
      .catch(() => {
        if (!cancelled) setLoadError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [brandId]);

  function setRowError(id: number, message: string | null) {
    setRowErrors((prev) => {
      const next = { ...prev };
      if (message) next[id] = message;
      else delete next[id];
      return next;
    });
  }

  async function handleDraft(opp: ContentOpportunity) {
    if (draftingIds.has(opp.id)) return;
    addTo(setDraftingIds, opp.id);
    setRowError(opp.id, null);
    try {
      const draft = await draftOpportunity(opp.id);
      setDrafts((prev) => ({ ...prev, [opp.id]: draft }));
      setOpportunities((prev) =>
        (prev ?? []).map((o) => (o.id === opp.id ? { ...o, status: "drafted" } : o)),
      );
    } catch (e) {
      setRowError(opp.id, parseApiError(e, "Couldn't draft a reply for this thread. Please try again."));
    } finally {
      removeFrom(setDraftingIds, opp.id);
    }
  }

  async function handleDismiss(opp: ContentOpportunity) {
    setDismissingIds((prev) => new Set(prev).add(opp.id));
    try {
      await dismissOpportunity(opp.id);
      // Give the fade-out transition a beat before removing the row.
      setTimeout(() => {
        setOpportunities((prev) => (prev ?? []).filter((o) => o.id !== opp.id));
        setDismissingIds((prev) => {
          const next = new Set(prev);
          next.delete(opp.id);
          return next;
        });
      }, 180);
    } catch (e) {
      setDismissingIds((prev) => {
        const next = new Set(prev);
        next.delete(opp.id);
        return next;
      });
      setRowError(opp.id, parseApiError(e, "Couldn't dismiss this thread. Please try again."));
    }
  }

  async function handleMarkPosted(opp: ContentOpportunity) {
    const draft = drafts[opp.id];
    if (!draft) return;
    if (postingIds.has(opp.id)) return;
    addTo(setPostingIds, opp.id);
    setRowError(opp.id, null);
    try {
      const updated = await updateDraft(draft.id, { status: "posted" });
      setDrafts((prev) => ({ ...prev, [opp.id]: updated }));
    } catch (e) {
      setRowError(opp.id, parseApiError(e, "Couldn't mark this as posted. Please try again."));
    } finally {
      removeFrom(setPostingIds, opp.id);
    }
  }

  async function copyDraft(opp: ContentOpportunity) {
    const draft = drafts[opp.id];
    if (!draft) return;
    const text = draft.title ? `${draft.title}\n\n${draft.content_text}` : draft.content_text;
    try {
      await navigator.clipboard.writeText(text);
      setCopiedId(opp.id);
      setTimeout(() => setCopiedId(null), 1500);
    } catch {
      // Best-effort — clipboard access can fail silently, not worth surfacing.
    }
  }

  // Non-critical surface — a failed load or an empty queue should never leave
  // a broken widget sitting on the board.
  if (loadError || opportunities === null || opportunities.length === 0) return null;

  const rows = opportunities
    .filter((o) => o.status !== "dismissed")
    .sort((a, b) => {
      if (a.status !== b.status) return a.status === "new" ? -1 : 1;
      return (b.relevance_score ?? 0) - (a.relevance_score ?? 0);
    });

  if (rows.length === 0) return null;

  const newCount = rows.filter((o) => o.status === "new").length;

  // Present-but-secondary: the top rows are always visible so the section
  // never reads as hidden, while the long tail stays behind a toggle.
  const visibleRows = expanded ? rows : rows.slice(0, 3);
  const hiddenCount = rows.length - visibleRows.length;

  return (
    <div className="card !p-0 overflow-hidden">
      <div className="px-5 py-3 flex items-center justify-between">
        <span className="flex items-center gap-2 font-semibold text-[var(--text-primary)]">
          Live threads to join
          {newCount > 0 && (
            <span className="text-[11px] font-semibold px-1.5 py-0.5 rounded-full bg-[rgba(96,165,250,0.15)] text-[var(--accent-foreground)]">
              {newCount}
            </span>
          )}
        </span>
        <span className="text-xs text-[var(--text-faint)] hidden sm:block">
          Real conversations matching your tracked questions. Reply there to build presence AI engines retrieve.
        </span>
      </div>

      {(
        <div className="border-t border-[var(--border-subtle)]">
          <div className="divide-y divide-[var(--border-subtle)]">
            {visibleRows.map((opp) => (
              <OpportunityRow
                key={opp.id}
                opp={opp}
                draft={drafts[opp.id]}
                drafting={draftingIds.has(opp.id)}
                posting={postingIds.has(opp.id)}
                dismissing={dismissingIds.has(opp.id)}
                copied={copiedId === opp.id}
                error={rowErrors[opp.id]}
                onDraft={() => handleDraft(opp)}
                onDismiss={() => handleDismiss(opp)}
                onMarkPosted={() => handleMarkPosted(opp)}
                onCopy={() => copyDraft(opp)}
              />
            ))}
          </div>
          {hiddenCount > 0 && (
            <button
              type="button"
              onClick={() => setExpanded(true)}
              className="w-full px-5 py-2.5 text-left text-xs font-medium text-[var(--accent-foreground)] hover:bg-[var(--bg-card)] border-t border-[var(--border-subtle)]"
            >
              Show all {rows.length} threads
            </button>
          )}
          {expanded && rows.length > 3 && (
            <button
              type="button"
              onClick={() => setExpanded(false)}
              className="w-full px-5 py-2.5 text-left text-xs font-medium text-[var(--text-faint)] hover:bg-[var(--bg-card)] border-t border-[var(--border-subtle)]"
            >
              Show fewer
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function OpportunityRow({
  opp,
  draft,
  drafting,
  posting,
  dismissing,
  copied,
  error,
  onDraft,
  onDismiss,
  onMarkPosted,
  onCopy,
}: {
  opp: ContentOpportunity;
  draft?: ContentDraft;
  drafting: boolean;
  posting: boolean;
  dismissing: boolean;
  copied: boolean;
  error?: string;
  onDraft: () => void;
  onDismiss: () => void;
  onMarkPosted: () => void;
  onCopy: () => void;
}) {
  // The backend flips status to "drafted" the moment a draft is created, so
  // this only shows when this session doesn't have the draft text cached
  // (e.g. a fresh load that landed on an already-drafted opportunity).
  const showDraftedChip = opp.status === "drafted" && !draft;

  return (
    <div
      className={`px-5 py-3 transition-opacity duration-200 ${dismissing ? "opacity-0" : "opacity-100"}`}
    >
      <div className="flex flex-wrap items-center gap-2.5">
        <PlatformBadge platform={opp.platform} size="sm" />
        <a
          href={opp.thread_url}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex min-w-0 max-w-md items-center gap-1 truncate text-sm font-medium text-[var(--text-primary)] underline-offset-2 hover:underline"
        >
          <span className="truncate">{opp.thread_title || opp.thread_url}</span>
          <ArrowUpRight className="h-3 w-3 shrink-0 text-[var(--text-faint)]" />
        </a>
        {opp.subreddit && (
          <span className="text-xs text-[var(--text-faint)]">r/{opp.subreddit}</span>
        )}
        <span className="text-xs text-[var(--text-faint)]">
          {Math.round(opp.relevance_score)}% match
        </span>

        <div className="ml-auto flex items-center gap-1">
          {showDraftedChip ? (
            <span className="text-[11px] px-2 py-0.5 rounded-md border border-[var(--border-subtle)] bg-[rgba(148,163,184,0.10)] text-[var(--text-secondary)]">
              Drafted
            </span>
          ) : !draft ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={onDraft}
              disabled={drafting}
              className="!px-2"
            >
              {drafting ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <Sparkles className="h-3 w-3" />
              )}
              Draft reply
            </Button>
          ) : null}
          {!draft && (
            <Button
              variant="ghost"
              size="sm"
              onClick={onDismiss}
              disabled={dismissing || drafting}
              className="!px-2 text-[var(--text-faint)]"
              title="Not a fit? Hide this thread"
            >
              <X className="h-3 w-3" />
              Dismiss
            </Button>
          )}
        </div>
      </div>

      {error && <p className="mt-1.5 text-xs text-[#fb7185]">{error}</p>}

      {draft && (
        <div className="mt-3 rounded-md border border-[var(--border-subtle)] bg-[rgba(148,163,184,0.05)] p-3">
          {draft.title && (
            <h4 className="mb-1.5 text-sm font-semibold text-[var(--text-primary)]">
              {draft.title}
            </h4>
          )}
          <p className="whitespace-pre-wrap text-sm leading-relaxed text-[var(--text-secondary)]">
            {draft.content_text}
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-[var(--border-subtle)] pt-3">
            <Button variant="outline" size="sm" onClick={onCopy}>
              {copied ? (
                <>
                  <Check className="h-3.5 w-3.5 text-[#4ade80]" />
                  Copied
                </>
              ) : (
                <>
                  <Copy className="h-3.5 w-3.5" />
                  Copy
                </>
              )}
            </Button>
            {draft.status !== "posted" ? (
              <Button
                variant="outline"
                size="sm"
                onClick={onMarkPosted}
                disabled={posting}
                className="text-[#7dd3fc]"
              >
                {posting ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Send className="h-3.5 w-3.5" />
                )}
                Mark posted
              </Button>
            ) : (
              <span className="text-[11px] px-2 py-0.5 rounded-md border border-[rgba(56,189,248,0.22)] bg-[rgba(56,189,248,0.10)] text-[#7dd3fc]">
                Posted
              </span>
            )}
            <a
              href={opp.thread_url}
              target="_blank"
              rel="noopener noreferrer"
              className="ml-auto inline-flex items-center gap-1 text-xs text-[var(--accent-foreground)] hover:underline"
            >
              Open thread
              <ArrowUpRight className="h-3 w-3" />
            </a>
          </div>
        </div>
      )}
    </div>
  );
}
