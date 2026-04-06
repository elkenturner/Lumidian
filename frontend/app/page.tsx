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
} from 'lucide-react';
import LumidianLogo from '@/components/LumidianLogo';

// ═══════════════════════════════════════════════════════════════════════════════
// ANIMATION HOOKS
// ═══════════════════════════════════════════════════════════════════════════════

function useInView(threshold = 0.1, rootMargin = '50px') {
  const ref = useRef<HTMLDivElement>(null);
  const [inView, setInView] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const rect = el.getBoundingClientRect();
    if (rect.top < window.innerHeight * 0.85) {
      setInView(true);
      return;
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setInView(true);
          observer.disconnect();
        }
      },
      { threshold, rootMargin }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [threshold, rootMargin]);

  return { ref, inView };
}

function useCountUp(target: number, duration = 1800) {
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

function FadeUp({
  children,
  delay = 0,
  className = '',
}: {
  children: React.ReactNode;
  delay?: number;
  className?: string;
}) {
  const { ref, inView } = useInView();
  return (
    <div
      ref={ref}
      className={className}
      style={{
        opacity: inView ? 1 : 0,
        transform: inView ? 'translateY(0)' : 'translateY(30px)',
        transition: `opacity 0.6s cubic-bezier(0.16, 1, 0.3, 1) ${delay}ms, transform 0.6s cubic-bezier(0.16, 1, 0.3, 1) ${delay}ms`,
        willChange: 'opacity, transform',
      }}
    >
      {children}
    </div>
  );
}

function ScaleIn({
  children,
  delay = 0,
  className = '',
}: {
  children: React.ReactNode;
  delay?: number;
  className?: string;
}) {
  const { ref, inView } = useInView();
  return (
    <div
      ref={ref}
      className={className}
      style={{
        opacity: inView ? 1 : 0,
        transform: inView ? 'scale(1)' : 'scale(0.95)',
        transition: `opacity 0.5s cubic-bezier(0.16, 1, 0.3, 1) ${delay}ms, transform 0.5s cubic-bezier(0.16, 1, 0.3, 1) ${delay}ms`,
        willChange: 'opacity, transform',
      }}
    >
      {children}
    </div>
  );
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
    desc: 'See which prompts miss your brand and what competitors get recommended instead.',
  },
  {
    icon: Sparkles,
    title: 'Auto-Draft Content',
    desc: 'AI-generated articles and posts targeted at closing your specific visibility gaps.',
  },
  {
    icon: TrendingUp,
    title: 'Monitor Trends',
    desc: 'Track visibility changes over time with automated reports and historical charts.',
  },
  {
    icon: MessageSquare,
    title: 'Reddit Opportunities',
    desc: 'Surface live threads where your brand can contribute — scored by relevance.',
  },
  {
    icon: Settings2,
    title: 'Brand Voice Control',
    desc: 'Define your tone and guidelines so every draft matches your brand exactly.',
  },
];

const AI_MODELS = [
  { name: 'ChatGPT', color: '#22c55e' },
  { name: 'Claude', color: '#f97316' },
  { name: 'Perplexity', color: '#8b5cf6' },
  { name: 'Gemini', color: '#3b82f6' },
];

const HOW_STEPS = [
  {
    n: '1',
    title: 'Track Your Visibility',
    desc: 'Connect your brand and set prompts. We query all four AI models twice daily and score how often you appear.',
  },
  {
    n: '2',
    title: 'Identify the Gaps',
    desc: 'See exactly which prompts miss your brand and what competitors get mentioned instead.',
  },
  {
    n: '3',
    title: 'Fix It with Content',
    desc: 'We draft platform-specific content targeting your weakest prompts — ready for your review.',
  },
];

const STATS = [
  { value: 50000, label: 'Queries Tracked', suffix: '+' },
  { value: 4, label: 'AI Models', suffix: '' },
  { value: 98, label: 'Accuracy Rate', suffix: '%' },
  { value: 2, label: 'Daily Reports', suffix: 'x' },
];

const COMPARISON_FEATURES = [
  { label: 'Standard brands', free: '0', starter: '2', pro: '4' },
  { label: 'Pitch decks', free: '1', starter: '3', pro: 'Unlimited' },
  { label: 'Prompts per brand', free: '10', starter: '25', pro: '100' },
  { label: 'Manual runs per day', free: '1', starter: '1', pro: 'Unlimited' },
  { label: 'AI models monitored', free: '4', starter: '4', pro: '4' },
  { label: 'Twice-daily tracking', free: true, starter: true, pro: true },
  { label: 'Visibility score & report', free: true, starter: true, pro: true },
  { label: 'Content Hub & drafting', free: false, starter: true, pro: true },
  { label: 'Gap analysis', free: false, starter: true, pro: true },
  { label: 'Brand profile & voice', free: false, starter: true, pro: true },
  { label: 'Reddit scanner', free: false, starter: true, pro: true },
  { label: 'Trend charts', free: false, starter: true, pro: true },
  { label: 'Email alerts', free: false, starter: true, pro: true },
  { label: 'Team members', free: '—', starter: '2', pro: 'Unlimited' },
  { label: 'Support', free: 'Community', starter: 'Email', pro: 'Priority' },
];

const FAQ_ITEMS = [
  {
    q: 'How does Lumidian track AI visibility?',
    a: 'Lumidian runs your tracked prompts across ChatGPT, Claude, Perplexity, and Gemini twice daily, analyzing each response to detect whether your brand is mentioned. Results are scored and stored so you can track changes over time.',
  },
  {
    q: 'What kind of content does Lumidian draft?',
    a: 'Lumidian generates Reddit posts, Quora answers, Medium articles, and Wikipedia edits — all targeted at prompts where your brand has low visibility. Every draft follows your brand voice guidelines.',
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
  { prompt: 'best CRM for startups', score: 12 },
  { prompt: 'sales automation tools', score: 18 },
  { prompt: 'email marketing software', score: 21 },
];

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION COMPONENTS (placeholders - will be implemented in subsequent tasks)
// ═══════════════════════════════════════════════════════════════════════════════

function Header({ scrolled }: { scrolled: boolean }) {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  return (
    <header
      className={`fixed top-0 left-0 right-0 z-50 transition-all duration-300 ${
        scrolled
          ? 'bg-[rgba(2,6,23,0.85)] backdrop-blur-lg border-b border-[rgba(51,65,85,0.5)]'
          : 'bg-transparent'
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
            <a href="#features" className="text-sm font-medium text-[#94a3b8] hover:text-white transition-colors">
              Features
            </a>
            <a href="#pricing" className="text-sm font-medium text-[#94a3b8] hover:text-white transition-colors">
              Pricing
            </a>
            <a href="#faq" className="text-sm font-medium text-[#94a3b8] hover:text-white transition-colors">
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
              className="text-sm font-semibold text-white px-5 py-2.5 rounded-full bg-[#6366f1] hover:bg-[#4f46e5] transition-all shadow-[0_0_24px_rgba(99,102,241,0.4)] hover:shadow-[0_0_32px_rgba(99,102,241,0.6)]"
            >
              Get Started
            </Link>
          </div>

          {/* Mobile menu button */}
          <button
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            className="md:hidden p-2 text-[#94a3b8] hover:text-white"
          >
            {mobileMenuOpen ? <X size={24} /> : <Menu size={24} />}
          </button>
        </div>

        {/* Mobile menu */}
        {mobileMenuOpen && (
          <div className="md:hidden py-4 border-t border-[rgba(51,65,85,0.5)]">
            <nav className="flex flex-col gap-4">
              <a href="#features" className="text-sm font-medium text-[#94a3b8] hover:text-white">Features</a>
              <a href="#pricing" className="text-sm font-medium text-[#94a3b8] hover:text-white">Pricing</a>
              <a href="#faq" className="text-sm font-medium text-[#94a3b8] hover:text-white">FAQ</a>
              <div className="flex flex-col gap-2 pt-4 border-t border-[rgba(51,65,85,0.5)]">
                <Link href="/login" className="text-sm font-medium text-white text-center py-2 rounded-full border border-[rgba(255,255,255,0.2)]">
                  Log in
                </Link>
                <Link href="/register" className="text-sm font-semibold text-white text-center py-2.5 rounded-full bg-[#6366f1]">
                  Get Started
                </Link>
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
          background: 'radial-gradient(ellipse at 50% 0%, rgba(99,102,241,0.15) 0%, transparent 60%)',
        }}
      />

      <div className="relative z-10 max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
        {/* Badge */}
        <FadeUp>
          <div className="inline-flex items-center gap-2 bg-[#0f172a] border border-[rgba(99,102,241,0.3)] rounded-full px-4 py-1.5 mb-8">
            <span className="w-2 h-2 rounded-full bg-[#22c55e] animate-pulse" />
            <span className="text-sm text-[#94a3b8]">Now tracking 4 AI models</span>
          </div>
        </FadeUp>

        {/* Headline */}
        <FadeUp delay={100}>
          <h1
            className="text-4xl sm:text-5xl md:text-6xl lg:text-7xl font-extrabold tracking-tight"
            style={{ fontFamily: 'var(--font-syne), system-ui, sans-serif', letterSpacing: '-0.03em', lineHeight: 1.05 }}
          >
            Track Your Brand&apos;s
            <br />
            <span className="bg-gradient-to-r from-[#6366f1] to-[#a855f7] bg-clip-text text-transparent">
              Visibility in AI
            </span>
          </h1>
        </FadeUp>

        {/* Subhead */}
        <FadeUp delay={200}>
          <p className="mt-6 text-lg sm:text-xl text-[#94a3b8] max-w-2xl mx-auto leading-relaxed">
            Monitor how often ChatGPT, Claude, Perplexity, and Gemini mention your brand.
            Identify gaps. Fix them with AI-drafted content.
          </p>
        </FadeUp>

        {/* CTAs */}
        <FadeUp delay={300}>
          <div className="mt-10 flex flex-col sm:flex-row items-center justify-center gap-4">
            <Link
              href="/register"
              className="flex items-center gap-2 text-lg font-semibold text-white px-8 py-4 rounded-full bg-[#6366f1] hover:bg-[#4f46e5] transition-all shadow-[0_0_32px_rgba(99,102,241,0.4)] hover:shadow-[0_0_40px_rgba(99,102,241,0.6)]"
            >
              <Play size={18} fill="white" />
              Start Free
            </Link>
            <Link
              href="/login"
              className="text-lg font-medium text-white px-6 py-4 rounded-full border border-[rgba(255,255,255,0.25)] hover:border-white hover:bg-[rgba(255,255,255,0.05)] transition-all"
            >
              Log in
            </Link>
          </div>
        </FadeUp>

        {/* Dashboard mockup */}
        <ScaleIn delay={400} className="mt-16">
          <DashboardMockup />
        </ScaleIn>
      </div>
    </section>
  );
}

function ModelsBar() {
  return (
    <section className="py-12 border-y border-[rgba(51,65,85,0.5)]">
      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
        <FadeUp>
          <p className="text-center text-sm text-[#64748b] mb-6">Tracking visibility across</p>
        </FadeUp>
        <div className="flex flex-wrap justify-center gap-3">
          {AI_MODELS.map((model, i) => (
            <FadeUp key={model.name} delay={i * 60}>
              <div
                className="flex items-center gap-2 bg-[#0f172a] border border-[rgba(51,65,85,0.5)] rounded-full px-4 py-2 transition-all hover:border-opacity-100"
                style={{
                  ['--model-color' as string]: model.color,
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.borderColor = model.color;
                  e.currentTarget.style.boxShadow = `0 0 16px ${model.color}40`;
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.borderColor = 'rgba(51,65,85,0.5)';
                  e.currentTarget.style.boxShadow = 'none';
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

function StatCard({
  value,
  label,
  suffix,
  color,
  delay,
}: {
  value: number;
  label: string;
  suffix: string;
  color: string;
  delay: number;
}) {
  const { ref, value: animatedValue } = useCountUp(value, 1800);

  return (
    <FadeUp delay={delay}>
      <div
        ref={ref}
        className="bg-[#0f172a] border border-[rgba(51,65,85,0.5)] rounded-xl p-6 text-center"
        style={{ borderTopColor: color, borderTopWidth: 2 }}
      >
        <p
          className="text-4xl font-bold text-[#f8fafc]"
          style={{ fontFamily: 'var(--font-syne), system-ui, sans-serif' }}
        >
          {animatedValue.toLocaleString()}{suffix}
        </p>
        <p className="text-sm text-[#64748b] mt-2">{label}</p>
      </div>
    </FadeUp>
  );
}

function StatsSection() {
  const colors = ['#22c55e', '#f97316', '#8b5cf6', '#3b82f6'];

  return (
    <section className="py-20">
      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {STATS.map((stat, i) => (
            <StatCard
              key={stat.label}
              value={stat.value}
              label={stat.label}
              suffix={stat.suffix}
              color={colors[i % colors.length]}
              delay={i * 100}
            />
          ))}
        </div>
      </div>
    </section>
  );
}

function FeaturesSection() {
  return <section className="py-24 flex items-center justify-center text-[#64748b]">Features placeholder</section>;
}

function HowItWorksSection() {
  return <section className="py-24 flex items-center justify-center text-[#64748b]">How it works placeholder</section>;
}

function DashboardMockup() {
  return <div className="p-8 flex items-center justify-center text-[#64748b]">Dashboard mockup placeholder</div>;
}

function PricingSection() {
  return <section className="py-24 flex items-center justify-center text-[#64748b]">Pricing placeholder</section>;
}

function FAQSection() {
  return <section className="py-24 flex items-center justify-center text-[#64748b]">FAQ placeholder</section>;
}

function CTASection() {
  return <section className="py-32 flex items-center justify-center text-[#64748b]">CTA placeholder</section>;
}

function Footer() {
  return <footer className="py-16 flex items-center justify-center text-[#64748b]">Footer placeholder</footer>;
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
    <div className="min-h-screen bg-[#020617] text-[#f8fafc]">
      <Header scrolled={scrolled} />
      <main>
        <HeroSection />
        <ModelsBar />
        <StatsSection />
        <FeaturesSection />
        <HowItWorksSection />
        <PricingSection />
        <FAQSection />
        <CTASection />
      </main>
      <Footer />
    </div>
  );
}
