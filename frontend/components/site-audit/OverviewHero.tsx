'use client';

import { useEffect, useState, useCallback } from 'react';
import { motion } from 'framer-motion';
import { ArrowRight, Sparkles } from 'lucide-react';
import { siteAudit, type WebsiteAuditRecommendationOut } from '@/lib/api';
import { staggerContainer, staggerChild } from '@/lib/motion';
import { FixGroup } from './FixGroup';

interface Props {
  auditId: number;
  onSeeAll: () => void;
}

/**
 * Top-5 ranked pending fixes for this audit, presented as the hero of the page.
 * Groups by (title + category) so 3× "Add Organization JSON-LD" appears as ONE
 * card with "Affects 3 pages", not three duplicate cards.
 */
export function OverviewHero({ auditId, onSeeAll }: Props) {
  const [groups, setGroups] = useState<WebsiteAuditRecommendationOut[][] | null>(null);
  const [allCount, setAllCount] = useState<number>(0);

  const load = useCallback(async () => {
    const all = await siteAudit.recommendations(auditId);
    const pending = all.filter((r) => (r.status ?? 'pending') === 'pending');
    // Group by (title + category), then take top 5 groups by max priority_score.
    const byKey = new Map<string, WebsiteAuditRecommendationOut[]>();
    for (const r of pending) {
      const key = `${r.title}::${r.category}`;
      const arr = byKey.get(key) ?? [];
      arr.push(r);
      byKey.set(key, arr);
    }
    const ordered = Array.from(byKey.values()).sort(
      (a, b) =>
        Math.max(...b.map((x) => x.priority_score ?? 0))
        - Math.max(...a.map((x) => x.priority_score ?? 0)),
    );
    // "See all N" must count the same population the hero shows — pending
    // fix groups — not every raw recommendation row incl. applied/dismissed.
    setAllCount(ordered.length);
    setGroups(ordered.slice(0, 5));
  }, [auditId]);

  useEffect(() => {
    load();
  }, [load]);

  if (groups === null) {
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

  if (groups.length === 0) {
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
          Next {groups.length} fix{groups.length === 1 ? '' : 'es'}
        </h2>
        {allCount > groups.length && (
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
        {groups.map((groupRecs, i) => (
          <motion.div key={i} variants={staggerChild}>
            <FixGroup recs={groupRecs} onStatusChange={() => load()} />
          </motion.div>
        ))}
      </motion.div>
    </section>
  );
}
