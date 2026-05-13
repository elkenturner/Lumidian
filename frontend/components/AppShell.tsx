'use client';

import { usePathname } from 'next/navigation';
import { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import { LayoutDashboard, LineChart, PenLine, Settings, Shield, Bell, BellRing, ChevronDown, X, Plus, Check } from 'lucide-react';
import Sidebar from '@/components/Sidebar';
import ErrorBoundary from '@/components/ErrorBoundary';
import { BrandProvider, useBrand } from '@/contexts/BrandContext';
import { useAuth } from '@/contexts/AuthContext';
import { getBackgroundStatus, getNotifications, markAllNotificationsRead, AppNotification } from '@/lib/api';
import { MODEL_ORDER, MODEL_CONFIG as MODEL_CONFIG_SHARED } from '@/lib/constants/models';
import ModelIcon from '@/components/ModelIcon';
import NotificationPanel from '@/components/NotificationPanel';
import BrandAvatar from '@/components/BrandAvatar';
import LumidianLogo from '@/components/LumidianLogo';
import PlatformIcon from '@/components/PlatformIcon';
import ImpersonationBanner from '@/components/admin/ImpersonationBanner';
import BillingPausedBanner from '@/components/BillingPausedBanner';

const MODEL_CONFIG: Record<string, { label: string; bg: string; text: string }> = Object.fromEntries(
  Object.entries(MODEL_CONFIG_SHARED).map(([k, v]) => [k, { label: v.label, bg: v.bgColor, text: v.color }])
);

const NO_SIDEBAR_PATHS = ['/', '/login', '/register', '/onboarding', '/forgot-password', '/reset-password', '/verify-email', '/terms', '/privacy', '/methodology', '/account-paused', '/agency'];

/* ── Premium animated report-running banner ─────────────────────────────────── */
function ReportRunningBanner({ modelScores, isMobile, promptCount }: { modelScores: Array<{ model: string; score: number }>; isMobile: boolean; promptCount: number }) {
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
          {promptCount > 0 && (
            <span style={{ fontSize: 11, color: 'var(--text-faint)', marginLeft: 6 }}>
              (~{Math.ceil((promptCount * 5 * 3) / 60 + 0.5)} min est. for {promptCount} prompts)
            </span>
          )}
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

/* ── Premium animated drafts-generating banner ────────────────────────────── */
const DRAFT_PLATFORM_ITEMS = [
  { key: 'reddit', label: 'Reddit', color: '#ff4500' },
  { key: 'quora', label: 'Quora', color: '#b92b27' },
  { key: 'medium', label: 'Medium', color: '#00ab6c' },
  { key: 'wikipedia', label: 'Wikipedia', color: '#94a3b8' },
  { key: 'linkedin', label: 'LinkedIn', color: '#0a66c2', paidOnly: true },
  { key: 'x', label: 'X', color: '#e7e9ea', paidOnly: true },
] as const;

function DraftsGeneratingBanner({ isMobile, isPaid }: { isMobile: boolean; isPaid: boolean }) {
  const platforms = DRAFT_PLATFORM_ITEMS.filter(p => !('paidOnly' in p) || isPaid);
  const [activeIdx, setActiveIdx] = useState(0);

  useEffect(() => {
    if (platforms.length <= 1) return;
    const t = setInterval(() => setActiveIdx(i => (i + 1) % platforms.length), 2200);
    return () => clearInterval(t);
  }, [platforms.length]);

  return (
    <div
      style={{
        position: 'relative',
        overflow: 'hidden',
        background: 'radial-gradient(ellipse at 20% 50%, rgba(16,185,129,0.08) 0%, rgba(16,185,129,0.02) 70%, transparent 100%)',
        borderBottom: '1px solid rgba(16,185,129,0.18)',
      }}
    >
      <div style={{
        padding: isMobile ? '8px 12px' : '10px 28px',
        display: 'flex',
        alignItems: 'center',
        gap: isMobile ? 10 : 14,
        flexWrap: 'wrap',
      }}>
        {/* Rotating platform logo */}
        <div style={{ position: 'relative', width: 32, height: 32, flexShrink: 0 }}>
          {platforms.map((p, i) => (
            <div
              key={p.key}
              style={{
                position: 'absolute',
                inset: 0,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                borderRadius: 8,
                background: `${p.color}15`,
                border: `1px solid ${p.color}25`,
                opacity: i === activeIdx ? 1 : 0,
                transition: 'opacity 0.4s ease-in-out',
              }}
            >
              <PlatformIcon platform={p.key} size={15} color={p.color} />
              <span style={{ fontSize: 7, fontWeight: 700, color: p.color, lineHeight: 1, marginTop: 1 }}>
                {p.label}
              </span>
            </div>
          ))}
        </div>

        {/* Text */}
        <div style={{ minWidth: 0, flex: 1 }}>
          <span style={{ fontSize: 12.5, color: 'var(--text-primary)', fontWeight: 600 }}>
            Drafts generating
          </span>
          <span style={{ fontSize: 12, color: 'var(--text-muted)', marginLeft: 6 }}>
            — writing new content for your top visibility gaps
          </span>
        </div>

        {/* Platform pills */}
        {!isMobile && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            {platforms.map(p => (
              <span
                key={p.key}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 4,
                  fontSize: 10,
                  fontWeight: 600,
                  padding: '3px 8px',
                  borderRadius: 9999,
                  background: `${p.color}15`,
                  color: p.color,
                }}
              >
                <PlatformIcon platform={p.key} size={10} color={p.color} />
                <span style={{ display: 'inline-flex', gap: 2 }}>
                  <span style={{ width: 3, height: 3, borderRadius: '50%', background: 'currentColor', animation: 'pulse 1.4s ease-in-out infinite', animationDelay: '0s' }} />
                  <span style={{ width: 3, height: 3, borderRadius: '50%', background: 'currentColor', animation: 'pulse 1.4s ease-in-out infinite', animationDelay: '0.2s' }} />
                  <span style={{ width: 3, height: 3, borderRadius: '50%', background: 'currentColor', animation: 'pulse 1.4s ease-in-out infinite', animationDelay: '0.4s' }} />
                </span>
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Shimmer bar */}
      <div
        style={{
          height: 2,
          width: '100%',
          background: 'linear-gradient(90deg, transparent, rgba(16,185,129,0.5), rgba(52,211,153,0.5), transparent)',
          backgroundSize: '200% 100%',
          animation: 'shimmer 2s linear infinite',
        }}
      />
    </div>
  );
}

/* ── Premium animated scanning banner ─────────────────────────────────────── */
const SCAN_PLATFORM_ITEMS = [
  { key: 'reddit', label: 'Reddit', color: '#ff4500' },
  { key: 'quora', label: 'Quora', color: '#b92b27' },
  { key: 'linkedin', label: 'LinkedIn', color: '#0a66c2', paidOnly: true },
  { key: 'x', label: 'X', color: '#e7e9ea', paidOnly: true },
] as const;

function ScanningBanner({ isMobile, isPaid }: { isMobile: boolean; isPaid: boolean }) {
  const platforms = SCAN_PLATFORM_ITEMS.filter(p => !('paidOnly' in p) || isPaid);
  const [activeIdx, setActiveIdx] = useState(0);

  useEffect(() => {
    if (platforms.length <= 1) return;
    const t = setInterval(() => setActiveIdx(i => (i + 1) % platforms.length), 2200);
    return () => clearInterval(t);
  }, [platforms.length]);

  return (
    <div
      style={{
        position: 'relative',
        overflow: 'hidden',
        background: 'radial-gradient(ellipse at 20% 50%, rgba(6,182,212,0.08) 0%, rgba(6,182,212,0.02) 70%, transparent 100%)',
        borderBottom: '1px solid rgba(6,182,212,0.18)',
      }}
    >
      <div style={{
        padding: isMobile ? '8px 12px' : '10px 28px',
        display: 'flex',
        alignItems: 'center',
        gap: isMobile ? 10 : 14,
        flexWrap: 'wrap',
      }}>
        {/* Rotating platform logo */}
        <div style={{ position: 'relative', width: 32, height: 32, flexShrink: 0 }}>
          {platforms.map((p, i) => (
            <div
              key={p.key}
              style={{
                position: 'absolute',
                inset: 0,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                borderRadius: 8,
                background: `${p.color}15`,
                border: `1px solid ${p.color}25`,
                opacity: i === activeIdx ? 1 : 0,
                transition: 'opacity 0.4s ease-in-out',
              }}
            >
              <PlatformIcon platform={p.key} size={15} color={p.color} />
              <span style={{ fontSize: 7, fontWeight: 700, color: p.color, lineHeight: 1, marginTop: 1 }}>
                {p.label}
              </span>
            </div>
          ))}
        </div>

        {/* Text */}
        <div style={{ minWidth: 0, flex: 1 }}>
          <span style={{ fontSize: 12.5, color: 'var(--text-primary)', fontWeight: 600 }}>
            Scanning live opportunities
          </span>
          <span style={{ fontSize: 12, color: 'var(--text-muted)', marginLeft: 6 }}>
            — finding relevant discussions across platforms
          </span>
        </div>

        {/* Platform pills */}
        {!isMobile && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            {platforms.map(p => (
              <span
                key={p.key}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 4,
                  fontSize: 10,
                  fontWeight: 600,
                  padding: '3px 8px',
                  borderRadius: 9999,
                  background: `${p.color}15`,
                  color: p.color,
                }}
              >
                <PlatformIcon platform={p.key} size={10} color={p.color} />
                <span style={{ display: 'inline-flex', gap: 2 }}>
                  <span style={{ width: 3, height: 3, borderRadius: '50%', background: 'currentColor', animation: 'pulse 1.4s ease-in-out infinite', animationDelay: '0s' }} />
                  <span style={{ width: 3, height: 3, borderRadius: '50%', background: 'currentColor', animation: 'pulse 1.4s ease-in-out infinite', animationDelay: '0.2s' }} />
                  <span style={{ width: 3, height: 3, borderRadius: '50%', background: 'currentColor', animation: 'pulse 1.4s ease-in-out infinite', animationDelay: '0.4s' }} />
                </span>
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Shimmer bar */}
      <div
        style={{
          height: 2,
          width: '100%',
          background: 'linear-gradient(90deg, transparent, rgba(6,182,212,0.5), rgba(34,211,238,0.5), transparent)',
          backgroundSize: '200% 100%',
          animation: 'shimmer 2s linear infinite',
        }}
      />
    </div>
  );
}

const MOBILE_NAV = [
  { label: 'Dashboard', href: '/dashboard', icon: LayoutDashboard },
  { label: 'Reports',   href: '/reports',   icon: LineChart },
  { label: 'Content',   href: '/content',   icon: PenLine },
  { label: 'Settings',  href: '/settings',  icon: Settings },
];

/* ── Mobile Header ──────────────────────────────────────────────────────────── */
function MobileHeader({
  activeBrand,
  onBrandTap,
  notifications,
  unreadCount,
  notifOpen,
  onNotifToggle,
  onMarkAllRead,
  onNotifClose,
  user,
}: {
  activeBrand: { name: string; website_url?: string | null } | null;
  onBrandTap: () => void;
  notifications: AppNotification[];
  unreadCount: number;
  notifOpen: boolean;
  onNotifToggle: () => void;
  onMarkAllRead: () => void;
  onNotifClose: () => void;
  user: { name?: string | null; email?: string } | null;
}) {
  const userInitial = (user?.name?.[0] || user?.email?.[0] || '?').toUpperCase();

  return (
    <>
      <header
        style={{
          position: 'sticky',
          top: 0,
          left: 0,
          right: 0,
          height: 48,
          zIndex: 50,
          background: 'rgba(8,12,20,0.97)',
          backdropFilter: 'blur(24px)',
          WebkitBackdropFilter: 'blur(24px)',
          borderBottom: '1px solid rgba(255,255,255,0.08)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '0 12px',
        }}
      >
        {/* Left: logo */}
        <Link href="/dashboard" style={{ display: 'flex', alignItems: 'center', flexShrink: 0 }}>
          <LumidianLogo size={24} />
        </Link>

        {/* Center: brand switcher tap target */}
        {activeBrand && (
          <button
            onClick={onBrandTap}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              padding: '4px 8px',
              borderRadius: 8,
              maxWidth: 200,
            }}
          >
            <BrandAvatar name={activeBrand.name} websiteUrl={activeBrand.website_url} size={20} />
            <span
              style={{
                fontSize: 13,
                fontWeight: 600,
                color: 'var(--text-primary)',
                maxWidth: 180,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {activeBrand.name}
            </span>
            <ChevronDown size={14} style={{ color: 'var(--text-faint)', flexShrink: 0 }} />
          </button>
        )}

        {/* Right: notification bell + user avatar */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
          <button
            onClick={onNotifToggle}
            aria-label="Notifications"
            style={{
              position: 'relative',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 32,
              height: 32,
              borderRadius: 8,
              background: notifOpen ? 'rgba(255,255,255,0.08)' : 'none',
              border: 'none',
              cursor: 'pointer',
              color: 'var(--text-muted)',
            }}
          >
            {unreadCount > 0 ? <BellRing size={18} /> : <Bell size={18} />}
            {unreadCount > 0 && (
              <span
                style={{
                  position: 'absolute',
                  top: 4,
                  right: 4,
                  width: 7,
                  height: 7,
                  borderRadius: '50%',
                  background: 'var(--accent)',
                  border: '1.5px solid rgba(8,12,20,0.97)',
                }}
              />
            )}
          </button>
          <Link
            href="/account"
            aria-label="Account"
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 28,
              height: 28,
              borderRadius: '50%',
              background: 'rgba(95,126,166,0.2)',
              color: 'var(--text-secondary)',
              fontSize: 11,
              fontWeight: 700,
              textDecoration: 'none',
              flexShrink: 0,
            }}
          >
            {userInitial}
          </Link>
        </div>
      </header>

      {/* Notification panel as bottom sheet overlay on mobile */}
      {notifOpen && (
        <div
          style={{ position: 'fixed', inset: 0, zIndex: 199, background: 'rgba(0,0,0,0.5)' }}
          onClick={onNotifClose}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{ position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 200 }}
          >
            <div
              ref={(el) => {
                if (el) {
                  const child = el.firstElementChild as HTMLElement;
                  if (child) {
                    child.style.position = 'static';
                    child.style.width = '100%';
                    child.style.maxHeight = 'none';
                    child.style.bottom = 'auto';
                    child.style.left = 'auto';
                    child.style.border = 'none';
                    child.style.boxShadow = 'none';
                    child.style.borderRadius = '0';
                  }
                }
              }}
            >
              <NotificationPanel
                notifications={notifications}
                unreadCount={unreadCount}
                panelLeft={0}
                onMarkAllRead={onMarkAllRead}
                onClose={onNotifClose}
              />
            </div>
          </div>
        </div>
      )}
    </>
  );
}

/* ── Brand Switcher Bottom Sheet ────────────────────────────────────────────── */
function BrandSwitcherSheet({
  brands,
  activeBrandId,
  onSelectBrand,
  onClose,
}: {
  brands: Array<{ id: number; name: string; website_url?: string | null; tier?: string; brand_type?: string }>;
  activeBrandId: number | null;
  onSelectBrand: (id: number) => void;
  onClose: () => void;
}) {
  const tierLabel = (tier?: string, brandType?: string) => {
    if (brandType === 'pitch') return 'Pitch';
    if (!tier) return null;
    const map: Record<string, string> = { basic: 'Free', standard: 'Standard', premium: 'Pro' };
    return map[tier] || tier;
  };

  return (
    <div
      style={{ position: 'fixed', inset: 0, zIndex: 100, background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)' }}
      onClick={onClose}
    >
      <div
        className="sheet-enter"
        onClick={(e) => e.stopPropagation()}
        style={{
          position: 'absolute',
          bottom: 0,
          left: 0,
          right: 0,
          maxHeight: '70vh',
          background: 'rgba(10,14,24,0.97)',
          backdropFilter: 'blur(24px)',
          WebkitBackdropFilter: 'blur(24px)',
          borderTopLeftRadius: 20,
          borderTopRightRadius: 20,
          border: '1px solid rgba(255,255,255,0.08)',
          borderBottom: 'none',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
      >
        {/* Drag handle */}
        <div style={{ display: 'flex', justifyContent: 'center', padding: '10px 0 4px' }}>
          <div style={{ width: 32, height: 4, borderRadius: 2, background: 'rgba(255,255,255,0.15)' }} />
        </div>

        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 16px 12px' }}>
          <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)' }}>Your brands</span>
          <button
            onClick={onClose}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-faint)', padding: 4 }}
            aria-label="Close brand switcher"
          >
            <X size={18} />
          </button>
        </div>

        {/* Brand list */}
        <div style={{ overflowY: 'auto', flex: 1, paddingBottom: 8, scrollbarWidth: 'thin', scrollbarColor: 'rgba(255,255,255,0.08) transparent' }}>
          {brands.map((brand) => {
            const isActive = brand.id === activeBrandId;
            return (
              <button
                key={brand.id}
                onClick={() => { onSelectBrand(brand.id); onClose(); }}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  width: '100%',
                  height: 52,
                  padding: '0 16px',
                  background: isActive ? 'rgba(95,126,166,0.08)' : 'transparent',
                  border: 'none',
                  borderLeft: isActive ? '2px solid var(--accent)' : '2px solid transparent',
                  cursor: 'pointer',
                  textAlign: 'left',
                  transition: 'background 0.15s ease',
                }}
              >
                <BrandAvatar name={brand.name} websiteUrl={brand.website_url} size={28} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{
                    fontSize: 13,
                    fontWeight: isActive ? 600 : 500,
                    color: isActive ? 'var(--text-primary)' : 'var(--text-secondary)',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}>
                    {brand.name}
                  </div>
                  {(brand.tier || brand.brand_type === 'pitch') && (
                    <span style={{
                      fontSize: 10,
                      fontWeight: 500,
                      color: brand.brand_type === 'pitch'
                        ? 'var(--warning)'
                        : brand.tier === 'premium'
                          ? 'var(--accent-foreground)'
                          : 'var(--text-faint)',
                      marginTop: 1,
                      display: 'block',
                    }}>
                      {tierLabel(brand.tier, brand.brand_type)}
                    </span>
                  )}
                </div>
                {isActive && <Check size={16} style={{ color: 'var(--accent)', flexShrink: 0 }} />}
              </button>
            );
          })}
        </div>

        {/* Add brand link */}
        <Link
          href="/tracker/new"
          onClick={onClose}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            height: 48,
            padding: '0 16px',
            borderTop: '1px solid rgba(255,255,255,0.06)',
            color: 'var(--accent-light)',
            fontSize: 13,
            fontWeight: 500,
            textDecoration: 'none',
          }}
        >
          <Plus size={16} />
          Add new brand
        </Link>
      </div>
    </div>
  );
}

/* ── AppShellInner (rendered inside BrandProvider to access useBrand) ──────── */
function AppShellInner({
  isMobile,
  sidebarExpanded,
  setSidebarExpanded,
  reportRunning,
  draftsGenerating,
  scanning,
  modelScores,
  promptCount,
  user,
  children,
}: {
  isMobile: boolean;
  sidebarExpanded: boolean;
  setSidebarExpanded: (v: boolean) => void;
  reportRunning: boolean;
  draftsGenerating: boolean;
  scanning: boolean;
  modelScores: Array<{ model: string; score: number }>;
  promptCount: number;
  user: { name?: string | null; email?: string; is_admin?: boolean; subscription_tier?: string | null } | null;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const { brands, activeBrandId, setActiveBrandId, activeBrand } = useBrand();
  const [brandSwitcherOpen, setBrandSwitcherOpen] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);

  // Fetch notifications periodically on mobile
  useEffect(() => {
    if (!isMobile || !user) return;
    let cancelled = false;

    const fetchNotifs = async () => {
      try {
        const resp = await getNotifications();
        if (!cancelled) {
          setNotifications(resp.notifications);
          setUnreadCount(resp.unread_count);
        }
      } catch { /* silent */ }
    };

    fetchNotifs();
    const timer = setInterval(fetchNotifs, 30_000);
    return () => { cancelled = true; clearInterval(timer); };
  }, [isMobile, user]);

  const handleMarkAllRead = async () => {
    try {
      const resp = await markAllNotificationsRead();
      setNotifications(resp.notifications);
      setUnreadCount(resp.unread_count);
    } catch { /* silent */ }
  };

  return (
    <>
      {/* Fixed slate base background */}
      <div style={{ position: 'fixed', inset: 0, background: 'var(--bg-base)', zIndex: -2 }} />

      {/* Desktop sidebar — hidden on mobile */}
      {!isMobile && (
        <Sidebar expanded={sidebarExpanded} onExpandedChange={setSidebarExpanded} />
      )}

      {/* Mobile header */}
      {isMobile && (
        <MobileHeader
          activeBrand={activeBrand}
          onBrandTap={() => setBrandSwitcherOpen(true)}
          notifications={notifications}
          unreadCount={unreadCount}
          notifOpen={notifOpen}
          onNotifToggle={() => setNotifOpen((v) => !v)}
          onMarkAllRead={handleMarkAllRead}
          onNotifClose={() => setNotifOpen(false)}
          user={user}
        />
      )}

      {/* Brand switcher bottom sheet */}
      {isMobile && brandSwitcherOpen && (
        <BrandSwitcherSheet
          brands={brands}
          activeBrandId={activeBrandId}
          onSelectBrand={setActiveBrandId}
          onClose={() => setBrandSwitcherOpen(false)}
        />
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
        <ImpersonationBanner />
        <BillingPausedBanner />
        {/* Global status banners — written by dashboard/content pages via localStorage */}
        {reportRunning && <ReportRunningBanner modelScores={modelScores} isMobile={isMobile} promptCount={promptCount} />}
        {draftsGenerating && <DraftsGeneratingBanner isMobile={isMobile} isPaid={!!user?.subscription_tier || !!user?.is_admin} />}
        {scanning && <ScanningBanner isMobile={isMobile} isPaid={!!user?.subscription_tier || !!user?.is_admin} />}
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
  );
}

export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [sidebarExpanded, setSidebarExpanded] = useState(false);
  const [reportRunning, setReportRunning] = useState(false);
  const [draftsGenerating, setDraftsGenerating] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [modelScores, setModelScores] = useState<Array<{ model: string; score: number }>>([]);
  const [promptCount, setPromptCount] = useState(0);
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
          setPromptCount(status.prompt_count || 0);
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
          setPromptCount(0);
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
        <AppShellInner
          isMobile={isMobile}
          sidebarExpanded={sidebarExpanded}
          setSidebarExpanded={setSidebarExpanded}
          reportRunning={reportRunning}
          draftsGenerating={draftsGenerating}
          scanning={scanning}
          modelScores={modelScores}
          promptCount={promptCount}
          user={user}
        >
          {children}
        </AppShellInner>
      </BrandProvider>
    </ErrorBoundary>
  );
}
