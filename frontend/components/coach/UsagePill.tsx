"use client";
import type { CoachUsage } from "@/lib/coach-types";

/** Quiet until it matters: hidden below 60% of the daily cap, amber at 80%,
 * red at the limit. */
export function UsagePill({ usage }: { usage: CoachUsage | null }) {
  if (!usage) return null;
  const { used, limit } = usage;
  const pct = limit > 0 ? used / limit : 0;
  if (pct < 0.6) return null;

  let cls = "bg-[var(--bg-tinted)] text-[var(--text-muted)]";
  let label = `${used} of ${limit} today`;
  if (used >= limit) {
    cls = "bg-[rgba(239,68,68,0.12)] text-[var(--danger-text)]";
    label = "Limit reached";
  } else if (pct >= 0.8) {
    cls = "bg-[rgba(245,158,11,0.12)] text-[var(--warning-text)]";
  }
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium tabular-nums ${cls}`}>
      {label}
    </span>
  );
}
