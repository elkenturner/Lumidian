'use client';

import { usePathname } from 'next/navigation';
import { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import { LayoutDashboard, BarChart2, FileText, Settings } from 'lucide-react';
import Sidebar from '@/components/Sidebar';
import ErrorBoundary from '@/components/ErrorBoundary';
import { BrandProvider } from '@/contexts/BrandContext';

const NO_SIDEBAR_PATHS = ['/', '/login', '/register', '/onboarding', '/forgot-password', '/reset-password'];

const MOBILE_NAV = [
  { label: 'Dashboard', href: '/dashboard', icon: LayoutDashboard },
  { label: 'Reports',   href: '/reports',   icon: BarChart2 },
  { label: 'Content',   href: '/content',   icon: FileText },
  { label: 'Settings',  href: '/settings',  icon: Settings },
];

export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [sidebarExpanded, setSidebarExpanded] = useState(false);
  const [reportRunning, setReportRunning] = useState(false);
  const [draftsGenerating, setDraftsGenerating] = useState(false);
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 768);
    check();
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, []);

  // Sync localStorage status flags — use storage events for cross-tab sync,
  // with a single initial read. No polling needed.
  useEffect(() => {
    const sync = () => {
      try {
        setReportRunning(!!localStorage.getItem('clarity_report_running'));
        setDraftsGenerating(!!localStorage.getItem('clarity_drafts_generating'));
      } catch {}
    };
    sync();
    window.addEventListener('storage', sync);
    // Fallback: poll only when the tab is visible and less aggressively
    const id = setInterval(sync, 5000);
    return () => {
      window.removeEventListener('storage', sync);
      clearInterval(id);
    };
  }, []);

  // Dev-mode navigation timing
  const navTimerRef = useRef<number>(0);
  useEffect(() => {
    if (process.env.NODE_ENV !== 'development') return;
    const now = performance.now();
    if (navTimerRef.current > 0) {
      const elapsed = (now - navTimerRef.current).toFixed(0);
      console.debug(`[Lumidian] Route rendered in ${elapsed}ms`);
    }
    navTimerRef.current = now;
  }, [pathname]);

  const showSidebar = !NO_SIDEBAR_PATHS.some(
    (p) => pathname === p || pathname.startsWith(p + '/')
  );

  if (!showSidebar) {
    return <ErrorBoundary>{children}</ErrorBoundary>;
  }

  return (
    <ErrorBoundary>
    <BrandProvider>
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

      {/* Desktop sidebar — hidden on mobile */}
      {!isMobile && (
        <Sidebar expanded={sidebarExpanded} onExpandedChange={setSidebarExpanded} />
      )}

      <main
        className="min-h-screen relative"
        style={{
          marginLeft: isMobile ? 0 : (sidebarExpanded ? 220 : 56),
          marginBottom: isMobile ? 56 : 0,
          transition: 'margin-left 0.2s ease',
          zIndex: 0,
        }}
      >
        {/* Global status banners — written by dashboard/content pages via localStorage */}
        {reportRunning && (
          <div style={{
            background: 'rgba(99,102,241,0.08)',
            borderBottom: '1px solid rgba(99,102,241,0.20)',
            padding: '8px 28px',
            display: 'flex',
            alignItems: 'center',
            gap: 10,
          }}>
            <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#6366f1', display: 'inline-block', animation: 'pulse 2s cubic-bezier(0.4,0,0.6,1) infinite' }} />
            <span style={{ fontSize: 12, color: '#818cf8', fontWeight: 600 }}>Report in progress</span>
            <span style={{ fontSize: 12, color: '#6366f1' }}>— querying AI models with your prompts, this may take a minute.</span>
          </div>
        )}
        {draftsGenerating && (
          <div style={{
            background: 'rgba(16,185,129,0.06)',
            borderBottom: '1px solid rgba(16,185,129,0.18)',
            padding: '8px 28px',
            display: 'flex',
            alignItems: 'center',
            gap: 10,
          }}>
            <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#10b981', display: 'inline-block', animation: 'pulse 2s cubic-bezier(0.4,0,0.6,1) infinite' }} />
            <span style={{ fontSize: 12, color: '#34d399', fontWeight: 600 }}>Drafts generating</span>
            <span style={{ fontSize: 12, color: '#10b981' }}>— writing new content drafts for your top visibility gaps.</span>
          </div>
        )}
        {children}
      </main>

      {/* Mobile bottom navigation */}
      {isMobile && (
        <nav
          aria-label="Main navigation"
          style={{
            position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 50,
            height: 56,
            background: 'rgba(8,12,20,0.95)',
            backdropFilter: 'blur(20px)',
            borderTop: '1px solid rgba(255,255,255,0.08)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-around',
            padding: '0 8px',
          }}
        >
          {MOBILE_NAV.map(({ label, href, icon: Icon }) => {
            const isActive = pathname === href || pathname.startsWith(href + '/');
            return (
              <Link
                key={href}
                href={href}
                aria-label={label}
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  gap: 3,
                  flex: 1,
                  padding: '6px 0',
                  color: isActive ? '#818cf8' : '#475569',
                  textDecoration: 'none',
                  fontSize: 10,
                  fontWeight: 500,
                }}
              >
                <Icon size={20} />
                <span>{label}</span>
              </Link>
            );
          })}
        </nav>
      )}
    </>
    </BrandProvider>
    </ErrorBoundary>
  );
}
