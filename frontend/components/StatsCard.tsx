import { ReactNode } from 'react';
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
}: StatsCardProps) {
  if (loading) {
    return (
      <div className="bg-[#111118] border border-[#1e1e2e] rounded-xl p-6 animate-pulse">
        <div className="h-4 bg-[#1a1a24] rounded w-24 mb-4" />
        <div className="h-8 bg-[#1a1a24] rounded w-16 mb-2" />
        <div className="h-3 bg-[#1a1a24] rounded w-32" />
      </div>
    );
  }

  return (
    <div className={clsx(
      'bg-[#111118] border border-[#1e1e2e] rounded-xl p-6 hover:border-[#2a2a3a] transition-colors',
      accent && 'border-t-2 border-t-[#6366f1]'
    )}>
      <div className="flex items-start justify-between">
        <div className="flex-1">
          <p className="text-sm font-medium text-[#94a3b8]">{title}</p>
          <p className={compact
            ? "mt-2 text-lg font-semibold text-[#e2e8f0] leading-snug"
            : "mt-2 text-3xl font-bold text-[#e2e8f0] tracking-tight"
          }>
            {value}
          </p>
          {subtitle && (
            <p className="mt-1 text-sm text-[#64748b]">{subtitle}</p>
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
          <div className="ml-4 w-11 h-11 rounded-xl bg-[#1a1a24] flex items-center justify-center text-[#6366f1] flex-shrink-0">
            {icon}
          </div>
        )}
      </div>
    </div>
  );
}
