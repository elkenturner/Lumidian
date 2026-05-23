'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { BarChart3, FileText, Globe, LayoutDashboard, Lightbulb, MessageSquare, PenSquare, Search, Users } from 'lucide-react';

const NAV = (token: string) => [
  { href: `/client/${token}`, label: 'Home', icon: LayoutDashboard, exact: true },
  { href: `/client/${token}/visibility`, label: 'Visibility', icon: BarChart3 },
  { href: `/client/${token}/transcripts`, label: 'Transcripts', icon: MessageSquare },
  { href: `/client/${token}/competitors`, label: 'Competitors', icon: Users },
  { href: `/client/${token}/site-audit`, label: 'Site audit', icon: Search },
  { href: `/client/${token}/strategy`, label: 'Strategy', icon: Lightbulb },
  { href: `/client/${token}/wikipedia`, label: 'Wikipedia', icon: Globe },
  { href: `/client/${token}/content`, label: 'Content posted', icon: PenSquare },
  { href: `/client/${token}/reports`, label: 'Reports', icon: FileText },
];

export default function ClientPortalSidebar({ token }: { token: string }) {
  const pathname = usePathname();
  const nav = NAV(token);

  return (
    <aside className="hidden w-56 shrink-0 border-r border-neutral-200 bg-white px-3 py-6 md:block">
      <div className="mb-6 px-2 text-sm font-semibold text-neutral-900">Lumidian</div>
      <nav className="space-y-1">
        {nav.map((item) => {
          const active = item.exact ? pathname === item.href : pathname?.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? 'page' : undefined}
              className={`flex items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors ${
                active ? 'bg-neutral-900 text-white' : 'text-neutral-700 hover:bg-neutral-100'
              }`}
            >
              <item.icon className="h-4 w-4" />
              {item.label}
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}
