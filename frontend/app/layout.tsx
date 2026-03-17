import type { Metadata } from 'next';
import './globals.css';
import Sidebar from '@/components/Sidebar';

export const metadata: Metadata = {
  title: 'ClarityAI - Brand Visibility Tracker',
  description: 'Track your brand visibility in AI-generated responses',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="bg-[#0a0a0f] text-[#e2e8f0] antialiased">
        <Sidebar />
        <main className="ml-64 min-h-screen bg-[#0a0a0f]">
          {children}
        </main>
      </body>
    </html>
  );
}
