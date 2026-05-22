import { useEffect, useRef, useState } from "react";
import { getClusterStatus, type ClusterStatusPayload } from "@/lib/api";

const TERMINAL = new Set([
  "ready", "briefing_failed", "generation_partial",
]);
const POLL_MS = 2000;

export type { ClusterStatusPayload };

export function useClusterStatus(
  brandId: number,
  clusterId: number,
  initial?: ClusterStatusPayload,
) {
  const [data, setData] = useState<ClusterStatusPayload | undefined>(initial);
  const [error, setError] = useState<Error | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function tick() {
      try {
        const next = await getClusterStatus(brandId, clusterId);
        if (cancelled) return;
        setData(next);
        if (!TERMINAL.has(next.status)) {
          timer.current = setTimeout(tick, POLL_MS);
        }
      } catch (e) {
        if (!cancelled) setError(e as Error);
      }
    }

    if (!data || !TERMINAL.has(data.status)) {
      tick();
    }

    return () => {
      cancelled = true;
      if (timer.current) clearTimeout(timer.current);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [brandId, clusterId]);

  return { data, error };
}
