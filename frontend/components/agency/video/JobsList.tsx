"use client";

import { VideoMetadataJobOut } from "@/lib/api";

const STATUS_COLORS: Record<string, string> = {
  uploaded: "bg-gray-100 text-gray-700",
  transcribing: "bg-blue-100 text-blue-700",
  generating: "bg-indigo-100 text-indigo-700",
  completed: "bg-green-100 text-green-700",
  failed: "bg-red-100 text-red-700",
};

interface Props {
  jobs: VideoMetadataJobOut[];
  selectedId: number | null;
  onSelect: (jobId: number) => void;
}

export function JobsList({ jobs, selectedId, onSelect }: Props) {
  if (jobs.length === 0) {
    return <p className="text-sm text-gray-500">No videos yet. Upload one above to get started.</p>;
  }
  return (
    <ul className="divide-y divide-gray-200 rounded border border-gray-200">
      {jobs.map((j) => (
        <li key={j.id}>
          <button
            type="button"
            onClick={() => onSelect(j.id)}
            className={`flex w-full items-center justify-between px-4 py-3 text-left hover:bg-gray-50 ${
              selectedId === j.id ? "bg-blue-50" : ""
            }`}
          >
            <div>
              <div className="font-medium text-gray-900">{j.filename}</div>
              <div className="text-xs text-gray-500">
                {new Date(j.created_at).toLocaleString()}
                {j.duration_seconds ? ` · ${Math.round(j.duration_seconds)}s` : ""}
              </div>
            </div>
            <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_COLORS[j.status] || ""}`}>
              {j.status}
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}
