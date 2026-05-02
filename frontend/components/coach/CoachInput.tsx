"use client";
import { useState } from "react";
import { useCoach } from "@/contexts/CoachContext";

export function CoachInput() {
  const { state, send } = useCoach();
  const [value, setValue] = useState("");

  const disabled = state.sending || state.limitHit;

  const submit = async () => {
    if (!value.trim() || disabled) return;
    const text = value;
    setValue("");
    await send(text);
  };

  return (
    <div className="border-t border-slate-200 bg-white p-3">
      <textarea
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
            e.preventDefault();
            void submit();
          }
        }}
        rows={2}
        placeholder="Ask Lumi about your visibility…"
        className="w-full resize-none rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-slate-500 focus:outline-none"
        disabled={disabled}
      />
      <div className="mt-2 flex items-center justify-between">
        <div className="text-xs text-slate-400">⌘/Ctrl + Enter to send</div>
        <button
          onClick={() => void submit()}
          disabled={disabled || !value.trim()}
          className="rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-300"
        >
          Send
        </button>
      </div>
    </div>
  );
}
