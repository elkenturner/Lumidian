'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

// Redirect to unified Settings page — brand settings are now managed there
export default function BrandSettingsRedirect() {
  const router = useRouter();
  useEffect(() => { router.replace('/settings'); }, [router]);
  return null;
}
