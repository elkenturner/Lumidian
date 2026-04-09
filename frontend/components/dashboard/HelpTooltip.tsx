'use client';

import { useState } from 'react';

interface HelpTooltipProps {
  text: string;
}

export default function HelpTooltip({ text }: HelpTooltipProps) {
  const [open, setOpen] = useState(false);
  return (
    <span
      className="relative inline-flex ml-1.5 align-middle"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <span className="w-4 h-4 rounded-full bg-[rgba(255,255,255,0.06)] border border-[rgba(255,255,255,0.10)] text-[var(--text-faint)] text-[10px] font-bold flex items-center justify-center cursor-help select-none">
        ?
      </span>
      {open && (
        <span className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-60 bg-[var(--bg-base)] border border-[var(--accent-border)] rounded-lg p-3 text-xs text-[var(--text-secondary)] leading-relaxed shadow-lg z-50 pointer-events-none whitespace-normal">
          {text}
        </span>
      )}
    </span>
  );
}
