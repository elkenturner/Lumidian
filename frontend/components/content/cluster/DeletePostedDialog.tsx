"use client";

import { useState } from "react";
import { createPortal } from "react-dom";
import { Loader2, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import PlatformBadge from "@/components/PlatformBadge";
import { CLUSTER_PLATFORM_LABELS } from "@/lib/clusterPlatforms";
import type { ContentDraft } from "@/lib/api";

interface Props {
  draft: ContentDraft;
  onConfirm: () => Promise<void>;
  onClose: () => void;
}

function baseLabel(platform: string): string {
  if (platform === "owned_site") return "your site";
  if (platform.startsWith("linkedin")) return "LinkedIn";
  if (platform.startsWith("reddit")) return "Reddit";
  if (platform.startsWith("x")) return "X";
  return CLUSTER_PLATFORM_LABELS[platform] ?? platform;
}

/**
 * Confirmation step for deleting a posted piece's record. The consequence
 * (record + measured lift disappear here; the live post stays up out there)
 * is stated in visible text, not a tooltip.
 */
export function DeletePostedDialog({ draft, onConfirm, onClose }: Props) {
  const [busy, setBusy] = useState(false);
  const label = baseLabel(draft.platform);

  async function confirm() {
    setBusy(true);
    try {
      await onConfirm();
    } finally {
      setBusy(false);
    }
  }

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <div className="card-elevated w-full max-w-md" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3 mb-3">
          <div className="flex items-center gap-2">
            <PlatformBadge platform={draft.platform} />
            <h3 className="text-base font-bold text-[var(--text-primary)]">Delete this posted record?</h3>
          </div>
          <Button variant="ghost" size="sm" onClick={onClose} className="!px-1.5" aria-label="Close">
            <X className="h-4 w-4" />
          </Button>
        </div>

        <p className="text-xs text-[var(--text-secondary)] leading-relaxed mb-2">
          This removes the post and its measured lift from Lumidian — it will no longer count toward
          this question. The live post on {label} stays up; take it down there yourself if you need to.
        </p>
        {draft.platform === "owned_site" && (
          <p className="text-xs text-[var(--text-secondary)] leading-relaxed mb-2">
            If this page was the one your other posts link back to, that link is cleared too.
          </p>
        )}

        <div className="mt-4 flex items-center justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={confirm}
            disabled={busy}
            className="text-[#fb7185] hover:text-[#fda4af]"
          >
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
            Delete
          </Button>
        </div>
      </div>
    </div>,
    document.body
  );
}
