'use client';

import { useState, useMemo } from 'react';
import {
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Area,
  AreaChart,
} from 'recharts';
import { format, parseISO, subDays } from 'date-fns';

const parseUTCISO = (s: string) => parseISO(s.endsWith('Z') ? s : s + 'Z');
import { TrendPoint } from '@/lib/api';

type Timeframe = '7d' | '30d' | '90d' | 'all';

const TIMEFRAME_OPTIONS: { label: string; value: Timeframe }[] = [
  { label: '7d', value: '7d' },
  { label: '30d', value: '30d' },
  { label: '90d', value: '90d' },
  { label: 'All', value: 'all' },
];

interface TrendChartProps {
  data: TrendPoint[];
}

interface TooltipPayloadItem {
  payload: TrendPoint & { formattedDate: string };
  value: number;
}

interface CustomTooltipProps {
  active?: boolean;
  payload?: TooltipPayloadItem[];
  label?: string;
}

function CustomTooltip({ active, payload }: CustomTooltipProps) {
  if (!active || !payload || payload.length === 0) return null;
  const d = payload[0].payload;
  return (
    <div className="bg-[#111118] border border-[#1e1e2e] rounded-lg p-3 shadow-lg">
      <p className="text-xs text-[#64748b] mb-1">{d.formattedDate}</p>
      <p className="text-sm font-bold text-[#818cf8]">{Math.round(d.score)}% visibility</p>
      <p className="text-xs text-[#64748b] mt-1">
        {d.total_mentions} / {d.total_queries} mentions
      </p>
    </div>
  );
}

export default function TrendChart({ data }: TrendChartProps) {
  const [timeframe, setTimeframe] = useState<Timeframe>('all');

  const chartData = useMemo(() => {
    const all = (data ?? []).map((point) => ({
      ...point,
      formattedDate: point.completed_at
        ? format(parseUTCISO(point.completed_at), 'MMM d, yyyy')
        : 'Unknown',
      shortDate: point.completed_at
        ? format(parseUTCISO(point.completed_at), 'MMM d')
        : '',
      score: Math.round(point.score),
    }));

    if (timeframe === 'all') return all;
    const days = timeframe === '7d' ? 7 : timeframe === '30d' ? 30 : 90;
    const cutoff = subDays(new Date(), days);
    return all.filter((p) => p.completed_at && parseUTCISO(p.completed_at) >= cutoff);
  }, [data, timeframe]);

  if (!data || data.length === 0) {
    return (
      <div className="bg-[rgba(99,102,241,0.06)] backdrop-blur-md border border-[rgba(99,102,241,0.15)] rounded-xl p-6 shadow-[0_4px_24px_rgba(0,0,0,0.30),inset_0_1px_0_rgba(255,255,255,0.06)]">
        <h3 className="text-base font-semibold text-[#e2e8f0] mb-4">Visibility Trend</h3>
        <div className="flex items-center justify-center h-48 text-[#64748b] text-sm">
          No trend data available yet. Run a report to start tracking.
        </div>
      </div>
    );
  }

  return (
    <div className="bg-[rgba(99,102,241,0.06)] backdrop-blur-md border border-[rgba(99,102,241,0.15)] rounded-xl p-6 shadow-[0_4px_24px_rgba(0,0,0,0.30),inset_0_1px_0_rgba(255,255,255,0.06)]">
      <div className="flex items-center justify-between mb-6">
        <h3 className="text-base font-semibold text-[#e2e8f0]">Visibility Trend</h3>
        <div className="flex items-center gap-1 bg-[rgba(255,255,255,0.04)] border border-[rgba(99,102,241,0.12)] rounded-lg p-0.5">
          {TIMEFRAME_OPTIONS.map(({ label, value }) => (
            <button
              key={value}
              onClick={() => setTimeframe(value)}
              className={`px-2.5 py-1 rounded-md text-xs font-medium transition-all ${
                timeframe === value
                  ? 'bg-[rgba(99,102,241,0.25)] text-[#818cf8] shadow-sm'
                  : 'text-[#475569] hover:text-[#94A3B8]'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {chartData.length === 0 ? (
        <div className="flex items-center justify-center h-[220px] text-[#475569] text-sm">
          No data in this timeframe.
        </div>
      ) : (
        <ResponsiveContainer width="100%" height={220}>
          <AreaChart data={chartData} margin={{ top: 5, right: 10, left: -10, bottom: 0 }}>
            <defs>
              <linearGradient id="scoreGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#6366f1" stopOpacity={0.3} />
                <stop offset="95%" stopColor="#6366f1" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(99,102,241,0.10)" vertical={false} />
            <XAxis
              dataKey="shortDate"
              tick={{ fill: '#475569', fontSize: 11 }}
              axisLine={{ stroke: 'rgba(99,102,241,0.10)' }}
              tickLine={false}
            />
            <YAxis
              domain={[0, 100]}
              tick={{ fill: '#475569', fontSize: 11 }}
              axisLine={false}
              tickLine={false}
              tickFormatter={(v) => `${v}%`}
            />
            <Tooltip content={<CustomTooltip />} cursor={{ stroke: 'rgba(99,102,241,0.20)', strokeWidth: 1 }} />
            <Area
              type="monotone"
              dataKey="score"
              stroke="#6366f1"
              strokeWidth={2.5}
              fill="url(#scoreGradient)"
              dot={{ fill: '#6366f1', strokeWidth: 0, r: 4 }}
              activeDot={{ fill: '#818cf8', r: 6, strokeWidth: 2, stroke: 'rgba(99,102,241,0.20)' }}
            />
          </AreaChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}
