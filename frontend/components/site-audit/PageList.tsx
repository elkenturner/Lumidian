'use client'

import { useEffect, useState } from 'react'

import { siteAudit, type WebsiteAuditPageOut } from '@/lib/api'

export function PageList({ auditId, onSelect }:
  { auditId: number; onSelect: (pageId: number) => void }) {
  const [rows, setRows] = useState<WebsiteAuditPageOut[] | null>(null)
  const [sort, setSort] = useState<'score' | 'url'>('score')

  useEffect(() => {
    siteAudit.pages(auditId, { sort, per_page: 100 }).then(setRows)
  }, [auditId, sort])

  if (!rows) return <div>Loading…</div>
  if (!rows.length) return <div className="text-muted-foreground">No pages crawled.</div>

  return (
    <table className="w-full text-sm">
      <thead className="border-b text-muted-foreground">
        <tr>
          <th className="text-left py-2 cursor-pointer" onClick={() => setSort('url')}>URL</th>
          <th className="text-left">Type</th>
          <th className="text-right">Words</th>
          <th className="text-right">JS?</th>
          <th className="text-right cursor-pointer" onClick={() => setSort('score')}>Score</th>
        </tr>
      </thead>
      <tbody>
        {rows.map(p => (
          <tr key={p.id} className="border-b hover:bg-muted/50 cursor-pointer"
              onClick={() => onSelect(p.id)}>
            <td className="py-2 truncate max-w-[28rem]">{p.url}</td>
            <td>{p.page_type}</td>
            <td className="text-right">{p.word_count}</td>
            <td className="text-right">{p.is_js_rendered ? 'CSR' : 'SSR'}</td>
            <td className="text-right font-mono">{p.page_score?.toFixed(0) ?? '—'}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}
