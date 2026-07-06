"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { AlertTriangle, ArrowUpRight, Check, CheckCircle2, Copy, Loader2, Maximize2, MapPin, RefreshCw, Send, Sparkles, Trash2, UserRound, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import PlatformBadge from "@/components/PlatformBadge";
import { deleteDraft, getPlatformGuidelines, regenerateClusterPiece, updateDraft, type ContentDraft, type PlatformGuidelines } from "@/lib/api";
import { translateFailureReason } from "@/lib/clusterStatus";
import { bodyWithoutDuplicateH1, splitOwnedSiteDraft } from "@/lib/ownedSiteDraft";
import { parseUTCISO } from "@/lib/utils/formatting";
import { MarkdownContent } from "@/components/content/MarkdownContent";
import { CitationsSubpanel } from "./CitationsSubpanel";
import { DeletePostedDialog } from "./DeletePostedDialog";
import { MarkPostedDialog } from "./MarkPostedDialog";

interface Props {
  brandId: number;
  clusterId: number;
  platform: string;
  draft: ContentDraft | null;
  /** Whether the current user is on the Pro tier — gates the Critic Notes subpanel. */
  isPro?: boolean;
  onUpdated: (draft: ContentDraft) => void;
  /** Called after the draft is deleted — the parent refetches the cluster. */
  onDeleted?: () => void;
  /** Extra content rendered at the bottom of the card, inside its border
   *  (e.g. the owned-site deep-version action). */
  footerExtra?: React.ReactNode;
}

const STATUS_TONE: Record<string, string> = {
  draft: "text-[var(--text-secondary)]",
  approved: "text-[#4ade80]",
  posted: "text-[#7dd3fc]",
  failed: "text-[#fb7185]",
};

function PieceStatusChip({
  status,
  delta,
}: {
  status: string;
  delta: number | null | undefined;
}) {
  if (status === "draft") {
    return (
      <span className="text-[11px] px-2 py-0.5 rounded-md border border-[var(--border-subtle)] bg-[rgba(148,163,184,0.10)] text-[var(--text-secondary)]">
        Drafted
      </span>
    );
  }
  if (status === "approved") {
    return (
      <span className="text-[11px] px-2 py-0.5 rounded-md border border-[rgba(251,191,36,0.22)] bg-[rgba(251,191,36,0.10)] text-[#fbbf24]">
        Approved
      </span>
    );
  }
  if (status === "failed") {
    return (
      <span className="text-[11px] px-2 py-0.5 rounded-md border border-[rgba(244,63,94,0.22)] bg-[rgba(244,63,94,0.10)] text-[#fb7185]">
        Failed
      </span>
    );
  }
  if (status === "posted") {
    if (delta === null || delta === undefined) {
      return (
        <span
          className="text-[11px] px-2 py-0.5 rounded-md border border-[rgba(56,189,248,0.22)] bg-[rgba(56,189,248,0.10)] text-[#7dd3fc]"
          title="Published — its effect on AI visibility is still being measured (needs a tracking run after posting)"
        >
          Posted · measuring
        </span>
      );
    }
    // Round first so a 0.04 delta doesn't render as a green "+0.0 pts".
    const rounded = Math.round(delta * 10) / 10;
    if (rounded === 0) {
      return (
        <span
          className="text-[11px] px-2 py-0.5 rounded-md border border-[var(--border-subtle)] bg-[rgba(148,163,184,0.08)] text-[var(--text-muted)]"
          title="Change in this brand's AI-visibility score for this question since the post went live"
        >
          Posted · no lift yet
        </span>
      );
    }
    const positive = rounded > 0;
    return (
      <span
        className={`text-[11px] px-2 py-0.5 rounded-md border ${
          positive
            ? "border-[rgba(34,197,94,0.22)] bg-[rgba(34,197,94,0.10)] text-[#4ade80]"
            : "border-[rgba(244,63,94,0.22)] bg-[rgba(244,63,94,0.10)] text-[#fb7185]"
        }`}
        title="Change in this brand's AI-visibility score for this question since the post went live"
      >
        Posted {positive ? "+" : ""}{rounded.toFixed(1)} pts
      </span>
    );
  }
  return null;
}

function LowEvidenceBadge({ brandId }: { brandId: number }) {
  return (
    <span
      className="inline-flex items-center gap-1 whitespace-nowrap text-[11px] px-2 py-0.5 rounded-md border border-[rgba(251,191,36,0.22)] bg-[rgba(251,191,36,0.10)] text-[#fbbf24]"
      title="Thin sourcing — the writer couldn't ground this post in verified sources. Add sources you trust, or rewrite to try again."
    >
      <AlertTriangle className="h-3 w-3" />
      Thin sourcing
      <Link
        href={`/content/${brandId}/sources`}
        className="ml-1 inline-flex items-center gap-0.5 underline decoration-dotted underline-offset-2 hover:text-[#fde68a]"
      >
        Add sources
        <ArrowUpRight className="h-2.5 w-2.5" />
      </Link>
    </span>
  );
}

/** Guidelines are keyed by base platform; drafts carry variants like
 *  linkedin_article / reddit_comment / x_thread. */
function basePlatform(platform: string): string {
  if (platform.startsWith("linkedin")) return "linkedin";
  if (platform.startsWith("reddit")) return "reddit";
  if (platform.startsWith("x")) return "x";
  return platform;
}

/** Plain-language "which account do I post this from" line, driven by the
 *  voice the piece was actually written in. */
function accountLine(effectiveAngle: string | null | undefined, platform: string): string | null {
  if (platform === "owned_site") {
    return "Publish this on your own website — it speaks as your company.";
  }
  if (effectiveAngle === "insider") {
    return "Post from your own account, under your real name — it's written as someone at your company. If it recommends your product, it includes a casual disclosure line; keep that line in.";
  }
  if (effectiveAngle === "neutral") {
    return "Post from a personal account — it's written as a neutral practitioner surveying the space. Don't add endorsements of your product, and don't claim to be unaffiliated.";
  }
  return null;
}

/** Where the piece physically goes, complementing the routing pin. */
function whereLine(platform: string, draft: ContentDraft): string | null {
  if (platform.startsWith("reddit")) {
    const brief = draft.content_brief;
    if (brief && !brief.startsWith("r/")) return "Reply as a top-level comment in the linked thread.";
    if (brief) return `Post as a new thread in ${brief}.`;
    return "Post as a new thread in a subreddit where your audience asks this question.";
  }
  if (platform === "quora") {
    return draft.target_title
      ? "Post as an answer to the linked Quora question."
      : "Find the matching question on Quora and post this as your answer.";
  }
  if (platform === "linkedin_article") return "Publish as an article from your LinkedIn profile (write an article, not a post).";
  if (platform.startsWith("linkedin")) return "Share as a post from your LinkedIn profile.";
  if (platform === "medium") return "Publish as a story from your Medium account.";
  if (platform.startsWith("x")) return "Post from your X account (threads go out as a connected series).";
  if (platform === "owned_site") return "Add it as a page or blog post on your site, then mark it posted with the live URL.";
  return null;
}

/** "How to post this" — account, destination, and disclosure guidance shown
 *  at the moment of copy. The FTC/disclosure copy lives server-side in
 *  PLATFORM_GUIDELINES (previously defined but never rendered anywhere). */
function HowToPost({ platform, draft }: { platform: string; draft: ContentDraft }) {
  const [guidelines, setGuidelines] = useState<PlatformGuidelines | null>(null);

  useEffect(() => {
    let cancelled = false;
    getPlatformGuidelines(basePlatform(platform)).then((g) => {
      if (!cancelled) setGuidelines(g);
    });
    return () => {
      cancelled = true;
    };
  }, [platform]);

  const account = accountLine(draft.effective_angle, platform);
  const where = whereLine(platform, draft);
  // Disclosure matters when the piece is written in an affiliated voice, or
  // on the platforms whose norms/rules call for it regardless.
  const showDisclaimer =
    !!guidelines?.disclaimer &&
    (draft.effective_angle === "insider" || ["reddit", "quora", "wikipedia"].includes(basePlatform(platform)));

  if (!account && !where && !showDisclaimer) return null;

  return (
    <div className="mt-4 pt-4 border-t border-[var(--border-subtle)]">
      <div className="text-[11px] uppercase tracking-wider text-[var(--text-faint)] font-semibold mb-2">
        How to post this
      </div>
      <div className="space-y-1.5 text-xs text-[var(--text-secondary)] leading-relaxed">
        {account && (
          <p className="flex gap-1.5">
            <UserRound className="h-3.5 w-3.5 shrink-0 mt-px text-[var(--text-muted)]" />
            <span>{account}</span>
          </p>
        )}
        {where && (
          <p className="flex gap-1.5">
            <MapPin className="h-3.5 w-3.5 shrink-0 mt-px text-[var(--text-muted)]" />
            <span>{where}</span>
          </p>
        )}
        {showDisclaimer && (
          <p className="flex gap-1.5 text-[#fbbf24]">
            <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-px" />
            <span>{guidelines!.disclaimer}</span>
          </p>
        )}
      </div>
    </div>
  );
}

export function PieceCard({ brandId, clusterId, platform, draft, isPro = false, onUpdated, onDeleted, footerExtra }: Props) {
  const [regenerating, setRegenerating] = useState(false);
  const [copied, setCopied] = useState(false);
  const [schemaCopied, setSchemaCopied] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [updatingStatus, setUpdatingStatus] = useState(false);
  const [confirmingPost, setConfirmingPost] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  // Owned-site drafts are real markdown with a JSON-LD schema block appended;
  // the UI splits the schema out (own section + copy button) and drops the
  // leading H1 when it duplicates the displayed title.
  const isOwnedSite = platform === "owned_site";
  const ownedParts = isOwnedSite && draft ? splitOwnedSiteDraft(draft.content_text) : null;
  const ownedBody = ownedParts ? bodyWithoutDuplicateH1(ownedParts.body, draft?.title) : null;

  async function confirmDelete() {
    if (!draft) return;
    await deleteDraft(draft.id);
    setConfirmingDelete(false);
    setExpanded(false);
    onDeleted?.();
  }

  async function regenerate() {
    setRegenerating(true);
    try {
      const updated = await regenerateClusterPiece(brandId, clusterId, platform);
      onUpdated(updated);
    } finally {
      setRegenerating(false);
    }
  }

  // Marking posted goes through MarkPostedDialog: it carries the last-second
  // account/disclosure reminder (reddit/quora), and captures the live URL —
  // required for owned_site (the pillar page siblings cross-reference),
  // optional elsewhere (powers "View live" links).
  async function confirmPosted(postedUrl: string | null) {
    if (!draft) return;
    setUpdatingStatus(true);
    try {
      onUpdated(
        await updateDraft(draft.id, {
          status: "posted",
          ...(postedUrl ? { posted_url: postedUrl } : {}),
        })
      );
      setConfirmingPost(false);
      setExpanded(false);
    } finally {
      setUpdatingStatus(false);
    }
  }

  async function copy() {
    if (!draft) return;
    // Owned-site: copy the page body only (it already opens with its H1);
    // the JSON-LD schema has its own copy button — it goes in <head>, not
    // the page body, and dragging 40 lines of JSON along was a papercut.
    const text = ownedParts
      ? ownedParts.body
      : draft.title
      ? `${draft.title}\n\n${draft.content_text}`
      : draft.content_text;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Best-effort
    }
  }

  async function copySchema() {
    if (!ownedParts?.jsonld) return;
    try {
      await navigator.clipboard.writeText(ownedParts.jsonld);
      setSchemaCopied(true);
      setTimeout(() => setSchemaCopied(false), 1500);
    } catch {
      // Best-effort
    }
  }

  return (
    <>
      <div className="card flex flex-col min-h-[220px]">
        <div className="flex items-center justify-between mb-3 gap-2">
          <PlatformBadge platform={platform} />
          <div className="flex items-center gap-2 min-w-0">
            {draft?.generation_state && draft.generation_state !== "done" && draft.generation_state !== "failed" && (
              <span className="inline-flex items-center gap-1 text-[10px] rounded-full px-1.5 py-0.5 bg-sky-500/15 text-sky-200 border border-sky-500/30">
                <span className="h-1.5 w-1.5 rounded-full bg-sky-300 animate-pulse" />
                {draft.generation_state}
              </span>
            )}
            {draft && (
              <PieceStatusChip status={draft.status} delta={draft.attribution_delta} />
            )}
          </div>
        </div>
        {/* Own row (never crowding the header chips); once posted the draft
            shipped — the sourcing nudge belongs to future rewrites, not here. */}
        {draft?.low_evidence && draft.status !== "posted" && (
          <div className="mb-2">
            <LowEvidenceBadge brandId={brandId} />
          </div>
        )}
        {draft?.generation_state === "failed" && (
          <div className="mb-2 text-xs text-rose-300 bg-rose-500/10 border border-rose-500/30 rounded px-2 py-1">
            Failed: {translateFailureReason(draft.failure_reason) ?? "unknown error"}
          </div>
        )}

        {draft ? (
          draft.status === "posted" ? (
            <div
              className="flex-1 flex flex-col justify-center gap-1.5 py-2 cursor-pointer"
              onClick={() => setExpanded(true)}
              title="Read the full post"
            >
              {draft.title && draft.title !== "(untitled)" && (
                <h4 className="text-sm font-semibold text-[var(--text-primary)] leading-snug line-clamp-2">
                  {draft.title}
                </h4>
              )}
              <p className="text-sm text-[var(--text-secondary)] leading-relaxed">
                Posted on{" "}
                {draft.posted_at
                  ? parseUTCISO(draft.posted_at).toLocaleDateString()
                  : "—"}
                {draft.posted_url && (
                  <>
                    {" · "}
                    <a
                      href={draft.posted_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-[var(--accent-foreground)] hover:underline"
                      onClick={(e) => e.stopPropagation()}
                    >
                      View live post ↗
                    </a>
                  </>
                )}
              </p>
            </div>
          ) : (
            <div
              className="flex-1 min-h-0 cursor-pointer"
              onClick={() => setExpanded(true)}
              title="Read the full post"
            >
              {draft.title && (
                <h4 className="font-semibold text-[var(--text-primary)] leading-snug line-clamp-2 mb-1.5">
                  {draft.title}
                </h4>
              )}
              <p className="text-sm text-[var(--text-secondary)] leading-relaxed line-clamp-[10] whitespace-pre-wrap">
                {ownedBody ?? draft.content_text}
              </p>
            </div>
          )
        ) : (
          <p className="text-sm text-[var(--text-faint)] italic flex-1">
            Not generated yet.
          </p>
        )}

        {draft && (platform === "reddit" || platform === "quora") && draft.content_brief && (
          <a
            href={draft.content_brief.startsWith("r/") ? `https://reddit.com/${draft.content_brief}` : draft.content_brief}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-2 flex items-start gap-1.5 rounded-md border border-[var(--border-subtle)] bg-[rgba(148,163,184,0.06)] px-2.5 py-2 text-xs font-medium text-[var(--accent-foreground)] hover:border-[var(--accent-foreground)]"
            title={
              platform === "reddit"
                ? draft.content_brief.startsWith("r/")
                  ? "Suggested subreddit for this post"
                  : "A real thread this comment answers — reply there"
                : "A real Quora question this answers"
            }
          >
            <MapPin className="h-3.5 w-3.5 shrink-0 mt-px" />
            <span className="min-w-0">
              {platform === "reddit" && draft.content_brief.startsWith("r/") && (
                <>Post in <span className="font-semibold">{draft.content_brief}</span></>
              )}
              {platform === "reddit" && !draft.content_brief.startsWith("r/") && (
                <>
                  Reply in this thread
                  {draft.target_title ? <>: <span className="font-semibold line-clamp-2">“{draft.target_title}”</span></> : null}
                </>
              )}
              {platform === "quora" && (
                <>
                  Answer
                  {draft.target_title ? <>: <span className="font-semibold line-clamp-2">“{draft.target_title}”</span></> : " this Quora question"}
                </>
              )}
            </span>
            <ArrowUpRight className="h-3.5 w-3.5 shrink-0 mt-px" />
          </a>
        )}

        <div className="mt-3 pt-3 border-t border-[var(--border-subtle)] flex items-center justify-between gap-2">
          <div className="flex items-center gap-1">
            {draft && (
              <>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setExpanded(true)}
                  className="!px-2"
                  title="Read the full post"
                >
                  <Maximize2 className="h-3 w-3" />
                  Read
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={copy}
                  className="!px-2"
                  title="Copy the text to paste where you'll publish it"
                >
                  {copied ? (
                    <>
                      <Check className="h-3 w-3 text-[#4ade80]" />
                      Copied
                    </>
                  ) : (
                    <>
                      <Copy className="h-3 w-3" />
                      Copy
                    </>
                  )}
                </Button>
              </>
            )}
          </div>
          <div className="flex items-center gap-1">
            {draft && draft.status !== "posted" && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setConfirmingPost(true)}
                disabled={updatingStatus}
                className="!px-2 text-[#7dd3fc] hover:text-[#bae6fd]"
                title="Mark this as published so its visibility impact gets tracked"
              >
                {updatingStatus ? <Loader2 className="h-3 w-3 animate-spin" /> : <Send className="h-3 w-3" />}
                Mark posted
              </Button>
            )}
            {/* Icon-only: four labeled actions overflow the 1/3-width card.
                The confirm dialog spells out the consequence in full. */}
            {draft && draft.status === "posted" && onDeleted && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setConfirmingDelete(true)}
                className="!px-2 text-[var(--text-muted)] hover:text-[#fb7185]"
                title="Delete this posted record (the live post stays up)"
                aria-label="Delete this posted record"
              >
                <Trash2 className="h-3 w-3" />
              </Button>
            )}
            <Button
              variant="ghost"
              size="sm"
              onClick={regenerate}
              disabled={regenerating}
              className="!px-2"
              title={
                !draft
                  ? "Write this post for the first time"
                  : draft.status === "posted"
                  ? "Generate a fresh working draft. The posted version stays live and keeps its attribution."
                  : "Rewrite this post from scratch"
              }
            >
              {regenerating ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : !draft ? (
                <Sparkles className="h-3 w-3" />
              ) : (
                <RefreshCw className="h-3 w-3" />
              )}
              {regenerating
                ? draft
                  ? "Regenerating…"
                  : "Generating…"
                : !draft
                ? "Generate"
                : draft.status === "posted"
                ? "Generate new draft"
                : "Rewrite"}
            </Button>
          </div>
        </div>
        {footerExtra}
      </div>

      {/* Portaled to <body>: any transformed ancestor (cards animate) turns
          position:fixed into position:absolute, which dumped this modal at the
          bottom of the page instead of centering it in the viewport. */}
      {expanded && draft && createPortal(
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
          onClick={() => setExpanded(false)}
        >
          <div
            className="card-elevated w-full max-w-2xl max-h-[85vh] flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3 mb-4">
              <div className="flex items-center gap-2 min-w-0 flex-wrap">
                <PlatformBadge platform={platform} />
                {draft.low_evidence && draft.status !== "posted" && <LowEvidenceBadge brandId={brandId} />}
                <PieceStatusChip status={draft.status} delta={draft.attribution_delta} />
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setExpanded(false)}
                className="!px-1.5"
                aria-label="Close"
              >
                <X className="h-4 w-4" />
              </Button>
            </div>

            {/* One scroll region for the whole body: post text, schema,
                sources, and posting guidance scroll together. Fixed sections
                below the text used to eat most of the modal's height — a
                draft with 8-10 citations squeezed the post into a sliver. */}
            <div className="flex-1 min-h-0 overflow-y-auto pr-2">
              {draft.title && draft.title !== "(untitled)" && (
                <h3 className="text-lg font-bold text-[var(--text-primary)] mb-3">
                  {draft.title}
                </h3>
              )}

              {ownedBody !== null ? (
                <MarkdownContent markdown={ownedBody} />
              ) : (
                <div className="whitespace-pre-wrap text-sm text-[var(--text-secondary)] leading-relaxed">
                  {draft.content_text}
                </div>
              )}

              {ownedParts?.jsonld && (
                <details className="mt-4 pt-4 border-t border-[var(--border-subtle)] group">
                  <summary className="cursor-pointer list-none flex items-center justify-between gap-2">
                    <span className="text-[11px] uppercase tracking-wider text-[var(--text-faint)] font-semibold">
                      Schema markup (JSON-LD)
                      <span className="ml-2 normal-case tracking-normal font-normal">
                        paste inside the page&apos;s &lt;head&gt; — click to expand
                      </span>
                    </span>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="!px-2 shrink-0"
                      onClick={(e) => {
                        e.preventDefault();
                        copySchema();
                      }}
                    >
                      {schemaCopied ? (
                        <>
                          <Check className="h-3 w-3 text-[#4ade80]" />
                          Copied
                        </>
                      ) : (
                        <>
                          <Copy className="h-3 w-3" />
                          Copy schema
                        </>
                      )}
                    </Button>
                  </summary>
                  <pre className="mt-2 rounded-md border border-[var(--border-subtle)] bg-[rgba(148,163,184,0.06)] p-3 text-xs text-[var(--text-secondary)] overflow-x-auto">
                    {ownedParts.jsonld}
                  </pre>
                </details>
              )}

              {(draft.citations?.length ?? 0) > 0 && (
                <div className="mt-4 pt-4 border-t border-[var(--border-subtle)]">
                  <div className="text-[11px] uppercase tracking-wider text-[var(--text-faint)] font-semibold mb-2">
                    Sources cited in this post
                  </div>
                  <CitationsSubpanel citations={draft.citations ?? []} />
                </div>
              )}

              {draft.status !== "posted" && <HowToPost platform={platform} draft={draft} />}
            </div>

            <div className="mt-4 pt-4 border-t border-[var(--border-subtle)] flex items-center justify-end gap-2">
              {draft.status === "posted" && onDeleted && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setConfirmingDelete(true)}
                  className="mr-auto text-[var(--text-muted)] hover:text-[#fb7185]"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  Delete
                </Button>
              )}
              <Button variant="outline" size="sm" onClick={copy}>
                {copied ? (
                  <>
                    <Check className="h-3.5 w-3.5 text-[#4ade80]" />
                    Copied
                  </>
                ) : (
                  <>
                    <Copy className="h-3.5 w-3.5" />
                    {isOwnedSite ? "Copy page" : "Copy text"}
                  </>
                )}
              </Button>
              {draft.status !== "posted" && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setConfirmingPost(true)}
                  disabled={updatingStatus}
                  className="text-[#7dd3fc]"
                >
                  {updatingStatus ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
                  Mark posted
                </Button>
              )}
              <Button
                variant="outline"
                size="sm"
                onClick={regenerate}
                disabled={regenerating}
              >
                {regenerating ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <RefreshCw className="h-3.5 w-3.5" />
                )}
                Rewrite
              </Button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {confirmingPost && draft && (
        <MarkPostedDialog
          platform={platform}
          draft={draft}
          onConfirm={confirmPosted}
          onClose={() => setConfirmingPost(false)}
        />
      )}

      {confirmingDelete && draft && (
        <DeletePostedDialog
          draft={draft}
          onConfirm={confirmDelete}
          onClose={() => setConfirmingDelete(false)}
        />
      )}
    </>
  );
}
