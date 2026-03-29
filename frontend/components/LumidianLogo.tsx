import type { CSSProperties } from 'react';

/**
 * LumidianLogo — prism mark for Lumidian.
 *
 * Usage:
 *   <LumidianLogo size={32} />                        — icon only
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
  const prismStroke  = variant === 'light' ? '#1a1a2e' : '#c8c8d8';
  const incomingStroke = variant === 'light' ? '#6b7280' : '#94a3b8';
  const dotFill      = variant === 'light' ? '#4a4a6a' : '#a0a0b8';
  const wordmarkColor = variant === 'light' ? '#1a1a2e' : '#e8e8f0';

  // All coordinates relative to 32×32 viewBox.
  // Upright triangle: apex (16,2), BL (3,30), BR (29,30)
  // Refraction point on left face at ~47%: (10, 15)
  const icon = (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      {/* Refracted rays — drawn before prism so outline sits on top */}
      <line x1="10" y1="15" x2="32" y2="5"  stroke="#10a37f" strokeWidth="1.2" strokeLinecap="round" />
      <line x1="10" y1="15" x2="32" y2="11" stroke="#d97757" strokeWidth="1.0" strokeLinecap="round" />
      <line x1="10" y1="15" x2="32" y2="17" stroke="#6366f1" strokeWidth="0.9" strokeLinecap="round" />
      <line x1="10" y1="15" x2="32" y2="23" stroke="#4285f4" strokeWidth="0.8" strokeLinecap="round" />
      <line x1="10" y1="15" x2="32" y2="29" stroke="#93c5fd" strokeWidth="0.7" strokeLinecap="round" opacity="0.3" />

      {/* Upright prism triangle */}
      <path d="M16 2 L3 30 L29 30 Z" stroke={prismStroke} strokeWidth="1.2" strokeLinejoin="round" />

      {/* Incoming ray */}
      <line x1="0" y1="14" x2="10" y2="15" stroke={incomingStroke} strokeWidth="0.8" strokeLinecap="round" opacity="0.7" />

      {/* Refraction dot */}
      <circle cx="10" cy="15" r="1.8" fill={dotFill} />
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
    <div style={{ display: 'flex', alignItems: 'center', gap: Math.round(size * 0.3) }}>
      {icon}
      <span style={wordmarkStyle}>Lumidian</span>
    </div>
  );
}
