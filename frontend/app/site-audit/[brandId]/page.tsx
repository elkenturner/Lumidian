'use client'

import { useEffect, useState, useCallback } from 'react'
import { useParams } from 'next/navigation'

import { siteAudit, type WebsiteAuditSummary } from '@/lib/api'
import { AuditTriggerButton } from '@/components/site-audit/AuditTriggerButton'

export default function SiteAuditPage() {
  const params = useParams<{ brandId: string }>()
  const brandId = Number(params.brandId)
  const [audit, setAudit] = useState<WebsiteAuditSummary | null | undefined>(undefined)
  const [tab, setTab] = useState<'overview' | 'pages' | 'bots' | 'citations' | 'recs'>('overview')

  const loadLatest = useCallback(async () => {
    try {
      const a = await siteAudit.latest(brandId)
      setAudit(a)
    } catch (e: unknown) {
      const err = e as { response?: { status?: number } }
      if (err?.response?.status === 404) setAudit(null)
      else throw e
    }
  }, [brandId])

  useEffect(() => { loadLatest() }, [loadLatest])

  // Poll while audit is in flight
  useEffect(() => {
    if (!audit || ['completed', 'failed', 'cancelled'].includes(audit.status)) return
    const t = setInterval(loadLatest, 4000)
    return () => clearInterval(t)
  }, [audit, loadLatest])

  if (audit === undefined) return <div className="p-8">Loading…</div>

  if (audit === null) {
    return (
      <div className="p-8 max-w-3xl">
        <h1 className="text-2xl font-semibold mb-2">Site Audit</h1>
        <p className="text-muted-foreground mb-6">
          Audit your site for AI-search visibility — semantic structure, schema, AI-bot accessibility,
          and which competitor pages are winning the prompts you lose on.
        </p>
        <AuditTriggerButton brandId={brandId} onTriggered={loadLatest} />
      </div>
    )
  }

  const inFlight = !['completed', 'failed', 'cancelled'].includes(audit.status)

  return (
    <div className="p-8">
      <header className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-semibold">Site Audit</h1>
          <p className="text-sm text-muted-foreground">
            Latest audit: {new Date(audit.started_at).toLocaleString()} · status: {audit.status}
            {audit.overall_score !== null && ` · overall score ${audit.overall_score.toFixed(0)}`}
          </p>
        </div>
        <AuditTriggerButton brandId={brandId} onTriggered={loadLatest} disabled={inFlight} />
      </header>

      <nav className="flex gap-4 border-b mb-6">
        {(['overview', 'pages', 'bots', 'citations', 'recs'] as const).map(t => (
          <button key={t}
            className={`pb-2 ${tab === t ? 'border-b-2 border-primary font-medium' : 'text-muted-foreground'}`}
            onClick={() => setTab(t)}>
            {t === 'overview' ? 'Overview' :
             t === 'pages'   ? 'Pages' :
             t === 'bots'    ? 'AI Bots & Files' :
             t === 'citations' ? 'Citations' : 'Recommendations'}
          </button>
        ))}
      </nav>

      {tab === 'overview' && <OverviewTab audit={audit} />}
      {tab === 'pages' && <div className="text-muted-foreground">Pages tab — coming in Task 27</div>}
      {tab === 'bots' && <div className="text-muted-foreground">Bots tab — coming in Task 28</div>}
      {tab === 'citations' && <div className="text-muted-foreground">Citations tab — coming in Task 29</div>}
      {tab === 'recs' && <div className="text-muted-foreground">Recommendations tab — coming in Task 30</div>}
    </div>
  )
}

function OverviewTab({ audit }: { audit: WebsiteAuditSummary }) {
  return (
    <div className="grid grid-cols-4 gap-4 max-w-4xl">
      {[
        { label: 'Bot access', v: audit.bot_access_score },
        { label: 'Content',    v: audit.content_score },
        { label: 'Schema',     v: audit.schema_score },
        { label: 'Technical',  v: audit.technical_score },
      ].map(({ label, v }) => (
        <div key={label} className="border rounded-lg p-4">
          <div className="text-xs text-muted-foreground uppercase">{label}</div>
          <div className="text-3xl font-semibold mt-2">
            {v !== null ? v.toFixed(0) : '—'}
          </div>
        </div>
      ))}
    </div>
  )
}
