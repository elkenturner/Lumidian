'use client';

import { usePathname } from 'next/navigation';
import { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import { LayoutDashboard, LineChart, PenLine, Settings, User, ChevronUp, LogOut, Shield } from 'lucide-react';
import Sidebar from '@/components/Sidebar';
import ErrorBoundary from '@/components/ErrorBoundary';
import { BrandProvider } from '@/contexts/BrandContext';
import { useAuth } from '@/contexts/AuthContext';
import { getBackgroundStatus } from '@/lib/api';
import { MODEL_ORDER, MODEL_CONFIG as MODEL_CONFIG_SHARED } from '@/lib/constants/models';
import ModelIcon from '@/components/ModelIcon';

const MODEL_CONFIG: Record<string, { label: string; bg: string; text: string }> = Object.fromEntries(
  Object.entries(MODEL_CONFIG_SHARED).map(([k, v]) => [k, { label: v.label, bg: v.bgColor, text: v.color }])
);

const NO_SIDEBAR_PATHS = ['/', '/login', '/register', '/onboarding', '/forgot-password', '/reset-password', '/verify-email', '/terms', '/privacy', '/methodology'];

/* ── Premium animated report-running banner ─────────────────────────────────── */
function ReportRunningBanner({ modelScores, isMobile }: { modelScores: Array<{ model: string; score: number }>; isMobile: boolean }) {
  const [activeIdx, setActiveIdx] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setActiveIdx((i) => (i + 1) % MODEL_ORDER.length), 2200);
    return () => clearInterval(t);
  }, []);

  // Build a set of completed models from scores
  const completedModels = new Set(modelScores.map((ms) => ms.model));

  return (
    <div
      style={{
        position: 'relative',
        overflow: 'hidden',
        background: 'radial-gradient(ellipse at 20% 50%, rgba(95,126,166,0.08) 0%, rgba(95,126,166,0.02) 70%, transparent 100%)',
        borderBottom: '1px solid rgba(95,126,166,0.18)',
      }}
    >
      <div style={{
        padding: isMobile ? '8px 12px' : '10px 28px',
        display: 'flex',
        alignItems: 'center',
        gap: isMobile ? 10 : 14,
        flexWrap: 'wrap',
      }}>
        {/* Rotating LLM logo */}
        <div style={{ position: 'relative', width: 32, height: 32, flexShrink: 0 }}>
          {MODEL_ORDER.map((key, i) => {
            const cfg = MODEL_CONFIG[key] || { label: key, bg: 'rgba(100,116,139,0.15)', text: 'var(--text-muted)' };
            return (
              <div
                key={key}
                style={{
                  position: 'absolute',
                  inset: 0,
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  borderRadius: 8,
                  background: cfg.bg,
                  border: `1px solid ${cfg.text}25`,
                  opacity: i === activeIdx ? 1 : 0,
                  transition: 'opacity 0.4s ease-in-out',
                }}
              >
                <ModelIcon model={key} size={15} color={cfg.text} />
                <span style={{ fontSize: 7, fontWeight: 700, color: cfg.text, lineHeight: 1, marginTop: 1 }}>
                  {cfg.label}
                </span>
              </div>
            );
          })}
        </div>

        {/* Text */}
        <div style={{ minWidth: 0, flex: 1 }}>
          <span style={{ fontSize: 12.5, color: 'var(--text-primary)', fontWeight: 600 }}>
            Report in progress
          </span>
          <span style={{ fontSize: 12, color: 'var(--text-muted)', marginLeft: 6 }}>
            — querying AI models with your prompts
          </span>
        </div>

        {/* Model score pills */}
        {!isMobile && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            {MODEL_ORDER.map((key) => {
              const cfg = MODEL_CONFIG[key] || { label: key, bg: 'rgba(100,116,139,0.15)', text: 'var(--text-muted)' };
              const ms = modelScores.find((s) => s.model === key);
              const done = completedModels.has(key);
              return (
                <span
                  key={key}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 4,
                    fontSize: 10,
                    fontWeight: 600,
                    padding: '3px 8px',
                    borderRadius: 9999,
                    background: done ? cfg.bg : 'rgba(100,116,139,0.08)',
                    color: done ? cfg.text : 'var(--text-faint)',
                    transition: 'all 0.4s ease',
                  }}
                >
                  <ModelIcon model={key} size={11} color={done ? cfg.text : 'var(--text-faint)'} />
                  {done ? (
                    <>
                      <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="20 6 9 17 4 12" />
                      </svg>
                      {ms!.score}%
                    </>
                  ) : (
                    <span style={{ display: 'inline-flex', gap: 2 }}>
                      <span style={{ width: 3, height: 3, borderRadius: '50%', background: 'currentColor', animation: 'pulse 1.4s ease-in-out infinite', animationDelay: '0s' }} />
                      <span style={{ width: 3, height: 3, borderRadius: '50%', background: 'currentColor', animation: 'pulse 1.4s ease-in-out infinite', animationDelay: '0.2s' }} />
                      <span style={{ width: 3, height: 3, borderRadius: '50%', background: 'currentColor', animation: 'pulse 1.4s ease-in-out infinite', animationDelay: '0.4s' }} />
                    </span>
                  )}
                </span>
              );
            })}
          </div>
        )}
      </div>

      {/* Shimmer bar */}
      <div
        style={{
          height: 2,
          width: '100%',
          background: 'linear-gradient(90deg, transparent, rgba(95,126,166,0.5), rgba(168,85,247,0.5), transparent)',
          backgroundSize: '200% 100%',
          animation: 'shimmer 2s linear infinite',
        }}
      />
    </div>
  );
}

const MOBILE_NAV = [
  { label: 'Dashboard', href: '/dashboard', icon: LayoutDashboard },
  { label: 'Settings',  href: '/settings',  icon: Settings },
  { label: 'Reports',   href: '/reports',   icon: LineChart },
  { label: 'Content',   href: '/content',   icon: PenLine },
  { label: 'Account',   href: '/account',   icon: User },
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
    const SLOW_INTERVAL = 30_000;

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
            if (status.report_running) localStorage.setItem('clarity_report_running', '1');
            else localStorage.removeItem('clarity_report_running');
            if (status.drafts_generating) localStorage.setItem('clarity_drafts_generating', '1');
            else localStorage.removeItem('clarity_drafts_generating');
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
        {reportRunning && <ReportRunningBanner modelScores={modelScores} isMobile={isMobile} />}
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
          {user?.is_admin && (
            <Link
              href="/admin"
              aria-label="Admin"
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 2,
                flex: 1,
                padding: '8px 0',
                color: pathname === '/admin' ? 'var(--accent-light)' : 'var(--text-faint)',
                textDecoration: 'none',
                fontSize: 10,
                fontWeight: pathname === '/admin' ? 600 : 500,
                position: 'relative',
                minHeight: 48,
              }}
            >
              {pathname === '/admin' && (
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
              <Shield size={20} strokeWidth={pathname === '/admin' ? 2.2 : 1.75} />
              <span>Admin</span>
            </Link>
          )}
        </nav>
      )}
    </>
    </BrandProvider>
    </ErrorBoundary>
  );
}
