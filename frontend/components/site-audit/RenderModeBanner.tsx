'use client';

import { motion } from 'framer-motion';
import { AlertTriangle } from 'lucide-react';
import { easings } from '@/lib/motion';

interface Props {
  isJsRendered: boolean;
  brandUrl: string | null;
}

export function RenderModeBanner({ isJsRendered, brandUrl }: Props) {
  if (!isJsRendered) return null;
  return (
    <motion.div
      initial={{ opacity: 0, y: -6 }}
      animate={{
        opacity: 1,
        y: 0,
        boxShadow: [
          '0 0 0 0 rgba(245, 158, 11, 0)',
          '0 0 0 6px rgba(245, 158, 11, 0.15)',
          '0 0 0 0 rgba(245, 158, 11, 0)',
        ],
      }}
      transition={{
        opacity: { duration: 0.3, ease: easings.out },
        y: { duration: 0.3, ease: easings.out },
        boxShadow: { duration: 1.2, ease: easings.out, times: [0, 0.5, 1] },
      }}
      className="mb-6 rounded-lg p-4 flex items-start gap-3"
      style={{
        background: 'rgba(245, 158, 11, 0.08)',
        border: '1px solid var(--warning)',
      }}
    >
      <AlertTriangle size={18} className="shrink-0 mt-0.5" style={{ color: 'var(--warning-text)' }} />
      <div className="flex-1 text-sm">
        <p className="font-semibold" style={{ color: 'var(--warning-text)' }}>
          Your homepage is JavaScript-rendered
        </p>
        <p className="text-[var(--text-secondary)] mt-1 leading-relaxed">
          AI crawlers (GPTBot, ClaudeBot, PerplexityBot, OAI-SearchBot){' '}
          <strong>do not execute JavaScript</strong>. Vercel's 1B-fetch study found zero JS
          execution. Anything that only appears after JS runs is invisible to all four major
          LLMs, including the four scores you see below.
        </p>
        {brandUrl && (
          <p className="text-xs text-[var(--text-muted)] mt-2 tabular-nums">
            Test it yourself:{' '}
            <code className="font-mono px-1 py-0.5 rounded bg-[var(--bg-base)]">
              curl -s {new URL(brandUrl).host}
            </code>{' '}
            and check whether your main content is in the raw HTML.
          </p>
        )}
      </div>
    </motion.div>
  );
}
