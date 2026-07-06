'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { CheckCircle2, AlertCircle, Info, X } from 'lucide-react';
import { useIsMobile } from '@/hooks/useIsMobile';

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
    wrapper: 'bg-[rgba(10,14,24,0.95)] border-[rgba(95,126,166,0.25)] text-[var(--text-secondary)]',
    icon: <Info size={15} className="text-[var(--accent)] shrink-0" />,
  },
};

export function AppToast({ message, type, onDismiss }: AppToastProps) {
  const isMobile = useIsMobile();
  const { wrapper, icon } = styles[type];
  const [phase, setPhase] = useState<'enter' | 'visible' | 'exit'>('enter');

  // Trigger enter → visible on mount (one rAF ensures the enter class paints first)
  useEffect(() => {
    const id = requestAnimationFrame(() => setPhase('visible'));
    return () => cancelAnimationFrame(id);
  }, []);

  function handleDismiss() {
    setPhase('exit');
    // Wait for exit transition (200ms) before unmounting
    setTimeout(onDismiss, 220);
  }

  const phaseClass =
    phase === 'enter' ? 'toast-enter' :
    phase === 'visible' ? 'toast-visible' :
    'toast-exit';

  // Portaled to <body>: toasts mount inside per-page motion.div wrappers, and
  // any wrapper with a transform silently turns position:fixed into
  // position:absolute (the classic trap — currently the roots animate opacity
  // only, but one variants swap away from breaking every toast).
  return createPortal(
    <div
      role="alert"
      aria-live="assertive"
      aria-atomic="true"
      className={`fixed left-1/2 -translate-x-1/2 z-[60] flex items-center gap-3 px-4 py-3 rounded-xl shadow-2xl border text-sm font-medium max-w-[calc(100vw-32px)] sm:max-w-sm ${wrapper} ${phaseClass}`}
      style={isMobile ? { top: 60 } : { bottom: 24 }}
    >
      {icon}
      <span className="flex-1">{message}</span>
      <button onClick={handleDismiss} aria-label="Dismiss" className="ml-1 opacity-50 hover:opacity-100 transition-opacity">
        <X size={13} />
      </button>
    </div>,
    document.body
  );
}
