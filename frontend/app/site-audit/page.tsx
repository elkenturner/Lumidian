'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

import { getBrands } from '@/lib/api'

export default function SiteAuditIndexPage() {
  const router = useRouter()

  useEffect(() => {
    (async () => {
      try {
        const all = await getBrands()
        if (all && all.length > 0) {
          router.replace(`/site-audit/${all[0].id}`)
        } else {
          router.replace('/dashboard')
        }
      } catch {
        router.replace('/dashboard')
      }
    })()
  }, [router])

  return <div className="p-8 text-muted-foreground">Loading…</div>
}
