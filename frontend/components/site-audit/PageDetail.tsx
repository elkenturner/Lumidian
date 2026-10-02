'use client';

import { useEffect, useState, useCallback } from 'react';
import { ChevronLeft, ExternalLink } from 'lucide-react';
import { motion } from 'framer-motion';

import {
  siteAudit,
  type WebsiteAuditFindingOut,
  type WebsiteAuditPageOut,
  type WebsiteAuditRecommendationOut,
} from '@/lib/api';
import { scoreToGrade, gradeColor } from '@/lib/grade';
import { staggerContainer, staggerChild } from '@/lib/motion';
import { FixCard } from './FixCard';

type PageDetailData = {
  page: WebsiteAuditPageOut;
  findings: WebsiteAuditFindingOut[];
  recommendations: WebsiteAuditRecommendationOut[];
};

interface Props {
  auditId: number;
  pageId: number;
  onBack: () => void;
}

const SEVERITY_COLOR: Record<string, string> = {
  critical: 'var(--danger)',
  high: 'var(--danger-text)',
  medium: 'var(--warning-text)',
  low: 'var(--text-muted)',
  info: 'var(--text-faint)',
};

export function PageDetail({ auditId, pageId, onBack }: Props) {
  const [data, setData] = useState<PageDetailData | null>(null);

  const load = useCallback(() => {
    siteAudit.pageDetail(auditId, pageId).then(setData);
  }, [auditId, pageId]);

  useEffect(() => {
    load();
  }, [load]);

  if (!data) {
    return (
      <div className="card animate-pulse h-72" style={{ background: 'rgba(255,255,255,0.02)' }} />
    );
  }

  const { page, findings, recommendations } = data;
  const grade = scoreToGrade(page.page_score ?? null);

  return (
    <div>
      <button
        type="button"
        onClick={onBack}
        className="inline-flex items-center gap-1 text-xs text-[var(--text-muted)] hover:text-[var(--text-primary)] mb-4"
      >
        <ChevronLeft size={14} />
        Back to pages
      </button>

      <div className="card-elevated mb-6">
        <p className="text-[10px] uppercase tracking-wider text-[var(--text-muted)]">Page</p>
        <h2 className="text-xl font-semibold text-[var(--text-primary)] mt-1 truncate">
          {page.title || page.url}
        </h2>
        <a
          href={page.url}
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)] mt-1 inline-flex items-center gap-1 font-mono break-all"
        >
          {page.url}
          <ExternalLink size={11} />
        </a>

        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 mt-4">
          <Stat label="Page score" value={page.page_score?.toFixed(0) ?? '—'} color={gradeColor(grade)} accent={grade} />
          <Stat label="Type" value={page.page_type} />
          <Stat label="Words" value={page.word_count?.toLocaleString() ?? '—'} />
          <Stat label="Render" value={page.is_js_rendered ? 'JS (CSR)' : 'SSR'} color={page.is_js_rendered ? 'var(--warning-text)' : undefined} />
          <Stat label="Schemas" value={page.schema_types?.length?.toString() ?? '0'} />
        </div>
      </div>

      <section className="mb-8">
        <div className="flex items-baseline justify-between mb-3">
          <h3 className="text-base font-semibold text-[var(--text-primary)]">
            Findings <span className="text-[var(--text-muted)] tabular-nums">· {findings.length}</span>
          </h3>
        </div>
        {findings.length === 0 ? (
          <p className="text-sm text-[var(--text-muted)]">No findings. This page is clean.</p>
        ) : (
          <ul className="space-y-2">
            {findings.map((f) => (
              <li key={f.id} className="card flex items-start gap-3 text-sm">
                <span
                  className="shrink-0 px-2 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wider"
                  style={{ background: SEVERITY_COLOR[f.severity] ?? 'var(--text-muted)', color: 'var(--bg-base)' }}
                >
                  {f.severity}
                </span>
                <span className="text-[var(--text-secondary)] leading-relaxed">{f.message}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <div className="flex items-baseline justify-between mb-3">
          <h3 className="text-base font-semibold text-[var(--text-primary)]">
            Recommended fixes
            <span className="text-[var(--text-muted)] tabular-nums"> · {recommendations.length}</span>
          </h3>
        </div>
        {recommendations.length === 0 ? (
          <p className="text-sm text-[var(--text-muted)]">No outstanding fixes for this page.</p>
        ) : (
          <motion.div
            variants={staggerContainer}
            initial="hidden"
            animate="visible"
            className="space-y-3"
          >
            {recommendations.map((rec) => (
              <motion.div key={rec.id} variants={staggerChild}>
                <FixCard rec={rec} onStatusChange={load} />
              </motion.div>
            ))}
          </motion.div>
        )}
      </section>
    </div>
  );
}

function Stat({
  label,
  value,
  color,
  accent,
}: {
  label: string;
  value: string;
  color?: string;
  accent?: string;
}) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-wider text-[var(--text-muted)]">{label}</p>
      <p className="text-lg font-semibold mt-0.5 tabular-nums" style={{ color: color ?? 'var(--text-primary)' }}>
        {accent ?? value}
        {accent && (
          <span className="text-xs text-[var(--text-faint)] ml-2 font-normal">{value}/100</span>
        )}
      </p>
    </div>
  );
}
