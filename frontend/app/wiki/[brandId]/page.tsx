'use client';

import { useParams } from 'next/navigation';
import { WikipediaSurface } from '@/components/wikipedia/WikipediaSurface';

export default function WikipediaBrandPage() {
  const params = useParams<{ brandId: string }>();
  const brandId = Number(params?.brandId);
  if (!Number.isFinite(brandId)) return null;
  return <WikipediaSurface brandId={brandId} />;
}
