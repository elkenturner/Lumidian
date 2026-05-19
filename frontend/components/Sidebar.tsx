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
  ShieldCheck,
  Briefcase,
  BookOpen,
  ChevronDown,
  Plus,
  Check,
} from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useBrand } from '@/contexts/BrandContext';
import LumidianLogo from '@/components/LumidianLogo';
import BrandAvatar from '@/components/BrandAvatar';
import { TIER_DISPLAY_NAMES } from '@/lib/tiers';

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
        'flex items-center gap-3 py-2.5 rounded-xl text-sm font-medium relative overflow-hidden',
        expanded ? 'px-3.5' : 'px-0 justify-center',
        isActive
          ? 'text-[var(--accent-light)]'
          : 'text-[var(--text-muted)] hover:text-[var(--text-secondary)]',
      ].join(' ')}
      style={{
        transition: 'background-color 200ms var(--ease-out), border-color 200ms var(--ease-out)',
        ...(isActive ? { background: 'rgba(95,126,166,0.12)' } : {}),
      }}
      onMouseEnter={(e) => {
        if (!isActive) (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.06)';
      }}
      onMouseLeave={(e) => {
        if (!isActive) (e.currentTarget as HTMLElement).style.background = 'transparent';
      }}
    >
      {isActive && (
        <span className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-[18px] rounded-r-full" style={{ background: 'linear-gradient(180deg, var(--accent-light), var(--accent))' }} />
      )}
      <Icon
        size={17}
        className={`flex-shrink-0 ${isActive ? 'text-[var(--accent-light)]' : 'text-[var(--text-faint)]'}`}
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

  const navItems: NavItem[] = [
    { label: 'Dashboard',   href: '/dashboard', icon: LayoutDashboard },
    { label: 'Reports',     href: '/reports',   icon: LineChart },
    ...(user?.subscription_tier
      ? [{ label: 'Site Audit', href: '/site-audit', icon: ShieldCheck }]
      : []),
    { label: 'Content Hub', href: '/content',   icon: PenLine },
    ...(user?.subscription_tier === 'starter' || user?.subscription_tier === 'pro'
      ? [{ label: 'Wikipedia', href: '/wiki', icon: BookOpen }]
      : []),
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
      ? TIER_DISPLAY_NAMES[user.subscription_tier] || user.subscription_tier.charAt(0).toUpperCase() + user.subscription_tier.slice(1)
      : 'Free';

  return (
    <>
      <aside
        className="fixed left-0 top-0 h-screen flex flex-col z-50 overflow-hidden"
        style={{
          width: expanded ? 240 : 64,
          transition: 'width 0.22s ease',
          background: 'linear-gradient(180deg, rgba(6,10,22,0.92) 0%, rgba(4,6,14,0.96) 100%)',
          backdropFilter: 'blur(20px)',
          WebkitBackdropFilter: 'blur(20px)',
          borderRight: '1px solid rgba(95,126,166,0.10)',
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
              className="w-full flex items-center gap-2.5 rounded-lg"
              style={{
                transition: 'background-color 150ms var(--ease-out), border-color 150ms var(--ease-out)',
                padding: expanded ? '8px 10px' : '8px 0',
                justifyContent: expanded ? 'flex-start' : 'center',
                background: brandOpen ? 'rgba(95,126,166,0.12)' : 'rgba(255,255,255,0.04)',
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
                style={{ background: 'rgba(95,126,166,0.20)', border: '1px solid rgba(95,126,166,0.30)', padding: 3 }}
                textClassName="text-[9px] font-bold text-[var(--accent-light)]"
              />
              {expanded && (
                <>
                  <span className="flex-1 text-left text-[12px] font-medium text-[var(--text-secondary)] truncate leading-tight min-w-0">
                    {activeBrand?.name ?? 'Select brand'}
                  </span>
                  <ChevronDown
                    size={12}
                    className="flex-shrink-0 text-[var(--text-faint)] transition-transform duration-150"
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
                  border: '1px solid rgba(95,126,166,0.20)',
                  borderRadius: 12,
                  boxShadow: '0 12px 40px rgba(0,0,0,0.50)',
                  overflow: 'hidden',
                }}
              >
                {/* Header */}
                <div className="px-3 pt-2.5 pb-1.5 border-b border-[rgba(255,255,255,0.06)]">
                  <p className="text-[10px] font-semibold text-[var(--text-faint)] uppercase tracking-wider">Your brands</p>
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
                        style={{ background: isActive ? 'rgba(95,126,166,0.10)' : 'transparent' }}
                        onMouseEnter={(e) => { if (!isActive) (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.05)'; }}
                        onMouseLeave={(e) => { if (!isActive) (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
                      >
                        <BrandAvatar
                          name={brand.name}
                          websiteUrl={brand.website_url}
                          size={24}
                          className="rounded-md"
                          style={{
                            background: isActive ? 'rgba(95,126,166,0.25)' : 'rgba(255,255,255,0.06)',
                            border: `1px solid ${isActive ? 'rgba(95,126,166,0.40)' : 'rgba(255,255,255,0.08)'}`,
                            padding: 3,
                          }}
                          textClassName="text-[10px] font-bold"
                          textStyle={{ color: isActive ? 'var(--accent-light)' : 'var(--text-muted)' }}
                        />
                        <div className="flex-1 min-w-0">
                          <p className={`text-[12px] font-medium truncate leading-tight ${isActive ? 'text-[var(--text-primary)]' : 'text-[var(--text-secondary)]'}`}>
                            {brand.name}
                          </p>
                          <p className={`text-[10px] leading-tight ${
                            brand.brand_type === 'pitch'
                              ? 'text-[var(--warning)]'
                              : (user?.subscription_tier === 'pro' || user?.is_admin)
                                ? 'text-[var(--accent-foreground)]'
                                : 'text-[var(--text-faint)]'
                          }`}>
                            {brand.brand_type === 'pitch'
                              ? 'Pitch'
                              : brand.brand_type === 'pro'
                                ? 'Pro'
                                : 'Standard'}
                          </p>
                        </div>
                        {isActive && <Check size={12} className="flex-shrink-0 text-[var(--accent)]" />}
                      </button>
                    );
                  })}
                </div>

                {/* Add brand link */}
                <div className="border-t border-[rgba(255,255,255,0.06)] p-1">
                  <Link
                    href="/settings/brands/new"
                    onClick={() => setBrandOpen(false)}
                    className="flex items-center gap-2 px-3 py-2 rounded-lg text-[11px] text-[var(--text-faint)] hover:text-[var(--text-secondary)] transition-colors"
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

          {(user?.is_agency_staff || user?.is_admin) && (
            <NavLink
              item={{ label: 'Agency', href: '/agency', icon: Briefcase }}
              pathname={pathname}
              exact={false}
              expanded={expanded}
            />
          )}

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
                  <CreditCard size={12} className="flex-shrink-0 text-[var(--text-faint)]" />
                  <Link
                    href="/settings/billing"
                    className="text-xs whitespace-nowrap text-[var(--text-faint)] hover:text-[var(--text-muted)] transition-colors"
                  >
                    {planLabel} Plan
                  </Link>
                  {(user?.subscription_status === 'past_due' || user?.subscription_status === 'unpaid') && (
                    <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded-full bg-[#7f1d1d]/30 text-[var(--danger-text)] border border-[#7f1d1d]/40 leading-none">
                      PAST DUE
                    </span>
                  )}
                  {!user?.is_admin && (!user?.subscription_tier || user.subscription_tier === 'basic' || user.subscription_tier === 'starter') && (
                    <Link
                      href="/settings/billing"
                      className="text-[9px] font-semibold px-1.5 py-0.5 rounded-full bg-[var(--accent)]/20 text-[var(--accent-light)] border border-[var(--accent)]/30 hover:bg-[var(--accent)]/30 transition-colors leading-none whitespace-nowrap"
                    >
                      Upgrade
                    </Link>
                  )}
                </div>

                <div
                  className="flex items-center gap-2.5 px-3 py-2.5 rounded-xl"
                  style={{
                    background: 'var(--bg-raised)',
                    border: '1px solid var(--border-subtle)',
                  }}
                >
                  <div
                    className="w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0"
                    style={{ background: 'rgba(95,126,166,0.18)', border: '1px solid rgba(95,126,166,0.30)' }}
                  >
                    <User size={11} className="text-[var(--accent-light)]" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-[11px] font-medium text-[var(--text-secondary)] truncate leading-tight">
                      {user.name || user.email}
                    </p>
                    {user.name && (
                      <p className="text-[10px] text-[var(--text-faint)] truncate leading-tight mt-0.5">
                        {user.email}
                      </p>
                    )}
                  </div>
                  <button
                    onClick={handleLogout}
                    className="text-[var(--text-faint)] hover:text-[var(--text-secondary)] transition-colors flex-shrink-0 p-1 rounded-md"
                    aria-label="Sign out"
                    title="Sign out"
                    onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.05)'; }}
                    onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
                  >
                    <LogOut size={13} />
                  </button>
                </div>
                <div className="flex items-center gap-2 px-3.5 pb-2 pt-1">
                  <Link href="/privacy" className="text-[10px] text-[var(--text-faint)] hover:text-[var(--text-muted)] transition-colors">Privacy</Link>
                  <span className="text-[10px] text-[var(--text-faint)]">·</span>
                  <Link href="/terms" className="text-[10px] text-[var(--text-faint)] hover:text-[var(--text-muted)] transition-colors">Terms</Link>
                </div>
              </>
            ) : (
              <div className="flex flex-col items-center gap-2">
                <button
                  onClick={handleLogout}
                  title="Sign out"
                  aria-label="Sign out"
                  className="w-7 h-7 rounded-full flex items-center justify-center transition-colors"
                  style={{ background: 'rgba(95,126,166,0.18)', border: '1px solid rgba(95,126,166,0.30)' }}
                >
                  <User size={12} className="text-[var(--accent-light)]" />
                </button>
              </div>
            )}
          </div>
        )}
      </aside>

    </>
  );
}
