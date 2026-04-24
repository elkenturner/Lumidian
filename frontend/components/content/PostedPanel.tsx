'use client';

import { CheckCircle2 } from 'lucide-react';
import { EmptyState, ContentTabPanelsProps } from './helpers';
import { PostedCard } from './cards/PostedCard';
import { PostedSummaryStrip } from '@/app/content/components';
import type { DraftAttribution } from '@/lib/api';

export function PostedPanel(props: ContentTabPanelsProps) {
  const {
    visiblePostedItems,
    draftAttributions,
    selectedBrandId,
    handleDelete,
    onOpenAttach,
    onOpenExplainer,
  } = props;

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
  const attributionsRecord: Record<number, DraftAttribution> = Object.fromEntries(
    draftAttributions.map((a) => [a.draft_id, a]),
  );

  const openExplainer = onOpenExplainer ?? (() => undefined);
  const openAttach = onOpenAttach ?? (() => undefined);

  return (
    <div className="flex flex-col">
      <PostedSummaryStrip
        postedItems={visiblePostedItems}
        attributions={attributionsRecord}
        onOpenExplainer={openExplainer}
      />
      <div className="flex flex-col gap-3">
        {visiblePostedItems.map((d) => (
          <PostedCard
            key={d.id}
            draft={d}
            brandId={selectedBrandId ?? 0}
            attribution={attributionByDraftId.get(d.id)}
            onDelete={handleDelete}
            onOpenAttach={openAttach}
            onOpenExplainer={openExplainer}
          />
        ))}
      </div>
    </div>
  );
}
