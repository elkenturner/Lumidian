'use client';

import { VideoMetadataJobOut } from '@/lib/api';
import { ArtifactCard } from './ArtifactCard';
import { TranscriptViewer } from './TranscriptViewer';
import { CaptionDownloadButton } from './CaptionDownloadButton';
import { RegenerateMetadataButton } from './RegenerateMetadataButton';

interface Props {
  clientId: number;
  job: VideoMetadataJobOut;
  onRegenerated: () => void;
}

function chaptersToText(chapters: { ts_seconds: number; label: string }[]): string {
  return chapters
    .map((c) => {
      const h = Math.floor(c.ts_seconds / 3600);
      const m = Math.floor((c.ts_seconds % 3600) / 60);
      const s = c.ts_seconds % 60;
      const ts =
        h > 0
          ? `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
          : `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
      return `${ts} ${c.label}`;
    })
    .join('\n');
}

export function ResultPanel({ clientId, job, onRegenerated }: Props) {
  if (job.status === 'failed') {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">
        <strong>Failed.</strong> {job.error_message || 'Unknown error.'}
      </div>
    );
  }
  if (job.status !== 'completed') {
    return (
      <div className="rounded-lg border border-blue-200 bg-blue-50 p-4 text-sm text-blue-800">
        Status: {job.status}. This page will refresh automatically.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {job.metadata_failed && (
        <div className="rounded border border-yellow-300 bg-yellow-50 p-3 text-sm text-yellow-800">
          Transcript saved, but the Claude metadata pass failed: {job.error_message}. Use the
          regenerate button below to retry without re-transcribing.
        </div>
      )}

      {job.ai_title && <ArtifactCard title="Title" value={job.ai_title} />}
      {job.ai_description && (
        <ArtifactCard title="Description" value={job.ai_description} multiline />
      )}
      {job.ai_chapters && job.ai_chapters.length > 0 && (
        <ArtifactCard title="Chapters" value={chaptersToText(job.ai_chapters)} multiline />
      )}
      {job.ai_tags && job.ai_tags.length > 0 && (
        <ArtifactCard title="Tags" value={job.ai_tags.join(', ')} />
      )}
      {job.ai_jsonld && (
        <ArtifactCard
          title="JSON-LD (VideoObject)"
          value={JSON.stringify(job.ai_jsonld, null, 2)}
          multiline
        />
      )}

      {job.transcript_segments && <TranscriptViewer segments={job.transcript_segments} />}

      <div className="flex flex-wrap items-center gap-2">
        {job.srt_content && (
          <CaptionDownloadButton
            filename={`${job.filename}.srt`}
            content={job.srt_content}
            label=".srt"
          />
        )}
        {job.vtt_content && (
          <CaptionDownloadButton
            filename={`${job.filename}.vtt`}
            content={job.vtt_content}
            label=".vtt"
          />
        )}
        <RegenerateMetadataButton clientId={clientId} jobId={job.id} onComplete={onRegenerated} />
      </div>
    </div>
  );
}
