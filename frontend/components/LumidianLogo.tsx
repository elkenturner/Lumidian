import type { CSSProperties } from 'react';

/**
 * LumidianLogo — eye mark for Lumidian.
 *
 * Usage:
 *   <LumidianLogo size={32} />                        — icon only (size × size square)
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
  // Square viewBox — eye centred horizontally, sits in upper half like the reference image.
  // This matches how the favicon renders (browser letterboxes the 200×100 eye into a square tab).
  const icon = (
    <svg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      {/* Black outer almond — eye fills the width, centred at y=50 */}
      <path d="M 2,50 C 11,27 89,27 98,50 C 89,73 11,73 2,50 Z" fill="#0d0d0d" />
      {/* Blue interior */}
      <path d="M 5,50 C 14,32 86,32 95,50 C 86,68 14,68 5,50 Z" fill="#3b63e8" />
      {/* Upper eyelid shadow */}
      <path d="M 5,50 C 14,32 86,32 95,50 C 80,39 20,39 5,50 Z" fill="#0d0d0d" />
      {/* Lower eyelid shadow */}
      <path d="M 5,50 C 20,61 80,61 95,50 C 86,68 14,68 5,50 Z" fill="#0d0d0d" />
      {/* White sclera */}
      <circle cx="50" cy="50" r="17" fill="white" />
      {/* Black pupil */}
      <circle cx="50" cy="50" r="9.5" fill="#0d0d0d" />
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
