'use client';

import { useState } from 'react';
import { ChevronDown } from 'lucide-react';
import type { ContentDraft, BrandProfile } from '@/lib/api';

// ── Draft quality checklist ───────────────────────────────────────────────────

const HEDGING_PHRASES = [
  'it is worth noting', 'it should be noted', 'it is important to note',
  'it is crucial to', 'needless to say', 'as we all know',
  'it goes without saying', 'in conclusion', 'to summarize',
  'in summary', 'overall,', 'ultimately,',
];

// passed: true = pass, 'warning' = soft warning (counts as passed), false = hard fail
export interface QualityCheck {
  label: string;
  passed: boolean | 'warning';
  detail?: string;
}

export function runQualityChecks(
  draft: ContentDraft,
  profile: BrandProfile | null,
  brandName: string,
): QualityCheck[] {
  const text = draft.content_text;
  const lower = text.toLowerCase();
  const wordCount = text.trim().split(/\s+/).filter(Boolean).length;
  const platform = draft.platform;
  // Reddit reply = generated from a Reddit opportunity (thread reply, not standalone post)
  const isRedditReply = platform === 'reddit' && draft.opportunity_id != null;

  // ── Wikipedia-specific checks ──────────────────────────────────────────────
  if (platform === 'wikipedia') {
    const PROMO_WORDS = [
      'best', 'leading', 'top', 'premier', 'world-class', 'revolutionary',
      'groundbreaking', 'cutting-edge', 'innovative', 'unmatched', 'unrivaled',
      'superior', 'excellence', 'exceptional', 'outstanding',
    ];
    const SUPERLATIVES = ['most', 'fastest', 'largest', 'biggest', 'greatest', 'first-ever'];
    const MARKETING_PHRASES = [
      'we are proud', 'proud to', 'pleased to announce', 'excited to', 'thrilled to',
      'game-changer', 'game changer', 'disruptive', 'disrupting the', 'transform your',
    ];

    const promoFound = PROMO_WORDS.find((w) => lower.includes(w));
    const supFound = SUPERLATIVES.find((w) => lower.includes(w));
    const marketingFound = MARKETING_PHRASES.find((p) => lower.includes(p));
    const hasPromoBias = promoFound || supFound || marketingFound;

    const hasCitation = /\[\d+\]|\{\{cite|<ref|https?:\/\//.test(text);

    const inLengthRange = wordCount >= 50 && wordCount <= 300;

    return [
      {
        label: 'Neutral encyclopedic tone',
        passed: !hasPromoBias,
        detail: hasPromoBias
          ? `Promotional language detected: "${promoFound ?? supFound ?? marketingFound}"`
          : undefined,
      },
      {
        label: 'Citation included',
        passed: hasCitation,
        detail: !hasCitation ? 'Add a citation or source URL' : undefined,
      },
      {
        label: 'No superlatives or marketing claims',
        passed: !supFound && !marketingFound,
        detail: supFound ? `Superlative detected: "${supFound}"` : marketingFound ? `Marketing phrase: "${marketingFound}"` : undefined,
      },
      {
        label: `Appropriate length (50–300 words, currently ${wordCount})`,
        passed: inLengthRange,
        detail: !inLengthRange
          ? wordCount < 50 ? 'Too short for a meaningful Wikipedia addition' : 'May be too long — consider splitting'
          : undefined,
      },
      {
        // COI reminder — always shows as a soft warning regardless of content
        label: 'COI reminder: disclose your conflict of interest on the talk page before editing',
        passed: 'warning',
      },
    ];
  }

  // ── Quora-specific checks ──────────────────────────────────────────────────
  if (platform === 'quora') {
    const quoraChecks: QualityCheck[] = [];

    // Word count: 250–550 words
    const inRange = wordCount >= 250 && wordCount <= 550;
    quoraChecks.push({
      label: `Length (${wordCount} words)`,
      passed: inRange ? true : 'warning',
      detail: !inRange
        ? wordCount < 250
          ? 'Too short — aim for at least 250 words for a useful Quora answer'
          : 'Getting long — consider trimming below 550 words'
        : undefined,
    });

    // First sentence must not start with filler
    const firstSentence = text.trim().split(/[.!?\n]/)[0].toLowerCase().trim();
    const FILLER_OPENERS = [
      'great question', 'good question', 'interesting question', 'that\'s a great',
      'i think', 'i believe', 'well,', 'so,', 'yes,', 'no,',
      'this is a', 'this is an', 'there are many', 'there are several',
      'it depends', 'it really depends', 'to answer this',
    ];
    const fillerFound = FILLER_OPENERS.find((f) => firstSentence.startsWith(f));
    quoraChecks.push({
      label: 'Direct opening sentence',
      passed: fillerFound ? false : true,
      detail: fillerFound
        ? `Starts with filler: "${fillerFound}" — first sentence must state the direct answer`
        : undefined,
    });

    // Quora-specific brand mention (soft warning, same threshold as generic but separate label)
    if (brandName) {
      const escaped = brandName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const occurrences = (lower.match(new RegExp(escaped, 'gi')) ?? []).length;
      quoraChecks.push({
        label: 'Brand mention',
        passed: occurrences > 3 ? 'warning' : true,
        detail: occurrences > 3
          ? `Mentioned ${occurrences}× — keep it to 1–2 natural mentions`
          : occurrences === 0 ? undefined : undefined,
      });
    }

    // Prohibited phrases + stats (shared checks, still apply)
    if (profile && profile.what_not_to_say.length > 0) {
      const found = profile.what_not_to_say
        .map((p) => p.trim())
        .filter((p) => p && lower.includes(p.toLowerCase()));
      quoraChecks.push({
        label: 'No prohibited phrases',
        passed: found.length === 0,
        detail: found.length > 0 ? `Found: "${found[0]}"` : undefined,
      });
    }
    if (profile && profile.key_stats.length > 0) {
      const textNums = text.match(/\d+(?:[.,]\d+)?%/g) ?? [];
      const unapproved = textNums.filter((n) => !profile.key_stats.some((s) => s.includes(n)));
      quoraChecks.push({
        label: 'Only approved statistics',
        passed: unapproved.length === 0,
        detail: unapproved.length > 0 ? `Unverified stat: ${unapproved[0]}` : undefined,
      });
    }

    return quoraChecks;
  }

  // ── Generic checks (Reddit, Medium) ────────────────────────────────────────
  const checks: QualityCheck[] = [];

  // 1. No prohibited phrases — compare against Brand Profile "What NOT to Say" (case-insensitive)
  if (profile && profile.what_not_to_say.length > 0) {
    const found = profile.what_not_to_say
      .map((p) => p.trim())
      .filter((p) => p && lower.includes(p.toLowerCase()));
    checks.push({
      label: 'No prohibited phrases',
      passed: found.length === 0,
      detail: found.length > 0 ? `Found: "${found[0]}"` : undefined,
    });
  } else {
    checks.push({ label: 'No prohibited phrases', passed: true });
  }

  // 2. Only approved statistics
  if (profile && profile.key_stats.length > 0) {
    const textNums = text.match(/\d+(?:[.,]\d+)?%/g) ?? [];
    const unapproved = textNums.filter((n) => !profile.key_stats.some((s) => s.includes(n)));
    checks.push({
      label: 'Only approved statistics',
      passed: unapproved.length === 0,
      detail: unapproved.length > 0 ? `Unverified stat: ${unapproved[0]}` : undefined,
    });
  } else {
    checks.push({ label: 'Only approved statistics', passed: true });
  }

  // 3. No hedging phrases — enforced silently at generation time; not surfaced as a user check

  // 4. Brand mention — platform-aware
  if (isRedditReply) {
    checks.push({ label: 'Brand mention', passed: true, detail: 'Optional for Reddit replies' });
  } else if (brandName) {
    const escaped = brandName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const occurrences = (lower.match(new RegExp(escaped, 'gi')) ?? []).length;
    const tooMany = occurrences > 4;

    if (platform === 'medium') {
      checks.push({
        label: 'Brand mentioned',
        passed: occurrences === 0 ? false : tooMany ? 'warning' : true,
        detail: occurrences === 0
          ? 'Brand not mentioned (required for Medium)'
          : tooMany ? `Mentioned ${occurrences}× (may feel forced)` : undefined,
      });
    } else {
      checks.push({
        label: 'Brand mentioned',
        passed: occurrences === 0 ? 'warning' : tooMany ? 'warning' : true,
        detail: occurrences === 0
          ? 'Brand not mentioned (recommended)'
          : tooMany ? `Mentioned ${occurrences}× (may feel forced)` : undefined,
      });
    }
  } else {
    checks.push({ label: 'Brand mentioned', passed: true });
  }

  // Word count — enforced silently at generation time; not surfaced as a user check

  // Suppress unused variable warning — HEDGING_PHRASES is intentionally kept for future use
  void HEDGING_PHRASES;

  return checks;
}

export function QualityChecklist({
  draft,
  profile,
  brandName,
  autoExpand = false,
  liveText,
}: {
  draft: ContentDraft;
  profile: BrandProfile | null;
  brandName: string;
  autoExpand?: boolean;
  liveText?: string;
}) {
  const [expanded, setExpanded] = useState(autoExpand);
  const effectiveDraft = liveText != null ? { ...draft, content_text: liveText } : draft;
  const checks = runQualityChecks(effectiveDraft, profile, brandName);
  const hardFails = checks.filter((c) => c.passed === false).length;
  const warnings = checks.filter((c) => c.passed === 'warning').length;
  const passed = checks.length - hardFails; // warnings count as passed
  const total = checks.length;
  const scoreColor = hardFails === 0 && warnings === 0
    ? 'text-[var(--success)]'
    : hardFails === 0
    ? 'text-[var(--warning)]'
    : hardFails >= 2 ? 'text-[var(--danger)]' : 'text-[var(--warning)]';

  return (
    <div className="border border-[var(--bg-tinted-hover)] rounded-lg overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between px-3 py-2 bg-[rgba(95,126,166,0.06)] hover:bg-[var(--bg-tinted)] transition-colors"
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
        <div className="divide-y divide-[rgba(95,126,166,0.10)]">
          {checks.map((check) => {
            const icon = check.passed === true ? '✓' : check.passed === 'warning' ? '~' : '⚠';
            const iconColor = check.passed === true
              ? 'text-[var(--success)]'
              : check.passed === 'warning'
              ? 'text-[var(--warning)]'
              : 'text-[var(--danger)]';
            return (
              <div key={check.label} className="flex items-start gap-2.5 px-3 py-2">
                <span className={`text-xs mt-0.5 flex-shrink-0 font-bold ${iconColor}`} aria-hidden="true">{icon}</span>
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
