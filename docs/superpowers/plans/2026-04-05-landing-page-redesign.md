# Landing Page Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Transform the landing page from generic light theme to distinctive dark editorial design matching the actual product.

**Architecture:** Complete rewrite of `frontend/app/page.tsx` with modular section components, enhanced scroll animation hooks, and an accurate dark-themed dashboard mockup. CSS animations added to globals.css.

**Tech Stack:** Next.js 15, React 18, TypeScript, Tailwind CSS, Lucide icons, existing design tokens from globals.css

---

## File Structure

| File | Action | Responsibility |
|------|--------|----------------|
| `frontend/app/globals.css` | Modify | Add animation keyframes |
| `frontend/app/page.tsx` | Rewrite | Complete landing page with all sections |

The page.tsx will contain all section components inline (Header, Hero, ModelsBar, Stats, Features, HowItWorks, DashboardMockup, Pricing, FAQ, CTASection, Footer) since they're only used on this page.

---

## Task 1: Add CSS Animation Keyframes

**Files:**
- Modify: `frontend/app/globals.css` (add at end of file)

- [ ] **Step 1: Read current end of globals.css**

Run: Check current file structure to find insertion point.

- [ ] **Step 2: Add animation keyframes**

Add to end of `frontend/app/globals.css`:

```css
/* ── Landing page animations ───────────────────────────────────────────────── */
@keyframes fadeUp {
  from {
    opacity: 0;
    transform: translateY(30px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

@keyframes scaleIn {
  from {
    opacity: 0;
    transform: scale(0.95);
  }
  to {
    opacity: 1;
    transform: scale(1);
  }
}

@keyframes glowPulse {
  0%, 100% {
    box-shadow: 0 0 24px rgba(99, 102, 241, 0.4);
  }
  50% {
    box-shadow: 0 0 32px rgba(99, 102, 241, 0.6);
  }
}

@keyframes drawLine {
  from {
    stroke-dashoffset: 1000;
  }
  to {
    stroke-dashoffset: 0;
  }
}

@keyframes slideInLeft {
  from {
    opacity: 0;
    transform: translateX(-40px);
  }
  to {
    opacity: 1;
    transform: translateX(0);
  }
}

@keyframes slideInRight {
  from {
    opacity: 0;
    transform: translateX(40px);
  }
  to {
    opacity: 1;
    transform: translateX(0);
  }
}
```

- [ ] **Step 3: Verify CSS is valid**

Run: `cd frontend && npm run build`
Expected: Build succeeds without CSS errors.

- [ ] **Step 4: Commit**

```bash
git add frontend/app/globals.css
git commit -m "style: add landing page animation keyframes"
```

---

## Task 2: Create Base Page Structure with Hooks

**Files:**
- Rewrite: `frontend/app/page.tsx`

- [ ] **Step 1: Create the base file with imports and hooks**

Replace entire contents of `frontend/app/page.tsx` with:

```tsx
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

    // Check if already in view on mount
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
      // Ease-out cubic
      const eased = 1 - Math.pow(1 - progress, 3);
      setValue(Math.round(eased * target));
      if (progress < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }, [inView, target, duration]);

  return { ref, value };
}

// Staggered fade-up animation wrapper
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

// Scale-in animation wrapper
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

// Demo data for dashboard mockup
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
// SECTION COMPONENTS (will be added in subsequent tasks)
// ═══════════════════════════════════════════════════════════════════════════════

// Placeholder - Task 3 will implement
function Header({ scrolled }: { scrolled: boolean }) {
  return <header>Header placeholder</header>;
}

// Placeholder - Task 4 will implement
function HeroSection() {
  return <section>Hero placeholder</section>;
}

// Placeholder - Task 5 will implement
function ModelsBar() {
  return <section>Models bar placeholder</section>;
}

// Placeholder - Task 6 will implement
function StatsSection() {
  return <section>Stats placeholder</section>;
}

// Placeholder - Task 7 will implement
function FeaturesSection() {
  return <section>Features placeholder</section>;
}

// Placeholder - Task 8 will implement
function HowItWorksSection() {
  return <section>How it works placeholder</section>;
}

// Placeholder - Task 9 will implement
function DashboardMockup() {
  return <div>Dashboard mockup placeholder</div>;
}

// Placeholder - Task 10 will implement
function PricingSection() {
  return <section>Pricing placeholder</section>;
}

// Placeholder - Task 11 will implement
function FAQSection() {
  return <section>FAQ placeholder</section>;
}

// Placeholder - Task 12 will implement
function CTASection() {
  return <section>CTA placeholder</section>;
}

// Placeholder - Task 13 will implement
function Footer() {
  return <footer>Footer placeholder</footer>;
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
```

- [ ] **Step 2: Verify the page loads**

Run: `cd frontend && npm run dev`
Then visit http://localhost:3002 and verify page shows placeholder sections on dark background.

- [ ] **Step 3: Commit**

```bash
git add frontend/app/page.tsx
git commit -m "refactor: scaffold dark landing page with animation hooks"
```

---

## Task 3: Implement Header Component

**Files:**
- Modify: `frontend/app/page.tsx` (replace Header placeholder)

- [ ] **Step 1: Replace Header placeholder**

Find the placeholder `function Header` and replace with:

```tsx
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
```

- [ ] **Step 2: Verify header renders correctly**

Run: `cd frontend && npm run dev`
- Page should show sticky header with logo, nav links, and CTAs
- Header should get backdrop blur when scrolling
- Mobile menu should toggle on small screens

- [ ] **Step 3: Commit**

```bash
git add frontend/app/page.tsx
git commit -m "feat(landing): implement dark header with mobile menu"
```

---

## Task 4: Implement Hero Section

**Files:**
- Modify: `frontend/app/page.tsx` (replace HeroSection placeholder)

- [ ] **Step 1: Replace HeroSection placeholder**

Find the placeholder `function HeroSection` and replace with:

```tsx
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
```

- [ ] **Step 2: Verify hero renders**

Run: `cd frontend && npm run dev`
- Hero should show badge, headline with gradient text, subhead, CTAs
- Animations should trigger on page load
- Dashboard mockup placeholder should be visible

- [ ] **Step 3: Commit**

```bash
git add frontend/app/page.tsx
git commit -m "feat(landing): implement hero section with animations"
```

---

## Task 5: Implement Models Bar

**Files:**
- Modify: `frontend/app/page.tsx` (replace ModelsBar placeholder)

- [ ] **Step 1: Replace ModelsBar placeholder**

Find the placeholder `function ModelsBar` and replace with:

```tsx
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
```

- [ ] **Step 2: Verify models bar**

Run: `cd frontend && npm run dev`
- Should show 4 model pills with colored dots
- Hover should add glow effect in model color

- [ ] **Step 3: Commit**

```bash
git add frontend/app/page.tsx
git commit -m "feat(landing): implement AI models bar with hover effects"
```

---

## Task 6: Implement Stats Section

**Files:**
- Modify: `frontend/app/page.tsx` (replace StatsSection placeholder)

- [ ] **Step 1: Create StatCard helper component**

Add this above the StatsSection function:

```tsx
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
```

- [ ] **Step 2: Replace StatsSection placeholder**

Find the placeholder `function StatsSection` and replace with:

```tsx
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
```

- [ ] **Step 3: Verify stats section**

Run: `cd frontend && npm run dev`
- Should show 4 stat cards with colored top borders
- Numbers should animate when scrolled into view

- [ ] **Step 4: Commit**

```bash
git add frontend/app/page.tsx
git commit -m "feat(landing): implement stats section with count-up animation"
```

---

## Task 7: Implement Features Section

**Files:**
- Modify: `frontend/app/page.tsx` (replace FeaturesSection placeholder)

- [ ] **Step 1: Replace FeaturesSection placeholder**

Find the placeholder `function FeaturesSection` and replace with:

```tsx
function FeaturesSection() {
  return (
    <section id="features" className="py-24 scroll-mt-20">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
        <FadeUp>
          <h2
            className="text-3xl sm:text-4xl font-bold text-center text-[#f8fafc] mb-4"
            style={{ fontFamily: 'var(--font-syne), system-ui, sans-serif' }}
          >
            Everything you need to dominate AI visibility
          </h2>
        </FadeUp>
        <FadeUp delay={100}>
          <p className="text-center text-[#94a3b8] mb-16 max-w-2xl mx-auto">
            Track, analyze, and improve how AI models talk about your brand.
          </p>
        </FadeUp>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {FEATURES.map((feature, i) => {
            const Icon = feature.icon;
            return (
              <FadeUp key={feature.title} delay={i * 80}>
                <div className="bg-[#0f172a] border border-[rgba(51,65,85,0.5)] rounded-2xl p-7 h-full transition-all duration-200 hover:-translate-y-1 hover:border-[rgba(71,85,105,0.5)] hover:shadow-[0_8px_32px_rgba(0,0,0,0.3)]">
                  <div className="w-11 h-11 rounded-xl bg-[rgba(99,102,241,0.15)] flex items-center justify-center mb-4">
                    <Icon size={20} className="text-[#6366f1]" />
                  </div>
                  <h3
                    className="text-lg font-semibold text-[#f8fafc] mb-2"
                    style={{ fontFamily: 'var(--font-syne), system-ui, sans-serif' }}
                  >
                    {feature.title}
                  </h3>
                  <p className="text-sm text-[#94a3b8] leading-relaxed">
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
```

- [ ] **Step 2: Verify features section**

Run: `cd frontend && npm run dev`
- Should show 6 feature cards in a grid
- Cards should animate in staggered
- Hover should lift cards

- [ ] **Step 3: Commit**

```bash
git add frontend/app/page.tsx
git commit -m "feat(landing): implement features grid with hover effects"
```

---

## Task 8: Implement How It Works Section

**Files:**
- Modify: `frontend/app/page.tsx` (replace HowItWorksSection placeholder)

- [ ] **Step 1: Replace HowItWorksSection placeholder**

Find the placeholder `function HowItWorksSection` and replace with:

```tsx
function HowItWorksSection() {
  return (
    <section className="py-24 border-y border-[rgba(51,65,85,0.5)]">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
        <FadeUp>
          <h2
            className="text-3xl sm:text-4xl font-bold text-center text-[#f8fafc] mb-16"
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
                    className="text-6xl sm:text-7xl font-extrabold bg-gradient-to-br from-[#6366f1] to-[#a855f7] bg-clip-text text-transparent"
                    style={{ fontFamily: 'var(--font-syne), system-ui, sans-serif', lineHeight: 1 }}
                  >
                    {step.n}
                  </span>
                </div>

                {/* Content */}
                <div className="pt-2">
                  <div className="inline-flex items-center gap-2 bg-[rgba(99,102,241,0.1)] border border-[rgba(99,102,241,0.2)] rounded-full px-3 py-1 mb-3">
                    <span className="w-1.5 h-1.5 rounded-full bg-[#6366f1]" />
                    <span className="text-xs font-semibold text-[#6366f1]">Step {step.n}</span>
                  </div>
                  <h3
                    className="text-xl font-semibold text-[#f8fafc] mb-2"
                    style={{ fontFamily: 'var(--font-syne), system-ui, sans-serif' }}
                  >
                    {step.title}
                  </h3>
                  <p className="text-[#94a3b8] leading-relaxed">{step.desc}</p>
                </div>
              </div>
            </FadeUp>
          ))}
        </div>
      </div>
    </section>
  );
}
```

- [ ] **Step 2: Verify how it works section**

Run: `cd frontend && npm run dev`
- Should show 3 steps with large gradient numbers
- Steps should animate in staggered

- [ ] **Step 3: Commit**

```bash
git add frontend/app/page.tsx
git commit -m "feat(landing): implement how-it-works section"
```

---

## Task 9: Implement Dashboard Mockup

**Files:**
- Modify: `frontend/app/page.tsx` (replace DashboardMockup placeholder)

- [ ] **Step 1: Replace DashboardMockup placeholder**

Find the placeholder `function DashboardMockup` and replace with:

```tsx
function DashboardMockup() {
  const { ref: scoreRef, value: scoreVal } = useCountUp(67, 1600);
  const { ref: liveRef, value: liveVal } = useCountUp(66, 1400);
  const { ref: indexRef, value: indexVal } = useCountUp(67, 1400);
  const [barWidths, setBarWidths] = useState([0, 0, 0, 0]);
  const barTriggered = useRef(false);
  const { ref: barRef, inView: barInView } = useInView(0.2);

  useEffect(() => {
    if (!barInView || barTriggered.current) return;
    barTriggered.current = true;
    setTimeout(() => {
      setBarWidths(DEMO_MODELS.map((m) => m.score));
    }, 200);
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
        className="bg-[#0f172a] border border-[rgba(99,102,241,0.2)] rounded-2xl overflow-hidden shadow-[0_32px_64px_rgba(0,0,0,0.5),0_0_0_1px_rgba(99,102,241,0.1)]"
        style={{
          transform: 'rotateX(2deg)',
        }}
      >
        {/* Browser chrome */}
        <div className="bg-[#1e293b] border-b border-[rgba(51,65,85,0.5)] px-4 py-3 flex items-center gap-2">
          <span className="w-3 h-3 rounded-full bg-[#ef4444]" />
          <span className="w-3 h-3 rounded-full bg-[#fbbf24]" />
          <span className="w-3 h-3 rounded-full bg-[#22c55e]" />
          <div className="flex-1 ml-3 bg-[#0f172a] rounded-md px-3 py-1.5">
            <span className="text-xs text-[#64748b]">app.lumidian.ai/dashboard</span>
          </div>
        </div>

        {/* Dashboard content */}
        <div className="p-5 grid grid-cols-2 gap-4">
          {/* Visibility score card */}
          <div
            ref={scoreRef}
            className="rounded-2xl p-5 text-white"
            style={{ background: 'linear-gradient(135deg, #4f46e5, #7c3aed)' }}
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
          <div className="bg-[#1e293b] border border-[rgba(51,65,85,0.5)] rounded-2xl p-4">
            <p className="text-xs font-semibold text-[#64748b] uppercase tracking-wider mb-3">30-Day Trend</p>
            <svg width="100%" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className="h-12">
              <defs>
                <linearGradient id="mockupSparkGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#6366f1" stopOpacity="0.3" />
                  <stop offset="100%" stopColor="#6366f1" stopOpacity="0" />
                </linearGradient>
              </defs>
              <path d={areaD} fill="url(#mockupSparkGrad)" />
              <path d={pathD} fill="none" stroke="#6366f1" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>

          {/* Live vs Index */}
          <div className="col-span-2 bg-[#1e293b] border border-[rgba(51,65,85,0.5)] rounded-2xl p-4">
            <p className="text-xs font-semibold text-[#64748b] uppercase tracking-wider mb-3">Live vs Index</p>
            <div className="space-y-3">
              <div ref={liveRef}>
                <div className="flex items-center justify-between mb-1">
                  <div className="flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-[#22c55e]" />
                    <span className="text-xs text-[#94a3b8]">Live Search</span>
                  </div>
                  <span className="text-xs font-bold text-[#22c55e]">{liveVal}%</span>
                </div>
                <div className="h-1.5 bg-[rgba(255,255,255,0.08)] rounded-full overflow-hidden">
                  <div
                    className="h-full bg-[#22c55e] rounded-full transition-all duration-700"
                    style={{ width: `${liveVal}%` }}
                  />
                </div>
              </div>
              <div ref={indexRef}>
                <div className="flex items-center justify-between mb-1">
                  <div className="flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-[#818cf8]" />
                    <span className="text-xs text-[#94a3b8]">AI Index</span>
                  </div>
                  <span className="text-xs font-bold text-[#818cf8]">{indexVal}%</span>
                </div>
                <div className="h-1.5 bg-[rgba(255,255,255,0.08)] rounded-full overflow-hidden">
                  <div
                    className="h-full bg-[#818cf8] rounded-full transition-all duration-700"
                    style={{ width: `${indexVal}%` }}
                  />
                </div>
              </div>
            </div>
          </div>

          {/* Model breakdown */}
          <div className="col-span-2 bg-[#1e293b] border border-[rgba(51,65,85,0.5)] rounded-2xl p-4">
            <p className="text-xs font-semibold text-[#64748b] uppercase tracking-wider mb-3">Performance by Model</p>
            <div className="space-y-2.5">
              {DEMO_MODELS.map((m, i) => (
                <div key={m.name} className="flex items-center gap-3">
                  <span className="text-xs font-medium text-[#94a3b8] w-20 flex-shrink-0">{m.name}</span>
                  <div className="flex-1 h-2 bg-[rgba(255,255,255,0.08)] rounded-full overflow-hidden">
                    <div
                      className="h-full rounded-full transition-all duration-700"
                      style={{
                        width: `${barWidths[i]}%`,
                        backgroundColor: m.color,
                        transitionDelay: `${i * 100}ms`,
                      }}
                    />
                  </div>
                  <span className="text-xs font-bold text-[#f8fafc] w-10 text-right">{m.score}%</span>
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
                  <span className="text-sm text-[#94a3b8]">&ldquo;{g.prompt}&rdquo;</span>
                  <span className="text-xs font-bold text-[#f87171] bg-[rgba(239,68,68,0.1)] px-2 py-0.5 rounded-full">
                    {g.score}%
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify dashboard mockup**

Run: `cd frontend && npm run dev`
- Mockup should show dark-themed dashboard matching real product
- Score should count up when visible
- Model bars should animate in
- Should have subtle 3D tilt effect

- [ ] **Step 3: Commit**

```bash
git add frontend/app/page.tsx
git commit -m "feat(landing): implement accurate dark dashboard mockup"
```

---

## Task 10: Implement Pricing Section

**Files:**
- Modify: `frontend/app/page.tsx` (replace PricingSection placeholder)

- [ ] **Step 1: Create PricingCell helper**

Add this above the PricingSection function:

```tsx
function PricingCell({ value }: { value: string | boolean }) {
  if (value === true) return <span className="text-[#22c55e] font-bold text-base">&#10003;</span>;
  if (value === false) return <span className="text-[#64748b]">—</span>;
  return <span className="text-sm text-[#94a3b8]">{value}</span>;
}
```

- [ ] **Step 2: Replace PricingSection placeholder**

Find the placeholder `function PricingSection` and replace with:

```tsx
function PricingSection() {
  return (
    <section id="pricing" className="py-24 scroll-mt-20">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
        <FadeUp>
          <h2
            className="text-3xl sm:text-4xl font-bold text-center text-[#f8fafc] mb-4"
            style={{ fontFamily: 'var(--font-syne), system-ui, sans-serif' }}
          >
            Simple, transparent pricing
          </h2>
        </FadeUp>
        <FadeUp delay={100}>
          <p className="text-center text-[#94a3b8] mb-12">
            Start free. Upgrade when you need more.
          </p>
        </FadeUp>

        <FadeUp delay={200}>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse">
              <thead>
                <tr className="bg-[#1e293b]">
                  <th className="text-left text-sm font-semibold text-[#f8fafc] p-4 rounded-tl-xl">Feature</th>
                  <th className="text-center text-sm font-semibold text-[#f8fafc] p-4">Free</th>
                  <th className="text-center text-sm font-semibold text-[#f8fafc] p-4">Starter</th>
                  <th className="text-center text-sm font-semibold text-[#f8fafc] p-4 rounded-tr-xl bg-[rgba(99,102,241,0.2)] border-b-2 border-[#6366f1]">
                    Pro
                  </th>
                </tr>
              </thead>
              <tbody>
                {COMPARISON_FEATURES.map((row, i) => (
                  <tr
                    key={row.label}
                    className={`${i % 2 === 0 ? 'bg-[#0f172a]' : 'bg-[#020617]'} hover:bg-[rgba(99,102,241,0.05)] transition-colors`}
                  >
                    <td className="text-sm text-[#f8fafc] p-4">{row.label}</td>
                    <td className="text-center p-4"><PricingCell value={row.free} /></td>
                    <td className="text-center p-4"><PricingCell value={row.starter} /></td>
                    <td className="text-center p-4 bg-[rgba(99,102,241,0.05)] border-l border-r border-[rgba(99,102,241,0.2)]">
                      <PricingCell value={row.pro} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </FadeUp>

        <FadeUp delay={300}>
          <div className="mt-8 text-center">
            <Link
              href="/register"
              className="inline-flex items-center gap-2 text-base font-semibold text-white px-8 py-3 rounded-full bg-[#6366f1] hover:bg-[#4f46e5] transition-all shadow-[0_0_24px_rgba(99,102,241,0.4)]"
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
```

- [ ] **Step 3: Verify pricing section**

Run: `cd frontend && npm run dev`
- Table should display with alternating row colors
- Pro column should be highlighted
- Check marks and dashes should render correctly

- [ ] **Step 4: Commit**

```bash
git add frontend/app/page.tsx
git commit -m "feat(landing): implement pricing comparison table"
```

---

## Task 11: Implement FAQ Section

**Files:**
- Modify: `frontend/app/page.tsx` (replace FAQSection placeholder)

- [ ] **Step 1: Create FAQItem helper**

Add this above the FAQSection function:

```tsx
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
        className={`border-b border-[rgba(51,65,85,0.5)] transition-all ${isOpen ? 'border-l-2 border-l-[#6366f1] pl-4' : ''}`}
      >
        <button
          onClick={onToggle}
          className="w-full py-5 flex items-center justify-between text-left hover:bg-[rgba(255,255,255,0.02)] transition-colors rounded"
        >
          <span className="text-base font-medium text-[#f8fafc] pr-4">{item.q}</span>
          <ChevronDown
            size={20}
            className={`text-[#64748b] flex-shrink-0 transition-transform duration-300 ${isOpen ? 'rotate-180' : ''}`}
          />
        </button>
        <div
          className={`overflow-hidden transition-all duration-300 ${isOpen ? 'max-h-96 pb-5' : 'max-h-0'}`}
        >
          <p className="text-sm text-[#94a3b8] leading-relaxed">{item.a}</p>
        </div>
      </div>
    </FadeUp>
  );
}
```

- [ ] **Step 2: Replace FAQSection placeholder**

Find the placeholder `function FAQSection` and replace with:

```tsx
function FAQSection() {
  const [openIndex, setOpenIndex] = useState<number | null>(null);

  return (
    <section id="faq" className="py-24 border-t border-[rgba(51,65,85,0.5)] scroll-mt-20">
      <div className="max-w-2xl mx-auto px-4 sm:px-6 lg:px-8">
        <FadeUp>
          <h2
            className="text-3xl sm:text-4xl font-bold text-center text-[#f8fafc] mb-12"
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
```

- [ ] **Step 3: Verify FAQ section**

Run: `cd frontend && npm run dev`
- Accordion items should expand/collapse
- Only one item open at a time
- Open item should have indigo left border

- [ ] **Step 4: Commit**

```bash
git add frontend/app/page.tsx
git commit -m "feat(landing): implement FAQ accordion"
```

---

## Task 12: Implement CTA Section

**Files:**
- Modify: `frontend/app/page.tsx` (replace CTASection placeholder)

- [ ] **Step 1: Replace CTASection placeholder**

Find the placeholder `function CTASection` and replace with:

```tsx
function CTASection() {
  return (
    <section
      className="py-32 text-center relative"
      style={{
        background: 'radial-gradient(ellipse at 50% 100%, rgba(99,102,241,0.15) 0%, transparent 60%)',
      }}
    >
      <div className="max-w-2xl mx-auto px-4 sm:px-6 lg:px-8">
        <FadeUp>
          <h2
            className="text-3xl sm:text-4xl font-bold text-[#f8fafc] mb-4"
            style={{ fontFamily: 'var(--font-syne), system-ui, sans-serif' }}
          >
            Start tracking your AI visibility
          </h2>
        </FadeUp>
        <FadeUp delay={100}>
          <p className="text-[#94a3b8] mb-8">
            Free to start. No credit card required.
          </p>
        </FadeUp>
        <FadeUp delay={200}>
          <Link
            href="/register"
            className="inline-flex items-center gap-2 text-lg font-semibold text-white px-8 py-4 rounded-full bg-[#6366f1] hover:bg-[#4f46e5] transition-all shadow-[0_0_32px_rgba(99,102,241,0.4)] hover:shadow-[0_0_40px_rgba(99,102,241,0.6)]"
          >
            Get Started Free
            <ArrowRight size={18} />
          </Link>
        </FadeUp>
      </div>
    </section>
  );
}
```

- [ ] **Step 2: Verify CTA section**

Run: `cd frontend && npm run dev`
- Should show centered CTA with gradient background
- Button should have glow effect

- [ ] **Step 3: Commit**

```bash
git add frontend/app/page.tsx
git commit -m "feat(landing): implement final CTA section"
```

---

## Task 13: Implement Footer

**Files:**
- Modify: `frontend/app/page.tsx` (replace Footer placeholder)

- [ ] **Step 1: Replace Footer placeholder**

Find the placeholder `function Footer` and replace with:

```tsx
function Footer() {
  return (
    <footer className="py-16 border-t border-[rgba(51,65,85,0.5)]">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-8 mb-12">
          {/* Logo & tagline */}
          <div className="col-span-2 md:col-span-1">
            <LumidianLogo size={28} withWordmark variant="dark" />
            <p className="text-sm text-[#64748b] mt-3">
              AI visibility tracking for modern brands.
            </p>
          </div>

          {/* Product */}
          <div>
            <h4 className="text-sm font-semibold text-[#f8fafc] mb-4">Product</h4>
            <nav className="space-y-3">
              <a href="#features" className="block text-sm text-[#94a3b8] hover:text-white transition-colors">Features</a>
              <a href="#pricing" className="block text-sm text-[#94a3b8] hover:text-white transition-colors">Pricing</a>
              <a href="#faq" className="block text-sm text-[#94a3b8] hover:text-white transition-colors">FAQ</a>
            </nav>
          </div>

          {/* Company */}
          <div>
            <h4 className="text-sm font-semibold text-[#f8fafc] mb-4">Company</h4>
            <nav className="space-y-3">
              <Link href="/terms" className="block text-sm text-[#94a3b8] hover:text-white transition-colors">Terms</Link>
              <Link href="/privacy" className="block text-sm text-[#94a3b8] hover:text-white transition-colors">Privacy</Link>
            </nav>
          </div>

          {/* Get Started */}
          <div>
            <h4 className="text-sm font-semibold text-[#f8fafc] mb-4">Get Started</h4>
            <nav className="space-y-3">
              <Link href="/register" className="block text-sm text-[#94a3b8] hover:text-white transition-colors">Sign up</Link>
              <Link href="/login" className="block text-sm text-[#94a3b8] hover:text-white transition-colors">Log in</Link>
            </nav>
          </div>
        </div>

        {/* Bottom bar */}
        <div className="pt-8 border-t border-[rgba(51,65,85,0.5)]">
          <p className="text-sm text-[#64748b] text-center">
            &copy; {new Date().getFullYear()} Lumidian. All rights reserved.
          </p>
        </div>
      </div>
    </footer>
  );
}
```

- [ ] **Step 2: Verify footer**

Run: `cd frontend && npm run dev`
- Footer should show logo, link columns, and copyright
- Links should have hover effects

- [ ] **Step 3: Commit**

```bash
git add frontend/app/page.tsx
git commit -m "feat(landing): implement footer"
```

---

## Task 14: Final Verification and Cleanup

**Files:**
- Review: `frontend/app/page.tsx`

- [ ] **Step 1: Run build to check for errors**

Run: `cd frontend && npm run build`
Expected: Build succeeds with no TypeScript or ESLint errors.

- [ ] **Step 2: Run lint**

Run: `cd frontend && npm run lint`
Expected: No lint errors.

- [ ] **Step 3: Test full page flow**

Run: `cd frontend && npm run dev`
Visit http://localhost:3002 and verify:
- [ ] Header scrolls correctly with backdrop blur
- [ ] Hero animations trigger on load
- [ ] Dashboard mockup matches real product style
- [ ] All sections animate when scrolled into view
- [ ] Mobile menu works
- [ ] All links navigate correctly
- [ ] FAQ accordion works
- [ ] No console errors

- [ ] **Step 4: Test mobile responsiveness**

Use browser DevTools to test:
- [ ] iPhone SE (375px)
- [ ] iPad (768px)
- [ ] Desktop (1440px)

- [ ] **Step 5: Final commit**

```bash
git add -A
git commit -m "feat(landing): complete dark theme redesign with scroll animations

- Dark navy theme matching actual product
- Accurate dashboard mockup with Live/Index scores
- Bold editorial typography (Syne headlines)
- Scroll animations: fadeUp, scaleIn, countUp, barGrow
- Removed pastel gradient blobs
- Mobile responsive with hamburger menu
- FAQ accordion, pricing table, features grid"
```

---

## Summary

| Task | Description | Est. Time |
|------|-------------|-----------|
| 1 | CSS animation keyframes | 3 min |
| 2 | Base page structure with hooks | 5 min |
| 3 | Header component | 4 min |
| 4 | Hero section | 4 min |
| 5 | Models bar | 3 min |
| 6 | Stats section | 4 min |
| 7 | Features section | 4 min |
| 8 | How it works section | 3 min |
| 9 | Dashboard mockup | 5 min |
| 10 | Pricing section | 4 min |
| 11 | FAQ section | 4 min |
| 12 | CTA section | 2 min |
| 13 | Footer | 3 min |
| 14 | Final verification | 5 min |

**Total: ~50 minutes**
