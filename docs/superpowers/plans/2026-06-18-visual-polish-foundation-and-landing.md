# Visual Polish — Foundation + Landing Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Establish a thin shared layout language (Container + named tokens + reconciled primitives), then apply it to the marketing landing page so it reads as deliberately designed rather than "vibecoded" — all while keeping the existing slate-blue dark aesthetic.

**Architecture:** Additive-first. Add a `Container` primitive and an accent alpha ladder to the existing token system, reconcile the `Card`/`Button` primitives to the documented scale, then refactor `app/page.tsx` section-by-section to use the shared container width tiers, consistent vertical rhythm, the `<Heading>` primitive, and tokens instead of hardcoded `rgba()`/`max-w-*` literals. No behavior or copy changes — layout and look-and-feel only.

**Tech Stack:** Next.js 15 (App Router), React 18, TypeScript (strict), Tailwind CSS v3.4, CVA, Radix, lucide-react. Verification via `npm run build`, `npm run lint`, and Playwright screenshots (no frontend test suite exists).

**Spec:** `docs/superpowers/specs/2026-06-18-visual-polish-design.md`

---

## Verification model (read first — this is visual work, not TDD)

There is no frontend test framework, so the usual "write a failing test first" loop is replaced by a **screenshot-driven loop** for every visual task:

1. **Baseline:** capture a before screenshot (desktop 1440px + mobile 390px).
2. **Change:** make the edit.
3. **Gate:** `npm run build` passes + `npm run lint` clean.
4. **After:** capture an after screenshot at the same viewports.
5. **Review:** compare before/after — confirm the section improved and nothing regressed.
6. **Commit.**

Non-visual tasks (token additions, new component files) use build + lint as the gate and skip screenshots.

### Preconditions (do once before starting)

- [ ] **Dev server running.** Frontend runs on **port 3002** (per project convention — NEVER 8000), backend on 3001.

```bash
cd /Users/ken/Desktop/Lumidian/frontend && npm run dev
# confirm http://localhost:3002 loads the landing page
```

- [ ] **Screenshot helper.** Use the Playwright MCP tools: `browser_navigate` to `http://localhost:3002/`, `browser_resize` to the target viewport, then `browser_take_screenshot`. Save before/after pairs with clear names (e.g. `hero-before-desktop.png`, `hero-after-desktop.png`).

---

## File Structure

**Phase 0 — Foundation (shared, additive):**
- Create: `frontend/components/ui/container.tsx` — the single page-width primitive (width tiers + consistent gutters).
- Modify: `frontend/app/globals.css` — add accent alpha ladder tokens; reconcile `.card` padding to 24px.
- Modify: `frontend/components/ui/card.tsx` — reconcile padding scale to 16/24/32.
- Modify: `frontend/components/ui/button.tsx` — replace hardcoded `rgba(95,126,166,X)` with ladder tokens.

**Phase 1 — Landing surface:**
- Modify: `frontend/app/page.tsx` — section-by-section refactor onto Container + tokens + `<Heading>`; remove duplicate `useCountUp`.

Subsequent surfaces (dashboard, content hub, auth, settings) are **out of scope for this plan** — they get their own plans after Ken reviews the landing result, because the spec defers final container/spacing values to the landing pass (review gate per surface).

---

## Phase 0 — Foundation

### Task 0.1: Add the accent alpha ladder tokens

**Files:**
- Modify: `frontend/app/globals.css` (inside the `/* Accent — Slate Blue */` block, after line 72)

The accent slate-blue resolves to roughly `rgb(95,126,166)`. The codebase scatters ~10 ad-hoc alpha shades of it (`rgba(95,126,166,0.06)` … `0.30`). Name them once so tinting becomes a decision.

- [ ] **Step 1: Add ladder tokens**

In `frontend/app/globals.css`, immediately after line 72 (`--accent-border: oklch(0.58 0.06 235 / 0.20);`), add:

```css
  /* Accent alpha ladder — replaces ~10 ad-hoc rgba(95,126,166,X) shades */
  --accent-06: oklch(0.58 0.06 235 / 0.06);  /* faint tint / hover wash */
  --accent-10: oklch(0.58 0.06 235 / 0.10);  /* badge / step-number bg */
  --accent-12: oklch(0.58 0.06 235 / 0.12);  /* input hover */
  --accent-15: oklch(0.58 0.06 235 / 0.15);  /* icon bg / focus ring */
  --accent-20: oklch(0.58 0.06 235 / 0.20);  /* border */
  --accent-30: oklch(0.58 0.06 235 / 0.30);  /* strong border / highlight */
```

- [ ] **Step 2: Gate**

```bash
cd /Users/ken/Desktop/Lumidian/frontend && npm run build
```
Expected: build succeeds (CSS var additions are inert until used).

- [ ] **Step 3: Commit**

```bash
git add frontend/app/globals.css
git commit -m "feat(ui): add named accent alpha ladder tokens"
```

---

### Task 0.2: Create the `Container` primitive

**Files:**
- Create: `frontend/components/ui/container.tsx`

This replaces the per-section `max-w-{2xl,4xl,5xl,6xl,7xl} mx-auto px-4 sm:px-6 lg:px-8` jumble with four named width tiers and one consistent gutter.

- [ ] **Step 1: Write the component**

Create `frontend/components/ui/container.tsx`:

```tsx
import { type ReactNode, type HTMLAttributes } from 'react';

type ContainerWidth = 'wide' | 'default' | 'content' | 'narrow';

// Named width tiers replace the ad-hoc max-w-2xl..7xl jumble.
// Gutter is identical across all tiers for vertical-edge alignment.
const WIDTH_CLASS: Record<ContainerWidth, string> = {
  wide: 'max-w-[1200px]',     // page chrome: nav, footer, feature grid
  default: 'max-w-[1080px]',  // primary content: hero, models bar
  content: 'max-w-[880px]',   // single-column reading: steps, pricing
  narrow: 'max-w-[680px]',    // tight reading: FAQ, final CTA
};

interface ContainerProps extends HTMLAttributes<HTMLDivElement> {
  width?: ContainerWidth;
  children: ReactNode;
}

export function Container({ width = 'default', className = '', children, ...rest }: ContainerProps) {
  return (
    <div className={`mx-auto w-full px-4 sm:px-6 lg:px-8 ${WIDTH_CLASS[width]} ${className}`} {...rest}>
      {children}
    </div>
  );
}
```

- [ ] **Step 2: Gate**

```bash
cd /Users/ken/Desktop/Lumidian/frontend && npm run build && npm run lint
```
Expected: build + lint clean (component compiles, unused until imported — that's fine).

- [ ] **Step 3: Commit**

```bash
git add frontend/components/ui/container.tsx
git commit -m "feat(ui): add Container primitive with named width tiers"
```

---

### Task 0.3: Reconcile Card padding scale + `.card` to 24px

**Files:**
- Modify: `frontend/components/ui/card.tsx:6-10`
- Modify: `frontend/app/globals.css:141-159` (`.card`, `.card-elevated` padding)

The spec sets 24px as the standard card padding. The `Card` primitive currently maps `sm=p-3 / md=p-5 / lg=p-7` (12/20/28) and the `.card` CSS class uses 20px. Move both to a clean 16/24/32 scale. This ripples to every card consumer, so it is screenshot-verified against the dashboard (the heaviest Card consumer).

- [ ] **Step 1: Baseline screenshot of the dashboard**

Navigate to `http://localhost:3002/dashboard` (log in if required), capture `dashboard-cards-before-desktop.png` at 1440px. If the dashboard is unreachable without seeded data, capture the landing page's feature cards area instead and note it.

- [ ] **Step 2: Update the Card padding map**

In `frontend/components/ui/card.tsx`, replace lines 6-10:

```tsx
const PADDING_CLASS: Record<CardPadding, string> = {
  sm: 'p-4',
  md: 'p-6',
  lg: 'p-8',
};
```

- [ ] **Step 3: Update `.card` / `.card-elevated` CSS padding to 24px**

In `frontend/app/globals.css`, change `.card` `padding: 20px;` (line 145) to `padding: 24px;` and `.card-elevated` `padding: 20px;` (line 157) to `padding: 24px;`. Also update the mobile override block (lines 404-411) so `.card` / `.card-elevated` use `padding: 18px;` instead of `16px`.

- [ ] **Step 4: Gate**

```bash
cd /Users/ken/Desktop/Lumidian/frontend && npm run build && npm run lint
```
Expected: clean.

- [ ] **Step 5: After screenshot + review**

Capture `dashboard-cards-after-desktop.png` at the same viewport. Confirm cards gained breathing room and nothing overflows/clips. If any card breaks, note it for that card's own pass — do not hand-patch here.

- [ ] **Step 6: Commit**

```bash
git add frontend/components/ui/card.tsx frontend/app/globals.css
git commit -m "refactor(ui): reconcile card padding to 16/24/32 scale (24px default)"
```

---

### Task 0.4: Swap Button hardcoded accent rgba → ladder tokens

**Files:**
- Modify: `frontend/components/ui/button.tsx:17-18`

The `secondary` variant hardcodes `rgba(95,126,166,0.08)` and `rgba(95,126,166,0.14)`. Replace with ladder tokens (same visual result, now named).

- [ ] **Step 1: Replace the secondary variant**

In `frontend/components/ui/button.tsx`, replace the `secondary` entry (lines 17-18):

```tsx
        secondary:
          "bg-[var(--accent-06)] text-[var(--accent-foreground)] border border-[var(--border-default)] hover:bg-[var(--accent-12)]",
```

(Note: `0.08`→`--accent-06` and `0.14`→`--accent-12` are the nearest ladder rungs; the ~0.02 alpha shift is imperceptible and intentional for consistency.)

- [ ] **Step 2: Gate**

```bash
cd /Users/ken/Desktop/Lumidian/frontend && npm run build && npm run lint
```
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add frontend/components/ui/button.tsx
git commit -m "refactor(ui): button secondary variant uses accent ladder tokens"
```

---

## Phase 1 — Landing Page (`app/page.tsx`)

All Phase 1 tasks add `import { Container } from '@/components/ui/container';` and (where headings change) `import { Heading } from '@/components/ui/heading';` at the top of `app/page.tsx` if not already present. Each section task follows the screenshot-driven loop.

**Section width-tier mapping** (replaces the current ad-hoc max-widths):

| Section | Current max-width | New Container `width` |
|---------|-------------------|------------------------|
| Nav/Header | `max-w-7xl` | `wide` |
| Hero | `max-w-5xl` | `default` |
| Models bar | `max-w-5xl` | `default` |
| Features grid | `max-w-6xl` | `wide` |
| How it works | `max-w-4xl` | `content` |
| Pricing | `max-w-4xl` | `content` |
| FAQ | `max-w-2xl` | `narrow` |
| CTA | `max-w-2xl` | `narrow` |
| Footer | `max-w-6xl` | `wide` |

**Section vertical rhythm:** standardize each major section's vertical padding to `py-20 sm:py-28` (replacing the current `py-12`/`py-16`/`py-32` mix). The hero keeps its `min-h-screen` treatment. Apply the rhythm change within each section's task below.

---

### Task 1.1: Baseline full-page screenshots

- [ ] **Step 1: Capture baseline**

Navigate to `http://localhost:3002/`. Capture full-page screenshots at desktop (1440px) and mobile (390px): `landing-before-desktop.png`, `landing-before-mobile.png`. These are the reference for the whole phase.

- [ ] **Step 2: No commit** (screenshots are scratch artifacts, not committed).

---

### Task 1.2: Nav + Footer onto Container (page chrome)

**Files:**
- Modify: `frontend/app/page.tsx` — Header (lines ~191-268), Footer (lines ~959-1010)

- [ ] **Step 1: Add the import**

At the top of `app/page.tsx`, add `import { Container } from '@/components/ui/container';` with the other local imports (near line 22).

- [ ] **Step 2: Replace the nav inner wrapper**

In the Header, replace the inner `<div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 ...">` with `<Container width="wide" className="...">` preserving the flex/height classes (`flex items-center justify-between h-16` etc.) on the Container's `className`.

- [ ] **Step 3: Replace the footer inner wrapper**

In the Footer, replace `<div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">` with `<Container width="wide">`. Keep the inner grid markup unchanged.

- [ ] **Step 4: Gate + screenshots**

```bash
cd /Users/ken/Desktop/Lumidian/frontend && npm run build && npm run lint
```
Capture `chrome-after-desktop.png` + `chrome-after-mobile.png`. Confirm nav/footer edges align with each other and gutters match.

- [ ] **Step 5: Commit**

```bash
git add frontend/app/page.tsx
git commit -m "refactor(landing): nav + footer use Container (wide tier)"
```

---

### Task 1.3: Hero section

**Files:**
- Modify: `frontend/app/page.tsx` — Hero (lines ~270-340)

- [ ] **Step 1: Baseline** — capture `hero-before-desktop.png` / `hero-before-mobile.png`.

- [ ] **Step 2: Container + rhythm**

Replace the hero inner `<div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">` with `<Container width="default">`. Keep `min-h-screen flex items-center justify-center pt-20 pb-16` on the outer `<section>`.

- [ ] **Step 3: Token swap**

Replace hardcoded accent literals in this section: `rgba(95,126,166,0.15)` → `var(--accent-15)`, `rgba(95,126,166,0.3)` → `var(--accent-30)`, and the badge border `rgba(255,255,255,0.25)` → `var(--border-faint)` only if it is a 1px hairline border (otherwise leave). The radial-gradient `style={{ background: 'radial-gradient(...)' }}` keeps its structure but swaps the accent stop to `var(--accent-15)`.

- [ ] **Step 4: Heading primitive**

Replace the hero headline's inline `style={{ fontFamily: 'var(--font-syne)', letterSpacing, lineHeight }}` `<h1>` with `<Heading level="display" as="h1" className="...">`, keeping any accent-colored `<span>` inside the children. Remove the now-redundant inline font/tracking styles (the Heading primitive supplies them).

- [ ] **Step 5: Gate + after screenshots**

```bash
cd /Users/ken/Desktop/Lumidian/frontend && npm run build && npm run lint
```
Capture `hero-after-*`. Confirm headline rendering is unchanged-or-better and the badge/CTA spacing is intact.

- [ ] **Step 6: Commit**

```bash
git add frontend/app/page.tsx
git commit -m "refactor(landing): hero on Container + Heading + accent tokens"
```

---

### Task 1.4: Models bar

**Files:**
- Modify: `frontend/app/page.tsx` — Models bar (lines ~342-376)

- [ ] **Step 1: Baseline** — `models-before-*`.

- [ ] **Step 2: Container + rhythm**

Replace inner `max-w-5xl mx-auto px-...` with `<Container width="default">`. Change the section `py-12` to `py-20 sm:py-28`. Keep `border-y border-[var(--border-subtle)]`.

- [ ] **Step 3: Keep model hex colors**

Leave the per-model brand hexes (`#10a37f`, `#f97316`, `#8b5cf6`, `#3b82f6`) — these map to `--color-chatgpt/claude/perplexity/gemini` tokens; swap each to its token (e.g. `#10a37f` → `var(--color-chatgpt)`) where referenced in className/style. The `--model-color` CSS-var injection pattern (line ~355) stays.

- [ ] **Step 4: Gate + after** — `npm run build && npm run lint`; capture `models-after-*`.

- [ ] **Step 5: Commit**

```bash
git add frontend/app/page.tsx
git commit -m "refactor(landing): models bar on Container + model color tokens"
```

---

### Task 1.5: Features grid

**Files:**
- Modify: `frontend/app/page.tsx` — Features (lines ~378-422)

- [ ] **Step 1: Baseline** — `features-before-*`.

- [ ] **Step 2: Container + rhythm**

Replace inner `max-w-6xl mx-auto px-...` with `<Container width="wide">`. Change section `py-16` → `py-20 sm:py-28`. Keep `grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6`.

- [ ] **Step 3: Card primitive for feature cards**

Replace each raw feature `<div className="bg-[var(--bg-raised)] border ... hover ...">` with `<Card tone="default" hover>`. Add `import { Card } from '@/components/ui/card';`. Move the icon-background literal `rgba(95,126,166,0.15)` → `var(--accent-15)` and hover border `rgba(95,126,166,0.3)` → `var(--accent-30)`.

- [ ] **Step 4: Heading**

Replace the section title's inline `style={{ fontFamily: 'var(--font-syne)' }}` `<h2>` with `<Heading level={2}>`.

- [ ] **Step 5: Gate + after** — `npm run build && npm run lint`; capture `features-after-*`. Confirm 4-up grid spacing reads evenly and cards have the new 24px padding.

- [ ] **Step 6: Commit**

```bash
git add frontend/app/page.tsx
git commit -m "refactor(landing): features grid on Container + Card + tokens"
```

---

### Task 1.6: How it works

**Files:**
- Modify: `frontend/app/page.tsx` — How it works (lines ~424-472)

- [ ] **Step 1: Baseline** — `how-before-*`.

- [ ] **Step 2: Container + rhythm**

Replace inner `max-w-4xl mx-auto px-...` with `<Container width="content">`. Change `py-16` → `py-20 sm:py-28`. Keep `border-y`.

- [ ] **Step 3: Token swap**

Step-badge bg `rgba(95,126,166,0.1)` → `var(--accent-10)`, badge border `rgba(95,126,166,0.2)` → `var(--accent-20)`. Replace the step-number inline `style={{ fontFamily: 'var(--font-syne)', lineHeight: 1 }}` with `<Heading level={2} className="leading-none">` (or keep the `<span>` and apply `font-[family-name:var(--font-syne)]` utility — match whichever reads cleaner).

- [ ] **Step 4: Heading** — section title `style={{ fontFamily: 'var(--font-syne)' }}` → `<Heading level={2}>`.

- [ ] **Step 5: Gate + after** — `npm run build && npm run lint`; capture `how-after-*`.

- [ ] **Step 6: Commit**

```bash
git add frontend/app/page.tsx
git commit -m "refactor(landing): how-it-works on Container + tokens"
```

---

### Task 1.7: Pricing

**Files:**
- Modify: `frontend/app/page.tsx` — Pricing (lines ~698-839)

- [ ] **Step 1: Baseline** — `pricing-before-desktop.png` + `pricing-before-mobile.png` (mobile is a separate tab UI — capture both).

- [ ] **Step 2: Container + rhythm**

Replace inner `max-w-4xl mx-auto px-...` with `<Container width="content">`. Change `py-16` → `py-20 sm:py-28`.

- [ ] **Step 3: Token swap**

Pro-column accent `rgba(95,126,166,0.2)` → `var(--accent-20)`; checkmark `#22c55e` → `var(--success)`; disabled text `#475569`/`#64748b` → `var(--text-muted)`. Leave the `minWidth: 500` table guard.

- [ ] **Step 4: Heading** — section title → `<Heading level={2}>`.

- [ ] **Step 5: Gate + after** — `npm run build && npm run lint`; capture `pricing-after-desktop.png` + `pricing-after-mobile.png`. Verify the desktop table and the mobile tab cards both still render correctly (this section has the most layout risk).

- [ ] **Step 6: Commit**

```bash
git add frontend/app/page.tsx
git commit -m "refactor(landing): pricing on Container + tokens"
```

---

### Task 1.8: FAQ

**Files:**
- Modify: `frontend/app/page.tsx` — FAQ (lines ~841-905)

- [ ] **Step 1: Baseline** — `faq-before-*`.

- [ ] **Step 2: Container + rhythm**

Replace inner `max-w-2xl mx-auto px-...` with `<Container width="narrow">`. Change `py-16` → `py-20 sm:py-28`. Keep `border-t`.

- [ ] **Step 3: Token swap**

Open-item bg `rgba(95,126,166,0.04)` → `var(--accent-06)`; hover bg `rgba(255,255,255,0.02)` → `var(--bg-tinted)`.

- [ ] **Step 4: Heading** — section title → `<Heading level={2}>`.

- [ ] **Step 5: Gate + after** — `npm run build && npm run lint`; capture `faq-after-*`; confirm accordion open/close still animates.

- [ ] **Step 6: Commit**

```bash
git add frontend/app/page.tsx
git commit -m "refactor(landing): FAQ on Container + tokens"
```

---

### Task 1.9: CTA (pre-footer)

**Files:**
- Modify: `frontend/app/page.tsx` — CTA (lines ~908-957)

- [ ] **Step 1: Baseline** — `cta-before-*`.

- [ ] **Step 2: Container**

Replace inner `max-w-2xl mx-auto px-...` with `<Container width="narrow">`. Keep `py-32 text-center relative` on the section (the CTA is intentionally roomier than the rhythm default).

- [ ] **Step 3: Token swap**

Background gradient accent stop `rgba(95,126,166,0.15)` → `var(--accent-15)`. The `ctaOrb` animation + `var(--accent)` orb center stay.

- [ ] **Step 4: Heading** — CTA headline → `<Heading level={1}>` (or `display` if it visually matches the hero scale; pick by screenshot).

- [ ] **Step 5: Gate + after** — `npm run build && npm run lint`; capture `cta-after-*`.

- [ ] **Step 6: Commit**

```bash
git add frontend/app/page.tsx
git commit -m "refactor(landing): CTA on Container + tokens"
```

---

### Task 1.10: Consolidate duplicate `useCountUp` + residual literal sweep

**Files:**
- Modify: `frontend/app/page.tsx` — local `useCountUp` (lines ~32-53), DashboardMockup (lines ~474-689)
- Reference: `frontend/lib/motion.ts` (canonical `useCountUp`)

- [ ] **Step 1: Compare signatures**

Read `frontend/lib/motion.ts` `useCountUp` and the local one at `app/page.tsx:32-53`. The local returns `{ ref, value }`. If the lib version matches (or can be called to produce the same `{ ref, value }`), proceed; if signatures differ, adapt the call site in `DashboardMockup` to the lib API rather than changing the lib.

- [ ] **Step 2: Remove the local hook, import the canonical one**

Delete the local `useCountUp` definition (lines ~32-53). Add it to the existing `@/lib/motion` import. Update the `DashboardMockup` call site to the lib signature.

- [ ] **Step 3: Residual accent-literal sweep**

Search the remaining file for any leftover `rgba(95,126,166,` and map each to the nearest ladder token (`--accent-06/10/12/15/20/30`). Leave the DashboardMockup's data-viz colors (`#ef4444`, `#fbbf24`, `#22c55e`, `#f87171`) mapped to their semantic tokens (`--danger`, `--warning-text`, `--success`, `--danger-text`) where they appear.

```bash
cd /Users/ken/Desktop/Lumidian/frontend && grep -n "rgba(95,126,166" app/page.tsx
```
Expected after edits: no matches (or only inside an intentionally-skipped comment).

- [ ] **Step 4: Gate + after**

```bash
cd /Users/ken/Desktop/Lumidian/frontend && npm run build && npm run lint
```
Capture a full-page `landing-after-desktop.png` to confirm the count-up animation and mockup still work.

- [ ] **Step 5: Commit**

```bash
git add frontend/app/page.tsx
git commit -m "refactor(landing): drop duplicate useCountUp, finish accent token sweep"
```

---

### Task 1.11: Final full-page review

- [ ] **Step 1: Side-by-side**

Capture final `landing-after-desktop.png` + `landing-after-mobile.png`. Place beside the Task 1.1 baselines. Verify: consistent gutters/edge alignment across all sections, even vertical rhythm, no orphaned `max-w-*` literals, headings consistent.

- [ ] **Step 2: Literal-count check**

```bash
cd /Users/ken/Desktop/Lumidian/frontend && grep -c "max-w-2xl\|max-w-4xl\|max-w-5xl\|max-w-6xl\|max-w-7xl" app/page.tsx
```
Expected: `0` (every section now routes through `Container`). If any remain, they are intentional inner-element widths — confirm by eye.

- [ ] **Step 3: Hand off to Ken**

Present the before/after screenshots for the landing-page review gate. Do NOT start the dashboard surface until Ken approves — the next surface gets its own plan, informed by any width/rhythm tuning Ken requests here.

---

## Self-Review (completed during authoring)

- **Spec coverage:** Container width tiers + consistent gutters (spec "Page shell"), 24px card padding + radius/shadow tokens already in system (spec "Surface craft"), accent ladder (spec "Accent alpha ladder"), `<Heading>` adoption (spec "Hierarchy"), screenshot verification + review gate (spec "Verification"). Token codemod rides along on the page being edited (spec "Consistency mechanics"). ✅
- **Placeholder scan:** No TBD/TODO; each step gives exact files, class strings, commands, and expected output. ✅
- **Type consistency:** `Container` width prop values (`wide/default/content/narrow`) used identically in the component (Task 0.2) and the section mapping table (Phase 1). `Card` padding map (Task 0.3) matches its existing `CardPadding` type. ✅
- **Scope:** One surface (landing) + the foundation it needs. Later surfaces are explicitly deferred to their own plans behind the review gate. ✅
- **Known soft spots (flagged in spec Open Questions):** exact container px (1200/1080/880/680) and rhythm (`py-20 sm:py-28`) are starting values, tunable with screenshots during this pass.
