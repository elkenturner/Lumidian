import type { Metadata } from 'next';
import { CoachShell } from '@/components/coach/CoachShell';

export const metadata: Metadata = {
  title: 'Dashboard',
};

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return <CoachShell>{children}</CoachShell>;
}
