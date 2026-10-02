'use client';

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronDown, Layers } from 'lucide-react';

import type { WebsiteAuditRecommendationOut } from '@/lib/api';
import { easings, staggerContainer, staggerChild } from '@/lib/motion';
import { FixCard } from './FixCard';

interface Props {
  /** All recs sharing this title + category. */
  recs: WebsiteAuditRecommendationOut[];
  onStatusChange?: () => void;
}

const PRIORITY_PILL: Record<string, { label: string; bg: string; color: string }> = {
  high: { label: 'High impact', bg: 'var(--danger-text)', color: 'var(--bg-base)' },
  medium: { label: 'Medium impact', bg: 'var(--warning-text)', color: 'var(--bg-base)' },
  low: { label: 'Low impact', bg: 'var(--text-muted)', color: 'var(--bg-base)' },
};

const CATEGORY_LABEL: Record<string, string> = {
  bot_access: 'AI bot access',
  content: 'Content',
  schema: 'Schema',
  technical: 'Technical',
  authority: 'Authority',
};

function urlPath(u: string | null | undefined): string {
  if (!u) return '—';
  try {
    return new URL(u).pathname || '/';
  } catch {
    return u;
  }
}

// Artifact types that apply globally (one paste covers the entire site).
const SITE_WIDE_ARTIFACTS = new Set([
  'jsonld_org',
  'llms_txt',
  'robots_snippet',
  'agents_md',
]);

function isSiteWide(artifactType: string | null | undefined): boolean {
  return !!artifactType && SITE_WIDE_ARTIFACTS.has(artifactType);
}

/**
 * Renders ONE card when a rec group has just one member (drop-through to FixCard).
 * Renders a "this fix applies to N pages" container with a disclosure listing each
 * page as its own FixCard otherwise.
 */
export function FixGroup({ recs, onStatusChange }: Props) {
  const [open, setOpen] = useState(false);

  if (recs.length === 1) {
    return <FixCard rec={recs[0]} onStatusChange={onStatusChange} />;
  }

  const lead = recs[0];
  const pill = PRIORITY_PILL[lead.priority] ?? PRIORITY_PILL.low;
  // Diminishing-returns lift: fixing the same category problem on 50 pages
  // is not 50× the single-page lift. Use ln(n+1) to flatten the curve so the
  // total ranks groups sensibly without inflating to absurd numbers.
  const perPageLift = recs[0]?.expected_lift_pp ?? 0;
  const totalLift = perPageLift * Math.log(recs.length + 1);
  const draftedCount = recs.filter((r) => r.artifact).length;
  const appliedCount = recs.filter((r) => r.status === 'applied').length;

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ layout: { type: 'spring', stiffness: 220, damping: 26 } }}
      className="card card-hover"
    >
      <div className="flex items-center justify-between mb-3">
        <span
          className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wider"
          style={{ background: pill.bg, color: pill.color }}
        >
          {pill.label}
        </span>
        <span className="text-[11px] text-[var(--text-muted)] inline-flex items-center gap-1.5">
          <Layers size={11} />
          {CATEGORY_LABEL[lead.category] ?? lead.category}
        </span>
      </div>

      <h3 className="text-base font-semibold text-[var(--text-primary)] leading-snug">
        {lead.title}
      </h3>

      <div className="mt-3">
        <p className="text-[10px] uppercase tracking-wider text-[var(--text-muted)] mb-1.5">
          The problem
        </p>
        <p className="text-sm text-[var(--text-secondary)] leading-relaxed whitespace-pre-line">
          {lead.body}
        </p>
      </div>

      <div
        className="mt-3 rounded-md p-3 text-xs flex items-center justify-between gap-3"
        style={{ background: 'var(--bg-base)', border: '1px solid var(--border-subtle)' }}
      >
        <div className="min-w-0">
          <p className="text-[10px] uppercase tracking-wider text-[var(--text-muted)] mb-0.5">
            {isSiteWide(lead.artifact_type) ? 'Site-wide' : `Affects ${recs.length} ${recs.length === 1 ? 'page' : 'pages'}`}
          </p>
          {lead.target_url ? (
            <p className="text-[var(--text-secondary)] truncate">
              e.g. <span className="font-mono text-[var(--text-primary)]">{urlPath(lead.target_url)}</span>
              {recs.length > 1 && <span> + {recs.length - 1} more</span>}
            </p>
          ) : isSiteWide(lead.artifact_type) ? (
            <p className="text-[var(--text-secondary)]">
              Applies globally. Add once to your site-wide template.
            </p>
          ) : (
            <p className="text-[var(--text-faint)] italic">
              Per-page URLs unavailable on this audit. Re-run to refresh.
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="inline-flex items-center gap-1 px-2.5 py-1 rounded text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)] shrink-0"
          style={{ border: '1px solid var(--border-default)' }}
        >
          <ChevronDown
            size={12}
            style={{ transform: open ? 'rotate(0deg)' : 'rotate(-90deg)', transition: 'transform 150ms' }}
          />
          {open ? 'Hide pages' : 'Show pages'}
        </button>
      </div>

      <div className="mt-3 flex items-center gap-4 text-xs text-[var(--text-faint)]">
        <span className="tabular-nums">+{totalLift.toFixed(0)} pts total expected</span>
        {draftedCount > 0 && (
          <span style={{ color: 'var(--accent-light)' }}>
            · {draftedCount} drafted
          </span>
        )}
        {appliedCount > 0 && (
          <span style={{ color: 'var(--success-text)' }}>
            · {appliedCount} applied
          </span>
        )}
      </div>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.22, ease: easings.out }}
            className="overflow-hidden"
          >
            <div
              className="mt-4 pt-4 space-y-3"
              style={{ borderTop: '1px solid var(--border-subtle)' }}
            >
              <motion.div
                variants={staggerContainer}
                initial="hidden"
                animate="visible"
                className="space-y-3"
              >
                {recs.map((r) => (
                  <motion.div key={r.id} variants={staggerChild}>
                    <FixCard rec={r} onStatusChange={onStatusChange} compact />
                  </motion.div>
                ))}
              </motion.div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
