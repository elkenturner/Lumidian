'use client';

import { memo, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import {
  LayoutDashboard,
  Settings,
  FileText,
  LogOut,
  CreditCard,
  User,
  BarChart2,
  Shield,
  Bell,
  X,
  ExternalLink,
  CheckCheck,
  ChevronDown,
  Building2,
  Plus,
  Check,
} from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useBrand } from '@/contexts/BrandContext';
import OceanLogo from '@/components/OceanLogo';
import {
  getNotifications,
  markAllNotificationsRead,
  AppNotification,
} from '@/lib/api';
import { formatDistanceToNow, parseISO } from 'date-fns';

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
        'flex items-center gap-3 py-2 rounded-lg text-sm font-medium transition-all duration-200 relative overflow-hidden',
        expanded ? 'px-3' : 'px-0 justify-center',
        isActive
          ? 'text-[#818CF8]'
          : 'text-[#64748B] hover:text-[#94A3B8]',
      ].join(' ')}
      style={isActive ? {
        background: 'rgba(99,102,241,0.18)',
        backdropFilter: 'blur(8px)',
        WebkitBackdropFilter: 'blur(8px)',
        boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.08)',
      } : undefined}
      onMouseEnter={(e) => {
        if (!isActive) (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.07)';
      }}
      onMouseLeave={(e) => {
        if (!isActive) (e.currentTarget as HTMLElement).style.background = 'transparent';
      }}
    >
      {isActive && (
        <span className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-5 bg-[#6366F1] rounded-r-full" />
      )}
      <Icon
        size={16}
        className={`flex-shrink-0 ${isActive ? 'text-[#818CF8]' : 'text-[#475569]'}`}
        strokeWidth={isActive ? 2 : 1.75}
      />
      {expanded && (
        <span className="truncate">{item.label}</span>
      )}
    </Link>
  );
});

// ── Notification panel ─────────────────────────────────────────────────────────

const TYPE_COLORS: Record<string, { bg: string; dot: string }> = {
  report_ready:    { bg: 'rgba(99,102,241,0.10)',  dot: '#6366f1' },
  visibility_drop: { bg: 'rgba(239,68,68,0.08)',   dot: '#ef4444' },
  draft_ready:     { bg: 'rgba(16,185,129,0.08)',  dot: '#10b981' },
  info:            { bg: 'rgba(255,255,255,0.04)', dot: '#64748B' },
};

function relTime(iso: string) {
  try { return formatDistanceToNow(parseISO(iso), { addSuffix: true }); }
  catch { return ''; }
}

function NotificationPanel({
  notifications,
  unreadCount,
  onMarkAllRead,
  onClose,
}: {
  notifications: AppNotification[];
  unreadCount: number;
  onMarkAllRead: () => void;
  onClose: () => void;
}) {
  return (
    <div
      className="fixed z-[200]"
      style={{
        left: 228,
        bottom: 16,
        width: 320,
        maxHeight: '80vh',
        display: 'flex',
        flexDirection: 'column',
        background: 'rgba(10,14,24,0.97)',
        backdropFilter: 'blur(24px)',
        WebkitBackdropFilter: 'blur(24px)',
        border: '1px solid rgba(99,102,241,0.18)',
        borderRadius: 16,
        boxShadow: '0 16px 48px rgba(0,0,0,0.50)',
      }}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-[rgba(255,255,255,0.07)] flex-shrink-0">
        <div className="flex items-center gap-2">
          <Bell size={14} className="text-[#6366f1]" />
          <span className="text-sm font-semibold text-[#F0F4F8]">Notifications</span>
          {unreadCount > 0 && (
            <span className="bg-[#6366f1] text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full">
              {unreadCount}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          {unreadCount > 0 && (
            <button
              onClick={onMarkAllRead}
              className="flex items-center gap-1 text-[10px] text-[#64748B] hover:text-[#94A3B8] px-2 py-1 rounded-md hover:bg-[rgba(255,255,255,0.05)] transition-colors"
              title="Mark all as read"
            >
              <CheckCheck size={11} />
              All read
            </button>
          )}
          <button
            onClick={onClose}
            className="text-[#475569] hover:text-[#94A3B8] transition-colors p-1 rounded-md hover:bg-[rgba(255,255,255,0.05)]"
          >
            <X size={14} />
          </button>
        </div>
      </div>

      {/* List */}
      <div className="overflow-y-auto flex-1" style={{ scrollbarWidth: 'thin', scrollbarColor: 'rgba(255,255,255,0.08) transparent' }}>
        {notifications.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 gap-2">
            <Bell size={24} className="text-[#334155]" />
            <p className="text-sm text-[#475569]">No notifications yet</p>
          </div>
        ) : (
          notifications.map((n) => {
            const colors = TYPE_COLORS[n.type] ?? TYPE_COLORS.info;
            return (
              <div
                key={n.id}
                className="px-4 py-3 border-b border-[rgba(255,255,255,0.05)] hover:bg-[rgba(255,255,255,0.03)] transition-colors"
                style={{ background: !n.read ? 'rgba(99,102,241,0.04)' : undefined }}
              >
                <div className="flex items-start gap-2.5">
                  <div
                    className="w-1.5 h-1.5 rounded-full mt-1.5 flex-shrink-0"
                    style={{ background: n.read ? 'transparent' : colors.dot }}
                  />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-2">
                      <p className={`text-xs font-semibold leading-snug ${n.read ? 'text-[#64748B]' : 'text-[#E2E8F0]'}`}>
                        {n.title}
                      </p>
                      {n.link && (
                        <Link
                          href={n.link}
                          className="text-[#6366f1] hover:text-[#818cf8] flex-shrink-0 transition-colors"
                          onClick={onClose}
                        >
                          <ExternalLink size={11} />
                        </Link>
                      )}
                    </div>
                    {n.body && (
                      <p className="text-[11px] text-[#475569] mt-0.5 leading-relaxed line-clamp-2">{n.body}</p>
                    )}
                    <p className="text-[10px] text-[#334155] mt-1">{relTime(n.created_at)}</p>
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

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

  // Close panel on outside click
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

  async function handleMarkAllRead() {
    const r = await markAllNotificationsRead().catch(() => null);
    if (r) { setNotifications(r.notifications); setUnreadCount(0); }
  }

  const navItems: NavItem[] = [
    { label: 'Dashboard',   href: '/dashboard', icon: LayoutDashboard },
    { label: 'Reports',     href: '/reports',   icon: BarChart2 },
    { label: 'Content Hub', href: '/content',   icon: FileText },
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
          width: expanded ? 220 : 56,
          transition: 'width 0.2s ease',
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
            padding: expanded ? '20px' : '14px 0',
            display: 'flex',
            justifyContent: expanded ? 'flex-start' : 'center',
            transition: 'padding 0.2s ease',
            borderBottom: '1px solid rgba(255,255,255,0.07)',
          }}
        >
          <Link href="/dashboard" className="flex items-center gap-3">
            <OceanLogo size={40} withCircle />
            {expanded && (
              <span
                className="whitespace-nowrap"
                style={{ fontSize: '15px', fontWeight: 600, letterSpacing: '0.01em', color: '#e2e8f0' }}
              >
                ClarityAI
              </span>
            )}
          </Link>
        </div>

        {/* ── Brand switcher ── */}
        {brands.length > 0 && (
          <div
            ref={brandRef}
            className="flex-shrink-0 relative"
            style={{
              padding: expanded ? '10px 12px' : '10px 8px',
              borderBottom: '1px solid rgba(255,255,255,0.07)',
            }}
          >
            <button
              onClick={(e) => { e.stopPropagation(); if (brands.length > 0) setBrandOpen((v) => !v); }}
              title={expanded ? undefined : (activeBrand?.name ?? 'Switch brand')}
              aria-label="Switch brand"
              className="w-full flex items-center gap-2.5 rounded-lg transition-all duration-150"
              style={{
                padding: expanded ? '7px 10px' : '7px 0',
                justifyContent: expanded ? 'flex-start' : 'center',
                background: brandOpen ? 'rgba(99,102,241,0.12)' : 'rgba(255,255,255,0.04)',
                border: '1px solid rgba(255,255,255,0.07)',
              }}
              onMouseEnter={(e) => { if (!brandOpen) (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.07)'; }}
              onMouseLeave={(e) => { if (!brandOpen) (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.04)'; }}
            >
              <div
                className="flex-shrink-0 flex items-center justify-center rounded-md"
                style={{ width: 22, height: 22, background: 'rgba(99,102,241,0.20)', border: '1px solid rgba(99,102,241,0.30)' }}
              >
                <Building2 size={12} className="text-[#818CF8]" />
              </div>
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
                        <div
                          className="flex-shrink-0 flex items-center justify-center rounded-md"
                          style={{
                            width: 24, height: 24,
                            background: isActive ? 'rgba(99,102,241,0.25)' : 'rgba(255,255,255,0.06)',
                            border: `1px solid ${isActive ? 'rgba(99,102,241,0.40)' : 'rgba(255,255,255,0.08)'}`,
                          }}
                        >
                          <span className="text-[10px] font-bold" style={{ color: isActive ? '#818CF8' : '#64748B' }}>
                            {brand.name.charAt(0).toUpperCase()}
                          </span>
                        </div>
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
          className="flex-1 space-y-0.5 overflow-y-auto"
          style={{ padding: expanded ? '16px 12px' : '16px 8px', transition: 'padding 0.2s ease' }}
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

          {/* ── Bell button ── */}
          <div className="pt-1">
            <button
              onClick={(e) => { e.stopPropagation(); setPanelOpen((v) => !v); }}
              title="Notifications"
              aria-label="Notifications"
              className={[
                'w-full flex items-center gap-3 py-2 rounded-lg text-sm font-medium transition-all duration-200 relative',
                expanded ? 'px-3' : 'px-0 justify-center',
                panelOpen ? 'text-[#818CF8] bg-[rgba(99,102,241,0.18)]' : 'text-[#64748B] hover:text-[#94A3B8]',
              ].join(' ')}
              onMouseEnter={(e) => {
                if (!panelOpen) (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.07)';
              }}
              onMouseLeave={(e) => {
                if (!panelOpen) (e.currentTarget as HTMLElement).style.background = 'transparent';
              }}
            >
              <div className="relative flex-shrink-0">
                <Bell
                  size={16}
                  className={panelOpen ? 'text-[#818CF8]' : 'text-[#475569]'}
                  strokeWidth={panelOpen ? 2 : 1.75}
                />
                {unreadCount > 0 && (
                  <span
                    className="absolute -top-1 -right-1 w-3.5 h-3.5 bg-[#6366f1] rounded-full flex items-center justify-center text-[8px] font-bold text-white leading-none"
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
              padding: expanded ? '16px 12px' : '16px 8px',
              transition: 'padding 0.2s ease',
              borderTop: '1px solid rgba(255,255,255,0.07)',
            }}
          >
            {expanded ? (
              <>
                <Link
                  href="/settings"
                  className="flex items-center gap-2 px-3 py-1.5 rounded-lg transition-colors"
                  style={{ color: '#475569' }}
                  onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.05)'; }}
                  onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
                >
                  <CreditCard size={12} className="flex-shrink-0" />
                  <span className="text-xs whitespace-nowrap">{planLabel} Plan</span>
                </Link>

                <div className="flex items-center gap-2.5 px-3 py-2 rounded-lg">
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
                    className="text-[#334155] hover:text-[#64748B] transition-colors flex-shrink-0 p-1 rounded-md"
                    aria-label="Sign out"
                    title="Sign out"
                    onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.05)'; }}
                    onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
                  >
                    <LogOut size={13} />
                  </button>
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
            onMarkAllRead={handleMarkAllRead}
            onClose={() => setPanelOpen(false)}
          />
        </div>
      )}
    </>
  );
}
