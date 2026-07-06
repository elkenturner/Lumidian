"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { AlertTriangle, Link2, Loader2, Send, UserRound, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import PlatformBadge from "@/components/PlatformBadge";
import { getPlatformGuidelines, type ContentDraft, type PlatformGuidelines } from "@/lib/api";

interface Props {
  platform: string;
  draft: ContentDraft;
  onConfirm: (postedUrl: string | null) => Promise<void>;
  onClose: () => void;
}

function basePlatform(platform: string): string {
  if (platform.startsWith("linkedin")) return "linkedin";
  if (platform.startsWith("reddit")) return "reddit";
  if (platform.startsWith("x")) return "x";
  return platform;
}

/**
 * Confirmation step for "Mark posted". Replaces the raw window.prompt that
 * captured the owned-site URL, gives reddit/quora a last-second
 * account/disclosure reminder, and captures an optional live-post URL on
 * every platform (it powers "View live" links and cross-referencing).
 */
export function MarkPostedDialog({ platform, draft, onConfirm, onClose }: Props) {
  const [url, setUrl] = useState("");
  const [urlError, setUrlError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [guidelines, setGuidelines] = useState<PlatformGuidelines | null>(null);

  const isOwnedSite = platform === "owned_site";
  const base = basePlatform(platform);
  const needsReminder = base === "reddit" || base === "quora";

  useEffect(() => {
    if (!needsReminder) return;
    let cancelled = false;
    getPlatformGuidelines(base).then((g) => {
      if (!cancelled) setGuidelines(g);
    });
    return () => {
      cancelled = true;
    };
  }, [base, needsReminder]);

  const accountReminder =
    draft.effective_angle === "insider"
      ? "Post from your own account, under your real name — this piece speaks as someone at your company."
      : draft.effective_angle === "neutral"
      ? "Post from a personal account — this piece speaks as a neutral practitioner. Don't add endorsements."
      : null;

  async function confirm() {
    const trimmed = url.trim();
    if (trimmed && !/^https?:\/\/\S+\.\S+/.test(trimmed)) {
      setUrlError("That doesn't look like a link — it should start with http(s)://");
      return;
    }
    if (isOwnedSite && !trimmed) {
      setUrlError("Paste the published page's URL — it's what lets your other posts link back to it.");
      return;
    }
    setBusy(true);
    try {
      await onConfirm(trimmed || null);
    } finally {
      setBusy(false);
    }
  }

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="card-elevated w-full max-w-md"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 mb-3">
          <div className="flex items-center gap-2">
            <PlatformBadge platform={platform} />
            <h3 className="text-base font-bold text-[var(--text-primary)]">Mark as posted</h3>
          </div>
          <Button variant="ghost" size="sm" onClick={onClose} className="!px-1.5" aria-label="Close">
            <X className="h-4 w-4" />
          </Button>
        </div>

        <p className="text-xs text-[var(--text-secondary)] leading-relaxed mb-3">
          This tells us the post is live so its effect on your AI visibility gets measured from the
          next report onward.
        </p>

        {(accountReminder || (needsReminder && guidelines?.disclaimer)) && (
          <div className="mb-3 rounded-md border border-[var(--border-subtle)] bg-[rgba(148,163,184,0.06)] px-3 py-2.5 space-y-1.5 text-xs leading-relaxed">
            {accountReminder && (
              <p className="flex gap-1.5 text-[var(--text-secondary)]">
                <UserRound className="h-3.5 w-3.5 shrink-0 mt-px text-[var(--text-muted)]" />
                <span>{accountReminder}</span>
              </p>
            )}
            {needsReminder && guidelines?.disclaimer && (
              <p className="flex gap-1.5 text-[#fbbf24]">
                <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-px" />
                <span>{guidelines.disclaimer}</span>
              </p>
            )}
          </div>
        )}

        <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1.5">
          <span className="flex items-center gap-1.5">
            <Link2 className="h-3.5 w-3.5" />
            {isOwnedSite ? "URL of the published page" : "Link to the live post (optional)"}
          </span>
        </label>
        <input
          type="url"
          value={url}
          onChange={(e) => {
            setUrl(e.target.value);
            setUrlError(null);
          }}
          placeholder="https://…"
          className="w-full rounded-md border border-[var(--border-subtle)] bg-[var(--bg-base)] px-3 py-2 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-faint)] focus:outline-none focus:border-[var(--accent)]"
        />
        {isOwnedSite && !urlError && (
          <p className="mt-1 text-[11px] text-[var(--text-faint)]">
            Needed so your other posts can link back to this page.
          </p>
        )}
        {urlError && <p className="mt-1 text-[11px] text-[#fb7185]">{urlError}</p>}

        <div className="mt-4 flex items-center justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant="outline" size="sm" onClick={confirm} disabled={busy} className="text-[#7dd3fc]">
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
            Mark posted
          </Button>
        </div>
      </div>
    </div>,
    document.body
  );
}
