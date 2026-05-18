'use client';

import { useCallback, useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

import { getBrand, siteAudit, type BrandDetail, type WebsiteAuditPageOut, type WebsiteAuditSummary } from '@/lib/api';
import { easings } from '@/lib/motion';

import { AuditHeader } from './AuditHeader';
import { AuditTriggerButton } from './AuditTriggerButton';
import { AuditHistoryList } from './AuditHistoryList';
import { EmptyCrawlBanner } from './EmptyCrawlBanner';
import { FixGrid } from './FixGrid';
import { HistorySparkline } from './HistorySparkline';
import { OverviewHero } from './OverviewHero';
import { PageDetail } from './PageDetail';
import { PageTable } from './PageTable';
import { RenderModeBanner } from './RenderModeBanner';
import { SchemaAndBotsTab } from './SchemaAndBotsTab';
import { ScoreStrip } from './ScoreStrip';
import { StaleAuditBanner } from './StaleAuditBanner';
import { AuditMetaProvider } from './AuditMetaContext';

interface Props {
  brandId: number;
}

type TabId = 'overview' | 'fixes' | 'pages' | 'schema_bots';

const TABS: { id: TabId; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'fixes', label: 'Fixes' },
  { id: 'pages', label: 'Pages' },
  { id: 'schema_bots', label: 'Schema & Bots' },
];

export function SiteAuditView({ brandId }: Props) {
  const [audit, setAudit] = useState<WebsiteAuditSummary | null | undefined>(undefined);
  const [brand, setBrand] = useState<BrandDetail | null>(null);
  const [tab, setTab] = useState<TabId>('overview');
  const [selectedPageId, setSelectedPageId] = useState<number | null>(null);
  const [homepagePage, setHomepagePage] = useState<WebsiteAuditPageOut | null>(null);

  const loadLatest = useCallback(async () => {
    try {
      const a = await siteAudit.latest(brandId);
      setAudit(a);
    } catch (e: unknown) {
      const err = e as { response?: { status?: number } };
      if (err?.response?.status === 404) setAudit(null);
      else throw e;
    }
  }, [brandId]);

  useEffect(() => {
    loadLatest();
    getBrand(brandId).then(setBrand).catch(() => setBrand(null));
  }, [brandId, loadLatest]);

  // Load homepage page for render-mode banner once the audit completes.
  useEffect(() => {
    if (!audit || audit.status !== 'completed') return;
    siteAudit
      .pages(audit.id, { per_page: 1, sort: 'url' })
      .then((rows) => setHomepagePage(rows[0] ?? null))
      .catch(() => setHomepagePage(null));
  }, [audit]);

  // Poll while in-flight
  useEffect(() => {
    if (!audit || ['completed', 'failed', 'cancelled'].includes(audit.status)) return;
    const t = setInterval(loadLatest, 4000);
    return () => clearInterval(t);
  }, [audit, loadLatest]);

  // Loading state
  if (audit === undefined) {
    return (
      <div className="p-8 max-w-6xl">
        <div className="card h-24 animate-pulse" style={{ background: 'rgba(255,255,255,0.02)' }} />
      </div>
    );
  }

  // First-run empty state
  if (audit === null) {
    return (
      <div className="p-8 max-w-3xl">
        <div className="card-elevated">
          <h1 className="text-2xl font-semibold text-[var(--text-primary)]">Site Audit</h1>
          <p className="text-sm text-[var(--text-secondary)] mt-2 leading-relaxed">
            Audit your site for AI-search visibility — semantic structure, schema markup,
            AI-bot accessibility, and which competitor pages are winning the prompts you lose
            on. Each finding turns into a draftable, paste-ready artifact you can apply in
            minutes.
          </p>
          <div className="mt-6">
            <AuditTriggerButton brandId={brandId} onTriggered={loadLatest} />
          </div>
        </div>
      </div>
    );
  }

  const inFlight = !['completed', 'failed', 'cancelled'].includes(audit.status);

  const promptsById: Record<number, string> = {};
  for (const p of brand?.prompts ?? []) {
    promptsById[p.id] = p.text;
  }

  return (
    <AuditMetaProvider promptsById={promptsById} cmsPlatform={audit.cms_platform ?? null}>
    <div className="p-6 sm:p-8 max-w-6xl">
      <AuditHeader
        audit={audit}
        brandUrl={brand?.website_url ?? null}
        inFlight={inFlight}
        onRunNewAudit={async () => {
          try {
            await siteAudit.trigger(brandId);
            loadLatest();
          } catch {
            // surface via the empty-state path if needed; the header button is non-fatal
          }
        }}
        onCancel={loadLatest}
      />

      {/* Tabs — keyboard nav: ← / → / Home / End */}
      <nav
        role="tablist"
        aria-label="Site audit sections"
        className="flex gap-1 border-b border-[var(--border-subtle)] mb-6 overflow-x-auto"
        onKeyDown={(e) => {
          if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return;
          e.preventDefault();
          const idx = TABS.findIndex((t) => t.id === tab);
          let next = idx;
          if (e.key === 'ArrowLeft') next = (idx - 1 + TABS.length) % TABS.length;
          else if (e.key === 'ArrowRight') next = (idx + 1) % TABS.length;
          else if (e.key === 'Home') next = 0;
          else if (e.key === 'End') next = TABS.length - 1;
          setTab(TABS[next].id);
          setSelectedPageId(null);
          const btn = e.currentTarget.querySelectorAll<HTMLButtonElement>('button[role="tab"]')[next];
          btn?.focus();
        }}
      >
        {TABS.map((t) => {
          const active = tab === t.id;
          return (
            <button
              key={t.id}
              role="tab"
              aria-selected={active}
              tabIndex={active ? 0 : -1}
              onClick={() => {
                setTab(t.id);
                setSelectedPageId(null);
              }}
              className={`relative px-4 py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-light)] rounded-t ${
                active ? 'text-[var(--text-primary)]' : 'text-[var(--text-muted)] hover:text-[var(--text-secondary)]'
              }`}
            >
              {t.label}
              {active && (
                <motion.div
                  layoutId="audit-tab-indicator"
                  className="absolute left-0 right-0 -bottom-px h-0.5"
                  style={{ background: 'var(--accent-light)' }}
                  transition={{ type: 'spring', stiffness: 380, damping: 32 }}
                />
              )}
            </button>
          );
        })}
      </nav>

      {/* Empty-crawl banner — fires when an otherwise-completed audit captured 0 pages */}
      {audit.status === 'completed' && (audit.total_pages ?? 0) === 0 && (
        <EmptyCrawlBanner
          brandId={brandId}
          brandUrl={brand?.website_url ?? null}
          errorMessage={audit.error_message ?? null}
          pagesFailed={audit.pages_failed ?? 0}
          onTriggered={loadLatest}
        />
      )}

      {/* Render-mode warning banner (always above content when applicable) */}
      {homepagePage?.is_js_rendered && (
        <RenderModeBanner isJsRendered brandUrl={brand?.website_url ?? null} />
      )}

      {/* Stale audit banner — most recs missing target_url OR >14 days old */}
      {audit.status === 'completed' && (audit.total_pages ?? 0) > 0 && (
        <StaleAuditBanner
          auditId={audit.id}
          brandId={brandId}
          startedAt={audit.started_at}
          onTriggered={loadLatest}
        />
      )}

      <AnimatePresence mode="wait">
        <motion.div
          key={tab}
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -2 }}
          transition={{ duration: 0.18, ease: easings.out }}
        >
          {tab === 'overview' && (
            <div className="space-y-6">
              <OverviewHero auditId={audit.id} onSeeAll={() => setTab('fixes')} />
              <ScoreStrip audit={audit} />
              <HistorySparkline brandId={brandId} />
              <AuditHistoryList brandId={brandId} />
            </div>
          )}
          {tab === 'fixes' && <FixGrid auditId={audit.id} />}
          {tab === 'pages' && (
            selectedPageId === null ? (
              <PageTable auditId={audit.id} onSelect={setSelectedPageId} />
            ) : (
              <PageDetail
                auditId={audit.id}
                pageId={selectedPageId}
                onBack={() => setSelectedPageId(null)}
              />
            )
          )}
          {tab === 'schema_bots' && (
            <SchemaAndBotsTab
              auditId={audit.id}
              brandId={brandId}
              llmsTxtPresent={audit.llms_txt_present}
              llmsTxtValid={audit.llms_txt_valid}
              robotsTxtRaw={audit.robots_txt_raw}
              onJumpToFixes={() => setTab('fixes')}
            />
          )}
        </motion.div>
      </AnimatePresence>
    </div>
    </AuditMetaProvider>
  );
}
