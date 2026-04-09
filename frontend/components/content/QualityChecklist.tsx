'use client';

import { useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { ContentDraft, BrandProfile } from '@/lib/api';
import { runQualityChecks, QualityCheck } from './helpers';

export function QualityChecklist({
  draft,
  profile,
  brandName,
  autoExpand = false,
  liveText,
  precomputedChecks,
}: {
  draft: ContentDraft;
  profile: BrandProfile | null;
  brandName: string;
  autoExpand?: boolean;
  liveText?: string;
  precomputedChecks?: QualityCheck[];
}) {
  const [expanded, setExpanded] = useState(autoExpand);
  // Use precomputed checks when no live editing is in progress (avoids double computation)
  const effectiveDraft = liveText != null ? { ...draft, content_text: liveText } : draft;
  const checks = (liveText == null && precomputedChecks)
    ? precomputedChecks
    : runQualityChecks(effectiveDraft, profile, brandName);
  const hardFails = checks.filter((c) => c.passed === false).length;
  const warnings = checks.filter((c) => c.passed === 'warning').length;
  const passed = checks.length - hardFails;
  const total = checks.length;
  const scoreColor = hardFails === 0 && warnings === 0
    ? 'text-[var(--success)]'
    : hardFails === 0
    ? 'text-[var(--warning)]'
    : hardFails >= 2 ? 'text-[var(--danger)]' : 'text-[var(--warning)]';

  return (
    <div className="border border-[var(--border-subtle)] rounded-lg overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between px-3 py-2 bg-[var(--bg-raised)] hover:bg-[var(--bg-card)] transition-colors"
      >
        <div className="flex items-center gap-2">
          <span className={`text-xs font-semibold font-mono ${scoreColor}`}>
            {passed}/{total} checks passed
          </span>
          {(hardFails > 0 || warnings > 0) && (
            <span className="text-[10px] text-[var(--text-muted)]">
              {hardFails > 0 && `${hardFails} fail${hardFails !== 1 ? 's' : ''}`}
              {hardFails > 0 && warnings > 0 && ', '}
              {warnings > 0 && `${warnings} warning${warnings !== 1 ? 's' : ''}`}
            </span>
          )}
        </div>
        <ChevronDown
          size={12}
          className={`text-[var(--text-faint)] transition-transform ${expanded ? 'rotate-180' : ''}`}
        />
      </button>
      {expanded && (
        <div className="divide-y divide-[var(--border-subtle)]">
          {checks.map((check) => {
            const icon = check.passed === true ? '✓' : check.passed === 'warning' ? '⚠' : '✕';
            const iconColor = check.passed === true
              ? 'text-[var(--success)]'
              : check.passed === 'warning'
              ? 'text-[var(--warning)]'
              : 'text-[var(--danger)]';
            return (
              <div key={check.label} className="flex items-start gap-2.5 px-3 py-2">
                <span className={`text-xs mt-0.5 flex-shrink-0 font-bold ${iconColor}`}>{icon}</span>
                <div className="flex-1 min-w-0">
                  <span className="text-xs text-[var(--text-secondary)]">{check.label}</span>
                  {check.detail && (
                    <span className="text-[10px] text-[var(--text-muted)] ml-2">{check.detail}</span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
