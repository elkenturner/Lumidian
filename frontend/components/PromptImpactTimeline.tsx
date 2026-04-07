'use client';

import { useState, useMemo } from 'react';
import {
  ComposedChart,
  Area,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceLine,
  ResponsiveContainer,
} from 'recharts';
import { format } from 'date-fns';
import { MODEL_ORDER, getModelConfig } from '@/lib/constants/models';
import { parseUTCISO } from '@/lib/utils/formatting';
import type { PromptTimelinePoint, ContentEventItem } from '@/lib/api';

interface PromptImpactTimelineProps {
  timeline: PromptTimelinePoint[];
  contentEvents: ContentEventItem[];
  height?: number;
}

type Timeframe = '7d' | '30d' | '90d' | 'all';

export default function PromptImpactTimeline({
  timeline,
  contentEvents,
  height = 320,
}: PromptImpactTimelineProps) {
  const [timeframe, setTimeframe] = useState<Timeframe>('90d');
  const [hiddenModels, setHiddenModels] = useState<Set<string>>(new Set());

  const filteredData = useMemo(() => {
    const now = Date.now();
    const cutoffs: Record<Timeframe, number> = {
      '7d': now - 7 * 86400000,
      '30d': now - 30 * 86400000,
      '90d': now - 90 * 86400000,
      all: 0,
    };
    const cutoff = cutoffs[timeframe];

    return timeline
      .filter((t) => {
        if (!t.completed_at) return true;
        return parseUTCISO(t.completed_at).getTime() >= cutoff;
      })
      .map((t) => ({
        ...t,
        date: t.completed_at ? format(parseUTCISO(t.completed_at), 'MMM d') : '',
        ...Object.fromEntries(
          MODEL_ORDER.map((m) => [m, t.scores[m] ?? null]),
        ),
      }));
  }, [timeline, timeframe]);

  // Map content events to nearest timeline index for ReferenceLine
  const draftMarkers = useMemo(() => {
    return contentEvents
      .filter((e) => e.event_type === 'draft_posted')
      .map((e) => {
        const eventTime = parseUTCISO(e.created_at).getTime();
        let closestIdx = 0;
        let closestDist = Infinity;
        filteredData.forEach((d, i) => {
          if (!d.completed_at) return;
          const dist = Math.abs(parseUTCISO(d.completed_at).getTime() - eventTime);
          if (dist < closestDist) {
            closestDist = dist;
            closestIdx = i;
          }
        });
        return {
          ...e,
          dataIndex: closestIdx,
          label: (e.data as Record<string, unknown>)?.platform as string || 'Draft',
        };
      });
  }, [contentEvents, filteredData]);

  const toggleModel = (model: string) => {
    setHiddenModels((prev) => {
      const next = new Set(prev);
      if (next.has(model)) next.delete(model);
      else next.add(model);
      return next;
    });
  };

  if (filteredData.length < 2) {
    return (
      <div className="card" style={{ padding: '28px 20px 24px' }}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-[15px] font-medium text-[var(--text-primary)]">Impact Timeline</h3>
        </div>
        <div className="flex items-center justify-center h-48 text-sm text-[var(--text-faint)]">
          Not enough tracking data yet
        </div>
      </div>
    );
  }

  return (
    <div
      className="card overflow-hidden"
      style={{
        padding: '28px 20px 24px',
        borderTop: '2px solid transparent',
        borderImage: 'linear-gradient(90deg, var(--color-chatgpt), var(--color-claude), var(--color-perplexity), var(--color-gemini)) 1',
        borderImageSlice: 1,
      }}
    >
      {/* Header */}
      <div className="flex items-center justify-between mb-5">
        <h3 className="text-[15px] font-medium text-[var(--text-primary)]">Impact Timeline</h3>
        <div className="flex items-center gap-0.5 bg-[rgba(255,255,255,0.04)] border border-[var(--border-subtle)] rounded-lg p-0.5">
          {(['7d', '30d', '90d', 'all'] as Timeframe[]).map((tf) => (
            <button
              key={tf}
              onClick={() => setTimeframe(tf)}
              className={`px-2.5 py-1 rounded-md text-[10px] font-medium transition-all ${
                timeframe === tf
                  ? 'bg-[rgba(99,102,241,0.25)] text-[var(--accent-light)]'
                  : 'text-[var(--text-faint)] hover:text-[var(--text-secondary)]'
              }`}
            >
              {tf === 'all' ? 'All' : tf}
            </button>
          ))}
        </div>
      </div>

      {/* Chart */}
      <div
        style={{
          background: 'radial-gradient(ellipse at 50% 100%, rgba(99,102,241,0.04) 0%, transparent 70%)',
        }}
      >
        <ResponsiveContainer width="100%" height={height}>
          <ComposedChart data={filteredData} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
            <defs>
              <linearGradient id="overallGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--accent)" stopOpacity={0.2} />
                <stop offset="100%" stopColor="var(--accent)" stopOpacity={0.01} />
              </linearGradient>
            </defs>
            <CartesianGrid stroke="rgba(99,102,241,0.05)" strokeDasharray="3 3" />
            <XAxis
              dataKey="date"
              tick={{ fill: 'var(--text-faint)', fontSize: 10 }}
              axisLine={{ stroke: 'rgba(99,102,241,0.1)' }}
              tickLine={false}
            />
            <YAxis
              domain={[0, 100]}
              tick={{ fill: 'var(--text-faint)', fontSize: 10 }}
              axisLine={{ stroke: 'rgba(99,102,241,0.1)' }}
              tickLine={false}
              tickFormatter={(v) => `${v}%`}
            />
            <Tooltip
              content={({ active, payload, label }) => {
                if (!active || !payload?.length) return null;
                return (
                  <div
                    style={{
                      background: 'rgba(8,12,20,0.96)',
                      backdropFilter: 'blur(20px)',
                      border: '1px solid rgba(99,102,241,0.22)',
                      borderRadius: 10,
                      padding: '10px 14px',
                      boxShadow: '0 8px 32px rgba(0,0,0,0.50)',
                    }}
                  >
                    <p className="text-[11px] text-[var(--text-muted)] mb-1.5">{label}</p>
                    {payload.map((p) => (
                      <div key={p.dataKey as string} className="flex items-center gap-2 text-xs">
                        <span className="w-2 h-2 rounded-full" style={{ background: p.color }} />
                        <span className="text-[var(--text-secondary)]">
                          {p.dataKey === 'overall' ? 'Overall' : getModelConfig(p.dataKey as string).label}
                        </span>
                        <span className="font-mono font-bold text-[var(--text-primary)] ml-auto">
                          {Math.round(p.value as number)}%
                        </span>
                      </div>
                    ))}
                  </div>
                );
              }}
            />

            {/* Draft posted markers */}
            {draftMarkers.map((marker) => (
              <ReferenceLine
                key={marker.id}
                x={filteredData[marker.dataIndex]?.date}
                stroke="var(--accent-light)"
                strokeDasharray="3 3"
                strokeOpacity={0.6}
                label={{
                  value: '\u25C6',
                  position: 'top',
                  fill: 'var(--accent-light)',
                  fontSize: 10,
                }}
              />
            ))}

            {/* Overall area */}
            <Area
              type="monotone"
              dataKey="overall"
              stroke="var(--accent)"
              strokeWidth={2}
              fill="url(#overallGrad)"
              dot={false}
              isAnimationActive={true}
              animationDuration={1200}
            />

            {/* Per-model dashed lines */}
            {MODEL_ORDER.filter((m) => !hiddenModels.has(m)).map((modelKey) => {
              const cfg = getModelConfig(modelKey);
              return (
                <Line
                  key={modelKey}
                  type="monotone"
                  dataKey={modelKey}
                  stroke={cfg.color}
                  strokeWidth={1.5}
                  strokeDasharray="4 2"
                  dot={false}
                  connectNulls
                  isAnimationActive={true}
                  animationDuration={1400}
                />
              );
            })}
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      {/* Legend */}
      <div className="flex flex-wrap items-center gap-3 mt-3 px-1">
        <div className="flex items-center gap-1.5 text-[11px] text-[var(--text-muted)]">
          <span className="w-4 h-0.5 bg-[var(--accent)] rounded" />
          Overall
        </div>
        {MODEL_ORDER.map((modelKey) => {
          const cfg = getModelConfig(modelKey);
          const isHidden = hiddenModels.has(modelKey);
          return (
            <button
              key={modelKey}
              onClick={() => toggleModel(modelKey)}
              className={`flex items-center gap-1.5 text-[11px] transition-opacity ${
                isHidden ? 'opacity-30' : 'opacity-100'
              }`}
              style={{ color: cfg.color }}
            >
              <span
                className="w-4 h-0.5 rounded"
                style={{
                  background: cfg.color,
                  borderTop: '1px dashed',
                  borderColor: cfg.color,
                }}
              />
              {cfg.label}
            </button>
          );
        })}
        <div className="flex items-center gap-1.5 text-[11px] text-[var(--accent-light)]">
          <span style={{ fontSize: 10 }}>{'\u25C6'}</span>
          Draft posted
        </div>
      </div>
    </div>
  );
}
