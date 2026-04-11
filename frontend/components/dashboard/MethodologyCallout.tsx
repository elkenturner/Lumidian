'use client';

import { useState, useEffect } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { X, Lightbulb } from 'lucide-react';
import Link from 'next/link';
import { easings } from '@/lib/motion';

const STORAGE_KEY = 'lumidian_methodology_dismissed';

interface MethodologyCalloutProps {
  visible: boolean;
}

export default function MethodologyCallout({ visible }: MethodologyCalloutProps) {
  const [dismissed, setDismissed] = useState(true); // default hidden until we check

  useEffect(() => {
    setDismissed(localStorage.getItem(STORAGE_KEY) === '1');
  }, []);

  const handleDismiss = () => {
    localStorage.setItem(STORAGE_KEY, '1');
    setDismissed(true);
  };

  const show = visible && !dismissed;

  return (
    <AnimatePresence>
      {show && (
        <motion.div
          key="methodology-callout"
          initial={{ opacity: 0, height: 0, marginBottom: 0 }}
          animate={{
            opacity: 1,
            height: 'auto',
            marginBottom: 16,
            transition: { duration: 0.35, ease: easings.out },
          }}
          exit={{
            opacity: 0,
            height: 0,
            marginBottom: 0,
            transition: { duration: 0.2, ease: easings.out },
          }}
          style={{ overflow: 'hidden' }}
        >
          <div
            className="relative px-4 py-3.5 rounded-lg border border-[var(--accent-border)] bg-[var(--accent-muted)]"
          >
            {/* Dismiss button */}
            <button
              onClick={handleDismiss}
              className="absolute top-2.5 right-2.5 p-1 rounded-md text-[var(--text-muted)] hover:text-[var(--text-secondary)] hover:bg-[rgba(255,255,255,0.05)] transition-colors"
              aria-label="Dismiss"
            >
              <X size={14} />
            </button>

            <div className="flex gap-3 pr-6">
              {/* Icon */}
              <div className="flex-shrink-0 mt-0.5 w-7 h-7 rounded-md bg-[var(--accent-muted)] border border-[var(--accent-border)] flex items-center justify-center">
                <Lightbulb size={14} className="text-[var(--accent-light)]" />
              </div>

              {/* Content */}
              <div className="min-w-0">
                <p className="text-[13px] font-semibold text-[var(--text-primary)] leading-tight">
                  Understanding Your Visibility Score
                </p>
                <p className="text-xs text-[var(--text-muted)] leading-relaxed mt-1.5">
                  Your score combines two types of AI visibility:{' '}
                  <span className="text-[var(--text-secondary)] font-medium">Live Search</span>{' '}
                  measures how often your brand appears in real-time AI search results (Perplexity, Gemini).{' '}
                  <span className="text-[var(--text-secondary)] font-medium">AI Index</span>{' '}
                  measures whether your brand is embedded in AI training data (ChatGPT, Claude).
                  Both matter — check the breakdown below your score.
                </p>
                <Link
                  href="/methodology"
                  className="inline-block text-xs text-[var(--accent-light)] hover:text-[var(--text-primary)] font-medium mt-2 transition-colors"
                >
                  Learn more &rsaquo;
                </Link>
              </div>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
