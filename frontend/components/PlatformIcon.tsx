'use client';

import { memo } from 'react';

interface PlatformIconProps {
  platform: string;
  size?: number;
  color?: string;
  className?: string;
}

const ICONS: Record<string, (size: number, color: string) => React.ReactNode> = {
  // Reddit "snoo" face — the standalone mark without the outer circle
  reddit: (size, color) => (
    <svg width={size} height={size} viewBox="0 0 20 20" fill="none">
      <path d="M16.65 10.34c0-.68-.55-1.23-1.23-1.23-.33 0-.64.13-.86.35-1.08-.78-2.57-1.28-4.22-1.34l.72-3.38 2.34.5a.88.88 0 10.1-.47l-2.62-.56a.44.44 0 00-.52.34l-.8 3.78c-1.7.04-3.23.54-4.33 1.33a1.22 1.22 0 00-.85-.35 1.23 1.23 0 00-.52 2.35 2.5 2.5 0 00-.03.38c0 1.93 2.25 3.5 5.02 3.5s5.02-1.57 5.02-3.5c0-.13-.01-.26-.04-.39.4-.22.67-.64.67-1.13zM6.83 11.54a.88.88 0 111.76 0 .88.88 0 01-1.76 0zm5.02 2.6c-.62.61-1.78.66-1.86.66s-1.25-.05-1.86-.66a.3.3 0 01.42-.42c.39.39 1.2.53 1.44.53s1.06-.14 1.44-.53a.3.3 0 01.42.42zm-.08-1.72a.88.88 0 110-1.76.88.88 0 010 1.76z" fill={color} />
    </svg>
  ),
  // Quora — the bold "Q" lettermark
  quora: (size, color) => (
    <svg width={size} height={size} viewBox="0 0 20 20" fill="none">
      <path d="M10.32 15.66c-.7-1.17-1.48-2.37-2.83-2.37-.42 0-.84.11-1.19.39l-.66-1.05c.62-.6 1.56-.99 2.67-.99 1.56 0 2.46.71 3.24 1.73.36-.85.55-1.91.55-3.2 0-3.71-1.54-6.01-4.06-6.01-2.5 0-4.01 2.3-4.01 6.01 0 3.68 1.51 5.95 4.01 5.95.53 0 1-.08 1.45-.26l.03-.18-.2-.02zM8.03 17.5C3.78 17.5.96 14.37.96 9.4.96 4.45 3.78 1.5 8.03 1.5c4.27 0 7.05 2.95 7.05 7.9 0 2.18-.5 3.96-1.38 5.31l1.75 2.37-2.12.81-1.29-1.83c-1.03.77-2.3 1.23-3.75 1.35l-.26.09z" fill={color} />
    </svg>
  ),
  // Medium — the three-shape wordmark (circle, oval, bar)
  medium: (size, color) => (
    <svg width={size} height={size} viewBox="0 0 20 20" fill="none">
      <ellipse cx="5.63" cy="10" rx="4.38" ry="4.5" fill={color} />
      <ellipse cx="13.44" cy="10" rx="2.3" ry="4.24" fill={color} />
      <ellipse cx="18.13" cy="10" rx=".82" ry="3.8" fill={color} />
    </svg>
  ),
  // Wikipedia — the "W" puzzle-globe mark simplified as bold W
  wikipedia: (size, color) => (
    <svg width={size} height={size} viewBox="0 0 20 20" fill="none">
      <path d="M18.5 4.5h-2.7l-3.56 8.72L8.72 4.5H6.6l-.02.01L3.08 13.2 1.5 4.5H.5l2.16 11h1.52l3.4-8.43L10.94 15.5h1.53L17.3 4.5h1.2z" fill={color} />
    </svg>
  ),
  // LinkedIn — the "in" logotype
  linkedin: (size, color) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill={color}>
      <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 01-2.063-2.065 2.064 2.064 0 112.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z" />
    </svg>
  ),
  // X (Twitter) — the exact 𝕏 mark
  x: (size, color) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill={color}>
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
    </svg>
  ),
};

// Normalize platform keys like linkedin_article → linkedin
function normalizeKey(platform: string): string {
  const key = platform.toLowerCase();
  if (key.startsWith('linkedin')) return 'linkedin';
  if (key.startsWith('x_')) return 'x';
  return key;
}

const PlatformIcon = memo(function PlatformIcon({ platform, size = 16, color = 'currentColor', className }: PlatformIconProps) {
  const key = normalizeKey(platform);
  const renderer = ICONS[key];
  if (!renderer) return null;
  return <span className={`inline-flex items-center justify-center ${className ?? ''}`}>{renderer(size, color)}</span>;
});

export default PlatformIcon;
