'use client';

import { useEffect, useState } from 'react';
import { BotGrid } from './BotGrid';
import { SchemaCoverageList } from './SchemaCoverageList';
import { FilesStatusRow } from './FilesStatusRow';
import { siteAudit, type WebsiteAuditFindingOut } from '@/lib/api';

interface Props {
  auditId: number;
  brandId: number;
  llmsTxtPresent: boolean | null;
  llmsTxtValid: boolean | null;
  robotsTxtRaw: string | null;
  /** Switch to the Fixes tab and pre-filter by category/schema type. */
  onJumpToFixes?: (filter?: { category?: string; query?: string }) => void;
}

const BOT_NAMES = [
  'GPTBot',
  'OAI-SearchBot',
  'ChatGPT-User',
  'ClaudeBot',
  'anthropic-ai',
  'PerplexityBot',
  'Google-Extended',
  'Meta-ExternalAgent',
  'Applebot-Extended',
  'Amazonbot',
];

export function SchemaAndBotsTab({
  auditId,
  brandId,
  llmsTxtPresent,
  llmsTxtValid,
  robotsTxtRaw,
  onJumpToFixes,
}: Props) {
  const [botStatus, setBotStatus] = useState<Record<string, 'allowed' | 'blocked'>>({});

  useEffect(() => {
    siteAudit.findings(auditId).then((all: WebsiteAuditFindingOut[]) => {
      const blocked = new Set<string>();
      for (const f of all) {
        if (f.check_id.startsWith('blocked_')) {
          for (const b of BOT_NAMES) {
            const slug = b.toLowerCase().replace(/-/g, '');
            if (
              f.check_id.replace(/_/g, '').includes(slug) ||
              f.check_id.toLowerCase().includes(b.toLowerCase().replace(/-/g, '_'))
            ) {
              blocked.add(b);
            }
          }
        }
      }
      const status: Record<string, 'allowed' | 'blocked'> = {};
      for (const b of BOT_NAMES) {
        status[b] = blocked.has(b) ? 'blocked' : 'allowed';
      }
      setBotStatus(status);
    });
  }, [auditId]);

  return (
    <div className="space-y-6">
      <SchemaCoverageList
        auditId={auditId}
        onJumpToFix={(schemaType) =>
          onJumpToFixes?.({ category: 'schema', query: schemaType })
        }
      />
      <BotGrid botStatus={botStatus} />
      <FilesStatusRow
        brandId={brandId}
        llmsTxtPresent={llmsTxtPresent}
        llmsTxtValid={llmsTxtValid}
        robotsTxtRaw={robotsTxtRaw}
      />
    </div>
  );
}
