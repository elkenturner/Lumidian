'use client';

import React from 'react';
import { motion } from 'framer-motion';
import { staggerContainer, staggerChild, useCountUp } from '@/lib/motion';
import {
  MessageSquare,
  TrendingUp,
  CheckCircle2,
} from 'lucide-react';

function AnimatedStatValue({ value }: { value: number | string }) {
  const display = useCountUp(typeof value === 'number' ? value : 0);
  if (typeof value !== 'number') return <>{value}</>;
  return <>{display}</>;
}

interface StatsGridProps {
  totalPrompts: number;
  daysSinceFirst: number | null;
  publishedCount: number;
  isMobile: boolean;
}

export default function StatsGrid({ totalPrompts, daysSinceFirst, publishedCount, isMobile }: StatsGridProps) {
  const items: Array<{
    label: string;
    value: string | number;
    icon: React.ElementType;
    accent: string;
    iconBg: string;
    borderTop: string;
  }> = [
    { label: 'Prompts Tracked',   value: totalPrompts || '\u2014',   icon: MessageSquare, accent: 'var(--color-gemini)', iconBg: 'var(--color-gemini-muted)',  borderTop: 'var(--color-gemini)' },
    { label: 'Days Tracking',     value: daysSinceFirst != null ? daysSinceFirst : '\u2014', icon: TrendingUp, accent: 'var(--warning-text)', iconBg: 'var(--warning-muted)', borderTop: 'var(--warning)' },
    { label: 'Content Published', value: publishedCount || '\u2014', icon: CheckCircle2, accent: 'var(--success-text)', iconBg: 'var(--success-muted)', borderTop: 'var(--success)' },
  ];

  return (
    <motion.div
      variants={staggerContainer}
      initial="hidden"
      animate="visible"
      className={isMobile ? 'snap-scroll-x gap-3 mb-4 -mx-4 px-4' : 'grid grid-cols-3 gap-3 mb-4'}
    >
      {items.map(({ label, value, icon: Icon, accent, iconBg, borderTop }) => (
        <motion.div
          key={label}
          variants={staggerChild}
          className={`card-hover bg-[var(--accent-muted)] border border-[var(--accent-border)] rounded-xl px-4 py-4 flex items-center gap-3 ${isMobile ? 'min-w-[170px]' : ''}`}
          style={{ borderTopColor: borderTop, borderTopWidth: 2 }}
        >
          <div
            className="w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0"
            style={{ background: iconBg, border: `1px solid ${accent}33` }}
          >
            <Icon size={15} style={{ color: accent }} />
          </div>
          <div className="min-w-0">
            <p className="text-xl font-bold text-[var(--text-primary)] leading-tight tabular-nums">
              <AnimatedStatValue value={value} />
            </p>
            <p className="text-[11px] text-[var(--text-muted)] mt-0.5 truncate">{label}</p>
          </div>
        </motion.div>
      ))}
    </motion.div>
  );
}
