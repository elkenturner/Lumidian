'use client';

import { memo } from 'react';
import { MODEL_ORDER, MODEL_CONFIG, type ModelKey } from '@/lib/constants/models';

interface ModelIconProps {
  model: string;
  size?: number;
  color?: string;
  className?: string;
}

/* Proper brand SVG logos for each LLM, clean at any size. viewBox 0 0 24 24. */
const ICONS: Record<ModelKey, (color: string) => React.ReactNode> = {
  /* OpenAI hexagonal iris logo */
  chatgpt: (c) => (
    <path
      fill={c}
      d="M22.28 9.82a5.98 5.98 0 00-.52-4.91 6.05 6.05 0 00-6.51-2.9A6.07 6.07 0 004.98 4.18a5.98 5.98 0 00-4 2.9 6.05 6.05 0 00.74 7.1 5.98 5.98 0 00.51 4.91 6.05 6.05 0 006.52 2.9A5.99 5.99 0 0013.26 24a6.06 6.06 0 005.77-4.21 5.99 5.99 0 004-2.9 6.06 6.06 0 00-.75-7.07zm-9.02 12.61a4.48 4.48 0 01-2.88-1.04l.14-.08 4.78-2.76a.8.8 0 00.39-.68v-6.74l2.02 1.17c.02.01.04.03.04.05v5.58a4.5 4.5 0 01-4.49 4.5zm-9.66-4.12a4.47 4.47 0 01-.53-3.02l.14.09 4.78 2.76c.24.14.54.14.78 0l5.84-3.37v2.33c0 .03-.01.05-.03.06l-4.83 2.79a4.5 4.5 0 01-6.15-1.64zM2.34 7.9a4.49 4.49 0 012.37-1.97V11.6c0 .28.15.54.39.68l5.81 3.35-2.02 1.17a.08.08 0 01-.07 0L4 14.04A4.5 4.5 0 012.34 7.9zm16.6 3.85l-5.84-3.37 2.02-1.16a.08.08 0 01.07 0l4.83 2.79a4.49 4.49 0 01-.68 8.1V12.44a.79.79 0 00-.4-.69zm2.01-3.02l-.14-.08-4.78-2.79a.78.78 0 00-.78 0L9.41 9.23V6.9c0-.03.01-.05.03-.06l4.83-2.79a4.5 4.5 0 016.68 4.67zM8.31 12.86l-2.02-1.16a.08.08 0 01-.04-.06V6.07a4.5 4.5 0 017.38-3.45l-.14.08L8.7 5.46a.8.8 0 00-.39.68zm1.1-2.37l2.6-1.5 2.6 1.5v3l-2.6 1.5-2.6-1.5z"
    />
  ),

  /* Anthropic — angular A lettermark */
  claude: (c) => (
    <>
      <path fill={c} d="M14.94 3.17h3.47L12.07 21h-3.5l6.37-17.83z" />
      <path fill={c} d="M5.59 3.17h3.47L12.07 12H5.26l.33-8.83z" />
    </>
  ),

  /* Perplexity — abstract discovery mark */
  perplexity: (c) => (
    <>
      <path fill={c} d="M7.5 2v7.5H2L7.5 2zM16.5 2v7.5H22L16.5 2z" />
      <path fill={c} d="M7.5 22v-7.5H2L7.5 22zM16.5 22v-7.5H22L16.5 22z" />
      <rect x="9.5" y="9.5" width="5" height="5" rx="0.5" fill={c} />
    </>
  ),

  /* Gemini — four-pointed curved sparkle */
  gemini: (c) => (
    <path
      fill={c}
      d="M12 0c0 6.627-5.373 12-12 12 6.627 0 12 5.373 12 12 0-6.627 5.373-12 12-12-6.627 0-12-5.373-12-12z"
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
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
        {ICONS[key](fill)}
      </svg>
    </span>
  );
});

export default ModelIcon;
