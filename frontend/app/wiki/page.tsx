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
    <div className="max-w-5xl mx-auto p-6">
      <h1 className="text-2xl font-bold text-slate-900">Wikipedia opportunities</h1>
      <p className="mt-2 text-sm text-slate-500">Select a brand to begin.</p>
    </div>
  );
}
