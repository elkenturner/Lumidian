'use client'

import { useEffect, useState } from 'react'

import { siteAudit, type WebsiteAuditFindingOut, type WebsiteAuditPageOut, type WebsiteAuditRecommendationOut } from '@/lib/api'

type PageDetailData = {
  page: WebsiteAuditPageOut
  findings: WebsiteAuditFindingOut[]
  recommendations: WebsiteAuditRecommendationOut[]
}

export function PageDetail({ auditId, pageId, onBack }:
  { auditId: number; pageId: number; onBack: () => void }) {
  const [data, setData] = useState<PageDetailData | null>(null)

  useEffect(() => {
    siteAudit.pageDetail(auditId, pageId).then(setData)
  }, [auditId, pageId])

  if (!data) return <div>Loading…</div>

  return (
    <div>
      <button onClick={onBack} className="text-sm text-muted-foreground mb-4">← Back to pages</button>
      <h2 className="text-xl font-semibold mb-1 truncate">{data.page.title || data.page.url}</h2>
      <div className="text-sm text-muted-foreground mb-6 break-all">{data.page.url}</div>

      <section className="mb-6">
        <h3 className="font-medium mb-2">Findings ({data.findings.length})</h3>
        <ul className="space-y-2">
          {data.findings.map(f => (
            <li key={f.id} className="text-sm">
              <span className={`inline-block px-2 py-0.5 rounded mr-2 text-xs ${
                f.severity === 'critical' ? 'bg-red-600 text-white' :
                f.severity === 'high'     ? 'bg-orange-500 text-white' :
                f.severity === 'medium'   ? 'bg-yellow-400'  :
                                            'bg-muted'
              }`}>{f.severity}</span>
              {f.message}
            </li>
          ))}
        </ul>
      </section>

      <section>
        <h3 className="font-medium mb-2">Recommendations ({data.recommendations.length})</h3>
        <ul className="space-y-3">
          {data.recommendations.map(r => (
            <li key={r.id} className="border rounded-md p-3">
              <div className="flex items-center justify-between">
                <strong>{r.title}</strong>
                <span className="text-xs text-muted-foreground">
                  {r.priority} priority · {r.effort} effort
                </span>
              </div>
              <div className="text-sm mt-2 whitespace-pre-line">{r.body}</div>
              {r.linked_prompt_ids.length > 0 && (
                <div className="text-xs mt-2 text-muted-foreground">
                  Fixes prompts: {r.linked_prompt_ids.join(', ')}
                </div>
              )}
            </li>
          ))}
        </ul>
      </section>
    </div>
  )
}
