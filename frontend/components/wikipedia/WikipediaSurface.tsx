'use client';

import { useCallback, useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { listWikipediaCandidates, type WikipediaCandidate } from '@/lib/api';
import { CandidateCard } from './CandidateCard';
import { ScanButton } from './ScanButton';

interface Props {
  brandId: number;
}

type Filter = 'all' | WikipediaCandidate['status'];

const FILTERS: Filter[] = ['all', 'new', 'drafted', 'submitted', 'accepted', 'reverted'];

export function WikipediaSurface({ brandId }: Props) {
  const [candidates, setCandidates] = useState<WikipediaCandidate[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<Filter>('all');
  const [showDismissed, setShowDismissed] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const data = await listWikipediaCandidates(brandId);
      setCandidates(data);
    } finally {
      setLoading(false);
    }
  }, [brandId]);

  useEffect(() => {
    if (brandId) refresh();
  }, [brandId, refresh]);

  function onCandidateUpdated(updated: WikipediaCandidate) {
    setCandidates((prev) => prev.map((c) => (c.id === updated.id ? updated : c)));
  }

  const visible = candidates.filter((c) => {
    if (c.status === 'dismissed' && !showDismissed) return false;
    if (filter !== 'all' && c.status !== filter) return false;
    return true;
  });

  return (
    <div className="max-w-5xl mx-auto p-6">
      <header className="flex items-start justify-between gap-6 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Wikipedia opportunities</h1>
          <p className="mt-1 text-sm text-slate-500">
            Find existing Wikipedia pages where your brand can be cited authoritatively.
          </p>
        </div>
        <ScanButton brandId={brandId} onScanCompleted={refresh} />
      </header>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        {FILTERS.map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`rounded-md px-3 py-1 text-xs font-medium capitalize ${
              filter === f ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
            }`}
          >
            {f}
          </button>
        ))}
        <label className="ml-auto flex items-center gap-2 text-xs text-slate-600">
          <input
            type="checkbox"
            checked={showDismissed}
            onChange={(e) => setShowDismissed(e.target.checked)}
            className="h-3 w-3"
          />
          Show dismissed
        </label>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-slate-500">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading candidates…
        </div>
      ) : visible.length === 0 ? (
        <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 p-8 text-center">
          <p className="text-slate-700">
            {candidates.length === 0
              ? 'No scans yet. Click "Scan Wikipedia" to find candidate articles.'
              : 'No candidates match this filter.'}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4">
          {visible.map((c) => (
            <CandidateCard key={c.id} brandId={brandId} candidate={c} onUpdated={onCandidateUpdated} />
          ))}
        </div>
      )}
    </div>
  );
}
