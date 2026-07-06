// frontend/lib/coach-sse.ts
import type { CoachSSEEvent } from "@/lib/coach-types";

export interface StreamCoachOptions {
  brandId: number;
  messages: { role: string; content: string }[];
  signal?: AbortSignal;
  onEvent: (ev: CoachSSEEvent) => void;
  onError?: (err: Error) => void;
  onClose?: () => void;
}

export async function streamCoach({
  brandId,
  messages,
  signal,
  onEvent,
  onError,
  onClose,
}: StreamCoachOptions): Promise<void> {
  let response: Response;
  try {
    response = await fetch(`/api/coach/${brandId}/message`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
      body: JSON.stringify({ messages }),
      signal,
    });
  } catch (err) {
    if ((err as Error).name !== "AbortError") {
      onEvent({ type: "error", data: { message: "network" } });
      onError?.(err as Error);
    }
    onClose?.();
    return;
  }

  if (response.status === 429) {
    await response.json().catch(() => ({}));
    onEvent({ type: "error", data: { message: "rate_limited" } });
    onClose?.();
    return;
  }

  if (!response.ok || !response.body) {
    onEvent({ type: "error", data: { message: "request_failed" } });
    onError?.(new Error(`Coach request failed (${response.status})`));
    onClose?.();
    return;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let sep: number;
      // SSE events are separated by a blank line
      while ((sep = buf.indexOf("\n\n")) !== -1) {
        const raw = buf.slice(0, sep);
        buf = buf.slice(sep + 2);
        const ev = parseSSEEvent(raw);
        if (ev) onEvent(ev);
      }
    }
  } catch (err) {
    if ((err as Error).name !== "AbortError") {
      onEvent({ type: "error", data: { message: "stream_interrupted" } });
      onError?.(err as Error);
    }
  } finally {
    onClose?.();
  }
}

function parseSSEEvent(raw: string): CoachSSEEvent | null {
  let eventName = "message";
  const dataLines: string[] = [];
  for (const line of raw.split("\n")) {
    if (line.startsWith("event:")) eventName = line.slice(6).trim();
    else if (line.startsWith("data:")) dataLines.push(line.slice(5).trim());
  }
  if (!dataLines.length) return null;
  let data: object;
  try {
    data = JSON.parse(dataLines.join("\n"));
  } catch {
    return null;
  }
  if (
    eventName === "text_delta" ||
    eventName === "tool_status" ||
    eventName === "done" ||
    eventName === "error"
  ) {
    return { type: eventName, data } as CoachSSEEvent;
  }
  return null;
}
