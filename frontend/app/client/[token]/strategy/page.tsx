'use client';
import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { clientPortalListClusters } from '@/lib/api';

export default function StrategyPage() {
  const params = useParams<{ token: string }>();
  const token = params.token;
  const [clusters, setClusters] = useState<any[]>([]);

  useEffect(() => {
    if (!token) return;
    clientPortalListClusters(token).then(setClusters);
  }, [token]);

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <h1 className="text-2xl font-semibold text-neutral-900">Content strategy</h1>
      <p className="text-sm text-neutral-500">Per-prompt content clusters and their status.</p>
      <ul className="space-y-2">
        {clusters.map((c) => (
          <li key={c.id} className="rounded-md border border-neutral-200 bg-white p-3 text-sm">
            <div className="font-medium text-neutral-900">{c.prompt_text}</div>
            <div className="mt-1 text-xs text-neutral-500">
              Status: {c.status}
              {c.last_generated_at && ` · Last generated ${new Date(c.last_generated_at).toLocaleDateString()}`}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
