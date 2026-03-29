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
  const logoUrl = domain ? `https://logo.clearbit.com/${domain}` : null;
  const [imgFailed, setImgFailed] = useState(false);

  const showLogo = logoUrl && !imgFailed;
  const initial = name.charAt(0).toUpperCase();

  return (
    <div
      className={`flex items-center justify-center overflow-hidden flex-shrink-0 ${className}`}
      style={{ width: size, height: size, ...style }}
    >
      {showLogo ? (
        <img
          src={logoUrl}
          alt={`${name} logo`}
          width={size}
          height={size}
          onError={() => setImgFailed(true)}
          style={{ width: size, height: size, objectFit: 'contain' }}
        />
      ) : (
        <span className={textClassName} style={textStyle}>
          {initial}
        </span>
      )}
    </div>
  );
}
