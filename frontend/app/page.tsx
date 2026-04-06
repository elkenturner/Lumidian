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
  return <header className="fixed top-0 left-0 right-0 z-50 h-16 flex items-center justify-center text-[#64748b]">Header placeholder</header>;
}

function HeroSection() {
  return <section className="min-h-screen flex items-center justify-center text-[#64748b]">Hero placeholder</section>;
}

function ModelsBar() {
  return <section className="py-12 flex items-center justify-center text-[#64748b]">Models bar placeholder</section>;
}

function StatsSection() {
  return <section className="py-20 flex items-center justify-center text-[#64748b]">Stats placeholder</section>;
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
