'use client';

import { useEffect, useState } from 'react';
import { Loader2, RefreshCw } from 'lucide-react';
import { getLatestWikipediaScan, scanWikipedia, type WikipediaScan } from '@/lib/api';

interface Props {
  brandId: number;
  onScanCompleted: () => void;
}

const POLL_INTERVAL_MS = 3000;

export function ScanButton({ brandId, onScanCompleted }: Props) {
  const [scan, setScan] = useState<WikipediaScan | null>(null);
  const [triggering, setTriggering] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let intervalId: ReturnType<typeof setInterval> | null = null;

    async function refresh() {
      try {
        const latest = await getLatestWikipediaScan(brandId);
        if (cancelled) return;
        setScan(latest);
        if (latest && latest.status === 'running') {
          intervalId ??= setInterval(refresh, POLL_INTERVAL_MS);
        } else if (intervalId) {
          clearInterval(intervalId);
          intervalId = null;
          if (latest && latest.status === 'completed') onScanCompleted();
        }
      } catch (err: unknown) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to fetch scan status');
      }
    }

    refresh();
    return () => {
      cancelled = true;
      if (intervalId) clearInterval(intervalId);
    };
  }, [brandId, onScanCompleted]);

  async function trigger() {
    setTriggering(true);
    setError(null);
    try {
      const newScan = await scanWikipedia(brandId);
      setScan(newScan);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to start scan');
    } finally {
      setTriggering(false);
    }
  }

  const isRunning = scan?.status === 'running' || triggering;

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={trigger}
        disabled={isRunning}
        className="inline-flex items-center gap-2 rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
      >
        {isRunning ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
        {isRunning ? 'Scanning…' : 'Scan Wikipedia'}
      </button>
      {scan?.status === 'running' && (
        <span className="text-xs text-slate-500">
          Searching {scan.prompts_searched || '…'} prompts
        </span>
      )}
      {scan?.status === 'completed' && scan.completed_at && (
        <span className="text-xs text-slate-500">
          Last scan: {new Date(scan.completed_at).toLocaleString()} · {scan.candidates_persisted} candidates
        </span>
      )}
      {scan?.status === 'failed' && (
        <span className="text-xs text-rose-700">Last scan failed{scan.error_message ? `: ${scan.error_message}` : ''}</span>
      )}
      {error && <span className="text-xs text-rose-700">{error}</span>}
    </div>
  );
}
