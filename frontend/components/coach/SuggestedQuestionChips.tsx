"use client";
import { useCoach } from "@/contexts/CoachContext";

const CHIPS = [
  "Is my score good?",
  "What should I focus on?",
  "How do I compare to competitors?",
];

export function SuggestedQuestionChips() {
  const { send } = useCoach();
  return (
    <div className="space-y-2">
      <div className="text-sm text-slate-600">Hi — I&apos;m Lumi. I help you make sense of your visibility data. Try one of these:</div>
      <div className="flex flex-wrap gap-2">
        {CHIPS.map((q) => (
          <button
            key={q}
            onClick={() => void send(q)}
            className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs text-slate-700 hover:bg-slate-100"
          >
            {q}
          </button>
        ))}
      </div>
    </div>
  );
}
