'use client';

import {
  BarChart2,
} from 'lucide-react';
import {
  AreaChart,
  Area,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
import { TrendPoint } from '@/lib/api';
import { useCountUp } from '@/lib/motion';
import HelpTooltip from './HelpTooltip';
import SparklineTooltip from './SparklineTooltip';

interface VisibilityChartProps {
  score: number | null;
  scoreDelta: number | null;
  sinceLastRun: string | null;
  sparkData: Array<TrendPoint & { formattedDate: string; score: number }>;
  nextReportHours: number | null;
  loadingAnalytics: boolean;
  scoreConfidence?: 'low' | 'medium' | 'high';
  activeModels?: number;
}

const CONFIDENCE_STYLES: Record<string, { label: string; color: string; bg: string }> = {
  low: { label: 'Low confidence', color: 'var(--danger-text, #ef4444)', bg: 'rgba(239,68,68,0.12)' },
  medium: { label: 'Medium confidence', color: 'var(--warning, #f59e0b)', bg: 'rgba(245,158,11,0.12)' },
  high: { label: 'High confidence', color: 'var(--success)', bg: 'rgba(16,185,129,0.12)' },
};

export default function VisibilityChart({
  score,
  scoreDelta,
  sinceLastRun,
  sparkData,
  nextReportHours,
  loadingAnalytics,
  scoreConfidence,
  activeModels,
}: VisibilityChartProps) {
  const animatedScore = useCountUp(score ?? 0);

  return (
    <div className="card border-t-2 border-t-[var(--accent)] p-6 shadow-[0_8px_32px_rgba(0,0,0,0.25),0_0_40px_var(--accent-muted),inset_0_1px_0_rgba(255,255,255,0.07)]">
      <div className="flex items-start justify-between mb-3">
        <div>
          <p className="text-[13px] font-medium text-[var(--text-secondary)] flex items-center">
            Visibility Score
            <HelpTooltip
                text="Percentage of AI responses that mention your brand across all tracked prompts and models. The overall score is the average of each active model's score, so tiers with different models still compare cleanly."
                href="/methodology#scoring"
              />
          </p>
          {loadingAnalytics ? (
            <div className="h-14 w-28 bg-[rgba(255,255,255,0.06)] rounded animate-pulse mt-2" />
          ) : (
            <>
              <p className="text-4xl sm:text-5xl md:text-6xl font-bold text-[var(--text-primary)] mt-1 leading-none">
                {score != null ? `${animatedScore}%` : 'N/A'}
              </p>
              {scoreDelta !== null && (
                <p className={`text-xs font-medium mt-2 ${scoreDelta > 0 ? 'text-[var(--success)]' : scoreDelta < 0 ? 'text-[var(--danger-text)]' : 'text-[var(--text-muted)]'}`}>
                  {scoreDelta > 0 ? `+${scoreDelta}%` : scoreDelta < 0 ? `${scoreDelta}%` : '\u2014'} since {sinceLastRun ?? 'last run'}
                </p>
              )}
              {scoreConfidence && scoreConfidence !== 'high' && score != null && (
                <span
                  className="inline-flex items-center gap-1 text-[10px] font-medium mt-1.5 px-2 py-0.5 rounded-full"
                  style={{ color: CONFIDENCE_STYLES[scoreConfidence].color, backgroundColor: CONFIDENCE_STYLES[scoreConfidence].bg }}
                >
                  {CONFIDENCE_STYLES[scoreConfidence].label}
                  {activeModels !== undefined && activeModels < 4 && ` \u00b7 ${activeModels}/4 models`}
                </span>
              )}
            </>
          )}
        </div>
        <div className="w-10 h-10 rounded-xl bg-[rgba(255,255,255,0.06)] flex items-center justify-center text-[var(--accent)]">
          <BarChart2 size={18} />
        </div>
      </div>
      {sparkData.length > 1 ? (
        <ResponsiveContainer width="100%" height={56}>
          <AreaChart data={sparkData} margin={{ top: 4, right: 4, left: 4, bottom: 6 }}>
            <defs>
              <linearGradient id="sparkGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="var(--accent)" stopOpacity={0.3} />
                <stop offset="95%" stopColor="var(--accent)" stopOpacity={0} />
              </linearGradient>
            </defs>
            <Tooltip content={<SparklineTooltip />} />
            <Area type="monotone" dataKey="score" stroke="var(--accent)" strokeWidth={2.5} fill="url(#sparkGrad)" dot={false} isAnimationActive={true} animationDuration={800} animationEasing="ease-out" />
          </AreaChart>
        </ResponsiveContainer>
      ) : (
        <p className="text-xs text-[var(--text-faint)] mt-2">
          {sparkData.length === 1 ? '1 run recorded' : 'No trend data yet'}
        </p>
      )}
      {nextReportHours !== null && (
        <p className="text-[11px] text-[var(--text-faint)] mt-2">
          Next report in {nextReportHours}h
        </p>
      )}
    </div>
  );
}
