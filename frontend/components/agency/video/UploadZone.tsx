"use client";

import { useRef, useState } from "react";
import { agencyUploadVideo } from "@/lib/api";

interface Props {
  clientId: number;
  onUploaded: (jobId: number) => void;
}

const ACCEPTED = "video/mp4,video/quicktime,video/webm";

export function UploadZone({ clientId, onUploaded }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [pct, setPct] = useState(0);
  const [error, setError] = useState<string | null>(null);

  async function handleFile(file: File) {
    setError(null);
    if (!["video/mp4", "video/quicktime", "video/webm"].includes(file.type)) {
      setError("Unsupported file type. Use .mp4, .mov, or .webm.");
      return;
    }
    setUploading(true);
    setPct(0);
    try {
      const { job_id } = await agencyUploadVideo(clientId, file, setPct);
      onUploaded(job_id);
    } catch (e) {
      const msg =
        (e as { response?: { status?: number } })?.response?.status === 413
          ? "File exceeds 500 MB limit."
          : "Upload failed. Please retry.";
      setError(msg);
    } finally {
      setUploading(false);
    }
  }

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragOver(false);
        const f = e.dataTransfer.files?.[0];
        if (f) handleFile(f);
      }}
      className={`rounded-lg border-2 border-dashed p-8 text-center transition ${
        dragOver ? "border-blue-500 bg-blue-50" : "border-gray-300 bg-gray-50"
      }`}
    >
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPTED}
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) handleFile(f);
        }}
      />
      {uploading ? (
        <div>
          <div className="mb-2 text-sm text-gray-600">Uploading… {pct}%</div>
          <div className="h-2 w-full rounded bg-gray-200">
            <div
              className="h-2 rounded bg-blue-500 transition-all"
              style={{ width: `${pct}%` }}
            />
          </div>
        </div>
      ) : (
        <>
          <p className="mb-3 text-sm text-gray-700">
            Drag a finished video here, or
          </p>
          <button
            type="button"
            className="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
            onClick={() => inputRef.current?.click()}
          >
            Choose file
          </button>
          <p className="mt-3 text-xs text-gray-500">
            .mp4, .mov, .webm · up to 500 MB
          </p>
          {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
        </>
      )}
    </div>
  );
}
