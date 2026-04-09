import { DraftsPanel } from './DraftsPanel';
import { ScheduledPanel } from './ScheduledPanel';
import { OpportunitiesPanel } from './OpportunitiesPanel';
import { PostedPanel } from './PostedPanel';
import type { ContentTabPanelsProps } from './helpers';

export type { ContentTabPanelsProps };

export function ContentTabPanels(props: ContentTabPanelsProps) {
  const { activeTab } = props;
  if (activeTab === 'drafts') return <DraftsPanel {...props} />;
  if (activeTab === 'scheduled') return <ScheduledPanel {...props} />;
  if (activeTab === 'opportunities') return <OpportunitiesPanel {...props} />;
  if (activeTab === 'posted') return <PostedPanel {...props} />;
  return null;
}
