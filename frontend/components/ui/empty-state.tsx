import { type ReactNode } from 'react';

interface EmptyStateProps {
  icon: ReactNode;
  title: string;
  body?: string;
  action?: ReactNode;
  className?: string;
}

export function EmptyState({ icon, title, body, action, className = '' }: EmptyStateProps) {
  return (
    <div className={`flex flex-col items-center justify-center py-12 px-6 text-center ${className}`}>
      <div
        className="w-[52px] h-[52px] rounded-[var(--radius-xl)] flex items-center justify-center mb-4"
        style={{
          background: 'var(--gradient-signature)',
          border: '1px solid var(--accent-border)',
          boxShadow: '0 0 24px oklch(0.58 0.06 235 / 0.08)',
          color: 'var(--accent-light)',
        }}
      >
        {icon}
      </div>
      <p className="text-sm font-semibold text-[color:var(--text-primary)] mb-1">{title}</p>
      {body && (
        <p className="text-[13px] text-[color:var(--text-muted)] leading-relaxed max-w-[280px]">
          {body}
        </p>
      )}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}
