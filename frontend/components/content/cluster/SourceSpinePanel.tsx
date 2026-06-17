"use client";

import { useEffect, useState } from "react";
import { getClusterSources, type ClusterSourceItem, type ClusterSourcesPayload } from "@/lib/api";

interface Props {
  brandId: number;
  clusterId: number;
}

const TIER_COLORS: Record<ClusterSourceItem["tier"], string> = {
  T1: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
  T2: "bg-sky-500/15 text-sky-300 border-sky-500/30",
  T3: "bg-slate-500/15 text-slate-300 border-slate-500/30",
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
        No sources yet. Regenerate to build the cluster evidence pack.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex gap-3 text-xs text-slate-300">
        <TierCount label="T1" count={data.total_t1} activeColor="text-emerald-300" />
        <TierCount label="T2" count={data.total_t2} activeColor="text-sky-300" />
        <TierCount label="T3" count={data.total_t3} activeColor="text-slate-400" />
      </div>
      <ul className="divide-y divide-slate-800">
        {data.sources.map((s) => (
          <li key={s.url} className="py-2 flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span
                  className={`text-[10px] uppercase px-1.5 py-0.5 rounded border ${TIER_COLORS[s.tier]}`}
                >
                  {s.tier}
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
