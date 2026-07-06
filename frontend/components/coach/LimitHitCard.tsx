"use client";
import Link from "next/link";
import type { CoachUsage } from "@/lib/coach-types";

export function LimitHitCard({ usage, tierKey }: { usage: CoachUsage; tierKey: string | null }) {
  const isPro = tierKey === "pro";
  const resets = new Date(usage.resets_at);
  const localResets = resets.toLocaleString(undefined, {
    hour: "numeric", minute: "2-digit", day: "numeric", month: "short",
  });

  return (
    <div className="rounded-[var(--radius-lg)] border border-[var(--border-subtle)] bg-[var(--bg-card)] p-4 text-center">
      <div className="text-sm font-semibold text-[var(--text-primary)]">
        You&apos;ve used all {usage.limit} messages today.
      </div>
      <div className="mt-1 text-xs text-[var(--text-muted)]">
        Resets at midnight UTC ({localResets} your time).
      </div>
      {!isPro ? (
        <Link
          href="/settings/billing"
          className="mt-3 inline-flex items-center rounded-[var(--radius-md)] bg-[var(--accent)] px-3.5 py-1.5 text-sm font-medium text-[var(--text-on-accent)] hover:bg-[var(--accent-hover)]"
        >
          Upgrade for more messages
        </Link>
      ) : (
        <div className="mt-3 text-xs text-[var(--text-muted)]">
          Need a higher cap? Email support and we&apos;ll raise it.
        </div>
      )}
    </div>
  );
}
