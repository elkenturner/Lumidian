'use client';

import { useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useBrand } from '@/contexts/BrandContext';
import { ContentHub } from '@/components/content/ContentHub';

/**
 * Canonical content URL is /content/[brandId]. This page redirects there
 * once we know the active brand. If no brand is selected yet (first visit
 * or no brands), it falls back to rendering ContentHub directly so the
 * "select a brand" empty state is visible.
 */
export default function ContentHubPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { activeBrandId, loading } = useBrand();

  useEffect(() => {
    if (loading) return;
    if (!activeBrandId) return;
    // Preserve query params (e.g. ?tab=opportunities, ?platform=reddit)
    const qs = searchParams?.toString();
    const href = `/content/${activeBrandId}${qs ? `?${qs}` : ''}`;
    router.replace(href);
  }, [loading, activeBrandId, router, searchParams]);

  return <ContentHub />;
}
