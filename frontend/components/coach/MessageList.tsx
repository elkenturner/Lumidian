"use client";
import { useEffect, useRef } from "react";
import type { ReactNode } from "react";
import { AlertCircle, Loader2 } from "lucide-react";
import type { CoachMessage } from "@/lib/coach-types";
import { useCoach } from "@/contexts/CoachContext";
import { SuggestedQuestionChips } from "./SuggestedQuestionChips";

/** Render the light markdown Lumi emits (bold only) — without this, `**text**`
 * shows up as literal asterisks in the chat bubble. */
function renderCoachText(text: string): ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
    part.startsWith("**") && part.endsWith("**") ? (
      <strong key={i} className="font-semibold text-[var(--text-primary)]">{part.slice(2, -2)}</strong>
    ) : (
      part
    )
  );
}

function TypingDots() {
  return (
    <span className="coach-typing inline-flex items-center gap-1 py-1" aria-label="Lumi is thinking">
      <span /><span /><span />
    </span>
  );
}

function AssistantBubble({ m }: { m: CoachMessage }) {
  const activeTool = m.inProgress && m.toolStatuses && m.toolStatuses.length > 0
    ? m.toolStatuses[m.toolStatuses.length - 1]
    : null;

  return (
    <div className="flex justify-start">
      <div className="max-w-[85%] rounded-xl rounded-bl-md bg-[var(--bg-tinted)] px-3.5 py-2.5 text-sm leading-relaxed text-[var(--text-secondary)] whitespace-pre-wrap">
        {activeTool && (
          <div className="mb-1.5 flex items-center gap-1.5 text-xs text-[var(--text-muted)]">
            <Loader2 size={12} className="animate-spin" />
            {activeTool.label}
          </div>
        )}
        {m.text
          ? renderCoachText(m.text)
          : m.inProgress && !activeTool
            ? <TypingDots />
            : null}
        {m.error && (
          <div className={`flex items-start gap-1.5 text-xs text-[var(--danger-text)] ${m.text ? "mt-2" : ""}`}>
            <AlertCircle size={13} className="mt-0.5 shrink-0" />
            <span>{m.error}</span>
          </div>
        )}
      </div>
    </div>
  );
}

export function MessageList() {
  const { state } = useCoach();
  const scrollRef = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);

  // Follow the stream only while the user is at (or near) the bottom, so
  // scrolling up to re-read older messages isn't yanked back down.
  useEffect(() => {
    const el = scrollRef.current;
    if (el && stickToBottom.current) el.scrollTop = el.scrollHeight;
  }, [state.messages]);

  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  };

  if (state.messages.length === 0) {
    return (
      <div className="flex-1 overflow-y-auto p-4">
        <SuggestedQuestionChips />
      </div>
    );
  }

  return (
    <div ref={scrollRef} onScroll={onScroll} className="flex-1 space-y-3 overflow-y-auto p-4">
      {state.messages.map((m, i) =>
        m.role === "user" ? (
          <div key={i} className="flex justify-end">
            <div className="max-w-[85%] rounded-xl rounded-br-md bg-[var(--accent)] px-3.5 py-2.5 text-sm leading-relaxed text-[var(--text-on-accent)] whitespace-pre-wrap">
              {m.text}
            </div>
          </div>
        ) : (
          <AssistantBubble key={i} m={m} />
        )
      )}
    </div>
  );
}
