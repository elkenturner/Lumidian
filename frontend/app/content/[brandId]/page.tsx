"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { Loader2 } from "lucide-react";
import { listClusters, regenerateClusterByPrompt, type ContentClusterSummary } from "@/lib/api";
import { ClusterCard } from "@/components/content/cluster/ClusterCard";
import { WikipediaTab } from "@/components/content/wikipedia/WikipediaTab";

type Tab = "clusters" | "opportunities" | "wikipedia" | "gaps";

const TABS: Tab[] = ["clusters", "opportunities", "wikipedia", "gaps"];

export default function ContentBrandPage() {
  const params = useParams<{ brandId: string }>();
  const brandId = Number(params.brandId);
  const [tab, setTab] = useState<Tab>("clusters");
  const [clusterList, setClusterList] = useState<ContentClusterSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [regeneratingId, setRegeneratingId] = useState<number | null>(null);

  useEffect(() => {
    if (!brandId) return;
    try {
      localStorage.setItem("clarity_active_brand_id", String(brandId));
    } catch {}
  }, [brandId]);

  useEffect(() => {
    let cancelled = false;
    if (tab !== "clusters") return;
    async function load() {
      const data = await listClusters(brandId);
      if (!cancelled) {
        setClusterList(data);
        setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [brandId, tab]);

  async function handleRegenerate(clusterId: number) {
    const cluster = clusterList.find((c) => c.id === clusterId);
    if (!cluster) return;
    setRegeneratingId(clusterId);
    try {
      await regenerateClusterByPrompt(brandId, cluster.prompt_id);
      const refreshed = await listClusters(brandId);
      setClusterList(refreshed);
    } finally {
      setRegeneratingId(null);
    }
  }

  return (
    <div className="max-w-6xl mx-auto p-6">
      <div className="border-b border-slate-200 mb-6">
        <nav className="flex gap-2">
          {TABS.map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px capitalize ${
                tab === t
                  ? "border-slate-900 text-slate-900"
                  : "border-transparent text-slate-500 hover:text-slate-700"
              }`}
            >
              {t}
            </button>
          ))}
        </nav>
      </div>

      {tab === "clusters" && (
        <ClustersTab
          loading={loading}
          clusters={clusterList}
          brandId={brandId}
          regeneratingId={regeneratingId}
          onRegenerate={handleRegenerate}
        />
      )}
      {tab === "opportunities" && <ExistingHubLink section="Opportunities" />}
      {tab === "wikipedia" && <WikipediaTab brandId={brandId} />}
      {tab === "gaps" && <ExistingHubLink section="Gaps" />}
    </div>
  );
}

function ClustersTab({
  loading,
  clusters: list,
  brandId,
  regeneratingId,
  onRegenerate,
}: {
  loading: boolean;
  clusters: ContentClusterSummary[];
  brandId: number;
  regeneratingId: number | null;
  onRegenerate: (id: number) => void;
}) {
  if (loading) {
    return (
      <div className="flex items-center gap-2 text-slate-500">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading clusters…
      </div>
    );
  }
  if (list.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 p-8 text-center">
        <p className="text-slate-700">No clusters yet for this brand.</p>
        <p className="mt-1 text-sm text-slate-500">
          Each tracked prompt becomes a cluster. Add prompts in the brand settings, then come back and
          regenerate.
        </p>
      </div>
    );
  }
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      {list.map((c) => (
        <ClusterCard
          key={c.id}
          cluster={c}
          brandId={brandId}
          onRegenerate={onRegenerate}
          regenerating={regeneratingId === c.id}
        />
      ))}
    </div>
  );
}

function ExistingHubLink({ section }: { section: string }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-6 text-sm">
      <p className="text-slate-700 mb-3">
        {section} live in the main Content Hub for this brand. Cluster integration with {section.toLowerCase()}{" "}
        is planned for a future iteration.
      </p>
      <Link href="/content" className="text-sky-700 hover:text-sky-900 font-medium">
        Open Content Hub →
      </Link>
    </div>
  );
}
