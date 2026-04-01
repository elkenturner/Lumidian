'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function TrackerNewRedirect() {
  const router = useRouter();
  useEffect(() => {
    router.replace('/settings/brands/new');
  }, [router]);
  return null;
}
