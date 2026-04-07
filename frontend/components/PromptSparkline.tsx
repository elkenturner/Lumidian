'use client';

import { useMemo } from 'react';
import { AreaChart, Area, ResponsiveContainer, Tooltip } from 'recharts';

interface PromptSparklineProps {
  sparkline: number[];
  draftEvents?: { index: number }[];
  height?: number;
}

export default function PromptSparkline({ sparkline, draftEvents = [], height = 64 }: PromptSparklineProps) {
  const data = useMemo(
    () => sparkline.map((value, i) => ({ index: i, score: value })),
    [sparkline],
  );

  if (data.length < 2) {
    return (
      <div style={{ height }} className="flex items-center justify-center text-[10px] text-[var(--text-faint)]">
        Not enough data
      </div>
    );
  }

  return (
    <div style={{ height, width: '100%' }}>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 4, right: 2, bottom: 4, left: 2 }}>
          <defs>
            <linearGradient id="sparkGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--accent)" stopOpacity={0.25} />
              <stop offset="100%" stopColor="var(--accent)" stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <Tooltip
            content={({ active, payload }) => {
              if (!active || !payload?.[0]) return null;
              return (
                <div
                  style={{
                    background: 'rgba(8,12,20,0.96)',
                    backdropFilter: 'blur(20px)',
                    border: '1px solid rgba(99,102,241,0.22)',
                    borderRadius: 8,
                    padding: '6px 10px',
                    boxShadow: '0 8px 32px rgba(0,0,0,0.50)',
                  }}
                >
                  <span className="text-xs font-mono font-bold text-[var(--text-primary)]">
                    {Math.round(payload[0].value as number)}%
                  </span>
                </div>
              );
            }}
          />
          <Area
            type="monotone"
            dataKey="score"
            stroke="var(--accent)"
            strokeWidth={1.5}
            fill="url(#sparkGrad)"
            dot={false}
            isAnimationActive={true}
            animationDuration={800}
          />
          {/* Draft posted markers */}
          {draftEvents.map((evt) => (
            <Area
              key={`marker-${evt.index}`}
              type="monotone"
              dataKey="score"
              stroke="none"
              fill="none"
              dot={(props: Record<string, unknown>) => {
                const idx = props.index as number;
                if (idx !== evt.index) return <circle key={idx} r={0} />;
                return (
                  <circle
                    key={idx}
                    cx={props.cx as number}
                    cy={(props.cy as number) + 20}
                    r={2.5}
                    fill="var(--accent-light)"
                    stroke="var(--accent)"
                    strokeWidth={1}
                  />
                );
              }}
            />
          ))}
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
