'use client'

import { useEffect, useState } from 'react'

import { siteAudit, type WebsiteAuditRecommendationOut } from '@/lib/api'

export function RecommendationsList({ auditId }: { auditId: number }) {
  const [recs, setRecs] = useState<WebsiteAuditRecommendationOut[] | null>(null)
  useEffect(() => { siteAudit.recommendations(auditId).then(setRecs) }, [auditId])
  if (!recs) return <div>Loading…</div>

  const grouped: Record<string, WebsiteAuditRecommendationOut[]> = { high: [], medium: [], low: [] }
  for (const r of recs) grouped[r.priority]?.push(r)

  return (
    <div className="space-y-6">
      {(['high', 'medium', 'low'] as const).map(prio => (
        <section key={prio}>
          <h3 className="font-medium mb-3 capitalize">{prio} priority ({grouped[prio].length})</h3>
          <ul className="space-y-3">
            {grouped[prio].map(r => (
              <li key={r.id} className="border rounded-md p-3">
                <div className="flex items-center justify-between">
                  <strong>{r.title}</strong>
                  <span className="text-xs text-muted-foreground">
                    {r.effort} effort · {r.category}
                  </span>
                </div>
                <div className="text-sm mt-2 whitespace-pre-line">{r.body}</div>
                {r.linked_prompt_ids.length > 0 && (
                  <div className="text-xs mt-2 inline-block bg-primary/10 text-primary px-2 py-0.5 rounded">
                    Fixes {r.linked_prompt_ids.length} prompts
                  </div>
                )}
                {r.expected_impact && (
                  <div className="text-xs mt-2 text-muted-foreground">
                    Expected impact: {r.expected_impact}
                  </div>
                )}
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  )
}
