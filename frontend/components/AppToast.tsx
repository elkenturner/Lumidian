'use client';

import { CheckCircle2, AlertCircle, Info, X } from 'lucide-react';

export type ToastType = 'success' | 'error' | 'info';

export interface ToastData {
  message: string;
  type: ToastType;
}

interface AppToastProps extends ToastData {
  onDismiss: () => void;
}

const styles: Record<ToastType, { wrapper: string; icon: JSX.Element }> = {
  success: {
    wrapper: 'bg-[rgba(6,78,59,0.90)] border-[#065f46]/50 text-[var(--success)]',
    icon: <CheckCircle2 size={15} className="text-[var(--success)] shrink-0" />,
  },
  error: {
    wrapper: 'bg-[rgba(127,29,29,0.90)] border-[#991b1b]/50 text-[var(--danger)]',
    icon: <AlertCircle size={15} className="text-[var(--danger)] shrink-0" />,
  },
  info: {
    wrapper: 'bg-[rgba(10,14,24,0.95)] border-[rgba(99,102,241,0.25)] text-[var(--text-secondary)]',
    icon: <Info size={15} className="text-[var(--accent)] shrink-0" />,
  },
};

export function AppToast({ message, type, onDismiss }: AppToastProps) {
  const { wrapper, icon } = styles[type];
  return (
    <div role="alert" aria-live="assertive" aria-atomic="true" className={`fixed bottom-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 px-4 py-3 rounded-xl shadow-2xl border text-sm font-medium max-w-sm ${wrapper}`}>
      {icon}
      <span className="flex-1">{message}</span>
      <button onClick={onDismiss} aria-label="Dismiss" className="ml-1 opacity-50 hover:opacity-100 transition-opacity">
        <X size={13} />
      </button>
    </div>
  );
}
