export const MODEL_ORDER = ['chatgpt', 'claude', 'perplexity', 'gemini'] as const;
export type ModelKey = (typeof MODEL_ORDER)[number];

export interface ModelConfig {
  label: string;
  color: string;
  bgColor: string;
  mutedBg: string;
  letter: string;
}

export const MODEL_CONFIG: Record<ModelKey, ModelConfig> = {
  chatgpt: {
    label: 'ChatGPT',
    color: 'var(--color-chatgpt)',
    bgColor: 'rgba(16,163,127,0.15)',
    mutedBg: 'var(--color-chatgpt-muted)',
    letter: 'G',
  },
  claude: {
    label: 'Claude',
    color: 'var(--color-claude)',
    bgColor: 'rgba(217,119,87,0.15)',
    mutedBg: 'var(--color-claude-muted)',
    letter: 'C',
  },
  perplexity: {
    label: 'Perplexity',
    color: 'var(--color-perplexity)',
    bgColor: 'rgba(32,170,215,0.15)',
    mutedBg: 'var(--color-perplexity-muted)',
    letter: 'P',
  },
  gemini: {
    label: 'Gemini',
    color: 'var(--color-gemini)',
    bgColor: 'rgba(66,133,244,0.15)',
    mutedBg: 'var(--color-gemini-muted)',
    letter: 'G',
  },
};

const DEFAULT_CONFIG: ModelConfig = {
  label: 'Unknown',
  color: 'var(--text-secondary)',
  bgColor: 'rgba(100,116,139,0.15)',
  mutedBg: 'var(--bg-card)',
  letter: '?',
};

export function getModelConfig(model: string): ModelConfig & { key: ModelKey | string } {
  const normalized = model.toLowerCase().replace(/[-_\s]/g, '');
  for (const key of MODEL_ORDER) {
    if (normalized.includes(key)) {
      return { ...MODEL_CONFIG[key], key };
    }
  }
  return { ...DEFAULT_CONFIG, label: model, key: model };
}
