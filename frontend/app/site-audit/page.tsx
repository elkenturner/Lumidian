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

  if (brands === null)
    return (
      <div className="px-4 sm:px-8 py-6 sm:py-8 max-w-[1400px] text-sm text-[var(--text-secondary)]">
        Loading…
      </div>
    )

  return (
    <div className="px-4 sm:px-8 py-6 sm:py-8 max-w-[1400px] space-y-6">
      <header>
        <div className="text-[11px] uppercase tracking-wider text-[var(--text-faint)] font-semibold mb-1.5">
          Site Audit
        </div>
        <h1 className="text-2xl font-bold text-[var(--text-primary)] leading-tight">
          Pick a brand to audit
        </h1>
        <p className="mt-1.5 max-w-2xl text-sm text-[var(--text-secondary)]">
          Each audit crawls the site for AI-search visibility — semantic structure, schema, AI-bot
          accessibility, and which competitor pages are winning the prompts you lose on.
        </p>
      </header>

      <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {brands.map(b => (
          <li key={b.id}>
            <button
              onClick={() => router.push(`/site-audit/${b.id}`)}
              className="card card-hover flex w-full items-start gap-3 text-left"
            >
              <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-[var(--accent-light)]" />
              <div className="min-w-0">
                <div className="font-medium text-[var(--text-primary)] truncate">{b.name}</div>
                <div className="text-xs text-[var(--text-muted)] truncate">
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
