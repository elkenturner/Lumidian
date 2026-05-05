'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Home, Users } from 'lucide-react';
import { cn } from '@/lib/utils';

const NAV = [
  { href: '/', label: 'Today', icon: Home },
  { href: '/clients', label: 'Clients', icon: Users },
];

export function SidebarNav() {
  const pathname = usePathname();
  return (
    <aside className="w-56 shrink-0 border-r border-border bg-white">
      <div className="px-5 py-5 text-base font-semibold tracking-tight">Lumidian Agency</div>
      <nav className="px-2 pb-4">
        {NAV.map(({ href, label, icon: Icon }) => {
          const active = href === '/' ? pathname === '/' : pathname.startsWith(href);
          return (
            <Link
              key={href}
              href={href}
              className={cn(
                'flex items-center gap-2 rounded-md px-3 py-2 text-sm transition',
                active
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:bg-muted hover:text-foreground',
              )}
            >
              <Icon className="h-4 w-4" />
              {label}
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}
