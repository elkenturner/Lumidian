'use client';

import { memo, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import {
  LayoutDashboard,
  Settings,
  PenLine,
  LogOut,
  CreditCard,
  User,
  LineChart,
  Shield,
  Bell,
  BellRing,
  LifeBuoy,
  ChevronDown,
  Plus,
  Check,
} from 'lucide-react';
import NotificationPanel from '@/components/NotificationPanel';
import SupportPanel from '@/components/SupportPanel';
import { useAuth } from '@/contexts/AuthContext';
import { useBrand } from '@/contexts/BrandContext';
import LumidianLogo from '@/components/LumidianLogo';
import BrandAvatar from '@/components/BrandAvatar';
import {
  getNotifications,
  markAllNotificationsRead,
  AppNotification,
} from '@/lib/api';

interface NavItem {
  label: string;
  href: string;
  icon: React.ElementType;
}

const NavLink = memo(function NavLink({
  item,
  pathname,
  exact = false,
  expanded,
}: {
  item: NavItem;
  pathname: string;
  exact?: boolean;
  expanded: boolean;
}) {
  const Icon = item.icon;
  const isActive = exact
    ? pathname === item.href
    : pathname === item.href || pathname.startsWith(item.href + '/');

  return (
    <Link
      href={item.href}
      aria-label={item.label}
      title={!expanded ? item.label : undefined}
      className={[
        'flex items-center gap-3 py-2.5 rounded-xl text-sm font-medium transition-all duration-200 relative overflow-hidden',
        expanded ? 'px-3.5' : 'px-0 justify-center',
        isActive
          ? 'text-[#818CF8]'
          : 'text-[#64748B] hover:text-[#94A3B8]',
      ].join(' ')}
      style={isActive ? {
        background: 'rgba(99,102,241,0.15)',
        backdropFilter: 'blur(8px)',
        WebkitBackdropFilter: 'blur(8px)',
        boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.08), 0 0 18px rgba(99,102,241,0.10)',
      } : undefined}
      onMouseEnter={(e) => {
        if (!isActive) (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.06)';
      }}
      onMouseLeave={(e) => {
        if (!isActive) (e.currentTarget as HTMLElement).style.background = 'transparent';
      }}
    >
      {isActive && (
        <span className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-[18px] rounded-r-full" style={{ background: 'linear-gradient(180deg, #c7d2fe, #6366F1)' }} />
      )}
      <Icon
        size={17}
        className={`flex-shrink-0 ${isActive ? 'text-[#818CF8]' : 'text-[#475569]'}`}
        strokeWidth={isActive ? 2 : 1.75}
      />
      {expanded && (
        <span className="truncate">{item.label}</span>
      )}
    </Link>
  );
});

// ── Sidebar ────────────────────────────────────────────────────────────────────

interface SidebarProps {
  expanded: boolean;
  onExpandedChange: (v: boolean) => void;
}

export default function Sidebar({ expanded, onExpandedChange }: SidebarProps) {
  const pathname = usePathname();
  const router = useRouter();
  const { user, logout } = useAuth();
  const { brands, activeBrand, setActiveBrandId } = useBrand();

  // Brand switcher
  const [brandOpen, setBrandOpen] = useState(false);
  const brandRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!brandOpen) return;
    function handler(e: MouseEvent) {
      if (brandRef.current && !brandRef.current.contains(e.target as Node)) {
        setBrandOpen(false);
      }
    }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [brandOpen]);

  // Notifications
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [panelOpen, setPanelOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  // Support
  const [supportOpen, setSupportOpen] = useState(false);
  const supportRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    getNotifications()
      .then((r) => { setNotifications(r.notifications); setUnreadCount(r.unread_count); })
      .catch(() => {});
    // Poll every 60s
    const interval = setInterval(() => {
      getNotifications()
        .then((r) => { setNotifications(r.notifications); setUnreadCount(r.unread_count); })
        .catch(() => {});
    }, 60_000);
    return () => clearInterval(interval);
  }, []);

  // Close notification panel on outside click
  useEffect(() => {
    if (!panelOpen) return;
    function handler(e: MouseEvent) {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setPanelOpen(false);
      }
    }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [panelOpen]);

  // Close support panel on outside click
  useEffect(() => {
    if (!supportOpen) return;
    function handler(e: MouseEvent) {
      if (supportRef.current && !supportRef.current.contains(e.target as Node)) {
        setSupportOpen(false);
      }
    }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [supportOpen]);

  async function handleMarkAllRead() {
    await markAllNotificationsRead().catch(() => null);
    setNotifications([]);
    setUnreadCount(0);
    setPanelOpen(false);
  }

  const navItems: NavItem[] = [
    { label: 'Dashboard',   href: '/dashboard', icon: LayoutDashboard },
    { label: 'Reports',     href: '/reports',   icon: LineChart },
    { label: 'Content Hub', href: '/content',   icon: PenLine },
    { label: 'Settings',    href: '/settings',  icon: Settings },
    { label: 'Account',     href: '/account',   icon: User },
  ];

  async function handleLogout() {
    await logout();
    router.push('/');
  }

  const planLabel = user?.is_admin
    ? 'Admin'
    : user?.subscription_tier
      ? user.subscription_tier.charAt(0).toUpperCase() + user.subscription_tier.slice(1)
      : 'Free';

  return (
    <>
      <aside
        className="fixed left-0 top-0 h-screen flex flex-col z-50 overflow-hidden"
        style={{
          width: expanded ? 240 : 64,
          transition: 'width 0.22s ease',
          background: 'linear-gradient(180deg, rgba(10,14,24,0.90) 0%, rgba(5,8,16,0.95) 100%)',
          backdropFilter: 'blur(20px)',
          WebkitBackdropFilter: 'blur(20px)',
          borderRight: '1px solid rgba(255,255,255,0.08)',
        }}
        onMouseEnter={() => onExpandedChange(true)}
        onMouseLeave={() => onExpandedChange(false)}
      >

        {/* ── Logo ── */}
        <div
          className="flex-shrink-0"
          style={{
            padding: expanded ? '22px 20px 20px' : '20px 0 18px',
            display: 'flex',
            justifyContent: expanded ? 'flex-start' : 'center',
            transition: 'padding 0.22s ease',
            borderBottom: '1px solid rgba(255,255,255,0.06)',
          }}
        >
          <Link href="/dashboard" className="flex items-center gap-3">
            {expanded ? (
              <LumidianLogo size={28} withWordmark />
            ) : (
              <LumidianLogo size={28} />
            )}
          </Link>
        </div>

        {/* ── Brand switcher ── */}
        {brands.length > 0 && (
          <div
            ref={brandRef}
            className="flex-shrink-0 relative"
            style={{
              padding: expanded ? '12px 14px' : '12px 10px',
              borderBottom: '1px solid rgba(255,255,255,0.06)',
            }}
          >
            <button
              onClick={(e) => { e.stopPropagation(); if (brands.length > 0) setBrandOpen((v) => !v); }}
              title={expanded ? undefined : (activeBrand?.name ?? 'Switch brand')}
              aria-label="Switch brand"
              className="w-full flex items-center gap-2.5 rounded-lg transition-all duration-150"
              style={{
                padding: expanded ? '8px 10px' : '8px 0',
                justifyContent: expanded ? 'flex-start' : 'center',
                background: brandOpen ? 'rgba(99,102,241,0.12)' : 'rgba(255,255,255,0.04)',
                border: '1px solid rgba(255,255,255,0.07)',
              }}
              onMouseEnter={(e) => { if (!brandOpen) (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.07)'; }}
              onMouseLeave={(e) => { if (!brandOpen) (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.04)'; }}
            >
              <BrandAvatar
                name={activeBrand?.name ?? '?'}
                websiteUrl={activeBrand?.website_url}
                size={22}
                className="rounded-md flex-shrink-0"
                style={{ background: 'rgba(99,102,241,0.20)', border: '1px solid rgba(99,102,241,0.30)', padding: 3 }}
                textClassName="text-[9px] font-bold text-[#818CF8]"
              />
              {expanded && (
                <>
                  <span className="flex-1 text-left text-[12px] font-medium text-[#CBD5E1] truncate leading-tight min-w-0">
                    {activeBrand?.name ?? 'Select brand'}
                  </span>
                  <ChevronDown
                    size={12}
                    className="flex-shrink-0 text-[#475569] transition-transform duration-150"
                    style={{ transform: brandOpen ? 'rotate(180deg)' : 'rotate(0deg)' }}
                  />
                </>
              )}
            </button>

            {/* Dropdown */}
            {brandOpen && (
              <div
                className="absolute z-[300]"
                style={{
                  top: expanded ? '100%' : 0,
                  left: expanded ? 12 : 56,
                  width: expanded ? 'calc(100% - 24px)' : 220,
                  marginTop: expanded ? 4 : 0,
                  background: 'rgba(10,14,24,0.97)',
                  backdropFilter: 'blur(20px)',
                  WebkitBackdropFilter: 'blur(20px)',
                  border: '1px solid rgba(99,102,241,0.20)',
                  borderRadius: 12,
                  boxShadow: '0 12px 40px rgba(0,0,0,0.50)',
                  overflow: 'hidden',
                }}
              >
                {/* Header */}
                <div className="px-3 pt-2.5 pb-1.5 border-b border-[rgba(255,255,255,0.06)]">
                  <p className="text-[10px] font-semibold text-[#475569] uppercase tracking-wider">Your brands</p>
                </div>

                {/* Brand list */}
                <div className="py-1" style={{ maxHeight: 240, overflowY: 'auto', scrollbarWidth: 'thin', scrollbarColor: 'rgba(255,255,255,0.08) transparent' }}>
                  {brands.map((brand) => {
                    const isActive = brand.id === activeBrand?.id;
                    return (
                      <button
                        key={brand.id}
                        onClick={() => { setActiveBrandId(brand.id); setBrandOpen(false); }}
                        className="w-full flex items-center gap-2.5 px-3 py-2 transition-colors text-left"
                        style={{ background: isActive ? 'rgba(99,102,241,0.10)' : 'transparent' }}
                        onMouseEnter={(e) => { if (!isActive) (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.05)'; }}
                        onMouseLeave={(e) => { if (!isActive) (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
                      >
                        <BrandAvatar
                          name={brand.name}
                          websiteUrl={brand.website_url}
                          size={24}
                          className="rounded-md"
                          style={{
                            background: isActive ? 'rgba(99,102,241,0.25)' : 'rgba(255,255,255,0.06)',
                            border: `1px solid ${isActive ? 'rgba(99,102,241,0.40)' : 'rgba(255,255,255,0.08)'}`,
                            padding: 3,
                          }}
                          textClassName="text-[10px] font-bold"
                          textStyle={{ color: isActive ? '#818CF8' : '#64748B' }}
                        />
                        <div className="flex-1 min-w-0">
                          <p className={`text-[12px] font-medium truncate leading-tight ${isActive ? 'text-[#E2E8F0]' : 'text-[#94A3B8]'}`}>
                            {brand.name}
                          </p>
                          {brand.brand_type === 'pitch' && (
                            <p className="text-[10px] text-[#F59E0B] leading-tight">Pitch brand</p>
                          )}
                        </div>
                        {isActive && <Check size={12} className="flex-shrink-0 text-[#6366F1]" />}
                      </button>
                    );
                  })}
                </div>

                {/* Add brand link */}
                <div className="border-t border-[rgba(255,255,255,0.06)] p-1">
                  <Link
                    href="/settings/brands/new"
                    onClick={() => setBrandOpen(false)}
                    className="flex items-center gap-2 px-3 py-2 rounded-lg text-[11px] text-[#475569] hover:text-[#94A3B8] transition-colors"
                    onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.05)'; }}
                    onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
                  >
                    <Plus size={12} />
                    Add new brand
                  </Link>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── Navigation ── */}
        <nav
          className="flex-1 space-y-1 overflow-y-auto"
          style={{ padding: expanded ? '14px 10px' : '14px 8px', transition: 'padding 0.22s ease' }}
        >
          {navItems.map((item) => (
            <NavLink
              key={item.href}
              item={item}
              pathname={pathname}
              exact={item.href === '/settings'}
              expanded={expanded}
            />
          ))}

          {user?.is_admin && (
            <NavLink
              item={{ label: 'Admin', href: '/admin', icon: Shield }}
              pathname={pathname}
              exact
              expanded={expanded}
            />
          )}

          {user?.is_team_member && expanded && (
            <div
              className="mt-3 px-3 py-2 rounded-lg text-[10px] leading-snug"
              style={{ background: 'rgba(251,191,36,0.08)', border: '1px solid rgba(251,191,36,0.2)', color: '#d97706' }}
            >
              <p className="font-semibold mb-0.5">Read-only access</p>
              <p className="text-[#92400e] opacity-80">
                Viewing {user.team_owner_name ?? user.team_owner_email ?? 'owner'}&apos;s workspace
              </p>
            </div>
          )}

          {/* ── Support button ── */}
          <div>
            <button
              onClick={(e) => { e.stopPropagation(); setPanelOpen(false); setSupportOpen((v) => !v); }}
              title="Contact Support"
              aria-label="Contact Support"
              className={[
                'w-full flex items-center gap-3 py-2.5 rounded-xl text-sm font-medium transition-all duration-200 relative',
                expanded ? 'px-3.5' : 'px-0 justify-center',
                supportOpen ? 'text-[#818CF8] bg-[rgba(99,102,241,0.15)]' : 'text-[#64748B] hover:text-[#94A3B8]',
              ].join(' ')}
              onMouseEnter={(e) => {
                if (!supportOpen) (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.07)';
              }}
              onMouseLeave={(e) => {
                if (!supportOpen) (e.currentTarget as HTMLElement).style.background = 'transparent';
              }}
            >
              <LifeBuoy
                size={16}
                className={supportOpen ? 'text-[#818CF8]' : 'text-[#475569]'}
                strokeWidth={supportOpen ? 2 : 1.75}
              />
              {expanded && <span className="truncate">Support</span>}
            </button>
          </div>

          {/* ── Bell button ── */}
          <div className="pt-1">
            <button
              onClick={(e) => { e.stopPropagation(); setPanelOpen((v) => !v); }}
              title="Notifications"
              aria-label={unreadCount > 0 ? `Notifications — ${unreadCount} unread` : 'Notifications'}
              className={[
                'w-full flex items-center gap-3 py-2.5 rounded-xl text-sm font-medium transition-all duration-200 relative',
                expanded ? 'px-3.5' : 'px-0 justify-center',
                panelOpen ? 'text-[#818CF8] bg-[rgba(99,102,241,0.15)]' : 'text-[#64748B] hover:text-[#94A3B8]',
              ].join(' ')}
              onMouseEnter={(e) => {
                if (!panelOpen) (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.07)';
              }}
              onMouseLeave={(e) => {
                if (!panelOpen) (e.currentTarget as HTMLElement).style.background = 'transparent';
              }}
            >
              <div className="relative flex-shrink-0">
                {unreadCount > 0 && !panelOpen
                  ? <BellRing size={16} className="text-[#818CF8]" strokeWidth={1.75} />
                  : <Bell size={16} className={panelOpen ? 'text-[#818CF8]' : 'text-[#475569]'} strokeWidth={panelOpen ? 2 : 1.75} />
                }
                {unreadCount > 0 && (
                  <span
                    className="absolute -top-1 -right-1 w-3.5 h-3.5 bg-[#6366f1] rounded-full flex items-center justify-center text-[8px] font-bold text-white leading-none"
                    aria-live="polite"
                    aria-atomic="true"
                  >
                    {unreadCount > 9 ? '9+' : unreadCount}
                  </span>
                )}
              </div>
              {expanded && <span className="truncate">Notifications</span>}
            </button>
          </div>
        </nav>

        {/* ── User section ── */}
        {user && (
          <div
            className="space-y-1 flex-shrink-0"
            style={{
              padding: expanded ? '16px 10px' : '16px 8px',
              transition: 'padding 0.22s ease',
              borderTop: '1px solid rgba(255,255,255,0.06)',
            }}
          >
            {expanded ? (
              <>
                <div className="flex items-center gap-1.5 px-3.5 py-2">
                  <CreditCard size={12} className="flex-shrink-0 text-[#475569]" />
                  <Link
                    href="/settings/billing"
                    className="text-xs whitespace-nowrap text-[#475569] hover:text-[#64748b] transition-colors"
                  >
                    {planLabel} Plan
                  </Link>
                  {user?.subscription_status === 'trialing' && (
                    <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded-full bg-[#166534]/30 text-[#4ade80] border border-[#166534]/40 leading-none">
                      TRIAL
                    </span>
                  )}
                  {(user?.subscription_status === 'past_due' || user?.subscription_status === 'unpaid') && (
                    <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded-full bg-[#7f1d1d]/30 text-[#f87171] border border-[#7f1d1d]/40 leading-none">
                      PAST DUE
                    </span>
                  )}
                  {!user?.is_admin && (!user?.subscription_tier || user.subscription_tier === 'starter') && user?.subscription_status !== 'trialing' && (
                    <Link
                      href="/settings/billing"
                      className="text-[9px] font-semibold px-1.5 py-0.5 rounded-full bg-[#6366f1]/20 text-[#818cf8] border border-[#6366f1]/30 hover:bg-[#6366f1]/30 transition-colors leading-none whitespace-nowrap"
                    >
                      Upgrade
                    </Link>
                  )}
                </div>

                <div className="flex items-center gap-2.5 px-3.5 py-2.5 rounded-xl">
                  <div
                    className="w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0"
                    style={{ background: 'rgba(99,102,241,0.18)', border: '1px solid rgba(99,102,241,0.30)' }}
                  >
                    <User size={11} className="text-[#818CF8]" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-[11px] font-medium text-[#94A3B8] truncate leading-tight">
                      {user.name || user.email}
                    </p>
                    {user.name && (
                      <p className="text-[10px] text-[#475569] truncate leading-tight mt-0.5">
                        {user.email}
                      </p>
                    )}
                  </div>
                  <button
                    onClick={handleLogout}
                    className="text-[#475569] hover:text-[#94A3B8] transition-colors flex-shrink-0 p-1 rounded-md"
                    aria-label="Sign out"
                    title="Sign out"
                    onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.05)'; }}
                    onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
                  >
                    <LogOut size={13} />
                  </button>
                </div>
                <div className="flex items-center gap-2 px-3.5 pb-1">
                  <Link href="/privacy" className="text-[10px] text-[#334155] hover:text-[#475569] transition-colors">Privacy</Link>
                  <span className="text-[10px] text-[#334155]">·</span>
                  <Link href="/terms" className="text-[10px] text-[#334155] hover:text-[#475569] transition-colors">Terms</Link>
                </div>
              </>
            ) : (
              <div className="flex flex-col items-center gap-2">
                <button
                  onClick={handleLogout}
                  title="Sign out"
                  aria-label="Sign out"
                  className="w-7 h-7 rounded-full flex items-center justify-center transition-colors"
                  style={{ background: 'rgba(99,102,241,0.18)', border: '1px solid rgba(99,102,241,0.30)' }}
                >
                  <User size={12} className="text-[#818CF8]" />
                </button>
              </div>
            )}
          </div>
        )}
      </aside>

      {/* Notification panel — rendered outside aside so it's not clipped */}
      {panelOpen && (
        <div ref={panelRef}>
          <NotificationPanel
            notifications={notifications}
            unreadCount={unreadCount}
            panelLeft={expanded ? 232 : 68}
            onMarkAllRead={handleMarkAllRead}
            onClose={() => setPanelOpen(false)}
          />
        </div>
      )}

      {/* Support panel */}
      {supportOpen && (
        <div ref={supportRef}>
          <SupportPanel
            panelLeft={expanded ? 232 : 68}
            onClose={() => setSupportOpen(false)}
          />
        </div>
      )}
    </>
  );
}
