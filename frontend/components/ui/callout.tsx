'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { X } from 'lucide-react';
import { easings } from '@/lib/motion';

interface CalloutProps {
  /** Optional icon shown in a small tinted square at the left */
  icon?: ReactNode;
  /** Optional heading line above the body */
  title?: string;
  /** Body content — accepts plain text or rich nodes */
  body: ReactNode;
  /** Optional action node (Link or button) shown after body or on the right for inline variant */
  action?: ReactNode;
  /** When true, render a dismiss × button in the top-right */
  dismissible?: boolean;
  /** If set and dismissible=true, persist dismissal in localStorage under this key */
  storageKey?: string;
  /** Layout — 'inline' is single-row compact (no icon expected); 'full' is multi-line with icon */
  variant?: 'inline' | 'full';
  className?: string;
}

export function Callout({
  icon,
  title,
  body,
  action,
  dismissible = false,
  storageKey,
  variant = 'full',
  className = '',
}: CalloutProps) {
  const [dismissed, setDismissed] = useState(Boolean(storageKey));
  const prefersReducedMotion = useReducedMotion();

  useEffect(() => {
    if (!storageKey) {
      setDismissed(false);
      return;
    }
    try {
      setDismissed(localStorage.getItem(storageKey) === '1');
    } catch {
      setDismissed(false);
    }
  }, [storageKey]);

  const handleDismiss = () => {
    if (storageKey) {
      try { localStorage.setItem(storageKey, '1'); } catch {}
    }
    setDismissed(true);
  };

  const enterDuration = prefersReducedMotion ? 0 : 0.35;
  const exitDuration = prefersReducedMotion ? 0 : 0.2;

  return (
    <AnimatePresence>
      {!dismissed && (
        <motion.div
          key="callout"
          initial={{ opacity: 0, height: 0, marginBottom: 0 }}
          animate={{
            opacity: 1,
            height: 'auto',
            marginBottom: 16,
            transition: { duration: enterDuration, ease: easings.out },
          }}
          exit={{
            opacity: 0,
            height: 0,
            marginBottom: 0,
            transition: { duration: exitDuration, ease: easings.out },
          }}
          style={{ overflow: 'hidden' }}
        >
          <div
            className={`relative rounded-lg border border-[var(--accent-border)] bg-[var(--accent-muted)] ${
              variant === 'inline'
                ? 'flex items-center justify-between gap-4 px-4 py-2'
                : 'px-4 py-3.5'
            } ${className}`}
          >
            {dismissible && (
              <button
                onClick={handleDismiss}
                className="absolute top-2.5 right-2.5 p-1 rounded-md text-[var(--text-muted)] hover:text-[var(--text-secondary)] hover:bg-[var(--bg-tinted)] transition-colors"
                aria-label="Dismiss"
              >
                <X size={14} />
              </button>
            )}

            {variant === 'inline' ? (
              <>
                <p className="text-xs text-[var(--text-muted)]">{body}</p>
                {action && <div className="flex-shrink-0">{action}</div>}
              </>
            ) : (
              <div className={`flex gap-3 ${dismissible ? 'pr-6' : ''}`}>
                {icon && (
                  <div className="flex-shrink-0 mt-0.5 w-7 h-7 rounded-md bg-[var(--accent-muted)] border border-[var(--accent-border)] flex items-center justify-center text-[var(--accent-light)]">
                    {icon}
                  </div>
                )}
                <div className="min-w-0">
                  {title && (
                    <p className="text-[13px] font-semibold text-[var(--text-primary)] leading-tight">
                      {title}
                    </p>
                  )}
                  <div className={`text-xs text-[var(--text-muted)] leading-relaxed ${title ? 'mt-1.5' : ''}`}>
                    {body}
                  </div>
                  {action && <div className="mt-2">{action}</div>}
                </div>
              </div>
            )}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
