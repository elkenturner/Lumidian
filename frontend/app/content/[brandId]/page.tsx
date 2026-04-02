'use client';

import { useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';

/**
 * /content/[brandId] — redirects to the main Content Hub (/content)
 * which already supports per-brand filtering via the brand selector.
 * Sets the active brand in localStorage so the hub pre-selects the right brand.
 */
export default function ContentBrandRedirectPage() {
  const params = useParams();
  const router = useRouter();

  useEffect(() => {
    const brandId = params?.brandId;
    if (brandId) {
      try {
        localStorage.setItem('clarity_active_brand_id', String(brandId));
      } catch {}
      router.replace('/content');
    } else {
      router.replace('/content');
    }
  }, [params, router]);

  return null;
}
