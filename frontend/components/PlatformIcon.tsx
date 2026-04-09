'use client';

import { memo } from 'react';

interface PlatformIconProps {
  platform: string;
  size?: number;
  color?: string;
  className?: string;
}

/* Clean brand SVG icons for each platform. viewBox 0 0 24 24. */
const ICONS: Record<string, (color: string) => React.ReactNode> = {
  reddit: (c) => (
    <>
      <circle cx="12" cy="14" r="7.5" stroke={c} strokeWidth="1.5" fill="none" />
      <circle cx="9.2" cy="13" r="1.4" fill={c} />
      <circle cx="14.8" cy="13" r="1.4" fill={c} />
      <path d="M9 16.8c.8 1 1.7 1.5 3 1.5s2.2-.5 3-1.5" stroke={c} strokeWidth="1.2" strokeLinecap="round" fill="none" />
      <line x1="12" y1="6.5" x2="12" y2="8" stroke={c} strokeWidth="1.5" strokeLinecap="round" />
      <circle cx="12" cy="5.5" r="1.2" fill={c} />
    </>
  ),
  quora: (c) => (
    <>
      <circle cx="12" cy="11" r="8" stroke={c} strokeWidth="2" fill="none" />
      <path d="M14 15l4 5" stroke={c} strokeWidth="2" strokeLinecap="round" />
    </>
  ),
  medium: (c) => (
    <>
      <ellipse cx="6.5" cy="12" rx="4.5" ry="5.5" fill={c} />
      <ellipse cx="15" cy="12" rx="2.5" ry="5" fill={c} />
      <ellipse cx="21" cy="12" rx="1.2" ry="4.5" fill={c} />
    </>
  ),
  wikipedia: (c) => (
    <path
      fill={c}
      d="M12 18.5L7 5.5h2l3 8.5 3-8.5h2l-5 13zM4 5.5h2M18 5.5h2"
      stroke={c}
      strokeWidth="0"
    />
  ),
  linkedin: (c) => (
    <>
      <rect x="3" y="10" width="4" height="11" rx="0.5" fill={c} />
      <circle cx="5" cy="5.5" r="2.2" fill={c} />
      <path d="M10 21V14.5c0-2 .8-3 2.5-3s2.5 1 2.5 3V21h4V13.5c0-3.5-2-5.5-5-5.5-2 0-3.2.9-4 2.2V10h-4v11h4z" fill={c} />
    </>
  ),
  x: (c) => (
    <path
      fill={c}
      d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"
    />
  ),
};

function normalizeKey(platform: string): string {
  const key = platform.toLowerCase();
  if (key.startsWith('linkedin')) return 'linkedin';
  if (key.startsWith('x_') || key === 'x') return 'x';
  return key;
}

const PlatformIcon = memo(function PlatformIcon({ platform, size = 16, color = 'currentColor', className }: PlatformIconProps) {
  const key = normalizeKey(platform);
  const renderer = ICONS[key];
  if (!renderer) return null;
  return (
    <span className={`inline-flex items-center justify-center ${className ?? ''}`}>
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
        {renderer(color)}
      </svg>
    </span>
  );
});

export default PlatformIcon;
