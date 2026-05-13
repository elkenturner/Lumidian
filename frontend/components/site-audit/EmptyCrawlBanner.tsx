'use client';

import { motion } from 'framer-motion';
import { AlertOctagon, RefreshCw } from 'lucide-react';
import { easings } from '@/lib/motion';
import { AuditTriggerButton } from './AuditTriggerButton';

interface Props {
  brandId: number;
  brandUrl: string | null;
  errorMessage: string | null;
  pagesFailed: number;
  onTriggered: () => void;
}

/**
 * Shown above the score strip when an audit completed but captured 0 pages.
 * Explains the most common causes in plain English and offers a re-run CTA.
 */
export function EmptyCrawlBanner({
  brandId,
  brandUrl,
  errorMessage,
  pagesFailed,
  onTriggered,
}: Props) {
  const apex = brandUrl ? safeHost(brandUrl) : null;
  const wwwGuess = apex && !apex.startsWith('www.') ? `www.${apex}` : null;

  return (
    <motion.div
      initial={{ opacity: 0, y: -6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, ease: easings.out }}
      className="mb-6 rounded-lg p-5"
      style={{
        background: 'rgba(239, 68, 68, 0.08)',
        border: '1px solid var(--danger-text)',
      }}
    >
      <div className="flex items-start gap-3">
        <AlertOctagon
          size={20}
          className="shrink-0 mt-0.5"
          style={{ color: 'var(--danger-text)' }}
        />
        <div className="flex-1 text-sm">
          <p className="font-semibold" style={{ color: 'var(--danger-text)' }}>
            This audit captured 0 pages
          </p>
          <p className="text-[var(--text-secondary)] mt-1 leading-relaxed">
            The crawler reached your site but couldn't extract any pages, so Content, Schema,
            and Technical scores stayed at 0. The most common cause:
          </p>

          <ul className="mt-3 space-y-2 text-[var(--text-secondary)]">
            {apex && wwwGuess && (
              <li className="flex gap-2 items-baseline">
                <span style={{ color: 'var(--warning-text)' }}>▸</span>
                <span>
                  <strong>Apex/www mismatch.</strong> The brand URL is{' '}
                  <code className="font-mono px-1 py-0.5 rounded bg-[var(--bg-base)]">
                    {apex}
                  </code>{' '}
                  but your site may 301-redirect to{' '}
                  <code className="font-mono px-1 py-0.5 rounded bg-[var(--bg-base)]">
                    {wwwGuess}
                  </code>
                  . Try updating the brand's website URL to the canonical version (the one
                  shown in the browser bar after visiting).
                </span>
              </li>
            )}
            <li className="flex gap-2 items-baseline">
              <span style={{ color: 'var(--warning-text)' }}>▸</span>
              <span>
                <strong>JS-only homepage.</strong> If the site renders entirely in the browser
                (SPA / client-side), our crawler can't see the content. Run a render-mode
                check at{' '}
                {brandUrl && (
                  <code className="font-mono px-1 py-0.5 rounded bg-[var(--bg-base)]">
                    curl -s {safeHost(brandUrl)}
                  </code>
                )}{' '}
                — if the main content isn't in the raw HTML, that's the cause.
              </span>
            </li>
            <li className="flex gap-2 items-baseline">
              <span style={{ color: 'var(--warning-text)' }}>▸</span>
              <span>
                <strong>Bot blocking.</strong> The site's WAF or CDN may block unknown
                user-agents. Adding{' '}
                <code className="font-mono px-1 py-0.5 rounded bg-[var(--bg-base)]">
                  LumidianAuditBot
                </code>{' '}
                to your robots.txt allow-list or whitelisting our user-agent at the CDN can
                fix this.
              </span>
            </li>
          </ul>

          {(errorMessage || pagesFailed > 0) && (
            <div
              className="mt-3 text-xs font-mono p-2 rounded"
              style={{
                background: 'var(--bg-base)',
                border: '1px solid var(--border-subtle)',
                color: 'var(--text-muted)',
              }}
            >
              {errorMessage && <p>Auditor error: {errorMessage}</p>}
              {pagesFailed > 0 && <p>Pages that returned non-200: {pagesFailed}</p>}
            </div>
          )}

          <div className="mt-4 flex items-center gap-3">
            <AuditTriggerButton brandId={brandId} onTriggered={onTriggered} />
            <span className="text-xs text-[var(--text-muted)] inline-flex items-center gap-1">
              <RefreshCw size={11} />
              We re-fetch robots.txt + sitemap each run, so a fresh audit will pick up any
              changes you make.
            </span>
          </div>
        </div>
      </div>
    </motion.div>
  );
}

function safeHost(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}
