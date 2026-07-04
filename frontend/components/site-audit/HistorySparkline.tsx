'use client';

import { useEffect, useState } from 'react';
import { LineChart, Line, ResponsiveContainer, YAxis } from 'recharts';
import { siteAudit, type WebsiteAuditSummary } from '@/lib/api';
import { scoreToGrade, gradeColor } from '@/lib/grade';

interface Props {
  brandId: number;
}

export function HistorySparkline({ brandId }: Props) {
  const [audits, setAudits] = useState<WebsiteAuditSummary[] | null>(null);

  useEffect(() => {
    siteAudit.history(brandId, 6).then(setAudits).catch(() => setAudits([]));
  }, [brandId]);

  if (audits === null) {
    return <div className="card h-20 animate-pulse bg-[rgba(255,255,255,0.02)]" />;
  }
  if (audits.length < 2) return null;

  const ordered = [...audits].reverse();
  const data = ordered.map((a, i) => ({
    i,
    score: a.overall_score ?? 0,
  }));

  const latest = ordered[ordered.length - 1].overall_score ?? 0;
  const previous = ordered[ordered.length - 2].overall_score ?? 0;
  const delta = latest - previous;
  const grade = scoreToGrade(latest);

  return (
    <div className="card flex items-center gap-4">
      <div className="shrink-0">
        <p className="text-[10px] uppercase tracking-wider text-[var(--text-muted)]">
          Trend
        </p>
        <p className="text-2xl font-bold tabular-nums mt-1" style={{ color: gradeColor(grade) }}>
          {latest.toFixed(0)}
        </p>
        <p
          className="text-xs tabular-nums mt-0.5"
          style={{ color: delta === 0 ? 'var(--text-faint)' : delta > 0 ? 'var(--success-text)' : 'var(--danger-text)' }}
        >
          {delta === 0
            ? 'No change vs last audit'
            : `${delta > 0 ? '+' : ''}${delta.toFixed(1)} pts vs last audit`}
        </p>
      </div>
      <div className="flex-1 h-12">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data}>
            <YAxis domain={['dataMin - 5', 'dataMax + 5']} hide />
            <Line
              dataKey="score"
              type="monotone"
              stroke={gradeColor(grade)}
              strokeWidth={2}
              dot={{ r: 2, fill: gradeColor(grade) }}
              isAnimationActive
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <div className="shrink-0 text-right">
        <p className="text-[10px] uppercase tracking-wider text-[var(--text-muted)]">
          History
        </p>
        <p className="text-xs text-[var(--text-secondary)] mt-1 tabular-nums">
          {audits.length} audit{audits.length === 1 ? '' : 's'}
        </p>
      </div>
    </div>
  );
}
