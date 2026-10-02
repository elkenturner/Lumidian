"use client";
import { Sparkles } from "lucide-react";
import { useCoach } from "@/contexts/CoachContext";

const CHIPS = [
  "Is my score good?",
  "What should I focus on?",
  "How do I compare to competitors?",
];

export function SuggestedQuestionChips() {
  const { send } = useCoach();
  return (
    <div className="flex h-full flex-col justify-end gap-4 pb-2">
      <div>
        <div
          className="mb-3 flex h-9 w-9 items-center justify-center rounded-[var(--radius-md)]"
          style={{ background: "var(--gradient-signature)" }}
        >
          <Sparkles size={16} className="text-[var(--text-on-accent)]" />
        </div>
        <div className="text-sm font-medium text-[var(--text-primary)]">Hi, I&apos;m Lumi.</div>
        <div className="mt-1 text-sm leading-relaxed text-[var(--text-secondary)]">
          I can read your runs, scores, competitors, and content gaps, and help you
          decide what to do next.
        </div>
      </div>
      <div className="flex flex-col items-start gap-2">
        {CHIPS.map((q) => (
          <button
            key={q}
            onClick={() => void send(q)}
            className="rounded-full border border-[var(--border-faint)] bg-[var(--bg-tinted)] px-3.5 py-1.5 text-xs text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-tinted-hover)] hover:text-[var(--text-primary)]"
          >
            {q}
          </button>
        ))}
      </div>
    </div>
  );
}
