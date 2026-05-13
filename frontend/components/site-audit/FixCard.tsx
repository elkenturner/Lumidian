'use client';

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  MapPin,
  RotateCcw,
  Sparkles,
  Check,
  X,
  AlertCircle,
  ChevronDown,
  CornerDownRight,
  ShieldCheck,
} from 'lucide-react';

import { siteAudit, type WebsiteAuditRecommendationOut } from '@/lib/api';
import { easings } from '@/lib/motion';
import { insertionHint } from '@/lib/insertion-hint';
import { FixCardCodeBlock } from './FixCardCodeBlock';
import { FixCardImplSteps } from './FixCardImplSteps';
import { RegenPopover } from './RegenPopover';

interface Props {
  rec: WebsiteAuditRecommendationOut;
  /** Static install steps from the recs registry, fetched via the parent. */
  implSteps?: string[];
  /** Notify parent when status changes (e.g. so the hero list can re-rank). */
  onStatusChange?: (newStatus: 'pending' | 'applied' | 'dismissed') => void;
  /** Compact = used in the hero. Default false = used in the full Fixes list. */
  compact?: boolean;
}

type DraftStatus = 'idle' | 'drafting' | 'done' | 'error';

const PRIORITY_PILL: Record<string, { label: string; bg: string; color: string }> = {
  high: {
    label: 'High impact',
    bg: 'var(--danger-text)',
    color: 'var(--bg-base)',
  },
  medium: {
    label: 'Medium impact',
    bg: 'var(--warning-text)',
    color: 'var(--bg-base)',
  },
  low: {
    label: 'Low impact',
    bg: 'var(--text-muted)',
    color: 'var(--bg-base)',
  },
};

const CATEGORY_LABEL: Record<string, string> = {
  bot_access: 'AI bot access',
  content: 'Content',
  schema: 'Schema',
  technical: 'Technical',
  authority: 'Authority',
};

export function FixCard({ rec, implSteps, onStatusChange, compact = false }: Props) {
  const [artifact, setArtifact] = useState<string | null>(rec.artifact ?? null);
  const [artifactType, setArtifactType] = useState<string | null>(rec.artifact_type ?? null);
  const [draftStatus, setDraftStatus] = useState<DraftStatus>(
    rec.artifact ? 'done' : 'idle'
  );
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [regenOpen, setRegenOpen] = useState(false);
  const [exiting, setExiting] = useState(false);
  const [stepsOpen, setStepsOpen] = useState(false);

  async function handleDraft(regenerateNotes?: string) {
    if (!rec.artifact_type) {
      setErrorMsg('This rec has no draftable artifact yet.');
      setDraftStatus('error');
      return;
    }
    setDraftStatus('drafting');
    setErrorMsg(null);
    try {
      const res = await siteAudit.draftRec(
        rec.id,
        regenerateNotes ? { regenerate_notes: regenerateNotes } : undefined,
      );
      setArtifact(res.artifact);
      setArtifactType(res.artifact_type);
      setDraftStatus('done');
    } catch (e: unknown) {
      const err = e as { response?: { status?: number; data?: { detail?: string } } };
      const detail = err?.response?.data?.detail;
      setErrorMsg(detail ?? 'Draft generation failed. Try again.');
      setDraftStatus('error');
    }
  }

  async function handleSetStatus(s: 'applied' | 'dismissed') {
    try {
      await siteAudit.setRecStatus(rec.id, s);
      setExiting(true);
      setTimeout(() => onStatusChange?.(s), 220);
    } catch {
      // Fall through silently — re-attempt allowed.
    }
  }

  const pill = PRIORITY_PILL[rec.priority] ?? PRIORITY_PILL.low;
  const drafted = draftStatus === 'done' && !!artifact;

  return (
    <AnimatePresence>
      {!exiting && (
        <motion.article
          layout
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 4, transition: { duration: 0.2, ease: easings.out } }}
          transition={{ layout: { type: 'spring', stiffness: 220, damping: 26 } }}
          className={`card ${compact ? '' : 'card-hover'}`}
        >
          {/* ── Header row ────────────────────────────────────────────────── */}
          <div className="flex items-center justify-between mb-3">
            <span
              className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wider"
              style={{ background: pill.bg, color: pill.color }}
            >
              {pill.label}
            </span>
            <span className="text-[11px] text-[var(--text-muted)]">
              {CATEGORY_LABEL[rec.category] ?? rec.category}
            </span>
          </div>

          {/* ── Title ─────────────────────────────────────────────────────── */}
          <h3 className="text-base font-semibold text-[var(--text-primary)] leading-snug">
            {rec.title}
          </h3>

          {/* ── Problem (why this is broken on YOUR site) ─────────────────── */}
          {!drafted && (
            <div className="mt-3">
              <p className="text-[10px] uppercase tracking-wider text-[var(--text-muted)] mb-1.5">
                The problem
              </p>
              <p className="text-sm text-[var(--text-secondary)] leading-relaxed whitespace-pre-line">
                {rec.body}
              </p>
            </div>
          )}

          {/* ── Where (exact insertion point) ─────────────────────────────── */}
          {!drafted && (rec.target_url || rec.artifact_type) && (
            <WhereBlock targetUrl={rec.target_url} artifactType={rec.artifact_type} />
          )}

          {/* ── Lift + effort row ─────────────────────────────────────────── */}
          {!drafted && (rec.expected_lift_pp != null || rec.effort) && (
            <div className="mt-3 flex items-center gap-4 text-xs text-[var(--text-faint)]">
              {rec.expected_lift_pp != null && (
                <span className="inline-flex items-center gap-1">
                  <Sparkles size={12} style={{ color: 'var(--accent-light)' }} />
                  <span className="tabular-nums">
                    +{rec.expected_lift_pp.toFixed(0)} pts expected
                  </span>
                </span>
              )}
              {rec.effort && (
                <span>· {effortLabel(rec.effort)}</span>
              )}
            </div>
          )}

          {/* ── State A action (collapsed) ────────────────────────────────── */}
          {draftStatus === 'idle' && (
            <div className="mt-4 relative flex justify-end">
              <button
                type="button"
                onClick={() => handleDraft()}
                disabled={!rec.artifact_type}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium text-white disabled:opacity-50 disabled:cursor-not-allowed transition-transform"
                style={{ background: 'var(--accent)' }}
              >
                <Sparkles size={14} />
                {rec.artifact_type ? 'Draft this' : 'No artifact'}
              </button>
            </div>
          )}

          {/* ── State B (drafting skeleton) ───────────────────────────────── */}
          <AnimatePresence>
            {draftStatus === 'drafting' && (
              <motion.div
                key="drafting"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.18, ease: easings.out }}
                className="mt-4 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-base)] p-4"
              >
                <p className="text-xs text-[var(--text-muted)] mb-3 flex items-center gap-2">
                  <Sparkles size={13} className="animate-pulse" style={{ color: 'var(--accent-light)' }} />
                  Drafting your {humanType(rec.artifact_type)}…
                </p>
                <div className="space-y-2">
                  <Shimmer width="100%" />
                  <Shimmer width="92%" />
                  <Shimmer width="68%" />
                  <Shimmer width="84%" />
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* ── State C (drafted) ─────────────────────────────────────────── */}
          <AnimatePresence>
            {drafted && artifact && artifactType && (
              <motion.div
                key="drafted"
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 4 }}
                transition={{ duration: 0.22, ease: easings.out }}
                className="mt-4 relative"
              >
                <FixCardCodeBlock artifact={artifact} artifactType={artifactType} />

                {/* Insertion hint — where to paste */}
                <InsertionHintRow artifactType={artifactType} targetUrl={rec.target_url} />

                {/* Regen button */}
                <div className="flex justify-end mt-2">
                  <button
                    type="button"
                    onClick={() => setRegenOpen(true)}
                    className="inline-flex items-center gap-1.5 text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                  >
                    <RotateCcw size={12} />
                    Regenerate
                    {rec.artifact_regen_count > 0 && (
                      <span className="tabular-nums text-[var(--text-faint)]">
                        ({rec.artifact_regen_count})
                      </span>
                    )}
                  </button>
                  <RegenPopover
                    open={regenOpen}
                    onClose={() => setRegenOpen(false)}
                    onSubmit={(notes) => {
                      setRegenOpen(false);
                      handleDraft(notes || undefined);
                    }}
                  />
                </div>

                {/* Why-it-matters collapsed by default once drafted */}
                <button
                  type="button"
                  onClick={() => setStepsOpen((v) => !v)}
                  className="mt-4 inline-flex items-center gap-1 text-xs text-[var(--text-muted)] hover:text-[var(--text-primary)]"
                >
                  <ChevronDown
                    size={12}
                    className="transition-transform"
                    style={{ transform: stepsOpen ? 'rotate(0deg)' : 'rotate(-90deg)' }}
                  />
                  Why this matters · how to install
                </button>
                <AnimatePresence>
                  {stepsOpen && (
                    <motion.div
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: 'auto' }}
                      exit={{ opacity: 0, height: 0 }}
                      transition={{ duration: 0.22, ease: easings.out }}
                      className="overflow-hidden"
                    >
                      <p className="text-sm text-[var(--text-secondary)] mt-3 leading-relaxed whitespace-pre-line">
                        {rec.body}
                      </p>
                      <FixCardImplSteps steps={implSteps ?? []} />
                    </motion.div>
                  )}
                </AnimatePresence>

                {/* Terminal actions */}
                <div className="mt-4 flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => handleSetStatus('applied')}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors"
                    style={{
                      background: 'var(--success-muted)',
                      borderColor: 'var(--success)',
                      color: 'var(--success-text)',
                    }}
                  >
                    <Check size={14} />
                    Mark applied
                  </button>
                  <button
                    type="button"
                    onClick={() => handleSetStatus('dismissed')}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm text-[var(--text-muted)] hover:text-[var(--text-primary)]"
                  >
                    <X size={14} />
                    Not now
                  </button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* ── State error ───────────────────────────────────────────────── */}
          {draftStatus === 'error' && (
            <div
              className="mt-4 rounded-lg p-3 text-sm flex items-start gap-2"
              style={{
                background: 'rgba(248, 113, 113, 0.1)',
                border: '1px solid var(--danger-text)',
                color: 'var(--danger-text)',
              }}
            >
              <AlertCircle size={14} className="mt-0.5 shrink-0" />
              <div className="flex-1">
                <p>{errorMsg}</p>
                <button
                  type="button"
                  onClick={() => handleDraft()}
                  className="mt-2 text-xs underline"
                >
                  Try again
                </button>
              </div>
            </div>
          )}
        </motion.article>
      )}
    </AnimatePresence>
  );
}

// ── Where block (collapsed-state insertion guidance) ───────────────────────

function WhereBlock({
  targetUrl,
  artifactType,
}: {
  targetUrl: string | null;
  artifactType: string | null;
}) {
  const hint = insertionHint(artifactType);
  if (!targetUrl && !hint) return null;
  return (
    <div
      className="mt-3 rounded-md p-3 text-xs"
      style={{
        background: 'var(--bg-base)',
        border: '1px solid var(--border-subtle)',
      }}
    >
      <p className="text-[10px] uppercase tracking-wider text-[var(--text-muted)] mb-1.5 flex items-center gap-1">
        <MapPin size={11} />
        Where it goes
      </p>
      {targetUrl && (
        <p className="font-mono text-[var(--text-primary)] truncate">
          {urlPath(targetUrl)}
        </p>
      )}
      {hint && (
        <p className="text-[var(--text-secondary)] mt-1 leading-relaxed flex gap-1.5">
          <CornerDownRight
            size={11}
            className="mt-0.5 shrink-0 text-[var(--text-muted)]"
          />
          <span>{hint.where}</span>
        </p>
      )}
    </div>
  );
}

// ── Insertion-hint row (drafted state, above install steps) ────────────────

function InsertionHintRow({
  artifactType,
  targetUrl,
}: {
  artifactType: string;
  targetUrl: string | null;
}) {
  const hint = insertionHint(artifactType);
  if (!hint) return null;
  return (
    <div className="mt-3 text-xs text-[var(--text-secondary)] leading-relaxed">
      <p className="flex gap-1.5">
        <CornerDownRight
          size={12}
          className="mt-0.5 shrink-0 text-[var(--text-muted)]"
        />
        <span>
          {targetUrl && (
            <span className="font-mono text-[var(--text-primary)]">
              {urlPath(targetUrl)}
            </span>
          )}
          {targetUrl && ' — '}
          {hint.where}
        </span>
      </p>
      {hint.validate && (
        <p className="flex gap-1.5 mt-1.5 text-[var(--text-muted)]">
          <ShieldCheck size={12} className="mt-0.5 shrink-0" />
          <span>{hint.validate}</span>
        </p>
      )}
    </div>
  );
}

// ── Utilities ───────────────────────────────────────────────────────────────

function Shimmer({ width }: { width: string }) {
  return (
    <div
      className="h-3 rounded animate-pulse"
      style={{ width, background: 'rgba(255,255,255,0.06)' }}
    />
  );
}

function urlPath(u: string): string {
  try {
    const url = new URL(u);
    return url.pathname || '/';
  } catch {
    return u;
  }
}

function effortLabel(e: string): string {
  return { low: '~5 min', medium: '~20 min', high: '~1 hr' }[e] ?? e;
}

function humanType(t: string | null): string {
  if (!t) return 'artifact';
  return (
    {
      jsonld_org: 'Organization schema',
      jsonld_faq: 'FAQ schema',
      jsonld_article: 'Article schema',
      jsonld_breadcrumb: 'Breadcrumb schema',
      jsonld_product: 'Product schema',
      jsonld_howto: 'HowTo schema',
      meta_title: 'page title',
      meta_description: 'meta description',
      h1_text: 'H1',
      og_tags: 'Open Graph tags',
      faq_section: 'FAQ section',
      section_rewrite: 'section rewrite',
      new_page_draft: 'new page draft',
      alt_text_batch: 'alt text',
      llms_txt: 'llms.txt',
      robots_snippet: 'robots.txt snippet',
      agents_md: 'agents.md',
      internal_link_suggestions: 'link suggestions',
    }[t] ?? t.replace(/_/g, ' ')
  );
}
