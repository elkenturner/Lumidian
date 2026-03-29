'use client';

import { useState } from 'react';
import { ChevronDown, CheckCircle2, AlertTriangle } from 'lucide-react';
import { PlatformGuidelines } from '@/lib/api';

interface PlatformGuidelinesPanelProps {
  platform: string;
  guidelines: PlatformGuidelines;
}

export default function PlatformGuidelinesPanel({
  platform,
  guidelines,
}: PlatformGuidelinesPanelProps) {
  const [open, setOpen] = useState(false);

  return (
    <div className="bg-[rgba(99,102,241,0.06)] backdrop-blur-md border border-[rgba(99,102,241,0.22)] rounded-xl overflow-hidden shadow-[0_4px_24px_rgba(0,0,0,0.20)]">
      <button
        className="w-full flex items-center justify-between px-5 py-4 text-left hover:bg-[rgba(99,102,241,0.06)] transition-colors"
        onClick={() => setOpen(!open)}
      >
        <div>
          <span className="text-sm font-semibold text-[#e2e8f0] capitalize">
            {platform} Guidelines
          </span>
          <span className="ml-3 text-xs text-[#64748b]">{guidelines.tone}</span>
        </div>
        <ChevronDown
          size={16}
          className={`text-[#64748b] transition-transform ${open ? 'rotate-180' : ''}`}
        />
      </button>

      {open && (
        <div className="px-5 pb-5 border-t border-[rgba(99,102,241,0.15)] pt-4 space-y-4">
          {/* Tone */}
          <div>
            <p className="text-xs font-semibold text-[#64748b] uppercase tracking-wider mb-1">
              Tone
            </p>
            <p className="text-sm text-[#94a3b8]">{guidelines.tone}</p>
          </div>

          {/* Workflow */}
          {guidelines.workflow && (
            <div>
              <p className="text-xs font-semibold text-[#64748b] uppercase tracking-wider mb-1">
                Workflow
              </p>
              <p className="text-sm text-[#94a3b8]">{guidelines.workflow}</p>
            </div>
          )}

          {/* Rules */}
          {guidelines.rules.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-[#64748b] uppercase tracking-wider mb-2">
                Rules
              </p>
              <ul className="space-y-1.5">
                {guidelines.rules.map((rule, i) => (
                  <li key={i} className="flex items-start gap-2">
                    <CheckCircle2
                      size={14}
                      className="text-[#22c55e] flex-shrink-0 mt-0.5"
                    />
                    <span className="text-sm text-[#94a3b8]">{rule}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Disclaimer */}
          {guidelines.disclaimer && (
            <div className="bg-yellow-900/20 border border-yellow-700/50 text-yellow-300 rounded-lg p-4 flex gap-3">
              <AlertTriangle size={16} className="flex-shrink-0 mt-0.5 text-yellow-400" />
              <p className="text-sm">{guidelines.disclaimer}</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
