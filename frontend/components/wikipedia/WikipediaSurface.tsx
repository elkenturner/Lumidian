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
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const data = await listWikipediaCandidates(brandId);
      setCandidates(data);
      setLoadError(null);
    } catch (e: unknown) {
      // A 402 (tier gate) or 429 (scan cap) rendered as "no candidates" — show
      // the real reason instead of implying the scan found nothing.
      const status = (e as { response?: { status?: number } })?.response?.status;
      if (status === 402) setLoadError("Wikipedia opportunities are available on the Growth and Pro plans.");
      else if (status === 429) setLoadError("You've reached your scan limit for this period.");
      else setLoadError("Couldn't load Wikipedia candidates. Please try again.");
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
    <div className="px-4 sm:px-8 py-6 sm:py-8 max-w-[1400px] space-y-6">
      {/* Header */}
      <header className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="text-[11px] uppercase tracking-wider text-[var(--text-faint)] font-semibold mb-1.5">
            Wikipedia
          </div>
          <h1 className="text-2xl font-bold text-[var(--text-primary)] leading-tight">
            Citation opportunities
          </h1>
          <p className="mt-1.5 max-w-2xl text-sm text-[var(--text-secondary)]">
            Existing articles where your brand can be cited authoritatively. We surface candidates
            and draft the edit. You decide what gets submitted.
          </p>
        </div>
        <div className="shrink-0">
          <ScanButton brandId={brandId} onScanCompleted={refresh} />
        </div>
      </header>

      {/* Filter toolbar */}
      <div className="flex flex-wrap items-center gap-3 text-xs">
        <div className="flex flex-wrap items-center gap-1.5 text-[var(--text-faint)]">
          <span>Filter:</span>
          {FILTERS.map((f) => {
            const active = filter === f.key;
            const count = counts[f.key] ?? 0;
            return (
              <button
                key={f.key}
                type="button"
                onClick={() => setFilter(f.key)}
                className={`px-2 py-1 rounded ${
                  active
                    ? 'bg-[var(--bg-card)] text-[var(--text-primary)] font-medium'
                    : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                }`}
              >
                {f.label}
                <span className="ml-1.5 tabular-nums text-[var(--text-faint)]">{count}</span>
              </button>
            );
          })}
        </div>
        <label className="ml-auto flex cursor-pointer select-none items-center gap-2 text-[var(--text-muted)] hover:text-[var(--text-secondary)] transition-colors">
          <input
            type="checkbox"
            checked={showDismissed}
            onChange={(e) => setShowDismissed(e.target.checked)}
            className="h-3.5 w-3.5 cursor-pointer accent-[var(--accent)]"
          />
          Show dismissed
          <span className="tabular-nums text-[var(--text-faint)]">{counts.dismissed}</span>
        </label>
      </div>

      {/* Grid */}
      {loading ? (
        <SkeletonGrid />
      ) : loadError ? (
        <div className="card border-dashed text-sm text-[var(--text-secondary)] text-center py-10">
          {loadError}
        </div>
      ) : visible.length === 0 ? (
        <EmptyState hasCandidates={candidates.length > 0} />
      ) : (
        <motion.div
          variants={staggerContainer}
          initial="hidden"
          animate="visible"
          className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3"
        >
          {visible.map((c) => {
            const expanded = expandedId === c.id;
            return (
              <motion.div
                key={c.id}
                variants={staggerChild}
                className={expanded ? 'sm:col-span-2 lg:col-span-3' : ''}
              >
                <CandidateCard
                  brandId={brandId}
                  candidate={c}
                  expanded={expanded}
                  onToggleExpand={(open) => setExpandedId(open ? c.id : null)}
                  onUpdated={onCandidateUpdated}
                />
              </motion.div>
            );
          })}
        </motion.div>
      )}
    </div>
  );
}

function SkeletonGrid() {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {[0, 1, 2, 3, 4, 5].map((i) => (
        <div key={i} className="card space-y-3">
          <div className="h-4 w-2/3 rounded skeleton" />
          <div className="h-3 w-1/3 rounded skeleton" />
          <div className="h-3 w-full rounded skeleton" />
          <div className="h-3 w-5/6 rounded skeleton" />
          <div className="h-5 w-20 rounded skeleton" />
        </div>
      ))}
    </div>
  );
}

function EmptyState({ hasCandidates }: { hasCandidates: boolean }) {
  return (
    <div className="card-elevated flex flex-col items-center justify-center py-16 text-center">
      <div className="text-[11px] uppercase tracking-wider text-[var(--text-faint)] font-semibold">
        {hasCandidates ? 'No results' : 'Awaiting first scan'}
      </div>
      <p className="mt-2 max-w-md text-sm leading-relaxed text-[var(--text-secondary)]">
        {hasCandidates
          ? 'No candidates match this filter. Try a different status or run another scan.'
          : 'Run a scan to find articles where your brand belongs in the citation list.'}
      </p>
    </div>
  );
}
