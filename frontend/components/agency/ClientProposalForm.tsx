'use client';
import { useEffect, useState } from 'react';
import { agencySetClientProposal } from '@/lib/api';

export default function ClientProposalForm({
  clientId,
  initialDocUrl,
  initialLabel,
  onSaved,
}: {
  clientId: number;
  initialDocUrl: string | null;
  initialLabel: string | null;
  onSaved?: (next: { docUrl: string | null; label: string | null }) => void;
}) {
  const [docUrl, setDocUrl] = useState(initialDocUrl ?? '');
  const [label, setLabel] = useState(initialLabel ?? '');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    setDocUrl(initialDocUrl ?? '');
    setLabel(initialLabel ?? '');
  }, [initialDocUrl, initialLabel]);

  async function handleSave() {
    setSaving(true);
    setSaved(false);
    try {
      await agencySetClientProposal(clientId, {
        current_proposal_doc_url: docUrl.trim() || null,
        current_proposal_label: label.trim() || null,
      });
      setSaved(true);
      onSaved?.({ docUrl: docUrl.trim() || null, label: label.trim() || null });
      setTimeout(() => setSaved(false), 2000);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="rounded-lg border border-neutral-200 bg-white p-4">
      <div className="mb-3 text-sm font-semibold text-neutral-900">This week&apos;s proposal</div>
      <div className="space-y-3">
        <label className="block text-xs font-medium text-neutral-700">
          Label
          <input
            type="text"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="Week of May 22, 5 pieces"
            className="mt-1 block w-full rounded-md border border-neutral-300 px-3 py-1.5 text-sm"
          />
        </label>
        <label className="block text-xs font-medium text-neutral-700">
          Google Docs URL
          <input
            type="url"
            value={docUrl}
            onChange={(e) => setDocUrl(e.target.value)}
            placeholder="https://docs.google.com/document/d/…"
            className="mt-1 block w-full rounded-md border border-neutral-300 px-3 py-1.5 text-sm"
          />
        </label>
        <div className="flex items-center justify-between">
          <button
            onClick={handleSave}
            disabled={saving}
            className="rounded-md bg-neutral-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-neutral-800 disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
          {saved && <span className="text-xs text-emerald-600">Saved</span>}
        </div>
      </div>
    </div>
  );
}
