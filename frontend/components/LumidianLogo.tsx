import Image from 'next/image';
import type { CSSProperties } from 'react';

/**
 * LumidianLogo -- renders the actual logo image from /public/logo.png
 *
 * Usage:
 *   <LumidianLogo size={32} />                             -- icon only
 *   <LumidianLogo size={32} withWordmark />                -- icon + wordmark (dark bg)
 *   <LumidianLogo size={32} withWordmark variant="light" /> -- icon + wordmark (light bg)
 */

export default function LumidianLogo({
  size = 32,
  withWordmark = false,
  variant = 'dark',
}: {
  size?: number;
  withWordmark?: boolean;
  variant?: 'dark' | 'light';
}) {
  const icon = (
    <Image
      src="/logo.png"
      alt="Lumidian"
      width={size}
      height={size}
      style={{ objectFit: 'contain' }}
      priority
    />
  );

  if (!withWordmark) return icon;

  const wordmarkStyle: CSSProperties = variant === 'light'
    ? {
        fontSize: Math.round(size * 0.5),
        fontWeight: 700,
        letterSpacing: '0.06em',
        fontFamily: 'var(--font-inter, system-ui, sans-serif)',
        color: '#1a2440',
      }
    : {
        fontSize: Math.round(size * 0.5),
        fontWeight: 700,
        letterSpacing: '0.06em',
        fontFamily: 'var(--font-inter, system-ui, sans-serif)',
        background: 'linear-gradient(115deg, #8ba8cc 0%, #7a98b8 45%, #bcc8d8 100%)',
        WebkitBackgroundClip: 'text',
        WebkitTextFillColor: 'transparent',
        backgroundClip: 'text',
      };

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: Math.round(size * 0.35) }}>
      {icon}
      <span style={wordmarkStyle}>Lumidian</span>
    </div>
  );
}
