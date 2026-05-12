'use client'

import { useParams } from 'next/navigation'

import { SiteAuditView } from '@/components/site-audit/SiteAuditView'

export default function SiteAuditPage() {
  const params = useParams<{ brandId: string }>()
  const brandId = Number(params.brandId)
  return <SiteAuditView brandId={brandId} />
}
