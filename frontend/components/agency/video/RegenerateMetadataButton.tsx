"use client";

import { useState } from "react";
import { agencyRegenerateVideoMetadata } from "@/lib/api";

interface Props {
  clientId: number;
  jobId: number;
  onComplete: () => void;
}

export function RegenerateMetadataButton({ clientId, jobId, onComplete }: Props) {
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    if (!confirm("Re-run Claude metadata pass against the cached transcript?")) return;
    setRunning(true);
    setError(null);
    try {
      await agencyRegenerateVideoMetadata(clientId, jobId);
      onComplete();
    } catch {
      setError("Regeneration failed. Try again.");
    } finally {
      setRunning(false);
    }
  }

  return (
    <div>
      <button
        type="button"
        onClick={run}
        disabled={running}
        className="rounded bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
      >
        {running ? "Regenerating…" : "Regenerate metadata"}
      </button>
      {error && <p className="mt-1 text-sm text-red-600">{error}</p>}
    </div>
  );
}
