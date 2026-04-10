'use client';

import { Clock } from 'lucide-react';
import { EmptyState, ContentTabPanelsProps } from './helpers';
import { ScheduledCard } from './cards/ScheduledCard';

export function ScheduledPanel(props: ContentTabPanelsProps) {
  const { visibleScheduledItems, handleMarkAsPosted, handleMoveBackToDrafts } = props;

  if (visibleScheduledItems.length === 0) {
    return (
      <EmptyState
        icon={<Clock size={26} className="text-[var(--accent-foreground)]" />}
        title="Nothing scheduled yet"
        description="Approve a draft from the Drafts tab — it will appear here ready to post."
      />
    );
  }
  return (
    <div className="flex flex-col gap-3">
      {visibleScheduledItems.map((d) => (
        <ScheduledCard
          key={d.id}
          draft={d}
          onMarkPosted={handleMarkAsPosted}
          onMoveToDrafts={handleMoveBackToDrafts}
        />
      ))}
    </div>
  );
}
