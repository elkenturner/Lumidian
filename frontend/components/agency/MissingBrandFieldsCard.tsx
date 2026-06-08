'use client';

import Link from 'next/link';
import { AlertTriangle } from 'lucide-react';

interface Props {
  brandId: number | null;
  missingFields: string[];
  onDismiss: () => void;
}

const FIELD_LABELS: Record<string, string> = {
  'brand.name': 'Brand name',
  'brand.website_url': 'Website URL',
  'brand_profile.company_description': 'Company description',
  'brand_profile.tone_of_voice': 'Tone of voice',
  'brand_profile.target_audience': 'Target audience',
  'brand_profile.what_not_to_say': 'What not to say',
  'brand_profile.approved_language': 'Approved language',
  'brand_profile.publications': 'Publications',
};

export function MissingBrandFieldsCard({ brandId, missingFields, onDismiss }: Props) {
  return (
    <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-100">
      <div className="flex items-start gap-2">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-300" />
        <div className="flex-1">
          <p className="font-medium">Add these to the brand profile before generating:</p>
          <ul className="mt-2 list-disc space-y-0.5 pl-5">
            {missingFields.map((f) => (
              <li key={f}>{FIELD_LABELS[f] ?? f}</li>
            ))}
          </ul>
          {brandId != null && (
            <Link
              href={`/tracker/${brandId}/profile`}
              className="mt-2 inline-block text-xs underline hover:text-amber-50"
            >
              Open Brand Profile →
            </Link>
          )}
        </div>
        <button onClick={onDismiss} className="text-xs text-amber-200 hover:text-amber-50">
          dismiss
        </button>
      </div>
    </div>
  );
}
