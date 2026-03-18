'use client';

interface PlatformBadgeProps {
  platform: string;
  size?: 'sm' | 'md';
}

// Muted, dark-bg-appropriate tints
const PLATFORM_STYLES: Record<string, { bg: string; text: string; border: string }> = {
  reddit:    { bg: 'rgba(194,91,52,0.12)',  text: '#c2713a', border: 'rgba(194,91,52,0.25)'  },
  quora:     { bg: 'rgba(179,43,39,0.10)',  text: '#b36461', border: 'rgba(179,43,39,0.22)'  },
  medium:    { bg: 'rgba(148,163,184,0.10)', text: '#94a3b8', border: 'rgba(148,163,184,0.18)' },
  wikipedia: { bg: 'rgba(45,157,147,0.10)', text: '#4aada4', border: 'rgba(45,157,147,0.22)' },
};

const PLATFORM_LABELS: Record<string, string> = {
  reddit: 'Reddit',
  quora: 'Quora',
  medium: 'Medium',
  wikipedia: 'Wikipedia',
};

export default function PlatformBadge({ platform, size = 'md' }: PlatformBadgeProps) {
  const key = platform.toLowerCase();
  const styles = PLATFORM_STYLES[key] ?? {
    bg: 'rgba(71,85,105,0.12)',
    text: '#64748b',
    border: 'rgba(71,85,105,0.2)',
  };
  const label = PLATFORM_LABELS[key] ?? platform;
  const padding = size === 'sm' ? '2px 7px' : '3px 9px';
  const fontSize = '0.6875rem';

  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        padding,
        fontSize,
        fontWeight: 600,
        borderRadius: 100,
        background: styles.bg,
        color: styles.text,
        border: `1px solid ${styles.border}`,
        letterSpacing: '0.01em',
        lineHeight: 1.5,
        whiteSpace: 'nowrap',
      }}
    >
      {label}
    </span>
  );
}
