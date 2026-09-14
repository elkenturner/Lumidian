'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import {
  BarChart2,
  Target,
  Sparkles,
  TrendingUp,
  TrendingDown,
  Check,
  ArrowRight,
  MessageSquare,
  Settings2,
  ChevronDown,
  Menu,
  X,
  Users,
  Activity,
  Mail,
  Repeat,
  ShieldCheck,
  Ban,
  Layers,
} from 'lucide-react';
import LumidianLogo from '@/components/LumidianLogo';
import { useInView, FadeUp, ScaleIn } from '@/lib/motion';

// ═══════════════════════════════════════════════════════════════════════════════
// ANIMATION HOOKS
// ═══════════════════════════════════════════════════════════════════════════════

// Local useCountUp returns the { ref, value: number } shape used by DashboardMockup.
// The canonical useCountUp in lib/motion returns a plain string; signatures differ.
function useCountUp(target: number, duration = 1200) {
  const [value, setValue] = useState(0);
  const triggered = useRef(false);
  const { ref, inView } = useInView(0.3);

  useEffect(() => {
    if (!inView || triggered.current) return;
    triggered.current = true;

    const start = performance.now();
    const step = (now: number) => {
      const elapsed = now - start;
      const progress = Math.min(elapsed / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      setValue(Math.round(eased * target));
      if (progress < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }, [inView, target, duration]);

  return { ref, value };
}

// ═══════════════════════════════════════════════════════════════════════════════
// DATA
// ═══════════════════════════════════════════════════════════════════════════════

const CONTACT_EMAIL = 'ken@lumidian.ai';

const AUDIT_MAILTO =
  `mailto:${CONTACT_EMAIL}?subject=` +
  encodeURIComponent('Free AI visibility audit') +
  '&body=' +
  encodeURIComponent(
    'Business name:\nWebsite:\nCity:\nOne or two questions customers ask before they call you:\n',
  );

const MONTHLY_PRICE = '$1,000';

const FEATURES = [
  {
    icon: BarChart2,
    title: 'Visibility tracking',
    desc: 'How often your business appears when ChatGPT, Claude, Perplexity, and Gemini answer the questions your customers ask.',
  },
  {
    icon: Target,
    title: 'Gap finding',
    desc: 'Which questions miss you, which competitors get named instead, and where the next piece of work should go.',
  },
  {
    icon: Sparkles,
    title: 'Content built for retrieval',
    desc: 'Pages on your own site first, backed by Reddit and Quora answers where a real thread exists. Written to be found by AI search, not to chase likes.',
  },
  {
    icon: TrendingUp,
    title: 'Weekly reporting',
    desc: 'A PDF every week with the score, the per-model breakdown, and what moved. A monthly summary on top.',
  },
  {
    icon: MessageSquare,
    title: 'Live thread monitoring',
    desc: 'Reddit and Quora discussions where your business could honestly contribute, scored by relevance to your tracked questions.',
  },
  {
    icon: Settings2,
    title: 'Site fixes for AI',
    desc: 'An audit of how AI crawlers read your site, then the fixes: schema, structure, llms.txt, robots.txt. Refreshed quarterly.',
  },
  {
    icon: Users,
    title: 'Competitor tracking',
    desc: 'Named local competitors tracked on the same questions, so you can see share of voice and who wins each one.',
  },
  {
    icon: Activity,
    title: 'Sentiment and position',
    desc: 'Whether the models describe you positively, neutrally, or negatively, and where in the answer you appear.',
  },
];

const AI_MODELS = [
  { name: 'ChatGPT', color: '#10a37f' },
  { name: 'Claude', color: '#f97316' },
  { name: 'Perplexity', color: '#8b5cf6' },
  { name: 'Gemini', color: '#3b82f6' },
];

const HOW_STEPS = [
  {
    n: '1',
    title: 'We measure',
    desc: 'We pick up to 10 questions your customers actually ask, then run each one three times on every model, every week. You get a score you can trust and a breakdown by model.',
  },
  {
    n: '2',
    title: 'We find the gaps',
    desc: 'The questions where you are missing, the competitors the models name instead, and the sources those answers are built from.',
  },
  {
    n: '3',
    title: 'We build the fixes',
    desc: 'Two content pieces a month aimed at those gaps, plus the site changes AI crawlers need. You approve everything before it goes out under your name.',
  },
];

const METHOD_POINTS = [
  {
    icon: Repeat,
    title: 'Three passes per question, per model',
    desc: 'The same question gets a different answer on the next ask. One response is an anecdote. We score the rate across repeated runs.',
  },
  {
    icon: Layers,
    title: 'Four surfaces, because they disagree',
    desc: 'In our own 900-run study, any two AI surfaces agreed on the top answer to the same question 20 to 23 percent of the time. A score from one model tells you about one model.',
  },
  {
    icon: Ban,
    title: 'No "AI ranking position"',
    desc: 'Exact answer lists rarely repeat, so a position number is noise. Mention rate over repeated questions is stable, and that is what we report.',
  },
  {
    icon: ShieldCheck,
    title: 'Failed queries do not count against you',
    desc: 'A timeout or an API error is left out of the denominator. The score only reflects answers we actually received and read.',
  },
];

const INCLUDED = [
  'Up to 10 tracked questions across ChatGPT, Claude, Perplexity, and Gemini, with named competitors',
  'Three runs per question per model, every week',
  'Weekly visibility report (PDF) and a monthly summary',
  'Site audit for AI crawlers, with the fixes implemented and refreshed quarterly',
  'Two content pieces a month, built to win the questions you are losing',
  'A login to the live dashboard, so you can check the numbers any time',
];

const NOT_INCLUDED = [
  'Review management or Google Business Profile work',
  'Paid ads',
  'Social media community management',
  'Guaranteed rankings. Nobody can promise what an AI model will say.',
];

const FAQ_ITEMS = [
  {
    q: 'How do you measure AI visibility?',
    a: 'We send each of your tracked questions to ChatGPT, Claude, Perplexity, and Gemini through their APIs, with web search on, three times per model every week. Each answer is checked for your business name. Your score is the share of answers that mention you. The methodology page explains every step and cites the research behind it.',
  },
  {
    q: 'What do you actually build?',
    a: 'Pages on your own site first, because that is where AI search looks for a definitive answer. Then Reddit and Quora answers where a real thread exists and a plain, disclosed reply would help. Two pieces a month, each aimed at a question you are currently losing.',
  },
  {
    q: 'Is the content AI-generated?',
    a: 'Drafts start in our system and get edited by a person before you see them. Nothing is published, and nothing appears under your name, until you approve it.',
  },
  {
    q: 'How long until the score moves?',
    a: 'We do not promise a timeline. AI answers change as new sources appear on the web, and the models do not update on a schedule we control. What we can promise is honest measurement: enough repeated runs to tell a real change from noise, reported every week, whether it moved or not. The three-month minimum exists because one month is not enough time to see anything.',
  },
  {
    q: 'Why one price?',
    a: 'Because the work is the same for a dentist and a law firm: measure, find the gaps, build the fixes. A tiered menu would only make you guess which features you need. Founding pricing is $1,000 a month and will rise once the results are proven.',
  },
  {
    q: 'Can I just use the software?',
    a: 'The platform is available to a small number of accounts by arrangement, not as a self-serve trial. If that is what you want, email us and say so.',
  },
  {
    q: 'Is my data private?',
    a: 'Yes. Your questions, competitors, and tracking data are visible only to your account and to us. We never share individual client data.',
  },
  {
    q: 'How is this different from SEO?',
    a: 'SEO tools track Google rankings. We track what AI assistants say when someone asks them who to call, which is a different signal that those tools do not measure. The two are related: the sources AI models cite are web pages, so good SEO helps. It just is not the same thing.',
  },
];

const DEMO_MODELS = [
  { name: 'Perplexity', score: 78, color: 'var(--color-perplexity)' },
  { name: 'ChatGPT', score: 72, color: 'var(--color-chatgpt)' },
  { name: 'Claude', score: 61, color: 'var(--color-claude)' },
  { name: 'Gemini', score: 55, color: 'var(--color-gemini)' },
];

const DEMO_GAPS = [
  { prompt: 'best [service] in [your city]', score: 12 },
  { prompt: 'how much does [service] cost in [your city]', score: 18 },
  { prompt: 'is [procedure] worth it', score: 21 },
];

const NAV_LINKS = [
  { href: '#features', label: 'What you get' },
  { href: '#how', label: 'How it works' },
  { href: '/methodology', label: 'Methodology' },
  { href: '#pricing', label: 'Pricing' },
  { href: '#faq', label: 'FAQ' },
];

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION COMPONENTS
// ═══════════════════════════════════════════════════════════════════════════════

function Header({ scrolled }: { scrolled: boolean }) {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  return (
    <header
      className={`fixed top-0 left-0 right-0 z-50 transition-[background-color,backdrop-filter,border-color] duration-300 ${
        scrolled
          ? 'bg-[rgba(2,6,23,0.85)] backdrop-blur-lg border-b border-[var(--border-subtle)]'
          : 'max-md:bg-[rgba(2,6,23,0.85)] max-md:backdrop-blur-lg bg-transparent'
      }`}
    >
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          {/* Logo */}
          <Link href="/" className="flex items-center">
            <LumidianLogo size={32} withWordmark variant="dark" />
          </Link>

          {/* Desktop nav */}
          <nav className="hidden md:flex items-center gap-8">
            {NAV_LINKS.map((l) =>
              l.href.startsWith('#') ? (
                <a key={l.href} href={l.href} className="text-sm font-medium text-[var(--text-secondary)] hover:text-white transition-colors">
                  {l.label}
                </a>
              ) : (
                <Link key={l.href} href={l.href} className="text-sm font-medium text-[var(--text-secondary)] hover:text-white transition-colors">
                  {l.label}
                </Link>
              ),
            )}
          </nav>

          {/* Desktop CTAs */}
          <div className="hidden md:flex items-center gap-3">
            <Link
              href="/login"
              className="text-sm font-medium text-white px-4 py-2 rounded-full border border-[rgba(255,255,255,0.2)] hover:border-white transition-colors"
            >
              Log in
            </Link>
            <a
              href={AUDIT_MAILTO}
              className="text-sm font-semibold text-white px-5 py-2.5 rounded-full bg-[var(--accent)] hover:bg-[var(--accent-hover)] transition-colors shadow-lg"
            >
              Request an audit
            </a>
          </div>

          {/* Mobile menu button */}
          <button
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            className="md:hidden p-2 text-[var(--text-secondary)] hover:text-white"
            aria-label={mobileMenuOpen ? 'Close menu' : 'Open menu'}
          >
            {mobileMenuOpen ? <X size={24} /> : <Menu size={24} />}
          </button>
        </div>

        {/* Mobile menu */}
        {mobileMenuOpen && (
          <div className="md:hidden py-4 border-t border-[var(--border-subtle)]">
            <nav className="flex flex-col gap-1">
              {NAV_LINKS.map((l) =>
                l.href.startsWith('#') ? (
                  <a key={l.href} href={l.href} onClick={() => setMobileMenuOpen(false)} className="text-base font-medium text-[var(--text-secondary)] hover:text-white py-3 px-2 rounded-lg hover:bg-[rgba(255,255,255,0.05)] transition-colors">{l.label}</a>
                ) : (
                  <Link key={l.href} href={l.href} onClick={() => setMobileMenuOpen(false)} className="text-base font-medium text-[var(--text-secondary)] hover:text-white py-3 px-2 rounded-lg hover:bg-[rgba(255,255,255,0.05)] transition-colors">{l.label}</Link>
                ),
              )}
              <div className="flex flex-col gap-3 pt-4 mt-2 border-t border-[var(--border-subtle)]">
                <Link href="/login" className="text-base font-medium text-white text-center py-3 rounded-full border border-[rgba(255,255,255,0.2)]">
                  Log in
                </Link>
                <a href={AUDIT_MAILTO} className="text-base font-semibold text-white text-center py-3.5 rounded-full bg-[var(--accent)]">
                  Request an audit
                </a>
              </div>
            </nav>
          </div>
        )}
      </div>
    </header>
  );
}

function HeroSection() {
  return (
    <section className="relative min-h-screen flex items-center justify-center pt-20 pb-16 overflow-hidden">
      {/* Background gradient */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background: 'radial-gradient(ellipse at 50% 0%, rgba(95,126,166,0.15) 0%, transparent 60%)',
        }}
      />

      <div className="relative z-10 max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
        {/* Badge */}
        <FadeUp>
          <div className="inline-flex items-center gap-2 bg-[var(--bg-raised)] border border-[rgba(95,126,166,0.3)] rounded-full px-4 py-1.5 mb-8">
            <span className="w-2 h-2 rounded-full bg-[#22c55e] animate-pulse" />
            <span className="text-sm text-[var(--text-secondary)]">AI visibility, done for you</span>
          </div>
        </FadeUp>

        {/* Headline */}
        <FadeUp delay={100}>
          <h1
            className="text-4xl sm:text-5xl lg:text-6xl font-extrabold tracking-tight"
            style={{ fontFamily: 'var(--font-syne), system-ui, sans-serif', letterSpacing: '-0.03em', lineHeight: 1.05 }}
          >
            Know what AI says about you.
            <br />
            <span className="text-[var(--accent)]">Then change it.</span>
          </h1>
        </FadeUp>

        {/* Subhead */}
        <FadeUp delay={200}>
          <p className="mt-6 text-lg sm:text-xl text-[var(--text-secondary)] max-w-2xl mx-auto leading-relaxed">
            Your next customer is asking ChatGPT who to call. We track what
            ChatGPT, Claude, Perplexity, and Gemini say about you and your
            competitors, then build the content and site fixes that get you
            recommended. One plan, {MONTHLY_PRICE} a month, numbers every week.
          </p>
        </FadeUp>

        {/* CTAs */}
        <FadeUp delay={300}>
          <div className="mt-10 flex flex-col sm:flex-row items-center justify-center gap-4">
            <a
              href={AUDIT_MAILTO}
              className="flex items-center gap-2 text-lg font-semibold text-white px-8 py-4 rounded-full bg-[var(--accent)] hover:bg-[var(--accent-hover)] transition-[background-color,box-shadow] shadow-lg hover:shadow-xl"
            >
              <Mail size={18} />
              Request a free visibility audit
            </a>
            <Link
              href="/methodology"
              className="flex items-center gap-2 text-lg font-medium text-white px-6 py-4 rounded-full border border-[rgba(255,255,255,0.25)] hover:border-white hover:bg-[rgba(255,255,255,0.05)] transition-[border-color,background-color]"
            >
              How we measure it
              <ArrowRight size={16} />
            </Link>
          </div>
          <p className="mt-4 text-sm text-[var(--text-muted)]">
            No sign-up. We run your questions and send you the numbers, whether or not you hire us.
          </p>
        </FadeUp>

        {/* Dashboard mockup */}
        <ScaleIn delay={400} className="mt-16 hidden sm:block">
          <DashboardMockup />
        </ScaleIn>
      </div>
    </section>
  );
}

function ModelsBar() {
  return (
    <section className="py-12 border-y border-[var(--border-subtle)]">
      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
        <FadeUp>
          <p className="text-center text-sm text-[var(--text-muted)] mb-6">Measured on all four, every week</p>
        </FadeUp>
        <div className="flex flex-wrap justify-center gap-3">
          {AI_MODELS.map((model, i) => (
            <FadeUp key={model.name} delay={i * 60}>
              <div
                className="flex items-center gap-2 bg-[var(--bg-raised)] border border-[var(--border-subtle)] rounded-full px-4 py-2 transition-[border-color]"
                onMouseEnter={(e) => {
                  e.currentTarget.style.borderColor = model.color;
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.borderColor = 'var(--border-subtle)';
                }}
              >
                <span
                  className="w-2 h-2 rounded-full"
                  style={{ backgroundColor: model.color }}
                />
                <span className="text-sm font-medium text-white">{model.name}</span>
              </div>
            </FadeUp>
          ))}
        </div>
      </div>
    </section>
  );
}

function FeaturesSection() {
  return (
    <section id="features" className="py-16 scroll-mt-20">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
        <FadeUp>
          <h2
            className="text-3xl sm:text-4xl font-bold text-center text-[var(--text-primary)] mb-4"
            style={{ fontFamily: 'var(--font-syne), system-ui, sans-serif' }}
          >
            What you get every month
          </h2>
        </FadeUp>
        <FadeUp delay={100}>
          <p className="text-center text-[var(--text-secondary)] mb-16 max-w-2xl mx-auto">
            We run the platform. You get a login, a weekly report, and the work done.
          </p>
        </FadeUp>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          {FEATURES.map((feature, i) => {
            const Icon = feature.icon;
            return (
              <FadeUp key={feature.title} delay={i * 80}>
                <div className="bg-[var(--bg-raised)] border border-[var(--border-subtle)] rounded-2xl p-5 md:p-7 h-full transition-[transform,border-color,box-shadow] duration-200 hover:-translate-y-1 hover:border-[rgba(95,126,166,0.3)] hover:shadow-[0_0_24px_rgba(95,126,166,0.15),0_8px_32px_rgba(0,0,0,0.3)]">
                  <div className="w-11 h-11 rounded-xl bg-[rgba(95,126,166,0.15)] flex items-center justify-center mb-4">
                    <Icon size={20} className="text-[var(--accent)]" />
                  </div>
                  <h3
                    className="text-lg font-semibold text-[var(--text-primary)] mb-2"
                    style={{ fontFamily: 'var(--font-syne), system-ui, sans-serif' }}
                  >
                    {feature.title}
                  </h3>
                  <p className="text-sm text-[var(--text-secondary)] leading-relaxed">
                    {feature.desc}
                  </p>
                </div>
              </FadeUp>
            );
          })}
        </div>
      </div>
    </section>
  );
}

function HowItWorksSection() {
  return (
    <section id="how" className="py-16 border-y border-[var(--border-subtle)] scroll-mt-20">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
        <FadeUp>
          <h2
            className="text-3xl sm:text-4xl font-bold text-center text-[var(--text-primary)] mb-16"
            style={{ fontFamily: 'var(--font-syne), system-ui, sans-serif' }}
          >
            How it works
          </h2>
        </FadeUp>

        <div className="space-y-12">
          {HOW_STEPS.map((step, i) => (
            <FadeUp key={step.n} delay={i * 150}>
              <div className="flex gap-6 sm:gap-8">
                {/* Number */}
                <div className="flex-shrink-0">
                  <span
                    className="text-6xl sm:text-7xl font-extrabold text-[var(--accent)]"
                    style={{ fontFamily: 'var(--font-syne), system-ui, sans-serif', lineHeight: 1 }}
                  >
                    {step.n}
                  </span>
                </div>

                {/* Content */}
                <div className="pt-2">
                  <div className="inline-flex items-center gap-2 bg-[rgba(95,126,166,0.1)] border border-[rgba(95,126,166,0.2)] rounded-full px-3 py-1 mb-3">
                    <span className="w-1.5 h-1.5 rounded-full bg-[var(--accent)]" />
                    <span className="text-xs font-semibold text-[var(--accent)]">Step {step.n}</span>
                  </div>
                  <h3
                    className="text-xl font-semibold text-[var(--text-primary)] mb-2"
                    style={{ fontFamily: 'var(--font-syne), system-ui, sans-serif' }}
                  >
                    {step.title}
                  </h3>
                  <p className="text-[var(--text-secondary)] leading-relaxed">{step.desc}</p>
                </div>
              </div>
            </FadeUp>
          ))}
        </div>
      </div>
    </section>
  );
}

function MethodologySection() {
  return (
    <section id="methodology" className="py-16 scroll-mt-20">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
        <FadeUp>
          <h2
            className="text-3xl sm:text-4xl font-bold text-center text-[var(--text-primary)] mb-4"
            style={{ fontFamily: 'var(--font-syne), system-ui, sans-serif' }}
          >
            Measured, not guessed
          </h2>
        </FadeUp>
        <FadeUp delay={100}>
          <p className="text-center text-[var(--text-secondary)] mb-12 max-w-2xl mx-auto">
            AI answers are not fixed. A score that ignores that is a number, not a measurement.
            Here is how ours is built.
          </p>
        </FadeUp>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {METHOD_POINTS.map((point, i) => {
            const Icon = point.icon;
            return (
              <FadeUp key={point.title} delay={i * 80}>
                <div className="bg-[var(--bg-raised)] border border-[var(--border-subtle)] rounded-2xl p-6 md:p-7 h-full flex gap-5">
                  <div className="w-11 h-11 flex-shrink-0 rounded-xl bg-[rgba(95,126,166,0.15)] flex items-center justify-center">
                    <Icon size={20} className="text-[var(--accent)]" />
                  </div>
                  <div>
                    <h3
                      className="text-lg font-semibold text-[var(--text-primary)] mb-2"
                      style={{ fontFamily: 'var(--font-syne), system-ui, sans-serif' }}
                    >
                      {point.title}
                    </h3>
                    <p className="text-sm text-[var(--text-secondary)] leading-relaxed">{point.desc}</p>
                  </div>
                </div>
              </FadeUp>
            );
          })}
        </div>

        <FadeUp delay={300}>
          <div className="mt-10 text-center">
            <Link
              href="/methodology"
              className="inline-flex items-center gap-2 text-base font-semibold text-white px-7 py-3 rounded-full border border-[rgba(255,255,255,0.25)] hover:border-white hover:bg-[rgba(255,255,255,0.05)] transition-[border-color,background-color]"
            >
              Read the full methodology, with sources
              <ArrowRight size={16} />
            </Link>
          </div>
        </FadeUp>
      </div>
    </section>
  );
}

function DashboardMockup() {
  const { ref: scoreRef, value: scoreVal } = useCountUp(67, 1600);
  const [barWidths, setBarWidths] = useState([0, 0, 0, 0]);
  const [compWidths, setCompWidths] = useState([0, 0]);
  const barTriggered = useRef(false);
  const { ref: barRef, inView: barInView } = useInView(0.2);

  useEffect(() => {
    if (!barInView || barTriggered.current) return;
    barTriggered.current = true;
    setTimeout(() => {
      setBarWidths(DEMO_MODELS.map((m) => m.score));
    }, 200);
    setTimeout(() => {
      setCompWidths([72, 38]);
    }, 400);
  }, [barInView]);

  // Sparkline data
  const sparkPoints = [28, 35, 31, 42, 38, 50, 47, 55, 52, 61, 67];
  const w = 200;
  const h = 48;
  const min = Math.min(...sparkPoints);
  const max = Math.max(...sparkPoints);
  const toX = (i: number) => (i / (sparkPoints.length - 1)) * w;
  const toY = (v: number) => h - ((v - min) / (max - min || 1)) * (h - 8) - 4;
  const pathD = sparkPoints.map((v, i) => `${i === 0 ? 'M' : 'L'} ${toX(i)} ${toY(v)}`).join(' ');
  const areaD = `${pathD} L ${w} ${h} L 0 ${h} Z`;

  return (
    <div
      ref={barRef}
      className="relative max-w-[720px] mx-auto"
      style={{
        perspective: '1000px',
      }}
    >
      <div
        className="bg-[var(--bg-raised)] border border-[rgba(95,126,166,0.2)] rounded-2xl overflow-hidden shadow-[0_32px_64px_rgba(0,0,0,0.5),0_0_0_1px_rgba(95,126,166,0.1)]"
        style={{
          transform: 'rotateX(2deg)',
        }}
      >
        {/* Browser chrome */}
        <div className="bg-[var(--bg-card)] border-b border-[var(--border-subtle)] px-4 py-3 flex items-center gap-2">
          <span className="w-3 h-3 rounded-full bg-[#ef4444]" />
          <span className="w-3 h-3 rounded-full bg-[#fbbf24]" />
          <span className="w-3 h-3 rounded-full bg-[#22c55e]" />
          <div className="flex-1 ml-3 bg-[var(--bg-raised)] rounded-md px-3 py-1.5">
            <span className="text-xs text-[var(--text-muted)]">lumidian.ai/dashboard</span>
            <span className="text-[10px] text-[var(--text-secondary)] ml-2 opacity-60">Example</span>
          </div>
        </div>

        {/* Dashboard content */}
        <div className="p-5 grid grid-cols-2 gap-4">
          {/* Visibility score card */}
          <div
            ref={scoreRef}
            className="rounded-2xl p-5 text-white"
            style={{ background: 'linear-gradient(135deg, var(--accent-hover), #3a5070)' }}
          >
            <p className="text-xs font-semibold uppercase tracking-wider opacity-70">AI Visibility Score</p>
            <p
              className="text-5xl font-extrabold mt-1"
              style={{ fontFamily: 'var(--font-syne), system-ui, sans-serif' }}
            >
              {scoreVal}<span className="text-2xl opacity-70">%</span>
            </p>
            <div className="flex items-center gap-1 mt-2 text-xs opacity-80">
              <TrendingUp size={12} />
              <span>+14 pts vs last week</span>
            </div>
          </div>

          {/* Sparkline card */}
          <div className="bg-[var(--bg-card)] border border-[var(--border-subtle)] rounded-2xl p-4">
            <p className="text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wider mb-3">90-Day Trend</p>
            <svg width="100%" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className="h-12">
              <defs>
                <linearGradient id="mockupSparkGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.3" />
                  <stop offset="100%" stopColor="var(--accent)" stopOpacity="0" />
                </linearGradient>
              </defs>
              <path d={areaD} fill="url(#mockupSparkGrad)" />
              <path d={pathD} fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>

          {/* Live search coverage */}
          <div className="col-span-2 bg-[var(--bg-card)] border border-[var(--border-subtle)] rounded-2xl p-4">
            <div className="flex items-center justify-between mb-3">
              <p className="text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wider">Live Web Search</p>
              <span className="inline-flex items-center gap-1.5 text-[10px] font-semibold text-[#22c55e] bg-[rgba(34,197,94,0.1)] border border-[rgba(34,197,94,0.2)] rounded-full px-2 py-0.5">
                <span className="relative flex h-1.5 w-1.5">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#22c55e] opacity-60" />
                  <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-[#22c55e]" />
                </span>
                All 4 active
              </span>
            </div>

            {/* Model pills */}
            <div className="grid grid-cols-4 gap-2 mb-4">
              {[
                { name: 'ChatGPT', color: '#10a37f', delay: 0 },
                { name: 'Claude', color: '#f97316', delay: 60 },
                { name: 'Perplexity', color: '#8b5cf6', delay: 120 },
                { name: 'Gemini', color: '#3b82f6', delay: 180 },
              ].map(({ name, color, delay }) => (
                <div
                  key={name}
                  className="flex flex-col items-center gap-1.5 bg-[rgba(255,255,255,0.04)] border border-[rgba(255,255,255,0.07)] rounded-xl py-2.5 px-1"
                  style={{
                    opacity: barInView ? 1 : 0,
                    transform: barInView ? 'scale(1)' : 'scale(0.92)',
                    transition: `opacity 0.3s cubic-bezier(0.23,1,0.32,1) ${delay}ms, transform 0.3s cubic-bezier(0.23,1,0.32,1) ${delay}ms`,
                  }}
                >
                  <span
                    className="w-2 h-2 rounded-full flex-shrink-0"
                    style={{ backgroundColor: color }}
                  />
                  <span className="text-[10px] font-medium text-[var(--text-secondary)] text-center leading-tight">{name}</span>
                  <Check size={10} className="text-[#22c55e]" strokeWidth={3} />
                </div>
              ))}
            </div>

            {/* Blurb */}
            <div className="pt-3 border-t border-[rgba(51,65,85,0.4)]">
              <p className="text-[11px] leading-relaxed text-[var(--text-muted)]">
                Every model is queried with live web search on, so the score reflects how your business appears in real answers this week.
              </p>
              <Link
                href="/methodology"
                className="inline-flex items-center gap-1 mt-2 text-[11px] font-medium text-[#8ba8cc] hover:text-[#a8c4e0] transition-colors duration-200"
              >
                See our methodology
                <ArrowRight className="w-3 h-3" />
              </Link>
            </div>
          </div>

          {/* Model breakdown */}
          <div className="col-span-2 bg-[var(--bg-card)] border border-[var(--border-subtle)] rounded-2xl p-4">
            <p className="text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wider mb-3">Performance by Model</p>
            <div className="space-y-2.5">
              {DEMO_MODELS.map((m, i) => (
                <div key={m.name} className="flex items-center gap-3">
                  <span className="text-xs font-medium text-[var(--text-secondary)] w-20 flex-shrink-0">{m.name}</span>
                  <div className="flex-1 h-2 bg-[var(--border-faint)] rounded-full overflow-hidden">
                    <div
                      className="h-full rounded-full transition-[width] duration-700"
                      style={{
                        width: `${barWidths[i]}%`,
                        backgroundColor: m.color,
                        transitionDelay: `${i * 100}ms`,
                      }}
                    />
                  </div>
                  <span className="text-xs font-bold text-[var(--text-primary)] w-10 text-right">{m.score}%</span>
                </div>
              ))}
            </div>
          </div>

          {/* Gaps */}
          <div className="col-span-2 bg-[rgba(251,146,60,0.1)] border border-[rgba(251,146,60,0.2)] rounded-2xl p-4">
            <div className="flex items-center gap-2 mb-3">
              <TrendingDown size={14} className="text-[#fbbf24]" />
              <p className="text-xs font-semibold text-[#fbbf24] uppercase tracking-wider">Questions you are losing</p>
            </div>
            <div className="space-y-2">
              {DEMO_GAPS.map((g) => (
                <div key={g.prompt} className="flex items-center justify-between">
                  <span className="text-sm text-[var(--text-secondary)]">&ldquo;{g.prompt}&rdquo;</span>
                  <span className="text-xs font-bold text-[#f87171] bg-[rgba(239,68,68,0.1)] px-2 py-0.5 rounded-full">
                    {g.score}%
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* Competitor comparison */}
          <div className="col-span-2 bg-[var(--bg-card)] border border-[var(--border-subtle)] rounded-2xl p-4">
            <p className="text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wider mb-3">vs Competitors</p>
            <div className="space-y-2.5">
              <div className="flex items-center gap-3">
                <span className="text-xs font-medium text-[var(--text-secondary)] w-24 flex-shrink-0">Your business</span>
                <div className="flex-1 h-2 bg-[var(--border-faint)] rounded-full overflow-hidden">
                  <div
                    className="h-full rounded-full transition-[width] duration-700"
                    style={{ width: `${compWidths[0]}%`, backgroundColor: 'var(--accent)' }}
                  />
                </div>
                <span className="text-xs font-bold text-[var(--text-primary)] w-10 text-right">72%</span>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-xs font-medium text-[var(--text-secondary)] w-24 flex-shrink-0">Competitor A</span>
                <div className="flex-1 h-2 bg-[var(--border-faint)] rounded-full overflow-hidden">
                  <div
                    className="h-full rounded-full transition-[width] duration-700"
                    style={{ width: `${compWidths[1]}%`, backgroundColor: 'var(--text-muted)', transitionDelay: '100ms' }}
                  />
                </div>
                <span className="text-xs font-bold text-[var(--text-primary)] w-10 text-right">38%</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function PricingSection() {
  return (
    <section id="pricing" className="py-16 border-t border-[var(--border-subtle)] scroll-mt-20">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
        <FadeUp>
          <h2
            className="text-3xl sm:text-4xl font-bold text-center text-[var(--text-primary)] mb-4"
            style={{ fontFamily: 'var(--font-syne), system-ui, sans-serif' }}
          >
            One plan, one price
          </h2>
        </FadeUp>
        <FadeUp delay={100}>
          <p className="text-center text-[var(--text-secondary)] mb-12 max-w-xl mx-auto">
            The work is the same for every client: measure, find the gaps, build the fixes.
            So there is one plan.
          </p>
        </FadeUp>

        <FadeUp delay={200}>
          <div className="bg-[var(--bg-raised)] border border-[rgba(95,126,166,0.3)] rounded-3xl overflow-hidden shadow-[0_0_48px_rgba(95,126,166,0.12)]">
            <div className="grid grid-cols-1 md:grid-cols-[1fr_1.4fr]">
              {/* Price column */}
              <div className="p-8 md:p-10 border-b md:border-b-0 md:border-r border-[var(--border-subtle)] flex flex-col">
                <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[var(--accent)] mb-3">
                  AI visibility, done for you
                </p>
                <div className="flex items-baseline gap-2">
                  <span
                    className="text-5xl sm:text-6xl font-extrabold text-[var(--text-primary)]"
                    style={{ fontFamily: 'var(--font-syne), system-ui, sans-serif', letterSpacing: '-0.02em' }}
                  >
                    {MONTHLY_PRICE}
                  </span>
                  <span className="text-lg text-[var(--text-muted)]">/ month</span>
                </div>
                <p className="mt-3 text-sm text-[var(--text-muted)] leading-relaxed">
                  Founding pricing. Three-month minimum, then cancel any time.
                  No setup fee.
                </p>

                <a
                  href={AUDIT_MAILTO}
                  className="mt-8 inline-flex items-center justify-center gap-2 text-base font-semibold text-white px-6 py-3.5 rounded-full bg-[var(--accent)] hover:bg-[var(--accent-hover)] transition-colors shadow-[0_0_24px_rgba(95,126,166,0.4)]"
                >
                  <Mail size={16} />
                  Start with a free audit
                </a>
                <p className="mt-3 text-xs text-[var(--text-muted)]">
                  We run your questions first. You decide after you see the numbers.
                </p>

                <div className="mt-auto pt-8">
                  <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[var(--text-muted)] mb-3">
                    Not included
                  </p>
                  <ul className="space-y-2">
                    {NOT_INCLUDED.map((item) => (
                      <li key={item} className="flex items-start gap-2.5 text-sm text-[var(--text-muted)]">
                        <X size={14} className="text-[#475569] flex-shrink-0 mt-[3px]" />
                        <span>{item}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>

              {/* Included column */}
              <div className="p-8 md:p-10">
                <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[var(--text-muted)] mb-5">
                  Every month
                </p>
                <ul className="space-y-4">
                  {INCLUDED.map((item) => (
                    <li key={item} className="flex items-start gap-3 text-[15px] text-[var(--text-secondary)] leading-relaxed">
                      <span className="w-5 h-5 flex-shrink-0 rounded-full bg-[rgba(34,197,94,0.12)] flex items-center justify-center mt-[2px]">
                        <Check size={12} className="text-[#22c55e]" strokeWidth={3} />
                      </span>
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>

                <div className="mt-8 pt-6 border-t border-[var(--border-subtle)]">
                  <p className="text-sm text-[var(--text-muted)] leading-relaxed">
                    One sentence in the contract: we make AI assistants recommend you;
                    your existing marketing keeps doing the rest.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </FadeUp>

        <FadeUp delay={300}>
          <p className="mt-8 text-center text-sm text-[var(--text-muted)]">
            Software-only access is available to a small number of accounts by arrangement.{' '}
            <a href={`mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent('Software access')}`} className="text-[var(--accent)] hover:underline">
              Email us
            </a>{' '}
            if that is what you need.
          </p>
        </FadeUp>
      </div>
    </section>
  );
}

function FAQItem({
  item,
  isOpen,
  onToggle,
  delay,
}: {
  item: { q: string; a: string };
  isOpen: boolean;
  onToggle: () => void;
  delay: number;
}) {
  return (
    <FadeUp delay={delay}>
      <div
        className={`border-b border-[var(--border-subtle)] transition-[background-color,padding] ${isOpen ? 'bg-[rgba(95,126,166,0.04)] pl-4' : ''}`}
      >
        <button
          onClick={onToggle}
          className="w-full py-5 flex items-center justify-between text-left hover:bg-[rgba(255,255,255,0.02)] transition-colors rounded min-h-[48px]"
          aria-expanded={isOpen}
        >
          <span className="text-base font-medium text-[var(--text-primary)] pr-4">{item.q}</span>
          <ChevronDown
            size={20}
            className={`text-[var(--text-muted)] flex-shrink-0 transition-transform duration-300 ${isOpen ? 'rotate-180' : ''}`}
          />
        </button>
        <div
          className={`overflow-hidden transition-[max-height] duration-300 ${isOpen ? 'max-h-96 pb-5' : 'max-h-0'}`}
        >
          <p className="text-sm text-[var(--text-secondary)] leading-relaxed">{item.a}</p>
        </div>
      </div>
    </FadeUp>
  );
}

function FAQSection() {
  const [openIndex, setOpenIndex] = useState<number | null>(null);

  return (
    <section id="faq" className="py-16 border-t border-[var(--border-subtle)] scroll-mt-20">
      <div className="max-w-2xl mx-auto px-4 sm:px-6 lg:px-8">
        <FadeUp>
          <h2
            className="text-3xl sm:text-4xl font-bold text-center text-[var(--text-primary)] mb-12"
            style={{ fontFamily: 'var(--font-syne), system-ui, sans-serif' }}
          >
            Questions we get asked
          </h2>
        </FadeUp>

        <div>
          {FAQ_ITEMS.map((item, i) => (
            <FAQItem
              key={i}
              item={item}
              isOpen={openIndex === i}
              onToggle={() => setOpenIndex(openIndex === i ? null : i)}
              delay={i * 60}
            />
          ))}
        </div>
      </div>
    </section>
  );
}

function CTASection() {
  return (
    <section
      className="py-32 text-center relative"
      style={{
        background: 'radial-gradient(ellipse at 50% 100%, rgba(95,126,166,0.15) 0%, transparent 60%)',
      }}
    >
      {/* Animated gradient orb */}
      <div
        className="absolute inset-0 pointer-events-none overflow-hidden"
      >
        <div
          className="absolute w-[600px] h-[600px] rounded-full opacity-20 blur-[120px]"
          style={{
            background: 'radial-gradient(circle, var(--accent) 0%, var(--accent-hover) 50%, transparent 70%)',
            left: '50%',
            top: '50%',
            transform: 'translate(-50%, -50%)',
            animation: 'ctaOrb 10s ease-in-out infinite',
          }}
        />
      </div>
      <div className="max-w-2xl mx-auto px-4 sm:px-6 lg:px-8">
        <FadeUp>
          <h2
            className="text-3xl sm:text-4xl font-bold text-[var(--text-primary)] mb-4"
            style={{ fontFamily: 'var(--font-syne), system-ui, sans-serif' }}
          >
            Find out what AI says about you this week
          </h2>
        </FadeUp>
        <FadeUp delay={100}>
          <p className="text-[var(--text-secondary)] mb-8">
            Send us your business name and website. We run your questions across
            four AI assistants and send you the numbers. No sign-up, no dashboard to set up.
          </p>
        </FadeUp>
        <FadeUp delay={200}>
          <a
            href={AUDIT_MAILTO}
            className="inline-flex items-center gap-2 text-lg font-semibold text-white px-8 py-4 rounded-full bg-[var(--accent)] hover:bg-[var(--accent-hover)] transition-[background-color,box-shadow] shadow-lg hover:shadow-xl"
          >
            <Mail size={18} />
            Request a free audit
          </a>
          <p className="mt-4 text-sm text-[var(--text-muted)]">
            Or write to{' '}
            <a href={`mailto:${CONTACT_EMAIL}`} className="text-[var(--text-secondary)] hover:text-white underline underline-offset-4">
              {CONTACT_EMAIL}
            </a>
          </p>
        </FadeUp>
      </div>
    </section>
  );
}

function Footer() {
  return (
    <footer className="py-16 border-t border-[var(--border-subtle)]">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-8 mb-12">
          {/* Logo & tagline */}
          <div className="col-span-2 md:col-span-1">
            <LumidianLogo size={28} withWordmark variant="dark" />
            <p className="text-sm text-[var(--text-muted)] mt-3">
              We track what AI says about your business, then fix it.
            </p>
          </div>

          {/* Site */}
          <div>
            <h4 className="text-sm font-semibold text-[var(--text-primary)] mb-4">Site</h4>
            <nav className="space-y-3">
              <a href="#features" className="block text-sm text-[var(--text-secondary)] hover:text-white transition-colors">What you get</a>
              <a href="#how" className="block text-sm text-[var(--text-secondary)] hover:text-white transition-colors">How it works</a>
              <Link href="/methodology" className="block text-sm text-[var(--text-secondary)] hover:text-white transition-colors">Methodology</Link>
              <a href="#pricing" className="block text-sm text-[var(--text-secondary)] hover:text-white transition-colors">Pricing</a>
              <a href="#faq" className="block text-sm text-[var(--text-secondary)] hover:text-white transition-colors">FAQ</a>
            </nav>
          </div>

          {/* Company */}
          <div>
            <h4 className="text-sm font-semibold text-[var(--text-primary)] mb-4">Company</h4>
            <nav className="space-y-3">
              <Link href="/terms" className="block text-sm text-[var(--text-secondary)] hover:text-white transition-colors">Terms</Link>
              <Link href="/privacy" className="block text-sm text-[var(--text-secondary)] hover:text-white transition-colors">Privacy</Link>
            </nav>
          </div>

          {/* Contact */}
          <div>
            <h4 className="text-sm font-semibold text-[var(--text-primary)] mb-4">Contact</h4>
            <nav className="space-y-3">
              <a href={AUDIT_MAILTO} className="block text-sm text-[var(--text-secondary)] hover:text-white transition-colors">Request an audit</a>
              <a href={`mailto:${CONTACT_EMAIL}`} className="block text-sm text-[var(--text-secondary)] hover:text-white transition-colors">{CONTACT_EMAIL}</a>
              <Link href="/login" className="block text-sm text-[var(--text-secondary)] hover:text-white transition-colors">Client log in</Link>
            </nav>
          </div>
        </div>

        {/* Bottom bar */}
        <div className="pt-8 border-t border-[var(--border-subtle)]">
          <p className="text-sm text-[var(--text-muted)] text-center">
            &copy; {new Date().getFullYear()} Lumidian. All rights reserved.
          </p>
        </div>
      </div>
    </footer>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN PAGE
// ═══════════════════════════════════════════════════════════════════════════════

export default function LandingPage() {
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const handler = () => setScrolled(window.scrollY > 20);
    window.addEventListener('scroll', handler, { passive: true });
    return () => window.removeEventListener('scroll', handler);
  }, []);

  return (
    <div className="min-h-screen bg-[var(--bg-base)] text-[var(--text-primary)] relative">
      <Header scrolled={scrolled} />
      <main>
        <HeroSection />
        <ModelsBar />
        <FeaturesSection />
        <HowItWorksSection />
        <MethodologySection />
        <PricingSection />
        <FAQSection />
        <CTASection />
      </main>
      <Footer />

      {/* Dot grid spanning Hero + ModelsBar + Features, fading out at the edges */}
      <div
        className="absolute top-0 left-0 right-0 pointer-events-none"
        style={{
          height: 'calc(100vh + 600px)',
          backgroundImage: 'radial-gradient(circle, rgba(148,163,184,0.8) 1px, transparent 1px)',
          backgroundSize: '32px 32px',
          opacity: 0.15,
          maskImage: 'linear-gradient(to bottom, transparent 0%, black 8%, black 75%, transparent 100%)',
          WebkitMaskImage: 'linear-gradient(to bottom, transparent 0%, black 8%, black 75%, transparent 100%)',
        }}
      />

      {/* Dot grid over the CTA section, fading in and out */}
      <div
        className="absolute bottom-0 left-0 right-0 pointer-events-none"
        style={{
          height: '500px',
          backgroundImage: 'radial-gradient(circle, rgba(148,163,184,0.8) 1px, transparent 1px)',
          backgroundSize: '32px 32px',
          opacity: 0.1,
          maskImage: 'linear-gradient(to bottom, transparent 0%, black 30%, black 70%, transparent 100%)',
          WebkitMaskImage: 'linear-gradient(to bottom, transparent 0%, black 30%, black 70%, transparent 100%)',
        }}
      />
    </div>
  );
}
