'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Home, Users, ArrowLeft, Shield } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';

const NAV = [
  { href: '/agency', label: 'Today', icon: Home, exact: true },
  { href: '/agency/clients', label: 'Clients', icon: Users, exact: false },
];

export function AgencySidebar() {
  const pathname = usePathname();
  const { user } = useAuth();

  return (
    <aside className="flex w-56 shrink-0 flex-col border-r border-[var(--border-subtle)] bg-[var(--bg-raised)]">
      <div className="px-5 py-5 text-base font-semibold tracking-tight text-[var(--text-primary)]">
        Lumidian Agency
      </div>

      <nav className="flex-1 px-2 pb-4">
        {NAV.map(({ href, label, icon: Icon, exact }) => {
          const active = exact ? pathname === href : pathname.startsWith(href);
          return (
            <Link
              key={href}
              href={href}
              className={`flex items-center gap-2 rounded-md px-3 py-2 text-sm transition ${
                active
                  ? 'bg-[var(--bg-elevated)] text-[var(--text-primary)]'
                  : 'text-[var(--text-secondary)] hover:bg-[var(--bg-card)] hover:text-[var(--text-primary)]'
              }`}
            >
              <Icon className="h-4 w-4" />
              {label}
            </Link>
          );
        })}
      </nav>

      <div className="border-t border-[var(--border-subtle)] px-2 py-3">
        <Link
          href="/dashboard"
          className="flex items-center gap-2 rounded-md px-3 py-2 text-sm text-[var(--text-secondary)] transition hover:bg-[var(--bg-card)] hover:text-[var(--text-primary)]"
        >
          <ArrowLeft className="h-4 w-4" />
          Lumidian app
        </Link>
        {user?.is_admin && (
          <Link
            href="/admin"
            className="flex items-center gap-2 rounded-md px-3 py-2 text-sm text-[var(--text-secondary)] transition hover:bg-[var(--bg-card)] hover:text-[var(--text-primary)]"
          >
            <Shield className="h-4 w-4" />
            Admin
          </Link>
        )}
      </div>
    </aside>
  );
}
