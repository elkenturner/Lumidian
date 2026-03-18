'use client';

import { usePathname } from 'next/navigation';
import { useState } from 'react';
import Sidebar from '@/components/Sidebar';

const NO_SIDEBAR_PATHS = ['/', '/login', '/register', '/onboarding'];

export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [sidebarExpanded, setSidebarExpanded] = useState(false);

  const showSidebar = !NO_SIDEBAR_PATHS.some(
    (p) => pathname === p || pathname.startsWith(p + '/')
  );

  if (!showSidebar) {
    return <>{children}</>;
  }

  return (
    <>
      {/* Fixed dark base */}
      <div style={{ position: 'fixed', inset: 0, background: '#080C14', zIndex: -2 }} />

      {/* Ambient gradient blobs — atmospheric depth behind all content */}
      <div style={{ position: 'fixed', inset: 0, zIndex: -1, overflow: 'hidden', pointerEvents: 'none' }}>
        {/* Top-left: deep indigo */}
        <div className="orb-1" style={{
          position: 'absolute', top: '-15%', left: '-10%',
          width: '580px', height: '580px',
          background: 'radial-gradient(circle, rgba(55,48,163,0.15) 0%, transparent 65%)',
          filter: 'blur(100px)', borderRadius: '50%',
        }} />
        {/* Right-center: soft purple */}
        <div className="orb-2" style={{
          position: 'absolute', top: '30%', right: '-14%',
          width: '500px', height: '500px',
          background: 'radial-gradient(circle, rgba(124,58,237,0.10) 0%, transparent 65%)',
          filter: 'blur(90px)', borderRadius: '50%',
        }} />
        {/* Bottom-center: dark teal */}
        <div className="orb-3" style={{
          position: 'absolute', bottom: '-18%', left: '20%',
          width: '540px', height: '540px',
          background: 'radial-gradient(circle, rgba(13,148,136,0.08) 0%, transparent 65%)',
          filter: 'blur(110px)', borderRadius: '50%',
        }} />
        {/* Top-right: extra indigo accent */}
        <div className="orb-4" style={{
          position: 'absolute', top: '-10%', right: '15%',
          width: '420px', height: '420px',
          background: 'radial-gradient(circle, rgba(55,48,163,0.09) 0%, transparent 65%)',
          filter: 'blur(80px)', borderRadius: '50%',
        }} />
      </div>

      <Sidebar expanded={sidebarExpanded} onExpandedChange={setSidebarExpanded} />
      <main
        className="min-h-screen relative"
        style={{
          marginLeft: sidebarExpanded ? 220 : 56,
          transition: 'margin-left 0.2s ease',
          zIndex: 0,
        }}
      >
        {children}
      </main>
    </>
  );
}
