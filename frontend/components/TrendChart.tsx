'use client';

import {
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Area,
  AreaChart,
} from 'recharts';
import { format, parseISO } from 'date-fns';

const parseUTCISO = (s: string) => parseISO(s.endsWith('Z') ? s : s + 'Z');
import { TrendPoint } from '@/lib/api';

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
  if (!data || data.length === 0) {
    return (
      <div className="bg-[#111118] border border-[#1e1e2e] rounded-xl p-6">
        <h3 className="text-base font-semibold text-[#e2e8f0] mb-4">Visibility Trend</h3>
        <div className="flex items-center justify-center h-48 text-[#64748b] text-sm">
          No trend data available yet. Run a report to start tracking.
        </div>
      </div>
    );
  }

  const chartData = data.map((point) => ({
    ...point,
    formattedDate: point.completed_at
      ? format(parseUTCISO(point.completed_at), 'MMM d, yyyy')
      : 'Unknown',
    shortDate: point.completed_at
      ? format(parseUTCISO(point.completed_at), 'MMM d')
      : '',
    score: Math.round(point.score),
  }));

  return (
    <div className="bg-[#111118] border border-[#1e1e2e] rounded-xl p-6">
      <div className="flex items-center justify-between mb-6">
        <h3 className="text-base font-semibold text-[#e2e8f0]">Visibility Trend</h3>
        <span className="text-xs text-[#64748b] bg-[#1a1a24] border border-[#2a2a3a] px-2.5 py-1 rounded-full">
          {data.length} run{data.length !== 1 ? 's' : ''}
        </span>
      </div>
      <ResponsiveContainer width="100%" height={220}>
        <AreaChart data={chartData} margin={{ top: 5, right: 10, left: -10, bottom: 0 }}>
          <defs>
            <linearGradient id="scoreGradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#6366f1" stopOpacity={0.3} />
              <stop offset="95%" stopColor="#6366f1" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="#1e1e2e" vertical={false} />
          <XAxis
            dataKey="shortDate"
            tick={{ fill: '#475569', fontSize: 11 }}
            axisLine={{ stroke: '#1e1e2e' }}
            tickLine={false}
          />
          <YAxis
            domain={[0, 100]}
            tick={{ fill: '#475569', fontSize: 11 }}
            axisLine={false}
            tickLine={false}
            tickFormatter={(v) => `${v}%`}
          />
          <Tooltip content={<CustomTooltip />} cursor={{ stroke: '#2a2a3a', strokeWidth: 1 }} />
          <Area
            type="monotone"
            dataKey="score"
            stroke="#6366f1"
            strokeWidth={2.5}
            fill="url(#scoreGradient)"
            dot={{ fill: '#6366f1', strokeWidth: 0, r: 4 }}
            activeDot={{ fill: '#818cf8', r: 6, strokeWidth: 2, stroke: '#111118' }}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
