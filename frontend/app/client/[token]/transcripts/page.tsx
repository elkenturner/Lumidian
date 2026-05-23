'use client';
import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { clientPortalListResponses } from '@/lib/api';

export default function TranscriptsPage() {
  const params = useParams<{ token: string }>();
  const token = params.token;
  const [rows, setRows] = useState<any[]>([]);

  useEffect(() => {
    if (!token) return;
    clientPortalListResponses(token).then(setRows);
  }, [token]);

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <h1 className="text-2xl font-semibold text-neutral-900">Transcripts</h1>
      <p className="text-sm text-neutral-500">Raw responses from the latest tracking run.</p>
      <ul className="space-y-3">
        {rows.map((r) => (
          <li key={r.id} className="rounded-md border border-neutral-200 bg-white p-4">
            <div className="mb-1 text-xs font-medium uppercase tracking-wide text-neutral-500">
              {r.model} · {r.prompt_text}
            </div>
            <div className={`text-sm ${r.mentioned ? 'text-neutral-900' : 'text-neutral-600'}`}>
              {r.response_text}
            </div>
            {r.mentioned && (
              <div className="mt-2 inline-block rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700">
                Mentioned
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
