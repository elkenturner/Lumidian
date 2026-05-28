'use client';

import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { AttachPromptPopover } from './AttachPromptPopover';
import type { Prompt } from '@/lib/api';

export interface MarkAsPostedModalProps {
  draftId: number;
  allPrompts: Prompt[];
  onAttachAndPost: (promptId: number) => Promise<void>;
  onPostWithoutAttach: () => Promise<void>;
  onClose: () => void;
}

export function MarkAsPostedModal({
  draftId,
  allPrompts,
  onAttachAndPost,
  onPostWithoutAttach,
  onClose,
}: MarkAsPostedModalProps) {
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape' && !submitting) onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [submitting, onClose]);

  async function handleAttach(promptId: number) {
    setSubmitting(true);
    try {
      await onAttachAndPost(promptId);
      onClose();
    } finally {
      setSubmitting(false);
    }
  }

  async function handleSkip() {
    setSubmitting(true);
    try {
      await onPostWithoutAttach();
      onClose();
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="mark-posted-modal-title"
    >
      <button
        type="button"
        aria-label="Close"
        className="absolute inset-0 bg-black/70 backdrop-blur-sm cursor-default"
        onClick={() => {
          if (!submitting) onClose();
        }}
      />
      <div className="relative w-full max-w-md flex flex-col bg-[rgba(8,12,20,0.98)] border border-[var(--border-subtle)] rounded-2xl shadow-[0_24px_80px_rgba(0,0,0,0.70)] overflow-hidden">
        <div className="flex items-start justify-between px-5 pt-4 pb-3 border-b border-[var(--border-subtle)]">
          <div>
            <h2
              id="mark-posted-modal-title"
              className="text-[15px] font-semibold text-[var(--text-primary)]"
            >
              Attach to a tracked prompt?
            </h2>
            <p className="text-[11px] text-[var(--text-faint)] mt-0.5 leading-relaxed">
              Attach a prompt so we can measure this post&apos;s visibility impact. You can also skip.
            </p>
          </div>
          <button
            onClick={() => {
              if (!submitting) onClose();
            }}
            aria-label="Close"
            className="w-7 h-7 rounded-lg flex items-center justify-center text-[var(--text-faint)] hover:text-[var(--text-secondary)] hover:bg-[var(--bg-tinted)] transition-colors shrink-0"
          >
            <X size={14} aria-hidden="true" />
          </button>
        </div>

        <div className="p-3 max-h-[60vh] overflow-y-auto">
          <AttachPromptPopover
            draftId={draftId}
            allPrompts={allPrompts}
            onAttach={handleAttach}
            onClose={() => {
              /* nested close handled by parent on successful attach */
            }}
            embedded
          />
        </div>

        <div className="flex items-center gap-2 px-5 py-3 border-t border-[var(--border-subtle)]">
          <button
            onClick={handleSkip}
            disabled={submitting}
            className="flex-1 text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)] bg-[rgba(255,255,255,0.04)] hover:bg-[var(--border-faint)] border border-[var(--border-faint)] rounded-lg px-4 py-2 transition-colors disabled:opacity-50"
          >
            Skip — post without attaching
          </button>
        </div>
      </div>
    </div>
  );
}
