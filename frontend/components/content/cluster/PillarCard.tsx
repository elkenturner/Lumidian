"use client";

import { useState } from "react";
import { Check, ExternalLink, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  acceptClusterPillar,
  rejectClusterPillar,
  type ContentClusterDetail,
  type PillarCandidate,
} from "@/lib/api";

interface Props {
  brandId: number;
  cluster: ContentClusterDetail;
  candidate: PillarCandidate | null;
  onClusterUpdated: (c: ContentClusterDetail) => void;
}

export function PillarCard({ brandId, cluster, candidate, onClusterUpdated }: Props) {
  const [busy, setBusy] = useState(false);

  if (cluster.pillar_mode === "attached" && cluster.pillar_url) {
    return (
      <div className="card !p-4 bg-[rgba(34,197,94,0.06)] border-[rgba(34,197,94,0.25)]">
        <div className="flex items-center gap-2 mb-1.5">
          <Check className="h-4 w-4 text-[#4ade80]" />
          <div className="font-semibold text-[#4ade80] text-sm">Pillar attached</div>
        </div>
        <a
          href={cluster.pillar_url}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)] underline decoration-dotted"
        >
          {cluster.pillar_url}
          <ExternalLink className="h-3 w-3" />
        </a>
      </div>
    );
  }

  if (cluster.pillar_mode !== "proposed" || !candidate) return null;

  async function accept() {
    setBusy(true);
    try {
      const c = await acceptClusterPillar(brandId, cluster.id);
      onClusterUpdated(c);
    } finally {
      setBusy(false);
    }
  }

  async function reject() {
    setBusy(true);
    try {
      const c = await rejectClusterPillar(brandId, cluster.id);
      onClusterUpdated(c);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card !p-4 bg-[rgba(251,191,36,0.05)] border-[rgba(251,191,36,0.25)]">
      <div className="flex items-center gap-2 mb-1">
        <Sparkles className="h-4 w-4 text-[#fbbf24]" />
        <div className="font-semibold text-[#fbbf24] text-sm">Pillar proposal</div>
      </div>
      <p className="text-sm text-[var(--text-secondary)] mb-3">
        We found an own-site page that targets this prompt and passed the tone gate.
      </p>
      <div className="text-sm space-y-1.5 mb-3">
        <div className="font-medium text-[var(--text-primary)]">
          {candidate.title ?? candidate.url}
        </div>
        <a
          href={candidate.url}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-xs text-[var(--accent-foreground)] hover:text-[var(--text-primary)] underline decoration-dotted"
        >
          {candidate.url}
          <ExternalLink className="h-3 w-3" />
        </a>
        <div className="text-xs text-[var(--text-muted)]">
          Tone score:{" "}
          <span className="font-mono text-[var(--text-secondary)]">
            {candidate.tone_score.toFixed(2)}
          </span>{" "}
          · {candidate.tone_reasoning}
        </div>
      </div>
      <div className="flex gap-2">
        <Button
          size="sm"
          onClick={accept}
          disabled={busy}
        >
          Accept pillar
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={reject}
          disabled={busy}
        >
          Reject
        </Button>
      </div>
    </div>
  );
}
