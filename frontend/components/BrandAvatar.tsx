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
    '#5f7ea6', '#4a6a90', '#506e96', '#3e5e82',
    '#ec4899', '#f43f5e', '#ef4444', '#f97316',
    '#eab308', '#84cc16', '#22c55e', '#14b8a6',
    '#06b6d4', '#0ea5e9', '#3b82f6', '#5f7ea6',
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
  const [imgState, setImgState] = useState<'loading' | 'loaded' | 'initial'>(
    domain ? 'loading' : 'initial'
  );

  const logoUrl = domain && imgState !== 'initial'
    ? `https://www.google.com/s2/favicons?domain=${domain}&sz=128`
    : null;

  const initial = name.charAt(0).toUpperCase();
  const bgColor = stringToColor(name);
  const radius = size >= 32 ? 8 : 6;

  return (
    <div
      className={`flex items-center justify-center overflow-hidden flex-shrink-0 ${className}`}
      style={{
        position: 'relative',
        width: size,
        height: size,
        borderRadius: radius,
        ...style,
      }}
    >
      {logoUrl ? (
        <>
          {/* Initial letter placeholder while loading */}
          <div
            style={{
              position: 'absolute',
              inset: 0,
              backgroundColor: bgColor,
              borderRadius: radius,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              opacity: imgState === 'loaded' ? 0 : 1,
              transition: 'opacity 150ms ease',
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
          {/* Favicon — absolute-positioned to fill the full container
              (including any padding from parent styles), clipped by overflow:hidden */}
          <img
            src={logoUrl}
            alt={`${name} logo`}
            onLoad={() => setImgState('loaded')}
            onError={() => setImgState('initial')}
            style={{
              position: 'absolute',
              inset: 0,
              width: '100%',
              height: '100%',
              objectFit: 'cover',
              opacity: imgState === 'loaded' ? 1 : 0,
              transition: 'opacity 150ms ease',
            }}
          />
        </>
      ) : (
        <div
          style={{
            width: size,
            height: size,
            backgroundColor: bgColor,
            borderRadius: radius,
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
