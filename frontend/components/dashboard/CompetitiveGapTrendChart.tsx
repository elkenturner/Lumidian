'use client';

import { useState } from 'react';
import {
  CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import type { CompetitiveGapResponse } from '@/lib/api';

const COMPETITOR_COLORS = [
  '#7c8aaa', '#8a7ca5', '#7ca58a', '#a5917c',
  '#7c9ba5', '#a57c8a', '#9a9a7c', '#7c88a5',
];

interface Props {
  data: CompetitiveGapResponse;
}

/**
 * Combined visibility chart: brand line bold (accent), each competitor's line
 * dashed in a muted color. Click a legend entry to toggle that line on/off.
 */
export function CompetitiveGapTrendChart({ data }: Props) {
  const [hidden, setHidden] = useState<Set<string>>(new Set());

  // Build chart-ready rows: { date, you, [competitorName]: pct }
  const competitorTrendByDate = new Map<string, Record<string, number>>();
  for (const comp of data.competitors) {
    if (!comp.has_data) continue;
    for (const point of comp.trend) {
      const row = competitorTrendByDate.get(point.date) ?? {};
      const brandPctOnDay = data.trend.find((t) => t.date === point.date)?.brand_pct;
      if (brandPctOnDay === undefined) continue;
      row[comp.name] = brandPctOnDay - point.gap_pp;
      competitorTrendByDate.set(point.date, row);
    }
  }

  const chartData = data.trend.map((t) => ({
    date: t.date,
    you: t.brand_pct,
    ...(competitorTrendByDate.get(t.date) ?? {}),
  }));

  if (chartData.length < 2) {
    return (
      <div className="flex items-center justify-center py-12 text-xs text-[var(--text-faint)]">
        Trend appears once you have at least 2 days of data.
      </div>
    );
  }

  const toggle = (name: string) => {
    setHidden((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  return (
    <div className="w-full" style={{ height: 240 }}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={chartData}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--bg-tinted)" />
          <XAxis dataKey="date" tick={{ fontSize: 10, fill: 'var(--text-faint)' }} />
          <YAxis
            unit="%"
            tick={{ fontSize: 10, fill: 'var(--text-faint)' }}
            domain={[0, 100]}
          />
          <Tooltip
            contentStyle={{
              background: 'var(--bg-elevated)',
              border: '1px solid var(--border-faint)',
              borderRadius: 6,
              fontSize: 11,
            }}
          />
          <Legend
            wrapperStyle={{ fontSize: 10, paddingTop: 4 }}
            onClick={(e) => toggle(String(e.dataKey))}
          />
          {!hidden.has('you') && (
            <Line
              type="monotone"
              dataKey="you"
              stroke="var(--accent)"
              strokeWidth={2}
              dot={false}
              name="You"
            />
          )}
          {data.competitors.map((c, i) => {
            if (!c.has_data || hidden.has(c.name)) return null;
            return (
              <Line
                key={c.competitor_id}
                type="monotone"
                dataKey={c.name}
                stroke={COMPETITOR_COLORS[i % COMPETITOR_COLORS.length]}
                strokeDasharray="4 3"
                strokeWidth={1}
                dot={false}
                name={c.name}
              />
            );
          })}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
