# Frontend Elevation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Elevate the Lumidian frontend to Linear/Railway caliber — lavender accent, full Framer Motion animation system, Emil/Impeccable component polish, and component refactoring.

**Architecture:** Update CSS design tokens (OKLCH), install Framer Motion, create shared animation variants, remove banned patterns, refactor bloated components into focused units, then apply animations page-by-page.

**Tech Stack:** Next.js 15, React 18, Tailwind CSS, Framer Motion, Radix UI, OKLCH colors

**Branch:** `feature/frontend-elevation` (already created)

---

## File Structure

### New Files
- `frontend/lib/motion.ts` — Shared animation variants, easing curves, motion utilities
- `frontend/components/dashboard/StatsGrid.tsx` — Extracted stat cards with stagger animation
- `frontend/components/dashboard/VisibilityChart.tsx` — Extracted chart section
- `frontend/components/dashboard/BrandTable.tsx` — Extracted brand table
- `frontend/components/dashboard/DashboardHeader.tsx` — Extracted header + actions
- `frontend/components/dashboard/BestPromptCard.tsx` — Extracted best prompt section
- `frontend/components/dashboard/DonutDomains.tsx` — Extracted domain breakdown
- `frontend/components/dashboard/DashboardModelBreakdown.tsx` — Extracted inline model breakdown
- `frontend/components/content/DraftsPanel.tsx` — Extracted drafts tab
- `frontend/components/content/ScheduledPanel.tsx` — Extracted scheduled tab
- `frontend/components/content/OpportunitiesPanel.tsx` — Extracted opportunities tab
- `frontend/components/content/PostedPanel.tsx` — Extracted posted tab
- `frontend/components/content/cards/DraftCard.tsx` — Extracted draft card
- `frontend/components/content/cards/WikipediaDraftCard.tsx` — Extracted wikipedia card
- `frontend/components/content/cards/ScheduledCard.tsx` — Extracted scheduled card
- `frontend/components/content/cards/PostedCard.tsx` — Extracted posted card
- `frontend/components/content/cards/OpportunityCard.tsx` — Extracted opportunity card
- `frontend/components/content/QualityChecklist.tsx` — Extracted quality checklist modal (move from app/content/components/)
- `frontend/components/content/helpers.ts` — Shared helpers (relativeTime, generateAvailableLabel, wiki utils, etc.)

### Modified Files
- `frontend/app/globals.css` — Accent colors, OKLCH tokens, easing curves, model card fix, button active states
- `frontend/tailwind.config.js` — Updated accent colors
- `frontend/package.json` — Add framer-motion
- `frontend/components/ui/dialog.tsx` — Lavender focus rings
- `frontend/components/ui/button.tsx` — Active scale feedback
- `frontend/components/ui/tabs.tsx` — Lavender accent
- `frontend/components/ui/badge.tsx` — Lavender accent
- `frontend/components/ModelBreakdown.tsx` — Remove left border, use background tint
- `frontend/components/AppShell.tsx` — Lavender accent refs, extract RunBanner animation
- `frontend/components/Sidebar.tsx` — Lavender accent refs, nav link transitions
- `frontend/components/AppToast.tsx` — CSS transition for enter/exit
- `frontend/app/dashboard/page.tsx` — Refactored to import extracted components, add motion
- `frontend/components/content/ContentTabPanels.tsx` — Refactored to import from split files
- Plus ~30 other component/page files for hardcoded indigo→lavender color swaps

---

## Phase 1: Foundation

### Task 1: Install Framer Motion

**Files:**
- Modify: `frontend/package.json`

- [ ] **Step 1: Install framer-motion**

```bash
cd frontend && npm install framer-motion
```

- [ ] **Step 2: Verify installation**

```bash
cd frontend && node -e "require('framer-motion')" && echo "OK"
```
Expected: `OK`

- [ ] **Step 3: Verify build still works**

```bash
cd frontend && npm run build 2>&1 | tail -5
```
Expected: Build succeeds

- [ ] **Step 4: Commit**

```bash
git add frontend/package.json frontend/package-lock.json
git commit -m "chore: install framer-motion for animation system"
```

---

### Task 2: Create Animation Variants Library

**Files:**
- Create: `frontend/lib/motion.ts`

- [ ] **Step 1: Create the motion utilities file**

```typescript
// frontend/lib/motion.ts
import { type Variants } from 'framer-motion';

// ── Custom easing curves (Emil Kowalski) ─────────────────────────────────────
// Never use ease-in (feels sluggish) or bounce/elastic (feels dated)
export const easings = {
  out: [0.23, 1, 0.32, 1] as const,       // UI interactions
  inOut: [0.77, 0, 0.175, 1] as const,     // On-screen movement
  drawer: [0.32, 0.72, 0, 1] as const,     // Drawers/panels
} as const;

// ── Reusable variants ────────────────────────────────────────────────────────

export const fadeIn: Variants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: { duration: 0.3, ease: easings.out },
  },
};

export const fadeInUp: Variants = {
  hidden: { opacity: 0, transform: 'translateY(8px)' },
  visible: {
    opacity: 1,
    transform: 'translateY(0px)',
    transition: { duration: 0.35, ease: easings.out },
  },
};

export const staggerContainer: Variants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: {
      staggerChildren: 0.04,
      delayChildren: 0.04,
    },
  },
};

export const staggerChild: Variants = {
  hidden: { opacity: 0, transform: 'translateY(8px)' },
  visible: {
    opacity: 1,
    transform: 'translateY(0px)',
    transition: { duration: 0.35, ease: easings.out },
  },
};

export const slideIn: Variants = {
  hidden: { opacity: 0, transform: 'translateX(-12px)' },
  visible: {
    opacity: 1,
    transform: 'translateX(0px)',
    transition: { duration: 0.2, ease: easings.out },
  },
  exit: {
    opacity: 0,
    transform: 'translateX(12px)',
    transition: { duration: 0.15, ease: easings.out },
  },
};

// Spring config for modals — never scale(0), start from scale(0.95)
export const springModal: Variants = {
  hidden: { opacity: 0, transform: 'scale(0.95)' },
  visible: {
    opacity: 1,
    transform: 'scale(1)',
    transition: { type: 'spring', duration: 0.4, bounce: 0.15 },
  },
  exit: {
    opacity: 0,
    transform: 'scale(0.95)',
    transition: { duration: 0.15, ease: easings.out },
  },
};

// ── CSS easing values (for inline styles / CSS-in-JS) ────────────────────────
export const cssEasings = {
  out: 'cubic-bezier(0.23, 1, 0.32, 1)',
  inOut: 'cubic-bezier(0.77, 0, 0.175, 1)',
  drawer: 'cubic-bezier(0.32, 0.72, 0, 1)',
} as const;

// ── Reduced motion helper ────────────────────────────────────────────────────
export function getReducedMotionVariants(variants: Variants): Variants {
  const reduced: Variants = {};
  for (const key in variants) {
    if (key === 'hidden') {
      reduced[key] = { opacity: 0 };
    } else {
      reduced[key] = { opacity: 1, transition: { duration: 0.01 } };
    }
  }
  return reduced;
}
```

- [ ] **Step 2: Verify it compiles**

```bash
cd frontend && npx tsc --noEmit lib/motion.ts 2>&1 | head -5
```
Expected: No errors (or only non-blocking warnings from other files)

- [ ] **Step 3: Commit**

```bash
git add frontend/lib/motion.ts
git commit -m "feat: add shared animation variants and easing curves"
```

---

### Task 3: Update CSS Design Tokens — Accent Color + OKLCH + Easing Curves

**Files:**
- Modify: `frontend/app/globals.css:30-79` (design tokens block)
- Modify: `frontend/app/globals.css:99-104` (global transitions)
- Modify: `frontend/app/globals.css:127-139` (model card)
- Modify: `frontend/app/globals.css:159-171` (button utilities)
- Modify: `frontend/app/globals.css:240-261` (empty state icon)
- Modify: `frontend/app/globals.css:274-278` (focus-visible)
- Modify: `frontend/app/globals.css:306-325` (skeleton shimmer)
- Modify: `frontend/app/globals.css:355-359` (selection)
- Modify: `frontend/tailwind.config.js:15-27` (colors)

- [ ] **Step 1: Update accent tokens in globals.css design tokens block**

Replace the accent section (lines 67-72) with:

```css
/* Accent — Lavender (OKLCH) */
--accent: oklch(0.746 0.16 293);
--accent-hover: oklch(0.655 0.19 293);
--accent-light: oklch(0.84 0.1 293);
--accent-muted: oklch(0.746 0.16 293 / 0.15);
--accent-border: oklch(0.746 0.16 293 / 0.20);
```

- [ ] **Step 2: Add custom easing curves after the radius tokens**

Add after `--radius-xl: 16px;`:

```css
/* Animation easing (Emil Kowalski) */
--ease-out: cubic-bezier(0.23, 1, 0.32, 1);
--ease-in-out: cubic-bezier(0.77, 0, 0.175, 1);
--ease-drawer: cubic-bezier(0.32, 0.72, 0, 1);
```

- [ ] **Step 3: Replace model-card left-border with background tint**

Replace the model-card block (lines 127-139) with:

```css
/* ── Model card with background tint (no side-stripe borders) ─────────────── */
.model-card {
  background: rgba(15,23,42,0.4);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
  padding: 14px 16px;
}
.model-card-chatgpt { background: oklch(0.72 0.19 142 / 0.03); }
.model-card-claude { background: oklch(0.72 0.19 55 / 0.03); }
.model-card-perplexity { background: oklch(0.65 0.19 293 / 0.03); }
.model-card-gemini { background: oklch(0.65 0.19 250 / 0.03); }
```

- [ ] **Step 4: Fix button transition: all → specific properties + add active scale**

Replace the `.btn` block (lines 160-172) with:

```css
.btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 0.875rem;
  font-weight: 500;
  padding: 10px 16px;
  border-radius: var(--radius-md);
  transition: background-color 0.15s ease, border-color 0.15s ease, color 0.15s ease, box-shadow 0.15s ease, transform 160ms var(--ease-out);
  cursor: pointer;
  white-space: nowrap;
  border: 1px solid transparent;
}
.btn:active:not(:disabled) {
  transform: scale(0.97);
}
.btn:disabled { opacity: 0.45; cursor: not-allowed; }
```

- [ ] **Step 5: Update btn-primary box-shadow to use lavender**

Replace `.btn-primary` block (lines 175-184):

```css
.btn-primary {
  background: var(--accent);
  color: white;
  border-color: transparent;
  box-shadow: 0 1px 3px oklch(0.746 0.16 293 / 0.25);
}
.btn-primary:hover:not(:disabled) {
  background: var(--accent-hover);
  box-shadow: 0 2px 8px oklch(0.746 0.16 293 / 0.35);
}
```

- [ ] **Step 6: Update focus-visible ring**

Replace the focus-visible block (lines 274-278):

```css
:focus-visible {
  outline: 2px solid oklch(0.746 0.16 293 / 0.6);
  outline-offset: 2px;
}
```

- [ ] **Step 7: Update skeleton shimmer to use lavender**

Replace shimmer gradient colors:

```css
.skeleton {
  background: linear-gradient(
    90deg,
    oklch(0.746 0.16 293 / 0.06) 25%,
    oklch(0.746 0.16 293 / 0.14) 50%,
    oklch(0.746 0.16 293 / 0.06) 75%
  );
  background-size: 200% 100%;
  animation: shimmer 1.8s ease-in-out infinite;
}

@media (prefers-reduced-motion: reduce) {
  .skeleton { animation: none; background: oklch(0.746 0.16 293 / 0.07); }
  .orb-1, .orb-2, .orb-3, .orb-4 { animation: none; }
}
```

- [ ] **Step 8: Update selection highlight**

```css
::selection {
  background: oklch(0.746 0.16 293 / 0.30);
  color: var(--text-primary);
}
```

- [ ] **Step 9: Update empty-state-icon to lavender**

Replace the gradient/border in `.empty-state-icon`:

```css
.empty-state-icon {
  width: 52px;
  height: 52px;
  border-radius: var(--radius-xl);
  background: linear-gradient(135deg, oklch(0.746 0.16 293 / 0.12), oklch(0.58 0.22 293 / 0.08));
  border: 1px solid oklch(0.746 0.16 293 / 0.22);
  box-shadow: 0 0 24px oklch(0.746 0.16 293 / 0.08);
  display: flex;
  align-items: center;
  justify-content: center;
  margin-bottom: 16px;
  color: var(--accent-light);
}
```

- [ ] **Step 10: Add hover media query and card hover animation**

Add after the `.card-elevated` block:

```css
/* ── Interactive card hover (pointer devices only) ────────────────────────── */
@media (hover: hover) and (pointer: fine) {
  .card-hover:hover {
    transform: translateY(-1px);
    background: var(--bg-card);
    border-color: var(--border-default);
    box-shadow: 0 4px 16px rgba(0,0,0,0.25), inset 0 1px 0 rgba(255,255,255,0.04);
  }
  .card-hover {
    transition: transform 200ms var(--ease-out), background-color 0.15s ease, border-color 0.15s ease, box-shadow 0.15s ease;
  }
}
```

- [ ] **Step 11: Update input focus to lavender**

Replace `.input:focus` (line 154-157):

```css
.input:focus {
  border-color: var(--accent);
  box-shadow: 0 0 0 3px oklch(0.746 0.16 293 / 0.15);
}
```

- [ ] **Step 12: Update tailwind.config.js accent colors**

Replace the `accent` and `accent-hover` in the colors object:

```javascript
'accent': '#a78bfa',
'accent-hover': '#8b5cf6',
```

- [ ] **Step 13: Update glow-pulse and glowPulse keyframes to lavender**

Replace `rgba(99,102,241,...)` in both keyframes with `oklch(0.746 0.16 293 / ...)`:

```css
@keyframes glowPulse {
  0%, 100% {
    box-shadow: 0 0 24px oklch(0.746 0.16 293 / 0.4);
  }
  50% {
    box-shadow: 0 0 32px oklch(0.746 0.16 293 / 0.6);
  }
}

@keyframes glow-pulse {
  0%, 100% { box-shadow: 0 0 20px oklch(0.746 0.16 293 / 0.12), 0 0 6px oklch(0.746 0.16 293 / 0.06); }
  50% { box-shadow: 0 0 30px oklch(0.746 0.16 293 / 0.22), 0 0 12px oklch(0.746 0.16 293 / 0.10); }
}
```

- [ ] **Step 14: Verify build**

```bash
cd frontend && npm run build 2>&1 | tail -5
```
Expected: Build succeeds

- [ ] **Step 15: Commit**

```bash
git add frontend/app/globals.css frontend/tailwind.config.js
git commit -m "feat: swap accent to lavender (OKLCH), add easing curves, remove model card side-stripes, add button active states"
```

---

### Task 4: Swap Hardcoded Indigo References Across Components

**Files:**
- Modify: All files with hardcoded `#6366f1`, `rgba(99,102,241,...)`, `#4f46e5`, `#818cf8` references
- This task is mechanical: find-and-replace across ~30 files

- [ ] **Step 1: Replace #6366f1 with var(--accent) or #a78bfa**

For each file with hardcoded `#6366f1`, replace with `var(--accent)` when in CSS/className context, or `#a78bfa` when in inline style objects where CSS variables aren't supported.

Key files and what to change:

**`frontend/app/page.tsx`** (landing page, 19 occurrences):
- `#6366f1` → `#a78bfa`
- `#4f46e5` → `#8b5cf6`
- `#818cf8` → `#c4b5fd`

**`frontend/app/login/page.tsx`** (8 occurrences):
- `#6366f1` → `#a78bfa`
- `rgba(99,102,241,...)` → use `var(--accent-muted)` or `rgba(167,139,250,...)`

**`frontend/app/register/page.tsx`** (5+4 occurrences):
- Same pattern as login

**`frontend/app/verify-email/page.tsx`**, **`frontend/app/forgot-password/page.tsx`**, **`frontend/app/reset-password/page.tsx`** (3 each):
- Same pattern

**`frontend/components/Sidebar.tsx`** (10 occurrences of rgba(99,102,241)):
- `rgba(99,102,241,0.15)` → `rgba(167,139,250,0.15)`
- `rgba(99,102,241,0.2)` → `rgba(167,139,250,0.2)`
- `rgba(99,102,241,0.25)` → `rgba(167,139,250,0.25)`
- etc.

**`frontend/components/ResponsesTable.tsx`** (8 occurrences):
- Same rgba pattern

**`frontend/app/reports/page.tsx`** (9 occurrences):
- Same pattern

**`frontend/app/tracker/page.tsx`** (23 occurrences):
- Same pattern — this is the largest

**`frontend/app/content/page.tsx`** (33 occurrences):
- Same pattern — largest file

**`frontend/components/PromptImpactTimeline.tsx`** (7 occurrences):
- Same pattern

**`frontend/components/TrendChart.tsx`** (7 occurrences):
- Same pattern

**All other files** listed in the grep results (~15 more files with 1-6 occurrences each):
- Same find-and-replace pattern

- [ ] **Step 2: Verify no remaining hardcoded indigo**

```bash
cd frontend && grep -r "6366f1\|rgba(99,102,241\|#4f46e5\|#818cf8" --include="*.tsx" --include="*.ts" --include="*.css" -l | grep -v node_modules | grep -v .claude
```
Expected: No results (or only globals.css which uses var references)

- [ ] **Step 3: Verify build**

```bash
cd frontend && npm run build 2>&1 | tail -5
```
Expected: Build succeeds

- [ ] **Step 4: Commit**

```bash
git add -A frontend/app frontend/components
git commit -m "feat: replace all hardcoded indigo with lavender across components"
```

---

### Task 5: Fix ModelBreakdown Component — Remove Side-Stripe Border

**Files:**
- Modify: `frontend/components/ModelBreakdown.tsx:52-56`

- [ ] **Step 1: Update ModelBreakdown to use background tint instead of borderLeftColor**

In `ModelBreakdown.tsx`, replace the model-card div (line 52-56):

```tsx
// BEFORE:
<div
  key={ms.model}
  className="model-card"
  style={{ borderLeftColor: unconfigured ? 'var(--border-subtle)' : config.color }}
>

// AFTER:
<div
  key={ms.model}
  className="model-card"
  style={{
    background: unconfigured
      ? 'rgba(15,23,42,0.4)'
      : `color-mix(in oklch, ${config.color} 4%, rgba(15,23,42,0.4))`,
  }}
>
```

This uses `color-mix` to blend 4% of the model color into the card background, replacing the banned side-stripe.

- [ ] **Step 2: Verify build**

```bash
cd frontend && npm run build 2>&1 | tail -5
```
Expected: Build succeeds

- [ ] **Step 3: Commit**

```bash
git add frontend/components/ModelBreakdown.tsx
git commit -m "fix: replace model card side-stripe with subtle background tint"
```

---

## Phase 2: Component Refactoring

### Task 6: Extract Dashboard Components

**Files:**
- Create: `frontend/components/dashboard/DashboardHeader.tsx`
- Create: `frontend/components/dashboard/StatsGrid.tsx`
- Create: `frontend/components/dashboard/VisibilityChart.tsx`
- Create: `frontend/components/dashboard/BrandTable.tsx`
- Create: `frontend/components/dashboard/BestPromptCard.tsx`
- Create: `frontend/components/dashboard/DonutDomains.tsx`
- Create: `frontend/components/dashboard/DashboardModelBreakdown.tsx`
- Modify: `frontend/app/dashboard/page.tsx`

- [ ] **Step 1: Create the dashboard components directory**

```bash
mkdir -p frontend/components/dashboard
```

- [ ] **Step 2: Extract HelpTooltip, SparklineTooltip, and helper functions**

Extract from `dashboard/page.tsx` lines 85-148 into the components that use them (HelpTooltip is used across several, keep it in its own file or inline where used).

- [ ] **Step 3: Extract DonutDomains component**

Move the `DonutDomains` function (lines 149-268) into `frontend/components/dashboard/DonutDomains.tsx`. Include its imports (PieChart, Cell, Tooltip, ResponsiveContainer from recharts, DOMAIN_COLORS constant).

Export as `default function DonutDomains`.

- [ ] **Step 4: Extract ModelBreakdown (dashboard-specific)**

Move the inline `ModelBreakdown` function (lines 270-312 — the one inside dashboard, NOT the shared component) into `frontend/components/dashboard/DashboardModelBreakdown.tsx`. This is distinct from `components/ModelBreakdown.tsx`.

- [ ] **Step 5: Extract BestPromptCard**

Move `buildPromptGroups` (lines 313-332) and `BestPromptCard` (lines 333-406) into `frontend/components/dashboard/BestPromptCard.tsx`.

- [ ] **Step 6: Extract StatsGrid**

From the main `DashboardPage` component, extract the stats card rendering section (the grid with visibility score, total mentions, queries, etc.) into `frontend/components/dashboard/StatsGrid.tsx`.

- [ ] **Step 7: Extract VisibilityChart**

Extract the trend chart section (AreaChart with sparkline) into `frontend/components/dashboard/VisibilityChart.tsx`.

- [ ] **Step 8: Extract BrandTable**

Extract the brand list/table section into `frontend/components/dashboard/BrandTable.tsx`.

- [ ] **Step 9: Extract DashboardHeader**

Extract the page header with title, brand selector dropdown, and action buttons into `frontend/components/dashboard/DashboardHeader.tsx`.

- [ ] **Step 10: Refactor dashboard/page.tsx to import extracted components**

The page file should become an orchestrator:

```tsx
export default function DashboardPage() {
  // ... state, data fetching, handlers stay here ...
  
  return (
    <div className="max-w-7xl mx-auto px-4 md:px-8 py-6">
      <DashboardHeader ... />
      <StatsGrid ... />
      <VisibilityChart ... />
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <DonutDomains ... />
        <DashboardModelBreakdown ... />
      </div>
      <BrandTable ... />
      <BestPromptCard ... />
    </div>
  );
}
```

- [ ] **Step 11: Verify build and manually test dashboard loads**

```bash
cd frontend && npm run build 2>&1 | tail -5
```
Expected: Build succeeds, no TypeScript errors

- [ ] **Step 12: Commit**

```bash
git add frontend/components/dashboard/ frontend/app/dashboard/page.tsx
git commit -m "refactor: decompose dashboard page into focused components"
```

---

### Task 7: Extract ContentTabPanels into Separate Files

**Files:**
- Create: `frontend/components/content/helpers.ts`
- Create: `frontend/components/content/cards/DraftCard.tsx`
- Create: `frontend/components/content/cards/WikipediaDraftCard.tsx`
- Create: `frontend/components/content/cards/ScheduledCard.tsx`
- Create: `frontend/components/content/cards/PostedCard.tsx`
- Create: `frontend/components/content/cards/OpportunityCard.tsx`
- Create: `frontend/components/content/DraftsPanel.tsx`
- Create: `frontend/components/content/ScheduledPanel.tsx`
- Create: `frontend/components/content/OpportunitiesPanel.tsx`
- Create: `frontend/components/content/PostedPanel.tsx`
- Move: `frontend/app/content/components/QualityChecklist.tsx` → `frontend/components/content/QualityChecklist.tsx`
- Modify: `frontend/components/content/ContentTabPanels.tsx`

- [ ] **Step 1: Create directories**

```bash
mkdir -p frontend/components/content/cards
```

- [ ] **Step 2: Extract helpers**

Move these functions from ContentTabPanels.tsx into `frontend/components/content/helpers.ts`:
- `relativeTime` (line 113)
- `generateAvailableLabel` (line 123)
- `isPromoRestricted` (line 164)
- `extractSubreddit` (line 171)
- `computeUrgency` (line 179)
- `runQualityChecks` (line 216)
- `renderPreviewHtml` (line 495)
- `wikiToPlain` (line 934)
- `extractCitations` (line 945)
- `extractWikiLinks` (line 953)
- `plainToWikiFormat` (line 966)
- `PLATFORM_DISPLAY` constant (line 43)
- `EmptyState` component (line 1753)

Export all as named exports.

- [ ] **Step 3: Extract card components**

Move each card into its own file under `components/content/cards/`:
- `DraftCard` (line 510-933) → `cards/DraftCard.tsx`
- `WikipediaDraftCard` (line 1002-1221) → `cards/WikipediaDraftCard.tsx`
- `ScheduledCard` (line 1394-1520) → `cards/ScheduledCard.tsx`
- `PostedCard` (line 1521-1641) → `cards/PostedCard.tsx`
- `OpportunityCard` (line 1642-1752) → `cards/OpportunityCard.tsx`
- `QuoraQuestionPicker` (line 1222-1393) → keep in DraftCard.tsx or its own file

Each card imports helpers from `../helpers`.

- [ ] **Step 4: Move QualityChecklist**

Move `QualityChecklist` (line 412-494) into `frontend/components/content/QualityChecklist.tsx`.

- [ ] **Step 5: Extract panel components**

Move each panel into its own file:
- `DraftsPanel` (line 1778-1905) → `DraftsPanel.tsx`
- `ScheduledPanel` (line 1906-1931) → `ScheduledPanel.tsx`
- `OpportunitiesPanel` (line 1932-2013) → `OpportunitiesPanel.tsx`
- `PostedPanel` (line 2014-2034) → `PostedPanel.tsx`

Each panel imports its cards from `./cards/` and helpers from `./helpers`.

- [ ] **Step 6: Slim down ContentTabPanels.tsx to router only**

The file becomes:

```tsx
export { type ContentTabPanelsProps } from './helpers';
export { ContentTabPanels } from './ContentTabPanels';
```

Or keep it as the router that imports panels:

```tsx
import { DraftsPanel } from './DraftsPanel';
import { ScheduledPanel } from './ScheduledPanel';
import { OpportunitiesPanel } from './OpportunitiesPanel';
import { PostedPanel } from './PostedPanel';

export function ContentTabPanels(props: ContentTabPanelsProps) {
  const { activeTab } = props;
  if (activeTab === 'drafts') return <DraftsPanel {...props} />;
  if (activeTab === 'scheduled') return <ScheduledPanel {...props} />;
  if (activeTab === 'opportunities') return <OpportunitiesPanel {...props} />;
  if (activeTab === 'posted') return <PostedPanel {...props} />;
  return null;
}
```

The `ContentTabPanelsProps` interface moves to `helpers.ts`.

- [ ] **Step 7: Verify build**

```bash
cd frontend && npm run build 2>&1 | tail -5
```
Expected: Build succeeds

- [ ] **Step 8: Commit**

```bash
git add frontend/components/content/
git commit -m "refactor: decompose ContentTabPanels into focused card and panel components"
```

---

## Phase 3: Core Animation

### Task 8: Add Page Content Fade-In Animation

**Files:**
- Modify: `frontend/app/dashboard/page.tsx` (and other page files)

- [ ] **Step 1: Add motion wrapper to dashboard page**

Import and wrap the main page content:

```tsx
'use client';
import { motion } from 'framer-motion';
import { fadeIn } from '@/lib/motion';

// In the return, wrap the outermost content div:
return (
  <motion.div
    className="max-w-7xl mx-auto px-4 md:px-8 py-6"
    variants={fadeIn}
    initial="hidden"
    animate="visible"
  >
    {/* ... existing content ... */}
  </motion.div>
);
```

- [ ] **Step 2: Apply the same pattern to all main pages**

Add the `motion.div` + `fadeIn` wrapper to:
- `app/tracker/page.tsx`
- `app/content/page.tsx` (or `app/content/[brandId]/page.tsx`)
- `app/results/[brandId]/page.tsx`
- `app/reports/page.tsx`
- `app/settings/page.tsx`
- `app/account/page.tsx`
- `app/team/page.tsx`

Each page wraps its outermost content div with `motion.div variants={fadeIn} initial="hidden" animate="visible"`.

- [ ] **Step 3: Verify build**

```bash
cd frontend && npm run build 2>&1 | tail -5
```
Expected: Build succeeds

- [ ] **Step 4: Commit**

```bash
git add frontend/app/
git commit -m "feat: add page content fade-in animation on mount"
```

---

### Task 9: Add Stagger Animation to Lists and Stat Cards

**Files:**
- Modify: `frontend/components/dashboard/StatsGrid.tsx`
- Modify: `frontend/app/tracker/page.tsx` (brand list)
- Modify: Other list-rendering components

- [ ] **Step 1: Add stagger to StatsGrid**

```tsx
import { motion } from 'framer-motion';
import { staggerContainer, staggerChild } from '@/lib/motion';

// Wrap the stats grid:
<motion.div
  className="grid grid-cols-1 sm:grid-cols-3 gap-4"
  variants={staggerContainer}
  initial="hidden"
  animate="visible"
>
  {stats.map((stat) => (
    <motion.div key={stat.label} variants={staggerChild} className="card">
      {/* ... stat content ... */}
    </motion.div>
  ))}
</motion.div>
```

- [ ] **Step 2: Add stagger to brand list on tracker page**

Same pattern: wrap the brand list container with `staggerContainer`, each brand card with `staggerChild`.

- [ ] **Step 3: Add stagger to results table rows**

For table rows, use a lighter stagger (30ms) via CSS `animation-delay` on nth-child rather than Framer Motion (Emil: CSS animations off main thread are better for predetermined animations):

```css
/* In globals.css */
.stagger-row {
  opacity: 0;
  transform: translateY(4px);
  animation: fadeInRow 300ms var(--ease-out) forwards;
}
.stagger-row:nth-child(1) { animation-delay: 0ms; }
.stagger-row:nth-child(2) { animation-delay: 30ms; }
.stagger-row:nth-child(3) { animation-delay: 60ms; }
.stagger-row:nth-child(4) { animation-delay: 90ms; }
.stagger-row:nth-child(5) { animation-delay: 120ms; }
.stagger-row:nth-child(6) { animation-delay: 150ms; }
.stagger-row:nth-child(7) { animation-delay: 180ms; }
.stagger-row:nth-child(8) { animation-delay: 210ms; }
.stagger-row:nth-child(9) { animation-delay: 240ms; }
.stagger-row:nth-child(10) { animation-delay: 270ms; }

@keyframes fadeInRow {
  to { opacity: 1; transform: translateY(0); }
}

@media (prefers-reduced-motion: reduce) {
  .stagger-row {
    animation: none;
    opacity: 1;
    transform: none;
  }
}
```

Apply `stagger-row` class to table rows in brand table and results table.

- [ ] **Step 4: Add stagger to draft/content card lists**

Apply staggerContainer + staggerChild to the draft list, opportunity list, and posted list in the content panels.

- [ ] **Step 5: Verify build**

```bash
cd frontend && npm run build 2>&1 | tail -5
```
Expected: Build succeeds

- [ ] **Step 6: Commit**

```bash
git add frontend/components/ frontend/app/ frontend/app/globals.css
git commit -m "feat: add stagger animations to stat cards, brand lists, table rows, and content cards"
```

---

### Task 10: Add Tab Content Slide Transitions

**Files:**
- Modify: Components using Radix Tabs for content switching

- [ ] **Step 1: Add AnimatePresence + slideIn to tab content**

Where tab panels are rendered (content page, tracker page with tabs), wrap the active panel content:

```tsx
import { AnimatePresence, motion } from 'framer-motion';
import { slideIn } from '@/lib/motion';

<AnimatePresence mode="wait">
  <motion.div
    key={activeTab}
    variants={slideIn}
    initial="hidden"
    animate="visible"
    exit="exit"
  >
    {/* tab content */}
  </motion.div>
</AnimatePresence>
```

- [ ] **Step 2: Apply to content page tabs (drafts/scheduled/opportunities/posted)**

In the content page where `ContentTabPanels` is rendered, wrap with AnimatePresence keyed on the active tab.

- [ ] **Step 3: Verify build**

```bash
cd frontend && npm run build 2>&1 | tail -5
```
Expected: Build succeeds

- [ ] **Step 4: Commit**

```bash
git add frontend/app/ frontend/components/
git commit -m "feat: add slide transition for tab content switching"
```

---

### Task 11: Add Toast CSS Transition + Dropdown/Popover Origin-Aware Animation

**Files:**
- Modify: `frontend/components/AppToast.tsx`
- Modify: `frontend/components/ui/dialog.tsx`
- Modify: `frontend/app/globals.css`

- [ ] **Step 1: Add toast enter/exit CSS transitions**

Add to globals.css:

```css
/* ── Toast transitions (CSS, not keyframes — interruptible) ───────────────── */
.toast-enter {
  transform: translateY(16px);
  opacity: 0;
  transition: transform 400ms var(--ease-out), opacity 400ms var(--ease-out);
}
.toast-visible {
  transform: translateY(0);
  opacity: 1;
}
.toast-exit {
  transform: translateY(8px);
  opacity: 0;
  transition: transform 200ms var(--ease-out), opacity 200ms var(--ease-out);
}
```

Apply these classes to the AppToast component based on its visibility state.

- [ ] **Step 2: Update dialog animation to use lavender and proper spring feel**

In `dialog.tsx`, update the DialogContent to use `transform-origin: center` (already correct for modals) and update any remaining indigo references in focus rings to lavender.

- [ ] **Step 3: Update dropdown-menu transform-origin**

If using Radix dropdown-menu, ensure `transform-origin: var(--radix-dropdown-menu-content-transform-origin)` is set so it scales from its trigger.

- [ ] **Step 4: Verify build**

```bash
cd frontend && npm run build 2>&1 | tail -5
```
Expected: Build succeeds

- [ ] **Step 5: Commit**

```bash
git add frontend/components/ frontend/app/globals.css
git commit -m "feat: add toast CSS transitions, origin-aware dropdown animations"
```

---

### Task 12: Add Stat Number Count-Up Animation

**Files:**
- Modify: `frontend/components/dashboard/StatsGrid.tsx`
- Modify: `frontend/lib/motion.ts`

- [ ] **Step 1: Add useCountUp hook to motion.ts**

```typescript
import { useEffect, useRef, useState } from 'react';
import { useReducedMotion } from 'framer-motion';

export function useCountUp(target: number, duration = 600): string {
  const prefersReduced = useReducedMotion();
  const [display, setDisplay] = useState('0');
  const frameRef = useRef<number>();

  useEffect(() => {
    if (prefersReduced || target === 0) {
      setDisplay(formatStatValue(target));
      return;
    }

    const start = performance.now();
    const animate = (now: number) => {
      const elapsed = now - start;
      const progress = Math.min(elapsed / duration, 1);
      // ease-out curve
      const eased = 1 - Math.pow(1 - progress, 3);
      const current = eased * target;
      setDisplay(formatStatValue(current));
      if (progress < 1) {
        frameRef.current = requestAnimationFrame(animate);
      }
    };
    frameRef.current = requestAnimationFrame(animate);
    return () => {
      if (frameRef.current) cancelAnimationFrame(frameRef.current);
    };
  }, [target, duration, prefersReduced]);

  return display;
}

function formatStatValue(n: number): string {
  if (n >= 1000) return Math.round(n).toLocaleString();
  if (n % 1 === 0) return Math.round(n).toString();
  return n.toFixed(1);
}
```

- [ ] **Step 2: Use useCountUp in StatsGrid**

```tsx
function StatCard({ label, value }: { label: string; value: number }) {
  const display = useCountUp(value);
  return (
    <div className="card">
      <div className="section-label">{label}</div>
      <div className="stat-value stat-value-sm mt-1">{display}</div>
    </div>
  );
}
```

- [ ] **Step 3: Verify build**

```bash
cd frontend && npm run build 2>&1 | tail -5
```
Expected: Build succeeds

- [ ] **Step 4: Commit**

```bash
git add frontend/lib/motion.ts frontend/components/dashboard/
git commit -m "feat: add stat number count-up animation"
```

---

## Phase 4: Polish Pass

### Task 13: Dashboard Polish

**Files:**
- Modify: `frontend/components/dashboard/VisibilityChart.tsx`
- Modify: `frontend/components/dashboard/StatsGrid.tsx`

- [ ] **Step 1: Enable chart animation on mount**

In the Recharts AreaChart, ensure `isAnimationActive={true}` and set `animationDuration={800}` with `animationEasing="ease-out"`.

- [ ] **Step 2: Add hover lift to stat cards**

Add `card-hover` class to each stat card div so the hover translateY(-1px) applies.

- [ ] **Step 3: Verify build and visually test**

```bash
cd frontend && npm run build 2>&1 | tail -5
```

- [ ] **Step 4: Commit**

```bash
git add frontend/components/dashboard/
git commit -m "feat: polish dashboard with chart animation and card hover lifts"
```

---

### Task 14: Tracker Page Polish

**Files:**
- Modify: `frontend/app/tracker/page.tsx`

- [ ] **Step 1: Add stagger to brand list**

Wrap brand cards with staggerContainer/staggerChild.

- [ ] **Step 2: Add scale feedback to "Run Now" and action buttons**

Ensure all action buttons have the `.btn` class (which now has `:active` scale).

- [ ] **Step 3: Commit**

```bash
git add frontend/app/tracker/
git commit -m "feat: add stagger and interaction polish to tracker page"
```

---

### Task 15: Content Page Polish

**Files:**
- Modify: Content panel components
- Modify: Content card components

- [ ] **Step 1: Add stagger to draft/opportunity card lists**

Apply staggerContainer/staggerChild to the card list rendering in each panel.

- [ ] **Step 2: Add card hover lift to draft cards**

Add `card-hover` class to clickable draft cards.

- [ ] **Step 3: Commit**

```bash
git add frontend/components/content/
git commit -m "feat: add stagger and hover polish to content panels"
```

---

### Task 16: Sidebar Polish

**Files:**
- Modify: `frontend/components/Sidebar.tsx`

- [ ] **Step 1: Update all hardcoded indigo refs to lavender (if not already done in Task 4)**

Verify all `rgba(99,102,241,...)` are now `rgba(167,139,250,...)`.

- [ ] **Step 2: Add smooth transition to nav link active state**

Ensure nav links use `transition: background-color 200ms var(--ease-out), border-color 200ms var(--ease-out)` instead of `transition: all`.

- [ ] **Step 3: Commit**

```bash
git add frontend/components/Sidebar.tsx
git commit -m "feat: polish sidebar nav transitions and lavender accent"
```

---

### Task 17: Results Page Polish

**Files:**
- Modify: `frontend/app/results/[brandId]/page.tsx`
- Modify: `frontend/components/ResponsesTable.tsx`

- [ ] **Step 1: Add stagger-row class to response table rows**

Apply the `stagger-row` CSS class to each `<tr>` or row div in the responses table.

- [ ] **Step 2: Update hardcoded indigo in ResponsesTable**

Replace remaining `rgba(99,102,241,...)` references with lavender equivalents.

- [ ] **Step 3: Commit**

```bash
git add frontend/app/results/ frontend/components/ResponsesTable.tsx
git commit -m "feat: add stagger animation and lavender polish to results page"
```

---

### Task 18: Final Audit — transition:all, Gradient Text, Visual QA

**Files:**
- Modify: Any remaining files with `transition: all`, `transition-all`, or `background-clip: text`

- [ ] **Step 1: Search for remaining transition:all**

```bash
cd frontend && grep -rn "transition: all\|transition-all" --include="*.tsx" --include="*.ts" --include="*.css" | grep -v node_modules | grep -v .claude
```

- [ ] **Step 2: Replace each instance with specific properties**

For each hit, replace `transition: all 0.15s` with the specific properties being animated (e.g., `transition: background-color 0.15s ease, color 0.15s ease`).

For Tailwind `transition-all` classes, replace with specific transition classes like `transition-colors` or `transition-transform`.

- [ ] **Step 3: Audit for gradient text (Impeccable ban #2)**

```bash
cd frontend && grep -rn "background-clip.*text\|webkit-background-clip.*text" --include="*.tsx" --include="*.ts" --include="*.css" | grep -v node_modules | grep -v .claude
```

If any hits found: replace gradient text with a solid color. Use the dominant color from the gradient as the solid text color.

- [ ] **Step 4: Verify build one final time**

```bash
cd frontend && npm run build 2>&1 | tail -5
```
Expected: Build succeeds with no errors

- [ ] **Step 5: Commit**

```bash
git add -A frontend/
git commit -m "fix: replace transition:all with specific properties, remove gradient text"
```

---

### Task 19: AppShell RunBanner — Update Indigo References

**Files:**
- Modify: `frontend/components/AppShell.tsx`

- [ ] **Step 1: Update RunBanner gradient and border**

In the `ReportRunningBanner` component, replace:
- `rgba(99,102,241,0.08)` → `rgba(167,139,250,0.08)`
- `rgba(99,102,241,0.02)` → `rgba(167,139,250,0.02)`
- `rgba(99,102,241,0.18)` → `rgba(167,139,250,0.18)`

- [ ] **Step 2: Commit**

```bash
git add frontend/components/AppShell.tsx
git commit -m "feat: update AppShell run banner to lavender accent"
```
