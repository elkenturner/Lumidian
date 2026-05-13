'use client';

import { useState } from 'react';
import { Check, X, Download, FileCode } from 'lucide-react';
import { siteAudit } from '@/lib/api';

interface Props {
  brandId: number;
  llmsTxtPresent: boolean | null;
  llmsTxtValid: boolean | null;
  robotsTxtRaw: string | null;
}

export function FilesStatusRow({ brandId, llmsTxtPresent, llmsTxtValid, robotsTxtRaw }: Props) {
  const llmsStatus =
    llmsTxtPresent === true && llmsTxtValid === true ? 'good'
      : llmsTxtPresent === true ? 'invalid' : 'missing';

  const robotsStatus = robotsTxtRaw ? 'good' : 'missing';

  return (
    <div className="card">
      <h3 className="text-base font-semibold text-[var(--text-primary)] mb-3">AI policy files</h3>
      <ul className="space-y-2">
        <FileRow
          name="robots.txt"
          status={robotsStatus}
          description="The classic crawler-policy file. Per-bot allow/disallow."
          onGenerate={async () => downloadText('robots.txt', await siteAudit.robotsSnippet(brandId))}
          generateLabel="Generate snippet"
        />
        <FileRow
          name="llms.txt"
          status={llmsStatus}
          description="Markdown index aimed at LLM crawlers. Lists your key pages."
          onGenerate={async () => downloadText('llms.txt', await siteAudit.llmsTxt(brandId))}
          generateLabel="Generate file"
        />
        <FileRow
          name="agents.md"
          status="missing"
          description="Companion to llms.txt, aimed at agent crawlers (e.g. agentic browsers)."
          onGenerate={null}
          generateLabel=""
        />
      </ul>
    </div>
  );
}

function FileRow({
  name,
  status,
  description,
  onGenerate,
  generateLabel,
}: {
  name: string;
  status: 'good' | 'missing' | 'invalid';
  description: string;
  onGenerate: (() => Promise<void> | void) | null;
  generateLabel: string;
}) {
  const [busy, setBusy] = useState(false);
  const color =
    status === 'good' ? 'var(--success-text)' : status === 'invalid' ? 'var(--warning-text)' : 'var(--danger-text)';
  const label = status === 'good' ? 'Present' : status === 'invalid' ? 'Invalid' : 'Missing';

  return (
    <li className="flex items-start gap-3 py-2 border-t border-[var(--border-subtle)] first:border-t-0">
      <FileCode size={16} className="shrink-0 mt-0.5 text-[var(--text-muted)]" />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-mono font-medium text-[var(--text-primary)]">/{name}</p>
        <p className="text-xs text-[var(--text-secondary)] mt-0.5">{description}</p>
      </div>
      <span
        className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wider shrink-0"
        style={{ background: 'transparent', color, border: `1px solid ${color}` }}
      >
        {status === 'good' ? <Check size={11} /> : <X size={11} />}
        {label}
      </span>
      {onGenerate && (
        <button
          type="button"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              await onGenerate();
            } finally {
              setBusy(false);
            }
          }}
          className="inline-flex items-center gap-1 px-2 py-1 rounded text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
        >
          <Download size={11} />
          {generateLabel}
        </button>
      )}
    </li>
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
