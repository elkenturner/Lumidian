"use client";
import { useEffect, useRef } from "react";
import { useCoach } from "@/contexts/CoachContext";
import { SuggestedQuestionChips } from "./SuggestedQuestionChips";

export function MessageList() {
  const { state } = useCoach();
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [state.messages]);

  if (state.messages.length === 0) {
    return (
      <div className="flex-1 overflow-y-auto p-4">
        <SuggestedQuestionChips />
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto p-4 space-y-3">
      {state.messages.map((m, i) => (
        <div key={i} className={m.role === "user" ? "flex justify-end" : "flex justify-start"}>
          <div className={`max-w-[85%] rounded-lg px-3 py-2 text-sm whitespace-pre-wrap ${
            m.role === "user" ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-900"
          }`}>
            {m.role === "assistant" && m.toolStatuses && m.toolStatuses.length > 0 && (
              <div className="mb-1 flex flex-wrap gap-1">
                {m.toolStatuses.map((t, j) => (
                  <span key={j} className="inline-flex items-center rounded-full bg-slate-200 px-2 py-0.5 text-[11px] text-slate-700">
                    {t.label}
                  </span>
                ))}
              </div>
            )}
            {m.text || (m.inProgress ? "…" : "")}
          </div>
        </div>
      ))}
      <div ref={endRef} />
    </div>
  );
}
