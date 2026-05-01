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
    <div className="rounded-lg border border-slate-200 bg-white p-4 text-center">
      <div className="text-base font-semibold text-slate-900">
        You&apos;ve used all {usage.limit} messages today.
      </div>
      <div className="mt-1 text-sm text-slate-500">
        Resets at midnight UTC ({localResets} your time).
      </div>
      {!isPro ? (
        <Link
          href="/settings/billing"
          className="mt-3 inline-flex items-center rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-800"
        >
          Upgrade for more messages
        </Link>
      ) : (
        <div className="mt-3 text-sm text-slate-500">
          This cap exists to prevent runaway clients. Email support if you need it raised.
        </div>
      )}
    </div>
  );
}
