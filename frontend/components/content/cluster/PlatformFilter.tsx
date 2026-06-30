"use client";

import { CLUSTER_PLATFORMS, CLUSTER_PLATFORM_LABELS } from "@/lib/clusterPlatforms";

interface Props {
  hidden: Set<string>;
  onToggle: (platform: string) => void;
}

/**
 * View-only platform switcher. A platform toggled off is hidden from cluster
 * views; it does NOT stop generation. State lives in useHiddenPlatforms.
 */
export function PlatformFilter({ hidden, onToggle }: Props) {
  return (
    <div className="flex items-center gap-1.5 text-[var(--text-faint)]">
      <span title="Show or hide platforms across all questions. Does not affect what gets generated.">
        View:
      </span>
      {CLUSTER_PLATFORMS.map((platform) => {
        const on = !hidden.has(platform);
        return (
          <button
            key={platform}
            type="button"
            aria-pressed={on}
            onClick={() => onToggle(platform)}
            className={`px-2 py-1 rounded ${
              on
                ? "bg-[var(--bg-card)] text-[var(--text-primary)] font-medium"
                : "text-[var(--text-faint)] line-through hover:text-[var(--text-secondary)]"
            }`}
          >
            {CLUSTER_PLATFORM_LABELS[platform]}
          </button>
        );
      })}
      <span className="ml-1 text-[10px] text-[var(--text-faint)]/70 italic">(view only)</span>
    </div>
  );
}
