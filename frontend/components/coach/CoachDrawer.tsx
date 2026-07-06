"use client";
import * as Dialog from "@radix-ui/react-dialog";
import { Sparkles, X } from "lucide-react";
import { useCoach } from "@/contexts/CoachContext";
import { MessageList } from "./MessageList";
import { CoachInput } from "./CoachInput";
import { UsagePill } from "./UsagePill";
import { LimitHitCard } from "./LimitHitCard";

export function CoachDrawer({ tierKey }: { tierKey: string | null }) {
  const { state, close } = useCoach();

  return (
    <Dialog.Root open={state.open} onOpenChange={(o) => (o ? null : close())}>
      <Dialog.Portal>
        <Dialog.Overlay className="coach-overlay fixed inset-0 z-40 bg-black/50 backdrop-blur-[2px]" />
        <Dialog.Content
          aria-describedby={undefined}
          className="coach-drawer fixed right-0 top-0 z-50 flex h-full w-full max-w-[440px] flex-col border-l border-[var(--border-subtle)] bg-[var(--bg-raised)] shadow-[var(--shadow-elevated)] focus:outline-none"
        >
          <header className="flex items-center justify-between border-b border-[var(--border-subtle)] px-4 py-3">
            <div className="flex items-center gap-2.5">
              <div
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[var(--radius-md)]"
                style={{ background: "var(--gradient-signature)" }}
              >
                <Sparkles size={15} className="text-[var(--text-on-accent)]" />
              </div>
              <div className="leading-tight">
                <Dialog.Title className="text-sm font-semibold text-[var(--text-primary)]">
                  Lumi
                </Dialog.Title>
                <div className="text-[11px] text-[var(--text-muted)]">AI visibility coach</div>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <UsagePill usage={state.usage} />
              <button
                onClick={close}
                className="rounded-[var(--radius-sm)] p-1.5 text-[var(--text-muted)] hover:bg-[var(--bg-tinted)] hover:text-[var(--text-primary)]"
                aria-label="Close"
              >
                <X size={16} />
              </button>
            </div>
          </header>
          <MessageList />
          {state.limitHit && state.usage ? (
            <div className="border-t border-[var(--border-subtle)] p-3">
              <LimitHitCard usage={state.usage} tierKey={tierKey} />
            </div>
          ) : (
            <CoachInput />
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
