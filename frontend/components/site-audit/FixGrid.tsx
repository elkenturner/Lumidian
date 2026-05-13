'use client';

import { useEffect, useMemo, useState, useCallback } from 'react';
import { motion } from 'framer-motion';
import { siteAudit, type WebsiteAuditRecommendationOut } from '@/lib/api';
import { staggerContainer, staggerChild } from '@/lib/motion';
import { FixGroup } from './FixGroup';
import { FixFilters, type FixFilterState } from './FixFilters';

interface Props {
  auditId: number;
}

export function FixGrid({ auditId }: Props) {
  const [all, setAll] = useState<WebsiteAuditRecommendationOut[] | null>(null);
  const [filters, setFilters] = useState<FixFilterState>({
    category: null,
    priority: null,
    status: 'pending',
    query: '',
    quickWins: false,
  });

  const load = useCallback(async () => {
    const recs = await siteAudit.recommendations(auditId);
    setAll(recs);
  }, [auditId]);

  useEffect(() => {
    load();
  }, [load]);

  const counts = useMemo(() => {
    if (!all) return { total: 0, pending: 0, applied: 0, dismissed: 0 };
    return {
      total: all.length,
      pending: all.filter((r) => (r.status ?? 'pending') === 'pending').length,
      applied: all.filter((r) => r.status === 'applied').length,
      dismissed: all.filter((r) => r.status === 'dismissed').length,
    };
  }, [all]);

  const filtered = useMemo(() => {
    if (!all) return null;
    const q = filters.query.trim().toLowerCase();
    return all
      .filter((r) =>
        filters.status === 'all'
          ? true
          : (r.status ?? 'pending') === filters.status
      )
      .filter((r) => (filters.category ? r.category === filters.category : true))
      .filter((r) => (filters.priority ? r.priority === filters.priority : true))
      .filter((r) =>
        filters.quickWins
          ? (r.priority === 'high' || (r.expected_lift_pp ?? 0) >= 10) && r.effort === 'low'
          : true,
      )
      .filter((r) =>
        q
          ? r.title.toLowerCase().includes(q) || r.body.toLowerCase().includes(q)
          : true,
      )
      .sort((a, b) => (b.priority_score ?? 0) - (a.priority_score ?? 0));
  }, [all, filters]);

  if (!all) {
    return (
      <div className="space-y-3">
        {[0, 1, 2].map((i) => (
          <div
            key={i}
            className="card h-28 animate-pulse"
            style={{ background: 'rgba(255,255,255,0.02)' }}
          />
        ))}
      </div>
    );
  }

  return (
    <>
      <FixFilters state={filters} onChange={setFilters} counts={counts} />
      {filtered && filtered.length === 0 ? (
        <p className="text-center text-sm text-[var(--text-muted)] py-12">
          No fixes match these filters.
        </p>
      ) : (
        (() => {
          // Group by (title + category) so 89 "Add JSON-LD schema" recs collapse into one card
          // with a "show pages" disclosure. Site-wide recs (one per title) drop through as solo cards.
          const groups = new Map<string, WebsiteAuditRecommendationOut[]>();
          for (const r of filtered ?? []) {
            const key = `${r.title}::${r.category}`;
            const arr = groups.get(key) ?? [];
            arr.push(r);
            groups.set(key, arr);
          }
          const ordered = Array.from(groups.values()).sort(
            (a, b) =>
              Math.max(...b.map((x) => x.priority_score ?? 0))
              - Math.max(...a.map((x) => x.priority_score ?? 0)),
          );
          return (
            <motion.div
              variants={staggerContainer}
              initial="hidden"
              animate="visible"
              className="space-y-3"
            >
              {ordered.map((recs, i) => (
                <motion.div key={i} variants={staggerChild}>
                  <FixGroup recs={recs} onStatusChange={() => load()} />
                </motion.div>
              ))}
            </motion.div>
          );
        })()
      )}
    </>
  );
}
