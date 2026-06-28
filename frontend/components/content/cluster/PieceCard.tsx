"use client";

import { useState } from "react";
import { Check, Copy, Loader2, Maximize2, RefreshCw, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import PlatformBadge from "@/components/PlatformBadge";
import { regenerateClusterPiece, type ContentDraft } from "@/lib/api";
import { CitationsSubpanel } from "./CitationsSubpanel";
import { CriticNotesSubpanel } from "./CriticNotesSubpanel";

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
        <span className="text-[11px] px-2 py-0.5 rounded-md border border-[rgba(56,189,248,0.22)] bg-[rgba(56,189,248,0.10)] text-[#7dd3fc]">
          Posted, no lift yet
        </span>
      );
    }
    const positive = delta >= 0;
    return (
      <span
        className={`text-[11px] px-2 py-0.5 rounded-md border ${
          positive
            ? "border-[rgba(34,197,94,0.22)] bg-[rgba(34,197,94,0.10)] text-[#4ade80]"
            : "border-[rgba(244,63,94,0.22)] bg-[rgba(244,63,94,0.10)] text-[#fb7185]"
        }`}
      >
        Posted {positive ? "+" : ""}{delta.toFixed(1)}pp
      </span>
    );
  }
  return null;
}

export function PieceCard({ brandId, clusterId, platform, draft, isPro = false, onUpdated }: Props) {
  const [regenerating, setRegenerating] = useState(false);
  const [copied, setCopied] = useState(false);
  const [expanded, setExpanded] = useState(false);

  async function regenerate() {
    setRegenerating(true);
    try {
      const updated = await regenerateClusterPiece(brandId, clusterId, platform);
      onUpdated(updated);
    } finally {
      setRegenerating(false);
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
            {draft && (
              <PieceStatusChip status={draft.status} delta={draft.attribution_delta} />
            )}
          </div>
        </div>
        {draft?.generation_state === "failed" && (
          <div className="mb-2 text-xs text-rose-300 bg-rose-500/10 border border-rose-500/30 rounded px-2 py-1">
            Failed: {draft.failure_reason || "unknown error"}
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
              <p className="text-sm text-[var(--text-secondary)] leading-relaxed line-clamp-5 flex-1">
                {draft.content_text}
              </p>
            </>
          )
        ) : (
          <p className="text-sm text-[var(--text-faint)] italic flex-1">
            Not generated yet.
          </p>
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
                  title="View full draft"
                >
                  <Maximize2 className="h-3 w-3" />
                  View
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={copy}
                  className="!px-2"
                  title="Copy text"
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
          <Button
            variant="ghost"
            size="sm"
            onClick={regenerate}
            disabled={regenerating}
            className="!px-2"
          >
            {regenerating ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <RefreshCw className="h-3 w-3" />
            )}
            {regenerating
              ? "Regenerating…"
              : draft?.status === "posted"
              ? "Generate new draft"
              : "Regenerate"}
          </Button>
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
              <div className="flex items-center gap-2 min-w-0">
                <PlatformBadge platform={platform} />
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

            {draft.title && (
              <h3 className="text-lg font-bold text-[var(--text-primary)] mb-3">
                {draft.title}
              </h3>
            )}

            <div className="flex-1 overflow-y-auto whitespace-pre-wrap text-sm text-[var(--text-secondary)] leading-relaxed pr-2">
              {draft.content_text}
            </div>

            <div className="mt-4 pt-4 border-t border-[var(--border-subtle)] grid grid-cols-1 lg:grid-cols-2 gap-4">
              <div>
                <div className="text-[11px] uppercase tracking-wider text-[var(--text-faint)] font-semibold mb-2">
                  Citations
                </div>
                <CitationsSubpanel citations={draft.citations ?? []} />
              </div>
              <div>
                <div className="text-[11px] uppercase tracking-wider text-[var(--text-faint)] font-semibold mb-2">
                  Critic notes
                </div>
                <CriticNotesSubpanel isPro={isPro} notes={null} />
              </div>
            </div>

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
                {regenerating ? "Regenerating…" : "Regenerate"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
