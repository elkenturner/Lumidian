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
    color: '#34d399',
    bgColor: 'rgba(16,163,127,0.15)',
    letter: 'G',
  },
  claude: {
    label: 'Claude',
    color: '#fb923c',
    bgColor: 'rgba(217,119,87,0.15)',
    letter: 'C',
  },
  perplexity: {
    label: 'Perplexity',
    color: '#a5b4fc',
    bgColor: 'rgba(99,102,241,0.18)',
    letter: 'P',
  },
  gemini: {
    label: 'Gemini',
    color: '#60a5fa',
    bgColor: 'rgba(66,133,244,0.15)',
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
      <div
        className="bg-[rgba(99,102,241,0.08)] backdrop-blur-md border border-[rgba(99,102,241,0.20)] rounded-xl p-6"
        style={{ boxShadow: '0 4px 24px rgba(0,0,0,0.30), inset 0 1px 0 rgba(255,255,255,0.055)' }}
      >
        <h3 className="text-base font-semibold text-[#e2e8f0] mb-4">Model Breakdown</h3>
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
    <div
      className="bg-[rgba(99,102,241,0.08)] backdrop-blur-md border border-[rgba(99,102,241,0.20)] rounded-xl p-6"
      style={{ boxShadow: '0 4px 24px rgba(0,0,0,0.30), inset 0 1px 0 rgba(255,255,255,0.055)' }}
    >
      <h3 className="text-base font-semibold text-[#e2e8f0] mb-5">Model Breakdown</h3>
      <div className="space-y-4">
        {sorted.map((ms) => {
          const config = getModelConfig(ms.model);
          const unconfigured = isNotConfigured(ms);
          const pct = unconfigured ? 0 : Math.round(ms.score ?? 0);

          return (
            <div key={ms.model} className="space-y-1.5">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <div
                    className="w-7 h-7 rounded-lg flex items-center justify-center text-xs font-bold flex-shrink-0"
                    style={
                      unconfigured
                        ? { backgroundColor: 'rgba(99,102,241,0.08)', color: '#475569' }
                        : { backgroundColor: config.bgColor, color: config.color }
                    }
                  >
                    {config.letter}
                  </div>
                  <div>
                    <span
                      className="text-sm font-medium"
                      style={{ color: unconfigured ? '#475569' : '#e2e8f0' }}
                    >
                      {config.label}
                    </span>
                    {!unconfigured && (
                      <span className="ml-2 text-xs text-[#64748b]">
                        {ms.total_mentions}/{ms.total_queries} mentions
                      </span>
                    )}
                  </div>
                </div>

                {unconfigured ? (
                  <span className="text-xs px-2 py-0.5 rounded-full bg-[rgba(99,102,241,0.08)] text-[#475569] border border-[rgba(99,102,241,0.18)]">
                    Not configured
                  </span>
                ) : (
                  <span
                    className="text-sm font-bold tabular-nums"
                    style={{ color: config.color }}
                  >
                    {pct}%
                  </span>
                )}
              </div>

              <div className="h-2 bg-[rgba(255,255,255,0.06)] rounded-full overflow-hidden">
                {unconfigured ? (
                  <div className="h-full w-0 rounded-full" />
                ) : (
                  <div
                    className="h-full rounded-full transition-all duration-700"
                    style={{
                      width: `${pct}%`,
                      background: `linear-gradient(90deg, ${config.color}, ${config.color}cc)`,
                    }}
                  />
                )}
              </div>

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
