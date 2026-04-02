'use client';

import { memo, useState, useMemo } from 'react';
import {
  ComposedChart,
  Area,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceDot,
} from 'recharts';
import { format, parseISO, subDays } from 'date-fns';
import { Activity } from 'lucide-react';
import { TrendPoint } from '@/lib/api';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';

const parseUTCISO = (s: string) => parseISO(s.endsWith('Z') ? s : s + 'Z');

type Timeframe = '7d' | '30d' | '90d' | 'all';

const TIMEFRAME_OPTIONS: { label: string; value: Timeframe }[] = [
  { label: '7d', value: '7d' },
  { label: '30d', value: '30d' },
  { label: '90d', value: '90d' },
  { label: 'All', value: 'all' },
];

const MODEL_LINES: { key: string; label: string; color: string }[] = [
  { key: 'chatgpt',    label: 'ChatGPT',    color: '#10a37f' },
  { key: 'claude',     label: 'Claude',     color: '#d97757' },
  { key: 'perplexity', label: 'Perplexity', color: '#818cf8' },
  { key: 'gemini',     label: 'Gemini',     color: '#4285f4' },
];
const AVG_COLOR = '#818cf8';

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
    <div style={{
      background: 'rgba(8,12,20,0.96)',
      backdropFilter: 'blur(20px)',
      WebkitBackdropFilter: 'blur(20px)',
      border: '1px solid rgba(99,102,241,0.22)',
      borderRadius: 10,
      padding: '10px 14px',
      boxShadow: '0 8px 32px rgba(0,0,0,0.50), 0 0 0 1px rgba(99,102,241,0.06)',
      minWidth: 155,
    }}>
      <p style={{ fontSize: 11, color: '#475569', marginBottom: 8, fontWeight: 500 }}>{label}</p>
      {avg && (
        <p style={{
          fontSize: 14,
          fontWeight: 700,
          marginBottom: 7,
          color: AVG_COLOR,
          fontFamily: 'var(--font-jetbrains, monospace)',
          letterSpacing: '-0.01em',
        }}>
          ⌀ {Math.round(avg.value)}%
        </p>
      )}
      {models.map((m) => {
        const cfg = MODEL_LINES.find((ml) => ml.key === m.dataKey);
        return (
          <div key={m.dataKey} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 20, marginTop: 3 }}>
            <span style={{ fontSize: 11, color: cfg?.color ?? '#94a3b8' }}>{cfg?.label ?? m.dataKey}</span>
            <span style={{ fontSize: 11, fontWeight: 600, color: cfg?.color ?? '#94a3b8', fontFamily: 'var(--font-jetbrains, monospace)' }}>
              {Math.round(m.value)}%
            </span>
          </div>
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

  const activeModels = MODEL_LINES.filter((ml) =>
    chartData.some((pt) => pt[ml.key] != null)
  );

  if (!data || data.length === 0) {
    return (
      <div className="bg-[rgba(99,102,241,0.08)] backdrop-blur-md border border-[rgba(99,102,241,0.20)] rounded-xl p-6"
        style={{ boxShadow: '0 4px 24px rgba(0,0,0,0.30), inset 0 1px 0 rgba(255,255,255,0.055)' }}>
        <h3 className="text-base font-semibold text-[#e2e8f0] mb-4">Visibility Trend</h3>
        <div className="empty-state">
          <div className="empty-state-icon">
            <Activity size={22} />
          </div>
          <p className="empty-state-title">No trend data yet</p>
          <p className="empty-state-body">Run your first report to start tracking visibility over time.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-[rgba(99,102,241,0.08)] backdrop-blur-md border border-[rgba(99,102,241,0.20)] rounded-xl p-6"
      style={{ boxShadow: '0 4px 24px rgba(0,0,0,0.30), inset 0 1px 0 rgba(255,255,255,0.055)' }}>
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-base font-semibold text-[#e2e8f0]">Visibility Trend</h3>
        <Tabs value={timeframe} onValueChange={(v) => setTimeframe(v as Timeframe)}>
          <TabsList className="bg-[rgba(255,255,255,0.04)] border border-[rgba(99,102,241,0.12)] rounded-lg p-0.5 h-auto gap-0 border-b-0">
            {TIMEFRAME_OPTIONS.map(({ label, value }) => (
              <TabsTrigger
                key={value}
                value={value}
                className="px-2.5 py-1 rounded-md text-xs font-medium h-auto border-b-0 data-[state=active]:bg-[rgba(99,102,241,0.25)] data-[state=active]:text-[#818cf8] data-[state=active]:border-transparent data-[state=inactive]:text-[#475569]"
              >
                {label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      </div>

      {/* Legend — clickable to toggle lines */}
      {activeModels.length > 0 && (
        <div className="flex items-center gap-4 mb-4 flex-wrap">
          <div className="flex items-center gap-1.5 text-xs">
            <span className="w-5 h-0.5 rounded-full inline-block" style={{ background: AVG_COLOR }} />
            <span className="text-[#818cf8] font-medium">Average</span>
          </div>
          {activeModels.map((ml) => (
            <button
              key={ml.key}
              onClick={() => toggleModel(ml.key)}
              className="flex items-center gap-1.5 text-xs transition-opacity cursor-pointer"
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
          <ComposedChart data={chartData} margin={{ top: 5, right: 10, left: -10, bottom: 0 }}>
            <defs>
              <linearGradient id="avgAreaGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%"  stopColor="#818cf8" stopOpacity={0.28} />
                <stop offset="95%" stopColor="#818cf8" stopOpacity={0} />
              </linearGradient>
              <filter id="lineGlow" x="-20%" y="-20%" width="140%" height="140%">
                <feGaussianBlur stdDeviation="2.5" result="blur" />
                <feMerge>
                  <feMergeNode in="blur" />
                  <feMergeNode in="SourceGraphic" />
                </feMerge>
              </filter>
            </defs>

            <CartesianGrid strokeDasharray="3 3" stroke="rgba(99,102,241,0.07)" vertical={false} />
            <XAxis
              dataKey="shortDate"
              tick={{ fill: '#475569', fontSize: 11 }}
              axisLine={{ stroke: 'rgba(99,102,241,0.10)' }}
              tickLine={false}
            />
            <YAxis
              domain={[0, (dataMax: number) => dataMax < 20 ? 25 : 100]}
              tick={{ fill: '#475569', fontSize: 11 }}
              axisLine={false}
              tickLine={false}
              tickFormatter={(v) => `${v}%`}
            />
            <Tooltip
              content={<CustomTooltip />}
              cursor={{ stroke: 'rgba(99,102,241,0.20)', strokeWidth: 1 }}
            />

            {/* Average line with gradient area fill */}
            <Area
              type="monotone"
              dataKey="score"
              name="Average"
              stroke={AVG_COLOR}
              strokeWidth={2.5}
              fill="url(#avgAreaGradient)"
              fillOpacity={1}
              dot={false}
              activeDot={{ fill: '#818cf8', r: 5, strokeWidth: 2, stroke: 'rgba(129,140,248,0.30)' }}
              isAnimationActive={true}
              animationDuration={1200}
              animationEasing="ease-out"
              filter="url(#lineGlow)"
            />

            {/* Endpoint pulse dot on average line */}
            {chartData.length > 0 && (() => {
              const last = chartData[chartData.length - 1];
              return (
                <ReferenceDot
                  x={last.shortDate}
                  y={last.score}
                  r={5}
                  fill="#818cf8"
                  stroke="rgba(129,140,248,0.30)"
                  strokeWidth={6}
                />
              );
            })()}

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
                dot={chartData.length === 1 ? { fill: ml.color, r: 4, strokeWidth: 0 } : false}
                activeDot={{ fill: ml.color, r: 4, strokeWidth: 0 }}
                hide={hiddenModels.has(ml.key)}
                connectNulls
                isAnimationActive={true}
                animationDuration={1400}
                animationEasing="ease-out"
              />
            ))}
          </ComposedChart>
        </ResponsiveContainer>
      )}
    </div>
  );
});

export default TrendChart;
