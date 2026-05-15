'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { motion } from 'framer-motion';
import { Sparkles, ArrowRight } from 'lucide-react';
import { siteAudit, type CitationsOverview } from '@/lib/api';
import { easings } from '@/lib/motion';
import { CitationStackedBar } from './CitationStackedBar';
import { CitationTopDomains } from './CitationTopDomains';
import { AuditHistoryList } from './AuditHistoryList';

interface Props {
  brandId: number;
}

export function CitationsTab({ brandId }: Props) {
  const [data, setData] = useState<CitationsOverview | null>(null);

  useEffect(() => {
    siteAudit.citations(brandId).then(setData).catch(() => setData(null));
  }, [brandId]);

  if (!data) {
    return <div className="card h-40 animate-pulse" style={{ background: 'rgba(255,255,255,0.02)' }} />;
  }

  const hasCitations = data.by_domain.length > 0;

  return (
    <div className="space-y-6">
      {hasCitations ? (
        <CitationsContent data={data} brandId={brandId} />
      ) : (
        <CitationsEmptyState brandId={brandId} />
      )}
      <AuditHistoryList brandId={brandId} />
    </div>
  );
}

function CitationsContent({ data, brandId }: { data: CitationsOverview; brandId: number }) {
  const total = data.by_domain.reduce((a, b) => a + b.count, 0) || 1;
  const thirdPartyCount = data.by_domain
    .filter((r) => r.kind === 'third_party')
    .reduce((a, b) => a + b.count, 0);
  const unknownCount = data.by_domain
    .filter((r) => r.kind === 'unknown')
    .reduce((a, b) => a + b.count, 0);
  const thirdPartyPct = (thirdPartyCount / total) * 100;
  const unknownPct = (unknownCount / total) * 100;
  return (
    <>
      <CitationStackedBar
        ownPct={data.own_pct}
        competitorPct={data.competitor_pct}
        thirdPartyPct={thirdPartyPct}
        unknownPct={unknownPct}
      />
      <CitationTopDomains rows={data.by_domain} />
    </>
  );
}

function CitationsEmptyState({ brandId }: { brandId: number }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, ease: easings.out }}
      className="card-elevated"
    >
      <div className="flex items-start gap-3">
        <Sparkles
          size={20}
          className="shrink-0 mt-0.5"
          style={{ color: 'var(--accent-light)' }}
        />
        <div className="flex-1">
          <h3 className="text-base font-semibold text-[var(--text-primary)]">
            No citations captured yet
          </h3>
          <p className="text-sm text-[var(--text-secondary)] mt-1 leading-relaxed">
            Citations are URLs that ChatGPT, Claude, Perplexity, and Gemini point users to when
            answering questions about your brand. We extract them from your tracking run responses
            — but this brand hasn't been tracked recently, so the chart is empty.
          </p>

          <div className="mt-4 grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
            <SamplePill
              dot="var(--success)"
              label="You"
              hint="Citations that point back to your own domain. This is what you want to grow."
            />
            <SamplePill
              dot="var(--danger-text)"
              label="Competitor"
              hint="AI is citing a domain you tagged as a competitor instead of you. Your gap."
            />
            <SamplePill
              dot="var(--color-perplexity)"
              label="Third-party"
              hint="Wikipedia, G2, LinkedIn, YouTube, Reddit — neutral authority sites."
            />
          </div>

          <div className="mt-4 flex flex-wrap gap-3">
            <Link
              href="/dashboard"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium text-white"
              style={{ background: 'var(--accent)' }}
            >
              Run a tracking session
              <ArrowRight size={14} />
            </Link>
            <p className="text-xs text-[var(--text-muted)] self-center">
              One tracking run will populate this view with real citation data.
            </p>
          </div>
        </div>
      </div>
    </motion.div>
  );
}

function SamplePill({ dot, label, hint }: { dot: string; label: string; hint: string }) {
  return (
    <div
      className="rounded-md p-3"
      style={{ background: 'var(--bg-base)', border: '1px solid var(--border-subtle)' }}
    >
      <div className="flex items-center gap-2">
        <span className="inline-block w-2 h-2 rounded-full" style={{ background: dot }} />
        <p className="text-xs font-semibold text-[var(--text-primary)]">{label}</p>
      </div>
      <p className="text-[11px] text-[var(--text-secondary)] mt-1 leading-relaxed">{hint}</p>
    </div>
  );
}
