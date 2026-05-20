"use client";

import { useState } from "react";
import { Check, Copy, Loader2, Maximize2, RefreshCw, X } from "lucide-react";
import PlatformBadge from "@/components/PlatformBadge";
import { regenerateClusterPiece, type ContentDraft } from "@/lib/api";

interface Props {
  brandId: number;
  clusterId: number;
  platform: string;
  draft: ContentDraft | null;
  onUpdated: (draft: ContentDraft) => void;
}

const STATUS_TONE: Record<string, string> = {
  draft: "text-[var(--text-secondary)]",
  approved: "text-[#4ade80]",
  posted: "text-[#7dd3fc]",
  failed: "text-[#fb7185]",
};

export function PieceCard({ brandId, clusterId, platform, draft, onUpdated }: Props) {
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
        <div className="flex items-center justify-between mb-3">
          <PlatformBadge platform={platform} />
          {draft && (
            <span
              className={`text-[11px] font-semibold uppercase tracking-wide ${
                STATUS_TONE[draft.status] ?? "text-[var(--text-muted)]"
              }`}
            >
              {draft.status}
            </span>
          )}
        </div>

        {draft ? (
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
        ) : (
          <p className="text-sm text-[var(--text-faint)] italic flex-1">
            Not generated yet.
          </p>
        )}

        <div className="mt-3 pt-3 border-t border-[var(--border-subtle)] flex items-center justify-between gap-2">
          <div className="flex items-center gap-1">
            {draft && (
              <>
                <button
                  type="button"
                  onClick={() => setExpanded(true)}
                  className="btn btn-ghost !py-1 !px-2 text-xs"
                  title="View full draft"
                >
                  <Maximize2 className="h-3 w-3" />
                  View
                </button>
                <button
                  type="button"
                  onClick={copy}
                  className="btn btn-ghost !py-1 !px-2 text-xs"
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
                </button>
              </>
            )}
          </div>
          <button
            type="button"
            onClick={regenerate}
            disabled={regenerating}
            className="btn btn-ghost !py-1 !px-2 text-xs"
          >
            {regenerating ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <RefreshCw className="h-3 w-3" />
            )}
            {regenerating ? "Regenerating…" : "Regenerate"}
          </button>
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
                <span
                  className={`text-[11px] font-semibold uppercase tracking-wide ${
                    STATUS_TONE[draft.status] ?? "text-[var(--text-muted)]"
                  }`}
                >
                  {draft.status}
                </span>
              </div>
              <button
                type="button"
                onClick={() => setExpanded(false)}
                className="btn btn-ghost !py-1 !px-1.5"
                aria-label="Close"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {draft.title && (
              <h3 className="text-lg font-bold text-[var(--text-primary)] mb-3">
                {draft.title}
              </h3>
            )}

            <div className="flex-1 overflow-y-auto whitespace-pre-wrap text-sm text-[var(--text-secondary)] leading-relaxed pr-2">
              {draft.content_text}
            </div>

            <div className="mt-4 pt-4 border-t border-[var(--border-subtle)] flex items-center justify-end gap-2">
              <button type="button" onClick={copy} className="btn btn-secondary !py-1.5 text-xs">
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
              </button>
              <button
                type="button"
                onClick={regenerate}
                disabled={regenerating}
                className="btn btn-secondary !py-1.5 text-xs"
              >
                {regenerating ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <RefreshCw className="h-3.5 w-3.5" />
                )}
                {regenerating ? "Regenerating…" : "Regenerate"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
