'use client';

import { memo } from 'react';
import { MODEL_ORDER, MODEL_CONFIG, type ModelKey } from '@/lib/constants/models';

interface ModelIconProps {
  model: string;
  size?: number;
  color?: string;
  className?: string;
}

const FONT_MAP: Record<ModelKey, { letter: string; weight: number; family: string }> = {
  chatgpt:    { letter: 'G', weight: 800, family: 'system-ui, sans-serif' },
  claude:     { letter: 'C', weight: 800, family: 'system-ui, sans-serif' },
  perplexity: { letter: 'P', weight: 800, family: 'system-ui, sans-serif' },
  gemini:     { letter: 'G', weight: 800, family: 'system-ui, sans-serif' },
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

  const font = FONT_MAP[key];
  const fill = color ?? MODEL_CONFIG[key].color;

  return (
    <span className={`inline-flex items-center justify-center ${className ?? ''}`}>
      <svg width={size} height={size} viewBox="0 0 20 20" fill="none">
        <text
          x="50%"
          y="52%"
          dominantBaseline="central"
          textAnchor="middle"
          fill={fill}
          fontSize="14"
          fontWeight={font.weight}
          fontFamily={font.family}
        >
          {font.letter}
        </text>
      </svg>
    </span>
  );
});

export default ModelIcon;
