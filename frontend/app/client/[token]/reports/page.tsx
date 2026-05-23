'use client';
import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { clientPortalListDocuments, clientPortalGetDocument } from '@/lib/api';
import { Download } from 'lucide-react';

export default function ReportsPage() {
  const params = useParams<{ token: string }>();
  const token = params.token;
  const [docs, setDocs] = useState<any[]>([]);
  const [open, setOpen] = useState<any | null>(null);

  useEffect(() => {
    if (!token) return;
    clientPortalListDocuments(token).then(setDocs);
  }, [token]);

  async function openDoc(id: number) {
    const d = await clientPortalGetDocument(token, id);
    setOpen(d);
  }

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <h1 className="text-2xl font-semibold text-neutral-900">Reports</h1>
      <ul className="space-y-2">
        {docs.map((d) => (
          <li
            key={d.id}
            className="flex items-center justify-between rounded-md border border-neutral-200 bg-white p-3 text-sm"
          >
            <button onClick={() => openDoc(d.id)} className="text-left font-medium hover:underline">
              {d.title}
            </button>
            <div className="flex items-center gap-3">
              {d.generated_at && (
                <span className="text-xs text-neutral-500">
                  {new Date(d.generated_at).toLocaleDateString()}
                </span>
              )}
              <a
                href={`/api/public/client/${token}/documents/${d.id}/pdf`}
                className="inline-flex items-center gap-1 rounded-md border border-neutral-200 px-2 py-1 text-xs hover:bg-neutral-50"
              >
                <Download className="h-3 w-3" /> PDF
              </a>
            </div>
          </li>
        ))}
      </ul>
      {open && (
        <article className="rounded-md border border-neutral-200 bg-white p-5">
          <div className="mb-2 text-sm font-semibold text-neutral-900">{open.title}</div>
          <div className="whitespace-pre-wrap text-sm text-neutral-700">{open.body_markdown}</div>
        </article>
      )}
    </div>
  );
}
