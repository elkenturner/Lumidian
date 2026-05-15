'use client';

import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { Clock, RefreshCw } from 'lucide-react';
import { easings } from '@/lib/motion';
import { siteAudit } from '@/lib/api';

interface Props {
  auditId: number;
  brandId: number;
  startedAt: string;
  onTriggered: () => void;
}

/**
 * Shows when the current audit's data is stale — specifically when most recs
 * lack target_url (caused by a known auditor bug fixed mid-May 2026) or the
 * audit is more than 14 days old. Surfaces a one-click re-run.
 */
export function StaleAuditBanner({ auditId, brandId, startedAt, onTriggered }: Props) {
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const recs = await siteAudit.recommendations(auditId);
      if (cancelled) return;
      if (recs.length === 0) {
        setShow(false);
        return;
      }
      const nullTargetPct = recs.filter((r) => !r.target_url).length / recs.length;
      const auditAgeDays = (Date.now() - new Date(startedAt).getTime()) / (1000 * 60 * 60 * 24);
      // Show if >50% of recs lack target_url OR the audit is >14 days old.
      setShow(nullTargetPct > 0.5 || auditAgeDays > 14);
    })().catch(() => setShow(false));
    return () => {
      cancelled = true;
    };
  }, [auditId, startedAt]);

  if (!show) return null;

  async function handleRun() {
    setBusy(true);
    try {
      await siteAudit.trigger(brandId);
      onTriggered();
    } finally {
      setBusy(false);
      setShow(false);
    }
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: -4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, ease: easings.out }}
      className="mb-6 rounded-lg p-4 flex items-start gap-3"
      style={{
        background: 'rgba(245, 158, 11, 0.06)',
        border: '1px solid var(--warning)',
      }}
    >
      <Clock size={18} className="shrink-0 mt-0.5" style={{ color: 'var(--warning-text)' }} />
      <div className="flex-1 text-sm">
        <p className="font-semibold" style={{ color: 'var(--warning-text)' }}>
          This audit is missing data
        </p>
        <p className="text-[var(--text-secondary)] mt-1 leading-relaxed">
          Most recommendations don't have specific page URLs attached. Re-running the audit will
          give you precise "where it goes" guidance on every fix card.
        </p>
        <button
          type="button"
          onClick={handleRun}
          disabled={busy}
          className="mt-3 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium text-white disabled:opacity-60"
          style={{ background: 'var(--accent)' }}
        >
          <RefreshCw size={14} className={busy ? 'animate-spin' : ''} />
          {busy ? 'Starting…' : 'Re-run audit'}
        </button>
      </div>
    </motion.div>
  );
}
