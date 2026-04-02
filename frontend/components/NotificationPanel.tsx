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
  report_ready:    { icon: FileCheck2,   dot: '#6366f1', border: 'rgba(99,102,241,0.50)' },
  visibility_drop: { icon: TrendingDown, dot: '#ef4444', border: 'rgba(239,68,68,0.50)' },
  draft_ready:     { icon: Sparkles,     dot: '#10b981', border: 'rgba(16,185,129,0.50)' },
  info:            { icon: Info,         dot: '#64748b', border: 'rgba(100,116,139,0.30)' },
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
        background: '#0f172a',
        border: '1px solid #334155',
        borderRadius: 16,
        boxShadow: '0 20px 60px rgba(0,0,0,0.55)',
      }}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3.5 border-b border-[rgba(255,255,255,0.07)] flex-shrink-0">
        <div className="flex items-center gap-2">
          {unreadCount > 0
            ? <BellRing size={14} className="text-[#6366f1]" />
            : <Bell size={14} className="text-[#6366f1]" />
          }
          <span className="text-sm font-semibold text-[#F0F4F8]">Notifications</span>
          {unreadCount > 0 && (
            <span className="bg-[#6366f1] text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full leading-none">
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
          <div className="flex flex-col items-center justify-center py-14 gap-3">
            <div
              className="w-10 h-10 rounded-full flex items-center justify-center"
              style={{ background: '#1e293b', border: '1px solid #334155' }}
            >
              <Inbox size={18} className="text-[#475569]" />
            </div>
            <p className="text-sm text-[#475569]">You&apos;re all caught up</p>
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
                    <p className={`text-xs font-semibold leading-snug ${n.read ? 'text-[#64748B]' : 'text-[#E2E8F0]'}`}>
                      {n.title}
                    </p>
                    {n.body && (
                      <p className="text-[11px] text-[#475569] mt-0.5 leading-relaxed line-clamp-2">{n.body}</p>
                    )}
                    <p className="text-[10px] text-[#475569] mt-1.5">{relTime(n.created_at)}</p>
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
