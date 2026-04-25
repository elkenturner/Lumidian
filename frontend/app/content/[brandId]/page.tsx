'use client';

import { useEffect } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';

/**
 * /content/[brandId] — redirects to the main Content Hub (/content)
 * which already supports per-brand filtering via the brand selector.
 * Sets the active brand in localStorage so the hub pre-selects the right brand.
 * Forwards ?platform= if present so the hub opens on that platform tab.
 */
export default function ContentBrandRedirectPage() {
  const params = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();

  useEffect(() => {
    const brandId = params?.brandId;
    if (brandId) {
      try {
        localStorage.setItem('clarity_active_brand_id', String(brandId));
      } catch {}
    }
    const platform = searchParams?.get('platform');
    if (platform) {
      router.replace(`/content?platform=${encodeURIComponent(platform)}`);
    } else {
      router.replace('/content');
    }
  }, [params, router, searchParams]);

  return null;
}
