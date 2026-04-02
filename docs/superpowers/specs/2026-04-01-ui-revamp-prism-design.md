# Lumidian UI Revamp — Prism Design Spec

**Date:** 2026-04-01  
**Scope:** Core experience — design system globals, Sidebar/AppShell, Dashboard, Tracker (`/tracker/[brandId]`), Content Hub (`/content`, `/content/[brandId]`), Brands/Settings page  
**Direction:** Prism — evolved dark base with AI-model spectrum colors, ambient depth, Syne display typography, glowing data accents  

---

## 1. Design Principles

- **Precision depth** — four clear elevation levels; every surface knows where it sits
- **Spectrum identity** — each AI model radiates its own brand color throughout data viz, not just labels
- **Signal over decoration** — glows and gradients exist only on data-bearing elements; chrome stays dark and quiet
- **Restraint at scale** — ambient orbs and gradient fills are subtle; the data is the hero

---

## 2. Color System

### Base surfaces
| Token | Value | Usage |
|-------|-------|-------|
| `--base` | `#030509` | Body background |
| `--surface` | `#060a15` | Sidebar, modal backdrops |
| `--raised` | `rgba(99,102,241,0.08)` | Default card fill |
| `--floating` | `rgba(99,102,241,0.12)` | Elevated / active cards |
| `--border` | `rgba(99,102,241,0.20)` | Default card border |
| `--border-hi` | `rgba(99,102,241,0.32)` | Hover / focus borders |
| `--border-sub` | `rgba(255,255,255,0.06)` | Sidebar dividers, subtle rules |

### Accent — Primary (indigo)
| Token | Value |
|-------|-------|
| `--indigo` | `#6366f1` |
| `--indigo-hi` | `#818cf8` |
| `--indigo-soft` | `#a5b4fc` |
| `--indigo-lo` | `rgba(99,102,241,0.15)` |

### Accent — Secondary (teal)
Used for positive deltas, growth metrics, secondary chart series.
| Token | Value |
|-------|-------|
| `--teal` | `#14b8a6` |
| `--teal-hi` | `#2dd4bf` |

### Model spectrum colors
These are the exact brand colors of the four AI models. Used on model cards, chart legends, progress bars, and dot indicators.
| Model | Primary | Highlight | Tinted card bg | Tinted card border |
|-------|---------|-----------|---------------|-------------------|
| ChatGPT | `#10a37f` | `#34d399` | `rgba(16,163,127,0.08)` | `rgba(16,163,127,0.20)` |
| Claude | `#d97757` | `#fb923c` | `rgba(217,119,87,0.08)` | `rgba(217,119,87,0.20)` |
| Perplexity | `#6366f1` | `#a5b4fc` | `rgba(99,102,241,0.09)` | `rgba(99,102,241,0.22)` |
| Gemini | `#4285f4` | `#60a5fa` | `rgba(66,133,244,0.08)` | `rgba(66,133,244,0.20)` |

### Semantic
| Purpose | Value |
|---------|-------|
| Up trend / positive | `#34d399` |
| Down trend / alert | `#f87171` |
| Warning / attention | `#fbbf24` |
| Neutral | `#475569` |

### Text scale
| Token | Value | Usage |
|-------|-------|-------|
| `--text-1` | `#eef2ff` | Primary headings |
| `--text-2` | `#94a3b8` | Body, labels |
| `--text-3` | `#475569` | Secondary labels |
| `--text-4` | `#2d3a55` | Faint hints, dividers |

---

## 3. Typography

Replace Inter-only system with a three-font stack:

| Role | Font | Weight | Usage |
|------|------|--------|-------|
| Display | **Syne** | 700, 800 | Hero scores, brand names, large headings, page titles |
| UI | **Inter** | 400, 500, 600, 700 | All labels, nav items, body text, descriptions (unchanged) |
| Mono | **JetBrains Mono** | 500, 600, 700 | Metric values, query counts, percentages, data readouts |

**Load via `next/font/google`** in `layout.tsx` — add Syne and swap Fira Code for JetBrains Mono. Expose as CSS variables `--font-syne` and `--font-jetbrains`.

### Type scale changes
- Page/section hero numbers: `font-family: var(--font-syne); font-size: 34–42px; font-weight: 800`
- Brand names in headers: `font-family: var(--font-syne); font-size: 20–24px; font-weight: 800`
- Sidebar wordmark: `font-family: var(--font-syne); font-size: 15px; font-weight: 800` with gradient text
- Data metric readouts (model scores, run counts): `font-family: var(--font-jetbrains)`
- All other UI text: `font-family: var(--font-inter)` — no change

---

## 4. Elevation & Shadow System

Four levels. Every component should pick one; mixing levels within a single card is not allowed.

| Level | Background | Border | Shadow | Usage |
|-------|-----------|--------|--------|-------|
| **Base** | `--base` | none | none | Page body |
| **Surface** | `--surface` | `--border-sub` | none | Sidebar, modals |
| **Raised** | `--raised` | `--border` | `0 4px 24px rgba(0,0,0,0.30), inset 0 1px 0 rgba(255,255,255,0.055)` | Default cards, stat cards |
| **Floating** | `--floating` | `--border-hi` | `0 8px 32px rgba(0,0,0,0.40), inset 0 1px 0 rgba(255,255,255,0.08)` | Hover cards, dropdowns, tooltips |

The `inset 0 1px 0 rgba(255,255,255,...)` top-highlight simulates a light source from above — critical to the depth feel.

---

## 5. Core Components

### 5.1 globals.css changes

- Update `--bg-base` to `#030509`
- Add `--font-syne` and `--font-jetbrains` CSS variables
- Update `.card` to use new elevation tokens with inset top-highlight
- Add `.card-model-gpt`, `.card-model-cld`, `.card-model-ppl`, `.card-model-gem` utilities (tinted bg + tinted border for each model)
- Add `.stat-value-display` — Syne 800, gradient text (indigo direction), for hero numbers
- Add `.glow-line` — used on chart SVG polylines (filter: blur + overlay)
- Update ambient orb colors and positions in AppShell (unchanged from current but refine opacity)

### 5.2 Sidebar (`components/Sidebar.tsx`)

**Changes:**
- Background: `linear-gradient(180deg, rgba(6,10,22,0.92), rgba(4,6,14,0.96))` with `backdrop-filter: blur(20px)` — no change to blur, warmer gradient
- Border: `rgba(99,102,241,0.10)` (currently `rgba(255,255,255,0.08)`) — slightly indigo-tinted
- **Logo area**: Show Lumidian wordmark in Syne with gradient text when expanded (currently already done; keep, ensure Syne is used)
- **Active nav item**: Add `box-shadow: 0 0 16px rgba(99,102,241,0.08)` glow behind the active pill; left indicator bar stays with existing gradient
- **Brand switcher button**: Round corners to `border-radius: 9px`; active state uses `rgba(99,102,241,0.14)` bg
- **User section**: Wrap in a small card (`rgba(99,102,241,0.06)` bg, indigo border) — makes it feel contained
- **Notification badge**: Change from red to indigo pill `rgba(99,102,241,0.2)` bg, `#818cf8` text

No layout/behavior changes — hover-expand and 64→240px behavior stays exactly as-is.

### 5.3 AppShell (`components/AppShell.tsx`)

**Changes:**
- Base background: `#030509` (currently `#080C14`)
- Orb positions stay; refine orb colors:
  - Orb 1 (top-left): `rgba(55,48,163,0.15)` → keep, slight increase to `0.18`
  - Orb 2 (right-center): `rgba(124,58,237,0.10)` → shift to `rgba(99,102,241,0.10)`
  - Orb 3 (bottom): `rgba(13,148,136,0.08)` → keep teal, bump to `0.10`
  - Orb 4 (top-right): `rgba(55,48,163,0.09)` → keep
- Status banners: no change

### 5.4 StatsCard (`components/StatsCard.tsx`)

**Changes:**
- Background: `rgba(99,102,241,0.07)` (up from `0.06`)
- Border: `rgba(99,102,241,0.20)` (aligns with `--border` token)
- Add `inset 0 1px 0 rgba(255,255,255,0.055)` to box-shadow
- Numeric value: switch to `font-family: var(--font-syne)` for the large count-up number; apply gradient `from #dde4ff to #818cf8`
- Icon container: `border-radius: 10px` (up from current), slight glow `box-shadow: 0 0 12px rgba(99,102,241,0.12)`
- Add `accentColor` prop support for teal variant (secondary stat cards)

### 5.5 TrendChart (`components/TrendChart.tsx`)

**Changes:**
- Chart line: add SVG `filter` for subtle glow (feGaussianBlur stdDeviation 2.5, merged back with source)
- Gradient fill under line: increase opacity from current to `0.28` at top, `0` at bottom
- Add endpoint pulse dot — `<circle>` with outer ring at `opacity: 0.2`
- Grid lines: change from `rgba(255,255,255,...)` to `rgba(99,102,241,0.07)` for indigo-tinted grid
- Add second dashed series (teal) for mention count when available

### 5.6 Buttons (globals.css `.btn-*`)

- `.btn-primary`: Change from solid fill to ghost-indigo — `background: rgba(99,102,241,0.15)`, `color: #a5b4fc`, `border: 1px solid rgba(99,102,241,0.30)`. Hover: `box-shadow: 0 0 24px rgba(99,102,241,0.18)`. **This is a significant personality change** — moves away from the flat solid button toward the premium glass style seen in the mockup.
- `.btn-secondary`: Unchanged
- `.btn-ghost`: Unchanged
- `.btn-destructive`: Unchanged

### 5.7 Model-colored card utility (new)

Add four new CSS utility classes to globals.css:

```css
.card-gpt { background: rgba(16,163,127,0.08); border-color: rgba(16,163,127,0.20); }
.card-cld { background: rgba(217,119,87,0.08);  border-color: rgba(217,119,87,0.20);  }
.card-ppl { background: rgba(99,102,241,0.09);  border-color: rgba(99,102,241,0.22);  }
.card-gem { background: rgba(66,133,244,0.08);  border-color: rgba(66,133,244,0.20);  }
```

Each gets a `::before` pseudo-element top-highlight gradient in the model's color:
```css
.card-gpt::before { background: linear-gradient(90deg, transparent, rgba(16,163,127,0.5), transparent); }
```

---

## 6. Page-Level Changes

### 6.1 Dashboard (`app/dashboard/page.tsx`)

- **Recent runs strip**: Add a horizontal row of small chips above the brand header showing the last 4 runs with their score. Currently not present.
- **Brand header**: Brand name switches to Syne 800; add live dot (teal, glowing) beside last-run timestamp
- **Stats row**: Grid `1.4fr 1fr 1fr 1fr` — hero score card slightly wider. Apply Syne gradient text to score value. Teal variant for delta card.
- **Model breakdown section**: Replace the existing `ModelBreakdown` component usage with the new per-model colored cards (`card-gpt`, etc.). Each card shows: score, queries, sentiment badge, progress bar.
- **Competitor section**: Apply new card styles; competitor bars use gradient fills; "You" row highlighted with indigo tint
- **Content gaps section**: Severity dot colors — high = red glow, medium = amber glow

### 6.2 Tracker brand page (`app/tracker/[brandId]/page.tsx`)

- Apply Syne to the brand name header
- Prompt cards: use `.card` with new elevation; active prompts get `--border-hi` border
- Run status: use model colors on per-model result breakdown
- Score history: apply TrendChart glow updates

### 6.3 Content Hub (`app/content/page.tsx`, `app/content/[brandId]/page.tsx`)

- Tab bar: active tab indicator switches from flat underline to an indigo-glow pill
- Draft cards (`ContentDraftCard`): apply elevated card style with inset highlight; platform badge colors refined
- Opportunity cards: model-agnostic, use standard raised card style
- Gap cards: severity-colored left border instead of dot

### 6.4 Brands/Settings (`app/settings/page.tsx`)

- Brand cards: apply new card elevation; brand avatar container uses model-agnostic indigo tint
- "Add Brand" CTA: apply ghost-indigo button style

---

## 7. What Is NOT Changing

- All routing, data fetching, API calls — untouched
- Auth pages (`/login`, `/register`, `/onboarding`, etc.) — out of scope
- Legal pages (`/terms`, `/privacy`) — out of scope  
- Account, billing, team pages — out of scope
- Mobile bottom navigation — layout unchanged; only colors updated passively via globals
- Backend — no changes at all
- Component logic/props — all behavioral props stay the same; only visual output changes
- Accessibility — focus rings, aria labels, keyboard navigation unchanged

---

## 8. Font Loading (layout.tsx)

Replace Fira Code with JetBrains Mono; add Syne:

```tsx
import { Inter, Syne, JetBrains_Mono } from 'next/font/google';

const syne = Syne({
  subsets: ['latin'],
  variable: '--font-syne',
  weight: ['700', '800'],
  display: 'swap',
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ['latin'],
  variable: '--font-jetbrains',
  weight: ['500', '600', '700'],
  display: 'swap',
});
```

Add both variables to the `<html>` className. Update Tailwind config to expose `font-display: var(--font-syne)` and `font-mono: var(--font-jetbrains)`.

---

## 9. Implementation Order

1. **globals.css** — token updates, new card utilities, button style change, font variables
2. **layout.tsx** — font loading swap
3. **tailwind.config.js** — add Syne and JetBrains to font families
4. **AppShell.tsx** — base color + orb refinements
5. **Sidebar.tsx** — gradient, active state glow, user section card, notification badge
6. **StatsCard.tsx** — Syne value, inset highlight, teal variant, icon glow
7. **TrendChart.tsx** — glow filter, endpoint dot, indigo grid, teal series
8. **Dashboard page** — recent runs strip, model cards, header update, competitor/gap section
9. **Tracker brand page** — Syne header, model color cards, chart
10. **Content Hub pages** — tab pill, draft card style, gap severity borders
11. **Brands/Settings page** — brand card elevation, CTA button

---

## 10. Success Criteria

- The dashboard loads and the Syne font renders correctly for scores and brand names
- Each AI model card on the dashboard is visually distinct by color
- The trend chart line has a visible glow and gradient fill
- The sidebar active state has a left glow bar and soft background
- Cards have a visible top-highlight (inset light source effect)
- The ambient orb background is visible but does not compete with content
- Primary "Run Now" button is ghost-indigo (not solid fill)
- No existing functionality is broken
- All existing tests pass
