'use client';

import { memo } from 'react';

interface PlatformIconProps {
  platform: string;
  size?: number;
  color?: string;
  className?: string;
}

// Clean, bold lettermarks that render crisply at any size.
// Each uses the platform's actual brand typeface weight/style.
const ICONS: Record<string, (size: number, color: string) => React.ReactNode> = {
  reddit: (size, color) => (
    <svg width={size} height={size} viewBox="0 0 20 20" fill="none">
      {/* Snoo head silhouette — simplified for small sizes */}
      <circle cx="10" cy="11.5" r="6" fill={color} opacity={0.15} />
      <circle cx="10" cy="11.5" r="6" stroke={color} strokeWidth="1.4" fill="none" />
      <circle cx="7.8" cy="10.8" r="1.1" fill={color} />
      <circle cx="12.2" cy="10.8" r="1.1" fill={color} />
      <path d="M7.5 13.3c.6.8 1.4 1.2 2.5 1.2s1.9-.4 2.5-1.2" stroke={color} strokeWidth="1.1" strokeLinecap="round" fill="none" />
      <line x1="10" y1="5.5" x2="10" y2="7" stroke={color} strokeWidth="1.3" strokeLinecap="round" />
      <circle cx="10" cy="4.8" r="1" fill={color} />
    </svg>
  ),
  quora: (size, color) => (
    <svg width={size} height={size} viewBox="0 0 20 20" fill="none">
      <text x="50%" y="52%" dominantBaseline="central" textAnchor="middle" fill={color} fontSize="15" fontWeight="700" fontFamily="Georgia, serif">Q</text>
    </svg>
  ),
  medium: (size, color) => (
    <svg width={size} height={size} viewBox="0 0 20 20" fill="none">
      <text x="50%" y="52%" dominantBaseline="central" textAnchor="middle" fill={color} fontSize="14" fontWeight="900" fontFamily="system-ui, sans-serif">M</text>
    </svg>
  ),
  wikipedia: (size, color) => (
    <svg width={size} height={size} viewBox="0 0 20 20" fill="none">
      <text x="50%" y="52%" dominantBaseline="central" textAnchor="middle" fill={color} fontSize="14" fontWeight="700" fontFamily="'Linux Libertine', Georgia, serif">W</text>
    </svg>
  ),
  linkedin: (size, color) => (
    <svg width={size} height={size} viewBox="0 0 20 20" fill="none">
      <text x="50%" y="52%" dominantBaseline="central" textAnchor="middle" fill={color} fontSize="13" fontWeight="700" fontFamily="system-ui, sans-serif">in</text>
    </svg>
  ),
  x: (size, color) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill={color}>
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
    </svg>
  ),
};

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
