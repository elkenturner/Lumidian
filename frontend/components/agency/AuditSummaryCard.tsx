'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { ArrowRight, ExternalLink, FileSearch } from 'lucide-react';
import { siteAudit, type WebsiteAuditSummary, type WebsiteAuditRecommendationOut } from '@/lib/api';
import { scoreToGrade, gradeColor } from '@/lib/grade';

interface Props {
  clientId: number;
  brandId: number | null;
}

export function AuditSummaryCard({ clientId, brandId }: Props) {
  const [audit, setAudit] = useState<WebsiteAuditSummary | null>(null);
  const [recs, setRecs] = useState<WebsiteAuditRecommendationOut[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (brandId == null) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const latest = await siteAudit.latest(brandId).catch(() => null);
        if (cancelled) return;
        setAudit(latest);
        if (latest && latest.status === 'completed') {
          const allRecs = await siteAudit.recommendations(latest.id).catch(() => []);
          if (cancelled) return;
          const sorted = [...allRecs].sort((a, b) => (b.priority_score ?? 0) - (a.priority_score ?? 0));
          setRecs(sorted.slice(0, 3));
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to load audit');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [brandId]);

  const auditHref = `/agency/clients/${clientId}/audit`;

  if (brandId == null) {
    return <p className="text-sm text-[var(--text-muted)]">No brand attached to this client.</p>;
  }
  if (loading) return <p className="text-sm text-[var(--text-muted)]">Loading audit…</p>;
  if (error) return <p className="text-sm text-red-400">{error}</p>;

  if (!audit) {
    return (
      <div className="rounded-lg border border-dashed border-[var(--border-subtle)] bg-[var(--bg-card)] p-6 text-sm text-[var(--text-muted)]">
        <div className="flex items-center gap-2 mb-2 text-[var(--text-secondary)]">
          <FileSearch className="h-4 w-4" />
          <span>No site audit yet</span>
        </div>
        <p className="mb-3">
          Run an audit to surface AI-visibility blockers on the client&apos;s site: bot access,
          schema gaps, content density, render mode.
        </p>
        <Link
          href={auditHref}
          className="inline-flex items-center gap-1 text-xs font-medium text-[var(--text-primary)] underline"
        >
          Open audit page <ArrowRight className="h-3 w-3" />
        </Link>
      </div>
    );
  }

  const grade = scoreToGrade(audit.overall_score);
  const color = gradeColor(grade);
  const completed = audit.completed_at
    ? new Date(audit.completed_at).toLocaleDateString()
    : 'in progress';

  return (
    <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-card)] p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="text-xs uppercase tracking-wide text-[var(--text-muted)]">Latest audit</div>
          <div className="mt-1 flex items-baseline gap-3">
            <span className="text-3xl font-semibold" style={{ color }}>
              {grade}
            </span>
            <span className="text-sm text-[var(--text-muted)]">
              {audit.overall_score != null ? `${Math.round(audit.overall_score)}/100` : '—'} · {completed}
            </span>
          </div>
          {audit.render_mode && (
            <div className="mt-1 text-xs text-[var(--text-muted)]">Render mode: {audit.render_mode}</div>
          )}
        </div>
        <Link
          href={auditHref}
          className="flex shrink-0 items-center gap-1 rounded-md border border-[var(--border-default)] bg-[var(--bg-elevated)] px-3 py-1.5 text-xs font-medium text-[var(--text-primary)] hover:bg-[var(--bg-card)]"
        >
          Open full audit <ExternalLink className="h-3 w-3" />
        </Link>
      </div>

      {recs.length > 0 && (
        <div className="mt-4 border-t border-[var(--border-subtle)] pt-4">
          <div className="mb-2 text-xs font-medium text-[var(--text-secondary)]">Top priority fixes</div>
          <ul className="space-y-2">
            {recs.map((r) => (
              <li key={r.id} className="text-sm">
                <span className="mr-2 inline-flex items-center rounded-sm bg-[var(--bg-elevated)] px-1.5 py-0.5 text-xs uppercase tracking-wide text-[var(--text-muted)]">
                  {r.category}
                </span>
                <span className="text-[var(--text-primary)]">{r.title}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {audit.status !== 'completed' && (
        <div className="mt-3 rounded-md bg-amber-500/10 px-3 py-2 text-xs text-amber-300">
          Audit status: {audit.status}
        </div>
      )}
    </div>
  );
}
