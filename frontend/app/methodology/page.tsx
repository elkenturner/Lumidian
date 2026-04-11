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

export default function MethodologyPage() {
  return (
    <div className="px-4 sm:px-8 lg:px-12 py-8 sm:py-12 max-w-4xl mx-auto">

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
      {/* TWO TYPES OF VISIBILITY                                               */}
      {/* ═══════════════════════════════════════════════════════════════════════ */}
      <section id="model-types" className="scroll-mt-20">
        <SectionLabel>Model Types</SectionLabel>

        <h2 className="text-xl sm:text-2xl font-bold text-[var(--text-primary)] tracking-tight mb-2">
          Two types of AI visibility
        </h2>
        <p className="text-[15px] text-[var(--text-muted)] leading-relaxed mb-8">
          Not all AI models work the same way. Understanding the difference
          changes how you interpret your scores and where you focus.
        </p>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {/* Live Search card */}
          <div
            className="rounded-xl p-5 sm:p-6 border"
            style={{
              background: 'var(--success-muted)',
              borderColor: 'color-mix(in srgb, var(--success) 15%, transparent)',
            }}
          >
            <div className="flex items-center gap-2.5 mb-3">
              <div
                className="w-2 h-2 rounded-full"
                style={{ background: 'var(--success)' }}
              />
              <span className="text-sm font-semibold text-[var(--success-text)]">
                Live Search
              </span>
            </div>

            <p className="text-[13px] font-medium text-[var(--text-secondary)] mb-2">
              Perplexity &middot; Gemini
            </p>

            <p className="text-[13px] text-[var(--text-muted)] leading-relaxed">
              These models search the web in real-time when answering. Gemini uses
              Google Search grounding; Perplexity has built-in web search. Your
              content landscape today shapes their answers today. Changes show up
              within days.
            </p>
          </div>

          {/* AI Index card */}
          <div
            className="rounded-xl p-5 sm:p-6 border"
            style={{
              background: 'var(--accent-muted)',
              borderColor: 'var(--accent-border)',
            }}
          >
            <div className="flex items-center gap-2.5 mb-3">
              <div
                className="w-2 h-2 rounded-full"
                style={{ background: 'var(--accent-light)' }}
              />
              <span className="text-sm font-semibold" style={{ color: 'var(--accent-light)' }}>
                AI Index
              </span>
            </div>

            <p className="text-[13px] font-medium text-[var(--text-secondary)] mb-2">
              ChatGPT &middot; Claude
            </p>

            <p className="text-[13px] text-[var(--text-muted)] leading-relaxed">
              These models draw from training data — a snapshot of the web at
              the time they were trained. They reflect foundational AI knowledge
              and are slower to change, but mentions here are more durable. This
              is the long-game metric.
            </p>
          </div>
        </div>

        {/* Callout */}
        <div
          className="mt-6 rounded-lg px-4 py-3.5 border text-[13px] text-[var(--text-secondary)] leading-relaxed"
          style={{
            background: 'var(--bg-raised)',
            borderColor: 'var(--border-subtle)',
          }}
        >
          Your overall visibility score combines both types. The per-model
          breakdown shows you where to focus — and whether to prioritize
          short-term content (Live Search) or long-term authority (AI Index).
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

        {/* Tier note */}
        <div
          className="mt-6 rounded-lg px-4 py-3.5 border text-[13px] text-[var(--text-muted)] leading-relaxed"
          style={{
            background: 'var(--bg-raised)',
            borderColor: 'var(--border-subtle)',
          }}
        >
          <span className="text-[var(--text-secondary)] font-medium">Higher tiers, more queries.</span>{' '}
          Paid plans run each prompt more times per model, giving you higher
          statistical confidence in your scores.
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
              Real web context where it matters
            </p>
            <p className="text-[13px] text-[var(--text-muted)] leading-relaxed">
              Gemini includes Google Search grounding and Perplexity inherently
              searches the web — so your Live Search scores reflect the real,
              current content landscape without needing to scrape a browser.
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
          Different model types respond to different strategies. Knowing the
          difference lets you focus where it counts.
        </p>

        <div className="space-y-6">
          {/* Live Search factors */}
          <div>
            <div className="flex items-center gap-2 mb-3">
              <div
                className="w-2 h-2 rounded-full"
                style={{ background: 'var(--success)' }}
              />
              <h3 className="text-sm font-semibold text-[var(--success-text)]">
                Live Search factors
              </h3>
            </div>
            <ul className="space-y-2 ml-4">
              <li className="flex items-start gap-2.5 text-[13px] text-[var(--text-muted)] leading-relaxed">
                <span className="text-[var(--success)] mt-1.5 flex-shrink-0">&bull;</span>
                Recent content on authoritative sites — blog posts, press coverage, industry publications
              </li>
              <li className="flex items-start gap-2.5 text-[13px] text-[var(--text-muted)] leading-relaxed">
                <span className="text-[var(--success)] mt-1.5 flex-shrink-0">&bull;</span>
                SEO fundamentals — being cited and linked on domains that Perplexity and Gemini surface
              </li>
              <li className="flex items-start gap-2.5 text-[13px] text-[var(--text-muted)] leading-relaxed">
                <span className="text-[var(--success)] mt-1.5 flex-shrink-0">&bull;</span>
                Community presence on Reddit, Quora, and forums where these models pull context
              </li>
            </ul>
          </div>

          {/* AI Index factors */}
          <div>
            <div className="flex items-center gap-2 mb-3">
              <div
                className="w-2 h-2 rounded-full"
                style={{ background: 'var(--accent-light)' }}
              />
              <h3 className="text-sm font-semibold" style={{ color: 'var(--accent-light)' }}>
                AI Index factors
              </h3>
            </div>
            <ul className="space-y-2 ml-4">
              <li className="flex items-start gap-2.5 text-[13px] text-[var(--text-muted)] leading-relaxed">
                <span style={{ color: 'var(--accent-light)' }} className="mt-1.5 flex-shrink-0">&bull;</span>
                Wikipedia presence — a strong signal for training data inclusion
              </li>
              <li className="flex items-start gap-2.5 text-[13px] text-[var(--text-muted)] leading-relaxed">
                <span style={{ color: 'var(--accent-light)' }} className="mt-1.5 flex-shrink-0">&bull;</span>
                Consistent mentions across authoritative sources over time
              </li>
              <li className="flex items-start gap-2.5 text-[13px] text-[var(--text-muted)] leading-relaxed">
                <span style={{ color: 'var(--accent-light)' }} className="mt-1.5 flex-shrink-0">&bull;</span>
                Broad inclusion in datasets that models are trained on — documentation, academic references, news archives
              </li>
            </ul>
          </div>
        </div>

        {/* Connection callout */}
        <div
          className="mt-8 rounded-lg px-4 py-3.5 border text-[13px] leading-relaxed"
          style={{
            background: 'var(--bg-raised)',
            borderColor: 'var(--border-subtle)',
          }}
        >
          <span className="text-[var(--text-secondary)] font-medium">The flywheel effect.</span>{' '}
          <span className="text-[var(--text-muted)]">
            Live Search improvements often precede AI Index improvements.
            Today&apos;s content becomes tomorrow&apos;s training data — so consistent
            visibility on Perplexity and Gemini now builds durable visibility on
            ChatGPT and Claude over time.
          </span>
        </div>
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
