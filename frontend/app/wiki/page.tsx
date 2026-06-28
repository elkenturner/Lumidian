'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useBrand } from '@/contexts/BrandContext';

export default function WikipediaIndexPage() {
  const router = useRouter();
  const { activeBrandId, loading } = useBrand();

  useEffect(() => {
    if (loading) return;
    if (activeBrandId) router.replace(`/wiki/${activeBrandId}`);
  }, [loading, activeBrandId, router]);

  return (
    <div className="px-4 sm:px-8 py-6 sm:py-8 max-w-[1400px]">
      <div className="text-[11px] uppercase tracking-wider text-[var(--text-faint)] font-semibold mb-1.5">
        Wikipedia
      </div>
      <h1 className="text-2xl font-bold text-[var(--text-primary)] leading-tight">
        Citation opportunities
      </h1>
      <p className="mt-1.5 text-sm text-[var(--text-secondary)]">Select a brand to begin.</p>
    </div>
  );
}
