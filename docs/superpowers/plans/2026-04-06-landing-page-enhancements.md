# Landing Page Enhancements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add missing selling points (competitor tracking, sentiment), visual polish (dot grid, hover glow, animated CTA orb), and a mobile-friendly pricing tab switcher to the landing page.

**Architecture:** All changes are in `frontend/app/page.tsx`. We update data arrays, add elements to existing components, enhance CSS, and add a mobile pricing UI behind a responsive breakpoint. No new files, no new dependencies.

**Tech Stack:** Next.js 15, React 18, TypeScript, Tailwind CSS, lucide-react

---

## File Map

| File | Changes |
|------|---------|
| `frontend/app/page.tsx:5-19` | Add `Users`, `Activity` to lucide imports |
| `frontend/app/page.tsx:135-166` | Add 2 feature cards, update Monitor Trends desc |
| `frontend/app/page.tsx:460` | Change grid from `lg:grid-cols-3` to `lg:grid-cols-4` |
| `frontend/app/page.tsx:465` | Update feature card hover styles |
| `frontend/app/page.tsx:338-344` | Add dot grid overlay to hero |
| `frontend/app/page.tsx:538-706` | Add competitor panel to DashboardMockup |
| `frontend/app/page.tsx:715-779` | Add mobile tab UI to PricingSection |
| `frontend/app/page.tsx:848-878` | Add animated orb to CTASection |

---

### Task 1: Add new feature cards and update Monitor Trends

**Files:**
- Modify: `frontend/app/page.tsx:5-19` (imports)
- Modify: `frontend/app/page.tsx:135-166` (FEATURES array)
- Modify: `frontend/app/page.tsx:460` (grid cols)

- [ ] **Step 1: Add lucide imports**

In `frontend/app/page.tsx`, add `Users` and `Activity` to the lucide-react import block (lines 5-19):

```tsx
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
```

- [ ] **Step 2: Update FEATURES array**

Replace the Monitor Trends entry (lines 151-155) desc with:

```tsx
  {
    icon: TrendingUp,
    title: 'Monitor Trends',
    desc: 'Track visibility changes over time with trend charts, shareable PDF reports, and email alerts when your score drops.',
  },
```

After the last feature (Brand Voice Control, line 165), add two new entries before the closing `];`:

```tsx
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
```

- [ ] **Step 3: Update feature grid to 4 columns on desktop**

Change line 460 from:

```tsx
<div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
```

to:

```tsx
<div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
```

- [ ] **Step 4: Verify build**

Run: `cd frontend && npm run build 2>&1 | tail -5`
Expected: Build succeeds with no errors.

- [ ] **Step 5: Commit**

```bash
git add frontend/app/page.tsx
git commit -m "feat(landing): add competitor intelligence and sentiment feature cards"
```

---

### Task 2: Add competitor panel to dashboard mockup

**Files:**
- Modify: `frontend/app/page.tsx:538-706` (DashboardMockup component)

- [ ] **Step 1: Add competitor bar state**

Inside `DashboardMockup` (after the existing `barWidths` state on line 542), add:

```tsx
const [compWidths, setCompWidths] = useState([0, 0]);
```

Inside the existing `useEffect` (lines 546-552), add after `setBarWidths(...)`:

```tsx
setTimeout(() => {
  setCompWidths([72, 38]);
}, 400);
```

So the full useEffect becomes:

```tsx
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
```

- [ ] **Step 2: Add competitor comparison panel**

After the Citation Gaps section closing `</div>` (the one at line 702, just before the grid-closing `</div>` at line 703), add:

```tsx
          {/* Competitor comparison */}
          <div className="col-span-2 bg-[#1e293b] border border-[rgba(51,65,85,0.5)] rounded-2xl p-4">
            <p className="text-xs font-semibold text-[#64748b] uppercase tracking-wider mb-3">vs Competitors</p>
            <div className="space-y-2.5">
              <div className="flex items-center gap-3">
                <span className="text-xs font-medium text-[#94a3b8] w-24 flex-shrink-0">Your Brand</span>
                <div className="flex-1 h-2 bg-[rgba(255,255,255,0.08)] rounded-full overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all duration-700"
                    style={{ width: `${compWidths[0]}%`, backgroundColor: '#6366f1' }}
                  />
                </div>
                <span className="text-xs font-bold text-[#f8fafc] w-10 text-right">72%</span>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-xs font-medium text-[#94a3b8] w-24 flex-shrink-0">Competitor A</span>
                <div className="flex-1 h-2 bg-[rgba(255,255,255,0.08)] rounded-full overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all duration-700"
                    style={{ width: `${compWidths[1]}%`, backgroundColor: '#64748b', transitionDelay: '100ms' }}
                  />
                </div>
                <span className="text-xs font-bold text-[#f8fafc] w-10 text-right">38%</span>
              </div>
            </div>
          </div>
```

- [ ] **Step 3: Verify build**

Run: `cd frontend && npm run build 2>&1 | tail -5`
Expected: Build succeeds with no errors.

- [ ] **Step 4: Commit**

```bash
git add frontend/app/page.tsx
git commit -m "feat(landing): add competitor comparison panel to dashboard mockup"
```

---

### Task 3: Visual polish — hero dot grid, feature card glow, section headings

**Files:**
- Modify: `frontend/app/page.tsx:338-344` (hero background)
- Modify: `frontend/app/page.tsx:465` (feature card hover)

- [ ] **Step 1: Add dot grid overlay to hero**

In `HeroSection`, after the existing background gradient div (lines 339-344), add a second overlay div:

```tsx
      {/* Dot grid overlay */}
      <div
        className="absolute inset-0 pointer-events-none opacity-[0.15]"
        style={{
          backgroundImage: 'radial-gradient(circle, rgba(148,163,184,0.8) 1px, transparent 1px)',
          backgroundSize: '32px 32px',
        }}
      />
```

- [ ] **Step 2: Update feature card hover styles**

Replace the feature card div class (line 465) from:

```tsx
<div className="bg-[#0f172a] border border-[rgba(51,65,85,0.5)] rounded-2xl p-5 md:p-7 h-full transition-all duration-200 hover:-translate-y-1 hover:border-[rgba(71,85,105,0.5)] hover:shadow-[0_8px_32px_rgba(0,0,0,0.3)]">
```

to:

```tsx
<div className="bg-[#0f172a] border border-[rgba(51,65,85,0.5)] rounded-2xl p-5 md:p-7 h-full transition-all duration-200 hover:-translate-y-1 hover:border-[rgba(99,102,241,0.3)] hover:shadow-[0_0_24px_rgba(99,102,241,0.15),0_8px_32px_rgba(0,0,0,0.3)]">
```

- [ ] **Step 3: Verify build**

Run: `cd frontend && npm run build 2>&1 | tail -5`
Expected: Build succeeds with no errors.

- [ ] **Step 4: Commit**

```bash
git add frontend/app/page.tsx
git commit -m "style(landing): hero dot grid, feature card hover glow"
```

---

### Task 4: Animated gradient orb in CTA section

**Files:**
- Modify: `frontend/app/page.tsx:848-878` (CTASection)

- [ ] **Step 1: Add animated orb to CTA section**

Inside CTASection, right after the opening `<section>` tag and before `<div className="max-w-2xl...">` (line 856), add:

```tsx
      {/* Animated gradient orb */}
      <div
        className="absolute inset-0 pointer-events-none overflow-hidden"
      >
        <div
          className="absolute w-[600px] h-[600px] rounded-full opacity-20 blur-[120px]"
          style={{
            background: 'radial-gradient(circle, #6366f1 0%, #a855f7 50%, transparent 70%)',
            left: '50%',
            top: '50%',
            transform: 'translate(-50%, -50%)',
            animation: 'ctaOrb 10s ease-in-out infinite',
          }}
        />
      </div>
      <style>{`
        @keyframes ctaOrb {
          0%, 100% { transform: translate(-50%, -50%) scale(1); }
          33% { transform: translate(-45%, -55%) scale(1.1); }
          66% { transform: translate(-55%, -45%) scale(0.95); }
        }
      `}</style>
```

- [ ] **Step 2: Verify build**

Run: `cd frontend && npm run build 2>&1 | tail -5`
Expected: Build succeeds with no errors.

- [ ] **Step 3: Commit**

```bash
git add frontend/app/page.tsx
git commit -m "style(landing): animated gradient orb in CTA section"
```

---

### Task 5: Mobile pricing tab switcher

**Files:**
- Modify: `frontend/app/page.tsx:715-779` (PricingSection)

- [ ] **Step 1: Convert PricingSection to use state and add mobile UI**

Replace the entire `PricingSection` function (lines 715-779) with:

```tsx
function PricingSection() {
  const [mobileTier, setMobileTier] = useState<'free' | 'starter' | 'pro'>('pro');

  const tierMeta: Record<string, { name: string; price: string }> = {
    free: { name: 'Free Plan', price: '$0' },
    starter: { name: 'Starter Plan', price: '$300/mo' },
    pro: { name: 'Pro Plan', price: '$500/mo' },
  };

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

        {/* Desktop table */}
        <FadeUp delay={200}>
          <div className="hidden md:block overflow-x-auto">
            <table className="w-full border-collapse" style={{ minWidth: 500 }}>
              <thead>
                <tr className="bg-[#1e293b]">
                  <th className="text-left text-sm font-semibold text-[#f8fafc] p-3 md:p-4 rounded-tl-xl sticky left-0 bg-[#1e293b] z-10">Feature</th>
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
                    <td className="text-sm text-[#f8fafc] p-3 md:p-4 sticky left-0 z-10" style={{ background: i % 2 === 0 ? '#0f172a' : '#020617' }}>{row.label}</td>
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

        {/* Mobile tab switcher */}
        <FadeUp delay={200}>
          <div className="md:hidden">
            {/* Tabs */}
            <div className="flex gap-2 mb-6 bg-[#0f172a] rounded-full p-1 border border-[rgba(51,65,85,0.5)]">
              {(['free', 'starter', 'pro'] as const).map((tier) => (
                <button
                  key={tier}
                  onClick={() => setMobileTier(tier)}
                  className={`flex-1 py-2.5 text-sm font-semibold rounded-full transition-all ${
                    mobileTier === tier
                      ? 'bg-[#6366f1] text-white shadow-[0_0_12px_rgba(99,102,241,0.4)]'
                      : 'text-[#94a3b8] hover:text-white'
                  }`}
                >
                  {tier.charAt(0).toUpperCase() + tier.slice(1)}
                </button>
              ))}
            </div>

            {/* Card */}
            <div className="bg-[#0f172a] border border-[rgba(51,65,85,0.5)] rounded-2xl p-6">
              <p
                className="text-lg font-bold text-[#f8fafc] mb-1"
                style={{ fontFamily: 'var(--font-syne), system-ui, sans-serif' }}
              >
                {tierMeta[mobileTier].name}
              </p>
              <p className="text-3xl font-extrabold text-[#f8fafc] mb-6" style={{ fontFamily: 'var(--font-syne), system-ui, sans-serif' }}>
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
                      <span className={`text-sm ${isFalse ? 'text-[#475569]' : 'text-[#94a3b8]'}`}>
                        {typeof val === 'string' && val !== '—' ? `${val} — ${row.label}` : row.label}
                      </span>
                    </div>
                  );
                })}
              </div>

              <Link
                href="/register"
                className="mt-6 w-full inline-flex items-center justify-center gap-2 text-base font-semibold text-white py-3 rounded-full bg-[#6366f1] hover:bg-[#4f46e5] transition-all shadow-[0_0_24px_rgba(99,102,241,0.4)]"
              >
                Get started free
                <ArrowRight size={16} />
              </Link>
            </div>
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

- [ ] **Step 2: Verify build**

Run: `cd frontend && npm run build 2>&1 | tail -5`
Expected: Build succeeds with no errors.

- [ ] **Step 3: Verify on mobile width**

Run the dev server and check at 375px width:
- Tabs should render with "Pro" selected by default
- Features list should show checks/X marks correctly
- No horizontal scroll table visible
- Desktop (>768px) should still show the table

- [ ] **Step 4: Commit**

```bash
git add frontend/app/page.tsx
git commit -m "feat(landing): mobile pricing tab switcher replacing horizontal table"
```

---

### Task 6: Final verification and push

**Files:** None (verification only)

- [ ] **Step 1: Full build check**

Run: `cd frontend && npm run build 2>&1 | tail -10`
Expected: Build succeeds, no TypeScript or lint errors.

- [ ] **Step 2: Visual spot check**

Run dev server and verify:
1. Hero has subtle dot grid texture behind gradient
2. 8 feature cards display in 4x2 grid on desktop, 2-col on tablet, stacked on mobile
3. Feature cards glow indigo on hover
4. Dashboard mockup shows "vs Competitors" panel with animated bars
5. Mobile pricing shows tab switcher (test at 375px width)
6. Desktop pricing still shows table
7. CTA section has slow-moving gradient orb behind text

- [ ] **Step 3: Push all commits**

```bash
git push origin main
```
