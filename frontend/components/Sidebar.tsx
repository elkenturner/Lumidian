'use client';

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
} from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';

interface NavItem {
  label: string;
  href: string;
  icon: React.ElementType;
}

function NavLink({
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
}

interface SidebarProps {
  expanded: boolean;
  onExpandedChange: (v: boolean) => void;
}

export default function Sidebar({ expanded, onExpandedChange }: SidebarProps) {
  const pathname = usePathname();
  const router = useRouter();
  const { user, logout } = useAuth();

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

      {/* ── Logo ─────────────────────────────────────────────────────────────── */}
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
          {/* Vesica Piscis eye — sacred geometry mark */}
          <div
            className="w-10 h-10 rounded-full flex-shrink-0 overflow-hidden"
            style={{
              background: '#f9f8f6',
              boxShadow: '0 1px 8px rgba(0,0,0,0.22), 0 0 0 1px rgba(0,0,0,0.07)',
            }}
          >
            <svg width="40" height="40" viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg">

              {/* Outer sacred geometry rings */}
              <circle cx="50" cy="50" r="46" stroke="#0d0d0d" strokeWidth="0.5" opacity="0.12"/>
              <circle cx="50" cy="50" r="39" stroke="#0d0d0d" strokeWidth="0.35" opacity="0.08"/>

              {/* The two source circles of the Vesica Piscis — faint, foundational */}
              <circle cx="50" cy="26" r="48" stroke="#0d0d0d" strokeWidth="0.6" opacity="0.09" fill="none"/>
              <circle cx="50" cy="74" r="48" stroke="#0d0d0d" strokeWidth="0.6" opacity="0.09" fill="none"/>

              {/* 8 radial rays from center — behind the eye */}
              <g stroke="#0d0d0d" strokeWidth="0.7" opacity="0.08">
                <line x1="50" y1="50" x2="50" y2="4"/>
                <line x1="50" y1="50" x2="82" y2="18"/>
                <line x1="50" y1="50" x2="96" y2="50"/>
                <line x1="50" y1="50" x2="82" y2="82"/>
                <line x1="50" y1="50" x2="50" y2="96"/>
                <line x1="50" y1="50" x2="18" y2="82"/>
                <line x1="50" y1="50" x2="4" y2="50"/>
                <line x1="50" y1="50" x2="18" y2="18"/>
              </g>

              {/* Eye lens (Vesica Piscis) — white fill covers rays inside */}
              {/* Upper arc: CCW on Circle B (center 50,74, r≈48) */}
              {/* Lower arc: CW on Circle A (center 50,26, r≈48) */}
              <path
                d="M 8 50 A 48 48 0 0 0 92 50 A 48 48 0 0 1 8 50 Z"
                fill="#f9f8f6"
                stroke="#0d0d0d"
                strokeWidth="1.3"
                strokeLinejoin="round"
              />

              {/* Iris */}
              <circle cx="50" cy="50" r="15" stroke="#0d0d0d" strokeWidth="1" fill="#f9f8f6"/>

              {/* Inner iris detail ring */}
              <circle cx="50" cy="50" r="11" stroke="#0d0d0d" strokeWidth="0.4" opacity="0.35" fill="none"/>

              {/* Pupil */}
              <circle cx="50" cy="50" r="7" fill="#0d0d0d"/>

              {/* Highlight — tiny reflection dot, keeps it alive not creepy */}
              <circle cx="53.5" cy="46" r="2" fill="#f9f8f6"/>

              {/* Concentric rings at left tip — where the circles intersect */}
              <circle cx="8" cy="50" r="4"   stroke="#0d0d0d" strokeWidth="0.5" opacity="0.22" fill="none"/>
              <circle cx="8" cy="50" r="7.5" stroke="#0d0d0d" strokeWidth="0.35" opacity="0.15" fill="none"/>
              <circle cx="8" cy="50" r="11"  stroke="#0d0d0d" strokeWidth="0.3" opacity="0.1"  fill="none"/>

              {/* Concentric rings at right tip */}
              <circle cx="92" cy="50" r="4"   stroke="#0d0d0d" strokeWidth="0.5" opacity="0.22" fill="none"/>
              <circle cx="92" cy="50" r="7.5" stroke="#0d0d0d" strokeWidth="0.35" opacity="0.15" fill="none"/>
              <circle cx="92" cy="50" r="11"  stroke="#0d0d0d" strokeWidth="0.3" opacity="0.1"  fill="none"/>

            </svg>
          </div>
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

      {/* ── Navigation ───────────────────────────────────────────────────────── */}
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
      </nav>

      {/* ── User section ─────────────────────────────────────────────────────── */}
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
              {/* Plan badge */}
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

              {/* User info + logout */}
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
                  title="Sign out"
                  onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.05)'; }}
                  onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
                >
                  <LogOut size={13} />
                </button>
              </div>
            </>
          ) : (
            /* Collapsed: avatar only */
            <div className="flex flex-col items-center gap-2">
              <button
                onClick={handleLogout}
                title="Sign out"
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
  );
}
