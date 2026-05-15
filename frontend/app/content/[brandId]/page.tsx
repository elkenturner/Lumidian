'use client';

import { useParams } from 'next/navigation';
import { ContentHub } from '@/components/content/ContentHub';

export default function ContentBrandPage() {
  const params = useParams<{ brandId: string }>();
  const brandId = Number(params?.brandId);
  return <ContentHub initialBrandId={Number.isFinite(brandId) ? brandId : undefined} />;
}
