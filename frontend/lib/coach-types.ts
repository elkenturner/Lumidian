// frontend/lib/coach-types.ts

export type CoachRole = "user" | "assistant";

export interface CoachToolStatus {
  name: string;
  label: string;
}

export interface CoachMessage {
  role: CoachRole;
  text: string;
  // Tool-status pills attached to an in-progress assistant message
  toolStatuses?: CoachToolStatus[];
  // True while the assistant is still streaming
  inProgress?: boolean;
  // Set when the turn failed — rendered as an error state in the thread
  error?: string;
}

export interface CoachUsage {
  used: number;
  limit: number;
  resets_at: string;
}

export type CoachSSEEvent =
  | { type: "text_delta"; data: { text: string } }
  | { type: "tool_status"; data: { name: string; label: string } }
  | { type: "done"; data: object }
  | { type: "error"; data: { message: string } };
