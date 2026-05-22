import { notFound } from 'next/navigation';

import { ProspectDetailView } from '@/components/agency/ProspectDetailView';

interface Props {
  params: Promise<{ id: string }>;
}

export default async function ProspectDetailPage({ params }: Props) {
  const { id } = await params;
  const auditId = Number(id);
  if (!Number.isFinite(auditId)) return notFound();
  return <ProspectDetailView auditId={auditId} />;
}
