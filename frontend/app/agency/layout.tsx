'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { AgencySidebar } from '@/components/agency/AgencySidebar';

export default function AgencyLayout({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (loading) return;
    if (!user) {
      router.replace('/login?from=/agency');
      return;
    }
    if (!user.is_agency_staff && !user.is_admin) {
      router.replace('/dashboard');
    }
  }, [user, loading, router]);

  if (loading || !user) {
    return (
      <div className="p-8 text-sm text-[var(--text-muted)]">Loading…</div>
    );
  }
  if (!user.is_agency_staff && !user.is_admin) {
    return null;
  }

  return (
    <div className="flex min-h-screen bg-[var(--bg-base)]">
      <AgencySidebar />
      <main className="flex-1 overflow-auto">{children}</main>
    </div>
  );
}
