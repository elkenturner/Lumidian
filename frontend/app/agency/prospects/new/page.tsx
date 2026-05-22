import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';

import { NewProspectForm } from '@/components/agency/NewProspectForm';

export default function NewProspectPage() {
  return (
    <div className="mx-auto max-w-xl px-6 py-8">
      <Link
        href="/agency/prospects"
        className="mb-4 inline-flex items-center gap-1 text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to prospects
      </Link>
      <h1 className="text-2xl font-semibold text-[var(--text-primary)]">New prospect audit</h1>
      <p className="mt-1 mb-6 text-sm text-[var(--text-secondary)]">
        Generates a PDF visibility report from the business's name and website. Takes 90–150 seconds.
      </p>
      <NewProspectForm />
    </div>
  );
}
