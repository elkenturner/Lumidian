'use client';
import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import {
  clientPortalGetBrand,
  clientPortalGetDashboard,
  clientPortalGetProposal,
  clientPortalListPostedContent,
  type ClientPortalBrand,
  type ClientPortalDashboard,
  type ClientPortalProposal,
} from '@/lib/api';
import ProposalCard from '@/components/client-portal/ProposalCard';

export default function ClientPortalHome() {
  const params = useParams<{ token: string }>();
  const token = params.token;
  const [brand, setBrand] = useState<ClientPortalBrand | null>(null);
  const [dashboard, setDashboard] = useState<ClientPortalDashboard | null>(null);
  const [proposal, setProposal] = useState<ClientPortalProposal | null>(null);
  const [posted, setPosted] = useState<any[]>([]);

  useEffect(() => {
    if (!token) return;
    Promise.all([
      clientPortalGetBrand(token),
      clientPortalGetDashboard(token),
      clientPortalGetProposal(token),
      clientPortalListPostedContent(token),
    ]).then(([b, d, p, c]) => {
      setBrand(b);
      setDashboard(d);
      setProposal(p);
      setPosted(c);
    });
  }, [token]);

  if (!brand) return <div className="text-sm text-neutral-500">Loading…</div>;

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <header>
        <h1 className="text-2xl font-semibold text-neutral-900">{brand.name}</h1>
        {dashboard?.latest_run_at && (
          <p className="mt-1 text-sm text-neutral-500">
            Last tracked: {new Date(dashboard.latest_run_at).toLocaleDateString()}
          </p>
        )}
      </header>

      {dashboard && (
        <section className="rounded-lg border border-neutral-200 bg-white p-5 shadow-sm">
          <div className="text-xs font-medium uppercase tracking-wide text-neutral-500">Visibility</div>
          <div className="mt-1 text-4xl font-semibold text-neutral-900">
            {dashboard.overall_score?.toFixed(1) ?? '—'}
          </div>
          <div className="mt-1 text-xs text-neutral-500">{dashboard.total_runs} runs total</div>
        </section>
      )}

      {proposal && <ProposalCard label={proposal.label} docUrl={proposal.doc_url} />}

      <section>
        <h2 className="mb-3 text-sm font-semibold text-neutral-900">Recently shipped</h2>
        {posted.length === 0 ? (
          <p className="text-sm text-neutral-500">No posted content yet.</p>
        ) : (
          <ul className="space-y-2">
            {posted.slice(0, 5).map((p) => (
              <li key={p.id} className="rounded-md border border-neutral-200 bg-white p-3 text-sm">
                <span className="font-medium">{p.title}</span>
                <span className="ml-2 text-neutral-500">· {p.platform}</span>
                {p.posted_at && (
                  <span className="ml-2 text-neutral-500">
                    · {new Date(p.posted_at).toLocaleDateString()}
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
