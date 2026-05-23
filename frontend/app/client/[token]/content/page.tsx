'use client';
import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { clientPortalListPostedContent } from '@/lib/api';

export default function ContentPostedPage() {
  const params = useParams<{ token: string }>();
  const token = params.token;
  const [items, setItems] = useState<any[]>([]);

  useEffect(() => {
    if (!token) return;
    clientPortalListPostedContent(token).then(setItems);
  }, [token]);

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <h1 className="text-2xl font-semibold text-neutral-900">Content posted</h1>
      <p className="text-sm text-neutral-500">Everything that has been published for this brand.</p>
      <ul className="space-y-3">
        {items.map((p) => (
          <li key={p.id} className="rounded-md border border-neutral-200 bg-white p-4 text-sm">
            <div className="flex items-baseline justify-between">
              <span className="font-medium text-neutral-900">{p.title}</span>
              {p.posted_at && (
                <span className="text-xs text-neutral-500">
                  {new Date(p.posted_at).toLocaleDateString()}
                </span>
              )}
            </div>
            <div className="mt-1 text-xs text-neutral-500">{p.platform}</div>
            {p.content_text && (
              <div className="mt-2 whitespace-pre-wrap text-neutral-700 line-clamp-6">
                {p.content_text}
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
