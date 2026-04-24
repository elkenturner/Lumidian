'use client';

import { useEffect, useState, useCallback } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { ArrowLeft, Loader2 } from 'lucide-react';
import {
  getPromptDetail,
  PromptDetailData,
} from '@/lib/api';
import { MODEL_ORDER, getModelConfig } from '@/lib/constants/models';
import PromptImpactTimeline from '@/components/PromptImpactTimeline';
import PromptInsightCard from '@/components/PromptInsightCard';
import { logError } from '@/lib/utils/errors';
import { useIsMobile } from '@/hooks/useIsMobile';
import ResponseText from '@/components/ui/ResponseText';
import { useBrand } from '@/contexts/BrandContext';

export default function PromptDetailPage() {
  const params = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();
  const isMobile = useIsMobile();
  const brandId = Number(params.brandId);
  const promptId = Number(params.promptId);
  const draftParam = searchParams?.get('draft');
  const highlightDraftId = draftParam ? Number(draftParam) : undefined;

  const [data, setData] = useState<PromptDetailData | null>(null);
  const [loading, setLoading] = useState(true);

  const { brands } = useBrand();
  const brandName = brands.find((b) => b.id === brandId)?.name ?? '';

  useEffect(() => {
    document.title = 'Prompt Detail — Lumidian';
  }, []);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const detail = await getPromptDetail(brandId, promptId);
      setData(detail);
    } catch (err) {
      logError(err, 'PromptDetail: fetch');
    } finally {
      setLoading(false);
    }
  }, [brandId, promptId]);

  useEffect(() => {
    if (brandId && promptId) loadData();
  }, [brandId, promptId, loadData]);

  if (loading) {
    return (
      <div className="px-4 sm:px-8 py-6 sm:py-8 max-w-7xl">
        <div className="flex items-center justify-center py-24">
          <Loader2 size={24} className="animate-spin text-[var(--accent)]" />
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="px-4 sm:px-8 py-6 sm:py-8 max-w-7xl">
        <p className="text-sm text-[var(--text-muted)]">Prompt not found.</p>
      </div>
    );
  }

  const trendLabel = data.score_trend === 'improving' ? '▲ Improving' : data.score_trend === 'declining' ? '▼ Declining' : '— Stable';
  const trendColor = data.score_trend === 'improving' ? 'var(--success)' : data.score_trend === 'declining' ? 'var(--danger)' : 'var(--text-muted)';
  const overallScore = Object.values(data.current_scores).length > 0
    ? Math.round(Object.values(data.current_scores).reduce((a, b) => a + b, 0) / Object.values(data.current_scores).length)
    : 0;

  return (
    <div className="px-4 sm:px-8 py-6 sm:py-8 max-w-7xl">
      {/* Back link */}
      <button
        onClick={() => router.back()}
        className="flex items-center gap-1.5 text-xs text-[var(--text-muted)] hover:text-[var(--text-secondary)] transition-colors mb-5"
      >
        <ArrowLeft size={14} />
        Back to Reports
      </button>

      {/* Hero */}
      <div className="mb-6">
        <h1 className="text-lg sm:text-xl font-semibold text-[var(--text-primary)] leading-snug mb-3">
          &ldquo;{data.prompt_text}&rdquo;
        </h1>
        <div className="flex items-center gap-3">
          <span className="stat-value text-2xl">{overallScore}%</span>
          <span className="text-xs font-medium" style={{ color: trendColor }}>{trendLabel}</span>
        </div>
      </div>

      {/* Model score pills */}
      <div className={`grid ${isMobile ? 'grid-cols-2' : 'grid-cols-4'} gap-3 mb-6`}>
        {MODEL_ORDER.map((modelKey) => {
          const cfg = getModelConfig(modelKey);
          const score = data.current_scores[modelKey];
          let delta: number | null = null;
          if (data.timeline.length >= 2) {
            const latest = data.timeline[data.timeline.length - 1].scores[modelKey];
            const prev = data.timeline[data.timeline.length - 2].scores[modelKey];
            if (latest != null && prev != null) delta = Math.round(latest - prev);
          }
          return (
            <div
              key={modelKey}
              className="rounded-lg px-4 py-3 transition-colors hover:brightness-110"
              style={{
                borderLeft: `3px solid ${cfg.color}`,
                background: cfg.bgColor,
              }}
            >
              <p className="text-xs font-semibold mb-1" style={{ color: cfg.color }}>
                {cfg.label}
              </p>
              <p className="stat-value stat-value-sm">
                {score != null ? `${Math.round(score)}%` : '—'}
              </p>
              {delta !== null && delta !== 0 && (
                <p
                  className="text-[10px] font-bold mt-0.5"
                  style={{ color: delta > 0 ? 'var(--success)' : 'var(--danger)' }}
                >
                  {delta > 0 ? `+${delta}` : delta}pp
                </p>
              )}
            </div>
          );
        })}
      </div>

      {/* Impact Timeline */}
      <div className="mb-6">
        <PromptImpactTimeline
          timeline={data.timeline}
          contentEvents={data.content_events}
          drafts={data.drafts}
          highlightDraftId={Number.isFinite(highlightDraftId as number) ? highlightDraftId : undefined}
        />
      </div>

      {/* Insights */}
      <div className="card p-5 mb-6">
        <h3 className="text-[13px] font-semibold text-[var(--text-muted)] uppercase tracking-wider mb-3">
          Insights
        </h3>
        {data.insights.length === 0 ? (
          <p className="text-xs text-[var(--text-faint)]">No insights yet — more data needed</p>
        ) : (
          <div className="flex flex-col gap-2">
            {data.insights.map((insight) => (
              <PromptInsightCard
                key={insight.id}
                id={insight.id}
                message={insight.message}
                severity={insight.severity}
                model={insight.model}
              />
            ))}
          </div>
        )}
      </div>

      {/* Competitor Presence */}
      {data.competitors.length > 0 && (
        <div className="card p-5 mb-6">
          <h3 className="text-[13px] font-semibold text-[var(--text-muted)] uppercase tracking-wider mb-3">
            Competitor Presence
          </h3>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-[var(--text-faint)] border-b border-[var(--border-subtle)]">
                  <th className="text-left py-2 pr-4 font-medium">Competitor</th>
                  <th className="text-right py-2 px-3 font-medium">Mention Rate</th>
                  <th className="text-right py-2 pl-3 font-medium">Trend</th>
                </tr>
              </thead>
              <tbody>
                {data.competitors.map((c) => (
                  <tr key={c.name} className="border-b border-[rgba(255,255,255,0.04)]">
                    <td className="py-2.5 pr-4 text-[var(--text-secondary)] font-medium">{c.name}</td>
                    <td className="py-2.5 px-3 text-right font-mono text-[var(--text-primary)]">
                      {Math.round(c.mention_rate * 100)}%
                    </td>
                    <td className="py-2.5 pl-3 text-right capitalize" style={{
                      color: c.trend === 'increasing' ? 'var(--danger)' : c.trend === 'decreasing' ? 'var(--success)' : 'var(--text-faint)',
                    }}>
                      {c.trend}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Recent AI Responses */}
      {data.recent_responses.length > 0 && (
        <div className="card p-5">
          <h3 className="text-[13px] font-semibold text-[var(--text-muted)] uppercase tracking-wider mb-3">
            Recent AI Responses
          </h3>
          <div className="flex flex-col gap-3">
            {data.recent_responses.map((resp) => {
              const cfg = getModelConfig(resp.model);
              return (
                <div
                  key={resp.model}
                  className="rounded-lg border border-[var(--border-subtle)] overflow-hidden"
                  style={{ borderLeftWidth: 3, borderLeftColor: cfg.color }}
                >
                  <div className="px-4 py-2.5 bg-[rgba(255,255,255,0.02)] flex items-center gap-2">
                    <span className="text-xs font-semibold" style={{ color: cfg.color }}>{cfg.label}</span>
                    <span className="text-[10px] text-[var(--text-faint)]">
                      {resp.mentioned ? '✓ Mentioned' : '✗ Not mentioned'}
                      {resp.sentiment && ` · ${resp.sentiment}`}
                    </span>
                  </div>
                  {resp.response_text && (
                    <div className="px-4 py-3 max-h-32 overflow-y-auto">
                      <ResponseText
                        text={resp.response_text}
                        brandName={brandName}
                        competitors={data.competitors.map((c) => c.name)}
                        maxLength={500}
                        className="text-xs text-[var(--text-secondary)]"
                      />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
