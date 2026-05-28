'use client';

import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { X } from 'lucide-react';
import { getPromptSuggestions, type PromptSuggestion, type Prompt } from '@/lib/api';

export interface AttachPromptPopoverProps {
  draftId: number;
  allPrompts: Prompt[];
  onAttach: (promptId: number) => Promise<void> | void;
  onClose: () => void;
  /** If true, render without its own header/frame (used inside MarkAsPostedModal). */
  embedded?: boolean;
}

const LABEL_TEXT: Record<PromptSuggestion['label'], string> = {
  very_relevant: 'Very relevant',
  somewhat: 'Somewhat',
  loose: 'Loose match',
};

const LABEL_COLOR: Record<PromptSuggestion['label'], string> = {
  very_relevant: 'var(--success)',
  somewhat: 'var(--accent-foreground)',
  loose: 'var(--text-faint)',
};

function labelPillStyle(label: PromptSuggestion['label']) {
  const color = LABEL_COLOR[label];
  return {
    color,
    borderColor: `color-mix(in srgb, ${color} 25%, transparent)`,
    backgroundColor: `color-mix(in srgb, ${color} 8%, transparent)`,
  };
}

export function AttachPromptPopover({
  draftId,
  allPrompts,
  onAttach,
  onClose,
  embedded = false,
}: AttachPromptPopoverProps) {
  const [suggestions, setSuggestions] = useState<PromptSuggestion[]>([]);
  const [loading, setLoading] = useState(true);
  const [attaching, setAttaching] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    getPromptSuggestions(draftId)
      .then((sugs) => {
        if (!cancelled) setSuggestions(sugs);
      })
      .catch(() => {
        if (!cancelled) setSuggestions([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [draftId]);

  useEffect(() => {
    if (embedded) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [embedded, onClose]);

  const suggestedIds = new Set(suggestions.map((s) => s.prompt_id));
  const rest = allPrompts.filter((p) => !suggestedIds.has(p.id));

  async function handlePick(promptId: number) {
    setAttaching(promptId);
    try {
      await onAttach(promptId);
      onClose();
    } finally {
      setAttaching(null);
    }
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: -4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.1, ease: [0.16, 1, 0.3, 1] }}
      className={[
        'bg-[rgba(8,12,20,0.98)] border border-[var(--border-subtle)] rounded-xl shadow-[0_24px_64px_rgba(0,0,0,0.55)] overflow-hidden',
        embedded ? '' : 'w-[380px] max-h-[420px] flex flex-col',
      ]
        .join(' ')
        .trim()}
      role={embedded ? undefined : 'dialog'}
      aria-label={embedded ? undefined : 'Attach draft to a tracked prompt'}
    >
      {!embedded && (
        <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--border-subtle)]">
          <p className="text-sm font-semibold text-[var(--text-primary)]">
            Attach to a prompt
          </p>
          <button
            onClick={onClose}
            aria-label="Close"
            className="w-6 h-6 rounded-lg flex items-center justify-center text-[var(--text-faint)] hover:text-[var(--text-secondary)] hover:bg-[var(--bg-tinted)] transition-colors"
          >
            <X size={12} aria-hidden="true" />
          </button>
        </div>
      )}

      <div className={embedded ? '' : 'overflow-y-auto'}>
        {loading ? (
          <div className="px-4 py-4 text-xs text-[var(--text-faint)]">Analyzing draft…</div>
        ) : (
          <>
            {suggestions.length > 0 && (
              <div className="px-4 py-3">
                <p className="text-[10px] uppercase tracking-wide text-[var(--text-faint)] mb-2">
                  Suggested
                </p>
                <ul className="flex flex-col gap-1.5">
                  {suggestions.map((s) => (
                    <li key={s.prompt_id}>
                      <button
                        onClick={() => handlePick(s.prompt_id)}
                        disabled={attaching !== null}
                        className="w-full flex items-start gap-2 text-left px-3 py-2 rounded-lg border border-[var(--bg-tinted)] hover:border-[rgba(255,255,255,0.14)] bg-[rgba(255,255,255,0.02)] hover:bg-[rgba(255,255,255,0.04)] transition-[border-color,background-color] duration-[120ms] ease-out disabled:opacity-50"
                      >
                        <span
                          className="mt-0.5 text-[10px] px-1.5 py-0.5 rounded-full border shrink-0"
                          style={labelPillStyle(s.label)}
                        >
                          {LABEL_TEXT[s.label]}
                        </span>
                        <span className="text-xs text-[var(--text-secondary)] leading-relaxed">
                          {s.text}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {rest.length > 0 && (
              <div className="px-4 py-3 border-t border-[var(--border-subtle)]">
                <p className="text-[10px] uppercase tracking-wide text-[var(--text-faint)] mb-2">
                  All tracked prompts
                </p>
                <ul className="flex flex-col gap-1 max-h-40 overflow-y-auto">
                  {rest.map((p) => (
                    <li key={p.id}>
                      <button
                        onClick={() => handlePick(p.id)}
                        disabled={attaching !== null}
                        className="w-full text-left text-xs text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[rgba(255,255,255,0.04)] rounded-lg px-3 py-1.5 transition-colors duration-[120ms] ease-out disabled:opacity-50"
                      >
                        {p.text}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {suggestions.length === 0 && rest.length === 0 && (
              <div className="px-4 py-4 text-xs text-[var(--text-faint)]">
                No tracked prompts for this brand.
              </div>
            )}
          </>
        )}
      </div>
    </motion.div>
  );
}
