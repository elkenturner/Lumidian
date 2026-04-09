'use client';

import { useState } from 'react';
import { getModelConfig } from '@/lib/constants/models';
import { MODEL_CONFIG as MODEL_CONFIG_SHARED } from '@/lib/constants/models';

// ── Model config lookup (muted bg + color for badges) ────────────────────────

export const MODEL_CONFIG: Record<string, { label: string; bg: string; text: string }> = Object.fromEntries(
  Object.entries(MODEL_CONFIG_SHARED).map(([k, v]) => [k, { label: v.label, bg: v.mutedBg, text: v.color }])
);

export function getModelCfg(model: string) {
  const cfg = getModelConfig(model);
  return { label: cfg.label, bg: cfg.mutedBg, text: cfg.color, key: cfg.key };
}

// ── Strip markdown for display ───────────────────────────────────────────────

export function stripMarkdown(text: string): string {
  return text
    .replace(/^#+\s+/gm, '')
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/\*(.+?)\*/g, '$1')
    .replace(/\[(\d+)\]/g, '')
    .replace(/\n+/g, ' ')
    .trim();
}

// ── Format percentage without redundant decimals ─────────────────────────────

export const formatPct = (pct: number) => pct % 1 === 0 ? `${Math.round(pct)}%` : `${pct.toFixed(1)}%`;

// ── Domain colors for DonutDomains ───────────────────────────────────────────

export const DOMAIN_COLORS = [
  { color: '#c4b5fd', glow: 'rgba(129,140,248,0.4)' },
  { color: '#34d399', glow: 'rgba(52,211,153,0.4)' },
  { color: '#fbbf24', glow: 'rgba(251,191,36,0.4)' },
  { color: '#a78bfa', glow: 'rgba(167,139,250,0.4)' },
  { color: '#f472b6', glow: 'rgba(244,114,182,0.4)' },
  { color: '#22d3ee', glow: 'rgba(34,211,238,0.4)' },
];

// ── Model bar colors ─────────────────────────────────────────────────────────

export const MODEL_BAR_COLORS: Record<string, string> = {
  chatgpt: 'var(--color-chatgpt)',
  claude: 'var(--color-claude)',
  perplexity: 'var(--color-perplexity)',
  gemini: 'var(--color-gemini)',
};
