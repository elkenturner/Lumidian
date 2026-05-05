import './globals.css';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Lumidian Agency',
  description: 'Internal cockpit for Lumidian agency operations',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen">{children}</body>
    </html>
  );
}
