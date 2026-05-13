'use client';

import { useEffect, useState } from 'react';
import { siteAudit, type WebsiteAuditPageOut } from '@/lib/api';

interface Props {
  auditId: number;
}

const SCHEMA_TYPES = [
  'Organization',
  'WebSite',
  'BreadcrumbList',
  'Article',
  'Product',
  'FAQPage',
  'HowTo',
  'Review',
];

const PAGE_TYPES_ORDER = ['homepage', 'product', 'article', 'hub', 'documentation', 'other'];

export function SchemaMatrix({ auditId }: Props) {
  const [pages, setPages] = useState<WebsiteAuditPageOut[] | null>(null);

  useEffect(() => {
    siteAudit.pages(auditId, { per_page: 250, sort: 'url' }).then(setPages);
  }, [auditId]);

  if (!pages) {
    return <div className="card h-48 animate-pulse" style={{ background: 'rgba(255,255,255,0.02)' }} />;
  }

  // Build count matrix: pageType × schemaType → number of pages with both
  const matrix: Record<string, Record<string, number>> = {};
  const totalsByPageType: Record<string, number> = {};
  for (const p of pages) {
    const pt = PAGE_TYPES_ORDER.includes(p.page_type) ? p.page_type : 'other';
    totalsByPageType[pt] = (totalsByPageType[pt] ?? 0) + 1;
    const schemas: string[] = Array.isArray(p.schema_types) ? p.schema_types : [];
    matrix[pt] ??= {};
    for (const s of schemas) {
      matrix[pt][s] = (matrix[pt][s] ?? 0) + 1;
    }
  }

  const visiblePageTypes = PAGE_TYPES_ORDER.filter((pt) => totalsByPageType[pt]);

  return (
    <div className="card">
      <div className="flex items-baseline justify-between mb-3">
        <h3 className="text-base font-semibold text-[var(--text-primary)]">Schema coverage</h3>
        <p className="text-[11px] text-[var(--text-muted)]">
          page type × schema type — green cells are covered, red are missing
        </p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr>
              <th className="text-left text-[10px] uppercase tracking-wider text-[var(--text-muted)] font-normal py-2 pr-3">
                Page type
              </th>
              {SCHEMA_TYPES.map((s) => (
                <th
                  key={s}
                  className="text-center text-[10px] uppercase tracking-wider text-[var(--text-muted)] font-normal py-2 px-2"
                >
                  {s}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visiblePageTypes.map((pt) => {
              const total = totalsByPageType[pt];
              return (
                <tr key={pt} className="border-t border-[var(--border-subtle)]">
                  <td className="py-2 pr-3 text-[var(--text-secondary)] capitalize">
                    {pt}
                    <span className="text-[var(--text-faint)] ml-1 tabular-nums">({total})</span>
                  </td>
                  {SCHEMA_TYPES.map((s) => {
                    const count = matrix[pt]?.[s] ?? 0;
                    const pct = total > 0 ? count / total : 0;
                    const bg =
                      pct >= 0.8 ? 'rgba(34, 197, 94, 0.25)'
                        : pct >= 0.3 ? 'rgba(245, 158, 11, 0.25)'
                          : 'rgba(239, 68, 68, 0.15)';
                    return (
                      <td
                        key={s}
                        className="text-center p-1"
                      >
                        <div
                          className="rounded py-1 px-2 tabular-nums text-[var(--text-primary)]"
                          style={{ background: bg }}
                        >
                          {count}/{total}
                        </div>
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
