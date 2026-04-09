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
  liveScore: number | null;
  indexScore: number | null;
}

export default function VisibilityChart({
  score,
  scoreDelta,
  sinceLastRun,
  sparkData,
  nextReportHours,
  loadingAnalytics,
  liveScore,
  indexScore,
}: VisibilityChartProps) {
  const animatedScore = useCountUp(score ?? 0);
  const animatedLive = useCountUp(liveScore ?? 0);
  const animatedIndex = useCountUp(indexScore ?? 0);

  return (
    <div className="card border-t-2 border-t-[var(--accent)] p-6 shadow-[0_8px_32px_rgba(0,0,0,0.25),0_0_40px_var(--accent-muted),inset_0_1px_0_rgba(255,255,255,0.07)]">
      <div className="flex items-start justify-between mb-3">
        <div>
          <p className="text-[13px] font-medium text-[var(--text-secondary)] flex items-center">
            Visibility Score
            <HelpTooltip text="Percentage of AI responses that mention your brand when answering your tracked prompts. A higher score means AI models are more aware of your brand." />
          </p>
          {loadingAnalytics ? (
            <div className="h-14 w-28 bg-[rgba(255,255,255,0.06)] rounded animate-pulse mt-2" />
          ) : (
            <>
              <p className="text-5xl md:text-6xl font-bold text-[var(--text-primary)] mt-1 leading-none">
                {score != null ? `${animatedScore}%` : 'N/A'}
              </p>
              {scoreDelta !== null && (
                <p className={`text-xs font-medium mt-2 ${scoreDelta > 0 ? 'text-[var(--success)]' : scoreDelta < 0 ? 'text-[var(--danger-text)]' : 'text-[var(--text-muted)]'}`}>
                  {scoreDelta > 0 ? `+${scoreDelta}%` : scoreDelta < 0 ? `${scoreDelta}%` : '\u2014'} since {sinceLastRun ?? 'last run'}
                </p>
              )}
            </>
          )}
        </div>
        <div className="w-10 h-10 rounded-xl bg-[rgba(255,255,255,0.06)] flex items-center justify-center text-[var(--accent)]">
          <BarChart2 size={18} />
        </div>
      </div>
      {sparkData.length > 1 ? (
        <ResponsiveContainer width="100%" height={44}>
          <AreaChart data={sparkData} margin={{ top: 0, right: 0, left: 0, bottom: 0 }}>
            <defs>
              <linearGradient id="sparkGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="var(--accent)" stopOpacity={0.3} />
                <stop offset="95%" stopColor="var(--accent)" stopOpacity={0} />
              </linearGradient>
            </defs>
            <Tooltip content={<SparklineTooltip />} />
            <Area type="monotone" dataKey="score" stroke="var(--accent)" strokeWidth={2.5} fill="url(#sparkGrad)" dot={false} />
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

      {/* Live / Index sub-score breakdown */}
      {!loadingAnalytics && score !== null && (liveScore !== null || indexScore !== null) && (
        <div className="mt-3 space-y-2 border-t border-[rgba(255,255,255,0.06)] pt-3">
          {([
            { label: 'Live Search', s: liveScore,  animated: animatedLive,  models: 'Perplexity \u00b7 Gemini',  color: 'var(--success)' },
            { label: 'AI Index',    s: indexScore, animated: animatedIndex, models: 'GPT-4o-mini \u00b7 Claude', color: 'var(--accent-light)' },
          ] as Array<{ label: string; s: number | null; animated: string; models: string; color: string }>).map(({ label, s, animated, models, color }) => (
            <div key={label}>
              <div className="flex items-center gap-3 mb-0.5">
                <div className="flex items-center gap-1.5 w-20 md:w-24 flex-shrink-0">
                  <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: color }} />
                  <span className="text-[11px] font-medium text-[var(--text-muted)] truncate">{label}</span>
                </div>
                <div className="flex-1 h-1.5 bg-[rgba(255,255,255,0.08)] rounded-full overflow-hidden">
                  <div className="h-full rounded-full transition-all duration-500" style={{ width: `${s ?? 0}%`, background: color }} />
                </div>
                <span className="text-xs font-bold tabular-nums w-9 text-right flex-shrink-0" style={{ color }}>
                  {s !== null ? `${animated}%` : '\u2014'}
                </span>
              </div>
              <p className="text-[9px] text-[var(--text-faint)] pl-[88px] md:pl-[108px] truncate">{models}</p>
            </div>
          ))}
          {liveScore !== null && indexScore !== null && (
            <p className="text-[10px] text-[var(--text-muted)] italic pt-0.5">
              {liveScore >= 50 && indexScore >= 50
                ? 'Strong across live search and AI knowledge.'
                : liveScore >= 50 && indexScore < 50
                  ? 'Trending online \u2014 not yet embedded in AI training data.'
                  : liveScore < 50 && indexScore >= 50
                    ? 'AI-recognized brand \u2014 boost recent content for live visibility.'
                    : 'Low visibility across channels \u2014 more content and coverage needed.'}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
