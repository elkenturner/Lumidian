import type { CSSProperties } from 'react';

/**
 * LumidianLogo — eye mark for Lumidian.
 *
 * Usage:
 *   <LumidianLogo size={32} />                        — icon only (width = size×2, height = size)
 *   <LumidianLogo size={32} withWordmark />            — icon + wordmark (dark bg)
 *   <LumidianLogo size={32} withWordmark variant="light" /> — icon + wordmark (light bg)
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
  // Layer structure (bottom to top):
  // 1. Black outer almond
  // 2. Blue interior lens (fills entire opening)
  // 3. Black upper-eyelid shadow (cuts down from top center)
  // 4. Black lower-eyelid shadow (cuts up from bottom center)
  // 5. White sclera circle
  // 6. Black pupil circle
  const icon = (
    <svg
      width={size * 2}
      height={size}
      viewBox="0 0 200 100"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      {/* Black outer almond */}
      <path d="M 3,50 C 22,4 178,4 197,50 C 178,96 22,96 3,50 Z" fill="#0d0d0d" />
      {/* Blue interior — fills the whole inner opening */}
      <path d="M 10,50 C 28,10 172,10 190,50 C 172,90 28,90 10,50 Z" fill="#3b63e8" />
      {/* Upper eyelid shadow — lower boundary curves from y=50 at tips to y=24 at centre */}
      <path d="M 10,50 C 28,10 172,10 190,50 C 160,24 40,24 10,50 Z" fill="#0d0d0d" />
      {/* Lower eyelid shadow — mirror */}
      <path d="M 10,50 C 40,76 160,76 190,50 C 172,90 28,90 10,50 Z" fill="#0d0d0d" />
      {/* White sclera */}
      <circle cx="100" cy="50" r="35" fill="white" />
      {/* Black pupil */}
      <circle cx="100" cy="50" r="19" fill="#0d0d0d" />
    </svg>
  );

  if (!withWordmark) return icon;

  const wordmarkStyle: CSSProperties = variant === 'light'
    ? {
        fontSize: Math.round(size * 0.5),
        fontWeight: 700,
        letterSpacing: '0.06em',
        fontFamily: 'var(--font-inter, system-ui, sans-serif)',
        color: '#1e1b4b',
      }
    : {
        fontSize: Math.round(size * 0.5),
        fontWeight: 700,
        letterSpacing: '0.06em',
        fontFamily: 'var(--font-inter, system-ui, sans-serif)',
        background: 'linear-gradient(115deg, #c4b5fd 0%, #a5b4fc 45%, #dde4ff 100%)',
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
