'use client'

import { useState } from 'react'

import { siteAudit } from '@/lib/api'

export function AuditTriggerButton({
  brandId, onTriggered, disabled = false,
}: { brandId: number; onTriggered: () => void; disabled?: boolean }) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function run() {
    setLoading(true)
    setError(null)
    try {
      await siteAudit.trigger(brandId)
      onTriggered()
    } catch (e: unknown) {
      const err = e as { response?: { data?: { detail?: string } } }
      setError(err?.response?.data?.detail || 'Failed to trigger audit')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="inline-flex flex-col items-end">
      <button
        onClick={run}
        disabled={loading || disabled}
        className="px-4 py-2 rounded-md bg-primary text-primary-foreground disabled:opacity-50">
        {loading ? 'Starting…' : 'Run audit'}
      </button>
      {error && <span className="text-xs text-red-500 mt-1">{error}</span>}
    </div>
  )
}
