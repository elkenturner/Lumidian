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
  } = props;

  const header = (
    <>
      <div className="flex items-center justify-between mb-4">
        <p className="text-xs text-[var(--text-muted)]">
          Threads and questions matched to your tracked prompts
        </p>
        <button
          onClick={() => setOppHelpOpen(true)}
          className="text-[var(--text-faint)] hover:text-[var(--accent)] transition-colors"
          title="How do Live Opportunities work?"
        >
          <HelpCircle size={14} />
        </button>
      </div>
    </>
  );

  const oppPlatforms = ['reddit', 'quora', 'linkedin', 'x'];
  const oppFilterBar = oppPlatforms.length >= 2 ? (
    <div className="flex items-center gap-1 bg-[var(--bg-base)] border border-[var(--border-subtle)] rounded-lg p-0.5 mb-4 self-start">
      <button
        onClick={() => setOppPlatformFilter('all')}
        className={`px-2.5 py-1 rounded-md text-xs font-medium transition-all ${oppPlatformFilter === 'all' ? 'bg-[var(--bg-card)] text-[var(--accent-foreground)]' : 'text-[var(--text-faint)] hover:text-[var(--text-secondary)]'}`}
      >
        All
      </button>
      {oppPlatforms.map((p) => (
        <button
          key={p}
          onClick={() => setOppPlatformFilter(oppPlatformFilter === p ? 'all' : p)}
          className={`px-2.5 py-1 rounded-md text-xs font-medium transition-all ${oppPlatformFilter === p ? 'bg-[var(--bg-card)] text-[var(--accent-foreground)]' : 'text-[var(--text-faint)] hover:text-[var(--text-secondary)]'}`}
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
          description="Reddit and Quora are scanned daily. Check back after the next scan or run a tracking report to generate fresh prompts."
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
