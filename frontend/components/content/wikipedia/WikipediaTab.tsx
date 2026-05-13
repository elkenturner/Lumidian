"use client";

import { AlertCircle } from "lucide-react";

export function WikipediaTab({ brandId: _brandId }: { brandId: number }) {
  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-amber-200 bg-amber-50 p-5">
        <div className="flex items-start gap-3">
          <AlertCircle className="h-5 w-5 text-amber-700 mt-0.5" />
          <div>
            <h3 className="font-semibold text-amber-900">Wikipedia requires different handling</h3>
            <p className="mt-1 text-sm text-amber-800">
              Wikipedia content requires neutral, citation-backed, non-promotional tone — not the same approach
              as marketing drafts. We&apos;ve carved Wikipedia out of the cluster generator. A proper Wikipedia
              workflow is coming.
            </p>
          </div>
        </div>
      </div>
      <div className="rounded-lg border border-slate-200 bg-white p-5">
        <h4 className="font-semibold text-slate-900 mb-2">Topics for future Wikipedia coverage</h4>
        <p className="text-sm text-slate-500">
          We&apos;ll surface candidate Wikipedia topics from your brand profile and tracked prompts here once
          the workflow ships.
        </p>
      </div>
    </div>
  );
}
