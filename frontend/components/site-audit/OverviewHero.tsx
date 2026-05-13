'use client';

import { useEffect, useState, useCallback } from 'react';
import { motion } from 'framer-motion';
import { ArrowRight, Sparkles } from 'lucide-react';
import { siteAudit, type WebsiteAuditRecommendationOut } from '@/lib/api';
import { staggerContainer, staggerChild } from '@/lib/motion';
import { FixCard } from './FixCard';

interface Props {
  auditId: number;
  onSeeAll: () => void;
}

/**
 * Top-5 ranked pending fixes for this audit, presented as the hero of the page.
 * Re-ranks when a card is marked applied / dismissed.
 */
export function OverviewHero({ auditId, onSeeAll }: Props) {
  const [recs, setRecs] = useState<WebsiteAuditRecommendationOut[] | null>(null);
  const [allCount, setAllCount] = useState<number>(0);

  const load = useCallback(async () => {
    const all = await siteAudit.recommendations(auditId);
    setAllCount(all.length);
    const pending = all
      .filter((r) => (r.status ?? 'pending') === 'pending')
      .sort((a, b) => (b.priority_score ?? 0) - (a.priority_score ?? 0))
      .slice(0, 5);
    setRecs(pending);
  }, [auditId]);

  useEffect(() => {
    load();
  }, [load]);

  if (recs === null) {
    return (
      <div className="space-y-3">
        {[0, 1, 2, 3, 4].map((i) => (
          <div
            key={i}
            className="card h-32 animate-pulse"
            style={{ background: 'rgba(255,255,255,0.02)' }}
          />
        ))}
      </div>
    );
  }

  if (recs.length === 0) {
    return (
      <div
        className="card-elevated text-center py-10"
        style={{ background: 'rgba(34, 197, 94, 0.05)', borderColor: 'var(--success)' }}
      >
        <Sparkles
          size={28}
          className="mx-auto mb-3"
          style={{ color: 'var(--success-text)' }}
        />
        <p className="text-lg font-semibold" style={{ color: 'var(--success-text)' }}>
          No pending fixes
        </p>
        <p className="text-sm text-[var(--text-secondary)] mt-1">
          Every recommendation has been applied or dismissed. Run a new audit to surface new ones.
        </p>
      </div>
    );
  }

  return (
    <section>
      <div className="flex items-baseline justify-between mb-4">
        <h2 className="text-lg font-semibold text-[var(--text-primary)]">
          Next {recs.length} fix{recs.length === 1 ? '' : 'es'}
        </h2>
        {allCount > recs.length && (
          <button
            type="button"
            onClick={onSeeAll}
            className="inline-flex items-center gap-1 text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
          >
            See all {allCount}
            <ArrowRight size={12} />
          </button>
        )}
      </div>

      <motion.div
        variants={staggerContainer}
        initial="hidden"
        animate="visible"
        className="space-y-3"
      >
        {recs.map((rec) => (
          <motion.div key={rec.id} variants={staggerChild}>
            <FixCard
              rec={rec}
              implSteps={[]} // populated via /pageDetail when card expands; for hero we keep tight
              onStatusChange={() => load()}
              compact
            />
          </motion.div>
        ))}
      </motion.div>
    </section>
  );
}
