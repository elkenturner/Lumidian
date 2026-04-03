'use client';

import { usePathname } from 'next/navigation';
import { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import { LayoutDashboard, LineChart, PenLine, Settings } from 'lucide-react';
import Sidebar from '@/components/Sidebar';
import ErrorBoundary from '@/components/ErrorBoundary';
import { BrandProvider } from '@/contexts/BrandContext';
import { useAuth } from '@/contexts/AuthContext';
import { getBackgroundStatus } from '@/lib/api';

const MODEL_CONFIG: Record<string, { label: string; bg: string; text: string }> = {
  chatgpt: { label: 'ChatGPT', bg: 'rgba(16,163,127,0.15)', text: '#10a37f' },
  claude: { label: 'Claude', bg: 'rgba(217,119,87,0.15)', text: '#d97757' },
  perplexity: { label: 'Perplexity', bg: 'rgba(32,170,215,0.15)', text: '#20aad7' },
  gemini: { label: 'Gemini', bg: 'rgba(66,133,244,0.15)', text: '#4285f4' },
};

const NO_SIDEBAR_PATHS = ['/', '/login', '/register', '/onboarding', '/forgot-password', '/reset-password', '/verify-email'];

const MOBILE_NAV = [
  { label: 'Dashboard', href: '/dashboard', icon: LayoutDashboard },
  { label: 'Reports',   href: '/reports',   icon: LineChart },
  { label: 'Content',   href: '/content',   icon: PenLine },
  { label: 'Settings',  href: '/settings',  icon: Settings },
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
    const poll = async () => {
      try {
        const status = await getBackgroundStatus();
        if (!cancelled) {
          setReportRunning(status.report_running);
          setDraftsGenerating(status.drafts_generating);
          setScanning(status.scanning);
          setModelScores(status.model_scores || []);
        }
      } catch {
        // Silently ignore poll errors — don't flash misleading banners
      }
    };

    poll();
    const interval = setInterval(poll, 3000);

    return () => {
      cancelled = true;
      clearInterval(interval);
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
      <div style={{ position: 'fixed', inset: 0, background: '#020617', zIndex: -2 }} />

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
            flexWrap: 'wrap',
          }}>
            <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#6366f1', display: 'inline-block', animation: 'pulse 2s cubic-bezier(0.4,0,0.6,1) infinite' }} />
            <span style={{ fontSize: 12, color: '#818cf8', fontWeight: 600 }}>Report in progress</span>
            <span style={{ fontSize: 12, color: '#6366f1' }}>— querying AI models with your prompts.</span>
            {modelScores.length > 0 && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginLeft: 8 }}>
                {modelScores.map((ms) => {
                  const cfg = MODEL_CONFIG[ms.model] || { label: ms.model, bg: 'rgba(100,116,139,0.15)', text: '#64748b' };
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
        {scanning && (
          <div style={{
            background: 'rgba(6,182,212,0.06)',
            borderBottom: '1px solid rgba(6,182,212,0.18)',
            padding: '8px 28px',
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
