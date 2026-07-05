"use client";

import { useState } from "react";
import { Check, ExternalLink, Loader2, ScrollText } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  acceptClusterPillar,
  regenerateClusterPiece,
  rejectClusterPillar,
  type ContentClusterDetail,
  type ContentDraft,
  type PillarCandidate,
} from "@/lib/api";
import { PieceCard } from "./PieceCard";

interface Props {
  brandId: number;
  cluster: ContentClusterDetail;
  candidate: PillarCandidate | null;
  draft: ContentDraft | null;
  onClusterUpdated: (c: ContentClusterDetail) => void;
  onDraftUpdated: (d: ContentDraft) => void;
}

/**
 * Anchor piece for a cluster's own-site page. Wraps a PieceCard
 * (platform="owned_site") with the pillar proposal / attached states
 * rendered above it. Absorbs the old standalone PillarCard.
 */
export function OwnedSiteCard({ brandId, cluster, candidate, draft, onClusterUpdated, onDraftUpdated }: Props) {
  const [busy, setBusy] = useState(false);
  const [deepGenerating, setDeepGenerating] = useState(false);
  const showProposal = cluster.pillar_mode === "proposed" && !!candidate && !draft;

  async function writeDeepVersion() {
    setDeepGenerating(true);
    try {
      const updated = await regenerateClusterPiece(brandId, cluster.id, "owned_site", { depth: "deep" });
      onDraftUpdated(updated);
    } finally {
      setDeepGenerating(false);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      {cluster.pillar_mode === "attached" && cluster.pillar_url && (
        <div className="rounded-md border border-[rgba(34,197,94,0.25)] bg-[rgba(34,197,94,0.06)] px-3 py-2 text-xs text-[var(--text-secondary)] flex items-center gap-2">
          <Check className="h-3.5 w-3.5 text-[#4ade80] shrink-0" />
          <span className="min-w-0 truncate">
            Anchored to{" "}
            <a href={cluster.pillar_url} target="_blank" rel="noopener noreferrer" className="underline decoration-dotted hover:text-[var(--text-primary)]">
              {cluster.pillar_url}
            </a>
          </span>
          <ExternalLink className="h-3 w-3 shrink-0 text-[var(--text-faint)]" />
        </div>
      )}
      {showProposal && (
        <div className="rounded-md border border-[rgba(251,191,36,0.25)] bg-[rgba(251,191,36,0.05)] px-3 py-2 text-xs text-[var(--text-secondary)]">
          <div className="mb-1.5">
            Your site already has a page for this question:{" "}
            <a href={candidate!.url} target="_blank" rel="noopener noreferrer" className="underline decoration-dotted hover:text-[var(--text-primary)]">
              {candidate!.title ?? candidate!.url}
            </a>
          </div>
          <div className="flex gap-2">
            <Button
              size="sm"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  onClusterUpdated(await acceptClusterPillar(brandId, cluster.id));
                } finally {
                  setBusy(false);
                }
              }}
            >
              Use existing page
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  onClusterUpdated(await rejectClusterPillar(brandId, cluster.id));
                } finally {
                  setBusy(false);
                }
              }}
            >
              Write a new page instead
            </Button>
          </div>
        </div>
      )}
      <PieceCard brandId={brandId} clusterId={cluster.id} platform="owned_site" draft={draft} onUpdated={onDraftUpdated} />
      <div className="flex justify-end">
        <Button
          variant="ghost"
          size="sm"
          onClick={writeDeepVersion}
          disabled={deepGenerating}
          className="!px-2 text-[var(--text-secondary)]"
          title="Longer FAQ-rich page (1,800+ words) built for AI citation — takes a bit longer"
        >
          {deepGenerating ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : (
            <ScrollText className="h-3 w-3" />
          )}
          {deepGenerating ? "Writing deep version…" : "Write deep version"}
        </Button>
      </div>
    </div>
  );
}
