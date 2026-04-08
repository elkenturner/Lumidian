'use client';

import { memo, useEffect, useState, type ReactNode } from 'react';

export interface ProgressBannerItem {
  key: string;
  label: string;
  icon: ReactNode;
  color: string;
}

interface ProgressBannerProps {
  title: string;
  subtitle: string;
  items: ProgressBannerItem[];
}

const ProgressBanner = memo(function ProgressBanner({ title, subtitle, items }: ProgressBannerProps) {
  const [activeIndex, setActiveIndex] = useState(0);

  useEffect(() => {
    if (items.length <= 1) return;
    const interval = setInterval(() => {
      setActiveIndex((prev) => (prev + 1) % items.length);
    }, 2500);
    return () => clearInterval(interval);
  }, [items.length]);

  const activeItem = items[activeIndex];

  return (
    <div className="mb-6 relative overflow-hidden rounded-xl border border-[rgba(99,102,241,0.3)] animate-[glow-pulse_2s_ease-in-out_infinite]"
      style={{ background: 'radial-gradient(ellipse at 30% 50%, rgba(99,102,241,0.10) 0%, rgba(99,102,241,0.03) 70%, transparent 100%)' }}
    >
      <div className="px-5 py-4 flex items-center gap-4">
        {/* Rotating logo area */}
        <div className="relative w-12 h-12 shrink-0">
          {items.map((item, i) => (
            <div
              key={item.key}
              className="absolute inset-0 flex flex-col items-center justify-center rounded-lg transition-opacity duration-400 ease-in-out"
              style={{
                opacity: i === activeIndex ? 1 : 0,
                background: `${item.color}15`,
                border: `1px solid ${item.color}30`,
              }}
            >
              <span className="flex items-center justify-center" style={{ width: 20, height: 20 }}>
                {item.icon}
              </span>
              <span className="text-[8px] font-bold mt-0.5 leading-none" style={{ color: item.color }}>
                {item.label}
              </span>
            </div>
          ))}
        </div>

        {/* Text */}
        <div className="min-w-0">
          <p className="text-sm font-medium text-[var(--text-primary)]">{title}</p>
          <p className="text-xs text-[var(--text-secondary)] mt-0.5">{subtitle}</p>
        </div>
      </div>

      {/* Shimmer bar */}
      <div
        className="h-[3px] w-full animate-[shimmer_2s_linear_infinite]"
        style={{
          background: 'linear-gradient(90deg, transparent, rgba(99,102,241,0.5), rgba(168,85,247,0.5), transparent)',
          backgroundSize: '200% 100%',
        }}
      />

      {/* Inline keyframes */}
      <style jsx>{`
        @keyframes shimmer {
          0% { background-position: -200% 0; }
          100% { background-position: 200% 0; }
        }
        @keyframes glow-pulse {
          0%, 100% { box-shadow: 0 0 20px rgba(99,102,241,0.12), 0 0 6px rgba(99,102,241,0.06); }
          50% { box-shadow: 0 0 30px rgba(99,102,241,0.22), 0 0 12px rgba(99,102,241,0.10); }
        }
      `}</style>
    </div>
  );
});

export default ProgressBanner;
