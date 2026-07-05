"use client";

import { useState } from "react";
import Link from "next/link";
import { AlertTriangle, ArrowUpRight, Check, CheckCircle2, Copy, Loader2, Maximize2, MapPin, RefreshCw, Send, Sparkles, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import PlatformBadge from "@/components/PlatformBadge";
import { regenerateClusterPiece, updateDraft, type ContentDraft } from "@/lib/api";
import { translateFailureReason } from "@/lib/clusterStatus";
import { CitationsSubpanel } from "./CitationsSubpanel";

interface Props {
  brandId: number;
  clusterId: number;
  platform: string;
  draft: ContentDraft | null;
  /** Whether the current user is on the Pro tier — gates the Critic Notes subpanel. */
  isPro?: boolean;
  onUpdated: (draft: ContentDraft) => void;
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
          Posted · no change yet
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
      className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-md border border-[rgba(251,191,36,0.22)] bg-[rgba(251,191,36,0.10)] text-[#fbbf24]"
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

export function PieceCard({ brandId, clusterId, platform, draft, isPro = false, onUpdated }: Props) {
  const [regenerating, setRegenerating] = useState(false);
  const [copied, setCopied] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [updatingStatus, setUpdatingStatus] = useState(false);

  async function regenerate() {
    setRegenerating(true);
    try {
      const updated = await regenerateClusterPiece(brandId, clusterId, platform);
      onUpdated(updated);
    } finally {
      setRegenerating(false);
    }
  }

  async function setStatus(status: "draft" | "approved" | "posted") {
    if (!draft) return;
    setUpdatingStatus(true);
    try {
      onUpdated(await updateDraft(draft.id, { status }));
    } finally {
      setUpdatingStatus(false);
    }
  }

  async function copy() {
    if (!draft) return;
    const text = draft.title
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
            {draft?.low_evidence && <LowEvidenceBadge brandId={brandId} />}
            {draft && (
              <PieceStatusChip status={draft.status} delta={draft.attribution_delta} />
            )}
          </div>
        </div>
        {draft?.generation_state === "failed" && (
          <div className="mb-2 text-xs text-rose-300 bg-rose-500/10 border border-rose-500/30 rounded px-2 py-1">
            Failed: {translateFailureReason(draft.failure_reason) ?? "unknown error"}
          </div>
        )}

        {draft ? (
          draft.status === "posted" ? (
            <div className="flex-1 flex flex-col justify-center gap-2 py-2">
              <p className="text-sm text-[var(--text-secondary)] leading-relaxed">
                Posted on{" "}
                {draft.posted_at
                  ? new Date(draft.posted_at).toLocaleDateString()
                  : "—"}
                {draft.posted_url && (
                  <>
                    {" · "}
                    <a
                      href={draft.posted_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-[var(--accent-foreground)] hover:underline"
                    >
                      View live post ↗
                    </a>
                  </>
                )}
              </p>
            </div>
          ) : (
            <>
              {draft.title && (
                <h4 className="font-semibold text-[var(--text-primary)] leading-snug line-clamp-2 mb-1.5">
                  {draft.title}
                </h4>
              )}
              <p className="text-sm text-[var(--text-secondary)] leading-relaxed line-clamp-[10] flex-1 whitespace-pre-wrap">
                {draft.content_text}
              </p>
            </>
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
            {draft && draft.status !== "posted" && (
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
                onClick={() => setStatus("posted")}
                disabled={updatingStatus}
                className="!px-2 text-[#7dd3fc] hover:text-[#bae6fd]"
                title="Mark this as published so its visibility impact gets tracked"
              >
                {updatingStatus ? <Loader2 className="h-3 w-3 animate-spin" /> : <Send className="h-3 w-3" />}
                Mark posted
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
      </div>

      {expanded && draft && (
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
                {draft.low_evidence && <LowEvidenceBadge brandId={brandId} />}
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

            {draft.title && draft.title !== "(untitled)" && (
              <h3 className="text-lg font-bold text-[var(--text-primary)] mb-3">
                {draft.title}
              </h3>
            )}

            <div className="flex-1 overflow-y-auto whitespace-pre-wrap text-sm text-[var(--text-secondary)] leading-relaxed pr-2">
              {draft.content_text}
            </div>

            {(draft.citations?.length ?? 0) > 0 && (
              <div className="mt-4 pt-4 border-t border-[var(--border-subtle)]">
                <div className="text-[11px] uppercase tracking-wider text-[var(--text-faint)] font-semibold mb-2">
                  Sources cited in this post
                </div>
                <CitationsSubpanel citations={draft.citations ?? []} />
              </div>
            )}

            <div className="mt-4 pt-4 border-t border-[var(--border-subtle)] flex items-center justify-end gap-2">
              <Button variant="outline" size="sm" onClick={copy}>
                {copied ? (
                  <>
                    <Check className="h-3.5 w-3.5 text-[#4ade80]" />
                    Copied
                  </>
                ) : (
                  <>
                    <Copy className="h-3.5 w-3.5" />
                    Copy text
                  </>
                )}
              </Button>
              {draft.status !== "posted" && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setStatus("posted")}
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
        </div>
      )}
    </>
  );
}
