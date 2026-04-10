'use client';

import { memo } from 'react';

interface PlatformBadgeProps {
  platform: string;
  size?: 'sm' | 'md';
}

// Official brand colors with matching bg/border tints for dark UI
const PLATFORM_STYLES: Record<string, { bg: string; text: string; border: string }> = {
  reddit:          { bg: 'rgba(255,69,0,0.10)',    text: '#FF4500', border: 'rgba(255,69,0,0.22)'    },
  quora:           { bg: 'rgba(185,43,39,0.10)',   text: '#B92B27', border: 'rgba(185,43,39,0.22)'   },
  medium:          { bg: 'rgba(148,163,184,0.10)', text: 'var(--text-secondary)', border: 'rgba(148,163,184,0.18)' },
  wikipedia:       { bg: 'rgba(148,163,184,0.10)', text: 'var(--text-secondary)', border: 'rgba(148,163,184,0.18)' },
  linkedin:        { bg: 'rgba(10,102,194,0.12)',  text: '#0A66C2', border: 'rgba(10,102,194,0.25)'  },
  linkedin_article:{ bg: 'rgba(10,102,194,0.12)',  text: '#0A66C2', border: 'rgba(10,102,194,0.25)'  },
  linkedin_post:   { bg: 'rgba(10,102,194,0.12)',  text: '#0A66C2', border: 'rgba(10,102,194,0.25)'  },
  linkedin_reply:  { bg: 'rgba(10,102,194,0.12)',  text: '#0A66C2', border: 'rgba(10,102,194,0.25)'  },
  x:               { bg: 'rgba(148,163,184,0.10)', text: 'var(--text-secondary)', border: 'rgba(148,163,184,0.18)' },
  x_thread:        { bg: 'rgba(148,163,184,0.10)', text: 'var(--text-secondary)', border: 'rgba(148,163,184,0.18)' },
  x_post:          { bg: 'rgba(148,163,184,0.10)', text: 'var(--text-secondary)', border: 'rgba(148,163,184,0.18)' },
  x_reply:         { bg: 'rgba(148,163,184,0.10)', text: 'var(--text-secondary)', border: 'rgba(148,163,184,0.18)' },
};

const PLATFORM_LABELS: Record<string, string> = {
  reddit: 'Reddit',
  quora: 'Quora',
  medium: 'Medium',
  wikipedia: 'Wikipedia',
  linkedin: 'LinkedIn',
  linkedin_article: 'LinkedIn Article',
  linkedin_post: 'LinkedIn Post',
  linkedin_reply: 'LinkedIn',
  x: 'X',
  x_thread: 'X Thread',
  x_post: 'X',
  x_reply: 'X',
};

const PlatformBadge = memo(function PlatformBadge({ platform, size = 'md' }: PlatformBadgeProps) {
  const key = platform.toLowerCase();
  const styles = PLATFORM_STYLES[key] ?? {
    bg: 'rgba(71,85,105,0.12)',
    text: 'var(--text-muted)',
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
        gap: 5,
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
});

export default PlatformBadge;
