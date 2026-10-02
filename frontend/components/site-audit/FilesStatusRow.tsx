'use client';

import { useState } from 'react';
import { motion } from 'framer-motion';
import { Check, X, Download } from 'lucide-react';
import { siteAudit } from '@/lib/api';
import { staggerContainer, staggerChild } from '@/lib/motion';

interface Props {
  brandId: number;
  llmsTxtPresent: boolean | null;
  llmsTxtValid: boolean | null;
  robotsTxtRaw: string | null;
}

interface FileSpec {
  name: string;
  description: string;  // shown always
  status: 'good' | 'invalid' | 'missing';
  cta?: { label: string; onClick: () => Promise<void> | void };
}

export function FilesStatusRow({
  brandId,
  llmsTxtPresent,
  llmsTxtValid,
  robotsTxtRaw,
}: Props) {
  const files: FileSpec[] = [
    {
      name: 'robots.txt',
      description:
        'Per-bot allow/disallow rules. AI crawlers obey it. If you block them here, you exit AI search.',
      status: robotsTxtRaw ? 'good' : 'missing',
      cta: {
        label: 'Generate AI-bot snippet',
        onClick: async () =>
          downloadText('robots.txt', await siteAudit.robotsSnippet(brandId)),
      },
    },
    {
      name: 'llms.txt',
      description:
        "Markdown index of your key pages aimed at LLM crawlers. Adoption is early but cost is zero.",
      status:
        llmsTxtPresent === true && llmsTxtValid === true
          ? 'good'
          : llmsTxtPresent === true
            ? 'invalid'
            : 'missing',
      cta: {
        label: 'Generate llms.txt',
        onClick: async () => downloadText('llms.txt', await siteAudit.llmsTxt(brandId)),
      },
    },
    {
      name: 'agents.md',
      description:
        'Companion to llms.txt aimed at agent-style crawlers (browsers that act on your behalf).',
      status: 'missing',
    },
  ];

  const goodCount = files.filter((f) => f.status === 'good').length;

  return (
    <div className="card">
      <div className="mb-4">
        <h3 className="text-base font-semibold text-[var(--text-primary)]">AI policy files</h3>
        <p className="text-sm text-[var(--text-secondary)] mt-1 leading-relaxed">
          {goodCount === files.length
            ? '✓ All three AI policy files are in place.'
            : `${goodCount} of ${files.length} files present. Missing ones below.`}
        </p>
      </div>
      <motion.ul
        variants={staggerContainer}
        initial="hidden"
        animate="visible"
        className="divide-y divide-[var(--border-subtle)]"
      >
        {files.map((f) => (
          <motion.li
            key={f.name}
            variants={staggerChild}
            className="py-3 grid grid-cols-[auto_1fr_auto] gap-3 items-start"
          >
            <StatusBadge status={f.status} />
            <div className="min-w-0">
              <p className="text-sm font-mono font-medium text-[var(--text-primary)]">/{f.name}</p>
              <p className="text-xs text-[var(--text-secondary)] mt-0.5 leading-relaxed">
                {f.description}
              </p>
            </div>
            {f.cta && f.status !== 'good' && (
              <DownloadButton label={f.cta.label} onClick={f.cta.onClick} />
            )}
          </motion.li>
        ))}
      </motion.ul>
    </div>
  );
}

function StatusBadge({ status }: { status: 'good' | 'invalid' | 'missing' }) {
  const ok = status === 'good';
  const color =
    ok ? 'var(--success-text)'
      : status === 'invalid' ? 'var(--warning-text)'
        : 'var(--danger-text)';
  const label = ok ? 'Present' : status === 'invalid' ? 'Invalid' : 'Missing';
  return (
    <span
      className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wider shrink-0"
      style={{
        background: ok ? 'var(--success-muted)' : 'transparent',
        border: `1px solid ${color}`,
        color,
      }}
    >
      {ok ? <Check size={11} /> : <X size={11} />}
      {label}
    </span>
  );
}

function DownloadButton({ label, onClick }: { label: string; onClick: () => Promise<void> | void }) {
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        try {
          await onClick();
        } finally {
          setBusy(false);
        }
      }}
      className="inline-flex items-center gap-1 px-2.5 py-1 rounded text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)] shrink-0"
      style={{ border: '1px solid var(--border-default)' }}
    >
      <Download size={11} />
      {label}
    </button>
  );
}

function downloadText(name: string, content: string) {
  const blob = new Blob([content], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
