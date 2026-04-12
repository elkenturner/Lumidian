'use client';

import { motion } from 'framer-motion';
import { staggerContainer, staggerChild } from '@/lib/motion';
import {
  FileText,
  Loader2,
  Zap,
  RefreshCw,
  CheckCircle2,
} from 'lucide-react';
import {
  EmptyState,
  ContentTabPanelsProps,
  PLATFORM_DISPLAY,
  generateAvailableLabel,
  computeUrgency,
} from './helpers';
import { DraftCard } from './cards/DraftCard';
import { WikipediaDraftCard } from './cards/WikipediaDraftCard';

export function DraftsPanel(props: ContentTabPanelsProps) {
  const {
    brands, selectedBrandId, draftItems, _disabledPlatforms, draftPlatformFilter,
    setDraftPlatformFilter, visibleDraftItems, pinnedDraftId, brandProfile, brandPrompts,
    postedItems, draftStatus, generating, reportRunning, handleGenerateNow, handleApprove,
    handleDelete, handleSaved, setDraftItems, user, onRequestDraft, handleApproveAll,
  } = props;

  const selectedBrand = brands.find((b) => b.id === selectedBrandId);
  const brandName = selectedBrand?.name ?? '';

  const draftPlatforms = Array.from(new Set(
    draftItems.filter((d) => !_disabledPlatforms.has(d.platform)).map((d) => d.platform)
  )).sort();

  const canRequestDraft = onRequestDraft && (user?.subscription_tier || user?.is_admin);

  const filterBar = (
    <div className="flex items-center justify-between mb-4">
      {draftPlatforms.length >= 2 ? (
        <div className="flex items-center gap-1 bg-[var(--bg-base)] border border-[var(--border-subtle)] rounded-lg p-0.5 self-start">
          <button
            onClick={() => setDraftPlatformFilter('all')}
            className={`px-2.5 py-1 rounded-md text-xs font-medium transition-[color,background-color] ${draftPlatformFilter === 'all' ? 'bg-[var(--bg-card)] text-[var(--accent-foreground)]' : 'text-[var(--text-faint)] hover:text-[var(--text-secondary)]'}`}
          >
            All
          </button>
          {draftPlatforms.map((p) => (
            <button
              key={p}
              onClick={() => setDraftPlatformFilter(draftPlatformFilter === p ? 'all' : p)}
              className={`px-2.5 py-1 rounded-md text-xs font-medium transition-[color,background-color] ${draftPlatformFilter === p ? 'bg-[var(--bg-card)] text-[var(--accent-foreground)]' : 'text-[var(--text-faint)] hover:text-[var(--text-secondary)]'}`}
            >
              {PLATFORM_DISPLAY[p] ?? p}
            </button>
          ))}
        </div>
      ) : <div />}
      <div className="flex items-center gap-3">
        {handleApproveAll && visibleDraftItems.length > 0 && (
          <button
            onClick={handleApproveAll}
            className="flex items-center gap-1.5 text-xs text-[var(--success)] hover:text-[color-mix(in_srgb,var(--success)_80%,white)] transition-colors"
          >
            <CheckCircle2 size={13} />
            Approve All{draftPlatformFilter !== 'all' ? ` ${PLATFORM_DISPLAY[draftPlatformFilter] ?? draftPlatformFilter}` : ''}
          </button>
        )}
        {canRequestDraft && (
          <button
            onClick={onRequestDraft}
            className="flex items-center gap-1.5 text-xs text-[var(--text-muted)] hover:text-[var(--accent-foreground)] transition-colors"
          >
            <span className="w-5 h-5 rounded-md bg-[rgba(95,126,166,0.08)] border border-[rgba(95,126,166,0.15)] flex items-center justify-center text-[var(--accent-foreground)]">+</span>
            New draft
          </button>
        )}
      </div>
    </div>
  );

  if (visibleDraftItems.length === 0) {
    return (
      <>
        {filterBar}
        <EmptyState
          icon={<FileText size={48} className="text-[var(--accent-foreground)]" />}
          title={draftPlatformFilter !== 'all' ? `No ${draftPlatformFilter} drafts` : 'No drafts yet'}
          description={draftPlatformFilter !== 'all' ? 'Try switching to "All" or generate new drafts.' : 'Use "Regenerate Drafts" or request a custom draft to get started.'}
          action={draftPlatformFilter === 'all' && (user?.subscription_tier || user?.is_admin) ? (() => {
            const cooldownLabel = generateAvailableLabel(draftStatus?.next_generate_at ?? null);
            const onCooldown = !!cooldownLabel;
            return (
              <div className="flex flex-col items-center gap-1.5">
                <button
                  onClick={handleGenerateNow}
                  disabled={generating || !!draftStatus?.draft_queue_full || onCooldown}
                  className="flex items-center gap-2 bg-[var(--accent)] hover:bg-[var(--accent-hover)] disabled:opacity-40 disabled:cursor-not-allowed text-white rounded-xl px-6 py-3 text-sm font-semibold transition-[background-color,box-shadow] duration-200 shadow-lg shadow-[var(--accent)]/30 hover:shadow-[var(--accent)]/45"
                >
                  {generating ? <Loader2 size={14} className="animate-spin" /> : <Zap size={14} />}
                  {generating ? 'Generating…' : 'Regenerate Drafts'}
                </button>
                {onCooldown && (
                  <p className="text-xs text-[var(--text-faint)]">{cooldownLabel}</p>
                )}
              </div>
            );
          })() : undefined}
        />
      </>
    );
  }

  const sorted = [...visibleDraftItems].sort((a, b) => {
    if (a.id === pinnedDraftId) return -1;
    if (b.id === pinnedDraftId) return 1;
    return computeUrgency(b, postedItems).score - computeUrgency(a, postedItems).score;
  });

  return (
    <div className="flex flex-col gap-3">
      {filterBar}
      <div className="flex items-start gap-2 bg-[var(--bg-base)] border border-[var(--border-subtle)] rounded-lg px-3 py-2.5">
        <RefreshCw size={12} className="text-[var(--text-faint)] flex-shrink-0 mt-0.5" />
        <p className="text-xs text-[var(--text-faint)]">
          Unreviewed drafts are replaced when new drafts are generated. Move anything you want to keep to <span className="text-[var(--text-secondary)]">Saved Drafts</span> first.
        </p>
      </div>
      <motion.div
        variants={staggerContainer}
        initial="hidden"
        animate="visible"
        className="flex flex-col gap-3"
      >
        {sorted.map((d) =>
          d.platform === 'wikipedia' ? (
            <motion.div key={d.id} variants={staggerChild}>
              <WikipediaDraftCard
                draft={d}
                brandName={brandName}
                profile={brandProfile}
                onApprove={handleApprove}
                onDelete={handleDelete}
                onSaved={handleSaved}
              />
            </motion.div>
          ) : (
            <motion.div key={d.id} variants={staggerChild}>
              <DraftCard
                draft={d}
                profile={brandProfile}
                brandName={brandName}
                postedItems={postedItems}
                prompts={brandPrompts}
                brandId={selectedBrandId!}
                reportRunning={reportRunning}
                onApprove={handleApprove}
                onDelete={handleDelete}
                onSaved={handleSaved}
                onRegenerated={(fresh) => setDraftItems((prev) => [fresh, ...prev])}
              />
            </motion.div>
          )
        )}
      </motion.div>
    </div>
  );
}
