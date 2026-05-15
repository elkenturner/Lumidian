'use client';

import { useState } from 'react';
import { motion } from 'framer-motion';
import { formatDistanceToNow } from 'date-fns';
import { Play, Loader2, Download } from 'lucide-react';
import { scoreToGrade, gradeColor } from '@/lib/grade';
import { siteAudit, type WebsiteAuditSummary } from '@/lib/api';

interface Props {
  audit: WebsiteAuditSummary;
  brandUrl: string | null;
  inFlight: boolean;
  onRunNewAudit: () => void;
}

export function AuditHeader({ audit, brandUrl, inFlight, onRunNewAudit }: Props) {
  const grade = scoreToGrade(audit.overall_score);
  const [pdfBusy, setPdfBusy] = useState(false);
  const [pdfError, setPdfError] = useState<string | null>(null);

  const handleDownloadPdf = async () => {
    setPdfBusy(true);
    setPdfError(null);
    try {
      const blob = await siteAudit.downloadPdf(audit.id);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const safeLabel = (brandUrl ? new URL(brandUrl).host : `audit-${audit.id}`)
        .replace(/[^a-zA-Z0-9_-]+/g, '-');
      a.download = `${safeLabel}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      setPdfError(e instanceof Error ? e.message : 'Failed to download PDF');
    } finally {
      setPdfBusy(false);
    }
  };

  return (
    <header className="card-elevated flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
      <div className="min-w-0">
        <p className="text-[11px] uppercase tracking-wider text-[var(--text-muted)]">
          Site Audit
        </p>
        <h1 className="text-xl font-semibold text-[var(--text-primary)] mt-1 truncate">
          {brandUrl ? (
            new URL(brandUrl).host
          ) : (
            <span className="inline-block h-5 w-48 rounded animate-pulse" style={{ background: 'rgba(255,255,255,0.06)' }} />
          )}
        </h1>
        <p className="text-xs text-[var(--text-faint)] mt-2 tabular-nums flex flex-wrap items-center gap-x-2 gap-y-1">
          <span>
            Last audit{' '}
            {audit.started_at
              ? formatDistanceToNow(new Date(audit.started_at), { addSuffix: true })
              : '—'}
          </span>
          {audit.total_pages != null && (
            <>
              <span className="text-[var(--text-faint)]">·</span>
              <span>{audit.total_pages} {audit.total_pages === 1 ? 'page' : 'pages'}</span>
            </>
          )}
          {audit.cms_platform && (
            <>
              <span className="text-[var(--text-faint)]">·</span>
              <span
                className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wider"
                style={{
                  background: 'var(--accent-muted)',
                  color: 'var(--accent-light)',
                  border: '1px solid var(--accent-light)',
                }}
              >
                {audit.cms_platform === 'next' ? 'Next.js' : audit.cms_platform.charAt(0).toUpperCase() + audit.cms_platform.slice(1)}
              </span>
            </>
          )}
          {audit.overall_score != null && (
            <span className="inline-flex items-center gap-1.5">
              <span className="text-[var(--text-faint)]">·</span>
              <span
                className="px-1.5 py-0.5 rounded font-semibold text-[10px]"
                style={{ background: gradeColor(grade), color: 'var(--bg-base)' }}
              >
                {grade}
              </span>
            </span>
          )}
        </p>
        {pdfError && (
          <p className="text-xs text-red-400 mt-1">{pdfError}</p>
        )}
      </div>
      <div className="flex items-center gap-2 shrink-0">
        {audit.status === 'completed' && (
          <button
            type="button"
            onClick={handleDownloadPdf}
            disabled={pdfBusy}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium border border-[var(--border-default)] bg-[var(--bg-elevated)] text-[var(--text-primary)] hover:bg-[var(--bg-card)] disabled:opacity-50 disabled:cursor-not-allowed"
            title="Download audit as PDF"
          >
            {pdfBusy ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              <Download size={14} />
            )}
            Download PDF
          </button>
        )}
        <motion.button
          type="button"
          onClick={onRunNewAudit}
          disabled={inFlight}
          whileTap={{ scale: 0.97 }}
          transition={{ type: 'spring', stiffness: 400, damping: 20 }}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium text-white disabled:opacity-60 disabled:cursor-not-allowed"
          style={{ background: 'var(--accent)' }}
        >
          {inFlight ? (
            <>
              <Loader2 size={14} className="animate-spin" />
              Running…
            </>
          ) : (
            <>
              <Play size={14} />
              Run new audit
            </>
          )}
        </motion.button>
      </div>
    </header>
  );
}
