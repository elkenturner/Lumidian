"use client";

import { useEffect, useState } from "react";
import { getClusterSources, type ClusterSourcesPayload } from "@/lib/api";

interface Props {
  brandId: number;
  clusterId: number;
}

const TIER_LABELS: Record<string, string> = {
  T1: "Major press & research",
  T2: "Industry press",
  T3: "Other web",
  brand: "Your site & profile",
};
const TIER_COLORS: Record<string, string> = {
  T1: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
  T2: "bg-sky-500/15 text-sky-300 border-sky-500/30",
  T3: "bg-slate-500/15 text-slate-300 border-slate-500/30",
  brand: "bg-amber-500/15 text-amber-300 border-amber-500/30",
};

export function SourceSpinePanel({ brandId, clusterId }: Props) {
  const [data, setData] = useState<ClusterSourcesPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    let mounted = true;
    setLoading(true);
    setError(false);
    getClusterSources(brandId, clusterId)
      .then((d) => mounted && setData(d))
      .catch(() => mounted && setError(true))
      .finally(() => mounted && setLoading(false));
    return () => {
      mounted = false;
    };
  }, [brandId, clusterId]);

  if (loading) return <div className="text-sm text-slate-400">Loading sources…</div>;
  if (error) {
    return (
      <div className="text-sm text-[#fb7185]">
        Couldn&apos;t load sources. Reload the page to try again.
      </div>
    );
  }
  if (!data || data.sources.length === 0) {
    return (
      <div className="text-sm text-slate-400">
        No sources yet. Generate posts for this question to gather them.
      </div>
    );
  }

  const totalBrand = data.sources.filter((s) => s.tier === "brand").length;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-3 text-xs text-slate-300">
        <TierCount label={TIER_LABELS.T1} count={data.total_t1} activeColor="text-emerald-300" />
        <TierCount label={TIER_LABELS.T2} count={data.total_t2} activeColor="text-sky-300" />
        <TierCount label={TIER_LABELS.T3} count={data.total_t3} activeColor="text-slate-400" />
        {totalBrand > 0 && (
          <TierCount label={TIER_LABELS.brand} count={totalBrand} activeColor="text-amber-300" />
        )}
      </div>
      <p className="text-xs text-[var(--text-faint)]">
        Facts in these posts are grounded in these sources. Stronger sources keep claims accurate and quotable.
      </p>
      <ul className="divide-y divide-slate-800">
        {data.sources.map((s) => (
          <li key={s.url} className="py-2 flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span
                  className={`px-1.5 py-0.5 rounded border text-[10px] ${TIER_COLORS[s.tier] ?? TIER_COLORS.T3}`}
                >
                  {TIER_LABELS[s.tier] ?? s.tier}
                </span>
                <span className="text-sm text-slate-200 font-medium">{s.domain}</span>
              </div>
              <a
                href={s.url}
                target="_blank"
                rel="noreferrer"
                className="block text-xs text-slate-400 hover:text-slate-200 truncate"
              >
                {s.title || s.url}
              </a>
            </div>
            {s.times_cited > 0 && (
              <span className="shrink-0 text-xs text-[var(--text-muted)]">
                Cited in {s.times_cited} post{s.times_cited === 1 ? "" : "s"}
              </span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

function TierCount({
  label,
  count,
  activeColor,
}: {
  label: string;
  count: number;
  activeColor: string;
}) {
  const dim = count === 0;
  return (
    <span className={dim ? "opacity-40" : ""}>
      <span className={`font-semibold ${dim ? "text-slate-500" : activeColor}`}>{label}</span>{" "}
      {count}
    </span>
  );
}
