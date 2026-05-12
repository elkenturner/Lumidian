'use client';

import { useState } from 'react';
import { DocumentList } from './DocumentList';
import { GenerateDocumentButton } from './GenerateDocumentButton';
import type { AgencyDocument } from '@/lib/api';

interface Props {
  brandId: number | null;
  clientId?: number;
}

export function ClientReportsTab({ brandId, clientId }: Props) {
  const [justGenerated, setJustGenerated] = useState<AgencyDocument | null>(null);

  if (clientId == null) {
    return <p className="text-sm text-[var(--text-muted)]">No client context.</p>;
  }

  return (
    <div className="space-y-4 text-[var(--text-primary)]">
      <div className="flex items-center justify-between">
        <p className="text-sm text-[var(--text-muted)]">
          Generated reports, audits, SOWs, and other documents for this client.
        </p>
        <GenerateDocumentButton clientId={clientId} onGenerated={setJustGenerated} />
      </div>
      <DocumentList clientId={clientId} injectDoc={justGenerated} />
    </div>
  );
}
