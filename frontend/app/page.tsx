'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
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
  Play,
  Menu,
  X,
  Users,
  Activity,
} from 'lucide-react';
import LumidianLogo from '@/components/LumidianLogo';
import { TIER_DISPLAY_NAMES, TIER_PRICES } from '@/lib/tiers';
import { useInView, FadeUp, ScaleIn } from '@/lib/motion';
import { Container } from '@/components/ui/container';
import { Heading } from '@/components/ui/heading';
import { Card } from '@/components/ui/card';

// ═══════════════════════════════════════════════════════════════════════════════
// ANIMATION HOOKS
// ═══════════════════════════════════════════════════════════════════════════════

// Local useCountUp — returns { ref, value: number } shape used by DashboardMockup.
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

const FEATURES = [
  {
    icon: BarChart2,
    title: 'Track AI Visibility',
    desc: 'Monitor how often your brand appears in ChatGPT, Claude, Perplexity, and Gemini responses.',
  },
  {
    icon: Target,
    title: 'Identify Gaps',
    desc: 'See exactly which prompts miss your brand, which competitors appear instead, and where to focus.',
  },
  {
    icon: Sparkles,
    title: 'Auto-Draft Content',
    desc: 'Platform-specific drafts generated for every gap — Reddit posts, Quora answers, LinkedIn articles, X threads, Medium articles, and Wikipedia edits.',
  },
  {
    icon: TrendingUp,
    title: 'Monitor Trends',
    desc: 'Track visibility changes over time with trend charts, shareable PDF reports, and email alerts when your score drops.',
  },
  {
    icon: MessageSquare,
    title: 'Visibility Opportunities',
    desc: 'Surface live threads and discussions across Reddit, Quora, LinkedIn, and X where your brand can contribute — scored by relevance.',
  },
  {
    icon: Settings2,
    title: 'Brand Voice Control',
    desc: 'Define your tone and guidelines so every draft matches your brand exactly.',
  },
  {
    icon: Users,
    title: 'Competitor Intelligence',
    desc: 'Track how often competitors appear alongside your brand. Compare mention rates, share of voice, and see who\'s winning each prompt.',
  },
  {
    icon: Activity,
    title: 'Sentiment & Position',
    desc: 'Know whether AI models describe your brand positively, neutrally, or negatively — and where you appear in the response.',
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
    title: 'Track Your Visibility',
    desc: 'Connect your brand and set prompts. We query all four AI models daily and score how often you appear.',
  },
  {
    n: '2',
    title: 'Identify the Gaps',
    desc: 'See exactly which prompts miss your brand and what competitors get mentioned instead.',
  },
  {
    n: '3',
    title: 'Close the Gaps',
    desc: 'We generate targeted drafts for Reddit, Quora, LinkedIn, X, Medium, and Wikipedia — each one aimed at prompts where your brand is missing. Review, edit, and post.',
  },
];

const COMPARISON_FEATURES = [
  { label: 'Brands', free: '1 (30-day)', basic: '1', starter: '1', pro: '2' },
  { label: 'Prompts per brand', free: '10', basic: '10', starter: '25', pro: '30' },
  { label: 'Manual runs per day', free: '1', basic: '2', starter: '3', pro: 'Unlimited' },
  { label: 'AI models monitored', free: '3', basic: '4 (enhanced search)', starter: '4 (enhanced search)', pro: '4 (enhanced search)' },
  { label: 'Daily tracking', free: true, basic: true, starter: true, pro: true },
  { label: 'Visibility score & report', free: true, basic: true, starter: true, pro: true },
  { label: 'Content Hub & drafting', free: true, basic: true, starter: true, pro: true },
  { label: 'Content drafts', free: '5', basic: '10', starter: 'Unlimited', pro: 'Unlimited' },
  { label: 'LinkedIn & X drafts', free: false, basic: true, starter: true, pro: true },
  { label: 'Gap analysis', free: true, basic: true, starter: true, pro: true },
  { label: 'Brand profile & voice', free: true, basic: true, starter: true, pro: true },
  { label: 'Opportunity scanner', free: false, basic: '5/week', starter: '10/week', pro: '25/week' },
  { label: 'Trend charts', free: true, basic: true, starter: true, pro: true },
  { label: 'Email alerts', free: true, basic: true, starter: true, pro: true },
  { label: 'Competitors per brand', free: '3', basic: '3', starter: '5', pro: '15' },
  { label: 'Team members', free: '—', basic: '—', starter: '1', pro: '3' },
  { label: 'Support', free: 'Community', basic: 'Email', starter: 'Email', pro: 'Priority' },
];

const FAQ_ITEMS = [
  {
    q: 'How does Lumidian track AI visibility?',
    a: 'Lumidian runs your tracked prompts across ChatGPT, Claude, Perplexity, and Gemini daily, analyzing each response to detect whether your brand is mentioned. Results are scored and stored so you can track changes over time.',
  },
  {
    q: 'What kind of content does Lumidian draft?',
    a: 'Lumidian generates Reddit posts, Quora answers, LinkedIn articles, X threads, Medium articles, and Wikipedia edits — all targeted at prompts where your brand has low visibility. Every draft follows your brand voice guidelines.',
  },
  {
    q: 'Is the content AI-generated or human-written?',
    a: 'Drafts are AI-generated but always require your approval before posting. You can edit any draft before approving it. Nothing is posted automatically.',
  },
  {
    q: 'How long does it take to see results?',
    a: 'Most brands see measurable visibility improvements within 4 to 8 weeks of consistent content posting. AI models update their responses as new authoritative content appears across the web.',
  },
  {
    q: 'Is my brand data private?',
    a: 'Yes. Your brand profile, prompts, and tracking data are only visible to your account. We never share individual client data.',
  },
  {
    q: 'What makes Lumidian different from SEO tools?',
    a: "Traditional SEO tools track Google rankings. Lumidian tracks what AI models say about your brand — a fundamentally different signal that SEO tools don't measure.",
  },
];

const DEMO_MODELS = [
  { name: 'Perplexity', score: 78, color: 'var(--color-perplexity)' },
  { name: 'ChatGPT', score: 72, color: 'var(--color-chatgpt)' },
  { name: 'Claude', score: 61, color: 'var(--color-claude)' },
  { name: 'Gemini', score: 55, color: 'var(--color-gemini)' },
];

const DEMO_GAPS = [
  { prompt: 'best tools for [your industry]', score: 12 },
  { prompt: 'top solutions in [your category]', score: 18 },
  { prompt: 'recommended [your product type]', score: 21 },
];

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION COMPONENTS (placeholders - will be implemented in subsequent tasks)
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
      <Container width="wide">
        <div className="flex items-center justify-between h-16">
          {/* Logo */}
          <Link href="/" className="flex items-center">
            <LumidianLogo size={32} withWordmark variant="dark" />
          </Link>

          {/* Desktop nav */}
          <nav className="hidden md:flex items-center gap-8">
            <a href="#features" className="text-sm font-medium text-[var(--text-secondary)] hover:text-white transition-colors">
              Features
            </a>
            <a href="#pricing" className="text-sm font-medium text-[var(--text-secondary)] hover:text-white transition-colors">
              Pricing
            </a>
            <a href="#faq" className="text-sm font-medium text-[var(--text-secondary)] hover:text-white transition-colors">
              FAQ
            </a>
          </nav>

          {/* Desktop CTAs */}
          <div className="hidden md:flex items-center gap-3">
            <Link
              href="/login"
              className="text-sm font-medium text-white px-4 py-2 rounded-full border border-[rgba(255,255,255,0.2)] hover:border-white transition-colors"
            >
              Log in
            </Link>
            <Link
              href="/register"
              className="text-sm font-semibold text-white px-5 py-2.5 rounded-full bg-[var(--accent)] hover:bg-[var(--accent-hover)] transition-colors shadow-lg"
            >
              Get Started
            </Link>
          </div>

          {/* Mobile menu button */}
          <button
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            className="md:hidden p-2 text-[var(--text-secondary)] hover:text-white"
          >
            {mobileMenuOpen ? <X size={24} /> : <Menu size={24} />}
          </button>
        </div>

        {/* Mobile menu */}
        {mobileMenuOpen && (
          <div className="md:hidden py-4 border-t border-[var(--border-subtle)]">
            <nav className="flex flex-col gap-1">
              <a href="#features" onClick={() => setMobileMenuOpen(false)} className="text-base font-medium text-[var(--text-secondary)] hover:text-white py-3 px-2 rounded-lg hover:bg-[rgba(255,255,255,0.05)] transition-colors">Features</a>
              <a href="#pricing" onClick={() => setMobileMenuOpen(false)} className="text-base font-medium text-[var(--text-secondary)] hover:text-white py-3 px-2 rounded-lg hover:bg-[rgba(255,255,255,0.05)] transition-colors">Pricing</a>
              <a href="#faq" onClick={() => setMobileMenuOpen(false)} className="text-base font-medium text-[var(--text-secondary)] hover:text-white py-3 px-2 rounded-lg hover:bg-[rgba(255,255,255,0.05)] transition-colors">FAQ</a>
              <div className="flex flex-col gap-3 pt-4 mt-2 border-t border-[var(--border-subtle)]">
                <Link href="/login" className="text-base font-medium text-white text-center py-3 rounded-full border border-[rgba(255,255,255,0.2)]">
                  Log in
                </Link>
                <Link href="/register" className="text-base font-semibold text-white text-center py-3.5 rounded-full bg-[var(--accent)]">
                  Get Started
                </Link>
              </div>
            </nav>
          </div>
        )}
      </Container>
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
          background: 'radial-gradient(ellipse at 50% 0%, var(--accent-15) 0%, transparent 60%)',
        }}
      />


      <Container width="default" className="relative z-10 text-center">
        {/* Badge */}
        <FadeUp>
          <div className="inline-flex items-center gap-2 bg-[var(--bg-raised)] border border-[var(--accent-30)] rounded-full px-4 py-1.5 mb-8">
            <span className="w-2 h-2 rounded-full bg-[#22c55e] animate-pulse" />
            <span className="text-sm text-[var(--text-secondary)]">Now tracking 4 AI models</span>
          </div>
        </FadeUp>

        {/* Headline */}
        <FadeUp delay={100}>
          <Heading level="display" as="h1">
            Track Your Brand&apos;s
            <br />
            <span className="text-[var(--accent)]">
              Visibility in AI
            </span>
            {' — Then Fix It'}
          </Heading>
        </FadeUp>

        {/* Subhead */}
        <FadeUp delay={200}>
          <p className="mt-6 text-lg sm:text-xl text-[var(--text-secondary)] max-w-2xl mx-auto leading-relaxed">
            Monitor how ChatGPT, Claude, Perplexity, and Gemini talk about your brand.
            Find where you&apos;re missing — then fix it with targeted, AI-drafted content.
          </p>
        </FadeUp>

        {/* CTAs */}
        <FadeUp delay={300}>
          <div className="mt-10 flex flex-col sm:flex-row items-center justify-center gap-4">
            <Link
              href="/register"
              className="flex items-center gap-2 text-lg font-semibold text-white px-8 py-4 rounded-full bg-[var(--accent)] hover:bg-[var(--accent-hover)] transition-[background-color,box-shadow] shadow-lg hover:shadow-xl"
            >
              <Play size={18} fill="white" />
              Start Free
            </Link>
            <Link
              href="/login"
              className="text-lg font-medium text-white px-6 py-4 rounded-full border border-[rgba(255,255,255,0.25)] hover:border-white hover:bg-[rgba(255,255,255,0.05)] transition-[border-color,background-color]"
            >
              Log in
            </Link>
          </div>
        </FadeUp>

        {/* Dashboard mockup */}
        <ScaleIn delay={400} className="mt-16 hidden sm:block">
          <DashboardMockup />
        </ScaleIn>
      </Container>
    </section>
  );
}

function ModelsBar() {
  return (
    <section className="py-12 border-y border-[var(--border-subtle)]">
      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
        <FadeUp>
          <p className="text-center text-sm text-[var(--text-muted)] mb-6">Tracking visibility across</p>
        </FadeUp>
        <div className="flex flex-wrap justify-center gap-3">
          {AI_MODELS.map((model, i) => (
            <FadeUp key={model.name} delay={i * 60}>
              <div
                className="flex items-center gap-2 bg-[var(--bg-raised)] border border-[var(--border-subtle)] rounded-full px-4 py-2 transition-[border-color] hover:border-opacity-100"
                style={{
                  ['--model-color' as string]: model.color,
                }}
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
            Everything you need to dominate AI visibility
          </h2>
        </FadeUp>
        <FadeUp delay={100}>
          <p className="text-center text-[var(--text-secondary)] mb-16 max-w-2xl mx-auto">
            Track, analyze, and improve how AI models talk about your brand.
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
    <section className="py-16 border-y border-[var(--border-subtle)]">
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
            <span className="text-xs text-[var(--text-muted)]">app.lumidian.ai/dashboard</span>
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
              <span>+14% vs last run</span>
            </div>
          </div>

          {/* Sparkline card */}
          <div className="bg-[var(--bg-card)] border border-[var(--border-subtle)] rounded-2xl p-4">
            <p className="text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wider mb-3">30-Day Trend</p>
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
                Lumidian queries each AI assistant — ChatGPT, Claude, Perplexity, and Gemini — with live web search enabled, so your scores reflect how your brand actually appears in real answers today.
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

          {/* Citation gaps */}
          <div className="col-span-2 bg-[rgba(251,146,60,0.1)] border border-[rgba(251,146,60,0.2)] rounded-2xl p-4">
            <div className="flex items-center gap-2 mb-3">
              <TrendingDown size={14} className="text-[#fbbf24]" />
              <p className="text-xs font-semibold text-[#fbbf24] uppercase tracking-wider">Top Citation Gaps</p>
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
                <span className="text-xs font-medium text-[var(--text-secondary)] w-24 flex-shrink-0">Your Brand</span>
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

function PricingCell({ value }: { value: string | boolean }) {
  if (value === true) return <span className="text-[#22c55e] font-bold text-base">&#10003;</span>;
  if (value === false) return <span className="text-[var(--text-muted)]">—</span>;
  return <span className="text-sm text-[var(--text-secondary)]">{value}</span>;
}

function PricingSection() {
  const [mobileTier, setMobileTier] = useState<'free' | 'basic' | 'starter' | 'pro'>('pro');

  const tierMeta: Record<string, { name: string; price: string }> = {
    free: { name: 'Free Plan', price: '$0' },
    basic: { name: `${TIER_DISPLAY_NAMES.basic} Plan`, price: `${TIER_PRICES.basic}/mo` },
    starter: { name: `${TIER_DISPLAY_NAMES.starter} Plan`, price: `${TIER_PRICES.starter}/mo` },
    pro: { name: `${TIER_DISPLAY_NAMES.pro} Plan`, price: `${TIER_PRICES.pro}/mo` },
  };

  return (
    <section id="pricing" className="py-16 scroll-mt-20">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
        <FadeUp>
          <h2
            className="text-3xl sm:text-4xl font-bold text-center text-[var(--text-primary)] mb-4"
            style={{ fontFamily: 'var(--font-syne), system-ui, sans-serif' }}
          >
            Simple, transparent pricing
          </h2>
        </FadeUp>
        <FadeUp delay={100}>
          <p className="text-center text-[var(--text-secondary)] mb-12">
            Start free. Upgrade when you need more.
          </p>
        </FadeUp>

        {/* Desktop table */}
        <FadeUp delay={200}>
          <div className="hidden md:block overflow-x-auto">
            <table className="w-full border-collapse" style={{ minWidth: 500 }}>
              <thead>
                <tr className="bg-[var(--bg-card)]">
                  <th className="text-left text-sm font-semibold text-[var(--text-primary)] p-3 md:p-4 rounded-tl-xl sticky left-0 bg-[var(--bg-card)] z-10">Feature</th>
                  <th className="text-center text-sm font-semibold text-[var(--text-primary)] p-4">Free</th>
                  <th className="text-center text-sm font-semibold text-[var(--text-primary)] p-4">Starter</th>
                  <th className="text-center text-sm font-semibold text-[var(--text-primary)] p-4">Growth</th>
                  <th className="text-center text-sm font-semibold text-[var(--text-primary)] p-4 rounded-tr-xl bg-[rgba(95,126,166,0.2)] border-b-2 border-[var(--accent)]">
                    Pro
                  </th>
                </tr>
              </thead>
              <tbody>
                {COMPARISON_FEATURES.map((row, i) => (
                  <tr
                    key={row.label}
                    className={`${i % 2 === 0 ? 'bg-[var(--bg-raised)]' : 'bg-[var(--bg-base)]'} hover:bg-[rgba(95,126,166,0.05)] transition-colors`}
                  >
                    <td className="text-sm text-[var(--text-primary)] p-3 md:p-4 sticky left-0 z-10" style={{ background: i % 2 === 0 ? 'var(--bg-raised)' : 'var(--bg-base)' }}>{row.label}</td>
                    <td className="text-center p-4"><PricingCell value={row.free} /></td>
                    <td className="text-center p-4"><PricingCell value={row.basic} /></td>
                    <td className="text-center p-4"><PricingCell value={row.starter} /></td>
                    <td className="text-center p-4 bg-[rgba(95,126,166,0.05)] border-l border-r border-[rgba(95,126,166,0.2)]">
                      <PricingCell value={row.pro} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </FadeUp>

        {/* Mobile tab switcher */}
        <FadeUp delay={200}>
          <div className="md:hidden">
            {/* Tabs */}
            <div className="flex gap-2 mb-6 bg-[var(--bg-raised)] rounded-full p-1 border border-[var(--border-subtle)]">
              {(['free', 'basic', 'starter', 'pro'] as const).map((tier) => (
                <button
                  key={tier}
                  onClick={() => setMobileTier(tier)}
                  className={`flex-1 py-2.5 text-sm font-semibold rounded-full transition-[background-color,color,box-shadow] ${
                    mobileTier === tier
                      ? 'bg-[var(--accent)] text-white shadow-[0_0_12px_rgba(95,126,166,0.4)]'
                      : 'text-[var(--text-secondary)] hover:text-white'
                  }`}
                >
                  {tierMeta[tier].name.replace(' Plan', '')}
                </button>
              ))}
            </div>

            {/* Card */}
            <div className="bg-[var(--bg-raised)] border border-[var(--border-subtle)] rounded-2xl p-6">
              <p
                className="text-lg font-bold text-[var(--text-primary)] mb-1"
                style={{ fontFamily: 'var(--font-syne), system-ui, sans-serif' }}
              >
                {tierMeta[mobileTier].name}
              </p>
              <p className="text-3xl font-extrabold text-[var(--text-primary)] mb-6" style={{ fontFamily: 'var(--font-syne), system-ui, sans-serif' }}>
                {tierMeta[mobileTier].price}
              </p>

              <div className="space-y-3">
                {COMPARISON_FEATURES.map((row) => {
                  const val = row[mobileTier as keyof typeof row];
                  const isTrue = val === true;
                  const isFalse = val === false || val === '—';
                  return (
                    <div key={row.label} className="flex items-center gap-3">
                      {isTrue ? (
                        <Check size={16} className="text-[#22c55e] flex-shrink-0" />
                      ) : isFalse ? (
                        <X size={16} className="text-[#475569] flex-shrink-0" />
                      ) : (
                        <Check size={16} className="text-[#22c55e] flex-shrink-0" />
                      )}
                      <span className={`text-sm ${isFalse ? 'text-[#475569]' : 'text-[var(--text-secondary)]'}`}>
                        {typeof val === 'string' && val !== '—' ? `${val} — ${row.label}` : row.label}
                      </span>
                    </div>
                  );
                })}
              </div>

              <Link
                href="/register"
                className="mt-6 w-full inline-flex items-center justify-center gap-2 text-base font-semibold text-white py-3 rounded-full bg-[var(--accent)] hover:bg-[var(--accent-hover)] transition-colors shadow-[0_0_24px_rgba(95,126,166,0.4)]"
              >
                Get started free
                <ArrowRight size={16} />
              </Link>
            </div>
          </div>
        </FadeUp>

        <FadeUp delay={300}>
          <div className="mt-8 text-center hidden md:block">
            <Link
              href="/register"
              className="inline-flex items-center gap-2 text-base font-semibold text-white px-8 py-3 rounded-full bg-[var(--accent)] hover:bg-[var(--accent-hover)] transition-colors shadow-[0_0_24px_rgba(95,126,166,0.4)]"
            >
              Get started free
              <ArrowRight size={16} />
            </Link>
          </div>
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
            Frequently asked questions
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
            Start tracking your AI visibility
          </h2>
        </FadeUp>
        <FadeUp delay={100}>
          <p className="text-[var(--text-secondary)] mb-8">
            Free to start. No credit card required.
          </p>
        </FadeUp>
        <FadeUp delay={200}>
          <Link
            href="/register"
            className="inline-flex items-center gap-2 text-lg font-semibold text-white px-8 py-4 rounded-full bg-[var(--accent)] hover:bg-[var(--accent-hover)] transition-[background-color,box-shadow] shadow-lg hover:shadow-xl"
          >
            Get Started Free
            <ArrowRight size={18} />
          </Link>
        </FadeUp>
      </div>
    </section>
  );
}

function Footer() {
  return (
    <footer className="py-20 sm:py-28 border-t border-[var(--border-subtle)]">
      <Container width="wide">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-8 mb-12">
          {/* Logo & tagline */}
          <div className="col-span-2 md:col-span-1">
            <LumidianLogo size={28} withWordmark variant="dark" />
            <p className="text-sm text-[var(--text-muted)] mt-3">
              AI visibility tracking for modern brands.
            </p>
          </div>

          {/* Product */}
          <div>
            <h4 className="text-sm font-semibold text-[var(--text-primary)] mb-4">Product</h4>
            <nav className="space-y-3">
              <a href="#features" className="block text-sm text-[var(--text-secondary)] hover:text-white transition-colors">Features</a>
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

          {/* Get Started */}
          <div>
            <h4 className="text-sm font-semibold text-[var(--text-primary)] mb-4">Get Started</h4>
            <nav className="space-y-3">
              <Link href="/register" className="block text-sm text-[var(--text-secondary)] hover:text-white transition-colors">Sign up</Link>
              <Link href="/login" className="block text-sm text-[var(--text-secondary)] hover:text-white transition-colors">Log in</Link>
            </nav>
          </div>
        </div>

        {/* Bottom bar */}
        <div className="pt-8 border-t border-[var(--border-subtle)]">
          <p className="text-sm text-[var(--text-muted)] text-center">
            &copy; {new Date().getFullYear()} Lumidian. All rights reserved.
          </p>
        </div>
      </Container>
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
        <PricingSection />
        <FAQSection />
        <CTASection />
      </main>
      <Footer />

      {/* Dot grid — spans Hero + ModelsBar + Features, fades out at edges */}
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

      {/* Dot grid — CTA section area, fades in and out */}
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
