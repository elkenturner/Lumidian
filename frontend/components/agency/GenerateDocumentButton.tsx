'use client';

import { useEffect, useState } from 'react';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { ChevronDown, FileText, Loader2 } from 'lucide-react';
import {
  agencyRenderDocument,
  agencyListDocumentTemplates,
  MissingFieldsError,
  type DocumentTemplate,
} from '@/lib/api';

interface Props {
  clientId: number;
  onGenerated?: () => void;
}

export function GenerateDocumentButton({ clientId, onGenerated }: Props) {
  const [templates, setTemplates] = useState<DocumentTemplate[]>([]);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    agencyListDocumentTemplates().then(setTemplates).catch(() => setTemplates([]));
  }, []);

  const pick = async (kind: string) => {
    setGenerating(true);
    setError(null);
    try {
      const { blob, filename } = await agencyRenderDocument(clientId, kind);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      onGenerated?.();
    } catch (e) {
      if (e instanceof MissingFieldsError) {
        setError(`Missing brand data: ${e.missingFields.join(', ')}`);
      } else {
        const status = (e as { response?: { status?: number } })?.response?.status;
        if (status === 503) {
          setError('LLM unavailable. Check that ANTHROPIC_API_KEY is set on the backend.');
        } else {
          setError(e instanceof Error ? e.message : 'Generation failed');
        }
      }
    } finally {
      setGenerating(false);
    }
  };

  return (
    <div className="space-y-2">
      <DropdownMenu.Root>
        <DropdownMenu.Trigger asChild>
          <button
            disabled={generating}
            className="flex items-center gap-2 rounded-md bg-[var(--bg-elevated)] px-3 py-2 text-sm font-medium text-[var(--text-primary)] hover:bg-[var(--bg-card)] disabled:opacity-50"
          >
            {generating ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Generating…
              </>
            ) : (
              <>
                <FileText className="h-4 w-4" />
                Generate document
                <ChevronDown className="h-3 w-3" />
              </>
            )}
          </button>
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content
            align="end"
            className="z-50 min-w-[280px] rounded-md border border-[var(--border-default)] bg-[var(--bg-raised)] p-1 text-sm text-[var(--text-primary)] shadow-lg"
          >
            {templates.map((t) => (
              <DropdownMenu.Item
                key={t.kind}
                onSelect={() => pick(t.kind)}
                className="cursor-pointer rounded px-3 py-2 outline-none hover:bg-[var(--bg-card)] focus:bg-[var(--bg-card)]"
              >
                <div className="font-medium">{t.name}</div>
                <div className="text-xs text-[var(--text-muted)]">{t.description}</div>
              </DropdownMenu.Item>
            ))}
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
      {error && <p className="text-sm text-red-400">{error}</p>}
    </div>
  );
}
