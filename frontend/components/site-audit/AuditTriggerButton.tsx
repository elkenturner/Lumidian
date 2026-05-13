'use client';

import { useState } from 'react';
import { motion } from 'framer-motion';
import { Play, Loader2 } from 'lucide-react';
import { siteAudit } from '@/lib/api';

interface Props {
  brandId: number;
  disabled?: boolean;
  onTriggered: () => void;
}

export function AuditTriggerButton({ brandId, disabled = false, onTriggered }: Props) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function handleClick() {
    setBusy(true);
    setErr(null);
    try {
      await siteAudit.trigger(brandId);
      onTriggered();
    } catch (e: unknown) {
      const detail = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setErr(detail ?? 'Failed to start audit.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col items-start gap-2">
      <motion.button
        type="button"
        onClick={handleClick}
        disabled={disabled || busy}
        whileTap={{ scale: 0.97 }}
        transition={{ type: 'spring', stiffness: 400, damping: 20 }}
        className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium text-white disabled:opacity-60 disabled:cursor-not-allowed"
        style={{ background: 'var(--accent)' }}
      >
        {busy ? (
          <>
            <Loader2 size={14} className="animate-spin" />
            Starting…
          </>
        ) : (
          <>
            <Play size={14} />
            Run audit
          </>
        )}
      </motion.button>
      {err && <p className="text-xs" style={{ color: 'var(--danger-text)' }}>{err}</p>}
    </div>
  );
}
