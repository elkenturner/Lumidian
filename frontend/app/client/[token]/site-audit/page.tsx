'use client';
import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { clientPortalGetSiteAudit } from '@/lib/api';

export default function SiteAuditPage() {
  const params = useParams<{ token: string }>();
  const token = params.token;
  const [data, setData] = useState<any | null>(null);

  useEffect(() => {
    if (!token) return;
    clientPortalGetSiteAudit(token).then(setData);
  }, [token]);

  if (!data) return <div className="text-sm text-neutral-500">Loading…</div>;
  if (!data.audit) return <div className="text-sm text-neutral-500">No audit yet.</div>;

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <h1 className="text-2xl font-semibold text-neutral-900">Site audit</h1>
      <section className="rounded-lg border border-neutral-200 bg-white p-5">
        <div className="text-xs font-medium uppercase tracking-wide text-neutral-500">Overall score</div>
        <div className="mt-1 text-4xl font-semibold text-neutral-900">
          {data.audit.overall_score?.toFixed(1) ?? '—'}
        </div>
      </section>
      <section>
        <h2 className="mb-2 text-sm font-semibold text-neutral-900">Recommendations</h2>
        <ul className="space-y-2">
          {data.recommendations.map((r: any) => (
            <li key={r.id} className="rounded-md border border-neutral-200 bg-white p-3 text-sm">
              <span className="mr-2 inline-block rounded-full bg-neutral-100 px-2 py-0.5 text-xs uppercase tracking-wide text-neutral-700">
                {r.priority}
              </span>
              <span className="font-medium">{r.title}</span>
              <div className="mt-1 text-neutral-600">{r.body}</div>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
