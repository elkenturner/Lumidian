'use client';

import { usePathname } from 'next/navigation';
import { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import { LayoutDashboard, LineChart, PenLine, Settings, Building2, ChevronUp } from 'lucide-react';
import Sidebar from '@/components/Sidebar';
import ErrorBoundary from '@/components/ErrorBoundary';
import { BrandProvider } from '@/contexts/BrandContext';
import { useAuth } from '@/contexts/AuthContext';
import { getBackgroundStatus } from '@/lib/api';
import { MODEL_CONFIG as MODEL_CONFIG_SHARED } from '@/lib/constants/models';

const MODEL_CONFIG: Record<string, { label: string; bg: string; text: string }> = Object.fromEntries(
  Object.entries(MODEL_CONFIG_SHARED).map(([k, v]) => [k, { label: v.label, bg: v.bgColor, text: v.color }])
);

const NO_SIDEBAR_PATHS = ['/', '/login', '/register', '/onboarding', '/forgot-password', '/reset-password', '/verify-email'];

const MOBILE_NAV = [
  { label: 'Dashboard', href: '/dashboard', icon: LayoutDashboard },
  { label: 'Brands',    href: '/settings',  icon: Building2 },
  { label: 'Reports',   href: '/reports',   icon: LineChart },
  { label: 'Content',   href: '/content',   icon: PenLine },
  { label: 'Settings',  href: '/account',   icon: Settings },
];

export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [sidebarExpanded, setSidebarExpanded] = useState(false);
  const [reportRunning, setReportRunning] = useState(false);
  const [draftsGenerating, setDraftsGenerating] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [modelScores, setModelScores] = useState<Array<{ model: string; score: number }>>([]);
  const [isMobile, setIsMobile] = useState(false);
  const { user } = useAuth();

  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 768);
    check();
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, []);

  // Poll backend every 3 s for live background-task status.
  // Falls back to localStorage fast-path so pages that write flags immediately
  // still get instant banner feedback before the first API response.
  useEffect(() => {
    // Fast-path: sync from localStorage for instant feedback on report/drafts
    // (scanning state comes purely from API since no page writes it)
    const syncLocal = () => {
      try {
        if (localStorage.getItem('clarity_report_running')) setReportRunning(true);
        if (localStorage.getItem('clarity_drafts_generating')) setDraftsGenerating(true);
        // Note: scanning state comes from API only
      } catch {}
    };
    syncLocal();
    window.addEventListener('storage', syncLocal);

    if (!user) {
      setReportRunning(false);
      setDraftsGenerating(false);
      setScanning(false);
      return () => window.removeEventListener('storage', syncLocal);
    }

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const FAST_INTERVAL = 3_000;
    const SLOW_INTERVAL = 15_000;

    const poll = async () => {
      let active = false;
      try {
        const status = await getBackgroundStatus();
        if (!cancelled) {
          setReportRunning(status.report_running);
          setDraftsGenerating(status.drafts_generating);
          setScanning(status.scanning);
          setModelScores(status.model_scores || []);
          active = status.report_running || status.drafts_generating || status.scanning;
          try {
            if (!status.report_running) localStorage.removeItem('clarity_report_running');
            if (!status.drafts_generating) localStorage.removeItem('clarity_drafts_generating');
          } catch {}
        }
      } catch {
        if (!cancelled) {
          setReportRunning(false);
          setDraftsGenerating(false);
          setScanning(false);
          setModelScores([]);
        }
      }
      if (!cancelled) {
        timer = setTimeout(poll, active ? FAST_INTERVAL : SLOW_INTERVAL);
      }
    };

    poll();

    return () => {
      cancelled = true;
      clearTimeout(timer);
      window.removeEventListener('storage', syncLocal);
    };
  }, [user]); // eslint-disable-line react-hooks/exhaustive-deps

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
      {/* Fixed slate base background */}
      <div style={{ position: 'fixed', inset: 0, background: 'var(--bg-base)', zIndex: -2 }} />

      {/* Desktop sidebar — hidden on mobile */}
      {!isMobile && (
        <Sidebar expanded={sidebarExpanded} onExpandedChange={setSidebarExpanded} />
      )}

      <main
        className="min-h-screen relative"
        style={{
          marginLeft: isMobile ? 0 : (sidebarExpanded ? 220 : 56),
          marginBottom: isMobile ? 72 : 0,
          transition: 'margin-left 0.2s ease',
          zIndex: 0,
        }}
      >
        {/* Global status banners — written by dashboard/content pages via localStorage */}
        {reportRunning && (
          <div style={{
            background: 'rgba(99,102,241,0.06)',
            borderBottom: '1px solid rgba(99,102,241,0.18)',
            padding: isMobile ? '6px 12px' : '8px 28px',
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            flexWrap: 'wrap',
          }}>
            <span style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--accent)', display: 'inline-block', animation: 'pulse 2s cubic-bezier(0.4,0,0.6,1) infinite' }} />
            <span style={{ fontSize: 12, color: 'var(--accent-light)', fontWeight: 600 }}>Report in progress</span>
            <span style={{ fontSize: 12, color: 'var(--accent)' }}>— querying AI models with your prompts.</span>
            {!isMobile && modelScores.length > 0 && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginLeft: 8 }}>
                {modelScores.map((ms) => {
                  const cfg = MODEL_CONFIG[ms.model] || { label: ms.model, bg: 'rgba(100,116,139,0.15)', text: 'var(--text-muted)' };
                  return (
                    <span
                      key={ms.model}
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 4,
                        fontSize: 10,
                        fontWeight: 600,
                        padding: '2px 8px',
                        borderRadius: 9999,
                        background: cfg.bg,
                        color: cfg.text,
                      }}
                    >
                      <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="20 6 9 17 4 12" />
                      </svg>
                      {cfg.label}: {ms.score}%
                    </span>
                  );
                })}
              </div>
            )}
          </div>
        )}
        {draftsGenerating && (
          <div style={{
            background: 'rgba(16,185,129,0.06)',
            borderBottom: '1px solid rgba(16,185,129,0.18)',
            padding: isMobile ? '6px 12px' : '8px 28px',
            display: 'flex',
            alignItems: 'center',
            gap: 10,
          }}>
            <span style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--success)', display: 'inline-block', animation: 'pulse 2s cubic-bezier(0.4,0,0.6,1) infinite' }} />
            <span style={{ fontSize: 12, color: 'var(--success-text)', fontWeight: 600 }}>Drafts generating</span>
            <span style={{ fontSize: 12, color: 'var(--success)' }}>— writing new content drafts for your top visibility gaps.</span>
          </div>
        )}
        {scanning && (
          <div style={{
            background: 'rgba(6,182,212,0.06)',
            borderBottom: '1px solid rgba(6,182,212,0.18)',
            padding: isMobile ? '6px 12px' : '8px 28px',
            display: 'flex',
            alignItems: 'center',
            gap: 10,
          }}>
            <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#06b6d4', display: 'inline-block', animation: 'pulse 2s cubic-bezier(0.4,0,0.6,1) infinite' }} />
            <span style={{ fontSize: 12, color: '#67e8f9', fontWeight: 600 }}>Scanning live opportunities</span>
            <span style={{ fontSize: 12, color: '#06b6d4' }}>— finding relevant discussions on Reddit and Quora.</span>

          </div>
        )}
        {children}
      </main>

      {/* Mobile bottom navigation */}
      {isMobile && (
        <nav
          aria-label="Main navigation"
          className="safe-bottom"
          style={{
            position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 50,
            background: 'rgba(8,12,20,0.97)',
            backdropFilter: 'blur(24px)',
            WebkitBackdropFilter: 'blur(24px)',
            borderTop: '1px solid rgba(255,255,255,0.08)',
            display: 'flex',
            alignItems: 'stretch',
            justifyContent: 'space-around',
            paddingTop: 6,
            paddingBottom: 6,
            paddingLeft: 4,
            paddingRight: 4,
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
                  justifyContent: 'center',
                  gap: 2,
                  flex: 1,
                  padding: '8px 0',
                  color: isActive ? 'var(--accent-light)' : 'var(--text-faint)',
                  textDecoration: 'none',
                  fontSize: 10,
                  fontWeight: isActive ? 600 : 500,
                  position: 'relative',
                  minHeight: 48,
                }}
              >
                {isActive && (
                  <span style={{
                    position: 'absolute',
                    top: 0,
                    left: '50%',
                    transform: 'translateX(-50%)',
                    width: 20,
                    height: 2,
                    borderRadius: 1,
                    background: 'var(--accent-light)',
                  }} />
                )}
                <Icon size={20} strokeWidth={isActive ? 2.2 : 1.75} />
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
