'use client';

import { useState, useMemo, useCallback, useEffect } from 'react';
import {
  ComposedChart,
  Area,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Customized,
} from 'recharts';
import { format } from 'date-fns';
import { ChevronDown, X } from 'lucide-react';
import { MODEL_ORDER, getModelConfig } from '@/lib/constants/models';
import { parseUTCISO } from '@/lib/utils/formatting';
import type { PromptTimelinePoint, ContentEventItem, PromptDraftSnapshot } from '@/lib/api';

interface DraftMarkerInfo {
  draftId: number;
  platform: string;
}

interface ExpandedDraftData {
  drafts: PromptDraftSnapshot[];
}

interface PromptImpactTimelineProps {
  timeline: PromptTimelinePoint[];
  contentEvents: ContentEventItem[];
  drafts?: PromptDraftSnapshot[];
  height?: number;
  highlightDraftId?: number;
}

type Timeframe = '7d' | '30d' | '90d' | 'all';

export default function PromptImpactTimeline({
  timeline,
  contentEvents,
  drafts = [],
  height = 320,
  highlightDraftId,
}: PromptImpactTimelineProps) {
  const [timeframe, setTimeframe] = useState<Timeframe>('90d');
  const [hiddenModels, setHiddenModels] = useState<Set<string>>(new Set());
  const [expandedDraft, setExpandedDraft] = useState<ExpandedDraftData | null>(null);
  const [pulsingIndex, setPulsingIndex] = useState<number | null>(null);

  // Map draft_id to draft data for click expansion
  const draftsById = useMemo(() => {
    const map = new Map<number, PromptDraftSnapshot>();
    drafts.filter((d) => d.status === 'posted').forEach((d) => map.set(d.id, d));
    return map;
  }, [drafts]);

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

  // If the highlighted draft's event lies outside the current timeframe, switch to 'all'.
  useEffect(() => {
    if (highlightDraftId == null) return;
    const event = contentEvents.find(
      (e) =>
        e.event_type === 'draft_posted' &&
        (e.data as Record<string, unknown>)?.draft_id === highlightDraftId,
    );
    if (!event) return;
    const eventTime = parseUTCISO(event.created_at).getTime();
    const cutoffs: Record<Timeframe, number> = {
      '7d': Date.now() - 7 * 86400000,
      '30d': Date.now() - 30 * 86400000,
      '90d': Date.now() - 90 * 86400000,
      all: 0,
    };
    if (eventTime < cutoffs[timeframe]) {
      setTimeframe('all');
    }
  }, [highlightDraftId, contentEvents, timeframe]);

  // Build marker index: map data index → array of drafts (supports multiple per day)
  const markersByIndex = useMemo(() => {
    const map = new Map<number, DraftMarkerInfo[]>();
    contentEvents
      .filter((e) => e.event_type === 'draft_posted')
      .forEach((e) => {
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
        const eventData = e.data as Record<string, unknown>;
        const platform = (eventData?.platform as string) || 'Draft';
        const draftId = (eventData?.draft_id as number) || 0;
        const existing = map.get(closestIdx) || [];
        existing.push({ draftId, platform });
        map.set(closestIdx, existing);
      });
    return map;
  }, [contentEvents, filteredData]);

  const hasMarkers = markersByIndex.size > 0;

  // Handle diamond click — find matching drafts and show expansion panel
  const handleMarkerClick = useCallback((dataIndex: number) => {
    const markers = markersByIndex.get(dataIndex);
    if (!markers) return;
    const matchedDrafts = markers
      .map((m) => draftsById.get(m.draftId))
      .filter((d): d is PromptDraftSnapshot => d != null);
    if (matchedDrafts.length === 0) return;
    setExpandedDraft((prev) =>
      prev && prev.drafts[0]?.id === matchedDrafts[0]?.id ? null : { drafts: matchedDrafts },
    );
  }, [markersByIndex, draftsById]);

  // Deep-link: auto-expand panel + one-shot pulse on the matching diamond
  useEffect(() => {
    if (highlightDraftId == null) return;
    let targetIndex: number | null = null;
    markersByIndex.forEach((markers, idx) => {
      if (markers.some((m) => m.draftId === highlightDraftId)) {
        targetIndex = idx;
      }
    });
    if (targetIndex == null) return;

    handleMarkerClick(targetIndex);
    setPulsingIndex(targetIndex);
    const timer = setTimeout(() => setPulsingIndex(null), 1400);
    return () => clearTimeout(timer);
  }, [highlightDraftId, markersByIndex, handleMarkerClick]);

  // Custom renderer that draws diamonds pinned to the top of the chart
  // Uses Recharts internal xAxisMap/yAxisMap props passed to Customized components
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const DraftMarkerLayer = useCallback((props: any) => {
    const { xAxisMap, yAxisMap } = props;
    if (!xAxisMap || !yAxisMap || !hasMarkers) return null;

    const xAxis = Object.values(xAxisMap)[0] as Record<string, unknown>;
    const yAxis = Object.values(yAxisMap)[0] as Record<string, unknown>;
    if (!xAxis || !yAxis) return null;

    const axisX = (xAxis.x as number) ?? 0;
    const axisWidth = (xAxis.width as number) ?? 0;
    const axisY = (yAxis.y as number) ?? 0;
    const axisHeight = (yAxis.height as number) ?? 0;
    const dataLen = filteredData.length;
    if (dataLen === 0) return null;

    return (
      <g>
        {Array.from(markersByIndex.entries()).map(([idx, markers]) => {
          const cx = dataLen === 1
            ? axisX + axisWidth / 2
            : axisX + (idx / (dataLen - 1)) * axisWidth;
          const diamondY = axisY + 6;
          const bottomY = axisY + axisHeight;
          const size = 7;
          const count = markers.length;
          const label = count > 1
            ? `${count} posts`
            : markers[0].platform;

          return (
            <g
              key={idx}
              style={{ cursor: 'pointer' }}
              onClick={() => handleMarkerClick(idx)}
            >
              {/* Hit area */}
              <rect
                x={cx - 20}
                y={diamondY - 20}
                width={40}
                height={40}
                fill="transparent"
              />
              {/* Dashed line from diamond down to baseline */}
              <line
                x1={cx}
                y1={diamondY + size + 2}
                x2={cx}
                y2={bottomY}
                stroke="var(--accent-light)"
                strokeWidth={1}
                strokeDasharray="4 3"
                strokeOpacity={0.4}
              />
              {/* One-shot pulse ring for deep-linked draft */}
              {idx === pulsingIndex && (
                <circle
                  cx={cx}
                  cy={diamondY}
                  r={8}
                  fill="none"
                  stroke="var(--accent)"
                  strokeWidth={2}
                  opacity={0.9}
                  style={{
                    transformOrigin: `${cx}px ${diamondY}px`,
                    animation: 'diamond-pulse 1.2s cubic-bezier(0.22, 1, 0.36, 1) forwards',
                  }}
                />
              )}
              {/* Diamond */}
              <polygon
                points={`${cx},${diamondY - size} ${cx + size},${diamondY} ${cx},${diamondY + size} ${cx - size},${diamondY}`}
                fill="var(--accent-light)"
                stroke="rgba(255,255,255,0.8)"
                strokeWidth={1.2}
                style={{ filter: 'drop-shadow(0 0 4px var(--accent))' }}
              />
              {/* Count badge for multiple posts */}
              {count > 1 && (
                <>
                  <circle cx={cx + size + 4} cy={diamondY - size + 1} r={6} fill="var(--accent)" />
                  <text
                    x={cx + size + 4}
                    y={diamondY - size + 4.5}
                    textAnchor="middle"
                    fill="white"
                    fontSize={8}
                    fontWeight={700}
                  >
                    {count}
                  </text>
                </>
              )}
              {/* Platform label below diamond */}
              <text
                x={cx}
                y={diamondY + size + 14}
                textAnchor="middle"
                fill="var(--accent-light)"
                fontSize={9}
                fontWeight={500}
                opacity={0.8}
              >
                {label}
              </text>
            </g>
          );
        })}
      </g>
    );
  }, [filteredData, markersByIndex, hasMarkers, handleMarkerClick, pulsingIndex]);

  const toggleModel = (model: string) => {
    setHiddenModels((prev) => {
      const next = new Set(prev);
      if (next.has(model)) next.delete(model);
      else next.add(model);
      return next;
    });
  };

  if (filteredData.length === 0) {
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
              className={`px-2.5 py-1 rounded-md text-[10px] font-medium transition-[color,background-color] ${
                timeframe === tf
                  ? 'bg-[rgba(95,126,166,0.25)] text-[var(--accent-light)]'
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
          background: 'radial-gradient(ellipse at 50% 100%, rgba(95,126,166,0.04) 0%, transparent 70%)',
        }}
      >
        <ResponsiveContainer width="100%" height={height}>
          <ComposedChart data={filteredData} margin={{ top: 24, right: 10, left: -10, bottom: 0 }}>
            <defs>
              <linearGradient id="overallGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--accent)" stopOpacity={0.2} />
                <stop offset="100%" stopColor="var(--accent)" stopOpacity={0.01} />
              </linearGradient>
            </defs>
            <CartesianGrid stroke="rgba(95,126,166,0.05)" strokeDasharray="3 3" />
            <XAxis
              dataKey="date"
              tick={{ fill: 'var(--text-faint)', fontSize: 10 }}
              axisLine={{ stroke: 'rgba(95,126,166,0.1)' }}
              tickLine={false}
            />
            <YAxis
              domain={[0, 100]}
              tick={{ fill: 'var(--text-faint)', fontSize: 10 }}
              axisLine={{ stroke: 'rgba(95,126,166,0.1)' }}
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
                      border: '1px solid rgba(95,126,166,0.22)',
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

            {/* Draft posted markers — diamonds pinned to top */}
            <Customized component={DraftMarkerLayer} />

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

      {/* Expanded draft panel — appears below chart when a marker is clicked */}
      {expandedDraft && (
        <div
          className="mt-3 rounded-lg border border-[var(--border-subtle)] overflow-hidden"
          style={{ background: 'rgba(95,126,166,0.04)' }}
        >
          <div className="flex items-center justify-between px-4 py-2.5 border-b border-[var(--border-subtle)]">
            <span className="text-[11px] font-semibold text-[var(--accent-light)]">
              {expandedDraft.drafts.length === 1 ? 'Posted Draft' : `${expandedDraft.drafts.length} Posted Drafts`}
            </span>
            <button
              onClick={() => setExpandedDraft(null)}
              className="text-[var(--text-faint)] hover:text-[var(--text-secondary)] transition-colors"
            >
              <X size={14} />
            </button>
          </div>
          <div className="flex flex-col">
            {expandedDraft.drafts.map((draft, i) => (
              <DraftExpansionRow key={draft.id} draft={draft} showBorder={i > 0} />
            ))}
          </div>
        </div>
      )}

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
        {hasMarkers && (
          <div className="flex items-center gap-1.5 text-[11px] text-[var(--accent-light)]">
            <span style={{ fontSize: 10 }}>{'\u25C6'}</span>
            Draft posted
          </div>
        )}
      </div>
    </div>
  );
}

/** Expandable row showing a single posted draft */
function DraftExpansionRow({ draft, showBorder }: { draft: PromptDraftSnapshot; showBorder: boolean }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className={showBorder ? 'border-t border-[var(--border-subtle)]' : ''}>
      <button
        className="w-full px-4 py-2.5 flex items-center gap-3 hover:bg-[rgba(255,255,255,0.02)] transition-colors text-left"
        onClick={() => setExpanded(!expanded)}
      >
        <span className="text-[11px] font-medium text-[var(--text-primary)] capitalize">
          {draft.platform}
        </span>
        {draft.posted_at && (
          <span className="text-[10px] text-[var(--text-faint)]">
            {format(parseUTCISO(draft.posted_at), 'MMM d, yyyy')}
          </span>
        )}
        {draft.score_snapshot.delta != null && draft.score_snapshot.delta !== 0 && (
          <span
            className="text-[10px] font-bold"
            style={{
              color: draft.score_snapshot.delta > 0 ? 'var(--success)' : 'var(--danger)',
            }}
          >
            {draft.score_snapshot.delta > 0 ? '+' : ''}{Math.round(draft.score_snapshot.delta)}pp
          </span>
        )}
        <ChevronDown
          size={12}
          className={`ml-auto text-[var(--text-faint)] transition-transform ${expanded ? 'rotate-180' : ''}`}
        />
      </button>
      {expanded && draft.content_preview && (
        <div className="px-4 py-3 border-t border-[var(--border-subtle)] bg-[rgba(255,255,255,0.02)]">
          <p className="text-[11px] text-[var(--text-secondary)] leading-relaxed whitespace-pre-wrap">
            {draft.content_preview}
          </p>
        </div>
      )}
    </div>
  );
}
