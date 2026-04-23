'use client';

import { HelpModal } from './HelpModal';

export function ImpactExplainerModal({ onClose }: { onClose: () => void }) {
  return (
    <HelpModal title="How impact tracking works" onClose={onClose}>
      <section className="flex flex-col gap-4">
        <div>
          <h4 className="text-sm font-semibold text-[var(--text-primary)] mb-1">What &ldquo;at posting &rarr; now&rdquo; means</h4>
          <p className="text-[13px] leading-relaxed">
            <span className="text-[var(--text-muted)]">At posting</span> is the brand&apos;s overall visibility score at the moment you clicked Mark as Posted.{' '}
            <span className="text-[var(--text-muted)]">Now</span> is the most recent score. The delta is the difference &mdash; a directional signal, not proof of causation.
          </p>
        </div>

        <div>
          <h4 className="text-sm font-semibold text-[var(--text-primary)] mb-1">Confidence tiers</h4>
          <ul className="text-[13px] leading-relaxed list-disc pl-5 space-y-0.5">
            <li><span className="text-[var(--text-muted)]">Awaiting next report</span> &mdash; posted, no tracking run has completed yet.</li>
            <li><span className="text-[var(--text-muted)]">Early data</span> &mdash; 1&ndash;2 runs since posting.</li>
            <li><span className="text-[var(--text-muted)]">Developing</span> &mdash; 3&ndash;5 runs, a trend is forming.</li>
            <li><span className="text-[var(--text-muted)]">Established</span> &mdash; 6+ runs, enough signal to observe a trend.</li>
          </ul>
        </div>

        <div>
          <h4 className="text-sm font-semibold text-[var(--text-primary)] mb-1">Correlation, not causation</h4>
          <p className="text-[13px] leading-relaxed">
            Visibility moves for many reasons beyond any single post. Treat the delta as a directional hint. Trends across multiple posts matter more than any one result.
          </p>
        </div>

        <div>
          <h4 className="text-sm font-semibold text-[var(--text-primary)] mb-1">Orphan drafts &amp; late-attach</h4>
          <p className="text-[13px] leading-relaxed">
            Drafts without a tracked prompt can&apos;t appear on a per-prompt graph. You can attach a prompt at post time or any time after. Late-attached drafts start tracking from the attach date &mdash; the historical baseline is unavailable.
          </p>
        </div>

        <div>
          <h4 className="text-sm font-semibold text-[var(--text-primary)] mb-1">Where to dig deeper</h4>
          <p className="text-[13px] leading-relaxed">
            Click any posted card to jump to the targeting prompt&apos;s detail timeline. The draft appears as a diamond marker &mdash; click it to see a side-by-side of the response before and after.
          </p>
        </div>
      </section>
    </HelpModal>
  );
}
