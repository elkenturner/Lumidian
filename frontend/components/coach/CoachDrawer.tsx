"use client";
import * as Dialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";
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
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/30 data-[state=open]:animate-in data-[state=open]:fade-in" />
        <Dialog.Content className="fixed right-0 top-0 z-50 flex h-full w-full max-w-[420px] flex-col bg-white shadow-xl data-[state=open]:animate-in data-[state=open]:slide-in-from-right">
          <header className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
            <div className="flex items-center gap-2">
              <Dialog.Title className="text-sm font-semibold text-slate-900">Lumi</Dialog.Title>
              <UsagePill usage={state.usage} />
            </div>
            <button
              onClick={close}
              className="rounded-md p-1 text-slate-400 hover:bg-slate-100"
              aria-label="Close"
            >
              <X size={16} />
            </button>
          </header>
          <MessageList />
          {state.limitHit && state.usage ? (
            <div className="p-3">
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
