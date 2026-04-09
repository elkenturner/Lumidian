'use client';

import { memo } from 'react';
import { MODEL_ORDER, MODEL_CONFIG, type ModelKey } from '@/lib/constants/models';

interface ModelIconProps {
  model: string;
  size?: number;
  color?: string;
  className?: string;
}

/* Distinctive SVG icons for each LLM, crisp at 11-20 px. */
const ICONS: Record<ModelKey, (color: string) => React.ReactNode> = {
  /* ChatGPT — OpenAI hexagon knot (simplified) */
  chatgpt: (c) => (
    <path
      d="M10 3L16.2 6.6V13.4L10 17L3.8 13.4V6.6Z"
      stroke={c} strokeWidth="1.7" fill="none" strokeLinejoin="round"
    />
  ),
  /* Claude — Anthropic starburst */
  claude: (c) => (
    <>
      <circle cx="10" cy="10" r="2.2" fill={c} />
      <line x1="10" y1="3" x2="10" y2="6.5" stroke={c} strokeWidth="1.6" strokeLinecap="round" />
      <line x1="10" y1="13.5" x2="10" y2="17" stroke={c} strokeWidth="1.6" strokeLinecap="round" />
      <line x1="3" y1="10" x2="6.5" y2="10" stroke={c} strokeWidth="1.6" strokeLinecap="round" />
      <line x1="13.5" y1="10" x2="17" y2="10" stroke={c} strokeWidth="1.6" strokeLinecap="round" />
      <line x1="5.1" y1="5.1" x2="7.5" y2="7.5" stroke={c} strokeWidth="1.3" strokeLinecap="round" />
      <line x1="12.5" y1="12.5" x2="14.9" y2="14.9" stroke={c} strokeWidth="1.3" strokeLinecap="round" />
      <line x1="14.9" y1="5.1" x2="12.5" y2="7.5" stroke={c} strokeWidth="1.3" strokeLinecap="round" />
      <line x1="7.5" y1="12.5" x2="5.1" y2="14.9" stroke={c} strokeWidth="1.3" strokeLinecap="round" />
    </>
  ),
  /* Perplexity — magnifying glass */
  perplexity: (c) => (
    <>
      <circle cx="9" cy="9" r="5.2" stroke={c} strokeWidth="1.7" fill="none" />
      <line x1="13" y1="13" x2="17" y2="17" stroke={c} strokeWidth="1.8" strokeLinecap="round" />
    </>
  ),
  /* Gemini — four-pointed sparkle star */
  gemini: (c) => (
    <path
      d="M10 2C10.8 7 13 9.2 18 10C13 10.8 10.8 13 10 18C9.2 13 7 10.8 2 10C7 9.2 9.2 7 10 2Z"
      fill={c}
    />
  ),
};

function normalize(model: string): ModelKey | null {
  const lower = model.toLowerCase().replace(/[-_\s]/g, '');
  for (const key of MODEL_ORDER) {
    if (lower.includes(key)) return key;
  }
  return null;
}

const ModelIcon = memo(function ModelIcon({ model, size = 16, color, className }: ModelIconProps) {
  const key = normalize(model);
  if (!key) return null;

  const fill = color ?? MODEL_CONFIG[key].color;

  return (
    <span className={`inline-flex items-center justify-center ${className ?? ''}`}>
      <svg width={size} height={size} viewBox="0 0 20 20" fill="none">
        {ICONS[key](fill)}
      </svg>
    </span>
  );
});

export default ModelIcon;
