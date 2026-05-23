'use client';
import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { clientPortalListWikipedia } from '@/lib/api';

export default function WikipediaPage() {
  const params = useParams<{ token: string }>();
  const token = params.token;
  const [candidates, setCandidates] = useState<any[]>([]);

  useEffect(() => {
    if (!token) return;
    clientPortalListWikipedia(token).then(setCandidates);
  }, [token]);

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <h1 className="text-2xl font-semibold text-neutral-900">Wikipedia candidates</h1>
      <ul className="space-y-2">
        {candidates.map((c) => (
          <li key={c.id} className="rounded-md border border-neutral-200 bg-white p-3 text-sm">
            <a
              href={c.article_url}
              target="_blank"
              rel="noopener noreferrer"
              className="font-medium text-neutral-900 hover:underline"
            >
              {c.article_title}
            </a>
            <span className="ml-2 text-xs text-neutral-500">
              · Legitimacy {c.legitimacy_score?.toFixed(2) ?? '—'}
            </span>
            <span className="ml-2 inline-block rounded-full bg-neutral-100 px-2 py-0.5 text-xs uppercase text-neutral-700">
              {c.status}
            </span>
            {c.article_summary && (
              <div className="mt-1 text-neutral-600 line-clamp-2">{c.article_summary}</div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
