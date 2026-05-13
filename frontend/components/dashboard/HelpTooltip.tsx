'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import Link from 'next/link';

interface HelpTooltipProps {
  text: string;
  href?: string;
  linkText?: string;
}

export default function HelpTooltip({ text, href, linkText = 'Learn more' }: HelpTooltipProps) {
  const [visible, setVisible] = useState(false);
  const [clickLocked, setClickLocked] = useState(false);
  const containerRef = useRef<HTMLSpanElement>(null);

  // Click-outside dismiss
  useEffect(() => {
    if (!clickLocked) return;

    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setClickLocked(false);
        setVisible(false);
      }
    }

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [clickLocked]);

  const handleClick = useCallback(() => {
    if (clickLocked) {
      setClickLocked(false);
      setVisible(false);
    } else {
      setClickLocked(true);
      setVisible(true);
    }
  }, [clickLocked]);

  const handleMouseEnter = useCallback(() => {
    if (!clickLocked) setVisible(true);
  }, [clickLocked]);

  const handleMouseLeave = useCallback(() => {
    if (!clickLocked) setVisible(false);
  }, [clickLocked]);

  return (
    <span
      ref={containerRef}
      className="relative inline-flex ml-1.5 align-middle"
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      <span
        onClick={handleClick}
        className="w-4 h-4 rounded-full bg-[rgba(255,255,255,0.06)] border border-[rgba(255,255,255,0.10)] text-[var(--text-faint)] text-[10px] font-bold flex items-center justify-center cursor-help select-none"
      >
        ?
      </span>
      <span
        className={`
          absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-72
          bg-[var(--bg-base)] border border-[var(--accent-border)]
          rounded-lg p-3 text-xs text-[var(--text-secondary)] leading-relaxed
          shadow-lg z-50 whitespace-normal normal-case tracking-normal font-normal
          transition-all duration-150 ease-out origin-bottom
          ${visible
            ? 'opacity-100 scale-100 pointer-events-auto'
            : 'opacity-0 scale-95 pointer-events-none'
          }
        `}
      >
        {text}
        {href && (
          <Link
            href={href}
            className="mt-2 flex items-center text-[var(--accent)] hover:underline text-xs"
          >
            {linkText}
            <span className="ml-0.5" aria-hidden="true">&rsaquo;</span>
          </Link>
        )}
      </span>
    </span>
  );
}
