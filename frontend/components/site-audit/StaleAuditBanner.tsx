'use client';

import { useState } from 'react';
import { motion } from 'framer-motion';
import { Clock, RefreshCw } from 'lucide-react';
import { easings } from '@/lib/motion';
import { siteAudit } from '@/lib/api';

interface Props {
  brandId: number;
  startedAt: string;
  onTriggered: () => void;
}

const STALE_AFTER_DAYS = 14;

/**
 * Shown when the audit is old enough that scores/recommendations may have
 * drifted. Purely age-based: the old ">50% of recs lack target_url" heuristic
 * (for a mid-May 2026 auditor bug) fired forever on small sites, because
 * schema and bot-access recommendations are site-wide by design and never
 * carry a page URL — no re-run can change that.
 */
export function StaleAuditBanner({ brandId, startedAt, onTriggered }: Props) {
  const [dismissed, setDismissed] = useState(false);
  const [busy, setBusy] = useState(false);

  const ageDays = Math.floor(
    (Date.now() - new Date(startedAt).getTime()) / (1000 * 60 * 60 * 24)
  );
  if (dismissed || ageDays <= STALE_AFTER_DAYS) return null;

  async function handleRun() {
    setBusy(true);
    try {
      await siteAudit.trigger(brandId);
      onTriggered();
    } finally {
      setBusy(false);
      setDismissed(true);
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
          This audit is {ageDays} days old
        </p>
        <p className="text-[var(--text-secondary)] mt-1 leading-relaxed">
          Your site and the AI engines reading it have likely changed since. Re-run the audit to
          refresh your scores and recommendations.
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
