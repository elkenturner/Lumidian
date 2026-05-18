'use client';

import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { Globe, FileText, ShoppingCart, Newspaper, Layers, Code2, ChevronLeft, ChevronRight, type LucideIcon } from 'lucide-react';
import { siteAudit, type WebsiteAuditPageOut } from '@/lib/api';
import { scoreToGrade, gradeColor } from '@/lib/grade';
import { staggerContainer, staggerChild } from '@/lib/motion';

interface Props {
  auditId: number;
  onSelect: (pageId: number) => void;
}

const TYPE_ICON: Record<string, LucideIcon> = {
  homepage: Globe,
  product: ShoppingCart,
  article: Newspaper,
  hub: Layers,
  documentation: FileText,
  other: Code2,
};

function TypeIcon({ pageType }: { pageType: string }) {
  const C = TYPE_ICON[pageType] ?? TYPE_ICON.other;
  return <C size={13} className="text-[var(--text-muted)]" />;
}

const PER_PAGE = 50;

export function PageTable({ auditId, onSelect }: Props) {
  const [pages, setPages] = useState<WebsiteAuditPageOut[] | null>(null);
  const [pageNum, setPageNum] = useState(1);

  useEffect(() => {
    // Pull all pages once; paginate in-memory (cheaper than per-page fetches).
    siteAudit
      .pages(auditId, { per_page: 250, sort: 'score' })
      .then(setPages)
      .catch(() => setPages([]));
  }, [auditId]);

  if (!pages) {
    return (
      <div className="card animate-pulse h-72" style={{ background: 'rgba(255,255,255,0.02)' }} />
    );
  }
  if (pages.length === 0) {
    return (
      <p className="text-center text-sm text-[var(--text-muted)] py-12">
        No pages found in this audit.
      </p>
    );
  }

  const totalPages = Math.max(1, Math.ceil(pages.length / PER_PAGE));
  const safePageNum = Math.min(pageNum, totalPages);
  const start = (safePageNum - 1) * PER_PAGE;
  const slice = pages.slice(start, start + PER_PAGE);

  return (
    <div className="space-y-3">
      <div className="card overflow-hidden">
        <div className="grid grid-cols-[1fr_84px_64px_56px_64px] text-[10px] uppercase tracking-wider text-[var(--text-muted)] px-3 py-2 border-b border-[var(--border-subtle)]">
          <div>URL</div>
          <div>Type</div>
          <div className="text-right">Words</div>
          <div className="text-right">Render</div>
          <div className="text-right">Score</div>
        </div>
        <motion.div
          key={safePageNum}
          variants={staggerContainer}
          initial="hidden"
          animate="visible"
          className="divide-y divide-[var(--border-subtle)]"
        >
          {slice.map((p) => {
            const grade = scoreToGrade(p.page_score ?? null);
            const c = gradeColor(grade);
            return (
              <motion.button
                key={p.id}
                variants={staggerChild}
                onClick={() => onSelect(p.id)}
                type="button"
                className="w-full text-left grid grid-cols-[1fr_84px_64px_56px_64px] items-center px-3 py-2.5 text-sm hover:bg-[var(--bg-card)] transition-colors"
              >
                <div className="truncate font-mono text-xs text-[var(--text-primary)]">
                  {pathOf(p.url)}
                </div>
                <div className="flex items-center gap-1 text-xs text-[var(--text-secondary)]">
                  <TypeIcon pageType={p.page_type} />
                  <span>{p.page_type}</span>
                </div>
                <div className="text-right tabular-nums text-xs text-[var(--text-secondary)]">
                  {p.word_count?.toLocaleString() ?? '—'}
                </div>
                <div className="text-right text-[10px]">
                  {p.is_js_rendered ? (
                    <span style={{ color: 'var(--warning-text)' }}>JS</span>
                  ) : (
                    <span className="text-[var(--text-muted)]">SSR</span>
                  )}
                </div>
                <div className="text-right">
                  <span className="font-bold tabular-nums" style={{ color: c }}>
                    {grade}
                  </span>
                  <span className="text-[var(--text-faint)] text-xs ml-1 tabular-nums">
                    {p.page_score?.toFixed(0) ?? '—'}
                  </span>
                </div>
              </motion.button>
            );
          })}
        </motion.div>
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-between text-xs text-[var(--text-muted)] px-1">
          <span className="tabular-nums">
            {start + 1}–{Math.min(start + PER_PAGE, pages.length)} of {pages.length} pages
          </span>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setPageNum((n) => Math.max(1, n - 1))}
              disabled={safePageNum <= 1}
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded border border-[var(--border-subtle)] hover:border-[var(--border-default)] disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <ChevronLeft size={12} />
              Prev
            </button>
            <span className="px-2 tabular-nums">
              {safePageNum} / {totalPages}
            </span>
            <button
              type="button"
              onClick={() => setPageNum((n) => Math.min(totalPages, n + 1))}
              disabled={safePageNum >= totalPages}
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded border border-[var(--border-subtle)] hover:border-[var(--border-default)] disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Next
              <ChevronRight size={12} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function pathOf(u: string): string {
  try {
    return new URL(u).pathname || '/';
  } catch {
    return u;
  }
}
