'use client';

import { useEffect, useState } from 'react';
import { Link2, Check } from 'lucide-react';
import {
  agencyGetReviewLink,
  agencyRotateReviewLink,
  type ReviewLinkOut,
} from '@/lib/api';
import { useClientView } from '@/lib/client-view';

interface Props {
  clientId: number;
}

export function CopyReviewLinkButton({ clientId }: Props) {
  // Defensive gate: suppress this write-action component when rendered inside
  // the /client/[token] portal shell. Clients shouldn't see their own portal
  // link; this guard also prevents future import accidents.
  // (Task 16 narrowed-scope audit.)
  const { isClientView } = useClientView();
  if (isClientView) return null;

  const [link, setLink] = useState<ReviewLinkOut | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    agencyGetReviewLink(clientId)
      .then(setLink)
      .catch(() => setLink(null));
  }, [clientId]);

  const handleClick = async () => {
    setError(null);
    let current = link;
    if (!current) {
      setBusy(true);
      try {
        current = await agencyRotateReviewLink(clientId);
        setLink(current);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to generate link');
        setBusy(false);
        return;
      }
      setBusy(false);
    }
    try {
      await navigator.clipboard.writeText(current.url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setError('Could not copy to clipboard');
    }
  };

  return (
    <div className="flex items-center gap-2">
      <button
        onClick={handleClick}
        disabled={busy}
        title={link ? 'Copy client review link' : 'Generate & copy client review link'}
        className="flex items-center gap-1.5 rounded-md border border-[var(--border-default)] bg-[var(--bg-card)] px-2.5 py-1 text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-raised)] hover:text-[var(--text-primary)] disabled:opacity-50"
      >
        {copied ? <Check className="h-3 w-3" /> : <Link2 className="h-3 w-3" />}
        {copied ? 'Copied' : link ? 'Copy review link' : busy ? 'Generating…' : 'Review link'}
      </button>
      {error && <span className="text-xs text-red-400">{error}</span>}
    </div>
  );
}
