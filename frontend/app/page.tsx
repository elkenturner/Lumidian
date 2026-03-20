'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { BarChart2, Target, Sparkles, TrendingUp, Check, ArrowRight, MessageSquare, Settings2, ChevronDown } from 'lucide-react';
import OceanLogo from '@/components/OceanLogo';

// ── Scroll-reveal hook ─────────────────────────────────────────────────────────

function useInView(threshold = 0.1) {
  const ref = useRef<HTMLDivElement>(null);
  const [inView, setInView] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    // If the element is already above the fold on mount, skip animation
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

const STARTER_FEATURES = [
  '1 pitch brand (10 prompts, 7-day)',
  'No credit card required',
  '4 AI models (ChatGPT, Claude, Perplexity, Gemini)',
  'Visibility score & report',
];

const PRO_FEATURES = [
  '1 standard brand (25 prompts)',
  '1 pitch brand (10 prompts, 7-day)',
  'Content Hub & gap analysis',
  'Brand profile & voice settings',
  'Reddit opportunity scanner',
  'Email support',
];

const AI_MODELS = ['ChatGPT', 'Claude', 'Perplexity', 'Gemini'];

const HOW_STEPS = [
  {
    n: '1',
    title: 'Track Your Visibility',
    desc: 'Connect your brand and set the prompts you want to track. ClarityAI queries ChatGPT, Claude, Perplexity, and Gemini twice daily and scores how often your brand appears.',
  },
  {
    n: '2',
    title: 'Identify the Gaps',
    desc: 'See exactly which prompts your brand is missing from and what competitors are being recommended instead. Every gap is scored by urgency.',
  },
  {
    n: '3',
    title: 'Fix It with Content',
    desc: 'ClarityAI drafts platform-specific content targeting your weakest prompts — Reddit posts, Quora answers, Medium articles, and Wikipedia edits — ready for your review.',
  },
];

const PLATFORM_AI = ['ChatGPT', 'Claude', 'Perplexity', 'Gemini'];
const PLATFORM_CONTENT = ['Reddit', 'Quora', 'Medium', 'Wikipedia'];

const FAQ_ITEMS = [
  {
    q: 'How does ClarityAI track AI visibility?',
    a: 'ClarityAI runs your tracked prompts across ChatGPT, Claude, Perplexity, and Gemini twice daily, analyzing each response to detect whether your brand is mentioned. Results are scored and stored so you can track changes over time.',
  },
  {
    q: 'What kind of content does ClarityAI draft?',
    a: 'ClarityAI generates Reddit posts, Quora answers, Medium articles, and Wikipedia edits — all targeted at the specific prompts where your brand has low visibility. Every draft follows your brand voice and approved language guidelines.',
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
    q: 'What makes ClarityAI different from SEO tools?',
    a: "Traditional SEO tools track Google rankings. ClarityAI tracks what AI models say about your brand when users ask questions — a fundamentally different signal that SEO tools don't measure.",
  },
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

// ── Page ───────────────────────────────────────────────────────────────────────

export default function LandingPage() {
  // Override dark body background for this page only
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
      `}</style>

      {/* ── Full-viewport background gradient layer (fixed, bleeds to all edges) ── */}
      <div
        aria-hidden
        style={{
          position: 'fixed',
          inset: 0,
          pointerEvents: 'none',
          zIndex: 0,
          overflow: 'hidden',
        }}
      >
        {/* Blue — top-left corner, large and soft */}
        <div style={{
          position: 'absolute',
          top: '-20vh',
          left: '-15vw',
          width: '70vw',
          height: '70vw',
          maxWidth: 900,
          maxHeight: 900,
          borderRadius: '50%',
          background: 'radial-gradient(circle at 40% 40%, rgba(147,197,253,0.38) 0%, rgba(147,197,253,0.08) 50%, transparent 72%)',
          filter: 'blur(60px)',
        }} />
        {/* Purple — top-right, overlapping with blue for smooth blend */}
        <div style={{
          position: 'absolute',
          top: '-10vh',
          right: '-10vw',
          width: '60vw',
          height: '60vw',
          maxWidth: 800,
          maxHeight: 800,
          borderRadius: '50%',
          background: 'radial-gradient(circle at 60% 40%, rgba(196,181,253,0.32) 0%, rgba(196,181,253,0.06) 50%, transparent 72%)',
          filter: 'blur(60px)',
        }} />
        {/* Mint — lower center, flows into features section */}
        <div style={{
          position: 'absolute',
          top: '35vh',
          left: '25vw',
          width: '55vw',
          height: '55vw',
          maxWidth: 750,
          maxHeight: 750,
          borderRadius: '50%',
          background: 'radial-gradient(circle at 50% 50%, rgba(167,243,208,0.22) 0%, rgba(167,243,208,0.04) 55%, transparent 72%)',
          filter: 'blur(70px)',
        }} />
        {/* Soft blue — bottom left, ties lower sections together */}
        <div style={{
          position: 'absolute',
          bottom: '5vh',
          left: '-5vw',
          width: '45vw',
          height: '45vw',
          maxWidth: 600,
          maxHeight: 600,
          borderRadius: '50%',
          background: 'radial-gradient(circle at 40% 60%, rgba(147,197,253,0.18) 0%, transparent 70%)',
          filter: 'blur(60px)',
        }} />

        {/* Noise / grain texture overlay — 5% opacity */}
        <div style={{
          position: 'absolute',
          inset: 0,
          backgroundImage: NOISE_SVG,
          backgroundRepeat: 'repeat',
          backgroundSize: '200px 200px',
          opacity: 0.05,
          mixBlendMode: 'multiply',
        }} />
      </div>

      {/* ── All page content — sits above background layer ─────────────────────── */}
      <div style={{ position: 'relative', zIndex: 1 }}>

        {/* ── Sticky nav ─────────────────────────────────────────────────────── */}
        <nav
          style={{
            position: 'sticky',
            top: 0,
            zIndex: 50,
            transition: 'background 0.3s, border-color 0.3s',
            backgroundColor: scrolled ? 'rgba(248,247,244,0.82)' : 'transparent',
            backdropFilter: scrolled ? 'blur(16px)' : 'none',
            WebkitBackdropFilter: scrolled ? 'blur(16px)' : 'none',
            borderBottom: scrolled ? '1px solid rgba(0,0,0,0.06)' : '1px solid transparent',
          }}
        >
          <div style={{ maxWidth: 1120, margin: '0 auto', padding: '0 24px', height: 64, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <OceanLogo size={32} withCircle />
              <span style={{ fontSize: 16, fontWeight: 700, color: '#0F0F12', letterSpacing: '-0.02em' }}>ClarityAI</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Link
                href="/login"
                style={{ fontSize: 14, fontWeight: 500, color: '#6B7280', padding: '8px 16px', textDecoration: 'none', borderRadius: 8, transition: 'color 0.15s' }}
                onMouseEnter={(e) => (e.currentTarget.style.color = '#0F0F12')}
                onMouseLeave={(e) => (e.currentTarget.style.color = '#6B7280')}
              >
                Sign in
              </Link>
              <Link
                href="/register"
                style={{ fontSize: 14, fontWeight: 600, color: '#fff', background: '#0F0F12', padding: '9px 20px', borderRadius: 100, textDecoration: 'none', transition: 'background 0.15s' }}
                onMouseEnter={(e) => { e.currentTarget.style.background = '#2a2a3a'; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = '#0F0F12'; }}
              >
                Get Started
              </Link>
            </div>
          </div>
        </nav>

        {/* ── Hero — no overflow:hidden, no maxWidth on outer, blobs show through ─ */}
        <section style={{ padding: '96px 24px 80px', textAlign: 'center' }}>
          <div style={{ maxWidth: 1120, margin: '0 auto' }}>
            {/* Pill badge — animates on load */}
            <div
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 8,
                background: 'rgba(255,255,255,0.7)',
                backdropFilter: 'blur(8px)',
                border: '1px solid rgba(0,0,0,0.08)',
                borderRadius: 100,
                padding: '6px 14px 6px 10px',
                marginBottom: 32,
                fontSize: 13,
                fontWeight: 500,
                color: '#4B5563',
                boxShadow: '0 1px 4px rgba(0,0,0,0.06)',
                animation: 'fadeIn 0.5s ease-out both',
              }}
            >
              <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#10b981', display: 'inline-block' }} />
              Now tracking ChatGPT, Claude, Perplexity &amp; Gemini
            </div>

            {/* Headline */}
            <h1
              style={{
                fontSize: 'clamp(44px, 7vw, 76px)',
                fontWeight: 800,
                lineHeight: 1.06,
                letterSpacing: '-0.035em',
                color: '#0F0F12',
                maxWidth: 760,
                margin: '0 auto 24px',
                animation: 'fadeSlideUp 0.5s ease-out 80ms both',
              }}
            >
              Your brand in every{' '}
              <span
                style={{
                  background: 'linear-gradient(135deg, #4F46E5 0%, #7C3AED 100%)',
                  WebkitBackgroundClip: 'text',
                  WebkitTextFillColor: 'transparent',
                  backgroundClip: 'text',
                }}
              >
                AI answer
              </span>
              {' '}— not your competitor&apos;s
            </h1>

            {/* Sub-headline */}
            <p
              style={{
                fontSize: 20,
                color: '#6B7280',
                maxWidth: 560,
                margin: '0 auto 40px',
                lineHeight: 1.65,
                fontWeight: 400,
                animation: 'fadeSlideUp 0.5s ease-out 160ms both',
              }}
            >
              ClarityAI tracks your brand across ChatGPT, Claude, Perplexity, and Gemini,
              then automatically drafts content to close every gap.
            </p>

            {/* CTAs */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 12,
                flexWrap: 'wrap',
                animation: 'fadeSlideUp 0.5s ease-out 240ms both',
              }}
            >
              <Link
                href="/register"
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 8,
                  background: '#0F0F12',
                  color: '#fff',
                  fontWeight: 600,
                  fontSize: 15,
                  padding: '14px 28px',
                  borderRadius: 100,
                  textDecoration: 'none',
                  transition: 'background 0.15s, box-shadow 0.15s',
                  boxShadow: '0 2px 12px rgba(15,15,18,0.18)',
                }}
                onMouseEnter={(e) => { e.currentTarget.style.background = '#2a2a3a'; e.currentTarget.style.boxShadow = '0 4px 20px rgba(15,15,18,0.28)'; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = '#0F0F12'; e.currentTarget.style.boxShadow = '0 2px 12px rgba(15,15,18,0.18)'; }}
              >
                Start Free Trial
                <ArrowRight size={16} />
              </Link>
              <Link
                href="/login"
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  fontWeight: 500,
                  fontSize: 15,
                  color: '#4B5563',
                  padding: '14px 24px',
                  borderRadius: 100,
                  textDecoration: 'none',
                  background: 'rgba(255,255,255,0.7)',
                  backdropFilter: 'blur(8px)',
                  border: '1px solid rgba(0,0,0,0.10)',
                  transition: 'border-color 0.15s, color 0.15s',
                }}
                onMouseEnter={(e) => { e.currentTarget.style.color = '#0F0F12'; e.currentTarget.style.borderColor = 'rgba(0,0,0,0.2)'; }}
                onMouseLeave={(e) => { e.currentTarget.style.color = '#4B5563'; e.currentTarget.style.borderColor = 'rgba(0,0,0,0.10)'; }}
              >
                Sign in
              </Link>
            </div>
          </div>
        </section>

        {/* ── Model logos bar ─────────────────────────────────────────────────── */}
        <FadeUp>
          <section style={{ borderBottom: '1px solid rgba(0,0,0,0.06)', background: 'transparent' }}>
            <div style={{ maxWidth: 1120, margin: '0 auto', padding: '28px 24px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 13, color: '#9CA3AF', fontWeight: 500, marginRight: 8 }}>Monitoring</span>
              {AI_MODELS.map((model) => (
                <span
                  key={model}
                  style={{
                    fontSize: 13,
                    fontWeight: 600,
                    color: '#4B5563',
                    background: 'rgba(255,255,255,0.8)',
                    border: '1px solid rgba(0,0,0,0.08)',
                    borderRadius: 100,
                    padding: '5px 14px',
                    letterSpacing: '-0.01em',
                  }}
                >
                  {model}
                </span>
              ))}
            </div>
          </section>
        </FadeUp>

        {/* ── Stats bar ────────────────────────────────────────────────────────── */}
        <FadeUp>
          <section style={{ maxWidth: 1120, margin: '0 auto', padding: '72px 24px 0' }}>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
                gap: 2,
                background: 'rgba(0,0,0,0.05)',
                borderRadius: 20,
                overflow: 'hidden',
              }}
            >
              {[
                { value: '4', label: 'AI models monitored' },
                { value: '2×', label: 'Daily automated reports' },
                { value: '10+', label: 'Platforms tracked' },
              ].map((stat) => (
                <div
                  key={stat.label}
                  style={{ background: 'rgba(248,247,244,0.8)', padding: '32px 24px', textAlign: 'center' }}
                >
                  <p style={{ fontSize: 44, fontWeight: 800, color: '#0F0F12', letterSpacing: '-0.04em', margin: '0 0 6px' }}>{stat.value}</p>
                  <p style={{ fontSize: 14, color: '#6B7280', fontWeight: 500, margin: 0 }}>{stat.label}</p>
                </div>
              ))}
            </div>
          </section>
        </FadeUp>

        {/* ── Features ─────────────────────────────────────────────────────────── */}
        <section style={{ maxWidth: 1120, margin: '0 auto', padding: '96px 24px' }}>
          <FadeUp>
            <div style={{ textAlign: 'center', marginBottom: 56 }}>
              <p style={{ fontSize: 13, fontWeight: 600, color: '#6366F1', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 12 }}>Features</p>
              <h2 style={{ fontSize: 'clamp(28px, 4vw, 44px)', fontWeight: 800, letterSpacing: '-0.03em', color: '#0F0F12', margin: '0 0 14px' }}>
                Everything to own your AI presence
              </h2>
              <p style={{ fontSize: 17, color: '#6B7280', maxWidth: 480, margin: '0 auto', lineHeight: 1.6 }}>
                From tracking to fixing — ClarityAI handles the full visibility lifecycle automatically.
              </p>
            </div>
          </FadeUp>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))',
              gap: 16,
            }}
          >
            {FEATURES.map((f, i) => {
              const Icon = f.icon;
              return (
                <FadeUp key={f.title} delay={i * 100}>
                  <div
                    style={{
                      background: 'rgba(255,255,255,0.72)',
                      backdropFilter: 'blur(12px)',
                      border: '1px solid rgba(0,0,0,0.07)',
                      borderRadius: 20,
                      padding: '28px 28px 32px',
                      height: '100%',
                      transition: 'box-shadow 0.2s, transform 0.2s',
                    }}
                    onMouseEnter={(e) => {
                      (e.currentTarget as HTMLDivElement).style.boxShadow = '0 8px 32px rgba(0,0,0,0.08)';
                      (e.currentTarget as HTMLDivElement).style.transform = 'translateY(-2px)';
                    }}
                    onMouseLeave={(e) => {
                      (e.currentTarget as HTMLDivElement).style.boxShadow = 'none';
                      (e.currentTarget as HTMLDivElement).style.transform = 'translateY(0)';
                    }}
                  >
                    <div
                      style={{
                        width: 44,
                        height: 44,
                        borderRadius: 12,
                        background: 'rgba(99,102,241,0.08)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        marginBottom: 18,
                      }}
                    >
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

        {/* ── How It Works ─────────────────────────────────────────────────────── */}
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
            {HOW_STEPS[0] && (
              <FadeUp delay={0}>
                <StepCard step={HOW_STEPS[0]} />
              </FadeUp>
            )}
            <div className="step-connector" style={{ width: 56, justifyContent: 'center', paddingTop: 40 }}>
              <div style={{ flex: 1, borderTop: '2px dashed rgba(99,102,241,0.22)' }} />
              <ArrowRight size={14} color="rgba(99,102,241,0.40)" style={{ flexShrink: 0, marginTop: -8 }} />
            </div>
            {HOW_STEPS[1] && (
              <FadeUp delay={120}>
                <StepCard step={HOW_STEPS[1]} />
              </FadeUp>
            )}
            <div className="step-connector" style={{ width: 56, justifyContent: 'center', paddingTop: 40 }}>
              <div style={{ flex: 1, borderTop: '2px dashed rgba(99,102,241,0.22)' }} />
              <ArrowRight size={14} color="rgba(99,102,241,0.40)" style={{ flexShrink: 0, marginTop: -8 }} />
            </div>
            {HOW_STEPS[2] && (
              <FadeUp delay={240}>
                <StepCard step={HOW_STEPS[2]} />
              </FadeUp>
            )}
          </div>
        </section>

        {/* ── Supported Platforms ───────────────────────────────────────────────── */}
        <FadeUp>
          <section style={{
            background: 'rgba(255,255,255,0.55)',
            backdropFilter: 'blur(12px)',
            borderTop: '1px solid rgba(0,0,0,0.06)',
            borderBottom: '1px solid rgba(0,0,0,0.06)',
          }}>
            <div style={{ maxWidth: 1120, margin: '0 auto', padding: '72px 24px' }}>
              <p style={{ textAlign: 'center', fontSize: 14, fontWeight: 600, color: '#6B7280', marginBottom: 40, letterSpacing: '-0.01em' }}>
                Works across every major AI platform and content channel
              </p>
              <div style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexWrap: 'wrap',
                gap: 0,
              }}>
                {/* AI Models group */}
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
                  <span style={{ fontSize: 11, fontWeight: 600, color: '#9CA3AF', letterSpacing: '0.07em', textTransform: 'uppercase' }}>AI Models Tracked</span>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, justifyContent: 'center' }}>
                    {PLATFORM_AI.map((name) => (
                      <span
                        key={name}
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: 7,
                          fontSize: 13,
                          fontWeight: 600,
                          color: '#0F0F12',
                          background: 'rgba(255,255,255,0.85)',
                          border: '1px solid rgba(0,0,0,0.10)',
                          borderRadius: 100,
                          padding: '7px 16px',
                          boxShadow: '0 1px 4px rgba(0,0,0,0.05)',
                        }}
                      >
                        <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#10b981', display: 'inline-block', flexShrink: 0 }} />
                        {name}
                      </span>
                    ))}
                  </div>
                </div>

                {/* Divider */}
                <div style={{
                  width: 1,
                  height: 56,
                  background: 'rgba(0,0,0,0.08)',
                  margin: '0 40px',
                  flexShrink: 0,
                  alignSelf: 'flex-end',
                  marginBottom: 4,
                }} />

                {/* Content Platforms group */}
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
                  <span style={{ fontSize: 11, fontWeight: 600, color: '#9CA3AF', letterSpacing: '0.07em', textTransform: 'uppercase' }}>Content Channels</span>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, justifyContent: 'center' }}>
                    {PLATFORM_CONTENT.map((name) => (
                      <span
                        key={name}
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: 7,
                          fontSize: 13,
                          fontWeight: 600,
                          color: '#4B5563',
                          background: 'rgba(255,255,255,0.85)',
                          border: '1px solid rgba(0,0,0,0.10)',
                          borderRadius: 100,
                          padding: '7px 16px',
                          boxShadow: '0 1px 4px rgba(0,0,0,0.05)',
                        }}
                      >
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

        {/* ── FAQ ──────────────────────────────────────────────────────────────── */}
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
            <div style={{
              maxWidth: 720,
              margin: '0 auto',
              background: 'rgba(255,255,255,0.72)',
              backdropFilter: 'blur(12px)',
              border: '1px solid rgba(0,0,0,0.07)',
              borderRadius: 24,
              overflow: 'hidden',
            }}>
              {FAQ_ITEMS.map((item, i) => {
                const isOpen = openFaq === i;
                return (
                  <div
                    key={i}
                    style={{ borderBottom: i < FAQ_ITEMS.length - 1 ? '1px solid rgba(0,0,0,0.06)' : 'none' }}
                  >
                    <button
                      className="faq-row"
                      onClick={() => setOpenFaq(isOpen ? null : i)}
                      style={{
                        width: '100%',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        gap: 16,
                        padding: '22px 28px',
                        background: 'transparent',
                        border: 'none',
                        cursor: 'pointer',
                        textAlign: 'left',
                      }}
                    >
                      <span style={{ fontSize: 15, fontWeight: 600, color: '#0F0F12', letterSpacing: '-0.01em', flex: 1 }}>
                        {item.q}
                      </span>
                      <ChevronDown
                        size={17}
                        color="#9CA3AF"
                        className="faq-chevron"
                        style={{ flexShrink: 0, transform: isOpen ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform 0.28s ease' }}
                      />
                    </button>
                    <div
                      className="faq-answer-wrap"
                      style={{
                        maxHeight: isOpen ? 400 : 0,
                        opacity: isOpen ? 1 : 0,
                      }}
                    >
                      <p style={{ fontSize: 14, color: '#6B7280', lineHeight: 1.7, margin: 0, padding: '0 28px 22px' }}>
                        {item.a}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          </FadeUp>
        </section>

        {/* ── Pricing ──────────────────────────────────────────────────────────── */}
        <section style={{ background: 'rgba(255,255,255,0.55)', backdropFilter: 'blur(12px)', borderTop: '1px solid rgba(0,0,0,0.06)', borderBottom: '1px solid rgba(0,0,0,0.06)' }}>
          <div style={{ maxWidth: 1120, margin: '0 auto', padding: '96px 24px' }}>
            <FadeUp>
              <div style={{ textAlign: 'center', marginBottom: 56 }}>
                <p style={{ fontSize: 13, fontWeight: 600, color: '#6366F1', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 12 }}>Pricing</p>
                <h2 style={{ fontSize: 'clamp(28px, 4vw, 44px)', fontWeight: 800, letterSpacing: '-0.03em', color: '#0F0F12', margin: '0 0 14px' }}>
                  Simple, transparent pricing
                </h2>
                <p style={{ fontSize: 17, color: '#6B7280', maxWidth: 380, margin: '0 auto', lineHeight: 1.6 }}>
                  Start free with a pitch deck — upgrade when you're ready to scale.
                </p>
              </div>
            </FadeUp>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
                gap: 20,
                maxWidth: 1000,
                margin: '0 auto',
              }}
            >
              {/* Free */}
              <FadeUp delay={0}>
                <div
                  style={{
                    border: '1px solid rgba(0,0,0,0.08)',
                    borderRadius: 24,
                    padding: '36px 32px',
                    background: 'rgba(250,250,249,0.85)',
                    height: '100%',
                  }}
                >
                  <p style={{ fontSize: 13, fontWeight: 600, color: '#9CA3AF', letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 8 }}>Free</p>
                  <div style={{ display: 'flex', alignItems: 'flex-end', gap: 4, marginBottom: 4 }}>
                    <span style={{ fontSize: 48, fontWeight: 800, color: '#0F0F12', letterSpacing: '-0.04em', lineHeight: 1 }}>$0</span>
                    <span style={{ fontSize: 15, color: '#9CA3AF', paddingBottom: 4 }}>/mo</span>
                  </div>
                  <p style={{ fontSize: 13, color: '#9CA3AF', marginBottom: 28 }}>Pitch deck · no card required</p>
                  <Link
                    href="/register"
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontWeight: 600,
                      fontSize: 14,
                      color: '#0F0F12',
                      background: '#fff',
                      border: '1px solid rgba(0,0,0,0.12)',
                      borderRadius: 100,
                      padding: '12px 20px',
                      textDecoration: 'none',
                      marginBottom: 28,
                      transition: 'background 0.15s',
                    }}
                    onMouseEnter={(e) => { e.currentTarget.style.background = '#F3F4F6'; }}
                    onMouseLeave={(e) => { e.currentTarget.style.background = '#fff'; }}
                  >
                    Get started
                  </Link>
                  <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 12 }}>
                    {STARTER_FEATURES.map((f) => (
                      <li key={f} style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                        <Check size={15} color="#10b981" style={{ flexShrink: 0, marginTop: 2 }} />
                        <span style={{ fontSize: 14, color: '#4B5563' }}>{f}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </FadeUp>

              {/* Pro */}
              <FadeUp delay={100}>
                <div
                  style={{
                    border: '1.5px solid rgba(99,102,241,0.4)',
                    borderRadius: 24,
                    padding: '36px 32px',
                    background: 'linear-gradient(145deg, rgba(238,242,255,0.85) 0%, rgba(245,243,255,0.85) 100%)',
                    height: '100%',
                    position: 'relative',
                  }}
                >
                  <div
                    style={{
                      position: 'absolute',
                      top: -14,
                      left: '50%',
                      transform: 'translateX(-50%)',
                      background: '#4F46E5',
                      color: '#fff',
                      fontSize: 11,
                      fontWeight: 700,
                      padding: '4px 14px',
                      borderRadius: 100,
                      whiteSpace: 'nowrap',
                      letterSpacing: '0.04em',
                    }}
                  >
                    Most Popular
                  </div>
                  <p style={{ fontSize: 13, fontWeight: 600, color: '#6366F1', letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 8 }}>Starter</p>
                  <div style={{ display: 'flex', alignItems: 'flex-end', gap: 4, marginBottom: 4 }}>
                    <span style={{ fontSize: 48, fontWeight: 800, color: '#0F0F12', letterSpacing: '-0.04em', lineHeight: 1 }}>$300</span>
                    <span style={{ fontSize: 15, color: '#9CA3AF', paddingBottom: 4 }}>/mo</span>
                  </div>
                  <p style={{ fontSize: 13, color: '#9CA3AF', marginBottom: 28 }}>Billed monthly</p>
                  <Link
                    href="/register"
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontWeight: 600,
                      fontSize: 14,
                      color: '#fff',
                      background: '#4F46E5',
                      border: '1.5px solid #4F46E5',
                      borderRadius: 100,
                      padding: '12px 20px',
                      textDecoration: 'none',
                      marginBottom: 28,
                      transition: 'background 0.15s',
                      boxShadow: '0 2px 12px rgba(79,70,229,0.30)',
                    }}
                    onMouseEnter={(e) => { e.currentTarget.style.background = '#4338CA'; }}
                    onMouseLeave={(e) => { e.currentTarget.style.background = '#4F46E5'; }}
                  >
                    Get started
                  </Link>
                  <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 12 }}>
                    {PRO_FEATURES.map((f) => (
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
                <div
                  style={{
                    border: '1px solid rgba(0,0,0,0.08)',
                    borderRadius: 24,
                    padding: '36px 32px',
                    background: 'rgba(250,250,249,0.85)',
                    height: '100%',
                    position: 'relative',
                  }}
                >
                  <div
                    style={{
                      position: 'absolute',
                      top: -14,
                      left: '50%',
                      transform: 'translateX(-50%)',
                      background: '#10B981',
                      color: '#fff',
                      fontSize: 11,
                      fontWeight: 700,
                      padding: '4px 14px',
                      borderRadius: 100,
                      whiteSpace: 'nowrap',
                      letterSpacing: '0.04em',
                    }}
                  >
                    7-Day Free Trial
                  </div>
                  <p style={{ fontSize: 13, fontWeight: 600, color: '#9CA3AF', letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 8 }}>Pro</p>
                  <div style={{ display: 'flex', alignItems: 'flex-end', gap: 4, marginBottom: 4 }}>
                    <span style={{ fontSize: 48, fontWeight: 800, color: '#0F0F12', letterSpacing: '-0.04em', lineHeight: 1 }}>$500</span>
                    <span style={{ fontSize: 15, color: '#9CA3AF', paddingBottom: 4 }}>/mo</span>
                  </div>
                  <p style={{ fontSize: 13, color: '#9CA3AF', marginBottom: 28 }}>Billed monthly · 7 days free</p>
                  <Link
                    href="/register"
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontWeight: 600,
                      fontSize: 14,
                      color: '#fff',
                      background: '#10B981',
                      border: '1.5px solid #10B981',
                      borderRadius: 100,
                      padding: '12px 20px',
                      textDecoration: 'none',
                      marginBottom: 28,
                      transition: 'background 0.15s',
                    }}
                    onMouseEnter={(e) => { e.currentTarget.style.background = '#059669'; }}
                    onMouseLeave={(e) => { e.currentTarget.style.background = '#10B981'; }}
                  >
                    Start Free Trial
                  </Link>
                  <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 12 }}>
                    {[
                      '5 standard brands (100 prompts each)',
                      'Unlimited pitch decks',
                      'Content Hub & gap analysis',
                      'Brand profile & voice settings',
                      'Priority support',
                    ].map((f) => (
                      <li key={f} style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                        <Check size={15} color="#10B981" style={{ flexShrink: 0, marginTop: 2 }} />
                        <span style={{ fontSize: 14, color: '#4B5563' }}>{f}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </FadeUp>
            </div>
          </div>
        </section>

        {/* ── CTA banner ───────────────────────────────────────────────────────── */}
        <section style={{ maxWidth: 1120, margin: '0 auto', padding: '96px 24px' }}>
          <FadeUp>
            <div
              style={{
                background: '#0F0F12',
                borderRadius: 28,
                padding: 'clamp(48px, 6vw, 80px) 48px',
                textAlign: 'center',
                position: 'relative',
                overflow: 'hidden',
              }}
            >
              <div aria-hidden style={{ position: 'absolute', top: -60, right: -60, width: 320, height: 320, borderRadius: '50%', background: 'radial-gradient(circle, rgba(99,102,241,0.3) 0%, transparent 70%)', filter: 'blur(40px)', pointerEvents: 'none' }} />
              <div aria-hidden style={{ position: 'absolute', bottom: -40, left: -40, width: 240, height: 240, borderRadius: '50%', background: 'radial-gradient(circle, rgba(167,243,208,0.15) 0%, transparent 70%)', filter: 'blur(40px)', pointerEvents: 'none' }} />
              <div style={{ position: 'relative', zIndex: 1 }}>
                <h2 style={{ fontSize: 'clamp(28px, 4vw, 48px)', fontWeight: 800, color: '#fff', letterSpacing: '-0.03em', margin: '0 0 16px', lineHeight: 1.15 }}>
                  Ready to see your AI visibility?
                </h2>
                <p style={{ fontSize: 17, color: 'rgba(255,255,255,0.55)', maxWidth: 440, margin: '0 auto 36px', lineHeight: 1.6 }}>
                  Set up your first brand in under 2 minutes. No credit card required to start.
                </p>
                <Link
                  href="/register"
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 8,
                    background: '#fff',
                    color: '#0F0F12',
                    fontWeight: 700,
                    fontSize: 15,
                    padding: '14px 28px',
                    borderRadius: 100,
                    textDecoration: 'none',
                    transition: 'background 0.15s',
                    boxShadow: '0 2px 16px rgba(255,255,255,0.15)',
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = '#F3F4F6'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = '#fff'; }}
                >
                  Start Free Trial
                  <ArrowRight size={16} />
                </Link>
              </div>
            </div>
          </FadeUp>
        </section>

        {/* ── Footer ───────────────────────────────────────────────────────────── */}
        <footer style={{ borderTop: '1px solid rgba(0,0,0,0.06)', padding: '28px 24px' }}>
          <div style={{ maxWidth: 1120, margin: '0 auto', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <OceanLogo size={24} withCircle />
              <span style={{ fontSize: 13, fontWeight: 700, color: '#6B7280' }}>ClarityAI</span>
            </div>
            <p style={{ fontSize: 12, color: '#9CA3AF', margin: 0 }}>&copy; 2026 ClarityAI. All rights reserved.</p>
          </div>
        </footer>

      </div>{/* end content wrapper */}
    </div>
  );
}
