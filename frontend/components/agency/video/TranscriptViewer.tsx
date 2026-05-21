'use client';

import { useState } from 'react';

interface Segment {
  start: number;
  end: number;
  text: string;
}

interface Props {
  segments: Segment[];
}

function formatTs(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export function TranscriptViewer({ segments }: Props) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="text-sm font-medium text-gray-700"
      >
        {open ? 'Hide' : 'Show'} full transcript ({segments.length} segments)
      </button>
      {open && (
        <ul className="mt-3 max-h-96 space-y-2 overflow-auto text-sm text-gray-800">
          {segments.map((s, i) => (
            <li key={i}>
              <span className="mr-2 font-mono text-xs text-gray-500">{formatTs(s.start)}</span>
              {s.text}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
