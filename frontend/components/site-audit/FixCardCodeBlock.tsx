'use client';

import { useState } from 'react';
import { Copy, Check } from 'lucide-react';

interface Props {
  artifact: string;
  artifactType: string;
}

// Maps artifact_type → language hint shown in the code block header.
const LANG_LABEL: Record<string, string> = {
  jsonld_org: 'JSON-LD',
  jsonld_faq: 'JSON-LD',
  jsonld_article: 'JSON-LD',
  jsonld_breadcrumb: 'JSON-LD',
  jsonld_product: 'JSON-LD',
  jsonld_howto: 'JSON-LD',
  meta_title: 'plain text',
  meta_description: 'plain text',
  h1_text: 'plain text',
  og_tags: 'HTML',
  faq_section: 'HTML + JSON-LD',
  section_rewrite: 'HTML',
  new_page_draft: 'Markdown',
  alt_text_batch: 'JSON',
  llms_txt: 'plain text',
  robots_snippet: 'plain text',
  agents_md: 'Markdown',
  internal_link_suggestions: 'JSON',
};

export function FixCardCodeBlock({ artifact, artifactType }: Props) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(artifact);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Some browsers block clipboard without user gesture context — silent.
    }
  }

  return (
    <div className="rounded-lg overflow-hidden border border-[var(--border-subtle)] bg-[var(--bg-base)]">
      <div className="flex items-center justify-between px-3 py-2 border-b border-[var(--border-subtle)] bg-[var(--bg-card)]">
        <span className="text-[11px] uppercase tracking-wider text-[var(--text-muted)]">
          {LANG_LABEL[artifactType] ?? artifactType}
        </span>
        <button
          type="button"
          onClick={handleCopy}
          className="inline-flex items-center gap-1.5 text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
          aria-label="Copy artifact to clipboard"
        >
          {copied ? (
            <>
              <Check size={13} style={{ color: 'var(--success-text)' }} />
              <span style={{ color: 'var(--success-text)' }}>Copied</span>
            </>
          ) : (
            <>
              <Copy size={13} />
              <span>Copy</span>
            </>
          )}
        </button>
      </div>
      <pre className="px-4 py-3 text-xs leading-relaxed text-[var(--text-primary)] overflow-x-auto max-h-[420px] whitespace-pre-wrap break-words font-mono">
        {artifact}
      </pre>
    </div>
  );
}
