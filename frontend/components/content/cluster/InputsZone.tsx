"use client";

import { useState, type ReactNode } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";

interface Props {
  pillar?: ReactNode;
  opportunities?: ReactNode;
  gaps?: ReactNode;
}

/**
 * Cluster detail "Inputs" zone — collapsed by default.
 *
 * Holds the pillar candidate panel, opportunity entries, and gap analysis for
 * the prompt. Each section is independently expandable so the cluster page
 * doesn't feel cluttered.
 */
export function InputsZone({ pillar, opportunities, gaps }: Props) {
  return (
    <div className="card !p-0 overflow-hidden">
      <div className="px-5 py-3 border-b border-[var(--border-subtle)]">
        <span className="text-[11px] uppercase tracking-wider text-[var(--text-faint)] font-semibold">
          Inputs
        </span>
      </div>
      <div className="divide-y divide-[var(--border-subtle)]">
        <Row label="Pillar candidate (own site)">{pillar}</Row>
        <Row label="Opportunities for this prompt">{opportunities}</Row>
        <Row label="Gap analysis">{gaps}</Row>
      </div>
    </div>
  );
}

function Row({ label, children }: { label: string; children?: ReactNode }) {
  const [open, setOpen] = useState(false);
  const hasContent = Boolean(children);
  return (
    <div>
      <button
        type="button"
        onClick={() => hasContent && setOpen((v) => !v)}
        disabled={!hasContent}
        className="w-full px-5 py-3 flex items-center justify-between text-left hover:bg-[var(--bg-card)] disabled:opacity-60 disabled:cursor-default"
      >
        <span className="flex items-center gap-2 text-sm text-[var(--text-primary)]">
          {hasContent ? (
            open ? (
              <ChevronDown className="h-4 w-4 text-[var(--text-secondary)]" />
            ) : (
              <ChevronRight className="h-4 w-4 text-[var(--text-secondary)]" />
            )
          ) : (
            <ChevronRight className="h-4 w-4 text-[var(--text-faint)]" />
          )}
          {label}
        </span>
        {!hasContent && (
          <span className="text-xs text-[var(--text-faint)] italic">none</span>
        )}
      </button>
      {open && hasContent && (
        <div className="px-5 pb-4 pt-1 text-sm text-[var(--text-secondary)]">{children}</div>
      )}
    </div>
  );
}
