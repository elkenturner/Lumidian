'use client';

import { ModelScore } from '@/lib/api';

interface ModelBreakdownProps {
  modelScores: ModelScore[];
}

const MODEL_CONFIG: Record<
  string,
  { label: string; color: string; bgColor: string; letter: string }
> = {
  chatgpt: {
    label: 'ChatGPT',
    color: '#22c55e',
    bgColor: 'rgba(34, 197, 94, 0.15)',
    letter: 'G',
  },
  claude: {
    label: 'Claude',
    color: '#f97316',
    bgColor: 'rgba(249, 115, 22, 0.15)',
    letter: 'C',
  },
  perplexity: {
    label: 'Perplexity',
    color: '#8b5cf6',
    bgColor: 'rgba(139, 92, 246, 0.15)',
    letter: 'P',
  },
  gemini: {
    label: 'Gemini',
    color: '#3b82f6',
    bgColor: 'rgba(59, 130, 246, 0.15)',
    letter: 'G',
  },
};

function getModelConfig(model: string) {
  const key = model.toLowerCase().replace(/[-_\s]/g, '');
  for (const [k, v] of Object.entries(MODEL_CONFIG)) {
    if (key.includes(k)) return v;
  }
  return {
    label: model,
    color: '#64748b',
    bgColor: 'rgba(99,102,241,0.10)',
    letter: model.charAt(0).toUpperCase(),
  };
}

function isNotConfigured(ms: ModelScore): boolean {
  return ms.error === 'api_key_not_configured' || ms.total_queries === 0;
}

export default function ModelBreakdown({ modelScores }: ModelBreakdownProps) {
  if (!modelScores || modelScores.length === 0) {
    return (
      <div className="card">
        <h3 className="text-base font-semibold text-[#f8fafc] mb-4">Model Breakdown</h3>
        <p className="text-sm text-[#64748b] text-center py-4">No model data available</p>
      </div>
    );
  }

  const sorted = [...modelScores].sort((a, b) => {
    const aUnconfigured = isNotConfigured(a);
    const bUnconfigured = isNotConfigured(b);
    if (aUnconfigured && !bUnconfigured) return 1;
    if (!aUnconfigured && bUnconfigured) return -1;
    return (b.score ?? 0) - (a.score ?? 0);
  });

  return (
    <div className="card">
      <h3 className="text-base font-semibold text-[#f8fafc] mb-5">Model Breakdown</h3>
      <div className="space-y-4">
        {sorted.map((ms) => {
          const config = getModelConfig(ms.model);
          const unconfigured = isNotConfigured(ms);
          const pct = unconfigured ? 0 : Math.round(ms.score ?? 0);

          return (
            <div
              key={ms.model}
              className="model-card"
              style={{ borderLeftColor: unconfigured ? 'var(--border-subtle)' : config.color }}
            >
              <div className="flex items-center justify-between mb-2">
                <span
                  className="text-sm font-medium"
                  style={{ color: unconfigured ? '#475569' : '#f8fafc' }}
                >
                  {config.label}
                </span>

                {unconfigured ? (
                  <span className="text-xs px-2 py-0.5 rounded-full bg-[rgba(71,85,105,0.3)] text-[#64748b] border border-[rgba(71,85,105,0.3)]">
                    Not configured
                  </span>
                ) : (
                  <span
                    className="stat-value text-lg"
                    style={{ color: config.color }}
                  >
                    {pct}%
                  </span>
                )}
              </div>

              {!unconfigured && (
                <>
                  <div className="h-1 bg-[rgba(255,255,255,0.06)] rounded-full overflow-hidden mb-2">
                    <div
                      className="h-full rounded-full transition-all duration-700"
                      style={{
                        width: `${pct}%`,
                        background: config.color,
                      }}
                    />
                  </div>
                  <span className="text-xs text-[#64748b]">
                    {ms.total_mentions}/{ms.total_queries} mentions
                  </span>
                </>
              )}

              {unconfigured && (
                <p className="text-xs text-[#475569]">Add API key in Settings to enable</p>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
