'use client';

import { useEffect, useState } from 'react';
import { Copy, RefreshCw } from 'lucide-react';
import {
  agencyGetReviewLink,
  agencyRotateReviewLink,
  type ReviewLinkOut,
} from '@/lib/api';

interface Props {
  clientId: number;
}

export function ReviewLinkSection({ clientId }: Props) {
  const [link, setLink] = useState<ReviewLinkOut | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    agencyGetReviewLink(clientId)
      .then(setLink)
      .catch((e) => setError(String(e?.message ?? e)))
      .finally(() => setLoading(false));
  }, [clientId]);

  const generate = async () => {
    setBusy(true);
    setError(null);
    try {
      const next = await agencyRotateReviewLink(clientId);
      setLink(next);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to generate link');
    } finally {
      setBusy(false);
    }
  };

  const copy = () => {
    if (!link) return;
    navigator.clipboard.writeText(link.url);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-card)] p-5 text-[var(--text-primary)]">
      <h3 className="text-sm font-medium text-[var(--text-secondary)]">Client review link</h3>
      {loading && (
        <p className="mt-2 text-sm text-[var(--text-muted)]">Loading…</p>
      )}
      {!loading && !link && (
        <div className="mt-2 space-y-2">
          <p className="text-sm text-[var(--text-muted)]">
            No review link yet. Generate one to share with the client.
          </p>
          <button
            onClick={generate}
            disabled={busy}
            className="rounded-md bg-[var(--bg-elevated)] px-3 py-2 text-xs font-medium text-[var(--text-primary)] hover:bg-[var(--bg-card)] disabled:opacity-50"
          >
            {busy ? 'Generating…' : 'Generate review link'}
          </button>
        </div>
      )}
      {!loading && link && (
        <div className="mt-2 space-y-2">
          <div className="flex items-center gap-2">
            <code className="flex-1 truncate rounded-md border border-[var(--border-default)] bg-[var(--bg-raised)] px-3 py-2 text-xs">
              {link.url}
            </code>
            <button
              onClick={copy}
              title="Copy"
              className="rounded-md border border-[var(--border-default)] p-2 hover:bg-[var(--bg-raised)]"
            >
              <Copy className="h-3.5 w-3.5" />
            </button>
            <button
              onClick={generate}
              disabled={busy}
              title="Rotate (revokes the old link)"
              className="rounded-md border border-[var(--border-default)] p-2 hover:bg-[var(--bg-raised)] disabled:opacity-50"
            >
              <RefreshCw className="h-3.5 w-3.5" />
            </button>
          </div>
          <p className="text-xs text-[var(--text-muted)]">
            Share this link with the client. Drafts in &ldquo;awaiting client&rdquo; status appear here for them to approve, request changes, or reject.{' '}
            {copied && <span className="text-emerald-400">Copied!</span>}
          </p>
        </div>
      )}
      {error && <p className="mt-2 text-sm text-red-400">{error}</p>}
    </div>
  );
}
