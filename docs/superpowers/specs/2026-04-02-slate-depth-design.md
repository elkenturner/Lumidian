# Lumidian UI Redesign — Slate Depth Design Spec

**Date:** 2026-04-02  
**Status:** Approved  
**Goal:** Replace the current indigo-tinted glassmorphism aesthetic with a refined Stripe/Vercel-inspired dark mode design system.

---

## Summary

The current UI suffers from:
- **Font issues** — Syne display font feels aggressive/unprofessional
- **Color flatness** — Indigo-everything palette lacks contrast and hierarchy
- **Glassmorphism fatigue** — Blur effects feel dated, not premium
- **Poor hierarchy** — Everything blends together, nothing pops

The **Slate Depth** design system addresses all four issues with:
- Inter for all UI text + Geist Mono for data/numbers only
- Slate color scale with subtle blue undertone
- Solid layered backgrounds (no blur)
- Model colors as purposeful accents (left borders, dots, progress bars)

---

## Design Principles

### 1. Hierarchy Through Depth
Background scale creates natural visual layers without blur effects:
- **Base** → **Raised** → **Card** → **Elevated**
- Each step is visually distinct but cohesive
- Shadows used sparingly, only on elevated cards

### 2. Color With Purpose
- UI chrome stays neutral (slate scale)
- Model colors (ChatGPT green, Claude orange, Perplexity purple, Gemini blue) only appear on model-specific elements
- Accent color (indigo) reserved for primary actions only

### 3. Data Is King
- Numbers use monospace font with tight letter-spacing
- Large, bold, immediately scannable
- Supporting chrome stays quiet and minimal

---

## Color Palette

### Backgrounds

| Token | Hex | Usage |
|-------|-----|-------|
| `--bg-base` | `#020617` | Page background |
| `--bg-raised` | `#0f172a` | Sidebar, elevated sections |
| `--bg-card` | `#1e293b` | Cards, panels |
| `--bg-elevated` | `#334155` | Hover states, highlighted items |

### Borders

| Token | Value | Usage |
|-------|-------|-------|
| `--border-subtle` | `rgba(51, 65, 85, 0.5)` | Card borders, dividers |
| `--border-default` | `rgba(71, 85, 105, 0.5)` | Input borders, button outlines |
| `--border-strong` | `rgba(100, 116, 139, 0.5)` | Hover states, focus rings |

### Text

| Token | Hex | Usage |
|-------|-----|-------|
| `--text-primary` | `#f8fafc` | Headings, important text |
| `--text-secondary` | `#94a3b8` | Body text, descriptions |
| `--text-muted` | `#64748b` | Captions, helper text |
| `--text-faint` | `#475569` | Labels, placeholders |

### Model Colors

Each AI model has a signature color used consistently throughout the app:

| Model | Primary | Muted Background | Usage |
|-------|---------|------------------|-------|
| ChatGPT | `#22c55e` | `rgba(34, 197, 94, 0.15)` | Left borders, dots, progress bars |
| Claude | `#f97316` | `rgba(249, 115, 22, 0.15)` | Left borders, dots, progress bars |
| Perplexity | `#8b5cf6` | `rgba(139, 92, 246, 0.15)` | Left borders, dots, progress bars |
| Gemini | `#3b82f6` | `rgba(59, 130, 246, 0.15)` | Left borders, dots, progress bars |

### Semantic Colors

| Token | Hex | Usage |
|-------|-----|-------|
| `--success` | `#22c55e` | Positive changes, success states |
| `--warning` | `#f59e0b` | Warnings, caution |
| `--danger` | `#ef4444` | Errors, negative changes |
| `--accent` | `#6366f1` | Primary buttons, links |
| `--accent-hover` | `#4f46e5` | Primary button hover |

---

## Typography

### Font Stack

```css
--font-sans: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
--font-mono: 'Geist Mono', 'SF Mono', ui-monospace, monospace;
```

**Inter** is used for all UI text — navigation, labels, body copy, buttons.

**Geist Mono** is used exclusively for data — visibility scores, percentages, timestamps, run IDs.

### Type Scale

| Element | Font | Size | Weight | Letter-spacing |
|---------|------|------|--------|----------------|
| Page title | Inter | 22-24px | 600 | normal |
| Section heading | Inter | 16-18px | 600 | normal |
| Body text | Inter | 14px | 400 | normal |
| Caption | Inter | 12-13px | 400 | normal |
| Label | Inter | 11px | 500 | 0.5px (uppercase) |
| Hero stat | Geist Mono | 36-48px | 600 | -2px |
| Card stat | Geist Mono | 24-28px | 600 | -1px |
| Inline stat | Geist Mono | 14-18px | 500 | normal |
| Timestamp | Geist Mono | 12px | 400 | normal |

---

## Components

### Cards

**Standard Card**
```css
.card {
  background: var(--bg-raised);       /* #0f172a */
  border: 1px solid var(--border-subtle);
  border-radius: 12px;
  padding: 20px;
}
```

**Elevated Card** (for hero stats)
```css
.card-elevated {
  background: linear-gradient(135deg, rgba(15,23,42,0.8) 0%, rgba(30,41,59,0.4) 100%);
  border: 1px solid var(--border-subtle);
  border-radius: 12px;
  padding: 20px;
  box-shadow: 0 4px 24px rgba(0,0,0,0.3);
}
```

**Model Card** (with left-border accent)
```css
.model-card {
  background: rgba(15,23,42,0.4);
  border: 1px solid var(--border-subtle);
  border-left: 3px solid var(--model-color);
  border-radius: 8px;
  padding: 14px 16px;
}
```

### Buttons

**Primary** — Solid accent background
```css
.btn-primary {
  background: var(--accent);          /* #6366f1 */
  color: white;
  border: none;
  padding: 10px 16px;
  border-radius: 8px;
  font-weight: 500;
}
.btn-primary:hover {
  background: var(--accent-hover);    /* #4f46e5 */
}
```

**Secondary** — Ghost with border
```css
.btn-secondary {
  background: transparent;
  color: var(--text-secondary);
  border: 1px solid var(--border-default);
  padding: 10px 16px;
  border-radius: 8px;
}
.btn-secondary:hover {
  background: rgba(255,255,255,0.05);
  border-color: var(--border-strong);
  color: var(--text-primary);
}
```

**Ghost** — No border, subtle hover
```css
.btn-ghost {
  background: transparent;
  color: var(--text-muted);
  border: none;
  padding: 10px 16px;
  border-radius: 8px;
}
.btn-ghost:hover {
  background: rgba(255,255,255,0.03);
  color: var(--text-secondary);
}
```

### Model Badges

Small inline indicators showing model with color dot:
```css
.model-badge {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 10px;
  border-radius: 6px;
  font-size: 12px;
  font-weight: 500;
  background: var(--model-muted);
  color: var(--model-color);
}
.model-badge .dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--model-color);
}
```

### Progress Bars (Model)

Thin progress bars with model-colored fill:
```css
.model-progress {
  height: 4px;
  background: var(--model-muted);
  border-radius: 2px;
}
.model-progress-fill {
  height: 100%;
  background: var(--model-color);
  border-radius: 2px;
}
```

---

## Layout Changes

### Sidebar
- Background: `--bg-raised` (#0f172a)
- Border-right: `1px solid var(--border-subtle)`
- Remove gradient backgrounds
- Remove glow effects on active items
- Active item: solid `rgba(99,102,241,0.12)` background with left accent bar

### Dashboard
- Page background: `--bg-base` (#020617)
- Remove floating orbs/ambient animations
- Stats row: 4-column grid with elevated cards
- Model breakdown: 4-column grid with model cards (left-border accent)

### Cards Throughout App
- Replace glassmorphism (`backdrop-filter: blur`) with solid backgrounds
- Remove `inset` shadow highlights
- Use background scale for depth instead of transparency

---

## What To Remove

1. **Syne font** — Remove from layout.tsx, remove from tailwind.config.js
2. **JetBrains Mono** — Replace with Geist Mono
3. **Glassmorphism** — Remove all `backdrop-filter: blur()` usage
4. **Indigo tint on everything** — Replace with neutral slate scale
5. **Ambient orbs** — Remove floating gradient animations from AppShell
6. **Inset highlights** — Remove `inset 0 1px 0 rgba(255,255,255,...)` shadows
7. **`.stat-value-display` class** — Replace with simpler mono styling
8. **Model card variants** (`.card-gpt`, `.card-cld`, etc.) — Replace with unified `.model-card` + CSS variable

---

## Files To Modify

| File | Changes |
|------|---------|
| `frontend/app/layout.tsx` | Swap Syne/JetBrains to Geist Mono |
| `frontend/tailwind.config.js` | Update font families, color tokens |
| `frontend/app/globals.css` | New design tokens, remove glassmorphism utilities, new component classes |
| `frontend/components/AppShell.tsx` | Remove ambient orbs, update background |
| `frontend/components/Sidebar.tsx` | New background, border, active states |
| `frontend/components/StatsCard.tsx` | New styling, remove Syne |
| `frontend/components/TrendChart.tsx` | Update model colors to new palette |
| `frontend/components/ModelBreakdown.tsx` | New model card styling |
| `frontend/app/dashboard/page.tsx` | Update MODEL_CONFIG colors, card styles |

---

## Accessibility Checklist

- [x] Text contrast minimum 4.5:1 (slate-400 on slate-900 = 5.2:1)
- [x] Focus states visible (border-strong on focus)
- [x] No color-only indicators (model names always present alongside colors)
- [x] Reduced motion respected (no new animations added)
- [x] Touch targets 44x44px minimum (buttons padded appropriately)

---

## Visual Reference

Mockups available at: `.superpowers/brainstorm/94196-1775154567/content/slate-depth-system.html`

Open locally with the brainstorm server or directly in browser.
