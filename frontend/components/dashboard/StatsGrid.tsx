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
  }> = [
    { label: 'Prompts Tracked',   value: totalPrompts,                                                          icon: MessageSquare },
    { label: 'Days Tracking',     value: daysSinceFirst != null ? (daysSinceFirst === 0 ? '<1' : daysSinceFirst) : '\u2014', icon: TrendingUp },
    { label: 'Content Published', value: publishedCount,                                                        icon: CheckCircle2 },
  ];

  return (
    <motion.div
      variants={staggerContainer}
      initial="hidden"
      animate="visible"
      className={isMobile ? 'snap-scroll-x gap-3 mb-4 -mx-4 px-4' : 'grid grid-cols-3 gap-3 mb-4'}
    >
      {items.map(({ label, value, icon: Icon }) => (
        <motion.div
          key={label}
          variants={staggerChild}
          className={`card card-hover px-4 py-4 flex items-center gap-3 ${isMobile ? 'min-w-[170px]' : ''}`}
        >
          <div className="w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0 bg-[var(--bg-tinted)] border border-[var(--border-faint)] text-[var(--text-muted)]">
            <Icon size={15} />
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
