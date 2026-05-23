'use client';
import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { clientPortalListCompetitors } from '@/lib/api';

export default function CompetitorsPage() {
  const params = useParams<{ token: string }>();
  const token = params.token;
  const [items, setItems] = useState<any[]>([]);

  useEffect(() => {
    if (!token) return;
    clientPortalListCompetitors(token).then(setItems);
  }, [token]);

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <h1 className="text-2xl font-semibold text-neutral-900">Competitors</h1>
      <ul className="space-y-2">
        {items.map((c) => (
          <li key={c.id} className="rounded-md border border-neutral-200 bg-white p-3 text-sm">
            <span className="font-medium">{c.name}</span>
            {c.website_url && (
              <a
                href={c.website_url}
                target="_blank"
                rel="noopener noreferrer"
                className="ml-2 text-neutral-500 hover:underline"
              >
                {c.website_url}
              </a>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
