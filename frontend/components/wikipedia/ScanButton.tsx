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
  const mono = { fontFamily: 'var(--font-geist-mono)' } as const;

  return (
    <div className="flex flex-col items-end gap-2">
      <button
        type="button"
        onClick={trigger}
        disabled={isRunning}
        className="group inline-flex cursor-pointer items-center gap-2 rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[rgba(255,255,255,0.04)] px-4 py-2 text-[13px] font-medium text-[var(--text-primary)] transition-colors hover:border-[var(--border-strong)] hover:bg-[rgba(255,255,255,0.08)] disabled:cursor-wait disabled:opacity-60 active:scale-[0.98] [transition:transform_160ms_cubic-bezier(0.23,1,0.32,1),background-color_0.15s_ease,border-color_0.15s_ease]"
      >
        {isRunning ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin text-[var(--accent-foreground)]" />
        ) : (
          <RefreshCw className="h-3.5 w-3.5 text-[var(--accent-foreground)] transition-transform group-hover:rotate-180 duration-500" />
        )}
        {isRunning ? 'Scanning' : 'Run scan'}
      </button>

      <div
        className="text-[10.5px] uppercase tracking-[0.18em] text-[var(--text-faint)]"
        style={mono}
      >
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
          <span className="text-[#fb7185] normal-case tracking-normal">
            Last scan failed{scan.error_message ? ` — ${scan.error_message}` : ''}
          </span>
        )}
        {!scan && <>No scans yet</>}
      </div>

      {error && (
        <span className="text-[11px] text-[#fb7185]">{error}</span>
      )}
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
