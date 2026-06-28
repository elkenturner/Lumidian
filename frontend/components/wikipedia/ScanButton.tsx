'use client';

import { useEffect, useState } from 'react';
import { Loader2, RefreshCw } from 'lucide-react';
import { getLatestWikipediaScan, scanWikipedia, type WikipediaScan } from '@/lib/api';
import { Button } from '@/components/ui/button';

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
    <div className="flex flex-col items-start gap-2 sm:items-end">
      <Button type="button" variant="secondary" onClick={trigger} disabled={isRunning} className="group">
        {isRunning ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <RefreshCw className="h-3.5 w-3.5 transition-transform group-hover:rotate-180 duration-500" />
        )}
        {isRunning ? 'Scanning…' : 'Run scan'}
      </Button>

      <div className="text-xs text-[var(--text-faint)]">
        {scan?.status === 'running' && (
          <>Searching · {scan.prompts_searched ?? 0} prompts</>
        )}
        {scan?.status === 'completed' && scan.completed_at && (
          <>
            Last scan {formatTime(scan.completed_at)} ·{' '}
            <span className="text-[var(--text-muted)]">
              {scan.candidates_persisted} candidates
            </span>
          </>
        )}
        {scan?.status === 'failed' && (
          <span className="text-[var(--danger-text)]">
            Last scan failed{scan.error_message ? ` — ${scan.error_message}` : ''}
          </span>
        )}
        {!scan && <>No scans yet</>}
      </div>

      {error && <span className="text-xs text-[var(--danger-text)]">{error}</span>}
    </div>
  );
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return 'just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.floor(diffHr / 24);
  if (diffDay < 7) return `${diffDay}d ago`;
  return d.toLocaleDateString();
}
