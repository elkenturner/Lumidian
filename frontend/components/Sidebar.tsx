'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import {
  LayoutDashboard,
  Settings,
  Zap,
  FileText,
  Link2,
  Plus,
} from 'lucide-react';
import clsx from 'clsx';
import { getBrands } from '@/lib/api';

interface NavItem {
  label: string;
  href: string;
  icon: React.ElementType;
}

function NavLink({
  item,
  pathname,
  exact = false,
}: {
  item: NavItem;
  pathname: string;
  exact?: boolean;
}) {
  const Icon = item.icon;
  const isActive = exact
    ? pathname === item.href
    : pathname === item.href || pathname.startsWith(item.href + '/');
  return (
    <Link
      href={item.href}
      className={clsx(
        'flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-all duration-150',
        isActive
          ? 'bg-[#1a1a24] text-[#818cf8] border-l-2 border-[#6366f1] pl-[10px]'
          : 'text-[#64748b] hover:bg-[#111118] hover:text-[#94a3b8]'
      )}
    >
      <Icon size={16} className={clsx(isActive ? 'text-[#6366f1]' : 'text-[#475569]')} />
      {item.label}
    </Link>
  );
}

export default function Sidebar() {
  const pathname = usePathname();
  const [brandId, setBrandId] = useState<number | null>(null);

  useEffect(() => {
    // Try to extract brandId from current path first
    const match = pathname.match(/^\/(?:tracker|results)\/(\d+)/);
    if (match) {
      setBrandId(parseInt(match[1], 10));
      return;
    }
    // Otherwise fetch the first brand
    getBrands()
      .then((brands) => {
        if (brands[0]) setBrandId(brands[0].id);
      })
      .catch(() => {});
  }, [pathname]);

  const navItems: NavItem[] = [
    { label: 'Dashboard', href: '/dashboard', icon: LayoutDashboard },
    ...(brandId
      ? [{ label: 'Brand Settings', href: `/tracker/${brandId}`, icon: Settings }]
      : [{ label: 'Brand Settings', href: '/tracker', icon: Settings }]),
    { label: 'Content Hub', href: '/content', icon: FileText },
    { label: 'Connected Accounts', href: '/settings/accounts', icon: Link2 },
    { label: 'Settings', href: '/settings', icon: Settings },
  ];

  return (
    <aside className="fixed left-0 top-0 h-screen w-64 bg-[#0d0d14] border-r border-[#1e1e2e] flex flex-col z-50">
      {/* Logo */}
      <div className="px-6 py-5 border-b border-[#1e1e2e]">
        <Link href="/dashboard" className="flex items-center gap-3 group">
          <div className="w-8 h-8 rounded-lg bg-[#6366f1] flex items-center justify-center">
            <Zap size={16} className="text-white" fill="white" />
          </div>
          <span className="text-lg font-bold text-[#e2e8f0]">
            ClarityAI
          </span>
        </Link>
      </div>

      {/* Navigation */}
      <nav className="flex-1 px-3 py-4 space-y-0.5 overflow-y-auto">
        {navItems.map((item) => (
          <NavLink
            key={item.href}
            item={item}
            pathname={pathname}
            exact={item.href === '/settings' || item.href === '/tracker'}
          />
        ))}

        <div className="pt-2">
          <Link
            href="/tracker/new"
            className="flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium text-[#64748b] hover:bg-[#111118] hover:text-[#94a3b8] transition-all duration-150"
          >
            <Plus size={16} className="text-[#475569]" />
            Add Brand
          </Link>
        </div>
      </nav>

      {/* Bottom status */}
      <div className="px-4 py-4 border-t border-[#1e1e2e]">
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-[#10b981] animate-pulse" />
          <span className="text-xs text-[#64748b]">System online</span>
        </div>
      </div>
    </aside>
  );
}
