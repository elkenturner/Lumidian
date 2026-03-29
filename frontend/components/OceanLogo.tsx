/**
 * OceanLogo — legacy sonar/radar mark (replaced by LumidianLogo).
 * Kept for reference only.
 *
 * Usage:
 *   <OceanLogo size={40} />                 — standalone icon (no bg circle)
 *   <OceanLogo size={40} withCircle />      — wrapped in the cream bg circle (Sidebar style)
 */

export default function OceanLogo({
  size = 40,
  withCircle = false,
}: {
  size?: number;
  withCircle?: boolean;
}) {
  const svg = (
    <svg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      {/* ── Radar sweep wedge (top-right quadrant) ─────────────────────── */}
      <path
        d="M50 50 L50 8 A42 42 0 0 1 92 50 Z"
        fill="rgba(14,165,233,0.07)"
      />

      {/* ── Concentric sonar rings ──────────────────────────────────────── */}
      <circle cx="50" cy="50" r="42" stroke="#38bdf8" strokeWidth="1"   opacity="0.28" />
      <circle cx="50" cy="50" r="30" stroke="#0ea5e9" strokeWidth="1.3" opacity="0.45" />
      <circle cx="50" cy="50" r="18" stroke="#0284c7" strokeWidth="1.5" opacity="0.65" />

      {/* ── Crosshair guides ───────────────────────────────────────────── */}
      <line x1="50" y1="6"  x2="50" y2="94" stroke="#0ea5e9" strokeWidth="0.6" opacity="0.20" />
      <line x1="6"  y1="50" x2="94" y2="50" stroke="#0ea5e9" strokeWidth="0.6" opacity="0.20" />

      {/* ── Sweep arm lines ────────────────────────────────────────────── */}
      <line x1="50" y1="50" x2="92" y2="50" stroke="#0ea5e9" strokeWidth="0.9" opacity="0.38" />
      <line x1="50" y1="50" x2="50" y2="8"  stroke="#0284c7" strokeWidth="0.9" opacity="0.45" />

      {/* ── Detected "ping" — brand showing up in an AI answer ─────────── */}
      {/* Outer pulse ring around ping */}
      <circle cx="68" cy="32" r="7"   stroke="#0ea5e9" strokeWidth="0.9" opacity="0.35" />
      {/* Ping dot */}
      <circle cx="68" cy="32" r="3.5" fill="#0369a1" opacity="0.85" />
      <circle cx="69.5" cy="30.5" r="1.2" fill="rgba(255,255,255,0.7)" />

      {/* ── Origin — the sonar source / brand under observation ────────── */}
      <circle cx="50" cy="50" r="4.5" fill="#0c4a6e" />
      <circle cx="50" cy="50" r="2"   fill="rgba(255,255,255,0.85)" />
    </svg>
  );

  if (!withCircle) return svg;

  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: '50%',
        flexShrink: 0,
        overflow: 'hidden',
        background: '#f0f9ff',
        boxShadow: '0 1px 8px rgba(0,0,0,0.18), 0 0 0 1px rgba(14,165,233,0.15)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      {svg}
    </div>
  );
}
