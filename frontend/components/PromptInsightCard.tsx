'use client';

import { TrendingUp, TrendingDown, AlertTriangle, Info } from 'lucide-react';
import { getModelConfig } from '@/lib/constants/models';

interface PromptInsightCardProps {
  id: string;
  message: string;
  severity: 'positive' | 'warning' | 'negative' | 'info';
  model?: string | null;
}

const SEVERITY_CONFIG = {
  positive: { color: 'var(--success)', Icon: TrendingUp },
  warning: { color: 'var(--warning)', Icon: AlertTriangle },
  negative: { color: 'var(--danger)', Icon: TrendingDown },
  info: { color: 'var(--accent)', Icon: Info },
};

export default function PromptInsightCard({ message, severity, model }: PromptInsightCardProps) {
  const { color, Icon } = SEVERITY_CONFIG[severity] || SEVERITY_CONFIG.info;
  const modelCfg = model ? getModelConfig(model) : null;

  return (
    <div
      className="flex items-start gap-3 px-3.5 py-2.5 rounded-lg transition-colors"
      style={{ borderLeft: `3px solid ${color}` }}
    >
      <Icon size={15} style={{ color, flexShrink: 0, marginTop: 1 }} />
      <p className="text-[13px] text-[var(--text-primary)] leading-snug flex-1">
        {message}
      </p>
      {modelCfg && model && (
        <span
          className="text-[10px] font-semibold px-2 py-0.5 rounded-full flex-shrink-0"
          style={{
            color: modelCfg.color,
            background: modelCfg.bgColor,
          }}
        >
          {modelCfg.label}
        </span>
      )}
    </div>
  );
}
