import { type ReactNode, type ElementType } from 'react';

type HeadingLevel = 'display' | 1 | 2 | 3;

const SIZE_CLASS: Record<HeadingLevel, string> = {
  display: 'text-[2.5rem] sm:text-[3rem] lg:text-[3.75rem] tracking-[-0.04em] leading-[1.05]',
  1: 'text-[2rem] tracking-[-0.03em] leading-[1.15]',
  2: 'text-[1.5rem] tracking-[-0.02em] leading-[1.25]',
  3: 'text-[1.125rem] leading-[1.35]',
};

const SIZE_FAMILY: Record<HeadingLevel, string> = {
  display: 'font-[family-name:var(--font-syne),system-ui,sans-serif] font-extrabold',
  1: 'font-[family-name:var(--font-syne),system-ui,sans-serif] font-bold',
  2: 'font-[family-name:var(--font-syne),system-ui,sans-serif] font-bold',
  3: 'font-sans font-semibold',
};

const SIZE_DEFAULT_TAG: Record<HeadingLevel, ElementType> = {
  display: 'h1',
  1: 'h1',
  2: 'h2',
  3: 'h3',
};

interface HeadingProps {
  level: HeadingLevel;
  as?: ElementType;
  className?: string;
  children: ReactNode;
}

export function Heading({ level, as, className = '', children }: HeadingProps) {
  const Tag = as ?? SIZE_DEFAULT_TAG[level];
  return (
    <Tag
      className={`text-[color:var(--text-primary)] ${SIZE_FAMILY[level]} ${SIZE_CLASS[level]} ${className}`}
    >
      {children}
    </Tag>
  );
}
