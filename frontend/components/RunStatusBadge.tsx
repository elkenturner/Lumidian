import clsx from 'clsx';

interface RunStatusBadgeProps {
  status: 'pending' | 'running' | 'completed' | 'failed';
}

const CONFIG = {
  pending: {
    label: 'Pending',
    className: 'bg-[#1e1e2e] text-[#64748b] border-[#2a2a3a]',
    dot: 'bg-[#64748b]',
    animate: false,
  },
  running: {
    label: 'Running',
    className: 'bg-[#172554]/40 text-[#60a5fa] border-[#1d4ed8]/30',
    dot: 'bg-[#60a5fa]',
    animate: true,
  },
  completed: {
    label: 'Completed',
    className: 'bg-[#064e3b]/30 text-[#10b981] border-[#065f46]/30',
    dot: 'bg-[#10b981]',
    animate: false,
  },
  failed: {
    label: 'Failed',
    className: 'bg-[#7f1d1d]/20 text-[#f87171] border-[#991b1b]/30',
    dot: 'bg-[#f87171]',
    animate: false,
  },
};

export default function RunStatusBadge({ status }: RunStatusBadgeProps) {
  const config = CONFIG[status] ?? CONFIG.pending;

  return (
    <span
      className={clsx(
        'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold border',
        config.className
      )}
    >
      <span
        className={clsx(
          'w-1.5 h-1.5 rounded-full flex-shrink-0',
          config.dot,
          config.animate && 'animate-pulse'
        )}
      />
      {config.label}
    </span>
  );
}
