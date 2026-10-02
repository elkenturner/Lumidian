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

/* ── Footnote citation marker ──────────────────────────────────────────────── */
function Ref({ n }: { n: number | number[] }) {
  const nums = Array.isArray(n) ? n : [n];
  return (
    <sup className="ml-px whitespace-nowrap">
      {nums.map((num, i) => (
        <span key={num}>
          {i > 0 && <span className="text-[var(--text-faint)]">,</span>}
          <a
            href={`#ref-${num}`}
            className="font-medium text-[var(--accent-light)] hover:underline"
            style={{ fontSize: '0.75em' }}
          >
            [{num}]
          </a>
        </span>
      ))}
    </sup>
  );
}

/* ── References ────────────────────────────────────────────────────────────── */
type RefKind = 'Peer-reviewed' | 'Industry study' | 'Preprint';

const REFERENCE_KIND_STYLES: Record<RefKind, { color: string; border: string; bg: string }> = {
  'Peer-reviewed': {
    color: 'var(--success-text)',
    border: 'color-mix(in srgb, var(--success) 25%, transparent)',
    bg: 'var(--success-muted)',
  },
  'Industry study': {
    color: 'var(--accent-light)',
    border: 'var(--accent-border)',
    bg: 'var(--accent-muted)',
  },
  'Preprint': {
    color: 'var(--text-secondary)',
    border: 'var(--border-subtle)',
    bg: 'transparent',
  },
};

const REFERENCES: {
  authors: string;
  title: string;
  venue: string;
  kind: RefKind;
  url: string;
  note: string;
}[] = [
  {
    authors: 'Żatuchin, D.',
    title: 'Who Owns the AI Recommendation? A Multi-Industry Empirical Map of Brand Category Ownership Across Large Language Models',
    venue: 'arXiv:2606.23057, 2026',
    kind: 'Preprint',
    url: 'https://arxiv.org/abs/2606.23057',
    note: 'Found only 41.6% agreement between models on the top-recommended brand. A top spot on one model doesn’t carry to another, so tracking a single model gives an incomplete picture.',
  },
  {
    authors: 'Song, Y., et al.',
    title: 'The Good, The Bad, and The Greedy: Evaluation of LLMs Should Not Ignore Non-Determinism',
    venue: 'NAACL 2025',
    kind: 'Peer-reviewed',
    url: 'https://arxiv.org/abs/2407.10457',
    note: 'Shows that judging an LLM from a single response per prompt is unreliable; the paper itself samples each prompt many times and reports averages across runs.',
  },
  {
    authors: 'Atil, B., et al.',
    title: 'Non-Determinism of "Deterministic" LLM Settings',
    venue: 'Eval4NLP @ ACL 2025',
    kind: 'Peer-reviewed',
    url: 'https://arxiv.org/abs/2408.04667',
    note: 'Across 5 LLMs, 8 tasks, and 10 runs each, accuracy varied up to 15% between identical runs. Even at temperature 0 with fixed seeds, no model produced repeatable outputs.',
  },
  {
    authors: 'Yuan, J., et al.',
    title: 'Understanding and Mitigating Numerical Sources of Nondeterminism in LLM Inference',
    venue: 'NeurIPS 2025 (oral)',
    kind: 'Peer-reviewed',
    url: 'https://arxiv.org/abs/2506.09501',
    note: 'Traces run-to-run variation to the inference infrastructure itself (floating-point non-associativity, GPU batching), variation callers of commercial LLM APIs cannot switch off.',
  },
  {
    authors: 'Angermeir, F., et al.',
    title: 'On the Reproducibility of LLM-Centric Empirical Studies',
    venue: 'ICSE 2026',
    kind: 'Peer-reviewed',
    url: 'https://arxiv.org/abs/2510.25506',
    note: 'A replication of 85 LLM studies ran up to 30 repetitions per study specifically because of non-determinism, observing up to 30% metric differences between repetitions.',
  },
  {
    authors: 'Fishkin, R. (SparkToro) & O’Donnell, G. (Gumshoe.ai)',
    title: 'AIs Are Highly Inconsistent When Recommending Brands — Marketers Should Take Care When Tracking AI Visibility',
    venue: 'SparkToro Research, 2026',
    kind: 'Industry study',
    url: 'https://sparktoro.com/blog/new-research-ais-are-highly-inconsistent-when-recommending-brands-or-products-marketers-should-take-care-when-tracking-ai-visibility/',
    note: 'Across 2,961 runs of 12 prompts, exact brand lists almost never repeated, yet per-brand mention rates stayed stable over many runs, concluding that visibility % across many prompts run multiple times is a sound metric, while "AI ranking position" metrics are not.',
  },
  {
    authors: 'Schulte, B., Bleeker, F. & Kaufmann, E.',
    title: 'Don’t Measure Once: Measuring Visibility in AI Search',
    venue: 'arXiv:2604.07585, 2026',
    kind: 'Preprint',
    url: 'https://arxiv.org/abs/2604.07585',
    note: 'Repeated identical AI-search queries shared only 32–43% of cited sources; brand visibility should be measured as a distribution over repeated queries, not a one-off observation.',
  },
  {
    authors: 'Aggarwal, P., Murahari, V., Rajpurohit, T., Kalyan, A., Narasimhan, K. & Deshpande, A.',
    title: 'GEO: Generative Engine Optimization',
    venue: 'KDD 2024',
    kind: 'Peer-reviewed',
    url: 'https://arxiv.org/abs/2311.09735',
    note: 'The foundational generative-engine-optimization study (Princeton/IIT Delhi): targeted content changes (adding citations, quotations, and statistics) boosted source visibility in generative engine responses by up to 40% on a large multi-domain benchmark.',
  },
];

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
            brand appears in their responses. No scraping, no proxies: the same
            APIs that power ChatGPT, Claude, Perplexity, and Gemini.
          </p>
          <p className="text-[var(--text-muted)]">
            Transparency matters. If you&apos;re going to act on a visibility score, you
            should know exactly how it&apos;s calculated, what it represents, and what
            can move it. This page explains every part of the process, and the
            key design decisions are backed by published research, cited inline
            and listed in full in the{' '}
            <a href="#references" className="text-[var(--accent-light)] hover:underline">
              references
            </a>{' '}
            below.
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
          what the web says about you today. That independence is measurable:
          one 2026 study found the models agree on the top-recommended brand in
          a category only 41.6% of the time, so tracking a single model misses
          most of the picture.<Ref n={1} />
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
          actually run, so no model sitting at zero drags the average down.
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
                Your tracked prompts are sent to each AI model&apos;s API: ChatGPT,
                Claude, Perplexity, and Gemini. Each prompt is run multiple times
                per model because LLMs give different answers to the same
                question. Peer-reviewed studies show outputs vary even at
                &quot;deterministic&quot; settings, so a single response is not a
                reliable measurement.<Ref n={[2, 3, 4]} />
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
                was mentioned. Mention rate over repeated prompts is the measure
                independent research converges on: exact AI answers almost never
                repeat, but a brand&apos;s mention rate is stable across runs,
                which is also why we don&apos;t sell an &quot;AI ranking
                position&quot; metric.<Ref n={[6, 7]} />
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
            out response variation, consistent with published LLM-evaluation
            practice of measuring over repeated runs rather than trusting a
            single response.<Ref n={[2, 5]} /> Which models run depends on your
            plan:
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
          We query each AI model&apos;s API directly, the same models that power
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
              Controlled, comparable conditions
            </p>
            <p className="text-[13px] text-[var(--text-muted)] leading-relaxed">
              Direct API queries eliminate variation from account state, location,
              cookies, and session history, so every run measures the model,
              not your browser. The variation that remains is the model&apos;s own
              response randomness, which no caller can switch off.<Ref n={[3, 4]} />{' '}
              That&apos;s what the repeated runs are for.
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
              Every model we query runs against the live web: ChatGPT&apos;s native
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
          Every model we query is doing the same thing under the hood: searching
          the web for sources that answer the prompt, then composing an answer
          from what it finds. This is measurable and moveable: the foundational
          peer-reviewed study on generative engine optimization found that
          targeted content changes boosted a source&apos;s visibility in AI answers
          by up to 40%.<Ref n={8} /> Four things consistently show up in the
          sources that get cited.
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
                sources corroborating the same claim is much harder to ignore.
                That&apos;s when models start treating it as the default answer.
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

      <SectionDivider />

      {/* ═══════════════════════════════════════════════════════════════════════ */}
      {/* REFERENCES                                                            */}
      {/* ═══════════════════════════════════════════════════════════════════════ */}
      <section id="references" className="scroll-mt-20">
        <SectionLabel>References</SectionLabel>

        <h2 className="text-xl sm:text-2xl font-bold text-[var(--text-primary)] tracking-tight mb-2">
          The research behind this methodology
        </h2>
        <p className="text-[15px] text-[var(--text-muted)] leading-relaxed mb-8">
          The sources cited above, in full. We label each one honestly:
          peer-reviewed papers passed independent academic review; preprints and
          industry studies haven&apos;t, but publish their data and methods openly.
          No study validates our exact run count. The research supports
          measuring over repeated runs as a practice, and three runs is where we
          balance statistical stability against querying cost.
        </p>

        <ol className="space-y-4">
          {REFERENCES.map((ref, i) => {
            const kindStyle = REFERENCE_KIND_STYLES[ref.kind];
            return (
              <li
                key={ref.url}
                id={`ref-${i + 1}`}
                className="scroll-mt-24 rounded-xl p-5 border flex gap-4"
                style={{
                  background: 'var(--bg-raised)',
                  borderColor: 'var(--border-subtle)',
                }}
              >
                <span className="flex-shrink-0 text-[13px] font-mono text-[var(--text-faint)] pt-0.5 w-7">
                  [{i + 1}]
                </span>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 mb-1">
                    <a
                      href={ref.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-sm font-semibold text-[var(--text-primary)] hover:text-[var(--accent-light)] transition-colors leading-snug"
                    >
                      {ref.title}
                    </a>
                    <span
                      className="text-[10px] font-semibold tracking-[0.08em] uppercase px-2 py-[3px] rounded-md border whitespace-nowrap"
                      style={{
                        color: kindStyle.color,
                        borderColor: kindStyle.border,
                        background: kindStyle.bg,
                      }}
                    >
                      {ref.kind}
                    </span>
                  </div>
                  <p className="text-[12px] text-[var(--text-faint)] mb-2">
                    {ref.authors} · {ref.venue}
                  </p>
                  <p className="text-[13px] text-[var(--text-muted)] leading-relaxed">
                    {ref.note}
                  </p>
                </div>
              </li>
            );
          })}
        </ol>
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
