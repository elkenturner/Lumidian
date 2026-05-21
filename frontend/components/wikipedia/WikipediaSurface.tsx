'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { staggerContainer, staggerChild } from '@/lib/motion';
import { listWikipediaCandidates, type WikipediaCandidate } from '@/lib/api';
import { CandidateCard } from './CandidateCard';
import { ScanButton } from './ScanButton';

interface Props {
  brandId: number;
}

type Filter = 'all' | WikipediaCandidate['status'];

const FILTERS: { key: Filter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'new', label: 'New' },
  { key: 'drafted', label: 'Drafted' },
  { key: 'submitted', label: 'Submitted' },
  { key: 'accepted', label: 'Accepted' },
  { key: 'reverted', label: 'Reverted' },
];

export function WikipediaSurface({ brandId }: Props) {
  const [candidates, setCandidates] = useState<WikipediaCandidate[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<Filter>('all');
  const [showDismissed, setShowDismissed] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const data = await listWikipediaCandidates(brandId);
      setCandidates(data);
    } finally {
      setLoading(false);
    }
  }, [brandId]);

  useEffect(() => {
    if (brandId) refresh();
  }, [brandId, refresh]);

  function onCandidateUpdated(updated: WikipediaCandidate) {
    setCandidates((prev) => prev.map((c) => (c.id === updated.id ? updated : c)));
  }

  const counts = useMemo(() => {
    const c: Record<Filter, number> = {
      all: 0, new: 0, drafted: 0, submitted: 0, accepted: 0, reverted: 0, dismissed: 0,
    };
    for (const cand of candidates) {
      c.all += 1;
      c[cand.status] = (c[cand.status] ?? 0) + 1;
    }
    return c;
  }, [candidates]);

  const visible = candidates.filter((c) => {
    if (c.status === 'dismissed' && !showDismissed) return false;
    if (filter !== 'all' && c.status !== filter) return false;
    return true;
  });

  return (
    <div className="mx-auto max-w-4xl px-6 pt-14 pb-24">
      {/* Editorial masthead */}
      <header className="mb-10">
        <div className="flex items-start justify-between gap-8">
          <div className="min-w-0 flex-1">
            <div
              className="text-[10.5px] font-medium uppercase tracking-[0.22em] text-[var(--text-faint)]"
              style={{ fontFamily: 'var(--font-geist-mono)' }}
            >
              Wikipedia
            </div>
            <h1 className="mt-3 text-[2.25rem] leading-[1.05] font-semibold tracking-[-0.025em] text-[var(--text-primary)]">
              Citation opportunities
            </h1>
            <p className="mt-4 max-w-[58ch] text-[15px] leading-[1.6] text-[var(--text-muted)]">
              Existing articles where your brand can be cited authoritatively. We surface
              candidates and draft the edit — you decide what gets submitted.
            </p>
          </div>
          <div className="shrink-0 pt-1">
            <ScanButton brandId={brandId} onScanCompleted={refresh} />
          </div>
        </div>
      </header>

      {/* Filter strip */}
      <div className="mb-6 flex flex-wrap items-baseline gap-x-5 gap-y-2 border-y border-[var(--border-subtle)] py-3">
        {FILTERS.map((f) => {
          const active = filter === f.key;
          const count = counts[f.key] ?? 0;
          return (
            <button
              key={f.key}
              onClick={() => setFilter(f.key)}
              className={`cursor-pointer text-[13px] tracking-tight transition-colors ${
                active
                  ? 'text-[var(--text-primary)] font-medium'
                  : 'text-[var(--text-muted)] hover:text-[var(--text-secondary)]'
              }`}
            >
              {f.label}
              <span
                className={`ml-1.5 text-[11px] tabular-nums ${
                  active ? 'text-[var(--accent-foreground)]' : 'text-[var(--text-faint)]'
                }`}
                style={{ fontFamily: 'var(--font-geist-mono)' }}
              >
                {count}
              </span>
            </button>
          );
        })}
        <label className="ml-auto flex cursor-pointer select-none items-center gap-2 text-[13px] text-[var(--text-muted)] hover:text-[var(--text-secondary)] transition-colors">
          <input
            type="checkbox"
            checked={showDismissed}
            onChange={(e) => setShowDismissed(e.target.checked)}
            className="h-3.5 w-3.5 cursor-pointer accent-[var(--accent)]"
          />
          Dismissed
          <span
            className="text-[11px] tabular-nums text-[var(--text-faint)]"
            style={{ fontFamily: 'var(--font-geist-mono)' }}
          >
            {counts.dismissed}
          </span>
        </label>
      </div>

      {/* Index */}
      {loading ? (
        <SkeletonIndex />
      ) : visible.length === 0 ? (
        <EmptyState hasCandidates={candidates.length > 0} />
      ) : (
        <motion.ol
          variants={staggerContainer}
          initial="hidden"
          animate="visible"
          className="-mx-1"
        >
          {visible.map((c, i) => (
            <motion.li
              key={c.id}
              variants={staggerChild}
              className="border-t border-[var(--border-subtle)] first:border-t-0"
            >
              <CandidateCard
                index={i + 1}
                brandId={brandId}
                candidate={c}
                onUpdated={onCandidateUpdated}
              />
            </motion.li>
          ))}
        </motion.ol>
      )}
    </div>
  );
}

function SkeletonIndex() {
  return (
    <div className="space-y-px">
      {[0, 1, 2].map((i) => (
        <div
          key={i}
          className="flex gap-6 border-t border-[var(--border-subtle)] py-7 first:border-t-0"
        >
          <div className="h-3 w-6 rounded skeleton" />
          <div className="flex-1 space-y-3">
            <div className="h-4 w-2/3 rounded skeleton" />
            <div className="h-3 w-1/3 rounded skeleton" />
            <div className="h-3 w-full rounded skeleton" />
            <div className="h-3 w-5/6 rounded skeleton" />
          </div>
        </div>
      ))}
    </div>
  );
}

function EmptyState({ hasCandidates }: { hasCandidates: boolean }) {
  return (
    <div className="border-t border-[var(--border-subtle)] py-20">
      <div className="max-w-[42ch]">
        <div
          className="text-[10.5px] font-medium uppercase tracking-[0.22em] text-[var(--text-faint)]"
          style={{ fontFamily: 'var(--font-geist-mono)' }}
        >
          {hasCandidates ? 'No results' : 'Awaiting first scan'}
        </div>
        <p className="mt-3 text-[17px] leading-[1.5] text-[var(--text-secondary)]">
          {hasCandidates
            ? 'No candidates match this filter. Try a different status or run another scan.'
            : 'Run a scan to find articles where your brand belongs in the citation list.'}
        </p>
      </div>
    </div>
  );
}
