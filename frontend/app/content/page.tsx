'use client';

import { useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { Loader2 } from 'lucide-react';
import { useBrand } from '@/contexts/BrandContext';

/**
 * Canonical content URL is /content/[brandId] (the cluster surface — the only
 * content-creation flow). This entry page redirects there once we know the
 * active brand. With no brand selected it shows a small empty state rather than
 * the legacy draft-queue hub, which has been retired from the live UI.
 */
export default function ContentHubPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { brands, activeBrandId, loading } = useBrand();

  useEffect(() => {
    if (loading || !activeBrandId) return;
    // Preserve query params (e.g. ?tab=opportunities, ?platform=reddit)
    const qs = searchParams?.toString();
    const href = `/content/${activeBrandId}${qs ? `?${qs}` : ''}`;
    router.replace(href);
  }, [loading, activeBrandId, router, searchParams]);

  // While loading, or once we have a brand to redirect to, show a spinner.
  if (loading || activeBrandId) {
    return (
      <div className="px-4 sm:px-8 py-8 max-w-[1400px] flex items-center gap-2 text-[var(--text-secondary)]">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading content…
      </div>
    );
  }

  // No active brand selected.
  return (
    <div className="px-4 sm:px-8 py-8 max-w-[1400px]">
      <div className="card border-dashed text-center py-12">
        <h1 className="text-lg font-semibold text-[var(--text-primary)]">Content</h1>
        {brands.length === 0 ? (
          <>
            <p className="mt-2 text-sm text-[var(--text-secondary)]">
              Create a brand to start producing content.
            </p>
            <Link
              href="/tracker/new"
              className="mt-4 inline-flex items-center justify-center rounded-md bg-[var(--accent)] px-4 py-2 text-sm font-medium text-[var(--accent-foreground)] hover:opacity-90"
            >
              Create a brand
            </Link>
          </>
        ) : (
          <p className="mt-2 text-sm text-[var(--text-secondary)]">
            Select a brand from the sidebar to view its content clusters.
          </p>
        )}
      </div>
    </div>
  );
}
