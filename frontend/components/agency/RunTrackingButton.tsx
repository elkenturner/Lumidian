'use client';

import { useState } from 'react';
import { Loader2, RefreshCw } from 'lucide-react';
import { agencyTriggerTracking } from '@/lib/api';
import { useClientView } from '@/lib/client-view';

interface Props {
  clientId: number;
  onTriggered: () => void;
}

export function RunTrackingButton({ clientId, onTriggered }: Props) {
  // Defensive gate: suppress this write-action component when rendered inside
  // the /client/[token] portal shell. Portal pages don't import this today,
  // but this guard prevents future accidents. (Task 16 narrowed-scope audit.)
  const { isClientView } = useClientView();
  if (isClientView) return null;

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const run = async () => {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      await agencyTriggerTracking(clientId);
      setMessage('Tracking started. Scores will update in 1–3 minutes.');
      setTimeout(onTriggered, 90_000);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to start tracking');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex items-center gap-3">
      {message && <span className="text-xs text-[var(--text-muted)]">{message}</span>}
      {error && <span className="text-xs text-red-400">{error}</span>}
      <button
        onClick={run}
        disabled={busy}
        className="flex items-center gap-2 rounded-md border border-[var(--border-default)] bg-[var(--bg-elevated)] px-3 py-1.5 text-xs font-medium text-[var(--text-primary)] hover:bg-[var(--bg-card)] disabled:opacity-50"
      >
        {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
        {busy ? 'Starting…' : 'Run tracking now'}
      </button>
    </div>
  );
}
