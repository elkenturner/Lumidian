'use client';
import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { clientPortalListRuns } from '@/lib/api';

export default function VisibilityPage() {
  const params = useParams<{ token: string }>();
  const token = params.token;
  const [runs, setRuns] = useState<any[]>([]);

  useEffect(() => {
    if (!token) return;
    clientPortalListRuns(token).then(setRuns);
  }, [token]);

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <h1 className="text-2xl font-semibold text-neutral-900">Visibility runs</h1>
      <table className="w-full rounded-lg border border-neutral-200 bg-white">
        <thead className="border-b border-neutral-200 text-left text-xs uppercase tracking-wide text-neutral-500">
          <tr>
            <th className="px-4 py-2">Date</th>
            <th className="px-4 py-2">Score</th>
            <th className="px-4 py-2">Queries</th>
            <th className="px-4 py-2">Mentions</th>
          </tr>
        </thead>
        <tbody>
          {runs.map((r) => (
            <tr key={r.id} className="border-b border-neutral-100 text-sm last:border-0">
              <td className="px-4 py-2">{r.completed_at ? new Date(r.completed_at).toLocaleDateString() : '—'}</td>
              <td className="px-4 py-2 font-medium">{r.overall_score?.toFixed(1) ?? '—'}</td>
              <td className="px-4 py-2">{r.total_queries}</td>
              <td className="px-4 py-2">{r.total_mentions}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
