"use client";

interface Props {
  isPro: boolean;
  notes: Array<{ marker: string; action: "keep" | "drop"; reason: string }> | null;
}

/**
 * Pro-tier citation critic notes panel. v1 has no persisted critic notes —
 * the critic LLM runs at draft generation time and drops bad markers in
 * place. Showing the historical actions would need a persistence layer
 * that's out of scope for this redesign; for now we render the gate.
 */
export function CriticNotesSubpanel({ isPro, notes }: Props) {
  if (!isPro) {
    return (
      <div className="text-sm text-[var(--text-faint)] italic">
        Citation critic is a Pro-tier feature.
      </div>
    );
  }
  if (!notes || notes.length === 0) {
    return (
      <div className="text-sm text-[var(--text-faint)]">
        No critic notes recorded for this piece yet.
      </div>
    );
  }
  return (
    <ul className="space-y-1 text-sm">
      {notes.map((n, i) => (
        <li key={i} className="text-[var(--text-secondary)]">
          <span
            className={
              n.action === "drop"
                ? "text-rose-300 font-medium"
                : "text-emerald-300 font-medium"
            }
          >
            {n.action.toUpperCase()}
          </span>{" "}
          <span className="font-mono text-xs">[{n.marker}]</span> — {n.reason}
        </li>
      ))}
    </ul>
  );
}
