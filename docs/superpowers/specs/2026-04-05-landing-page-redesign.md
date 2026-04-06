# Landing Page Redesign Spec

**Date:** 2026-04-05  
**Status:** Approved  
**Goal:** Transform the landing page from generic "AI-created" light theme to a distinctive dark editorial design that matches the actual product.

---

## Problem Statement

The current landing page has three critical issues:

1. **Dashboard mockup mismatch** — Shows a light-themed simplified mockup while the real product is a dark, feature-rich dashboard
2. **Generic AI aesthetic** — Soft cream background, pastel gradient blobs, uniform layout screams "AI-generated template"
3. **No brand personality** — Missing the professional, data-forward identity the product deserves

---

## Design Direction

**"Dark Analytics Premium + Editorial Typography"**

- Dark navy theme matching the actual product
- Bold Syne typography at editorial scale
- Accurate dashboard mockup showing real features
- Minimal decorative elements — let the product speak
- Rich scroll animations for engagement

---

## Design System Changes

### Color Palette

| Token | Old Value | New Value |
|-------|-----------|-----------|
| `--landing-bg` | `#F8F7F4` (cream) | `#020617` (navy) |
| `--landing-bg-card` | `rgba(255,255,255,0.9)` | `#0f172a` |
| `--landing-text-primary` | `#0F0F12` | `#f8fafc` |
| `--landing-text-secondary` | `#4B5563` | `#94a3b8` |
| `--landing-text-muted` | `#6B7280` | `#64748b` |
| `--landing-border` | `rgba(0,0,0,0.08)` | `rgba(51,65,85,0.5)` |

**Accent colors remain:** Indigo `#6366f1` (pops better on dark)

**Model colors remain:**
- ChatGPT: `#22c55e`
- Claude: `#f97316`
- Perplexity: `#8b5cf6`
- Gemini: `#3b82f6`

### Typography Scale

| Element | Font | Weight | Size | Line Height |
|---------|------|--------|------|-------------|
| Hero headline | Syne | 800 | 72px (mobile: 40px) | 1.05 |
| Section headline | Syne | 700 | 44px (mobile: 32px) | 1.15 |
| Card title | Syne | 600 | 20px | 1.3 |
| Body | Inter | 400 | 16-18px | 1.6 |
| Label/small | Inter | 500 | 12-13px | 1.4 |

### Removed Elements

- Pastel gradient blobs (the blurred circles in background)
- Cream/off-white backgrounds
- Soft omnidirectional shadows
- Light-themed dashboard mockup
- `NOISE_SVG` texture on light (repurpose for dark)

### Added Elements

- Subtle radial gradient in hero (dark indigo center → navy edges)
- Glow effects on accent buttons: `box-shadow: 0 0 24px rgba(99,102,241,0.4)`
- Sharp directional shadow on mockup: `0 32px 64px rgba(0,0,0,0.5)`
- Subtle noise texture at 3% opacity on dark

---

## Scroll Animations

### Animation Library

Use existing `useInView` hook with enhanced variants. All animations use `cubic-bezier(0.16, 1, 0.3, 1)` (expo-out) for smooth deceleration.

### Animation Catalog

| Animation | Trigger | Properties | Duration | Delay |
|-----------|---------|------------|----------|-------|
| `fadeUp` | Element enters viewport | opacity 0→1, translateY 30px→0 | 600ms | stagger 80ms |
| `fadeIn` | Element enters viewport | opacity 0→1 | 500ms | — |
| `scaleIn` | Element enters viewport | opacity 0→1, scale 0.95→1 | 500ms | — |
| `slideInLeft` | Element enters viewport | opacity 0→1, translateX -40px→0 | 600ms | — |
| `slideInRight` | Element enters viewport | opacity 0→1, translateX 40px→0 | 600ms | — |
| `countUp` | Element enters viewport | Number animates from 0 to target | 1800ms | — |
| `drawLine` | Element enters viewport | SVG stroke-dashoffset animates | 1000ms | — |
| `barGrow` | Element enters viewport | width 0→target% | 800ms | stagger 100ms |
| `glowPulse` | Continuous on CTA | box-shadow opacity pulses | 2000ms | infinite |

### Per-Section Animations

**Hero:**
- Badge: `fadeIn` immediate
- Headline: `fadeUp` 100ms delay
- Subhead: `fadeUp` 200ms delay
- CTAs: `fadeUp` 300ms delay
- Mockup: `scaleIn` + `fadeUp` 400ms delay, slight parallax on scroll (translateY at 0.1x scroll speed)

**AI Models Bar:**
- Container: `fadeIn`
- Pills: `fadeUp` staggered 60ms each

**Stats Section:**
- Cards: `fadeUp` staggered 100ms
- Numbers: `countUp` triggered when card is 30% visible

**Features Grid:**
- Cards: `fadeUp` staggered 80ms
- Icons: `scaleIn` 200ms after card appears

**How It Works:**
- Step numbers: `scaleIn` with slight bounce
- Connecting line: `drawLine` SVG animation
- Cards: `slideInLeft` for odd, `slideInRight` for even

**Dashboard Mockup:**
- Container: `scaleIn` from 0.9
- Internal elements animate sequentially:
  - Score card: `fadeUp`
  - Score number: `countUp`
  - Sparkline: `drawLine` for the path
  - Model bars: `barGrow` staggered
  - Gaps section: `fadeUp`

**Pricing Table:**
- Header: `fadeIn`
- Rows: `fadeUp` staggered 40ms
- "Pro" column glow: `fadeIn` with 500ms delay

**FAQ:**
- Items: `fadeUp` staggered 60ms
- Expand/collapse: CSS `max-height` transition 300ms

**Footer:**
- `fadeIn` when 20% visible

### Parallax Effects

- Hero mockup: Moves at 0.9x scroll speed (subtle float effect)
- Background gradient: Fixed position, creates depth

### Hover Micro-interactions

| Element | Hover Effect |
|---------|--------------|
| CTA buttons | Scale 1.02, glow intensifies |
| Feature cards | TranslateY -4px, border lightens, shadow deepens |
| Nav links | Color transitions to white, subtle underline slides in |
| Model pills | Glow in model color appears |
| FAQ items | Background lightens slightly |
| Pricing rows | Background lightens |

---

## Section Specifications

### 1. Header/Navigation

```
Container: fixed top-0, full width, z-50
Background: transparent → rgba(2,6,23,0.85) backdrop-blur-lg on scroll
Height: 64px
Padding: 0 24px (desktop), 0 16px (mobile)

Logo: Lumidian logo, white variant
Nav links: text-[#94a3b8] hover:text-white, font-medium, 14px
CTA "Get Started": bg-[#6366f1] hover:bg-[#4f46e5], text-white, px-5 py-2.5, rounded-full, glow shadow
CTA "Log in": border border-[rgba(255,255,255,0.2)] text-white hover:border-white, px-4 py-2, rounded-full
```

### 2. Hero Section

```
Container: min-h-screen, flex items-center justify-center, pt-20
Background: #020617 with radial-gradient(ellipse at 50% 0%, rgba(99,102,241,0.15) 0%, transparent 60%)

Badge: 
  - Container: inline-flex, bg-[#0f172a], border border-[rgba(99,102,241,0.3)], rounded-full, px-4 py-1.5
  - Dot: w-2 h-2 rounded-full bg-[#22c55e] animate-pulse
  - Text: text-[#94a3b8] text-sm

Headline:
  - Font: Syne 800, 72px (desktop), 40px (mobile)
  - Color: #f8fafc
  - "AI" word: gradient text (indigo → purple)
  - Letter-spacing: -0.03em
  - Max-width: 800px

Subhead:
  - Font: Inter 400, 18px
  - Color: #94a3b8
  - Max-width: 560px
  - Margin-top: 24px

CTAs:
  - Container: flex gap-4, margin-top: 40px
  - Primary: bg-[#6366f1], text-white, px-8 py-4, rounded-full, text-lg font-semibold
    - Shadow: 0 0 32px rgba(99,102,241,0.4)
    - Hover: bg-[#4f46e5], shadow expands
  - Secondary: border border-[rgba(255,255,255,0.25)], text-white, px-6 py-4, rounded-full
    - Hover: border-white, bg-[rgba(255,255,255,0.05)]

Dashboard Mockup:
  - Container: margin-top 64px, max-width 900px, perspective 1000px
  - Transform: rotateX(2deg) — subtle tilt
  - Border-radius: 16px
  - Border: 1px solid rgba(99,102,241,0.2)
  - Shadow: 0 32px 64px rgba(0,0,0,0.5), 0 0 0 1px rgba(99,102,241,0.1)
  - Overflow: hidden
```

### 3. AI Models Bar

```
Container: py-16, border-y border-[rgba(51,65,85,0.5)]
Layout: flex justify-center gap-4 flex-wrap

Pills:
  - Container: flex items-center gap-2, bg-[#0f172a], border border-[rgba(51,65,85,0.5)], rounded-full, px-4 py-2
  - Left accent: w-2 h-2 rounded-full, color = model color
  - Text: text-white text-sm font-medium
  - Hover: border-color transitions to model color, subtle glow
```

### 4. Stats Section

```
Container: py-20, max-width 1200px, mx-auto
Layout: grid grid-cols-2 md:grid-cols-4 gap-4

Stat Card:
  - Background: #0f172a
  - Border: 1px solid rgba(51,65,85,0.5)
  - Border-top: 2px solid [rotating model colors]
  - Border-radius: 12px
  - Padding: 24px
  - Text-align: center

  Number: Syne 700, 40px, #f8fafc (countUp animation)
  Label: Inter 400, 14px, #64748b
```

### 5. Features Grid

```
Container: py-24, max-width 1200px, mx-auto
Section title: Syne 700, 44px, #f8fafc, text-center, mb-16

Grid: grid-cols-1 md:grid-cols-2 lg:grid-cols-3, gap-6

Feature Card:
  - Background: #0f172a
  - Border: 1px solid rgba(51,65,85,0.5)
  - Border-radius: 16px
  - Padding: 28px
  - Hover: translateY(-4px), border-color rgba(71,85,105,0.5), shadow 0 8px 32px rgba(0,0,0,0.3)
  - Transition: all 200ms ease-out

  Icon container: w-11 h-11, rounded-xl, bg-[rgba(99,102,241,0.15)], flex items-center justify-center
  Icon: text-[#6366f1], 20px
  Title: Syne 600, 18px, #f8fafc, mt-4
  Description: Inter 400, 14px, #94a3b8, mt-2, line-height 1.6
```

### 6. How It Works

```
Container: py-24, max-width 1000px, mx-auto
Section title: Syne 700, 44px, #f8fafc, text-center, mb-20

Layout: flex flex-col gap-0 (connected by line)

Step:
  - Layout: grid grid-cols-[80px_1fr] gap-6 items-start
  
  Number column:
    - Large number: Syne 800, 80px, gradient text (indigo)
    - Connecting line: 2px dashed rgba(99,102,241,0.3), stretches to next step
  
  Content:
    - Badge: inline-flex, bg-[rgba(99,102,241,0.1)], border border-[rgba(99,102,241,0.2)], rounded-full, px-3 py-1
      - Dot: w-1.5 h-1.5 rounded-full bg-[#6366f1]
      - Text: text-[#6366f1] text-xs font-semibold
    - Title: Syne 600, 20px, #f8fafc, mt-3
    - Description: Inter 400, 15px, #94a3b8, mt-2
```

### 7. Dashboard Mockup (Accurate Dark Version)

This replaces `DemoDashboard` component entirely.

```
Container:
  - Background: #0f172a
  - Border: 1px solid rgba(51,65,85,0.5)
  - Border-radius: 20px
  - Overflow: hidden
  - Shadow: 0 24px 80px rgba(0,0,0,0.4)
  - Max-width: 720px
  - Margin: 0 auto

Browser Chrome:
  - Background: #1e293b
  - Border-bottom: 1px solid rgba(51,65,85,0.5)
  - Padding: 12px 16px
  - Dots: #ef4444 (red), #fbbf24 (yellow), #22c55e (green)
  - URL bar: bg-[#0f172a], rounded-md, text-[#64748b] text-xs, "app.lumidian.ai/dashboard"

Dashboard Content (matches real dashboard):
  - Padding: 24px
  - Grid: 2 columns

  Visibility Score Card (spans 1 col):
    - Background: linear-gradient(135deg, #4f46e5, #7c3aed)
    - Border-radius: 16px
    - Padding: 20px 24px
    - Label: "AI Visibility Score", text-xs uppercase, rgba(255,255,255,0.7)
    - Score: "67%", Syne 800, 52px, white (countUp)
    - Delta: "+14% vs last run", flex with TrendingUp icon, text-xs, rgba(255,255,255,0.8)

  Sparkline Card (spans 1 col):
    - Background: #1e293b
    - Border: 1px solid rgba(51,65,85,0.5)
    - Border-radius: 16px
    - Padding: 16px 20px
    - Label: "30-Day Trend"
    - Chart: Area chart, stroke #6366f1, fill gradient to transparent
    - Animation: drawLine on scroll

  Model Breakdown (spans 2 cols):
    - Background: #1e293b
    - Border: 1px solid rgba(51,65,85,0.5)
    - Border-radius: 16px
    - Padding: 16px 20px
    - Label: "Performance by Model"
    - Bars: 4 horizontal bars
      - Perplexity: 78%, color #8b5cf6
      - ChatGPT: 72%, color #22c55e
      - Claude: 61%, color #f97316
      - Gemini: 55%, color #3b82f6
    - Animation: barGrow staggered

  Live vs Index (spans 2 cols):
    - Background: #1e293b
    - Border: 1px solid rgba(51,65,85,0.5)
    - Border-radius: 16px
    - Padding: 16px 20px
    - Two rows:
      - "Live Search" (Perplexity + Gemini): 66%, color #22c55e
      - "AI Index" (ChatGPT + Claude): 67%, color #818cf8
    - Small text showing which models

  Citation Gaps (spans 2 cols):
    - Background: rgba(251,146,60,0.1)
    - Border: 1px solid rgba(251,146,60,0.2)
    - Border-radius: 16px
    - Padding: 16px 20px
    - Header: TrendingDown icon + "Top Citation Gaps", amber color
    - List: 3 prompts with low scores
      - "best CRM for startups" — 12%
      - "sales automation tools" — 18%
      - "email marketing software" — 21%
    - Score badges: bg-[rgba(239,68,68,0.1)], text-[#f87171]
```

### 8. Pricing Table

```
Container: py-24, max-width 900px, mx-auto
Section title: Syne 700, 44px, #f8fafc, text-center, mb-4
Section subtitle: Inter 400, 16px, #94a3b8, text-center, mb-12

Table:
  - Border: 1px solid rgba(51,65,85,0.5)
  - Border-radius: 16px
  - Overflow: hidden

  Header row:
    - Background: #1e293b
    - Cells: Syne 600, 16px, #f8fafc
    - "Pro" cell: highlighted with bg-[rgba(99,102,241,0.2)], border-bottom 2px solid #6366f1

  Body rows:
    - Even rows: bg-[#0f172a]
    - Odd rows: bg-[#020617]
    - Hover: bg-[rgba(99,102,241,0.05)]
    - Cells: Inter 400, 14px, #94a3b8
    - Feature label (first col): #f8fafc
    - Check marks: #22c55e
    - Dashes: #64748b

  "Pro" column:
    - Background: rgba(99,102,241,0.05)
    - Border-left/right: 1px solid rgba(99,102,241,0.2)
```

### 9. FAQ

```
Container: py-24, max-width 700px, mx-auto
Section title: Syne 700, 44px, #f8fafc, text-center, mb-12

Accordion item:
  - Border-bottom: 1px solid rgba(51,65,85,0.5)
  - Padding: 20px 0

  Question (closed):
    - Font: Inter 500, 16px, #f8fafc
    - Cursor: pointer
    - Chevron: text-[#64748b], rotates 180deg on open
    - Hover: background rgba(255,255,255,0.02)

  Question (open):
    - Border-left: 2px solid #6366f1
    - Padding-left: 16px

  Answer:
    - Font: Inter 400, 15px, #94a3b8
    - Padding-top: 12px
    - Max-height animation: 0 → auto, 300ms ease-out
    - Line-height: 1.7
```

### 10. CTA Section (New)

Add a final CTA section before footer.

```
Container: py-32, text-center
Background: radial-gradient(ellipse at 50% 100%, rgba(99,102,241,0.15) 0%, transparent 60%)

Headline: "Start tracking your AI visibility", Syne 700, 40px, #f8fafc
Subhead: "Free to start. No credit card required.", Inter 400, 16px, #94a3b8, mt-4
CTA: "Get Started Free", same as hero primary button, mt-8
```

### 11. Footer

```
Container: py-16, border-t border-[rgba(51,65,85,0.5)]
Background: #020617
Max-width: 1200px, mx-auto

Layout: grid grid-cols-1 md:grid-cols-4 gap-8

Logo column:
  - Lumidian logo (white)
  - Tagline: "AI visibility tracking for modern brands", text-[#64748b], text-sm, mt-2

Link columns (Product, Company, Legal):
  - Title: Inter 600, 14px, #f8fafc, mb-4
  - Links: Inter 400, 14px, #94a3b8, hover:#f8fafc

Bottom bar:
  - Border-top: 1px solid rgba(51,65,85,0.5)
  - Padding-top: 24px
  - Margin-top: 32px
  - Copyright: text-[#64748b], text-sm
  - Social icons: text-[#64748b], hover:text-white
```

---

## Implementation Notes

### File Changes

1. **`frontend/app/page.tsx`** — Complete rewrite with new design
2. **`frontend/app/globals.css`** — Add landing-specific animation keyframes
3. **`frontend/components/LumidianLogo.tsx`** — Ensure white variant exists

### Animation Implementation

Add to `globals.css`:

```css
@keyframes fadeUp {
  from { opacity: 0; transform: translateY(30px); }
  to { opacity: 1; transform: translateY(0); }
}

@keyframes scaleIn {
  from { opacity: 0; transform: scale(0.95); }
  to { opacity: 1; transform: scale(1); }
}

@keyframes glowPulse {
  0%, 100% { box-shadow: 0 0 24px rgba(99,102,241,0.4); }
  50% { box-shadow: 0 0 32px rgba(99,102,241,0.6); }
}

@keyframes drawLine {
  from { stroke-dashoffset: 1000; }
  to { stroke-dashoffset: 0; }
}
```

### Responsive Breakpoints

| Breakpoint | Changes |
|------------|---------|
| < 640px (mobile) | Hero headline 40px, single column layouts, mockup full width |
| 640-1024px (tablet) | Hero headline 56px, 2-column grids |
| > 1024px (desktop) | Full design as specified |

### Performance Considerations

- Use `will-change: transform, opacity` on animated elements
- Intersection Observer with `rootMargin: "50px"` to trigger animations slightly before visible
- Lazy load the dashboard mockup SVG/images
- Use CSS transforms instead of layout properties for animations

---

## Success Criteria

1. Landing page uses dark theme matching the actual product
2. Dashboard mockup accurately represents the real dashboard features
3. All scroll animations are smooth (60fps)
4. No "AI-generated" aesthetic — feels intentionally designed
5. Typography is bold and editorial
6. Page loads in < 3s on 3G
7. Lighthouse performance score > 90

---

## Out of Scope

- Mobile app landing page
- Blog/resources pages
- Pricing page (separate from comparison table on landing)
- A/B testing infrastructure
- Analytics integration changes
