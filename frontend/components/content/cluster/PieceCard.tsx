"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { regenerateClusterPiece, type ContentDraft } from "@/lib/api";

interface Props {
  brandId: number;
  clusterId: number;
  platform: string;
  draft: ContentDraft | null;
  onUpdated: (draft: ContentDraft) => void;
}

export function PieceCard({ brandId, clusterId, platform, draft, onUpdated }: Props) {
  const [regenerating, setRegenerating] = useState(false);

  async function regenerate() {
    setRegenerating(true);
    try {
      const updated = await regenerateClusterPiece(brandId, clusterId, platform);
      onUpdated(updated);
    } finally {
      setRegenerating(false);
    }
  }

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4 min-h-[200px] flex flex-col">
      <div className="flex items-center justify-between mb-3">
        <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">{platform}</span>
        {draft && <span className="text-xs text-slate-500 capitalize">{draft.status}</span>}
      </div>
      {draft ? (
        <>
          {draft.title && <h4 className="font-semibold text-slate-900 mb-1 line-clamp-1">{draft.title}</h4>}
          <p className="text-sm text-slate-600 line-clamp-5 flex-1">{draft.content_text}</p>
        </>
      ) : (
        <p className="text-sm text-slate-400 italic flex-1">Not generated yet.</p>
      )}
      <div className="mt-3 pt-3 border-t border-slate-100 flex items-center justify-between">
        <button
          type="button"
          onClick={regenerate}
          disabled={regenerating}
          className="text-sm text-sky-700 hover:text-sky-900 disabled:opacity-50 flex items-center gap-1"
        >
          {regenerating && <Loader2 className="h-3 w-3 animate-spin" />}
          {regenerating ? "Regenerating…" : "Regenerate"}
        </button>
      </div>
    </div>
  );
}
