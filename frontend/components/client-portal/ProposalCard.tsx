'use client';
import { ExternalLink } from 'lucide-react';

export default function ProposalCard({
  label,
  docUrl,
}: {
  label: string | null;
  docUrl: string | null;
}) {
  if (!label || !docUrl) return null;
  return (
    <div className="rounded-lg border border-neutral-200 bg-white p-5 shadow-sm">
      <div className="mb-1 text-xs font-medium uppercase tracking-wide text-neutral-500">
        This week's proposal
      </div>
      <div className="mb-3 text-base font-medium text-neutral-900">{label}</div>
      <a
        href={docUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-1.5 rounded-md bg-neutral-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-neutral-800"
      >
        Open in Google Docs
        <ExternalLink className="h-3.5 w-3.5" />
      </a>
    </div>
  );
}
