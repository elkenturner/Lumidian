import clsx from 'clsx';

interface RunStatusBadgeProps {
  status: 'pending' | 'running' | 'completed' | 'failed';
}

const CONFIG = {
  pending: {
    label: 'Pending',
    className: 'bg-[rgba(255,255,255,0.04)] text-[#64748B] border-[rgba(100,116,139,0.25)]',
    dot: 'bg-[#475569]',
    animate: false,
  },
  running: {
    label: 'Running',
    className: 'bg-[#172554]/30 text-[#60a5fa] border-[#1d4ed8]/25',
    dot: 'bg-[#60a5fa]',
    animate: true,
  },
  completed: {
    label: 'Completed',
    className: 'bg-[#064e3b]/20 text-[#34d399] border-[#065f46]/25',
    dot: 'bg-[#34d399]',
    animate: false,
  },
  failed: {
    label: 'Failed',
    className: 'bg-[#7f1d1d]/15 text-[#f87171] border-[#991b1b]/25',
    dot: 'bg-[#f87171]',
    animate: false,
  },
};

export default function RunStatusBadge({ status }: RunStatusBadgeProps) {
  const config = CONFIG[status] ?? CONFIG.pending;

  return (
    <span
      className={clsx(
        'inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-semibold border',
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
