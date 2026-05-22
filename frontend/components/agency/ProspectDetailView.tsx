'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';

import {
  getProspectAudit,
  type ProspectAuditOut,
} from '@/lib/api';
import { ProspectRunningPanel } from './ProspectRunningPanel';
import { ProspectResultsPanel } from './ProspectResultsPanel';
import { ProspectErrorPanel } from './ProspectErrorPanel';

const TERMINAL_STATUSES = new Set(['completed', 'failed', 'canceled']);
const POLL_INTERVAL_MS = 2000;

interface Props {
  auditId: number;
}

export function ProspectDetailView({ auditId }: Props) {
  const [audit, setAudit] = useState<ProspectAuditOut | null>(null);
  const [error, setError] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function tick() {
      try {
        const next = await getProspectAudit(auditId);
        if (cancelled) return;
        setAudit(next);
        setError(null);
        if (!TERMINAL_STATUSES.has(next.status)) {
          timerRef.current = setTimeout(tick, POLL_INTERVAL_MS);
        }
      } catch (e: unknown) {
        if (cancelled) return;
        const msg = e && typeof e === 'object' && 'message' in e ? String((e as { message: unknown }).message) : 'Failed to load audit.';
        setError(msg);
        timerRef.current = setTimeout(tick, POLL_INTERVAL_MS * 3);
      }
    }
    tick();
    return () => {
      cancelled = true;
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [auditId]);

  return (
    <div className="mx-auto max-w-3xl px-6 py-8">
      <Link
        href="/agency/prospects"
        className="mb-4 inline-flex items-center gap-1 text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to prospects
      </Link>

      {error && !audit && (
        <div className="rounded-md border border-rose-500/30 bg-rose-500/10 p-4 text-sm text-rose-300">{error}</div>
      )}

      {audit && audit.status === 'completed' && <ProspectResultsPanel audit={audit} />}
      {audit && (audit.status === 'failed' || audit.status === 'canceled') && <ProspectErrorPanel audit={audit} />}
      {audit && !TERMINAL_STATUSES.has(audit.status) && <ProspectRunningPanel audit={audit} />}
    </div>
  );
}
