# Landing Page Enhancements — Design Spec

**Date:** 2026-04-06
**Scope:** Content additions, visual polish, mobile pricing fix for `frontend/app/page.tsx`

---

## 1. New Feature Cards

Expand the `FEATURES` array from 6 to 8 cards. Grid adjusts: 4x2 on desktop (`lg:grid-cols-4`), 2x4 tablet, 1-col mobile.

### Card 7: Competitor Intelligence
- **Icon:** `Users` (lucide-react)
- **Title:** "Competitor Intelligence"
- **Desc:** "Track how often competitors appear alongside your brand. Compare mention rates, share of voice, and see who's winning each prompt."

### Card 8: Sentiment & Position
- **Icon:** `Activity` (lucide-react)
- **Title:** "Sentiment & Position"
- **Desc:** "Know whether AI models describe your brand positively, neutrally, or negatively — and where you appear in the response."

### Updated Card: Monitor Trends
- **Desc (new):** "Track visibility changes over time with trend charts, shareable PDF reports, and email alerts when your score drops."

---

## 2. Dashboard Mockup — Competitor Panel

Add a competitor comparison element inside the existing `DashboardMockup` component, below the per-model bar chart.

**Layout:**
- Small header: "vs Competitors" in muted text
- Two horizontal bars:
  - "Your Brand" — fills to 72%, accent color (#6366f1)
  - "Competitor A" — fills to 38%, muted color (#64748b)
- Bars animate on scroll using the same `useInView` trigger as existing model bars
- Percentage labels at the end of each bar

**Implementation:** Add state + `useEffect` for competitor bar widths inside existing `DashboardMockup`. No new components needed.

---

## 3. Visual Polish

### 3a. Hero Background — Dot Grid
- Pure CSS dot pattern overlay behind the existing radial gradient
- Subtle `radial-gradient` repeating pattern (small dots ~1px, spaced ~32px)
- Very low opacity (0.15-0.2) so it adds texture without competing with content
- No canvas, no JS — CSS `background-image` only

### 3b. Feature Card Hover Glow
- On hover, add a soft indigo box-shadow glow: `0 0 24px rgba(99,102,241,0.15)`
- Transition smoothly with existing hover transforms
- Replace current `hover:border-[rgba(71,85,105,0.5)]` with `hover:border-[rgba(99,102,241,0.3)]`

### 3c. CTA Section — Animated Gradient Orb
- Behind the final CTA text, add a large soft radial gradient blob
- Uses `@keyframes` to slowly shift position/scale (8-12s cycle)
- CSS-only, `position: absolute`, `pointer-events: none`
- Colors: indigo/purple matching brand palette, very low opacity

### 3d. Section Headings — Subtle Entrance
- No parallax (risk of jank on mobile). Instead, enhance existing `FadeUp` with slightly more dramatic translate distance (40px instead of 30px) for section headings specifically
- Add a brief scale component (0.97 -> 1.0) layered with the translateY for headings

---

## 4. Mobile Pricing — Tab Switcher

Replace the horizontal-scroll table on mobile (`< md` breakpoint, 768px) with a tab-based card UI.

### Structure
```
[Free] [Starter] [Pro]      ← pill tabs, horizontal row
┌────────────────────���────┐
│  Pro Plan                │
│  $500/mo                 │
│                          │
│  ✓ 2 pro brands          │
│  ✓ 100 prompts/brand     │
│  ✓ Unlimited runs         │
│  ✓ Content Hub            │
│  ✓ 25 drafts/week         │
│  ...                     │
│                          │
│  [Get Started Free]      │
└─────────────────────────┘
```

### Behavior
- `useState` for selected tier, default to "pro" (most visually compelling)
- Three pill-shaped tabs: inactive = dark bg + muted text, active = accent bg + white text
- Card shows: tier name, price (Free = "$0", Starter = "$300/mo", Pro = "$500/mo"), feature checklist from `COMPARISON_FEATURES`, CTA button
- Features render as: checkmark + label for booleans, value + label for strings, dash for false/missing
- Desktop (>= md): existing table, unchanged
- Wrap with `<div className="hidden md:block">` for table and `<div className="md:hidden">` for mobile tabs

### No new components
All implemented inline within `PricingSection`. The tab state and card are simple enough to not warrant extraction.

---

## Files Changed

| File | Change |
|------|--------|
| `frontend/app/page.tsx` | All changes — feature cards, mockup update, visual polish, mobile pricing |

No backend changes. No new files. No new dependencies.

---

## Out of Scope

- Page structure/narrative reorder
- Testimonials or social proof (no data yet)
- Interactive product demos
- Changes to other pages
- New npm packages (all CSS/inline)
