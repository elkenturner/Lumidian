'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ShieldCheck } from 'lucide-react'

import { getBrands, type Brand } from '@/lib/api'

export default function SiteAuditIndexPage() {
  const router = useRouter()
  const [brands, setBrands] = useState<Brand[] | null>(null)

  useEffect(() => {
    (async () => {
      try {
        const all = await getBrands()
        if (!all || all.length === 0) {
          router.replace('/dashboard')
          return
        }
        if (all.length === 1) {
          router.replace(`/site-audit/${all[0].id}`)
          return
        }
        setBrands(all)
      } catch {
        router.replace('/dashboard')
      }
    })()
  }, [router])

  if (brands === null) return <div className="p-8 text-muted-foreground">Loading…</div>

  return (
    <div className="p-8 max-w-4xl">
      <h1 className="text-2xl font-semibold mb-2">Site Audit</h1>
      <p className="text-sm text-muted-foreground mb-6">
        Pick a brand to audit. Each audit crawls the site for AI-search visibility — semantic
        structure, schema, AI-bot accessibility, and which competitor pages are winning the prompts
        you lose on.
      </p>

      <ul className="grid gap-3 sm:grid-cols-2">
        {brands.map(b => (
          <li key={b.id}>
            <button
              onClick={() => router.push(`/site-audit/${b.id}`)}
              className="w-full text-left border rounded-lg p-4 hover:border-primary transition-colors flex items-start gap-3"
            >
              <ShieldCheck className="mt-0.5 h-5 w-5 text-muted-foreground shrink-0" />
              <div className="min-w-0">
                <div className="font-medium truncate">{b.name}</div>
                <div className="text-xs text-muted-foreground truncate">
                  {b.website_url || 'No website set'}
                </div>
              </div>
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}
