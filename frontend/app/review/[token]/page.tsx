'use client';

import { use, useEffect, useState } from 'react';
import {
  publicApproveDraft,
  publicGetReviewPage,
  publicRejectDraft,
  publicRequestChanges,
  type ReviewClientPage,
  type ReviewDraft,
} from '@/lib/api';

type ActionState = 'idle' | 'changes' | 'reject';

interface CardProps {
  draft: ReviewDraft;
  token: string;
  onActionComplete: (draftId: number, badge: string) => void;
}

function DraftCard({ draft, token, onActionComplete }: CardProps) {
  const [mode, setMode] = useState<ActionState>('idle');
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [doneBadge, setDoneBadge] = useState<string | null>(null);

  const finish = (badge: string) => {
    setDoneBadge(badge);
    onActionComplete(draft.id, badge);
  };

  const approve = async () => {
    setBusy(true);
    setError(null);
    try {
      await publicApproveDraft(token, draft.id);
      finish('Approved');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to approve');
    } finally {
      setBusy(false);
    }
  };

  const submitChanges = async () => {
    if (!text.trim()) {
      setError('Please describe what changes you want.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await publicRequestChanges(token, draft.id, text.trim());
      finish('Changes requested');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to send');
    } finally {
      setBusy(false);
    }
  };

  const submitReject = async () => {
    if (!text.trim()) {
      setError('Please give a reason.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await publicRejectDraft(token, draft.id, text.trim());
      finish('Rejected');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to reject');
    } finally {
      setBusy(false);
    }
  };

  if (doneBadge) {
    return (
      <article className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-card)] p-5 opacity-60">
        <div className="flex items-baseline justify-between">
          <h2 className="text-base font-medium">{draft.title || `Draft #${draft.id}`}</h2>
          <span className="rounded-full bg-emerald-500/20 px-2 py-1 text-xs text-emerald-300">
            {doneBadge}
          </span>
        </div>
      </article>
    );
  }

  return (
    <article className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-card)] p-5">
      <div className="mb-3 flex items-baseline justify-between">
        <h2 className="text-base font-medium">{draft.title || `Draft #${draft.id}`}</h2>
        <span className="text-xs text-[var(--text-muted)]">{draft.platform}</span>
      </div>
      <pre className="whitespace-pre-wrap rounded-md border border-[var(--border-subtle)] bg-[var(--bg-raised)] p-3 text-sm text-[var(--text-primary)]">
        {draft.content_text}
      </pre>

      {mode === 'idle' && (
        <div className="mt-4 flex flex-wrap gap-2">
          <button
            onClick={approve}
            disabled={busy}
            className="rounded-md bg-emerald-500/20 px-3 py-2 text-sm font-medium text-emerald-200 hover:bg-emerald-500/30 disabled:opacity-50"
          >
            Approve
          </button>
          <button
            onClick={() => setMode('changes')}
            disabled={busy}
            className="rounded-md bg-amber-500/20 px-3 py-2 text-sm font-medium text-amber-200 hover:bg-amber-500/30 disabled:opacity-50"
          >
            Request changes
          </button>
          <button
            onClick={() => setMode('reject')}
            disabled={busy}
            className="rounded-md bg-rose-500/20 px-3 py-2 text-sm font-medium text-rose-200 hover:bg-rose-500/30 disabled:opacity-50"
          >
            Reject
          </button>
        </div>
      )}

      {mode === 'changes' && (
        <div className="mt-4 space-y-2">
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={3}
            placeholder="What needs to change?"
            className="w-full rounded-md border border-[var(--border-default)] bg-[var(--bg-raised)] px-3 py-2 text-sm"
          />
          <div className="flex gap-2">
            <button
              onClick={submitChanges}
              disabled={busy}
              className="rounded-md bg-amber-500/30 px-3 py-2 text-sm font-medium text-amber-100 hover:bg-amber-500/40 disabled:opacity-50"
            >
              Send back
            </button>
            <button
              onClick={() => {
                setMode('idle');
                setText('');
              }}
              className="rounded-md border border-[var(--border-default)] px-3 py-2 text-sm text-[var(--text-secondary)]"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {mode === 'reject' && (
        <div className="mt-4 space-y-2">
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={3}
            placeholder="Why are you rejecting this?"
            className="w-full rounded-md border border-[var(--border-default)] bg-[var(--bg-raised)] px-3 py-2 text-sm"
          />
          <div className="flex gap-2">
            <button
              onClick={submitReject}
              disabled={busy}
              className="rounded-md bg-rose-500/30 px-3 py-2 text-sm font-medium text-rose-100 hover:bg-rose-500/40 disabled:opacity-50"
            >
              Reject
            </button>
            <button
              onClick={() => {
                setMode('idle');
                setText('');
              }}
              className="rounded-md border border-[var(--border-default)] px-3 py-2 text-sm text-[var(--text-secondary)]"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {error && <p className="mt-2 text-sm text-red-400">{error}</p>}
    </article>
  );
}

export default function ReviewPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = use(params);
  const [data, setData] = useState<ReviewClientPage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [completedIds, setCompletedIds] = useState<Set<number>>(new Set());

  useEffect(() => {
    publicGetReviewPage(token)
      .then(setData)
      .catch((e) => {
        const status = (e as { response?: { status?: number } })?.response?.status;
        if (status === 404) setError('This review link is invalid or has been revoked.');
        else setError(String((e as Error)?.message ?? e));
      });
  }, [token]);

  const handleAction = (draftId: number) => {
    setCompletedIds((prev) => new Set(prev).add(draftId));
  };

  if (error) {
    return (
      <p className="rounded-md border border-rose-500/30 bg-rose-500/10 p-4 text-sm text-rose-200">
        {error}
      </p>
    );
  }
  if (!data) {
    return <p className="text-sm text-[var(--text-muted)]">Loading…</p>;
  }

  const remaining = data.drafts.filter((d) => !completedIds.has(d.id));
  const allDone = data.drafts.length > 0 && remaining.length === 0;

  return (
    <div className="space-y-6">
      <header>
        <p className="text-xs uppercase tracking-wide text-[var(--text-muted)]">
          {data.client_name}
        </p>
        <h2 className="mt-1 text-xl font-semibold">Drafts pending your review</h2>
      </header>

      {data.drafts.length === 0 && (
        <p className="rounded-md border border-[var(--border-subtle)] bg-[var(--bg-card)] p-4 text-sm text-[var(--text-muted)]">
          Nothing pending right now. Come back when a new batch is sent.
        </p>
      )}

      {allDone && (
        <p className="rounded-md border border-emerald-500/30 bg-emerald-500/10 p-4 text-sm text-emerald-200">
          You&apos;ve reviewed everything in this batch — thanks!
        </p>
      )}

      {data.drafts.map((d) => (
        <DraftCard
          key={d.id}
          draft={d}
          token={token}
          onActionComplete={(id) => handleAction(id)}
        />
      ))}
    </div>
  );
}
