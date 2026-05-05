'use client';

import { SidebarNav } from '@/components/sidebar-nav';
import { useAuth } from '@/contexts/AuthContext';

export default function AuthedLayout({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();

  if (loading) {
    return <div className="p-8 text-sm text-muted-foreground">Loading…</div>;
  }
  if (!user) {
    return <div className="p-8 text-sm text-muted-foreground">Not signed in.</div>;
  }

  return (
    <div className="flex min-h-screen">
      <SidebarNav />
      <main className="flex-1 overflow-auto">{children}</main>
    </div>
  );
}
