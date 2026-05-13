'use client';

import { motion } from 'framer-motion';
import { Check, X } from 'lucide-react';
import { staggerContainer, staggerChild } from '@/lib/motion';

interface Bot {
  name: string;
  family: 'openai' | 'anthropic' | 'google' | 'perplexity' | 'other';
  consequence: string;  // one-liner shown always (not just on hover)
  tier: 'critical' | 'standard';
}

const BOTS: Bot[] = [
  {
    name: 'OAI-SearchBot',
    family: 'openai',
    tier: 'critical',
    consequence: 'Used by ChatGPT to fetch pages live when answering. Blocking it removes you from ChatGPT search entirely.',
  },
  {
    name: 'GPTBot',
    family: 'openai',
    tier: 'critical',
    consequence: 'OpenAI training crawler — content here can be learned into ChatGPT model weights.',
  },
  {
    name: 'ClaudeBot',
    family: 'anthropic',
    tier: 'critical',
    consequence: "Anthropic's main crawler. Blocking it excludes you from Claude training + retrieval.",
  },
  {
    name: 'Google-Extended',
    family: 'google',
    tier: 'critical',
    consequence: 'Gemini + Google AI Overviews. Separate from Googlebot — block this and you lose Google AI without affecting regular Search.',
  },
  {
    name: 'PerplexityBot',
    family: 'perplexity',
    tier: 'critical',
    consequence: 'Perplexity is citation-driven. Blocking it removes you from one of the biggest AI search surfaces.',
  },
  {
    name: 'ChatGPT-User',
    family: 'openai',
    tier: 'standard',
    consequence: 'User-initiated ChatGPT fetches (someone pastes your link).',
  },
  {
    name: 'anthropic-ai',
    family: 'anthropic',
    tier: 'standard',
    consequence: "Older Anthropic user-agent. Keep allowed for compatibility.",
  },
  {
    name: 'Applebot-Extended',
    family: 'other',
    tier: 'standard',
    consequence: 'Apple Intelligence + Siri crawler.',
  },
  {
    name: 'Meta-ExternalAgent',
    family: 'other',
    tier: 'standard',
    consequence: "Meta's AI fetcher.",
  },
  {
    name: 'Amazonbot',
    family: 'other',
    tier: 'standard',
    consequence: "Amazon's crawler, increasingly used for Alexa AI.",
  },
];

const FAMILY_COLOR: Record<string, string> = {
  openai: 'var(--color-chatgpt)',
  anthropic: 'var(--color-claude)',
  google: 'var(--color-gemini)',
  perplexity: 'var(--color-perplexity)',
  other: 'var(--text-muted)',
};

interface Props {
  botStatus?: Record<string, 'allowed' | 'blocked'>;
}

export function BotGrid({ botStatus }: Props) {
  const critical = BOTS.filter((b) => b.tier === 'critical');
  const standard = BOTS.filter((b) => b.tier === 'standard');

  const blockedCritical = critical.filter((b) => (botStatus?.[b.name] ?? 'allowed') === 'blocked');
  const verdict =
    blockedCritical.length === 0
      ? { ok: true, text: 'All five critical AI crawlers can read your site.' }
      : {
          ok: false,
          text: `${blockedCritical.length} of 5 critical crawlers blocked: ${blockedCritical
            .map((b) => b.name)
            .join(', ')}.`,
        };

  return (
    <div className="card">
      <div className="mb-4">
        <h3 className="text-base font-semibold text-[var(--text-primary)]">AI crawler access</h3>
        <p
          className="text-sm mt-1 leading-relaxed"
          style={{ color: verdict.ok ? 'var(--success-text)' : 'var(--danger-text)' }}
        >
          {verdict.ok ? '✓ ' : '⚠ '}
          {verdict.text}
        </p>
      </div>

      <section>
        <p className="text-[10px] uppercase tracking-wider text-[var(--text-muted)] mb-2">
          Critical · the 5 that matter for AI search
        </p>
        <BotList bots={critical} botStatus={botStatus} />
      </section>

      <section className="mt-5 pt-4 border-t border-[var(--border-subtle)]">
        <p className="text-[10px] uppercase tracking-wider text-[var(--text-muted)] mb-2">
          Standard · additional AI bots worth allowing
        </p>
        <BotList bots={standard} botStatus={botStatus} />
      </section>
    </div>
  );
}

function BotList({
  bots,
  botStatus,
}: {
  bots: Bot[];
  botStatus?: Record<string, 'allowed' | 'blocked'>;
}) {
  return (
    <motion.ul
      variants={staggerContainer}
      initial="hidden"
      animate="visible"
      className="divide-y divide-[var(--border-subtle)]"
    >
      {bots.map((b) => {
        const status = botStatus?.[b.name] ?? 'allowed';
        const allowed = status === 'allowed';
        return (
          <motion.li
            key={b.name}
            variants={staggerChild}
            className="py-2.5 grid grid-cols-[10px_1fr_auto] gap-3 items-start"
          >
            <span
              className="inline-block w-2 h-2 rounded-full mt-2"
              style={{ background: FAMILY_COLOR[b.family] }}
              aria-hidden="true"
            />
            <div className="min-w-0">
              <p className="text-sm font-mono font-medium text-[var(--text-primary)]">{b.name}</p>
              <p className="text-xs text-[var(--text-secondary)] mt-0.5 leading-relaxed">
                {b.consequence}
              </p>
            </div>
            <span
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wider shrink-0 mt-0.5"
              style={{
                background: allowed ? 'var(--success-muted)' : 'rgba(239, 68, 68, 0.12)',
                color: allowed ? 'var(--success-text)' : 'var(--danger-text)',
                border: `1px solid ${allowed ? 'var(--success)' : 'var(--danger)'}`,
              }}
            >
              {allowed ? <Check size={11} /> : <X size={11} />}
              {allowed ? 'Allowed' : 'Blocked'}
            </span>
          </motion.li>
        );
      })}
    </motion.ul>
  );
}
