'use client';

import { Check, X } from 'lucide-react';
import HelpTooltip from '@/components/dashboard/HelpTooltip';

const BOTS: { name: string; explanation: string; family: 'openai' | 'anthropic' | 'google' | 'perplexity' | 'other' }[] = [
  { name: 'GPTBot', family: 'openai', explanation: 'OpenAI training crawler — content here is fair game for ChatGPT model training.' },
  { name: 'OAI-SearchBot', family: 'openai', explanation: 'ChatGPT live-search crawler. The heaviest hit if blocked — ChatGPT cannot read your site in real time.' },
  { name: 'ChatGPT-User', family: 'openai', explanation: 'ChatGPT user-initiated fetches (e.g. a user pasting a link).' },
  { name: 'ClaudeBot', family: 'anthropic', explanation: "Anthropic's main crawler. Blocking it excludes you from Claude training and retrieval." },
  { name: 'anthropic-ai', family: 'anthropic', explanation: 'Older Anthropic user-agent. Keep allowed for compatibility.' },
  { name: 'PerplexityBot', family: 'perplexity', explanation: 'Perplexity is citation-driven. Blocking it removes you from a major AI search surface.' },
  { name: 'Google-Extended', family: 'google', explanation: 'Gemini + Google AI Overviews. Separate from regular Googlebot — block this and you lose Google AI exposure without affecting search.' },
  { name: 'Meta-ExternalAgent', family: 'other', explanation: "Meta's AI fetcher." },
  { name: 'Applebot-Extended', family: 'other', explanation: 'Apple Intelligence + Siri crawler.' },
  { name: 'Amazonbot', family: 'other', explanation: "Amazon's general crawler, increasingly used for Alexa AI." },
];

const FAMILY_COLOR: Record<string, string> = {
  openai: 'var(--color-chatgpt)',
  anthropic: 'var(--color-claude)',
  google: 'var(--color-gemini)',
  perplexity: 'var(--color-perplexity)',
  other: 'var(--text-muted)',
};

interface Props {
  /** Optional robots.txt parse result keyed by user-agent. Missing key = "allowed". */
  botStatus?: Record<string, 'allowed' | 'blocked'>;
}

export function BotGrid({ botStatus }: Props) {
  return (
    <div className="card">
      <h3 className="text-base font-semibold text-[var(--text-primary)] mb-3">AI crawler access</h3>
      <ul className="divide-y divide-[var(--border-subtle)]">
        {BOTS.map((b) => {
          const status = botStatus?.[b.name] ?? 'allowed';
          const allowed = status === 'allowed';
          return (
            <li
              key={b.name}
              className="flex items-center gap-3 py-2.5"
            >
              <span
                className="inline-block w-2 h-2 rounded-full shrink-0"
                style={{ background: FAMILY_COLOR[b.family] }}
                aria-hidden="true"
              />
              <span className="flex-1 text-sm font-medium font-mono text-[var(--text-primary)] flex items-center gap-1">
                {b.name}
                <HelpTooltip text={b.explanation} />
              </span>
              <span
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wider"
                style={{
                  background: allowed ? 'var(--success-muted)' : 'rgba(239, 68, 68, 0.12)',
                  color: allowed ? 'var(--success-text)' : 'var(--danger-text)',
                  border: `1px solid ${allowed ? 'var(--success)' : 'var(--danger)'}`,
                }}
              >
                {allowed ? <Check size={11} /> : <X size={11} />}
                {allowed ? 'Allowed' : 'Blocked'}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
