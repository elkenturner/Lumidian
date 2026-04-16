'use client';

import { CheckCircle2 } from 'lucide-react';
import { EmptyState, ContentTabPanelsProps } from './helpers';
import { PostedCard } from './cards/PostedCard';

export function PostedPanel(props: ContentTabPanelsProps) {
  const { visiblePostedItems, draftAttributions } = props;

  if (visiblePostedItems.length === 0) {
    return (
      <EmptyState
        icon={<CheckCircle2 size={26} className="text-[var(--accent-foreground)]" />}
        title="Nothing posted yet"
        description="Approved drafts will appear here once marked as posted."
      />
    );
  }
  const attributionByDraftId = new Map(draftAttributions.map((a) => [a.draft_id, a]));
  return (
    <div className="flex flex-col gap-2">
      {visiblePostedItems.map((d) => (
        <PostedCard key={d.id} draft={d} attribution={attributionByDraftId.get(d.id)} />
      ))}
    </div>
  );
}
