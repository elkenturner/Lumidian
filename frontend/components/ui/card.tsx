import { type ReactNode, type HTMLAttributes } from 'react';

type CardPadding = 'sm' | 'md' | 'lg';
type CardTone = 'default' | 'elevated' | 'tinted';

const PADDING_CLASS: Record<CardPadding, string> = {
  sm: 'p-3',
  md: 'p-5',
  lg: 'p-7',
};

const TONE_STYLE: Record<CardTone, string> = {
  default: 'bg-[color:var(--bg-raised)] border border-[color:var(--border-subtle)] shadow-[var(--shadow-card)]',
  elevated: 'bg-[image:linear-gradient(135deg,rgba(15,23,42,0.8)_0%,rgba(30,41,59,0.4)_100%)] border border-[color:var(--border-subtle)] shadow-[var(--shadow-elevated)]',
  tinted: 'bg-[color:var(--bg-tinted)] border border-[color:var(--border-faint)]',
};

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  padding?: CardPadding;
  tone?: CardTone;
  hover?: boolean;
  children: ReactNode;
}

export function Card({
  padding = 'md',
  tone = 'default',
  hover = false,
  className = '',
  children,
  ...rest
}: CardProps) {
  const hoverClass = hover
    ? 'transition-[transform,background-color,border-color,box-shadow] duration-200 hover:-translate-y-px hover:border-[color:var(--border-default)] hover:shadow-[var(--shadow-card-hover)]'
    : '';
  return (
    <div
      className={`rounded-[var(--radius-lg)] ${TONE_STYLE[tone]} ${PADDING_CLASS[padding]} ${hoverClass} ${className}`}
      {...rest}
    >
      {children}
    </div>
  );
}
