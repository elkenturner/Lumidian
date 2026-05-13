'use client';

import { useState } from 'react';
import { Bell } from 'lucide-react';

interface Props {
  message: string;
}

export function NudgePill({ message }: Props) {
  const [copied, setCopied] = useState(false);

  const copy = (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    navigator.clipboard.writeText(message);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <button
      onClick={copy}
      title="Click to copy a nudge message for this client"
      className="inline-flex items-center gap-1 rounded-full bg-amber-500/20 px-2 py-0.5 text-xs font-medium text-amber-300 hover:bg-amber-500/30"
    >
      <Bell className="h-3 w-3" />
      {copied ? 'Copied!' : 'Nudge?'}
    </button>
  );
}
