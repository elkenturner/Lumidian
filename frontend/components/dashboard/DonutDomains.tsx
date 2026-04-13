'use client';

import { useState } from 'react';
import { PieChart, Pie, Cell } from 'recharts';
import { DOMAIN_COLORS, formatPct } from './helpers';

interface DonutDomainsProps {
  domains: Array<{ domain: string; pct: number; count: number; domain_type: string }>;
}

export default function DonutDomains({ domains }: DonutDomainsProps) {
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const total = domains.reduce((s, d) => s + d.count, 0);
  const data = domains.map((d) => ({ ...d, value: d.count }));

  const getDomainUrl = (domain: string) => {
    const clean = domain.replace(/^www\./, '');
    return `https://${clean}`;
  };

  return (
    <div className="flex items-center gap-5 flex-1 min-h-0 max-w-full sm:max-w-none">
      {/* Modern Donut */}
      <div className="relative flex-shrink-0" style={{ width: 110, height: 110 }}>
        <PieChart width={110} height={110}>
          <defs>
            {DOMAIN_COLORS.map((c, i) => (
              <linearGradient key={i} id={`domainGrad${i}`} x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor={c.color} stopOpacity={1} />
                <stop offset="100%" stopColor={c.color} stopOpacity={0.7} />
              </linearGradient>
            ))}
            <filter id="domainGlow" x="-50%" y="-50%" width="200%" height="200%">
              <feGaussianBlur stdDeviation="2" result="blur" />
              <feMerge>
                <feMergeNode in="blur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          </defs>
          <Pie
            data={data}
            cx={55}
            cy={55}
            innerRadius={32}
            outerRadius={50}
            cornerRadius={4}
            paddingAngle={4}
            dataKey="value"
            stroke="rgba(0,0,0,0.3)"
            strokeWidth={1}
            startAngle={90}
            endAngle={-270}
            onMouseEnter={(_, i) => setActiveIndex(i)}
            onMouseLeave={() => setActiveIndex(null)}
          >
            {data.map((_, i) => (
              <Cell
                key={i}
                fill={`url(#domainGrad${i % DOMAIN_COLORS.length})`}
                opacity={activeIndex === null || activeIndex === i ? 1 : 0.25}
                style={{ cursor: 'pointer', outline: 'none', transition: 'opacity 0.25s ease-out', filter: activeIndex === i ? 'url(#domainGlow)' : 'none' }}
              />
            ))}
          </Pie>
        </PieChart>
        {/* Center text */}
        <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
          <span className="text-lg font-bold text-[var(--text-primary)] leading-none">{data.length}</span>
          <span className="text-[9px] text-[var(--text-faint)] mt-0.5 uppercase tracking-wider">sources</span>
        </div>
      </div>

      {/* Legend */}
      <div className="flex-1 min-w-0 space-y-0.5">
        {data.map((d, i) => {
          const pct = total > 0 ? (d.count / total) * 100 : 0;
          const { color, glow } = DOMAIN_COLORS[i % DOMAIN_COLORS.length];
          const isActive = activeIndex === i;
          const displayDomain = d.domain.replace(/^www\./, '');
          return (
            <a
              key={d.domain}
              href={getDomainUrl(d.domain)}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2.5 min-w-0 group rounded-lg px-2 py-1.5 -mx-2 transition-[background-color,opacity] duration-200"
              onMouseEnter={() => setActiveIndex(i)}
              onMouseLeave={() => setActiveIndex(null)}
              style={{
                opacity: activeIndex === null || isActive ? 1 : 0.4,
                background: isActive ? 'rgba(255,255,255,0.05)' : 'transparent',
              }}
            >
              <span
                className="w-2 h-2 rounded-full flex-shrink-0 transition-[transform,box-shadow] duration-200"
                style={{
                  background: color,
                  boxShadow: isActive ? `0 0 10px ${glow}, 0 0 4px ${color}` : 'none',
                  transform: isActive ? 'scale(1.3)' : 'scale(1)',
                }}
              />
              <span
                className="text-xs truncate flex-1 min-w-0 transition-colors duration-200"
                style={{ color: isActive ? 'var(--text-primary)' : 'var(--text-secondary)' }}
              >
                {displayDomain}
              </span>
              <span
                className="text-[11px] tabular-nums font-semibold flex-shrink-0 transition-colors duration-200"
                style={{ color: isActive ? color : 'var(--text-faint)' }}
              >
                {formatPct(pct)}
              </span>
            </a>
          );
        })}
      </div>
    </div>
  );
}
