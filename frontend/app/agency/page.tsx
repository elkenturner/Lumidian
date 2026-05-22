'use client';

import { useEffect, useState } from 'react';
import { agencyMyQueue, type MyQueueResponse } from '@/lib/api';
import { MyQueueSection } from '@/components/agency/MyQueueSection';

export default function AgencyTodayPage() {
  const [queue, setQueue] = useState<MyQueueResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    agencyMyQueue()
      .then(setQueue)
      .catch((e) => setError(String(e?.message ?? e)));
  }, []);

  if (error) return <div className="p-8 text-sm text-red-400">{error}</div>;

  const total = queue ? queue.drafts.length + queue.tasks.length : 0;

  return (
    <div className="p-8 text-[var(--text-primary)]">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Today</h1>
        <p className="text-sm text-[var(--text-muted)]">
          {queue == null
            ? 'Loading…'
            : total === 0
              ? 'Nothing in your queue.'
              : `${total} item${total === 1 ? '' : 's'} in your queue`}
        </p>
      </div>

      <MyQueueSection />
    </div>
  );
}
