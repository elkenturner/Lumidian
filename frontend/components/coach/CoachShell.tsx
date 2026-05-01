"use client";
import { CoachProvider } from "@/contexts/CoachContext";
import { CoachDrawer } from "@/components/coach/CoachDrawer";
import { useAuth } from "@/contexts/AuthContext";

export function CoachShell({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  return (
    <CoachProvider>
      {children}
      <CoachDrawer tierKey={user?.subscription_tier ?? null} />
    </CoachProvider>
  );
}
