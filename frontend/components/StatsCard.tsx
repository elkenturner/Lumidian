'use client';

import { ReactNode, useEffect, useRef, useState } from 'react';
import { TrendingUp, TrendingDown } from 'lucide-react';
import clsx from 'clsx';

interface StatsCardProps {
  title: string;
  value: string | number;
  subtitle?: string;
  trend?: number;
  trendDirection?: 'up' | 'down';
  icon?: ReactNode;
  loading?: boolean;
  compact?: boolean;
  accent?: boolean;
  accentColor?: string; // top-border accent color, e.g. '#3b82f6'
}

function useCountUp(target: number, duration = 700): number {
  const [count, setCount] = useState(0);
  const rafRef = useRef<number>(0);

  useEffect(() => {
    if (
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches
    ) {
      setCount(target);
      return;
    }

    let startTime: number | null = null;

    const animate = (timestamp: number) => {
      if (!startTime) startTime = timestamp;
      const elapsed = timestamp - startTime;
      const progress = Math.min(elapsed / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3); // ease-out cubic
      setCount(Math.round(target * eased));
      if (progress < 1) {
        rafRef.current = requestAnimationFrame(animate);
      }
    };

    setCount(0);
    rafRef.current = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(rafRef.current);
  }, [target, duration]);

  return count;
}

export default function StatsCard({
  title,
  value,
  subtitle,
  trend,
  trendDirection,
  icon,
  loading = false,
  compact = false,
  accent = false,
  accentColor,
}: StatsCardProps) {
  const isNumeric = typeof value === 'number';
  const animatedValue = useCountUp(isNumeric ? (value as number) : 0, 700);

  if (loading) {
    return (
      <div className="card">
        <div className="skeleton h-3 rounded w-24 mb-4" />
        <div className="skeleton h-8 rounded w-16 mb-2" />
        <div className="skeleton h-3 rounded w-32" />
      </div>
    );
  }

  const borderTopStyle = accentColor
    ? { borderTopColor: accentColor, borderTopWidth: 2 }
    : accent
      ? { borderTopColor: '#6366f1', borderTopWidth: 2 }
      : undefined;

  return (
    <div
      className={clsx('card card-hover', accent && 'card-elevated')}
      style={borderTopStyle}
    >
      <div className="flex items-start justify-between">
        <div className="flex-1">
          <p className="text-[13px] font-medium text-[#94A3B8]">{title}</p>
          <p className={clsx(
            compact
              ? 'mt-2 text-lg font-semibold leading-snug'
              : 'mt-2 stat-value stat-value-lg',
            !isNumeric && 'text-[#F0F4F8] font-bold'
          )}>
            {isNumeric ? animatedValue : value}
          </p>
          {subtitle && (
            <p className="mt-1 text-xs text-[#64748B]">{subtitle}</p>
          )}
          {trend !== undefined && (
            <div
              className={clsx(
                'mt-2 flex items-center gap-1 text-sm font-medium',
                trendDirection === 'up' ? 'text-[#10b981]' : 'text-[#ef4444]'
              )}
            >
              {trendDirection === 'up' ? (
                <TrendingUp size={14} />
              ) : (
                <TrendingDown size={14} />
              )}
              <span>
                {trendDirection === 'up' ? '+' : '-'}
                {Math.abs(trend)}% vs last run
              </span>
            </div>
          )}
        </div>
        {icon && (
          <div className="ml-4 w-10 h-10 rounded-xl bg-[rgba(99,102,241,0.08)] border border-[rgba(99,102,241,0.15)] flex items-center justify-center text-[#818CF8] flex-shrink-0">
            {icon}
          </div>
        )}
      </div>
    </div>
  );
}
