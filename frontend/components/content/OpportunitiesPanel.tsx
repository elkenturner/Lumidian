'use client';

import { motion } from 'framer-motion';
import { staggerContainer, staggerChild } from '@/lib/motion';
import {
  Radio,
  HelpCircle,
} from 'lucide-react';
import { EmptyState, ContentTabPanelsProps, PLATFORM_DISPLAY } from './helpers';
import { OpportunityCard } from './cards/OpportunityCard';

export function OpportunitiesPanel(props: ContentTabPanelsProps) {
  const {
    opportunities, visibleOpportunities, oppPlatformFilter, setOppPlatformFilter,
    handleDraftOpportunity, handleDismissOpportunity, draftStatus, setOppHelpOpen,
    _disabledPlatforms, draftItems, onNavigateToQueueDraft,
  } = props;

  const header = (
    <>
      <div className="flex items-center justify-between mb-4">
        <p className="text-xs text-[var(--text-muted)]">
          Live threads where your brand can gain visibility
        </p>
        <button
          onClick={() => setOppHelpOpen(true)}
          className="text-[var(--text-faint)] hover:text-[var(--accent)] transition-colors"
          title="How do Visibility Opportunities work?"
        >
          <HelpCircle size={14} />
        </button>
      </div>
    </>
  );

  const oppPlatforms = ['reddit', 'quora', 'linkedin', 'x'].filter((p) => !_disabledPlatforms.has(p));
  const oppFilterBar = oppPlatforms.length >= 2 ? (
    <div className="flex items-center gap-1 bg-[var(--bg-base)] border border-[var(--border-subtle)] rounded-lg p-0.5 mb-4 self-start overflow-x-auto" style={{ scrollbarWidth: 'none' }}>
      <button
        onClick={() => setOppPlatformFilter('all')}
        className={`px-2.5 py-1 rounded-md text-xs font-medium transition-[color,background-color] ${oppPlatformFilter === 'all' ? 'bg-[var(--bg-card)] text-[var(--accent-foreground)]' : 'text-[var(--text-faint)] hover:text-[var(--text-secondary)]'}`}
      >
        All
      </button>
      {oppPlatforms.map((p) => (
        <button
          key={p}
          onClick={() => setOppPlatformFilter(oppPlatformFilter === p ? 'all' : p)}
          className={`px-2.5 py-1 rounded-md text-xs font-medium transition-[color,background-color] ${oppPlatformFilter === p ? 'bg-[var(--bg-card)] text-[var(--accent-foreground)]' : 'text-[var(--text-faint)] hover:text-[var(--text-secondary)]'}`}
        >
          {PLATFORM_DISPLAY[p] ?? p}
        </button>
      ))}
    </div>
  ) : null;

  if (opportunities.length === 0) {
    return (
      <>
        {header}
        <EmptyState
          icon={<Radio size={26} className="text-[var(--accent-foreground)]" />}
          title="No live opportunities"
          description="Use &quot;Scan for Opportunities&quot; to find threads on Reddit, Quora, LinkedIn, and X matching your tracked prompts."
        />
      </>
    );
  }
  return (
    <>
      {header}
      {oppFilterBar}
      <motion.div
        variants={staggerContainer}
        initial="hidden"
        animate="visible"
        className="flex flex-col gap-3"
      >
        {visibleOpportunities.map((o) => (
          <motion.div key={o.id} variants={staggerChild}>
            <OpportunityCard
              opp={o}
              onDraft={handleDraftOpportunity}
              onDismiss={handleDismissOpportunity}
              queueFull={!!draftStatus?.draft_queue_full}
              draftedReply={draftItems.find((d) => d.opportunity_id === o.id) ?? null}
              onNavigateToDraft={onNavigateToQueueDraft}
            />
          </motion.div>
        ))}
        {visibleOpportunities.length === 0 && (
          <EmptyState
            icon={<Radio size={26} className="text-[var(--accent-foreground)]" />}
            title={oppPlatformFilter !== 'all' ? `No ${oppPlatformFilter} opportunities` : 'No opportunities'}
            description='Try "All" or switch platform.'
          />
        )}
      </motion.div>
    </>
  );
}
