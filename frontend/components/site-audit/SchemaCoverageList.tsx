'use client';

import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { Check, AlertCircle, ArrowRight } from 'lucide-react';
import { siteAudit, type WebsiteAuditPageOut } from '@/lib/api';
import { staggerContainer, staggerChild } from '@/lib/motion';

interface Props {
  auditId: number;
  onJumpToFix: (schemaType: string) => void;
}

// One-liner per schema type — what it is + why it matters for AI search.
const SCHEMA_INFO: Record<string, { label: string; what: string }> = {
  Organization: {
    label: 'Organization',
    what: 'The entity anchor for your brand. AI uses this to disambiguate mentions of your brand name from unrelated things with the same name.',
  },
  WebSite: {
    label: 'WebSite',
    what: 'Site-level identity + search action. Enables AI to surface your internal search in answers.',
  },
  BreadcrumbList: {
    label: 'BreadcrumbList',
    what: "Page hierarchy — helps AI place each page in your site's structure.",
  },
  Article: {
    label: 'Article',
    what: 'Marks article/blog pages with author + dates. Heavy weight in E-E-A-T.',
  },
  Product: {
    label: 'Product',
    what: 'Product cards. Required if you want AI to recommend your products.',
  },
  FAQPage: {
    label: 'FAQPage',
    what: "Q&A pairs AI can quote directly in answers. One of the highest-leverage schemas.",
  },
  HowTo: {
    label: 'HowTo',
    what: 'Procedure steps for tutorial / guide pages.',
  },
  Review: {
    label: 'Review',
    what: 'Star ratings + review counts. Strong trust signal for AI rankings.',
  },
};

const ORDER = [
  'Organization',
  'WebSite',
  'BreadcrumbList',
  'Article',
  'Product',
  'FAQPage',
  'HowTo',
  'Review',
];

// Which schema types should only fire on certain page types (don't flag missing
// Article schema on a product page, etc.).
const RELEVANT_FOR: Record<string, (page: WebsiteAuditPageOut) => boolean> = {
  Organization: (p) => p.page_type === 'homepage',
  WebSite: (p) => p.page_type === 'homepage',
  BreadcrumbList: (p) => p.page_type !== 'homepage',
  Article: (p) => p.page_type === 'article',
  Product: (p) => p.page_type === 'product',
  FAQPage: (p) => (p.word_count ?? 0) >= 800,
  HowTo: (p) => p.page_type === 'article',
  Review: (p) => p.page_type === 'product',
};

export function SchemaCoverageList({ auditId, onJumpToFix }: Props) {
  const [pages, setPages] = useState<WebsiteAuditPageOut[] | null>(null);

  useEffect(() => {
    siteAudit.pages(auditId, { per_page: 250, sort: 'url' }).then(setPages);
  }, [auditId]);

  if (!pages) {
    return <div className="card h-48 animate-pulse" style={{ background: 'rgba(255,255,255,0.02)' }} />;
  }

  // Build per-schema coverage stats
  const rows = ORDER.map((schemaType) => {
    const relevant = pages.filter(
      (p) => p.http_status === 200 && RELEVANT_FOR[schemaType]?.(p),
    );
    const haveIt = relevant.filter((p) =>
      Array.isArray(p.schema_types) && p.schema_types.includes(schemaType),
    );
    const coverage = relevant.length === 0 ? null : haveIt.length / relevant.length;
    const missing = relevant.length - haveIt.length;
    return { schemaType, relevant: relevant.length, have: haveIt.length, missing, coverage };
  });

  const haveCount = rows.filter((r) => r.coverage === 1).length;
  const totalRelevant = rows.filter((r) => r.relevant > 0).length;
  const biggestGap = rows
    .filter((r) => r.relevant > 0 && (r.coverage ?? 1) < 1)
    .sort((a, b) => b.missing - a.missing)[0];

  return (
    <div className="card">
      <div className="mb-4">
        <h3 className="text-base font-semibold text-[var(--text-primary)]">Schema coverage</h3>
        <p className="text-sm text-[var(--text-secondary)] mt-1 leading-relaxed">
          You have <strong className="text-[var(--text-primary)] tabular-nums">{haveCount} of {totalRelevant}</strong> schema types fully covered
          {pages.length >= 250 && ' (based on the first 250 crawled pages)'}.{' '}
          {biggestGap && (
            <span>
              Biggest gap: <strong className="text-[var(--warning-text)]">
                {biggestGap.missing} page{biggestGap.missing === 1 ? '' : 's'}
              </strong> missing <strong>{biggestGap.schemaType}</strong>.
            </span>
          )}
        </p>
      </div>

      <motion.ul
        variants={staggerContainer}
        initial="hidden"
        animate="visible"
        className="divide-y divide-[var(--border-subtle)]"
      >
        {rows.map(({ schemaType, relevant, have, coverage, missing }) => {
          const info = SCHEMA_INFO[schemaType];
          const full = coverage === 1;
          const none = coverage === 0;
          const naBecauseEmpty = relevant === 0;

          return (
            <motion.li
              key={schemaType}
              variants={staggerChild}
              className="py-3 flex items-start gap-3"
            >
              <span
                className="w-5 h-5 rounded-full shrink-0 mt-0.5 flex items-center justify-center"
                style={{
                  background: full ? 'var(--success-muted)' : naBecauseEmpty ? 'transparent' : 'rgba(239,68,68,0.12)',
                  border: `1px solid ${full ? 'var(--success)' : naBecauseEmpty ? 'var(--border-subtle)' : 'var(--danger)'}`,
                }}
              >
                {full ? (
                  <Check size={11} style={{ color: 'var(--success-text)' }} />
                ) : naBecauseEmpty ? (
                  <span className="text-[10px] text-[var(--text-muted)]">—</span>
                ) : (
                  <AlertCircle size={11} style={{ color: 'var(--danger-text)' }} />
                )}
              </span>
              <div className="flex-1 min-w-0">
                <div className="flex items-baseline gap-2">
                  <p className="text-sm font-medium text-[var(--text-primary)]">{schemaType}</p>
                  {!naBecauseEmpty && (
                    <p className="text-xs tabular-nums text-[var(--text-faint)]">
                      {have}/{relevant} {relevant === 1 ? 'page' : 'pages'}
                    </p>
                  )}
                </div>
                <p className="text-xs text-[var(--text-secondary)] mt-0.5 leading-relaxed">
                  {info?.what}
                </p>
                {!full && !naBecauseEmpty && (
                  <p className="text-xs mt-1.5" style={{ color: 'var(--warning-text)' }}>
                    {none
                      ? `Missing on all ${relevant} ${relevant === 1 ? 'page' : 'pages'}.`
                      : `Missing on ${missing} ${missing === 1 ? 'page' : 'pages'}.`}
                  </p>
                )}
                {naBecauseEmpty && (
                  <p className="text-xs text-[var(--text-muted)] mt-1.5">
                    No relevant pages in this audit.
                  </p>
                )}
              </div>
              {!full && !naBecauseEmpty && (
                <button
                  type="button"
                  onClick={() => onJumpToFix(schemaType)}
                  className="inline-flex items-center gap-1 text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)] shrink-0"
                >
                  Find the fix
                  <ArrowRight size={11} />
                </button>
              )}
            </motion.li>
          );
        })}
      </motion.ul>
    </div>
  );
}
