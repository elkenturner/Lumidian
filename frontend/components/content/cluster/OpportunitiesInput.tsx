"use client";

import { ExternalLink } from "lucide-react";
import type { ContentOpportunity } from "@/lib/api";

/**
 * Read-only list of opportunities tied to a cluster's prompt, shown inside the
 * cluster InputsZone. Drafting/dismissing happens on the /content tab — this is
 * context only.
 */
export function OpportunitiesInput({ items }: { items: ContentOpportunity[] }) {
  return (
    <ul className="space-y-2">
      {items.map((o) => (
        <li key={o.id} className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-xs text-[var(--text-faint)] uppercase tracking-wide">
              <span>{o.platform}</span>
              {o.subreddit && <span>· r/{o.subreddit}</span>}
              <span>· {Math.round(o.relevance_score * 100)}% match</span>
            </div>
            <a
              href={o.thread_url}
              target="_blank"
              rel="noreferrer"
              className="block text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)] truncate"
            >
              {o.thread_title || o.thread_url}
            </a>
          </div>
          <a href={o.thread_url} target="_blank" rel="noreferrer" className="shrink-0 pt-0.5">
            <ExternalLink className="h-3.5 w-3.5 text-[var(--text-faint)] hover:text-[var(--text-secondary)]" />
          </a>
        </li>
      ))}
    </ul>
  );
}
