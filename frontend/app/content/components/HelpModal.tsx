'use client';

import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';

interface HelpModalProps {
  title: string;
  children: React.ReactNode;
  onClose: () => void;
}

export function HelpModal({ title, children, onClose }: HelpModalProps) {
  return (
    <Dialog open={true} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <div className="text-sm text-[var(--text-secondary)] leading-relaxed space-y-3">{children}</div>
      </DialogContent>
    </Dialog>
  );
}
