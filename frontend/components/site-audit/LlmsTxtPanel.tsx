'use client'

import { siteAudit } from '@/lib/api'

export function LlmsTxtPanel({ brandId, present, valid }:
  { brandId: number; present: boolean; valid: boolean }) {
  async function downloadLlmsTxt() {
    const txt = await siteAudit.llmsTxt(brandId)
    const blob = new Blob([txt], { type: 'text/plain' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'llms.txt'
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <section>
      <h3 className="font-medium mb-2">llms.txt</h3>
      <div className="text-sm mb-3">
        Status: {!present ? <span className="text-yellow-600">not present</span>
              : valid ? <span className="text-green-600">present and valid</span>
              : <span className="text-red-600">present but malformed</span>}
      </div>
      <button onClick={downloadLlmsTxt}
              className="px-3 py-2 rounded border text-sm">
        Generate &amp; download llms.txt
      </button>
    </section>
  )
}
