"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft, Loader2 } from "lucide-react";
import { getDrafts, type ContentDraft } from "@/lib/api";
import { PLATFORM_DISPLAY } from "@/components/content/helpers";
import { parseUTCISO } from "@/lib/utils/formatting";

const STATUS_PILL: Record<string, string> = {
  posted: "border-sky-500/30 bg-sky-500/10 text-sky-200",
  approved: "border-amber-500/30 bg-amber-500/10 text-amber-200",
  draft: "border-[var(--border-subtle)] bg-[var(--bg-card)] text-[var(--text-secondary)]",
  failed: "border-rose-500/30 bg-rose-500/10 text-rose-200",
};

/**
 * Earlier drafts — content not attached to any cluster (cluster_id is null):
 * onboarding drafts and anything created before the cluster redesign. Read-only.
 * Includes draft/approved/posted so generated content is never silently lost.
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
    // No status filter: surface draft/approved/posted orphans alike. Clusters'
    // own drafts (cluster_id set) live in the cluster and are excluded here.
    getDrafts(brandId, undefined, undefined, 200)
      .then((rows) => {
        if (!cancelled) {
          const orphans = rows.filter((d) => d.cluster_id == null);
          orphans.sort((a, b) => {
            // Posted first (most recently posted), then the rest by id desc.
            const ap = a.posted_at ?? "";
            const bp = b.posted_at ?? "";
            if (ap && bp) return bp.localeCompare(ap);
            if (ap) return -1;
            if (bp) return 1;
            return b.id - a.id;
          });
          setDrafts(orphans);
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
        Back to content
      </button>

      <header>
        <h1 className="text-xl font-bold text-[var(--text-primary)]">Earlier drafts</h1>
        <p className="mt-1.5 text-sm text-[var(--text-secondary)]">
          Drafts from onboarding or older versions of the app. Read-only — they aren&apos;t
          attached to a tracked question.
        </p>
      </header>

      {drafts.length === 0 ? (
        <div className="card border-dashed text-sm text-[var(--text-secondary)] text-center py-10">
          No earlier drafts.
        </div>
      ) : (
        <ul className="divide-y divide-[var(--border-subtle)]">
          {drafts.map((d) => (
            <li key={d.id} className="py-4">
              <div className="flex items-center gap-3 text-sm">
                <span className="uppercase text-[10px] text-[var(--text-faint)] font-semibold tracking-wide">
                  {PLATFORM_DISPLAY[d.platform] ?? d.platform.replace(/_/g, " ")}
                </span>
                <span
                  className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-medium capitalize ${STATUS_PILL[d.status] ?? STATUS_PILL.draft}`}
                >
                  {d.status}
                </span>
                <span className="font-medium text-[var(--text-primary)] truncate">
                  {d.title || "(untitled)"}
                </span>
                {d.posted_at && (
                  <span className="text-xs text-[var(--text-faint)] ml-auto shrink-0">
                    Posted {parseUTCISO(d.posted_at).toLocaleDateString()}
                  </span>
                )}
              </div>
              <ExpandableText text={d.content_text} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Click-to-expand body text — an archived draft's full text was previously
 *  unreadable (line-clamped with no affordance on a read-only page). */
function ExpandableText({ text }: { text: string }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <button
      type="button"
      onClick={() => setExpanded((e) => !e)}
      title={expanded ? "Collapse" : "Read the full draft"}
      className={`mt-1.5 block w-full text-left text-xs text-[var(--text-secondary)] whitespace-pre-wrap cursor-pointer ${expanded ? "" : "line-clamp-3"}`}
    >
      {text}
    </button>
  );
}
