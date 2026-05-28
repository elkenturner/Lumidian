import { type ReactNode } from 'react';
import { TrendingUp, TrendingDown } from 'lucide-react';

type StatSize = 'lg' | 'md' | 'sm';

const SIZE_CLASS: Record<StatSize, string> = {
  lg: 'text-[length:var(--text-mono-lg)] tracking-[-2px]',
  md: 'text-[length:var(--text-mono-md)] tracking-[-1px]',
  sm: 'text-[length:var(--text-mono-sm)] tracking-[-1px]',
};

interface StatProps {
  value: ReactNode;
  size?: StatSize;
  label?: string;
  /** Positive = up arrow + success; negative = down arrow + danger; null/0 = no trend */
  trend?: number | null;
  /** Optional suffix rendered smaller (e.g. "%") */
  suffix?: string;
  className?: string;
}

export function Stat({
  value,
  size = 'md',
  label,
  trend,
  suffix,
  className = '',
}: StatProps) {
  const hasTrend = trend !== null && trend !== undefined && trend !== 0;
  const trendUp = hasTrend && trend! > 0;
  return (
    <div className={className}>
      {label && (
        <p className="text-xs font-semibold uppercase tracking-wider text-[color:var(--text-muted)] mb-1">
          {label}
        </p>
      )}
      <p
        className={`font-[family-name:var(--font-geist-mono),'SF_Mono',ui-monospace,monospace] font-semibold leading-none text-[color:var(--text-primary)] ${SIZE_CLASS[size]}`}
      >
        {value}
        {suffix && (
          <span className="text-[0.5em] opacity-70 ml-0.5 align-baseline">{suffix}</span>
        )}
      </p>
      {hasTrend && (
        <div
          className="inline-flex items-center gap-1 mt-2 text-xs"
          style={{ color: trendUp ? 'var(--success-text)' : 'var(--danger-text)' }}
        >
          {trendUp ? <TrendingUp size={12} /> : <TrendingDown size={12} />}
          <span>
            {trendUp ? '+' : ''}
            {trend}%
          </span>
        </div>
      )}
    </div>
  );
}
