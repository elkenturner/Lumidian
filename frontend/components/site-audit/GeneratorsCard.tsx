'use client'

import { useState } from 'react'

import { siteAudit } from '@/lib/api'

export function GeneratorsCard({ brandId }: { brandId: number }) {
  const [snippet, setSnippet] = useState<string | null>(null)
  const [mode, setMode] = useState<'allow_all' | 'search_only'>('allow_all')

  async function load() {
    setSnippet(await siteAudit.robotsSnippet(brandId, mode))
  }

  return (
    <section>
      <h3 className="font-medium mb-2">robots.txt snippet</h3>
      <div className="flex items-center gap-3 mb-3 text-sm flex-wrap">
        <label className="flex items-center gap-1.5">
          <input type="radio" checked={mode === 'allow_all'} onChange={() => setMode('allow_all')} />
          Allow all AI bots
        </label>
        <label className="flex items-center gap-1.5">
          <input type="radio" checked={mode === 'search_only'} onChange={() => setMode('search_only')} />
          Allow live search, block training
        </label>
        <button onClick={load} className="ml-auto px-2 py-1 border rounded text-xs">Generate</button>
      </div>
      {snippet && (
        <pre className="bg-muted p-3 rounded text-xs max-h-64 overflow-auto">{snippet}</pre>
      )}
    </section>
  )
}
