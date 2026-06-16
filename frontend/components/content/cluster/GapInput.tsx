"use client";

import type { ContentGap } from "@/lib/api";

/**
 * Compact, read-only gap summary for a cluster's prompt, shown in the InputsZone.
 * Surfaces the gap score, current visibility, where the brand is missing, and
 * who is winning — the "why this cluster matters" context.
 */
export function GapInput({ items }: { items: ContentGap[] }) {
  return (
    <div className="space-y-3">
      {items.map((g) => {
        const topCompetitors = Object.entries(g.competitor_mentions ?? {})
          .sort((a, b) => b[1] - a[1])
          .slice(0, 3);
        return (
          <div key={g.id} className="space-y-1.5">
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
              <span>
                <span className="text-[var(--text-faint)]">Gap score</span>{" "}
                <span className="text-[var(--text-primary)] font-medium">
                  {g.gap_score.toFixed(1)}
                </span>
              </span>
              {g.prompt_visibility !== null && (
                <span>
                  <span className="text-[var(--text-faint)]">Visibility</span>{" "}
                  <span className="text-[var(--text-primary)] font-medium">
                    {Math.round(g.prompt_visibility)}%
                  </span>
                </span>
              )}
            </div>
            {g.platforms_lacking.length > 0 && (
              <div className="text-xs">
                <span className="text-[var(--text-faint)]">Missing on:</span>{" "}
                <span className="text-[var(--text-secondary)]">
                  {g.platforms_lacking.join(", ")}
                </span>
              </div>
            )}
            {topCompetitors.length > 0 && (
              <div className="text-xs">
                <span className="text-[var(--text-faint)]">Winning here:</span>{" "}
                <span className="text-[var(--text-secondary)]">
                  {topCompetitors.map(([name, n]) => `${name} (${n})`).join(", ")}
                </span>
              </div>
            )}
            {g.quora_questions.length > 0 && (
              <div className="text-xs text-[var(--text-faint)]">
                {g.quora_questions.length} related Quora question
                {g.quora_questions.length === 1 ? "" : "s"}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
