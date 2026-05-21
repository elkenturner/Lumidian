'use client';

import { useState } from 'react';

interface Props {
  title: string;
  value: string;
  multiline?: boolean;
}

export function ArtifactCard({ title, value, multiline }: Props) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    await navigator.clipboard.writeText(value);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-sm font-medium text-gray-700">{title}</h3>
        <button
          type="button"
          onClick={copy}
          className="rounded bg-gray-100 px-2 py-1 text-xs text-gray-700 hover:bg-gray-200"
        >
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      {multiline ? (
        <pre className="max-h-64 overflow-auto whitespace-pre-wrap rounded bg-gray-50 p-3 text-sm text-gray-800">
          {value}
        </pre>
      ) : (
        <p className="text-sm text-gray-800">{value}</p>
      )}
    </div>
  );
}
