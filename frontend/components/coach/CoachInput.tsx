"use client";
import { useEffect, useRef, useState } from "react";
import { ArrowUp, Square } from "lucide-react";
import { useCoach } from "@/contexts/CoachContext";

const MAX_INPUT_HEIGHT = 120;

export function CoachInput() {
  const { state, send, stop } = useCoach();
  const [value, setValue] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const disabled = state.sending || state.limitHit;

  useEffect(() => {
    if (state.open) textareaRef.current?.focus();
  }, [state.open]);

  // Re-focus once a turn finishes so the user can keep typing.
  useEffect(() => {
    if (!state.sending && state.open) textareaRef.current?.focus();
  }, [state.sending, state.open]);

  const autoGrow = () => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, MAX_INPUT_HEIGHT)}px`;
  };

  const submit = async () => {
    if (!value.trim() || disabled) return;
    const text = value;
    setValue("");
    requestAnimationFrame(autoGrow);
    await send(text);
  };

  return (
    <div className="border-t border-[var(--border-subtle)] p-3">
      <div className="flex items-end gap-2 rounded-[var(--radius-md)] border border-[rgba(255,255,255,0.10)] bg-[rgba(255,255,255,0.05)] px-3 py-2 transition-colors focus-within:border-[var(--accent)]">
        <textarea
          ref={textareaRef}
          value={value}
          onChange={(e) => { setValue(e.target.value); autoGrow(); }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              void submit();
            }
          }}
          rows={1}
          maxLength={4000}
          placeholder="Ask Lumi about your visibility…"
          className="max-h-[120px] flex-1 resize-none bg-transparent text-sm leading-relaxed text-[var(--text-primary)] placeholder:text-[var(--text-faint)] focus:outline-none disabled:opacity-60"
          disabled={disabled}
        />
        {state.sending ? (
          <button
            onClick={stop}
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[var(--bg-elevated)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
            aria-label="Stop generating"
          >
            <Square size={11} fill="currentColor" />
          </button>
        ) : (
          <button
            onClick={() => void submit()}
            disabled={disabled || !value.trim()}
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[var(--accent)] text-[var(--text-on-accent)] hover:bg-[var(--accent-hover)] disabled:opacity-35 disabled:hover:bg-[var(--accent)]"
            aria-label="Send"
          >
            <ArrowUp size={14} strokeWidth={2.5} />
          </button>
        )}
      </div>
      <div className="mt-1.5 px-1 text-[11px] text-[var(--text-faint)]">
        Enter to send · Shift+Enter for a new line
      </div>
    </div>
  );
}
