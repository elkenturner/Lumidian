'use client';

import { useParams, redirect } from 'next/navigation';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function ProfileRedirectPage() {
  const params = useParams();
  const router = useRouter();
  const brandId = params.brandId;

  useEffect(() => {
    router.replace(`/tracker/${brandId}`);
  }, [brandId, router]);

  return null;
}
