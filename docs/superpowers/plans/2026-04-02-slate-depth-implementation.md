# Slate Depth UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the indigo glassmorphism aesthetic with the Slate Depth design system — refined dark mode, Inter + Geist Mono fonts, solid layered backgrounds, model colors as left-border accents.

**Architecture:** Pure frontend styling changes. No API changes. Work bottom-up: design tokens → layout/fonts → shell → components → pages. Each task leaves the app in a working state.

**Tech Stack:** Next.js 15, Tailwind CSS, `next/font/google`, Recharts

**Spec:** `docs/superpowers/specs/2026-04-02-slate-depth-design.md`

---

## File Map

| File | Change |
|------|--------|
| `frontend/app/layout.tsx` | Replace Syne + JetBrains Mono with Geist Mono |
| `frontend/tailwind.config.js` | Update font families, add slate color tokens |
| `frontend/app/globals.css` | New design tokens, remove glassmorphism, new component classes |
| `frontend/components/AppShell.tsx` | Remove ambient orbs, update base background |
| `frontend/components/Sidebar.tsx` | Solid background, remove glow, new active states |
| `frontend/components/StatsCard.tsx` | Remove glassmorphism, use new card styles |
| `frontend/components/ModelBreakdown.tsx` | New model card styling with left-border accent |
| `frontend/components/TrendChart.tsx` | Update model colors to new palette |
| `frontend/app/dashboard/page.tsx` | Update MODEL_CONFIG colors |

---

## Task 1: Font Stack

**Files:**
- Modify: `frontend/app/layout.tsx`
- Modify: `frontend/tailwind.config.js`

- [ ] **Step 1.1: Update layout.tsx font imports**

In `frontend/app/layout.tsx`, replace lines 2-26 (the font imports and configurations):

```tsx
import type { Metadata } from 'next';
import { Inter, Geist_Mono } from 'next/font/google';
import './globals.css';
import { AuthProvider } from '@/contexts/AuthContext';
import AppShell from '@/components/AppShell';
import CookieConsent from '@/components/CookieConsent';

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-inter',
  display: 'swap',
});

const geistMono = Geist_Mono({
  subsets: ['latin'],
  variable: '--font-geist-mono',
  weight: ['400', '500', '600', '700'],
  display: 'swap',
});
```

- [ ] **Step 1.2: Update the html className**

In `frontend/app/layout.tsx`, update line 60 (the `<html>` tag):

```tsx
<html lang="en" className={`${inter.variable} ${geistMono.variable}`}>
```

- [ ] **Step 1.3: Update tailwind.config.js font families**

In `frontend/tailwind.config.js`, replace the fontFamily block (lines 10-14):

```js
fontFamily: {
  sans: ['var(--font-inter)', '-apple-system', 'BlinkMacSystemFont', '"Segoe UI"', 'sans-serif'],
  mono: ['var(--font-geist-mono)', 'SF Mono', 'ui-monospace', 'monospace'],
},
```

- [ ] **Step 1.4: Type-check**

```bash
cd /Users/ken/Desktop/Lumidian/frontend && npx tsc --noEmit
```

Expected: No errors.

- [ ] **Step 1.5: Commit**

```bash
cd /Users/ken/Desktop/Lumidian
git add frontend/app/layout.tsx frontend/tailwind.config.js
git commit -m "feat(ui): swap to Inter + Geist Mono font stack"
```

---

## Task 2: Design Tokens

**Files:**
- Modify: `frontend/app/globals.css`

- [ ] **Step 2.1: Replace the design tokens block**

In `frontend/app/globals.css`, replace lines 29-61 (the `/* ── Design tokens */` section) with:

```css
/* ── Design tokens ─────────────────────────────────────────────────────────── */
:root {
  /* Backgrounds - Slate scale */
  --bg-base: #020617;
  --bg-raised: #0f172a;
  --bg-card: #1e293b;
  --bg-elevated: #334155;

  /* Borders */
  --border-subtle: rgba(51, 65, 85, 0.5);
  --border-default: rgba(71, 85, 105, 0.5);
  --border-strong: rgba(100, 116, 139, 0.5);

  /* Text */
  --text-primary: #f8fafc;
  --text-secondary: #94a3b8;
  --text-muted: #64748b;
  --text-faint: #475569;

  /* Model colors */
  --color-chatgpt: #22c55e;
  --color-chatgpt-muted: rgba(34, 197, 94, 0.15);
  --color-claude: #f97316;
  --color-claude-muted: rgba(249, 115, 22, 0.15);
  --color-perplexity: #8b5cf6;
  --color-perplexity-muted: rgba(139, 92, 246, 0.15);
  --color-gemini: #3b82f6;
  --color-gemini-muted: rgba(59, 130, 246, 0.15);

  /* Semantic */
  --success: #22c55e;
  --success-muted: rgba(34, 197, 94, 0.1);
  --warning: #f59e0b;
  --danger: #ef4444;

  /* Accent */
  --accent: #6366f1;
  --accent-hover: #4f46e5;

  /* Radius */
  --radius-sm: 6px;
  --radius-md: 8px;
  --radius-lg: 12px;
  --radius-xl: 16px;
}
```

- [ ] **Step 2.2: Update body styles**

In `frontend/app/globals.css`, replace lines 67-73 (the body styles):

```css
body {
  background-color: var(--bg-base);
  color: var(--text-primary);
  font-family: var(--font-inter), -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}
```

- [ ] **Step 2.3: Replace the card utilities**

In `frontend/app/globals.css`, replace lines 88-131 (card utilities and model-spectrum cards) with:

```css
/* ── Card utilities ────────────────────────────────────────────────────────── */
.card {
  background: var(--bg-raised);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-lg);
  padding: 20px;
}
.card-hover:hover {
  background: var(--bg-card);
  border-color: var(--border-default);
}
.card-elevated {
  background: linear-gradient(135deg, rgba(15,23,42,0.8) 0%, rgba(30,41,59,0.4) 100%);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-lg);
  padding: 20px;
  box-shadow: 0 4px 24px rgba(0,0,0,0.3);
}

/* ── Model card with left-border accent ────────────────────────────────────── */
.model-card {
  background: rgba(15,23,42,0.4);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
  padding: 14px 16px;
  border-left-width: 3px;
  border-left-style: solid;
}
.model-card-chatgpt { border-left-color: var(--color-chatgpt); }
.model-card-claude { border-left-color: var(--color-claude); }
.model-card-perplexity { border-left-color: var(--color-perplexity); }
.model-card-gemini { border-left-color: var(--color-gemini); }
```

- [ ] **Step 2.4: Replace button utilities**

In `frontend/app/globals.css`, replace lines 150-207 (button utilities) with:

```css
/* ── Button utilities ──────────────────────────────────────────────────────── */
.btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 0.875rem;
  font-weight: 500;
  padding: 10px 16px;
  border-radius: var(--radius-md);
  transition: all 0.15s ease;
  cursor: pointer;
  white-space: nowrap;
  border: 1px solid transparent;
}
.btn:disabled { opacity: 0.45; cursor: not-allowed; }

.btn-primary {
  background: var(--accent);
  color: white;
  border-color: transparent;
}
.btn-primary:hover:not(:disabled) {
  background: var(--accent-hover);
}

.btn-secondary {
  background: transparent;
  color: var(--text-secondary);
  border-color: var(--border-default);
}
.btn-secondary:hover:not(:disabled) {
  background: rgba(255,255,255,0.05);
  border-color: var(--border-strong);
  color: var(--text-primary);
}

.btn-ghost {
  background: transparent;
  color: var(--text-muted);
  border-color: transparent;
}
.btn-ghost:hover:not(:disabled) {
  background: rgba(255,255,255,0.03);
  color: var(--text-secondary);
}

.btn-destructive {
  background: rgba(127,29,29,0.15);
  color: #f87171;
  border-color: rgba(153,27,27,0.25);
}
.btn-destructive:hover:not(:disabled) {
  background: rgba(127,29,29,0.25);
  border-color: rgba(153,27,27,0.40);
}
```

- [ ] **Step 2.5: Remove stat-value-display and add stat-value**

In `frontend/app/globals.css`, replace lines 330-348 (the `.stat-value-display` class at the end) with:

```css
/* ── Stat value (mono font for data) ───────────────────────────────────────── */
.stat-value {
  font-family: var(--font-geist-mono), 'SF Mono', ui-monospace, monospace;
  font-weight: 600;
  letter-spacing: -1px;
  line-height: 1;
  color: var(--text-primary);
}
.stat-value-lg {
  font-size: 36px;
  letter-spacing: -2px;
}
.stat-value-sm {
  font-size: 24px;
  letter-spacing: -1px;
}
```

- [ ] **Step 2.6: Verify CSS loads**

```bash
cd /Users/ken/Desktop/Lumidian/frontend && npm run dev &
sleep 3 && curl -s http://localhost:3002 | grep -o "bg-base" | head -1
```

Expected: Output contains `bg-base` indicating CSS loaded.

- [ ] **Step 2.7: Commit**

```bash
git add frontend/app/globals.css
git commit -m "feat(ui): add Slate Depth design tokens, remove glassmorphism"
```

---

## Task 3: AppShell — Remove Orbs

**Files:**
- Modify: `frontend/components/AppShell.tsx`

- [ ] **Step 3.1: Replace the fixed background and orbs**

In `frontend/components/AppShell.tsx`, replace lines 75-108 (the fixed dark base and ambient orbs div) with:

```tsx
      {/* Fixed slate base background */}
      <div style={{ position: 'fixed', inset: 0, background: '#020617', zIndex: -2 }} />
```

This removes all four ambient gradient orbs and simplifies to a solid slate background.

- [ ] **Step 3.2: Type-check**

```bash
cd /Users/ken/Desktop/Lumidian/frontend && npx tsc --noEmit
```

Expected: No errors.

- [ ] **Step 3.3: Commit**

```bash
git add frontend/components/AppShell.tsx
git commit -m "feat(ui): remove ambient orbs, use solid slate background"
```

---

## Task 4: Sidebar Styling

**Files:**
- Modify: `frontend/components/Sidebar.tsx`

- [ ] **Step 4.1: Update NavLink active styles**

In `frontend/components/Sidebar.tsx`, replace the NavLink component's style prop (lines 58-63):

```tsx
      style={isActive ? {
        background: 'rgba(99,102,241,0.12)',
        borderRadius: '12px',
      } : undefined}
```

- [ ] **Step 4.2: Remove the onMouseEnter/onMouseLeave inline background changes**

In `frontend/components/Sidebar.tsx`, replace lines 64-69 (the mouse event handlers) with simpler hover via CSS class:

```tsx
      onMouseEnter={(e) => {
        if (!isActive) (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.04)';
      }}
      onMouseLeave={(e) => {
        if (!isActive) (e.currentTarget as HTMLElement).style.background = 'transparent';
      }}
```

- [ ] **Step 4.3: Remove the glow box-shadow from the active style**

The current style on line 62 has `boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.08), 0 0 18px rgba(99,102,241,0.12)'`. Remove it so the style block becomes:

```tsx
      style={isActive ? {
        background: 'rgba(99,102,241,0.12)',
      } : undefined}
```

- [ ] **Step 4.4: Type-check**

```bash
cd /Users/ken/Desktop/Lumidian/frontend && npx tsc --noEmit
```

Expected: No errors.

- [ ] **Step 4.5: Commit**

```bash
git add frontend/components/Sidebar.tsx
git commit -m "feat(ui): simplify Sidebar active states, remove glow effects"
```

---

## Task 5: StatsCard Component

**Files:**
- Modify: `frontend/components/StatsCard.tsx`

- [ ] **Step 5.1: Update loading state card**

In `frontend/components/StatsCard.tsx`, replace lines 69-78 (the loading return):

```tsx
  if (loading) {
    return (
      <div className="card">
        <div className="skeleton h-3 rounded w-24 mb-4" />
        <div className="skeleton h-8 rounded w-16 mb-2" />
        <div className="skeleton h-3 rounded w-32" />
      </div>
    );
  }
```

- [ ] **Step 5.2: Update the main card wrapper**

In `frontend/components/StatsCard.tsx`, replace lines 87-94 (the main div with glassmorphism):

```tsx
  return (
    <div
      className={clsx('card card-hover', accent && 'card-elevated')}
      style={borderTopStyle}
    >
```

- [ ] **Step 5.3: Update the value display**

In `frontend/components/StatsCard.tsx`, replace lines 98-106 (the value paragraph):

```tsx
          <p className={clsx(
            compact
              ? 'mt-2 text-lg font-semibold leading-snug'
              : 'mt-2 stat-value stat-value-lg',
            !isNumeric && 'text-[#F0F4F8] font-bold'
          )}>
            {isNumeric ? animatedValue : value}
          </p>
```

- [ ] **Step 5.4: Update the icon container**

In `frontend/components/StatsCard.tsx`, replace lines 130-135 (the icon div):

```tsx
        {icon && (
          <div className="ml-4 w-10 h-10 rounded-xl bg-[rgba(99,102,241,0.08)] border border-[rgba(99,102,241,0.15)] flex items-center justify-center text-[#818CF8] flex-shrink-0">
            {icon}
          </div>
        )}
```

- [ ] **Step 5.5: Type-check**

```bash
cd /Users/ken/Desktop/Lumidian/frontend && npx tsc --noEmit
```

Expected: No errors.

- [ ] **Step 5.6: Commit**

```bash
git add frontend/components/StatsCard.tsx
git commit -m "feat(ui): update StatsCard to Slate Depth design"
```

---

## Task 6: ModelBreakdown Component

**Files:**
- Modify: `frontend/components/ModelBreakdown.tsx`

- [ ] **Step 6.1: Update MODEL_CONFIG colors**

In `frontend/components/ModelBreakdown.tsx`, replace lines 9-37 (the MODEL_CONFIG object):

```tsx
const MODEL_CONFIG: Record<
  string,
  { label: string; color: string; bgColor: string; letter: string }
> = {
  chatgpt: {
    label: 'ChatGPT',
    color: '#22c55e',
    bgColor: 'rgba(34, 197, 94, 0.15)',
    letter: 'G',
  },
  claude: {
    label: 'Claude',
    color: '#f97316',
    bgColor: 'rgba(249, 115, 22, 0.15)',
    letter: 'C',
  },
  perplexity: {
    label: 'Perplexity',
    color: '#8b5cf6',
    bgColor: 'rgba(139, 92, 246, 0.15)',
    letter: 'P',
  },
  gemini: {
    label: 'Gemini',
    color: '#3b82f6',
    bgColor: 'rgba(59, 130, 246, 0.15)',
    letter: 'G',
  },
};
```

- [ ] **Step 6.2: Update empty state wrapper**

In `frontend/components/ModelBreakdown.tsx`, replace lines 57-67 (the empty state return):

```tsx
  if (!modelScores || modelScores.length === 0) {
    return (
      <div className="card">
        <h3 className="text-base font-semibold text-[#f8fafc] mb-4">Model Breakdown</h3>
        <p className="text-sm text-[#64748b] text-center py-4">No model data available</p>
      </div>
    );
  }
```

- [ ] **Step 6.3: Update main wrapper**

In `frontend/components/ModelBreakdown.tsx`, replace lines 77-81 (the main wrapper div):

```tsx
    <div className="card">
      <h3 className="text-base font-semibold text-[#f8fafc] mb-5">Model Breakdown</h3>
      <div className="space-y-4">
```

- [ ] **Step 6.4: Update model item to use left-border accent**

In `frontend/components/ModelBreakdown.tsx`, replace lines 89-149 (the map return block) with:

```tsx
          return (
            <div 
              key={ms.model} 
              className="model-card"
              style={{ borderLeftColor: unconfigured ? 'var(--border-subtle)' : config.color }}
            >
              <div className="flex items-center justify-between mb-2">
                <span
                  className="text-sm font-medium"
                  style={{ color: unconfigured ? '#475569' : '#f8fafc' }}
                >
                  {config.label}
                </span>

                {unconfigured ? (
                  <span className="text-xs px-2 py-0.5 rounded-full bg-[rgba(71,85,105,0.3)] text-[#64748b] border border-[rgba(71,85,105,0.3)]">
                    Not configured
                  </span>
                ) : (
                  <span
                    className="stat-value text-lg"
                    style={{ color: config.color }}
                  >
                    {pct}%
                  </span>
                )}
              </div>

              {!unconfigured && (
                <>
                  <div className="h-1 bg-[rgba(255,255,255,0.06)] rounded-full overflow-hidden mb-2">
                    <div
                      className="h-full rounded-full transition-all duration-700"
                      style={{
                        width: `${pct}%`,
                        background: config.color,
                      }}
                    />
                  </div>
                  <span className="text-xs text-[#64748b]">
                    {ms.total_mentions}/{ms.total_queries} mentions
                  </span>
                </>
              )}

              {unconfigured && (
                <p className="text-xs text-[#475569]">Add API key in Settings to enable</p>
              )}
            </div>
          );
```

- [ ] **Step 6.5: Type-check**

```bash
cd /Users/ken/Desktop/Lumidian/frontend && npx tsc --noEmit
```

Expected: No errors.

- [ ] **Step 6.6: Commit**

```bash
git add frontend/components/ModelBreakdown.tsx
git commit -m "feat(ui): update ModelBreakdown to left-border accent style"
```

---

## Task 7: TrendChart Model Colors

**Files:**
- Modify: `frontend/components/TrendChart.tsx`

- [ ] **Step 7.1: Update MODEL_LINES colors**

In `frontend/components/TrendChart.tsx`, replace lines 31-37 (MODEL_LINES and AVG_COLOR):

```tsx
const MODEL_LINES: { key: string; label: string; color: string }[] = [
  { key: 'chatgpt',    label: 'ChatGPT',    color: '#22c55e' },
  { key: 'claude',     label: 'Claude',     color: '#f97316' },
  { key: 'perplexity', label: 'Perplexity', color: '#8b5cf6' },
  { key: 'gemini',     label: 'Gemini',     color: '#3b82f6' },
];
const AVG_COLOR = '#6366f1';
```

- [ ] **Step 7.2: Update tooltip font reference**

In `frontend/components/TrendChart.tsx`, find line 80 which has `fontFamily: 'var(--font-jetbrains, monospace)'` and replace with:

```tsx
          fontFamily: 'var(--font-geist-mono), ui-monospace, monospace',
```

- [ ] **Step 7.3: Type-check**

```bash
cd /Users/ken/Desktop/Lumidian/frontend && npx tsc --noEmit
```

Expected: No errors.

- [ ] **Step 7.4: Commit**

```bash
git add frontend/components/TrendChart.tsx
git commit -m "feat(ui): update TrendChart model colors to Slate Depth palette"
```

---

## Task 8: Dashboard Page

**Files:**
- Modify: `frontend/app/dashboard/page.tsx`

- [ ] **Step 8.1: Update MODEL_CONFIG colors**

In `frontend/app/dashboard/page.tsx`, replace lines 122-127 (the MODEL_CONFIG object):

```tsx
const MODEL_CONFIG: Record<string, { label: string; bg: string; text: string }> = {
  chatgpt:    { label: 'ChatGPT',    bg: 'rgba(34,197,94,0.12)',   text: '#22c55e' },
  claude:     { label: 'Claude',     bg: 'rgba(249,115,22,0.12)',  text: '#f97316' },
  perplexity: { label: 'Perplexity', bg: 'rgba(139,92,246,0.12)',  text: '#8b5cf6' },
  gemini:     { label: 'Gemini',     bg: 'rgba(59,130,246,0.12)',  text: '#3b82f6' },
};
```

- [ ] **Step 8.2: Type-check**

```bash
cd /Users/ken/Desktop/Lumidian/frontend && npx tsc --noEmit
```

Expected: No errors.

- [ ] **Step 8.3: Commit**

```bash
git add frontend/app/dashboard/page.tsx
git commit -m "feat(ui): update dashboard MODEL_CONFIG to Slate Depth palette"
```

---

## Task 9: Visual Verification

- [ ] **Step 9.1: Start dev server**

```bash
cd /Users/ken/Desktop/Lumidian/frontend && npm run dev
```

- [ ] **Step 9.2: Manual verification checklist**

Open http://localhost:3002/dashboard and verify:

1. **Background** — Solid slate (#020617), no floating orbs
2. **Fonts** — Stats display in Geist Mono (clean, tight letter-spacing), body in Inter
3. **Cards** — Solid backgrounds, no blur, subtle borders
4. **Model colors** — ChatGPT green (#22c55e), Claude orange (#f97316), Perplexity purple (#8b5cf6), Gemini blue (#3b82f6)
5. **Sidebar** — Solid background, no glow on active items
6. **Hierarchy** — Clear visual distinction between Base → Raised → Card layers

- [ ] **Step 9.3: Final commit if needed**

```bash
git status
# If any uncommitted changes:
git add -A
git commit -m "fix(ui): final Slate Depth polish"
```

---

## Self-Review Checklist

- [x] **Spec coverage:** All 9 files in spec are covered by tasks
- [x] **No placeholders:** All code blocks are complete
- [x] **Type consistency:** Font variable names match (--font-geist-mono, --font-inter)
- [x] **Model colors consistent:** #22c55e, #f97316, #8b5cf6, #3b82f6 used across all files
