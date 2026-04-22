import Link from 'next/link';

export const metadata = {
  title: 'Methodology',
  description: 'How Lumidian measures your brand\'s AI visibility across ChatGPT, Claude, Perplexity, and Gemini.',
};

/* ── Shared section label ──────────────────────────────────────────────────── */
function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-block text-[11px] font-semibold tracking-[0.12em] uppercase text-[var(--text-faint)] mb-4">
      {children}
    </span>
  );
}

/* ── Divider between sections ──────────────────────────────────────────────── */
function SectionDivider() {
  return (
    <div className="py-10 sm:py-14 flex items-center justify-center">
      <div
        className="w-full max-w-[120px] h-px"
        style={{
          background: 'linear-gradient(90deg, transparent, var(--border-subtle), transparent)',
        }}
      />
    </div>
  );
}

/* ── Tier badge shown on each model card ───────────────────────────────────── */
type TierBadge = 'Free +' | 'Paid' | 'Pro only';

function ModelTierBadge({ label }: { label: TierBadge }) {
  // Three flavors, each with a distinct accent so users can scan the grid fast.
  const styles: Record<TierBadge, { color: string; border: string; bg: string }> = {
    'Free +': {
      color: 'var(--success-text)',
      border: 'color-mix(in srgb, var(--success) 25%, transparent)',
      bg: 'var(--success-muted)',
    },
    'Paid': {
      color: 'var(--text-secondary)',
      border: 'var(--border-subtle)',
      bg: 'transparent',
    },
    'Pro only': {
      color: 'var(--accent-light)',
      border: 'var(--accent-border)',
      bg: 'var(--accent-muted)',
    },
  };
  const s = styles[label];
  return (
    <span
      className="text-[10px] font-semibold tracking-[0.08em] uppercase px-2 py-[3px] rounded-md border whitespace-nowrap"
      style={{ color: s.color, borderColor: s.border, background: s.bg }}
    >
      {label}
    </span>
  );
}

/* ── Model card for the 4-up grid ──────────────────────────────────────────── */
function ModelCard({
  name,
  provider,
  tier,
  body,
}: {
  name: string;
  provider: string;
  tier: TierBadge;
  body: string;
}) {
  return (
    <div
      className="rounded-xl p-5 border flex flex-col h-full"
      style={{
        background: 'var(--bg-raised)',
        borderColor: 'var(--border-subtle)',
      }}
    >
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="min-w-0">
          <h3 className="text-[15px] font-semibold text-[var(--text-primary)] leading-tight">
            {name}
          </h3>
          <p className="text-[11px] text-[var(--text-faint)] mt-1 tracking-[0.02em]">
            {provider}
          </p>
        </div>
        <ModelTierBadge label={tier} />
      </div>
      <p className="text-[13px] text-[var(--text-muted)] leading-relaxed">
        {body}
      </p>
    </div>
  );
}

export default function MethodologyPage() {
  return (
    <div className="px-4 sm:px-8 lg:px-12 py-6 sm:py-12 max-w-4xl mx-auto">

      {/* ═══════════════════════════════════════════════════════════════════════ */}
      {/* HERO / INTRO                                                          */}
      {/* ═══════════════════════════════════════════════════════════════════════ */}
      <section id="overview" className="scroll-mt-20">
        <SectionLabel>Methodology</SectionLabel>

        <h1
          className="text-3xl sm:text-[2.5rem] font-extrabold text-[var(--text-primary)] tracking-tight leading-[1.1]"
        >
          How we measure your brand&apos;s
          <br />
          <span style={{ color: 'var(--accent-light)' }}>AI visibility</span>
        </h1>

        <div className="mt-8 space-y-4 text-[15px] sm:text-base text-[var(--text-secondary)] leading-[1.7]">
          <p>
            Lumidian queries each AI model directly and measures how often your
            brand appears in their responses. No scraping, no proxies — the same
            APIs that power ChatGPT, Claude, Perplexity, and Gemini.
          </p>
          <p className="text-[var(--text-muted)]">
            Transparency matters. If you&apos;re going to act on a visibility score, you
            should know exactly how it&apos;s calculated, what it represents, and what
            can move it. This page explains every part of the process.
          </p>
        </div>
      </section>

      <SectionDivider />

      {/* ═══════════════════════════════════════════════════════════════════════ */}
      {/* HOW WE MEASURE VISIBILITY — 4 model cards                             */}
      {/* ═══════════════════════════════════════════════════════════════════════ */}
      <section id="models" className="scroll-mt-20">
        <SectionLabel>Models</SectionLabel>

        <h2 className="text-xl sm:text-2xl font-bold text-[var(--text-primary)] tracking-tight mb-2">
          How we measure visibility
        </h2>
        <p className="text-[15px] text-[var(--text-muted)] leading-relaxed mb-8">
          Every model we query answers against the live web. Each one reaches for
          sources differently, so we treat them as four independent readings of
          what the web says about you today.
        </p>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <ModelCard
            name="ChatGPT"
            provider="OpenAI"
            tier="Paid"
            body="OpenAI's native web search retrieves live results before answering, matching what users see in ChatGPT today."
          />
          <ModelCard
            name="Claude"
            provider="Anthropic"
            tier="Pro only"
            body="Claude Haiku 4.5 with Anthropic's web-search tool. Issues up to three targeted searches per query before responding."
          />
          <ModelCard
            name="Perplexity"
            provider="Perplexity"
            tier="Free +"
            body="Search-grounded by design. Every answer is built from sources pulled at request time, with inline citations."
          />
          <ModelCard
            name="Gemini"
            provider="Google"
            tier="Free +"
            body="Google Search grounding is on for every query, so answers reflect current web context rather than static knowledge."
          />
        </div>

        {/* Scoring callout — replaces the old Live/Index combination note. */}
        <div
          className="mt-6 rounded-lg px-4 py-3.5 border text-[13px] text-[var(--text-secondary)] leading-relaxed"
          style={{
            background: 'var(--bg-raised)',
            borderColor: 'var(--border-subtle)',
          }}
        >
          Your overall visibility score is the average of the per-model scores
          for whichever models your plan queries. That way a Free brand and a
          Pro brand are always compared like-for-like against the models they
          actually run — no model sitting at zero drags the average down.
        </div>
      </section>

      <SectionDivider />

      {/* ═══════════════════════════════════════════════════════════════════════ */}
      {/* HOW SCORING WORKS                                                     */}
      {/* ═══════════════════════════════════════════════════════════════════════ */}
      <section id="scoring" className="scroll-mt-20">
        <SectionLabel>Scoring</SectionLabel>

        <h2 className="text-xl sm:text-2xl font-bold text-[var(--text-primary)] tracking-tight mb-2">
          How your visibility score is calculated
        </h2>
        <p className="text-[15px] text-[var(--text-muted)] leading-relaxed mb-8">
          One number that tells you how visible your brand is across AI. Here&apos;s
          exactly what goes into it.
        </p>

        <ol className="space-y-5">
          <li className="flex gap-4">
            <span
              className="flex-shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold"
              style={{
                background: 'var(--accent-muted)',
                color: 'var(--accent-light)',
              }}
            >
              1
            </span>
            <div>
              <p className="text-sm font-semibold text-[var(--text-primary)] mb-1">
                Prompts sent to each model
              </p>
              <p className="text-[13px] text-[var(--text-muted)] leading-relaxed">
                Your tracked prompts are sent to each AI model&apos;s API — ChatGPT,
                Claude, Perplexity, and Gemini. Each prompt is run multiple times
                per model to account for response variation.
              </p>
            </div>
          </li>

          <li className="flex gap-4">
            <span
              className="flex-shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold"
              style={{
                background: 'var(--accent-muted)',
                color: 'var(--accent-light)',
              }}
            >
              2
            </span>
            <div>
              <p className="text-sm font-semibold text-[var(--text-primary)] mb-1">
                Responses checked for mentions
              </p>
              <p className="text-[13px] text-[var(--text-muted)] leading-relaxed">
                Every response is analyzed for your brand name using both an exact
                case-insensitive match and a fuzzy normalized check that strips
                non-alphanumeric characters. A mention is detected if either
                method finds your brand.
              </p>
            </div>
          </li>

          <li className="flex gap-4">
            <span
              className="flex-shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold"
              style={{
                background: 'var(--accent-muted)',
                color: 'var(--accent-light)',
              }}
            >
              3
            </span>
            <div>
              <p className="text-sm font-semibold text-[var(--text-primary)] mb-1">
                Score calculated
              </p>
              <p className="text-[13px] text-[var(--text-muted)] leading-relaxed">
                Your visibility score is the percentage of queries where your brand
                was mentioned.
              </p>

              {/* Formula display */}
              <div
                className="mt-3 rounded-lg px-5 py-4 font-mono text-sm sm:text-base border text-center tracking-wide"
                style={{
                  background: 'var(--bg-raised)',
                  borderColor: 'var(--accent-border)',
                  color: 'var(--accent-light)',
                }}
              >
                <span className="text-[var(--text-muted)]">Score</span>{' '}
                <span className="text-[var(--text-faint)]">=</span>{' '}
                <span className="text-[var(--text-secondary)]">(mentions</span>{' '}
                <span className="text-[var(--text-faint)]">/</span>{' '}
                <span className="text-[var(--text-secondary)]">total queries)</span>{' '}
                <span className="text-[var(--text-faint)]">&times;</span>{' '}
                <span style={{ color: 'var(--accent-light)' }}>100</span>
              </div>
              <p className="mt-3 text-[12px] text-[var(--text-muted)] leading-relaxed">
                <span className="font-medium text-[var(--text-secondary)]">Per-model score</span>{' '}
                is calculated this way for each AI model individually. Your{' '}
                <span className="font-medium text-[var(--text-secondary)]">overall visibility score</span>{' '}
                is the average of every model your plan queries, so tiers with
                fewer models aren&apos;t penalized against tiers with more.
              </p>
            </div>
          </li>

          <li className="flex gap-4">
            <span
              className="flex-shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold"
              style={{
                background: 'var(--accent-muted)',
                color: 'var(--accent-light)',
              }}
            >
              4
            </span>
            <div>
              <p className="text-sm font-semibold text-[var(--text-primary)] mb-1">
                Errors excluded
              </p>
              <p className="text-[13px] text-[var(--text-muted)] leading-relaxed">
                If a query fails due to an API error or timeout, it&apos;s excluded
                from the denominator entirely. Your score only reflects responses
                that were actually received and analyzed.
              </p>
            </div>
          </li>
        </ol>

        {/* Runs + tier-coverage table */}
        <div
          className="mt-6 rounded-lg px-4 py-4 border"
          style={{
            background: 'var(--bg-raised)',
            borderColor: 'var(--border-subtle)',
          }}
        >
          <p className="text-[13px] text-[var(--text-muted)] leading-relaxed">
            <span className="text-[var(--text-secondary)] font-medium">3 runs per prompt per model.</span>{' '}
            Each prompt is sent to every supported model three times to smooth
            out response variation. Which models run depends on your plan:
          </p>

          <table className="w-full text-[13px] mt-4">
            <thead>
              <tr className="border-b border-[var(--border-subtle)]">
                <th className="text-left font-medium text-[var(--text-secondary)] py-2.5 pr-4 w-[110px]">Tier</th>
                <th className="text-left font-medium text-[var(--text-secondary)] py-2.5">Models queried</th>
              </tr>
            </thead>
            <tbody className="text-[var(--text-primary)]">
              <tr className="border-b border-[var(--border-subtle)]">
                <td className="py-2.5 pr-4 font-medium">Free</td>
                <td className="py-2.5 text-[var(--text-muted)] font-mono text-[12.5px]">
                  Perplexity, Gemini
                </td>
              </tr>
              <tr className="border-b border-[var(--border-subtle)]">
                <td className="py-2.5 pr-4 font-medium">Starter</td>
                <td className="py-2.5 text-[var(--text-muted)] font-mono text-[12.5px]">
                  ChatGPT, Perplexity, Gemini
                </td>
              </tr>
              <tr className="border-b border-[var(--border-subtle)]">
                <td className="py-2.5 pr-4 font-medium">Growth</td>
                <td className="py-2.5 text-[var(--text-muted)] font-mono text-[12.5px]">
                  ChatGPT, Perplexity Pro, Gemini
                </td>
              </tr>
              <tr>
                <td className="py-2.5 pr-4 font-medium" style={{ color: 'var(--accent-light)' }}>Pro</td>
                <td className="py-2.5 text-[var(--text-muted)] font-mono text-[12.5px]">
                  ChatGPT, Claude, Perplexity Pro, Gemini
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <SectionDivider />

      {/* ═══════════════════════════════════════════════════════════════════════ */}
      {/* WHY DIRECT MODEL QUERIES                                              */}
      {/* ═══════════════════════════════════════════════════════════════════════ */}
      <section id="why-api" className="scroll-mt-20">
        <SectionLabel>Approach</SectionLabel>

        <h2 className="text-xl sm:text-2xl font-bold text-[var(--text-primary)] tracking-tight mb-2">
          Why we query models directly
        </h2>
        <p className="text-[15px] text-[var(--text-secondary)] leading-relaxed mb-6">
          We query each AI model&apos;s API directly — the same models that power
          ChatGPT, Claude, Gemini, and Perplexity.
        </p>

        <div className="space-y-4">
          <div
            className="rounded-xl p-5 border-l-2 border border-l-[var(--accent)]"
            style={{
              background: 'var(--bg-raised)',
              borderColor: 'var(--border-subtle)',
              borderLeftColor: 'var(--accent)',
            }}
          >
            <p className="text-sm font-semibold text-[var(--text-primary)] mb-1.5">
              Consistent, reproducible results
            </p>
            <p className="text-[13px] text-[var(--text-muted)] leading-relaxed">
              Direct API queries eliminate variation from account state, location,
              cookies, and session history. Every run uses the same conditions,
              so your scores are comparable over time.
            </p>
          </div>

          <div
            className="rounded-xl p-5 border-l-2 border border-l-[var(--success)]"
            style={{
              background: 'var(--bg-raised)',
              borderColor: 'var(--border-subtle)',
              borderLeftColor: 'var(--success)',
            }}
          >
            <p className="text-sm font-semibold text-[var(--text-primary)] mb-1.5">
              Every answer comes from today&apos;s web
            </p>
            <p className="text-[13px] text-[var(--text-muted)] leading-relaxed">
              Every model we query runs against the live web — ChatGPT&apos;s native
              search, Claude&apos;s web-search tool, Perplexity&apos;s search grounding,
              and Gemini&apos;s Google Search integration. Scores reflect the web as
              it exists today, not a frozen snapshot from a model&apos;s training run.
            </p>
          </div>

          <div
            className="rounded-xl p-5 border-l-2 border"
            style={{
              background: 'var(--bg-raised)',
              borderColor: 'var(--border-subtle)',
              borderLeftColor: 'var(--accent-light)',
            }}
          >
            <p className="text-sm font-semibold text-[var(--text-primary)] mb-1.5">
              Stable over time
            </p>
            <p className="text-[13px] text-[var(--text-muted)] leading-relaxed">
              Some tools scrape consumer chat interfaces, but those results vary
              by session and break when UIs change. Direct API queries give you
              stable, comparable scores that you can trend with confidence.
            </p>
          </div>
        </div>
      </section>

      <SectionDivider />

      {/* ═══════════════════════════════════════════════════════════════════════ */}
      {/* WHAT MOVES YOUR SCORE                                                 */}
      {/* ═══════════════════════════════════════════════════════════════════════ */}
      <section id="improving" className="scroll-mt-20">
        <SectionLabel>Improving</SectionLabel>

        <h2 className="text-xl sm:text-2xl font-bold text-[var(--text-primary)] tracking-tight mb-2">
          What moves your score
        </h2>
        <p className="text-[15px] text-[var(--text-muted)] leading-relaxed mb-8">
          Every model we query is doing the same thing under the hood — searching
          the web for sources that answer the prompt, then composing an answer
          from what it finds. Four things consistently show up in the sources
          that get cited.
        </p>

        <ul className="space-y-5">
          <li className="flex gap-4">
            <span
              className="flex-shrink-0 w-6 h-6 rounded-md flex items-center justify-center text-[11px] font-bold"
              style={{
                background: 'var(--accent-muted)',
                color: 'var(--accent-light)',
              }}
            >
              1
            </span>
            <div>
              <p className="text-sm font-semibold text-[var(--text-primary)] mb-1">
                Fresh web content that answers the prompt
              </p>
              <p className="text-[13px] text-[var(--text-muted)] leading-relaxed">
                Reddit threads, Quora answers, and recent articles that mention
                your brand in the context of what the prompt is actually asking.
                Relevance to the question beats generic brand mentions every time.
              </p>
            </div>
          </li>

          <li className="flex gap-4">
            <span
              className="flex-shrink-0 w-6 h-6 rounded-md flex items-center justify-center text-[11px] font-bold"
              style={{
                background: 'var(--accent-muted)',
                color: 'var(--accent-light)',
              }}
            >
              2
            </span>
            <div>
              <p className="text-sm font-semibold text-[var(--text-primary)] mb-1">
                Authority on sources AI search weights heavily
              </p>
              <p className="text-[13px] text-[var(--text-muted)] leading-relaxed">
                Wikipedia, major publications, and industry-specific subreddits
                that reliably surface in grounded searches. A mention on a domain
                the models already trust moves the needle.
              </p>
            </div>
          </li>

          <li className="flex gap-4">
            <span
              className="flex-shrink-0 w-6 h-6 rounded-md flex items-center justify-center text-[11px] font-bold"
              style={{
                background: 'var(--accent-muted)',
                color: 'var(--accent-light)',
              }}
            >
              3
            </span>
            <div>
              <p className="text-sm font-semibold text-[var(--text-primary)] mb-1">
                Repeat mentions across independent sources
              </p>
              <p className="text-[13px] text-[var(--text-muted)] leading-relaxed">
                One mention on one site is easy to pass over. Three independent
                sources corroborating the same claim is much harder to ignore —
                that&apos;s when models start treating it as the default answer.
              </p>
            </div>
          </li>

          <li className="flex gap-4">
            <span
              className="flex-shrink-0 w-6 h-6 rounded-md flex items-center justify-center text-[11px] font-bold"
              style={{
                background: 'var(--accent-muted)',
                color: 'var(--accent-light)',
              }}
            >
              4
            </span>
            <div>
              <p className="text-sm font-semibold text-[var(--text-primary)] mb-1">
                Prompt-term adjacency
              </p>
              <p className="text-[13px] text-[var(--text-muted)] leading-relaxed">
                Your brand name appearing near the prompt&apos;s core keywords on the
                source page. Proximity is how search-grounded models decide which
                mentions are relevant to the question being asked.
              </p>
            </div>
          </li>
        </ul>
      </section>

      {/* Back to top */}
      <div className="mt-12 text-center">
        <a
          href="#overview"
          className="text-[11px] text-[var(--text-faint)] hover:text-[var(--text-muted)] transition-colors"
        >
          ↑ Back to top
        </a>
      </div>

      {/* ═══════════════════════════════════════════════════════════════════════ */}
      {/* FOOTER                                                                */}
      {/* ═══════════════════════════════════════════════════════════════════════ */}
      <div className="mt-6 pt-6 border-t border-[var(--border-subtle)] flex items-center justify-between text-[11px] text-[var(--text-faint)]">
        <p>&copy; 2026 Lumidian. All rights reserved.</p>
        <div className="flex gap-4">
          <Link href="/terms" className="hover:text-[var(--text-muted)] transition-colors">Terms</Link>
          <Link href="/privacy" className="hover:text-[var(--text-muted)] transition-colors">Privacy</Link>
        </div>
      </div>
    </div>
  );
}
