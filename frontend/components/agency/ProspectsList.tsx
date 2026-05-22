'use client';

import Link from 'next/link';
import { Download, ExternalLink } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';

import { ProspectAuditListItem, prospectAuditPdfUrl } from '@/lib/api';
import { RviBandBadge } from './RviBandBadge';

interface Props {
  items: ProspectAuditListItem[];
}

export function ProspectsList({ items }: Props) {
  if (items.length === 0) {
    return (
      <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-card)] p-12 text-center text-sm text-[var(--text-secondary)]">
        No prospect audits yet. <Link href="/agency/prospects/new" className="text-[var(--accent)] hover:underline">Create your first one →</Link>
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-card)]">
      <table className="w-full text-sm">
        <thead className="border-b border-[var(--border-subtle)] bg-[var(--bg-raised)] text-xs uppercase tracking-wide text-[var(--text-muted)]">
          <tr>
            <th className="px-4 py-3 text-left font-medium">Business</th>
            <th className="px-4 py-3 text-left font-medium">Location</th>
            <th className="px-4 py-3 text-left font-medium">Status</th>
            <th className="px-4 py-3 text-right font-medium">Visibility</th>
            <th className="px-4 py-3 text-left font-medium">RVI</th>
            <th className="px-4 py-3 text-left font-medium">Created</th>
            <th className="px-4 py-3 text-right font-medium">PDF</th>
          </tr>
        </thead>
        <tbody>
          {items.map((p) => (
            <tr key={p.id} className="border-b border-[var(--border-subtle)] last:border-0 hover:bg-[var(--bg-raised)]/40">
              <td className="px-4 py-3">
                <Link href={`/agency/prospects/${p.id}`} className="font-medium text-[var(--text-primary)] hover:underline">
                  {p.business_name}
                </Link>
                <div className="mt-0.5 flex items-center gap-1 text-xs text-[var(--text-muted)]">
                  <a href={p.website_url} target="_blank" rel="noreferrer" className="truncate hover:underline">
                    {p.website_url.replace(/^https?:\/\//, '')}
                  </a>
                  <ExternalLink className="h-3 w-3" />
                </div>
              </td>
              <td className="px-4 py-3 text-[var(--text-secondary)]">
                {p.is_local ? p.location : <span className="text-[var(--text-muted)]">—</span>}
              </td>
              <td className="px-4 py-3">
                <span className="text-[var(--text-secondary)]">{p.status}</span>
              </td>
              <td className="px-4 py-3 text-right font-mono tabular-nums text-[var(--text-primary)]">
                {p.overall_visibility_pct !== null ? `${Math.round(p.overall_visibility_pct)}%` : '—'}
              </td>
              <td className="px-4 py-3">
                {p.rvi_band ? <RviBandBadge band={p.rvi_band} /> : <span className="text-[var(--text-muted)]">—</span>}
              </td>
              <td className="px-4 py-3 text-xs text-[var(--text-muted)]">
                {formatDistanceToNow(new Date(p.created_at), { addSuffix: true })}
              </td>
              <td className="px-4 py-3 text-right">
                {p.status === 'completed' ? (
                  <a
                    href={prospectAuditPdfUrl(p.id)}
                    className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-[var(--accent)] hover:bg-[var(--bg-raised)]"
                  >
                    <Download className="h-3.5 w-3.5" />
                    PDF
                  </a>
                ) : (
                  <span className="text-xs text-[var(--text-muted)]">—</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
