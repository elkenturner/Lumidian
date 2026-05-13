'use client';

import { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { easings } from '@/lib/motion';

interface Props {
  open: boolean;
  onClose: () => void;
  onSubmit: (notes: string) => void;
}

export function RegenPopover({ open, onClose, onSubmit }: Props) {
  const [notes, setNotes] = useState('');
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    }
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [open, onClose]);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          ref={ref}
          initial={{ opacity: 0, y: -4 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -4 }}
          transition={{ duration: 0.18, ease: easings.out }}
          className="absolute right-0 mt-2 z-20 w-80 rounded-lg p-4 shadow-xl"
          style={{
            background: 'var(--bg-elevated)',
            border: '1px solid var(--border-default)',
          }}
        >
          <p className="text-xs text-[var(--text-secondary)] mb-2">
            Regenerate with notes <span className="text-[var(--text-faint)]">(optional)</span>
          </p>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder='e.g. "make it shorter" or "use a warmer tone"'
            rows={3}
            className="w-full text-sm px-2 py-1.5 rounded bg-[var(--bg-base)] border border-[var(--border-subtle)] focus:outline-none focus:border-[var(--accent-light)] text-[var(--text-primary)] placeholder:text-[var(--text-faint)] resize-none"
          />
          <div className="flex justify-end gap-2 mt-2">
            <button
              type="button"
              onClick={onClose}
              className="text-xs px-3 py-1.5 rounded text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => {
                onSubmit(notes);
                setNotes('');
              }}
              className="text-xs px-3 py-1.5 rounded font-medium text-white"
              style={{ background: 'var(--accent)' }}
            >
              Regenerate
            </button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
