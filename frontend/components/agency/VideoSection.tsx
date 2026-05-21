'use client';

import { useEffect, useState } from 'react';
import { agencyGetVideoJobs, type VideoMetadataJobOut } from '@/lib/api';
import { JobsList } from './video/JobsList';
import { ResultPanel } from './video/ResultPanel';
import { UploadZone } from './video/UploadZone';

interface Props {
  clientId: number;
}

export function VideoSection({ clientId }: Props) {
  const [jobs, setJobs] = useState<VideoMetadataJobOut[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const selected = jobs.find((j) => j.id === selectedId) || null;

  async function refresh() {
    const data = await agencyGetVideoJobs(clientId);
    setJobs(data);
    if (selectedId === null && data.length > 0) setSelectedId(data[0].id);
  }

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { refresh(); }, [clientId]);

  // Poll every 2s while any active job exists.
  useEffect(() => {
    const active = jobs.some((j) =>
      ['uploaded', 'transcribing', 'generating'].includes(j.status),
    );
    if (!active) return;
    const t = setInterval(refresh, 2000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobs.map((j) => `${j.id}:${j.status}`).join(',')]);

  return (
    <div className="space-y-4">
      <p className="text-xs text-[var(--text-muted)]">
        Upload a finished video. Lumidian transcribes it and generates a paste-ready YouTube package
        optimized for AI retrieval — title, description, chapters, tags, JSON-LD, plus .srt/.vtt captions.
      </p>

      <UploadZone
        clientId={clientId}
        onUploaded={(jobId) => {
          setSelectedId(jobId);
          refresh();
        }}
      />

      <div className="grid gap-4 md:grid-cols-[280px_1fr]">
        <JobsList jobs={jobs} selectedId={selectedId} onSelect={setSelectedId} />
        <div>
          {selected ? (
            <ResultPanel clientId={clientId} job={selected} onRegenerated={refresh} />
          ) : (
            <p className="text-sm text-[var(--text-muted)]">Select a job to see its artifacts.</p>
          )}
        </div>
      </div>
    </div>
  );
}
