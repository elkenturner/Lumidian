'use client';

import { useEffect, useState } from 'react';
import { format } from 'date-fns';
import { ArrowUp, ArrowDown, Minus } from 'lucide-react';
import { siteAudit, type WebsiteAuditSummary } from '@/lib/api';
import { scoreToGrade, gradeColor } from '@/lib/grade';

interface Props {
  brandId: number;
}

export function AuditHistoryList({ brandId }: Props) {
  const [audits, setAudits] = useState<WebsiteAuditSummary[] | null>(null);
  useEffect(() => {
    siteAudit.history(brandId, 20).then(setAudits);
  }, [brandId]);

  if (!audits) {
    return <div className="card h-32 animate-pulse" style={{ background: 'rgba(255,255,255,0.02)' }} />;
  }
  if (audits.length === 0) {
    return null;
  }

  return (
    <div className="card">
      <h3 className="text-base font-semibold text-[var(--text-primary)] mb-3">Audit history</h3>
      <ol className="divide-y divide-[var(--border-subtle)]">
        {audits.map((a, i) => {
          const prev = audits[i + 1];
          const delta =
            a.overall_score != null && prev?.overall_score != null
              ? a.overall_score - prev.overall_score
              : null;
          const grade = scoreToGrade(a.overall_score);
          return (
            <li key={a.id} className="py-2.5 grid grid-cols-[100px_1fr_60px_60px_44px] gap-3 items-center text-sm">
              <span className="text-xs text-[var(--text-secondary)] tabular-nums">
                {format(new Date(a.started_at), 'MMM d, h:mm a')}
              </span>
              <span className="text-xs text-[var(--text-muted)] capitalize">{a.status}</span>
              <span className="text-xs text-[var(--text-secondary)] tabular-nums text-right">
                {a.total_pages ?? '—'} pp
              </span>
              <span className="text-xs tabular-nums text-right" style={{ color: gradeColor(grade) }}>
                {grade}
                <span className="text-[var(--text-faint)] ml-1 text-[10px]">
                  {a.overall_score?.toFixed(0) ?? '—'}
                </span>
              </span>
              <span
                className="text-xs tabular-nums flex items-center gap-0.5 justify-end"
                style={{
                  color:
                    delta == null
                      ? 'var(--text-faint)'
                      : delta > 0
                        ? 'var(--success-text)'
                        : delta < 0
                          ? 'var(--danger-text)'
                          : 'var(--text-muted)',
                }}
              >
                {delta == null ? '—' : delta > 0 ? (
                  <><ArrowUp size={10} />+{delta.toFixed(0)}</>
                ) : delta < 0 ? (
                  <><ArrowDown size={10} />{delta.toFixed(0)}</>
                ) : (
                  <Minus size={10} />
                )}
              </span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
