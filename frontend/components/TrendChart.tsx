'use client';

import { memo, useState, useMemo } from 'react';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
} from 'recharts';
import { format, parseISO, subDays } from 'date-fns';
import { TrendPoint } from '@/lib/api';

const parseUTCISO = (s: string) => parseISO(s.endsWith('Z') ? s : s + 'Z');

type Timeframe = '7d' | '30d' | '90d' | 'all';

const TIMEFRAME_OPTIONS: { label: string; value: Timeframe }[] = [
  { label: '7d', value: '7d' },
  { label: '30d', value: '30d' },
  { label: '90d', value: '90d' },
  { label: 'All', value: 'all' },
];

const MODEL_LINES: { key: string; label: string; color: string }[] = [
  { key: 'chatgpt',    label: 'ChatGPT',    color: '#10b981' },
  { key: 'claude',     label: 'Claude',     color: '#f59e0b' },
  { key: 'perplexity', label: 'Perplexity', color: '#a78bfa' },
  { key: 'gemini',     label: 'Gemini',     color: '#60a5fa' },
];
const AVG_COLOR = '#6366f1';

interface TrendChartProps {
  data: TrendPoint[];
}

interface ChartPoint {
  shortDate: string;
  formattedDate: string;
  score: number;
  total_mentions: number;
  total_queries: number;
  [modelKey: string]: string | number;
}

interface TooltipProps {
  active?: boolean;
  payload?: Array<{ dataKey: string; value: number; color: string }>;
  label?: string;
}

function CustomTooltip({ active, payload, label }: TooltipProps) {
  if (!active || !payload?.length) return null;
  const avg = payload.find((p) => p.dataKey === 'score');
  const models = payload.filter((p) => p.dataKey !== 'score' && p.value != null);
  return (
    <div className="bg-[#111118] border border-[#1e1e2e] rounded-lg p-3 shadow-lg min-w-[140px]">
      <p className="text-xs text-[#64748b] mb-2">{label}</p>
      {avg && (
        <p className="text-xs font-bold mb-1.5" style={{ color: AVG_COLOR }}>
          Avg {Math.round(avg.value)}%
        </p>
      )}
      {models.map((m) => {
        const cfg = MODEL_LINES.find((ml) => ml.key === m.dataKey);
        return (
          <p key={m.dataKey} className="text-xs" style={{ color: cfg?.color ?? '#94a3b8' }}>
            {cfg?.label ?? m.dataKey}: {Math.round(m.value)}%
          </p>
        );
      })}
    </div>
  );
}

const TrendChart = memo(function TrendChart({ data }: TrendChartProps) {
  const [timeframe, setTimeframe] = useState<Timeframe>('all');
  const [hiddenModels, setHiddenModels] = useState<Set<string>>(new Set());

  const toggleModel = (key: string) => {
    setHiddenModels((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const chartData: ChartPoint[] = useMemo(() => {
    const all = (data ?? []).map((point) => {
      const pt: ChartPoint = {
        formattedDate: point.completed_at
          ? format(parseUTCISO(point.completed_at), 'MMM d, yyyy')
          : 'Unknown',
        shortDate: point.completed_at
          ? format(parseUTCISO(point.completed_at), 'MMM d')
          : '',
        score: Math.round(point.score),
        total_mentions: point.total_mentions,
        total_queries: point.total_queries,
      };
      for (const ml of MODEL_LINES) {
        const v = point.model_scores?.[ml.key];
        if (v != null) pt[ml.key] = Math.round(v);
      }
      return pt;
    });

    if (timeframe === 'all') return all;
    const days = timeframe === '7d' ? 7 : timeframe === '30d' ? 30 : 90;
    const cutoff = subDays(new Date(), days);
    return all.filter((p) => p.formattedDate !== 'Unknown' &&
      parseUTCISO((data.find((d) => format(parseUTCISO(d.completed_at), 'MMM d, yyyy') === p.formattedDate)?.completed_at ?? '')) >= cutoff
    );
  }, [data, timeframe]);

  // Which model lines actually have data
  const activeModels = MODEL_LINES.filter((ml) =>
    chartData.some((pt) => pt[ml.key] != null)
  );

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
      <div className="flex items-center justify-between mb-4">
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

      {/* Legend — clickable to toggle lines */}
      {activeModels.length > 0 && (
        <div className="flex items-center gap-4 mb-4 flex-wrap">
          <button
            className="flex items-center gap-1.5 text-xs"
            onClick={() => {/* average always shown */}}
          >
            <span className="w-5 h-0.5 rounded-full inline-block" style={{ background: AVG_COLOR }} />
            <span className="text-[#818cf8] font-medium">Average</span>
          </button>
          {activeModels.map((ml) => (
            <button
              key={ml.key}
              onClick={() => toggleModel(ml.key)}
              className="flex items-center gap-1.5 text-xs transition-opacity"
              style={{ opacity: hiddenModels.has(ml.key) ? 0.35 : 1 }}
            >
              <span className="w-5 h-0.5 rounded-full inline-block" style={{ background: ml.color }} />
              <span style={{ color: ml.color }}>{ml.label}</span>
            </button>
          ))}
        </div>
      )}

      {chartData.length === 0 ? (
        <div className="flex items-center justify-center h-[220px] text-[#475569] text-sm">
          No data in this timeframe.
        </div>
      ) : (
        <ResponsiveContainer width="100%" height={240}>
          <LineChart data={chartData} margin={{ top: 5, right: 10, left: -10, bottom: 0 }}>
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

            {/* Average line */}
            <Line
              type="monotone"
              dataKey="score"
              name="Average"
              stroke={AVG_COLOR}
              strokeWidth={2.5}
              dot={false}
              activeDot={{ fill: AVG_COLOR, r: 5, strokeWidth: 2, stroke: 'rgba(99,102,241,0.30)' }}
            />

            {/* Per-model lines */}
            {activeModels.map((ml) => (
              <Line
                key={ml.key}
                type="monotone"
                dataKey={ml.key}
                name={ml.label}
                stroke={ml.color}
                strokeWidth={1.5}
                strokeDasharray="4 2"
                dot={false}
                activeDot={{ fill: ml.color, r: 4, strokeWidth: 0 }}
                hide={hiddenModels.has(ml.key)}
                connectNulls
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      )}
    </div>
  );
});

export default TrendChart;
