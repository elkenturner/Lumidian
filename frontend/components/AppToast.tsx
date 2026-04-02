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
    wrapper: 'bg-[rgba(6,78,59,0.90)] border-[#065f46]/50 text-[#34d399]',
    icon: <CheckCircle2 size={15} className="text-[#34d399] shrink-0" />,
  },
  error: {
    wrapper: 'bg-[rgba(127,29,29,0.90)] border-[#991b1b]/50 text-[#fca5a5]',
    icon: <AlertCircle size={15} className="text-[#fca5a5] shrink-0" />,
  },
  info: {
    wrapper: 'bg-[#0f172a] border-[#334155] text-[#94A3B8]',
    icon: <Info size={15} className="text-[#6366f1] shrink-0" />,
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
