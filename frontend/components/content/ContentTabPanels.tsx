import { AnimatePresence, motion } from 'framer-motion';
import { slideIn } from '@/lib/motion';
import { DraftsPanel } from './DraftsPanel';
import { ScheduledPanel } from './ScheduledPanel';
import { OpportunitiesPanel } from './OpportunitiesPanel';
import { PostedPanel } from './PostedPanel';
import type { ContentTabPanelsProps } from './helpers';

export type { ContentTabPanelsProps };

export function ContentTabPanels(props: ContentTabPanelsProps) {
  const { activeTab } = props;

  let panel: React.ReactNode = null;
  if (activeTab === 'drafts') panel = <DraftsPanel {...props} />;
  else if (activeTab === 'scheduled') panel = <ScheduledPanel {...props} />;
  else if (activeTab === 'opportunities') panel = <OpportunitiesPanel {...props} />;
  else if (activeTab === 'posted') panel = <PostedPanel {...props} />;

  return (
    <AnimatePresence mode="wait">
      <motion.div
        key={activeTab}
        variants={slideIn}
        initial="hidden"
        animate="visible"
        exit="exit"
      >
        {panel}
      </motion.div>
    </AnimatePresence>
  );
}
