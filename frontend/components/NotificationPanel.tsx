'use client';

import Link from 'next/link';
import {
  Bell,
  BellRing,
  FileCheck2,
  TrendingDown,
  Sparkles,
  Info,
  Inbox,
  CheckCheck,
  X,
} from 'lucide-react';
import { formatDistanceToNow, parseISO } from 'date-fns';
import type { AppNotification } from '@/lib/api';

const TYPE_META: Record<string, { icon: React.ElementType; dot: string; border: string }> = {
  report_ready:    { icon: FileCheck2,   dot: 'var(--accent)', border: 'rgba(99,102,241,0.50)' },
  visibility_drop: { icon: TrendingDown, dot: 'var(--danger)', border: 'rgba(239,68,68,0.50)' },
  draft_ready:     { icon: Sparkles,     dot: 'var(--success)', border: 'rgba(16,185,129,0.50)' },
  info:            { icon: Info,         dot: 'var(--text-muted)', border: 'rgba(100,116,139,0.30)' },
};

function relTime(iso: string) {
  try { return formatDistanceToNow(parseISO(iso), { addSuffix: true }); }
  catch { return ''; }
}

interface NotificationPanelProps {
  notifications: AppNotification[];
  unreadCount: number;
  panelLeft: number;
  onMarkAllRead: () => void;
  onClose: () => void;
}

export default function NotificationPanel({
  notifications,
  unreadCount,
  panelLeft,
  onMarkAllRead,
  onClose,
}: NotificationPanelProps) {
  return (
    <div
      className="fixed z-[200]"
      style={{
        left: panelLeft,
        bottom: 16,
        width: 340,
        maxHeight: '80vh',
        display: 'flex',
        flexDirection: 'column',
        background: 'rgba(10,14,24,0.97)',
        backdropFilter: 'blur(24px)',
        WebkitBackdropFilter: 'blur(24px)',
        border: '1px solid rgba(99,102,241,0.20)',
        borderRadius: 16,
        boxShadow: '0 20px 60px rgba(0,0,0,0.55), 0 0 0 1px rgba(255,255,255,0.04) inset',
      }}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3.5 border-b border-[rgba(255,255,255,0.07)] flex-shrink-0">
        <div className="flex items-center gap-2">
          {unreadCount > 0
            ? <BellRing size={14} className="text-[var(--accent)]" />
            : <Bell size={14} className="text-[var(--accent)]" />
          }
          <span className="text-sm font-semibold text-[var(--text-primary)]">Notifications</span>
          {unreadCount > 0 && (
            <span className="bg-[var(--accent)] text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full leading-none">
              {unreadCount}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          {unreadCount > 0 && (
            <button
              onClick={onMarkAllRead}
              className="flex items-center gap-1 text-[10px] text-[var(--text-muted)] hover:text-[var(--text-secondary)] px-2 py-1 rounded-md hover:bg-[rgba(255,255,255,0.05)] transition-colors"
              title="Mark all as read"
            >
              <CheckCheck size={11} />
              All read
            </button>
          )}
          <button
            onClick={onClose}
            className="text-[var(--text-faint)] hover:text-[var(--text-secondary)] transition-colors p-1 rounded-md hover:bg-[rgba(255,255,255,0.05)]"
          >
            <X size={14} />
          </button>
        </div>
      </div>

      {/* List */}
      <div className="overflow-y-auto flex-1" style={{ scrollbarWidth: 'thin', scrollbarColor: 'rgba(255,255,255,0.08) transparent' }}>
        {notifications.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-14 gap-3">
            <div
              className="w-10 h-10 rounded-full flex items-center justify-center"
              style={{ background: 'rgba(99,102,241,0.08)', border: '1px solid rgba(99,102,241,0.18)' }}
            >
              <Inbox size={18} className="text-[var(--text-faint)]" />
            </div>
            <p className="text-sm text-[var(--text-faint)]">You&apos;re all caught up</p>
          </div>
        ) : (
          notifications.map((n) => {
            const meta = TYPE_META[n.type] ?? TYPE_META.info;
            const Icon = meta.icon;
            const inner = (
              <div
                className="px-4 py-3.5 border-b border-[rgba(255,255,255,0.05)] hover:bg-[rgba(255,255,255,0.03)] transition-colors"
                style={{
                  background: !n.read ? 'rgba(99,102,241,0.04)' : undefined,
                  borderLeft: !n.read ? `2px solid ${meta.border}` : '2px solid transparent',
                }}
              >
                <div className="flex items-start gap-3">
                  <div
                    className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5"
                    style={{ background: `${meta.dot}18`, border: `1px solid ${meta.dot}33` }}
                  >
                    <Icon size={13} style={{ color: meta.dot }} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className={`text-xs font-semibold leading-snug ${n.read ? 'text-[var(--text-muted)]' : 'text-[var(--text-primary)]'}`}>
                      {n.title}
                    </p>
                    {n.body && (
                      <p className="text-[11px] text-[var(--text-faint)] mt-0.5 leading-relaxed line-clamp-2">{n.body}</p>
                    )}
                    <p className="text-[10px] text-[var(--text-faint)] mt-1.5">{relTime(n.created_at)}</p>
                  </div>
                  {!n.read && (
                    <div className="w-1.5 h-1.5 rounded-full flex-shrink-0 mt-1.5" style={{ background: meta.dot }} />
                  )}
                </div>
              </div>
            );

            return n.link ? (
              <Link key={n.id} href={n.link} onClick={onClose} className="block" style={{ textDecoration: 'none' }}>
                {inner}
              </Link>
            ) : (
              <div key={n.id}>{inner}</div>
            );
          })
        )}
      </div>
    </div>
  );
}
