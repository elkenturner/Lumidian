'use client'

import { useEffect, useState } from 'react'

import { siteAudit, type CitationsOverview } from '@/lib/api'

export function CitationDomainList({ brandId }: { brandId: number }) {
  const [data, setData] = useState<CitationsOverview | null>(null)
  useEffect(() => { siteAudit.citations(brandId, 30).then(setData) }, [brandId])
  if (!data) return <div>Loading…</div>

  return (
    <div className="space-y-6">
      <div className="flex gap-6">
        <div className="border rounded p-4">
          <div className="text-xs text-muted-foreground uppercase">Own pages</div>
          <div className="text-2xl font-semibold">{data.own_pct.toFixed(0)}%</div>
        </div>
        <div className="border rounded p-4">
          <div className="text-xs text-muted-foreground uppercase">Competitor pages</div>
          <div className="text-2xl font-semibold">{data.competitor_pct.toFixed(0)}%</div>
        </div>
      </div>

      <section>
        <h3 className="font-medium mb-2">Top cited domains (last 30 days)</h3>
        <table className="w-full text-sm">
          <thead className="border-b text-muted-foreground">
            <tr><th className="text-left py-2">Domain</th><th className="text-left">Kind</th><th className="text-right">Citations</th></tr>
          </thead>
          <tbody>
            {data.by_domain.map(d => (
              <tr key={d.domain + d.kind} className="border-b">
                <td className="py-2 font-mono text-xs">{d.domain}</td>
                <td><span className={`text-xs ${
                  d.kind === 'own' ? 'text-green-600' :
                  d.kind === 'competitor' ? 'text-red-600' :
                  d.kind === 'third_party' ? 'text-blue-600' : 'text-muted-foreground'
                }`}>{d.kind}</span></td>
                <td className="text-right">{d.count}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  )
}
