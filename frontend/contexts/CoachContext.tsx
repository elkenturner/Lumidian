// frontend/contexts/CoachContext.tsx
"use client";
import React, { createContext, useCallback, useContext, useMemo, useRef, useState } from "react";
import { streamCoach } from "@/lib/coach-sse";
import type { CoachMessage, CoachUsage } from "@/lib/coach-types";
import { getCoachUsage } from "@/lib/api";

type State = {
  open: boolean;
  brandId: number | null;
  messages: CoachMessage[];
  usage: CoachUsage | null;
  limitHit: boolean;
  sending: boolean;
};

type Action =
  | { type: "open"; brandId: number }
  | { type: "close" }
  | { type: "set_messages"; messages: CoachMessage[] }
  | { type: "append_user"; text: string }
  | { type: "start_assistant" }
  | { type: "append_text"; text: string }
  | { type: "append_tool_status"; name: string; label: string }
  | { type: "finish_assistant" }
  | { type: "set_usage"; usage: CoachUsage }
  | { type: "set_limit_hit"; hit: boolean }
  | { type: "set_sending"; sending: boolean }
  | { type: "reset_for_brand"; brandId: number };

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case "open":
      // If brand changed, reset messages
      if (state.brandId !== action.brandId) {
        return { ...state, open: true, brandId: action.brandId, messages: [], limitHit: false };
      }
      return { ...state, open: true };
    case "close":
      return { ...state, open: false };
    case "set_messages":
      return { ...state, messages: action.messages };
    case "append_user":
      return { ...state, messages: [...state.messages, { role: "user", text: action.text }] };
    case "start_assistant":
      return { ...state, messages: [...state.messages, { role: "assistant", text: "", inProgress: true, toolStatuses: [] }] };
    case "append_text": {
      const last = state.messages[state.messages.length - 1];
      if (!last || last.role !== "assistant") return state;
      const updated = { ...last, text: last.text + action.text };
      return { ...state, messages: [...state.messages.slice(0, -1), updated] };
    }
    case "append_tool_status": {
      const last = state.messages[state.messages.length - 1];
      if (!last || last.role !== "assistant") return state;
      const updated = { ...last, toolStatuses: [...(last.toolStatuses ?? []), { name: action.name, label: action.label }] };
      return { ...state, messages: [...state.messages.slice(0, -1), updated] };
    }
    case "finish_assistant": {
      const last = state.messages[state.messages.length - 1];
      if (!last || last.role !== "assistant") return state;
      return { ...state, messages: [...state.messages.slice(0, -1), { ...last, inProgress: false }] };
    }
    case "set_usage":
      return { ...state, usage: action.usage, limitHit: action.usage.used >= action.usage.limit };
    case "set_limit_hit":
      return { ...state, limitHit: action.hit };
    case "set_sending":
      return { ...state, sending: action.sending };
    case "reset_for_brand":
      return { ...state, brandId: action.brandId, messages: [], limitHit: false };
    default:
      return state;
  }
}

type CoachAPI = {
  state: State;
  open: (opts: { brandId: number }) => void;
  close: () => void;
  openWith: (opts: { brandId: number; question: string; autoSubmit?: boolean }) => void;
  send: (text: string) => Promise<void>;
  refreshUsage: () => Promise<void>;
};

const CoachContext = createContext<CoachAPI | null>(null);

export function CoachProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = React.useReducer(reducer, {
    open: false,
    brandId: null,
    messages: [],
    usage: null,
    limitHit: false,
    sending: false,
  });
  const abortRef = useRef<AbortController | null>(null);

  const refreshUsage = useCallback(async () => {
    if (state.brandId == null) return;
    try {
      const usage = await getCoachUsage(state.brandId);
      dispatch({ type: "set_usage", usage });
    } catch {
      // Non-fatal
    }
  }, [state.brandId]);

  const send = useCallback(async (text: string) => {
    if (state.brandId == null || state.sending || state.limitHit) return;
    const trimmed = text.trim();
    if (!trimmed) return;

    const conversation = [
      ...state.messages.map((m) => ({ role: m.role, content: m.text })),
      { role: "user", content: trimmed },
    ];

    dispatch({ type: "append_user", text: trimmed });
    dispatch({ type: "start_assistant" });
    dispatch({ type: "set_sending", sending: true });

    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;

    await streamCoach({
      brandId: state.brandId,
      messages: conversation,
      signal: ctrl.signal,
      onEvent: (ev) => {
        if (ev.type === "text_delta") {
          dispatch({ type: "append_text", text: ev.data.text });
        } else if (ev.type === "tool_status") {
          dispatch({ type: "append_tool_status", name: ev.data.name, label: ev.data.label });
        } else if (ev.type === "error" && ev.data.message === "rate_limited") {
          dispatch({ type: "set_limit_hit", hit: true });
        }
      },
      onClose: () => {
        dispatch({ type: "finish_assistant" });
        dispatch({ type: "set_sending", sending: false });
        // Refresh usage after a successful turn
        void refreshUsage();
      },
    });
  }, [state.brandId, state.messages, state.sending, state.limitHit, refreshUsage]);

  // Pending question is queued here; a useEffect picks it up after the
  // brandId state has actually updated. Avoids the stale-closure trap of
  // calling send() synchronously after dispatching a brand change.
  const [pendingQuestion, setPendingQuestion] = useState<string | null>(null);

  const open = useCallback((opts: { brandId: number }) => {
    dispatch({ type: "open", brandId: opts.brandId });
    void refreshUsage();
  }, [refreshUsage]);

  const close = useCallback(() => dispatch({ type: "close" }), []);

  const openWith = useCallback((opts: { brandId: number; question: string; autoSubmit?: boolean }) => {
    dispatch({ type: "open", brandId: opts.brandId });
    void refreshUsage();
    if (opts.autoSubmit ?? true) {
      setPendingQuestion(opts.question);
    }
  }, [refreshUsage]);

  React.useEffect(() => {
    if (pendingQuestion != null && state.brandId != null && !state.sending) {
      const q = pendingQuestion;
      setPendingQuestion(null);
      void send(q);
    }
  }, [pendingQuestion, state.brandId, state.sending, send]);

  const value = useMemo<CoachAPI>(() => ({ state, open, close, openWith, send, refreshUsage }),
    [state, open, close, openWith, send, refreshUsage]);

  return <CoachContext.Provider value={value}>{children}</CoachContext.Provider>;
}

export function useCoach(): CoachAPI {
  const ctx = useContext(CoachContext);
  if (!ctx) throw new Error("useCoach must be used inside CoachProvider");
  return ctx;
}
