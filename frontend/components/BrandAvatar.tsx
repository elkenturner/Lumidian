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
            // Prevent the native error event from reaching Next.js's dev overlay
            // (which captures window 'error' events and shows "[object Event]")
            e.nativeEvent.stopImmediatePropagation();
            setImgState((s) => s === 'clearbit' ? 'google' : 'initial');
          }}
          style={{ width: size, height: size, objectFit: 'contain', background: '#fff', borderRadius: 4 }}
        />
      ) : (
        <span className={textClassName} style={textStyle}>
          {initial}
        </span>
      )}
    </div>
  );
}
