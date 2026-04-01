'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { BarChart2, Target, Sparkles, TrendingUp, Check, ArrowRight, MessageSquare, Settings2, ChevronDown, TrendingDown } from 'lucide-react';
import LumidianLogo from '@/components/LumidianLogo';

// ── Scroll-reveal hook ─────────────────────────────────────────────────────────

function useInView(threshold = 0.1) {
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
      { threshold },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [threshold]);

  return { ref, inView };
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
        transform: inView ? 'translateY(0)' : 'translateY(20px)',
        transition: `opacity 0.5s ease-out ${delay}ms, transform 0.5s ease-out ${delay}ms`,
        willChange: 'opacity, transform',
      }}
    >
      {children}
    </div>
  );
}

// ── Animated count-up hook ──────────────────────────────────────────────────────

function useCountUp(target: number, duration = 1800, startOnMount = false) {
  const [value, setValue] = useState(0);
  const triggered = useRef(false);
  const { ref, inView } = useInView(0.3);

  useEffect(() => {
    if ((!inView && !startOnMount) || triggered.current) return;
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
  }, [inView, target, duration, startOnMount]);

  return { ref, value };
}

// ── Data ───────────────────────────────────────────────────────────────────────

const FEATURES = [
  {
    icon: BarChart2,
    title: 'Track AI Visibility',
    desc: 'Monitor how often your brand appears in ChatGPT, Claude, Perplexity, and Gemini responses across hundreds of queries.',
  },
  {
    icon: Target,
    title: 'Identify Gaps',
    desc: 'See exactly which prompts your brand is missing from and what competitors are being recommended instead.',
  },
  {
    icon: Sparkles,
    title: 'Auto-Draft Content',
    desc: 'AI-generated articles, forum replies, and Wikipedia edits targeted at closing your specific visibility gaps.',
  },
  {
    icon: TrendingUp,
    title: 'Monitor Trends',
    desc: 'Track visibility score changes over time with automated twice-daily reports and historical trend charts.',
  },
  {
    icon: MessageSquare,
    title: 'Reddit Opportunities',
    desc: 'Surface live Reddit threads where your brand can contribute meaningfully — scored by relevance and reach.',
  },
  {
    icon: Settings2,
    title: 'Brand Voice Control',
    desc: 'Define your tone, approved stats, and off-limit phrases so every draft matches your brand guidelines exactly.',
  },
];

const AI_MODELS = ['ChatGPT', 'Claude', 'Perplexity', 'Gemini'];

const HOW_STEPS = [
  {
    n: '1',
    title: 'Track Your Visibility',
    desc: 'Connect your brand and set the prompts you want to track. Lumidian queries ChatGPT, Claude, Perplexity, and Gemini twice daily and scores how often your brand appears.',
  },
  {
    n: '2',
    title: 'Identify the Gaps',
    desc: 'See exactly which prompts your brand is missing from and what competitors are being recommended instead. Every gap is scored by urgency.',
  },
  {
    n: '3',
    title: 'Fix It with Content',
    desc: 'Lumidian drafts platform-specific content targeting your weakest prompts — Reddit posts, Quora answers, Medium articles, and Wikipedia edits — ready for your review.',
  },
];

const PLATFORM_AI = ['ChatGPT', 'Claude', 'Perplexity', 'Gemini'];
const PLATFORM_CONTENT = ['Reddit', 'Quora', 'Medium', 'Wikipedia'];

const FAQ_ITEMS = [
  {
    q: 'How does Lumidian track AI visibility?',
    a: 'Lumidian runs your tracked prompts across ChatGPT, Claude, Perplexity, and Gemini twice daily, analyzing each response to detect whether your brand is mentioned. Results are scored and stored so you can track changes over time.',
  },
  {
    q: 'What kind of content does Lumidian draft?',
    a: 'Lumidian generates Reddit posts, Quora answers, Medium articles, and Wikipedia edits — all targeted at the specific prompts where your brand has low visibility. Every draft follows your brand voice and approved language guidelines.',
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
    a: "Traditional SEO tools track Google rankings. Lumidian tracks what AI models say about your brand when users ask questions — a fundamentally different signal that SEO tools don't measure.",
  },
];

// Pricing comparison data
const COMPARISON_FEATURES = [
  { label: 'Standard brands',          free: '0',             starter: '2',            pro: '4' },
  { label: 'Pitch decks',             free: '1',             starter: '3',            pro: 'Unlimited' },
  { label: 'Prompts per brand',         free: '10',            starter: '25',           pro: '100' },
  { label: 'Manual runs per day',       free: '1',             starter: '1',            pro: 'Unlimited' },
  { label: 'Pitch duration',           free: '30 days',       starter: '30 days',      pro: '30 days' },
  { label: 'AI models monitored',      free: '4',             starter: '4',            pro: '4' },
  { label: 'Twice-daily tracking',     free: true,            starter: true,           pro: true },
  { label: 'Visibility score & report',free: true,            starter: true,           pro: true },
  { label: 'Content Hub & drafting',   free: false,           starter: true,           pro: true },
  { label: 'Gap analysis',             free: false,           starter: true,           pro: true },
  { label: 'Brand profile & voice',    free: false,           starter: true,           pro: true },
  { label: 'Reddit opportunity scanner',free: false,          starter: true,           pro: true },
  { label: 'Trend charts & history',   free: false,           starter: true,           pro: true },
  { label: 'Email alerts',             free: false,           starter: true,           pro: true },
  { label: 'Team members',             free: false,           starter: '2',            pro: 'Unlimited' },
  { label: 'Free trial',               free: false,           starter: '30 days',      pro: '30 days' },
  { label: 'Support',                  free: 'Community',     starter: 'Email',        pro: 'Priority' },
];

// Noise SVG data URI — renders as a subtle grain texture
const NOISE_SVG = `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='300' height='300'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.75' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='300' height='300' filter='url(%23n)' opacity='1'/%3E%3C/svg%3E")`;

function StepCard({ step }: { step: { n: string; title: string; desc: string } }) {
  return (
    <div style={{ textAlign: 'center', padding: '0 12px' }}>
      <div style={{
        fontSize: 72,
        fontWeight: 800,
        lineHeight: 1,
        letterSpacing: '-0.05em',
        color: 'rgba(99,102,241,0.10)',
        marginBottom: 4,
        userSelect: 'none' as const,
      }}>
        {step.n}
      </div>
      <div style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        background: 'rgba(99,102,241,0.07)',
        border: '1px solid rgba(99,102,241,0.18)',
        borderRadius: 100,
        padding: '4px 12px',
        marginBottom: 16,
      }}>
        <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#6366F1', display: 'inline-block' }} />
        <span style={{ fontSize: 12, fontWeight: 600, color: '#6366F1' }}>Step {step.n}</span>
      </div>
      <h3 style={{ fontSize: 20, fontWeight: 700, color: '#0F0F12', letterSpacing: '-0.02em', margin: '0 0 12px' }}>{step.title}</h3>
      <p style={{ fontSize: 15, color: '#6B7280', lineHeight: 1.65, margin: 0 }}>{step.desc}</p>
    </div>
  );
}

// ── Demo mockup component ──────────────────────────────────────────────────────

const DEMO_MODELS = [
  { name: 'Perplexity', score: 78, color: '#a78bfa' },
  { name: 'ChatGPT',    score: 72, color: '#10b981' },
  { name: 'Claude',     score: 61, color: '#f59e0b' },
  { name: 'Gemini',     score: 55, color: '#60a5fa' },
];

const DEMO_GAPS = [
  { prompt: 'best CRM for startups', score: 12 },
  { prompt: 'sales automation tools', score: 18 },
  { prompt: 'email marketing software', score: 21 },
];

function DemoDashboard() {
  const { ref: scoreRef, value: scoreVal } = useCountUp(67, 1600);
  const [barWidths, setBarWidths] = useState([0, 0, 0, 0]);
  const triggered = useRef(false);
  const { ref: barRef, inView: barInView } = useInView(0.2);

  useEffect(() => {
    if (!barInView || triggered.current) return;
    triggered.current = true;
    setTimeout(() => {
      setBarWidths(DEMO_MODELS.map(m => m.score));
    }, 200);
  }, [barInView]);

  // Simple sparkline path
  const sparkPoints = [28, 35, 31, 42, 38, 50, 47, 55, 52, 61, 67];
  const w = 200, h = 56;
  const min = Math.min(...sparkPoints), max = Math.max(...sparkPoints);
  const toX = (i: number) => (i / (sparkPoints.length - 1)) * w;
  const toY = (v: number) => h - ((v - min) / (max - min || 1)) * (h - 8) - 4;
  const pathD = sparkPoints.map((v, i) => `${i === 0 ? 'M' : 'L'} ${toX(i)} ${toY(v)}`).join(' ');
  const areaD = `${pathD} L ${w} ${h} L 0 ${h} Z`;

  return (
    <div
      ref={barRef}
      style={{
        background: 'rgba(255,255,255,0.9)',
        backdropFilter: 'blur(20px)',
        border: '1px solid rgba(0,0,0,0.10)',
        borderRadius: 24,
        overflow: 'hidden',
        boxShadow: '0 24px 80px rgba(0,0,0,0.10), 0 4px 16px rgba(0,0,0,0.06)',
        maxWidth: 680,
        margin: '0 auto',
        fontFamily: "'Plus Jakarta Sans', -apple-system, sans-serif",
      }}
    >
      {/* Browser chrome bar */}
      <div style={{ background: '#F3F4F6', borderBottom: '1px solid rgba(0,0,0,0.08)', padding: '10px 16px', display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ width: 10, height: 10, borderRadius: '50%', background: '#FC5F57', display: 'inline-block' }} />
        <span style={{ width: 10, height: 10, borderRadius: '50%', background: '#FDBD2E', display: 'inline-block' }} />
        <span style={{ width: 10, height: 10, borderRadius: '50%', background: '#25C93F', display: 'inline-block' }} />
        <div style={{ flex: 1, background: '#E5E7EB', borderRadius: 6, height: 22, display: 'flex', alignItems: 'center', justifyContent: 'center', marginLeft: 8 }}>
          <span style={{ fontSize: 11, color: '#9CA3AF', fontWeight: 500 }}>app.lumidian.ai/dashboard</span>
        </div>
      </div>

      {/* Dashboard content */}
      <div style={{ padding: '24px 28px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>

        {/* Overall score card */}
        <div style={{ background: 'linear-gradient(135deg, #4F46E5, #7C3AED)', borderRadius: 16, padding: '20px 24px', color: '#fff', gridColumn: '1 / 2' }}>
          <p style={{ fontSize: 11, fontWeight: 600, opacity: 0.7, textTransform: 'uppercase', letterSpacing: '0.08em', margin: '0 0 4px' }}>AI Visibility Score</p>
          <div ref={scoreRef} style={{ fontSize: 52, fontWeight: 800, lineHeight: 1, letterSpacing: '-0.04em', margin: '4px 0' }}>
            {scoreVal}<span style={{ fontSize: 24, opacity: 0.7 }}>%</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 8 }}>
            <TrendingUp size={13} color="rgba(255,255,255,0.8)" />
            <span style={{ fontSize: 12, opacity: 0.8 }}>+14% vs last run</span>
          </div>
        </div>

        {/* Sparkline card */}
        <div style={{ background: '#F9FAFB', border: '1px solid rgba(0,0,0,0.07)', borderRadius: 16, padding: '16px 20px' }}>
          <p style={{ fontSize: 11, fontWeight: 600, color: '#9CA3AF', textTransform: 'uppercase', letterSpacing: '0.08em', margin: '0 0 10px' }}>30-Day Trend</p>
          <svg width="100%" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" style={{ display: 'block', height: 56 }}>
            <defs>
              <linearGradient id="sparkGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#6366F1" stopOpacity="0.18" />
                <stop offset="100%" stopColor="#6366F1" stopOpacity="0" />
              </linearGradient>
            </defs>
            <path d={areaD} fill="url(#sparkGrad)" />
            <path d={pathD} fill="none" stroke="#6366F1" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>

        {/* Per-model bars */}
        <div style={{ gridColumn: '1 / -1', background: '#F9FAFB', border: '1px solid rgba(0,0,0,0.07)', borderRadius: 16, padding: '16px 20px' }}>
          <p style={{ fontSize: 11, fontWeight: 600, color: '#9CA3AF', textTransform: 'uppercase', letterSpacing: '0.08em', margin: '0 0 14px' }}>Performance by Model</p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {DEMO_MODELS.map((m, i) => (
              <div key={m.name} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <span style={{ fontSize: 12, fontWeight: 600, color: '#4B5563', width: 76, flexShrink: 0 }}>{m.name}</span>
                <div style={{ flex: 1, height: 8, background: '#E5E7EB', borderRadius: 100, overflow: 'hidden' }}>
                  <div style={{
                    height: '100%',
                    width: `${barWidths[i] || 0}%`,
                    background: m.color,
                    borderRadius: 100,
                    transition: `width 0.8s cubic-bezier(0.4,0,0.2,1) ${i * 80}ms`,
                  }} />
                </div>
                <span style={{ fontSize: 12, fontWeight: 700, color: '#0F0F12', width: 36, textAlign: 'right', flexShrink: 0 }}>{m.score}%</span>
              </div>
            ))}
          </div>
        </div>

        {/* Citation gaps */}
        <div style={{ gridColumn: '1 / -1', background: '#FFF7ED', border: '1px solid rgba(251,146,60,0.2)', borderRadius: 16, padding: '16px 20px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
            <TrendingDown size={14} color="#F97316" />
            <p style={{ fontSize: 11, fontWeight: 600, color: '#F97316', textTransform: 'uppercase', letterSpacing: '0.08em', margin: 0 }}>Top Citation Gaps</p>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {DEMO_GAPS.map((g) => (
              <div key={g.prompt} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ fontSize: 13, color: '#4B5563' }}>&ldquo;{g.prompt}&rdquo;</span>
                <span style={{ fontSize: 12, fontWeight: 700, color: '#EF4444', background: 'rgba(239,68,68,0.08)', padding: '2px 8px', borderRadius: 100 }}>{g.score}%</span>
              </div>
            ))}
          </div>
        </div>

      </div>
    </div>
  );
}

// ── Pricing comparison table ───────────────────────────────────────────────────

function ComparisonCell({ value }: { value: string | boolean }) {
  if (value === true) return <span style={{ color: '#10B981', fontWeight: 700, fontSize: 16 }}>✓</span>;
  if (value === false) return <span style={{ color: '#D1D5DB', fontSize: 16 }}>—</span>;
  return <span style={{ fontSize: 13, color: '#4B5563', fontWeight: 500 }}>{value}</span>;
}

// ── Page ───────────────────────────────────────────────────────────────────────

export default function LandingPage() {
  useEffect(() => {
    const prevBg = document.body.style.backgroundColor;
    const prevColor = document.body.style.color;
    document.body.style.backgroundColor = '#F8F7F4';
    document.body.style.color = '#0F0F12';
    return () => {
      document.body.style.backgroundColor = prevBg;
      document.body.style.color = prevColor;
    };
  }, []);

  const [scrolled, setScrolled] = useState(false);
  const [openFaq, setOpenFaq] = useState<number | null>(null);
  useEffect(() => {
    const handler = () => setScrolled(window.scrollY > 20);
    window.addEventListener('scroll', handler, { passive: true });
    return () => window.removeEventListener('scroll', handler);
  }, []);

  return (
    <div
      style={{
        position: 'relative',
        backgroundColor: '#F8F7F4',
        color: '#0F0F12',
        fontFamily: "'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
        minHeight: '100vh',
        overflowX: 'hidden',
      }}
    >
      {/* Google Font */}
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap');
        @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
        @keyframes fadeSlideUp { from { opacity: 0; transform: translateY(20px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes float { 0%,100% { transform: translateY(0px); } 50% { transform: translateY(-8px); } }
        .step-grid { display: grid; grid-template-columns: 1fr; gap: 32px; }
        .step-connector { display: none; }
        @media (min-width: 768px) {
          .step-grid { grid-template-columns: 1fr auto 1fr auto 1fr; gap: 0; align-items: start; }
          .step-connector { display: flex; align-items: flex-start; padding-top: 32px; color: rgba(99,102,241,0.25); flex-shrink: 0; }
        }
        .faq-answer-wrap { overflow: hidden; transition: max-height 0.32s ease, opacity 0.32s ease; }
        .faq-chevron { transition: transform 0.28s ease; }
        .faq-row { cursor: pointer; transition: background 0.15s; }
        .faq-row:hover { background: rgba(0,0,0,0.02); }
        .demo-float { animation: float 4s ease-in-out infinite; }
        .compare-table { border-collapse: collapse; width: 100%; }
        .compare-table th, .compare-table td { padding: 12px 16px; text-align: center; font-size: 13px; }
        .compare-table th:first-child, .compare-table td:first-child { text-align: left; }
        .compare-table tr:nth-child(even) td { background: rgba(0,0,0,0.015); }
        .compare-table tr:hover td { background: rgba(99,102,241,0.04); }
        @media (max-width: 600px) {
          .compare-table th, .compare-table td { padding: 10px 10px; font-size: 12px; }
        }
      `}</style>

      {/* ── Full-viewport background gradient layer ── */}
      <div
        aria-hidden="true"
        style={{ position: 'fixed', inset: 0, pointerEvents: 'none', zIndex: 0, overflow: 'hidden' }}
      >
        <div style={{ position: 'absolute', top: '-20vh', left: '-15vw', width: '70vw', height: '70vw', maxWidth: 900, maxHeight: 900, borderRadius: '50%', background: 'radial-gradient(circle at 40% 40%, rgba(147,197,253,0.38) 0%, rgba(147,197,253,0.08) 50%, transparent 72%)', filter: 'blur(60px)' }} />
        <div style={{ position: 'absolute', top: '-10vh', right: '-10vw', width: '60vw', height: '60vw', maxWidth: 800, maxHeight: 800, borderRadius: '50%', background: 'radial-gradient(circle at 60% 40%, rgba(196,181,253,0.32) 0%, rgba(196,181,253,0.06) 50%, transparent 72%)', filter: 'blur(60px)' }} />
        <div style={{ position: 'absolute', top: '35vh', left: '25vw', width: '55vw', height: '55vw', maxWidth: 750, maxHeight: 750, borderRadius: '50%', background: 'radial-gradient(circle at 50% 50%, rgba(167,243,208,0.22) 0%, rgba(167,243,208,0.04) 55%, transparent 72%)', filter: 'blur(70px)' }} />
        <div style={{ position: 'absolute', bottom: '5vh', left: '-5vw', width: '45vw', height: '45vw', maxWidth: 600, maxHeight: 600, borderRadius: '50%', background: 'radial-gradient(circle at 40% 60%, rgba(147,197,253,0.18) 0%, transparent 70%)', filter: 'blur(60px)' }} />
        <div style={{ position: 'absolute', inset: 0, backgroundImage: NOISE_SVG, backgroundRepeat: 'repeat', backgroundSize: '200px 200px', opacity: 0.05, mixBlendMode: 'multiply' }} />
      </div>

      {/* ── All page content ── */}
      <div style={{ position: 'relative', zIndex: 1 }}>

        {/* ── Sticky nav ── */}
        <nav
          style={{
            position: 'sticky', top: 0, zIndex: 50,
            transition: 'background 0.3s, border-color 0.3s',
            backgroundColor: scrolled ? 'rgba(248,247,244,0.82)' : 'transparent',
            backdropFilter: scrolled ? 'blur(16px)' : 'none',
            WebkitBackdropFilter: scrolled ? 'blur(16px)' : 'none',
            borderBottom: scrolled ? '1px solid rgba(0,0,0,0.06)' : '1px solid transparent',
          }}
        >
          <div style={{ maxWidth: 1120, margin: '0 auto', padding: '0 24px', height: 64, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <LumidianLogo size={32} withWordmark variant="light" />
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Link href="/login" style={{ fontSize: 14, fontWeight: 500, color: '#6B7280', padding: '8px 16px', textDecoration: 'none', borderRadius: 8, transition: 'color 0.15s' }}
                onMouseEnter={(e) => (e.currentTarget.style.color = '#0F0F12')}
                onMouseLeave={(e) => (e.currentTarget.style.color = '#6B7280')}>
                Sign in
              </Link>
              <Link href="/register" style={{ fontSize: 14, fontWeight: 600, color: '#fff', background: '#0F0F12', padding: '9px 20px', borderRadius: 100, textDecoration: 'none', transition: 'background 0.15s' }}
                onMouseEnter={(e) => { e.currentTarget.style.background = '#2a2a3a'; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = '#0F0F12'; }}>
                Get Started
              </Link>
            </div>
          </div>
        </nav>

        {/* ── Hero ── */}
        <section style={{ padding: '96px 24px 48px', textAlign: 'center' }}>
          <div style={{ maxWidth: 1120, margin: '0 auto' }}>
            {/* Pill badge */}
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, background: 'rgba(255,255,255,0.7)', backdropFilter: 'blur(8px)', border: '1px solid rgba(0,0,0,0.08)', borderRadius: 100, padding: '6px 14px 6px 10px', marginBottom: 32, fontSize: 13, fontWeight: 500, color: '#4B5563', boxShadow: '0 1px 4px rgba(0,0,0,0.06)', animation: 'fadeIn 0.5s ease-out both' }}>
              <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#10b981', display: 'inline-block' }} />
              Now tracking ChatGPT, Claude, Perplexity &amp; Gemini
            </div>

            {/* Headline */}
            <h1 style={{ fontSize: 'clamp(44px, 7vw, 76px)', fontWeight: 800, lineHeight: 1.06, letterSpacing: '-0.035em', color: '#0F0F12', maxWidth: 760, margin: '0 auto 24px', animation: 'fadeSlideUp 0.5s ease-out 80ms both' }}>
              Know exactly when AI{' '}
              <span style={{ background: 'linear-gradient(135deg, #4F46E5 0%, #7C3AED 100%)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text' }}>
                mentions your brand
              </span>
              {' '}— and fix it when it doesn&apos;t
            </h1>

            {/* Sub-headline */}
            <p style={{ fontSize: 20, color: '#6B7280', maxWidth: 560, margin: '0 auto 40px', lineHeight: 1.65, fontWeight: 400, animation: 'fadeSlideUp 0.5s ease-out 160ms both' }}>
              Lumidian tracks your brand across ChatGPT, Claude, Perplexity, and Gemini,
              then automatically drafts content to close every gap.
            </p>

            {/* CTAs */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12, flexWrap: 'wrap', animation: 'fadeSlideUp 0.5s ease-out 240ms both', marginBottom: 64 }}>
              <Link href="/register" style={{ display: 'inline-flex', alignItems: 'center', gap: 8, background: '#0F0F12', color: '#fff', fontWeight: 600, fontSize: 15, padding: '14px 28px', borderRadius: 100, textDecoration: 'none', transition: 'background 0.15s, box-shadow 0.15s', boxShadow: '0 2px 12px rgba(15,15,18,0.18)' }}
                onMouseEnter={(e) => { e.currentTarget.style.background = '#2a2a3a'; e.currentTarget.style.boxShadow = '0 4px 20px rgba(15,15,18,0.28)'; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = '#0F0F12'; e.currentTarget.style.boxShadow = '0 2px 12px rgba(15,15,18,0.18)'; }}>
                Start Free Trial
                <ArrowRight size={16} />
              </Link>
              <Link href="/login" style={{ display: 'inline-flex', alignItems: 'center', fontWeight: 500, fontSize: 15, color: '#4B5563', padding: '14px 24px', borderRadius: 100, textDecoration: 'none', background: 'rgba(255,255,255,0.7)', backdropFilter: 'blur(8px)', border: '1px solid rgba(0,0,0,0.10)', transition: 'border-color 0.15s, color 0.15s' }}
                onMouseEnter={(e) => { e.currentTarget.style.color = '#0F0F12'; e.currentTarget.style.borderColor = 'rgba(0,0,0,0.2)'; }}
                onMouseLeave={(e) => { e.currentTarget.style.color = '#4B5563'; e.currentTarget.style.borderColor = 'rgba(0,0,0,0.10)'; }}>
                Sign in
              </Link>
            </div>

            {/* ── Demo dashboard mockup ── */}
            <FadeUp>
              <div className="demo-float">
                <DemoDashboard />
              </div>
            </FadeUp>
          </div>
        </section>

        {/* ── Model logos bar ── */}
        <FadeUp>
          <section style={{ borderBottom: '1px solid rgba(0,0,0,0.06)', background: 'transparent', marginTop: 48 }}>
            <div style={{ maxWidth: 1120, margin: '0 auto', padding: '28px 24px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 13, color: '#9CA3AF', fontWeight: 500, marginRight: 8 }}>Monitoring</span>
              {AI_MODELS.map((model) => (
                <span key={model} style={{ fontSize: 13, fontWeight: 600, color: '#4B5563', background: 'rgba(255,255,255,0.8)', border: '1px solid rgba(0,0,0,0.08)', borderRadius: 100, padding: '5px 14px', letterSpacing: '-0.01em' }}>
                  {model}
                </span>
              ))}
            </div>
          </section>
        </FadeUp>

        {/* ── Stats bar ── */}
        <FadeUp>
          <section style={{ maxWidth: 1120, margin: '0 auto', padding: '72px 24px 0' }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 2, background: 'rgba(0,0,0,0.05)', borderRadius: 20, overflow: 'hidden' }}>
              {[
                { value: '4', label: 'AI models monitored' },
                { value: '2×', label: 'Daily automated reports' },
                { value: '100+', label: 'Queries per brand run' },
              ].map((stat) => (
                <div key={stat.label} style={{ background: 'rgba(248,247,244,0.8)', padding: '32px 24px', textAlign: 'center' }}>
                  <p style={{ fontSize: 44, fontWeight: 800, color: '#0F0F12', letterSpacing: '-0.04em', margin: '0 0 6px' }}>{stat.value}</p>
                  <p style={{ fontSize: 14, color: '#6B7280', fontWeight: 500, margin: 0 }}>{stat.label}</p>
                </div>
              ))}
            </div>
          </section>
        </FadeUp>

        {/* ── Features ── */}
        <section style={{ maxWidth: 1120, margin: '0 auto', padding: '96px 24px' }}>
          <FadeUp>
            <div style={{ textAlign: 'center', marginBottom: 56 }}>
              <p style={{ fontSize: 13, fontWeight: 600, color: '#6366F1', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 12 }}>Features</p>
              <h2 style={{ fontSize: 'clamp(28px, 4vw, 44px)', fontWeight: 800, letterSpacing: '-0.03em', color: '#0F0F12', margin: '0 0 14px' }}>
                Everything to own your AI presence
              </h2>
              <p style={{ fontSize: 17, color: '#6B7280', maxWidth: 480, margin: '0 auto', lineHeight: 1.6 }}>
                From tracking to fixing — Lumidian handles the full visibility lifecycle automatically.
              </p>
            </div>
          </FadeUp>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 16 }}>
            {FEATURES.map((f, i) => {
              const Icon = f.icon;
              return (
                <FadeUp key={f.title} delay={i * 100}>
                  <div style={{ background: 'rgba(255,255,255,0.72)', backdropFilter: 'blur(12px)', border: '1px solid rgba(0,0,0,0.07)', borderRadius: 20, padding: '28px 28px 32px', height: '100%', transition: 'box-shadow 0.2s, transform 0.2s' }}
                    onMouseEnter={(e) => { (e.currentTarget as HTMLDivElement).style.boxShadow = '0 8px 32px rgba(0,0,0,0.08)'; (e.currentTarget as HTMLDivElement).style.transform = 'translateY(-2px)'; }}
                    onMouseLeave={(e) => { (e.currentTarget as HTMLDivElement).style.boxShadow = 'none'; (e.currentTarget as HTMLDivElement).style.transform = 'translateY(0)'; }}>
                    <div style={{ width: 44, height: 44, borderRadius: 12, background: 'rgba(99,102,241,0.08)', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 18 }}>
                      <Icon size={20} color="#6366F1" />
                    </div>
                    <h3 style={{ fontSize: 16, fontWeight: 700, color: '#0F0F12', margin: '0 0 8px', letterSpacing: '-0.02em' }}>{f.title}</h3>
                    <p style={{ fontSize: 14, color: '#6B7280', lineHeight: 1.65, margin: 0 }}>{f.desc}</p>
                  </div>
                </FadeUp>
              );
            })}
          </div>
        </section>

        {/* ── How It Works ── */}
        <section style={{ maxWidth: 1120, margin: '0 auto', padding: '96px 24px' }}>
          <FadeUp>
            <div style={{ textAlign: 'center', marginBottom: 64 }}>
              <p style={{ fontSize: 13, fontWeight: 600, color: '#6366F1', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 12 }}>How it works</p>
              <h2 style={{ fontSize: 'clamp(28px, 4vw, 44px)', fontWeight: 800, letterSpacing: '-0.03em', color: '#0F0F12', margin: '0 0 14px' }}>
                From invisible to inevitable
              </h2>
              <p style={{ fontSize: 17, color: '#6B7280', maxWidth: 440, margin: '0 auto', lineHeight: 1.6 }}>
                Three steps to make your brand the answer AI always recommends.
              </p>
            </div>
          </FadeUp>
          <div className="step-grid">
            {HOW_STEPS[0] && <FadeUp delay={0}><StepCard step={HOW_STEPS[0]} /></FadeUp>}
            <div className="step-connector" style={{ width: 56, justifyContent: 'center', paddingTop: 40 }}>
              <div style={{ flex: 1, borderTop: '2px dashed rgba(99,102,241,0.22)' }} />
              <ArrowRight size={14} color="rgba(99,102,241,0.40)" style={{ flexShrink: 0, marginTop: -8 }} />
            </div>
            {HOW_STEPS[1] && <FadeUp delay={120}><StepCard step={HOW_STEPS[1]} /></FadeUp>}
            <div className="step-connector" style={{ width: 56, justifyContent: 'center', paddingTop: 40 }}>
              <div style={{ flex: 1, borderTop: '2px dashed rgba(99,102,241,0.22)' }} />
              <ArrowRight size={14} color="rgba(99,102,241,0.40)" style={{ flexShrink: 0, marginTop: -8 }} />
            </div>
            {HOW_STEPS[2] && <FadeUp delay={240}><StepCard step={HOW_STEPS[2]} /></FadeUp>}
          </div>
        </section>


        {/* ── Supported Platforms ── */}
        <FadeUp>
          <section style={{ background: 'transparent', borderBottom: '1px solid rgba(0,0,0,0.06)' }}>
            <div style={{ maxWidth: 1120, margin: '0 auto', padding: '72px 24px' }}>
              <p style={{ textAlign: 'center', fontSize: 14, fontWeight: 600, color: '#6B7280', marginBottom: 40, letterSpacing: '-0.01em' }}>
                Works across every major AI platform and content channel
              </p>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', flexWrap: 'wrap', gap: 0 }}>
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
                  <span style={{ fontSize: 11, fontWeight: 600, color: '#9CA3AF', letterSpacing: '0.07em', textTransform: 'uppercase' }}>AI Models Tracked</span>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, justifyContent: 'center' }}>
                    {PLATFORM_AI.map((name) => (
                      <span key={name} style={{ display: 'inline-flex', alignItems: 'center', gap: 7, fontSize: 13, fontWeight: 600, color: '#0F0F12', background: 'rgba(255,255,255,0.85)', border: '1px solid rgba(0,0,0,0.10)', borderRadius: 100, padding: '7px 16px', boxShadow: '0 1px 4px rgba(0,0,0,0.05)' }}>
                        <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#10b981', display: 'inline-block', flexShrink: 0 }} />
                        {name}
                      </span>
                    ))}
                  </div>
                </div>
                <div style={{ width: 1, height: 56, background: 'rgba(0,0,0,0.08)', margin: '0 40px', flexShrink: 0, alignSelf: 'flex-end', marginBottom: 4 }} />
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
                  <span style={{ fontSize: 11, fontWeight: 600, color: '#9CA3AF', letterSpacing: '0.07em', textTransform: 'uppercase' }}>Content Channels</span>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, justifyContent: 'center' }}>
                    {PLATFORM_CONTENT.map((name) => (
                      <span key={name} style={{ display: 'inline-flex', alignItems: 'center', gap: 7, fontSize: 13, fontWeight: 600, color: '#4B5563', background: 'rgba(255,255,255,0.85)', border: '1px solid rgba(0,0,0,0.10)', borderRadius: 100, padding: '7px 16px', boxShadow: '0 1px 4px rgba(0,0,0,0.05)' }}>
                        <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#6366F1', display: 'inline-block', flexShrink: 0 }} />
                        {name}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </section>
        </FadeUp>

        {/* ── FAQ ── */}
        <section style={{ maxWidth: 1120, margin: '0 auto', padding: '96px 24px' }}>
          <FadeUp>
            <div style={{ textAlign: 'center', marginBottom: 56 }}>
              <p style={{ fontSize: 13, fontWeight: 600, color: '#6366F1', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 12 }}>FAQ</p>
              <h2 style={{ fontSize: 'clamp(28px, 4vw, 44px)', fontWeight: 800, letterSpacing: '-0.03em', color: '#0F0F12', margin: 0 }}>
                Frequently asked questions
              </h2>
            </div>
          </FadeUp>
          <FadeUp delay={60}>
            <div style={{ maxWidth: 720, margin: '0 auto', background: 'rgba(255,255,255,0.72)', backdropFilter: 'blur(12px)', border: '1px solid rgba(0,0,0,0.07)', borderRadius: 24, overflow: 'hidden' }}>
              {FAQ_ITEMS.map((item, i) => {
                const isOpen = openFaq === i;
                return (
                  <div key={i} style={{ borderBottom: i < FAQ_ITEMS.length - 1 ? '1px solid rgba(0,0,0,0.06)' : 'none' }}>
                    <button className="faq-row" onClick={() => setOpenFaq(isOpen ? null : i)} style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, padding: '22px 28px', background: 'transparent', border: 'none', cursor: 'pointer', textAlign: 'left' }}>
                      <span style={{ fontSize: 15, fontWeight: 600, color: '#0F0F12', letterSpacing: '-0.01em', flex: 1 }}>{item.q}</span>
                      <ChevronDown size={17} color="#9CA3AF" className="faq-chevron" style={{ flexShrink: 0, transform: isOpen ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform 0.28s ease' }} />
                    </button>
                    <div className="faq-answer-wrap" style={{ maxHeight: isOpen ? 400 : 0, opacity: isOpen ? 1 : 0 }}>
                      <p style={{ fontSize: 14, color: '#6B7280', lineHeight: 1.7, margin: 0, padding: '0 28px 22px' }}>{item.a}</p>
                    </div>
                  </div>
                );
              })}
            </div>
          </FadeUp>
        </section>

        {/* ── Pricing ── */}
        <section style={{ background: 'rgba(255,255,255,0.55)', backdropFilter: 'blur(12px)', borderTop: '1px solid rgba(0,0,0,0.06)', borderBottom: '1px solid rgba(0,0,0,0.06)' }}>
          <div style={{ maxWidth: 1120, margin: '0 auto', padding: '96px 24px' }}>
            <FadeUp>
              <div style={{ textAlign: 'center', marginBottom: 56 }}>
                <p style={{ fontSize: 13, fontWeight: 600, color: '#6366F1', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 12 }}>Pricing</p>
                <h2 style={{ fontSize: 'clamp(28px, 4vw, 44px)', fontWeight: 800, letterSpacing: '-0.03em', color: '#0F0F12', margin: '0 0 14px' }}>
                  Simple, transparent pricing
                </h2>
                <p style={{ fontSize: 17, color: '#6B7280', maxWidth: 380, margin: '0 auto', lineHeight: 1.6 }}>
                  Start free with a pitch deck — upgrade when you&apos;re ready to scale.
                </p>
              </div>
            </FadeUp>

            {/* Pricing cards */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 20, maxWidth: 1000, margin: '0 auto 64px' }}>
              {/* Free */}
              <FadeUp delay={0}>
                <div style={{ border: '1px solid rgba(0,0,0,0.08)', borderRadius: 24, padding: '36px 32px', background: 'rgba(250,250,249,0.85)', height: '100%' }}>
                  <p style={{ fontSize: 13, fontWeight: 600, color: '#9CA3AF', letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 8 }}>Free</p>
                  <div style={{ display: 'flex', alignItems: 'flex-end', gap: 4, marginBottom: 4 }}>
                    <span style={{ fontSize: 48, fontWeight: 800, color: '#0F0F12', letterSpacing: '-0.04em', lineHeight: 1 }}>$0</span>
                    <span style={{ fontSize: 15, color: '#9CA3AF', paddingBottom: 4 }}>/mo</span>
                  </div>
                  <p style={{ fontSize: 13, color: '#9CA3AF', marginBottom: 28 }}>Pitch deck · no card required</p>
                  <Link href="/register" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 600, fontSize: 14, color: '#0F0F12', background: '#fff', border: '1px solid rgba(0,0,0,0.12)', borderRadius: 100, padding: '12px 20px', textDecoration: 'none', marginBottom: 28, transition: 'background 0.15s' }}
                    onMouseEnter={(e) => { e.currentTarget.style.background = '#F3F4F6'; }}
                    onMouseLeave={(e) => { e.currentTarget.style.background = '#fff'; }}>
                    Get started
                  </Link>
                  <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 12 }}>
                    {['1 pitch deck (10 prompts, 30-day)', 'No credit card required', '4 AI models (ChatGPT, Claude, Perplexity, Gemini)', 'Visibility score & report', '1 manual run per day'].map((f) => (
                      <li key={f} style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                        <Check size={15} color="#10b981" style={{ flexShrink: 0, marginTop: 2 }} />
                        <span style={{ fontSize: 14, color: '#4B5563' }}>{f}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </FadeUp>

              {/* Starter */}
              <FadeUp delay={100}>
                <div style={{ border: '1.5px solid rgba(99,102,241,0.4)', borderRadius: 24, padding: '36px 32px', background: 'linear-gradient(145deg, rgba(238,242,255,0.85) 0%, rgba(245,243,255,0.85) 100%)', height: '100%', position: 'relative' }}>
                  <div style={{ position: 'absolute', top: -14, left: '50%', transform: 'translateX(-50%)', background: '#4F46E5', color: '#fff', fontSize: 11, fontWeight: 700, padding: '4px 14px', borderRadius: 100, whiteSpace: 'nowrap', letterSpacing: '0.04em' }}>
                    Most Popular
                  </div>
                  <p style={{ fontSize: 13, fontWeight: 600, color: '#6366F1', letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 8 }}>Starter</p>
                  <div style={{ display: 'flex', alignItems: 'flex-end', gap: 4, marginBottom: 4 }}>
                    <span style={{ fontSize: 48, fontWeight: 800, color: '#0F0F12', letterSpacing: '-0.04em', lineHeight: 1 }}>$300</span>
                    <span style={{ fontSize: 15, color: '#9CA3AF', paddingBottom: 4 }}>/mo</span>
                  </div>
                  <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: 'rgba(99,102,241,0.10)', border: '1px solid rgba(99,102,241,0.20)', borderRadius: 100, padding: '3px 10px', marginBottom: 6 }}>
                    <span style={{ fontSize: 11, fontWeight: 700, color: '#6366F1', letterSpacing: '0.04em' }}>30-DAY FREE TRIAL</span>
                  </div>
                  <p style={{ fontSize: 13, color: '#9CA3AF', marginBottom: 28 }}>No charge for 30 days · cancel anytime</p>
                  <Link href="/register" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 600, fontSize: 14, color: '#fff', background: '#4F46E5', border: '1.5px solid #4F46E5', borderRadius: 100, padding: '12px 20px', textDecoration: 'none', marginBottom: 28, transition: 'background 0.15s', boxShadow: '0 2px 12px rgba(79,70,229,0.30)' }}
                    onMouseEnter={(e) => { e.currentTarget.style.background = '#4338CA'; }}
                    onMouseLeave={(e) => { e.currentTarget.style.background = '#4F46E5'; }}>
                    Start Free Trial
                  </Link>
                  <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 12 }}>
                    {['2 standard brands (25 prompts each)', '3 pitch decks (30-day each)', '1 manual run per day', 'Content Hub & gap analysis', 'Brand profile & voice settings', 'Reddit opportunity scanner', 'Email support'].map((f) => (
                      <li key={f} style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                        <Check size={15} color="#6366F1" style={{ flexShrink: 0, marginTop: 2 }} />
                        <span style={{ fontSize: 14, color: '#4B5563' }}>{f}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </FadeUp>

              {/* Pro */}
              <FadeUp delay={200}>
                <div style={{ border: '1px solid rgba(0,0,0,0.08)', borderRadius: 24, padding: '36px 32px', background: 'rgba(250,250,249,0.85)', height: '100%', position: 'relative' }}>
                  <div style={{ position: 'absolute', top: -14, left: '50%', transform: 'translateX(-50%)', background: '#10B981', color: '#fff', fontSize: 11, fontWeight: 700, padding: '4px 14px', borderRadius: 100, whiteSpace: 'nowrap', letterSpacing: '0.04em' }}>
                    30-Day Free Trial
                  </div>
                  <p style={{ fontSize: 13, fontWeight: 600, color: '#9CA3AF', letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 8 }}>Pro</p>
                  <div style={{ display: 'flex', alignItems: 'flex-end', gap: 4, marginBottom: 4 }}>
                    <span style={{ fontSize: 48, fontWeight: 800, color: '#0F0F12', letterSpacing: '-0.04em', lineHeight: 1 }}>$500</span>
                    <span style={{ fontSize: 15, color: '#9CA3AF', paddingBottom: 4 }}>/mo</span>
                  </div>
                  <p style={{ fontSize: 13, color: '#9CA3AF', marginBottom: 28 }}>No charge for 30 days · cancel anytime</p>
                  <Link href="/register" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 600, fontSize: 14, color: '#fff', background: '#10B981', border: '1.5px solid #10B981', borderRadius: 100, padding: '12px 20px', textDecoration: 'none', marginBottom: 28, transition: 'background 0.15s' }}
                    onMouseEnter={(e) => { e.currentTarget.style.background = '#059669'; }}
                    onMouseLeave={(e) => { e.currentTarget.style.background = '#10B981'; }}>
                    Start Free Trial
                  </Link>
                  <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 12 }}>
                    {['4 standard brands (100 prompts each)', 'Unlimited pitch decks', 'Unlimited manual runs', 'Content Hub & gap analysis', 'Brand profile & voice settings', 'Priority support'].map((f) => (
                      <li key={f} style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                        <Check size={15} color="#10B981" style={{ flexShrink: 0, marginTop: 2 }} />
                        <span style={{ fontSize: 14, color: '#4B5563' }}>{f}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </FadeUp>
            </div>

            {/* ── Comparison table ── */}
            <FadeUp delay={100}>
              <div style={{ maxWidth: 900, margin: '0 auto' }}>
                <p style={{ textAlign: 'center', fontSize: 14, fontWeight: 600, color: '#6B7280', marginBottom: 28 }}>Full feature comparison</p>
                <div style={{ background: 'rgba(255,255,255,0.85)', border: '1px solid rgba(0,0,0,0.08)', borderRadius: 20, overflow: 'hidden' }}>
                  <table className="compare-table">
                    <thead>
                      <tr style={{ borderBottom: '2px solid rgba(0,0,0,0.08)' }}>
                        <th style={{ fontSize: 13, fontWeight: 600, color: '#9CA3AF', padding: '16px 16px', textAlign: 'left' }}>Feature</th>
                        <th style={{ fontSize: 13, fontWeight: 700, color: '#6B7280' }}>Free</th>
                        <th style={{ fontSize: 13, fontWeight: 700, color: '#6366F1', background: 'rgba(99,102,241,0.04)' }}>Starter</th>
                        <th style={{ fontSize: 13, fontWeight: 700, color: '#10B981' }}>Pro</th>
                      </tr>
                    </thead>
                    <tbody>
                      {COMPARISON_FEATURES.map((row, i) => (
                        <tr key={row.label} style={{ borderBottom: i < COMPARISON_FEATURES.length - 1 ? '1px solid rgba(0,0,0,0.05)' : 'none' }}>
                          <td style={{ fontSize: 13, fontWeight: 500, color: '#374151', padding: '12px 16px', textAlign: 'left' }}>{row.label}</td>
                          <td style={{ textAlign: 'center', padding: '12px 16px' }}><ComparisonCell value={row.free} /></td>
                          <td style={{ textAlign: 'center', padding: '12px 16px', background: 'rgba(99,102,241,0.03)' }}><ComparisonCell value={row.starter} /></td>
                          <td style={{ textAlign: 'center', padding: '12px 16px' }}><ComparisonCell value={row.pro} /></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </FadeUp>
          </div>
        </section>

        {/* ── CTA banner ── */}
        <section style={{ maxWidth: 1120, margin: '0 auto', padding: '96px 24px' }}>
          <FadeUp>
            <div style={{ background: '#0F0F12', borderRadius: 28, padding: 'clamp(48px, 6vw, 80px) 48px', textAlign: 'center', position: 'relative', overflow: 'hidden' }}>
              <div aria-hidden="true" style={{ position: 'absolute', top: -60, right: -60, width: 320, height: 320, borderRadius: '50%', background: 'radial-gradient(circle, rgba(99,102,241,0.3) 0%, transparent 70%)', filter: 'blur(40px)', pointerEvents: 'none' }} />
              <div aria-hidden="true" style={{ position: 'absolute', bottom: -40, left: -40, width: 240, height: 240, borderRadius: '50%', background: 'radial-gradient(circle, rgba(167,243,208,0.15) 0%, transparent 70%)', filter: 'blur(40px)', pointerEvents: 'none' }} />
              <div style={{ position: 'relative', zIndex: 1 }}>
                <h2 style={{ fontSize: 'clamp(28px, 4vw, 48px)', fontWeight: 800, color: '#fff', letterSpacing: '-0.03em', margin: '0 0 16px', lineHeight: 1.15 }}>
                  Ready to see your AI visibility?
                </h2>
                <p style={{ fontSize: 17, color: 'rgba(255,255,255,0.55)', maxWidth: 440, margin: '0 auto 36px', lineHeight: 1.6 }}>
                  Set up your first brand in under 2 minutes. 30-day free trial on all paid plans — cancel anytime before you&apos;re charged.
                </p>
                <Link href="/register" style={{ display: 'inline-flex', alignItems: 'center', gap: 8, background: '#fff', color: '#0F0F12', fontWeight: 700, fontSize: 15, padding: '14px 28px', borderRadius: 100, textDecoration: 'none', transition: 'background 0.15s', boxShadow: '0 2px 16px rgba(255,255,255,0.15)' }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = '#F3F4F6'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = '#fff'; }}>
                  Start Free Trial
                  <ArrowRight size={16} />
                </Link>
              </div>
            </div>
          </FadeUp>
        </section>

        {/* ── Footer ── */}
        <footer style={{ borderTop: '1px solid rgba(0,0,0,0.06)', padding: '28px 24px' }}>
          <div style={{ maxWidth: 1120, margin: '0 auto', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <LumidianLogo size={24} withWordmark variant="light" />
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 24, flexWrap: 'wrap' }}>
              <Link href="/terms" style={{ fontSize: 12, color: '#9CA3AF', textDecoration: 'none', fontWeight: 500 }}>Terms</Link>
              <Link href="/privacy" style={{ fontSize: 12, color: '#9CA3AF', textDecoration: 'none', fontWeight: 500 }}>Privacy</Link>
              <p style={{ fontSize: 12, color: '#9CA3AF', margin: 0 }}>&copy; 2026 Lumidian. All rights reserved.</p>
            </div>
          </div>
        </footer>

      </div>
    </div>
  );
}
