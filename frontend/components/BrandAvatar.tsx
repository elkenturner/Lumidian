'use client';

import { useState } from 'react';

function getDomain(websiteUrl: string | null | undefined): string | null {
  if (!websiteUrl) return null;
  try {
    const url = new URL(websiteUrl.startsWith('http') ? websiteUrl : `https://${websiteUrl}`);
    return url.hostname.replace(/^www\./, '');
  } catch {
    return null;
  }
}

// Generate a consistent color from a string
function stringToColor(str: string): string {
  const colors = [
    '#6366f1', '#8b5cf6', '#a855f7', '#d946ef',
    '#ec4899', '#f43f5e', '#ef4444', '#f97316',
    '#eab308', '#84cc16', '#22c55e', '#14b8a6',
    '#06b6d4', '#0ea5e9', '#3b82f6', '#6366f1',
  ];
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
  }
  return colors[Math.abs(hash) % colors.length];
}

interface BrandAvatarProps {
  name: string;
  websiteUrl?: string | null;
  size?: number;
  className?: string;
  style?: React.CSSProperties;
  textClassName?: string;
  textStyle?: React.CSSProperties;
}

type ImgState = 'clearbit' | 'google' | 'initial';

export default function BrandAvatar({
  name,
  websiteUrl,
  size = 24,
  className = '',
  style,
  textClassName = '',
  textStyle,
}: BrandAvatarProps) {
  const domain = getDomain(websiteUrl);
  const [imgState, setImgState] = useState<ImgState>(domain ? 'clearbit' : 'initial');

  const logoUrl = domain && imgState !== 'initial'
    ? imgState === 'clearbit'
      ? `https://logo.clearbit.com/${domain}`
      : `https://www.google.com/s2/favicons?domain=${domain}&sz=64`
    : null;

  const initial = name.charAt(0).toUpperCase();
  const bgColor = stringToColor(name);

  return (
    <div
      className={`flex items-center justify-center overflow-hidden flex-shrink-0 ${className}`}
      style={{ width: size, height: size, ...style }}
    >
      {logoUrl ? (
        <img
          src={logoUrl}
          alt={`${name} logo`}
          width={size}
          height={size}
          onError={(e) => {
            e.nativeEvent.stopImmediatePropagation();
            setImgState((s) => s === 'clearbit' ? 'google' : 'initial');
          }}
          style={{ width: size, height: size, objectFit: 'contain', background: '#fff', borderRadius: 4 }}
        />
      ) : (
        <div
          style={{
            width: size,
            height: size,
            backgroundColor: bgColor,
            borderRadius: size >= 32 ? 8 : 4,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <span
            className={textClassName}
            style={{
              color: '#fff',
              fontSize: size * 0.45,
              fontWeight: 600,
              lineHeight: 1,
              ...textStyle,
            }}
          >
            {initial}
          </span>
        </div>
      )}
    </div>
  );
}
