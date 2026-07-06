"use client";
import { useCoach } from "@/contexts/CoachContext";

interface Props {
  brandId: number;
  question: string;
  autoSubmit?: boolean;
  children?: React.ReactNode;
  className?: string;
}

export function AskCoachButton({ brandId, question, autoSubmit = true, children, className }: Props) {
  const { openWith } = useCoach();
  return (
    <button
      type="button"
      onClick={() => openWith({ brandId, question, autoSubmit })}
      className={className ?? "inline-flex items-center gap-1 text-xs font-medium text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"}
    >
      {children ?? "Ask Lumi"}
    </button>
  );
}
