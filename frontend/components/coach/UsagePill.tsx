"use client";
import type { CoachUsage } from "@/lib/coach-types";

export function UsagePill({ usage }: { usage: CoachUsage | null }) {
  if (!usage) return null;
  const { used, limit } = usage;
  const pct = limit > 0 ? used / limit : 0;
  let cls = "text-slate-500 bg-slate-100";
  let label = `${used} of ${limit} today`;
  if (used >= limit) {
    cls = "text-red-700 bg-red-100";
    label = "Limit reached";
  } else if (pct >= 0.8) {
    cls = "text-amber-700 bg-amber-100";
  }
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${cls}`}>
      {label}
    </span>
  );
}
