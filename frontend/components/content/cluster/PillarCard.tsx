"use client";

import { useState } from "react";
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
      <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm">
        <div className="font-semibold text-emerald-900 mb-1">Pillar attached</div>
        <a href={cluster.pillar_url} target="_blank" rel="noopener noreferrer" className="text-emerald-800 underline">
          {cluster.pillar_url}
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
    <div className="rounded-lg border border-amber-200 bg-amber-50 p-4">
      <div className="font-semibold text-amber-900">Pillar proposal</div>
      <p className="mt-1 text-sm text-amber-800">
        We found an own-site page that targets this prompt and passed the tone gate.
      </p>
      <div className="mt-3 text-sm">
        <div className="font-medium text-slate-900">{candidate.title ?? candidate.url}</div>
        <a
          href={candidate.url}
          target="_blank"
          rel="noopener noreferrer"
          className="text-sky-700 underline text-xs"
        >
          {candidate.url}
        </a>
        <div className="mt-2 text-xs text-slate-600">
          Tone score: <span className="font-mono">{candidate.tone_score.toFixed(2)}</span> · {candidate.tone_reasoning}
        </div>
      </div>
      <div className="mt-3 flex gap-2">
        <button
          type="button"
          onClick={accept}
          disabled={busy}
          className="px-3 py-1.5 rounded bg-emerald-700 text-white text-sm disabled:opacity-50"
        >
          Accept pillar
        </button>
        <button
          type="button"
          onClick={reject}
          disabled={busy}
          className="px-3 py-1.5 rounded border text-sm disabled:opacity-50"
        >
          Reject
        </button>
      </div>
    </div>
  );
}
