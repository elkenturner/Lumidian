'use client';
import { ReactNode, use, useEffect, useState } from 'react';
import { notFound } from 'next/navigation';
import ClientPortalSidebar from '@/components/client-portal/ClientPortalSidebar';
import { ClientViewProvider } from '@/lib/client-view';
import { clientPortalGetBrand } from '@/lib/api';

export default function ClientPortalLayout({
  params,
  children,
}: {
  params: Promise<{ token: string }>;
  children: ReactNode;
}) {
  const { token } = use(params);
  const [brandId, setBrandId] = useState<number | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    clientPortalGetBrand(token)
      .then((b) => setBrandId(b.id))
      .catch(() => setError(true));
  }, [token]);

  if (error) notFound();

  // Hold render until the brand resolves so child pages never see brandId: null.
  if (brandId === null) {
    return (
      <div className="min-h-screen bg-neutral-50 flex items-center justify-center">
        <div className="text-sm text-neutral-500">Loading…</div>
      </div>
    );
  }

  return (
    <ClientViewProvider token={token} brandId={brandId}>
      <div className="min-h-screen bg-neutral-50 flex">
        <ClientPortalSidebar token={token} />
        <main className="flex-1 px-6 py-6">{children}</main>
      </div>
    </ClientViewProvider>
  );
}
