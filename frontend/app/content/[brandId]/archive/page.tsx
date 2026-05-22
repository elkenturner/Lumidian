"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft, Loader2 } from "lucide-react";
import { getDrafts, type ContentDraft } from "@/lib/api";

/**
 * Legacy archive — drafts that were posted before the content cluster
 * redesign and never had a cluster attached (cluster_id is null). Read-only.
 */
export default function ContentArchivePage() {
  const params = useParams<{ brandId: string }>();
  const router = useRouter();
  const brandId = Number(params?.brandId);

  const [drafts, setDrafts] = useState<ContentDraft[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!Number.isFinite(brandId)) return;
    let cancelled = false;
    getDrafts(brandId, undefined, "posted", 200)
      .then((rows) => {
        if (!cancelled) {
          // Only the orphans — clusters' own posted drafts live in the cluster.
          setDrafts(rows.filter((d) => d.cluster_id == null));
        }
      })
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [brandId]);

  if (loading) {
    return (
      <div className="px-4 sm:px-8 py-8 max-w-[1200px] flex items-center gap-2 text-[var(--text-secondary)]">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading archive…
      </div>
    );
  }

  return (
    <div className="px-4 sm:px-8 py-6 sm:py-8 max-w-[1200px] space-y-6">
      <button
        onClick={() => router.push(`/content/${brandId}`)}
        className="inline-flex items-center gap-1.5 text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to clusters
      </button>

      <header>
        <h1 className="text-xl font-bold text-[var(--text-primary)]">Legacy posted drafts</h1>
        <p className="mt-1.5 text-sm text-[var(--text-secondary)]">
          Drafts posted before the content cluster redesign. Read-only — they are not part of any cluster.
        </p>
      </header>

      {drafts.length === 0 ? (
        <div className="card border-dashed text-sm text-[var(--text-secondary)] text-center py-10">
          No legacy drafts.
        </div>
      ) : (
        <ul className="divide-y divide-[var(--border-subtle)]">
          {drafts.map((d) => (
            <li key={d.id} className="py-4">
              <div className="flex items-center gap-3 text-sm">
                <span className="uppercase text-[10px] text-[var(--text-faint)] font-semibold tracking-wide">
                  {d.platform}
                </span>
                <span className="font-medium text-[var(--text-primary)] truncate">
                  {d.title || "(untitled)"}
                </span>
                {d.posted_at && (
                  <span className="text-xs text-[var(--text-faint)] ml-auto shrink-0">
                    Posted {new Date(d.posted_at).toLocaleDateString()}
                  </span>
                )}
              </div>
              <div className="mt-1.5 text-xs text-[var(--text-secondary)] line-clamp-3 whitespace-pre-wrap">
                {d.content_text}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
