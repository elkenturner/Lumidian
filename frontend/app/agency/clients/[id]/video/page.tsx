"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { agencyGetVideoJobs, VideoMetadataJobOut } from "@/lib/api";
import { UploadZone } from "@/components/agency/video/UploadZone";
import { JobsList } from "@/components/agency/video/JobsList";
import { ResultPanel } from "@/components/agency/video/ResultPanel";

export default function VideoTabPage() {
  const params = useParams<{ id: string }>();
  const clientId = Number(params.id);
  const [jobs, setJobs] = useState<VideoMetadataJobOut[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const selected = jobs.find((j) => j.id === selectedId) || null;

  async function refresh() {
    const data = await agencyGetVideoJobs(clientId);
    setJobs(data);
    if (selectedId === null && data.length > 0) setSelectedId(data[0].id);
  }

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId]);

  // Poll every 2s while any active job exists or the selected job is in-flight.
  useEffect(() => {
    const active = jobs.some((j) => ["uploaded", "transcribing", "generating"].includes(j.status));
    if (!active) return;
    const t = setInterval(refresh, 2000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobs.map((j) => `${j.id}:${j.status}`).join(",")]);

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold text-gray-900">Video</h1>
      <p className="text-sm text-gray-600">
        Upload a finished video. Lumidian transcribes it and generates a paste-ready YouTube package
        optimized for AI retrieval — title, description, chapters, tags, JSON-LD, plus .srt/.vtt captions.
      </p>

      <UploadZone clientId={clientId} onUploaded={(jobId) => { setSelectedId(jobId); refresh(); }} />

      <div className="grid gap-6 md:grid-cols-[280px_1fr]">
        <JobsList jobs={jobs} selectedId={selectedId} onSelect={setSelectedId} />
        <div>
          {selected ? (
            <ResultPanel clientId={clientId} job={selected} onRegenerated={refresh} />
          ) : (
            <p className="text-sm text-gray-500">Select a job to see its artifacts.</p>
          )}
        </div>
      </div>
    </div>
  );
}
