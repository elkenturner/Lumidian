import type { CSSProperties } from 'react';

/**
 * LumidianLogo — eye mark for Lumidian.
 *
 * Usage:
 *   <LumidianLogo size={32} />                        — icon only (width = size×2, height = size)
 *   <LumidianLogo size={32} withWordmark />            — icon + wordmark (dark bg)
 *   <LumidianLogo size={32} withWordmark variant="light" /> — icon + wordmark (light bg)
 */

const EYE_BLUE = '#3b63e8';

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
    <svg
      width={size * 2}
      height={size}
      viewBox="0 0 200 100"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      {/* Black outer eye shape */}
      <path d="M 4,50 C 30,6 170,6 196,50 C 170,94 30,94 4,50 Z" fill="#111111" />
      {/* Blue left corner accent */}
      <path d="M 36,50 C 38,35 66,35 69,50 C 66,65 38,65 36,50 Z" fill={EYE_BLUE} />
      {/* Blue right corner accent */}
      <path d="M 164,50 C 162,35 134,35 131,50 C 134,65 162,65 164,50 Z" fill={EYE_BLUE} />
      {/* White sclera */}
      <circle cx="100" cy="50" r="32" fill="white" />
      {/* Black pupil */}
      <circle cx="100" cy="50" r="18" fill="#111111" />
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
