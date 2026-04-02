# Lumidian UI Revamp — Prism Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Revamp the core app visual layer to the "Prism" design system — Syne display font, JetBrains Mono data font, per-model spectrum card colors, elevated glassmorphism cards with inset top-highlight, ghost-indigo primary button, glowing trend chart, and refined sidebar.

**Architecture:** Pure frontend CSS/styling changes only. No API calls, routing, or logic changes. Every task is self-contained and leaves the app in a working state. The design system is built bottom-up: tokens → layout shell → shared components → pages.

**Tech Stack:** Next.js 15, Tailwind CSS, `next/font/google`, Recharts, inline styles + CSS utility classes in `globals.css`

**Spec:** `docs/superpowers/specs/2026-04-01-ui-revamp-prism-design.md`

---

## File Map

| File | Change type |
|------|------------|
| `frontend/app/layout.tsx` | Add Syne + JetBrains Mono fonts; remove Fira Code |
| `frontend/tailwind.config.js` | Add `font-display` and `font-mono` entries |
| `frontend/app/globals.css` | Token update, new card-model utilities, btn-primary glass, `.stat-value-display` |
| `frontend/components/AppShell.tsx` | Base bg color + orb opacity tweaks |
| `frontend/components/Sidebar.tsx` | Gradient bg, border tint, active glow, user section card, notification badge |
| `frontend/components/StatsCard.tsx` | Syne gradient value, inset top-highlight shadow, teal variant |
| `frontend/components/TrendChart.tsx` | Model colors → Prism spec, font var, gradient opacity ↑, grid color |
| `frontend/components/ModelBreakdown.tsx` | Model colors → Prism spec, card bg + border updated |
| `frontend/app/dashboard/page.tsx` | Recent-runs strip, brand name Syne, MODEL_CONFIG colors |
| `frontend/app/settings/page.tsx` | Brand name Syne, elevated card wrappers |
| `frontend/app/content/[brandId]/page.tsx` | Active tab pill style, draft card elevation |

---

## Task 1: Font stack

**Files:**
- Modify: `frontend/app/layout.tsx`
- Modify: `frontend/tailwind.config.js`

- [ ] **Step 1.1 — Swap fonts in layout.tsx**

Replace the existing font imports and html className. The full new import block:

```tsx
import { Inter, Syne, JetBrains_Mono } from 'next/font/google';

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-inter',
  display: 'swap',
});

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

Update the `<html>` tag:
```tsx
<html lang="en" className={`${inter.variable} ${syne.variable} ${jetbrainsMono.variable}`}>
```

- [ ] **Step 1.2 — Update Tailwind font families**

In `frontend/tailwind.config.js`, replace the `fontFamily` block:

```js
fontFamily: {
  sans:    ['var(--font-inter)', '-apple-system', 'BlinkMacSystemFont', '"Segoe UI"', 'sans-serif'],
  display: ['var(--font-syne)', 'sans-serif'],
  mono:    ['var(--font-jetbrains)', 'ui-monospace', 'monospace'],
},
```

- [ ] **Step 1.3 — Update font references in globals.css**

In `frontend/app/globals.css`, find the body `font-family` line and make sure it references `var(--font-inter)` (it already does — confirm no `--font-fira-code` references remain in globals.css).

Also grep for any remaining `fira-code` variable references app-wide and note them for Task 6:
```bash
cd frontend && grep -r "fira-code" --include="*.tsx" --include="*.ts" -l
```

- [ ] **Step 1.4 — Lint check**

```bash
cd frontend && npm run lint
```
Expected: 0 errors. If Next.js complains about `Fira_Code` being unused, remove its import entirely from layout.tsx.

- [ ] **Step 1.5 — Visual check**

Start dev server (`npm run dev`) and open `/dashboard`. The "NovaMed" brand name and visibility score numbers should render in Syne (wider, more geometric letterforms). Body text stays Inter.

- [ ] **Step 1.6 — Commit**

```bash
git add frontend/app/layout.tsx frontend/tailwind.config.js
git commit -m "feat: swap to Syne + JetBrains Mono font stack"
```

---

## Task 2: Design tokens + card utilities

**Files:**
- Modify: `frontend/app/globals.css`

- [ ] **Step 2.1 — Update base CSS variables**

In the `:root` block under `/* ── Design tokens ─────── */`, replace the existing token values with:

```css
:root {
  --bg-base:      #030509;
  --bg-raised:    #060a15;
  --bg-card:      rgba(99,102,241,0.08);
  --bg-elevated:  rgba(99,102,241,0.11);
  --bg-highest:   rgba(99,102,241,0.15);

  --border-card:    rgba(99,102,241,0.20);
  --border-default: rgba(99,102,241,0.20);
  --border-muted:   rgba(99,102,241,0.12);
  --border-accent:  rgba(99,102,241,0.32);

  --text-primary:   #eef2ff;
  --text-secondary: #94a3b8;
  --text-muted:     #475569;
  --text-faint:     #2d3a55;

  --accent:       #6366f1;
  --accent-hover: #4f46e5;
  --accent-muted: rgba(99,102,241,0.15);

  --teal:         #14b8a6;
  --teal-hi:      #2dd4bf;

  --radius-sm: 8px;
  --radius-md: 10px;
  --radius-lg: 12px;
  --radius-xl: 16px;

  --font-syne:      var(--font-syne);
  --font-jetbrains: var(--font-jetbrains);
}
```

Also update `body` background to match:
```css
body {
  background-color: var(--bg-base);
  ...
}
```

- [ ] **Step 2.2 — Update `.card` elevation with inset top-highlight**

Replace the existing `.card` rule:

```css
.card {
  background: rgba(99,102,241,0.08);
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
  border: 1px solid rgba(99,102,241,0.20);
  border-radius: var(--radius-lg);
  padding: 20px;
  box-shadow: 0 4px 24px rgba(0,0,0,0.30), inset 0 1px 0 rgba(255,255,255,0.055);
}
.card-hover:hover {
  background: rgba(99,102,241,0.11);
  border-color: rgba(99,102,241,0.32);
  box-shadow: 0 8px 32px rgba(0,0,0,0.40), inset 0 1px 0 rgba(255,255,255,0.08);
}
```

- [ ] **Step 2.3 — Add model-card utility classes**

Append after the `.card-inset` rule:

```css
/* ── Model-spectrum card variants ──────────────────────────────────────────── */
.card-gpt,
.card-cld,
.card-ppl,
.card-gem {
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
  border-radius: var(--radius-lg);
  padding: 16px 18px;
  position: relative;
  overflow: hidden;
}
.card-gpt { background: rgba(16,163,127,0.08); border: 1px solid rgba(16,163,127,0.20); box-shadow: 0 4px 20px rgba(0,0,0,0.30), inset 0 1px 0 rgba(255,255,255,0.05); }
.card-cld { background: rgba(217,119,87,0.08);  border: 1px solid rgba(217,119,87,0.20);  box-shadow: 0 4px 20px rgba(0,0,0,0.30), inset 0 1px 0 rgba(255,255,255,0.05); }
.card-ppl { background: rgba(99,102,241,0.09);  border: 1px solid rgba(99,102,241,0.22);  box-shadow: 0 4px 20px rgba(0,0,0,0.30), inset 0 1px 0 rgba(255,255,255,0.05); }
.card-gem { background: rgba(66,133,244,0.08);  border: 1px solid rgba(66,133,244,0.20);  box-shadow: 0 4px 20px rgba(0,0,0,0.30), inset 0 1px 0 rgba(255,255,255,0.05); }

/* Top gradient line per model */
.card-gpt::before { content:''; position:absolute; top:0; left:0; right:0; height:1px; background:linear-gradient(90deg,transparent,rgba(16,163,127,0.55),transparent); }
.card-cld::before { content:''; position:absolute; top:0; left:0; right:0; height:1px; background:linear-gradient(90deg,transparent,rgba(217,119,87,0.55),transparent); }
.card-ppl::before { content:''; position:absolute; top:0; left:0; right:0; height:1px; background:linear-gradient(90deg,transparent,rgba(129,140,248,0.60),transparent); }
.card-gem::before { content:''; position:absolute; top:0; left:0; right:0; height:1px; background:linear-gradient(90deg,transparent,rgba(66,133,244,0.55),transparent); }
```

- [ ] **Step 2.4 — Add `.stat-value-display` utility**

```css
/* ── Stat value display (Syne gradient) ────────────────────────────────────── */
.stat-value-display {
  font-family: var(--font-syne), sans-serif;
  font-weight: 800;
  letter-spacing: -0.5px;
  line-height: 1;
  background: linear-gradient(135deg, #dde4ff 0%, #a5b4fc 45%, #818cf8 100%);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
}
.stat-value-display.teal {
  background: none;
  -webkit-background-clip: unset;
  -webkit-text-fill-color: unset;
  background-clip: unset;
  color: #2dd4bf;
}
```

- [ ] **Step 2.5 — Change `.btn-primary` to ghost-indigo**

Replace the `.btn-primary` and `.btn-primary:hover` rules:

```css
.btn-primary {
  background: rgba(99,102,241,0.15);
  color: #a5b4fc;
  border-color: rgba(99,102,241,0.30);
}
.btn-primary:hover:not(:disabled) {
  background: rgba(99,102,241,0.22);
  border-color: rgba(99,102,241,0.45);
  box-shadow: 0 0 24px rgba(99,102,241,0.18), inset 0 1px 0 rgba(255,255,255,0.07);
  color: #c7d2fe;
}
```

- [ ] **Step 2.6 — Lint + visual check**

```bash
cd frontend && npm run lint
```

Open `/dashboard`. Cards should have a very subtle visible top-highlight at the top edge. "Run Now" buttons throughout the app will now be glass-indigo (not solid purple) — check this looks intentional.

- [ ] **Step 2.7 — Commit**

```bash
git add frontend/app/globals.css
git commit -m "feat: Prism design tokens, model card utilities, ghost-indigo btn-primary"
```

---

## Task 3: AppShell base

**Files:**
- Modify: `frontend/components/AppShell.tsx`

- [ ] **Step 3.1 — Update base background + orb colors**

Find the fixed dark base div (line ~72) and update:
```tsx
<div style={{ position: 'fixed', inset: 0, background: '#030509', zIndex: -2 }} />
```

Find the four orb divs and update their `background` values:

Orb 1 (top-left, class `orb-1`): `rgba(55,48,163,0.18)` 
Orb 2 (right-center, class `orb-2`): `rgba(99,102,241,0.10)`
Orb 3 (bottom, class `orb-3`): `rgba(13,148,136,0.10)`
Orb 4 (top-right, class `orb-4`): keep as-is

The four style objects to update (find by their `position:absolute` + orb class):
```tsx
// Orb 1
background: 'radial-gradient(circle, rgba(55,48,163,0.18) 0%, transparent 65%)',

// Orb 2
background: 'radial-gradient(circle, rgba(99,102,241,0.10) 0%, transparent 65%)',

// Orb 3
background: 'radial-gradient(circle, rgba(13,148,136,0.10) 0%, transparent 65%)',
```

- [ ] **Step 3.2 — Lint + visual check**

```bash
cd frontend && npm run lint
```

Background should be a touch darker/more navy. Orbs barely visible — atmospheric, not distracting.

- [ ] **Step 3.3 — Commit**

```bash
git add frontend/components/AppShell.tsx
git commit -m "feat: AppShell base color and orb refinements"
```

---

## Task 4: Sidebar

**Files:**
- Modify: `frontend/components/Sidebar.tsx`

- [ ] **Step 4.1 — Update sidebar background + border**

Find the `<aside>` inline style (around line 200) and update `background` and `borderRight`:

```tsx
background: 'linear-gradient(180deg, rgba(6,10,22,0.92) 0%, rgba(4,6,14,0.96) 100%)',
backdropFilter: 'blur(20px)',
WebkitBackdropFilter: 'blur(20px)',
borderRight: '1px solid rgba(99,102,241,0.10)',
```

- [ ] **Step 4.2 — Add glow to active nav item**

In the `NavLink` component, find the active `style` object (around line 68) and add a glow to the box-shadow:

```tsx
style={isActive ? {
  background: 'rgba(99,102,241,0.15)',
  backdropFilter: 'blur(8px)',
  WebkitBackdropFilter: 'blur(8px)',
  boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.08), 0 0 18px rgba(99,102,241,0.12)',
} : undefined}
```

- [ ] **Step 4.3 — Wrap user section in card**

Find the user section `<div>` (line ~460, the one with `borderTop: '1px solid rgba(255,255,255,0.06)'`). Inside the expanded view, wrap the avatar + name + email row in a light card:

```tsx
<div
  className="flex items-center gap-2.5 px-3 py-2.5 rounded-xl"
  style={{
    background: 'rgba(99,102,241,0.06)',
    border: '1px solid rgba(99,102,241,0.12)',
  }}
>
  {/* existing avatar + name + email + logout content */}
</div>
```

Remove the old `rounded-xl` className from the existing inner div if present.

- [ ] **Step 4.4 — Update notification badge color**

Find the unread count `<span>` (around line 449):
```tsx
<span
  className="absolute -top-1 -right-1 w-3.5 h-3.5 rounded-full flex items-center justify-center text-[8px] font-bold text-white leading-none"
  style={{ background: 'rgba(99,102,241,0.9)', boxShadow: '0 0 8px rgba(99,102,241,0.5)' }}
>
```

- [ ] **Step 4.5 — Lint + visual check**

```bash
cd frontend && npm run lint
```

Open app and hover-expand the sidebar. Active nav item should have a very subtle glow. User section at the bottom should sit in a faint indigo-tinted card. Notification badge is indigo (not red).

- [ ] **Step 4.6 — Commit**

```bash
git add frontend/components/Sidebar.tsx
git commit -m "feat: Sidebar gradient bg, active glow, user card, indigo notification badge"
```

---

## Task 5: StatsCard

**Files:**
- Modify: `frontend/components/StatsCard.tsx`

- [ ] **Step 5.1 — Update card background and shadow**

In the main `return` JSX (around line 86), update the wrapper div's className:

```tsx
<div
  className="bg-[rgba(99,102,241,0.08)] backdrop-blur-md border border-[rgba(99,102,241,0.20)] rounded-xl p-5 hover:border-[rgba(99,102,241,0.32)] hover:bg-[rgba(99,102,241,0.11)] transition-all duration-200"
  style={{
    boxShadow: '0 4px 24px rgba(0,0,0,0.30), inset 0 1px 0 rgba(255,255,255,0.055)',
    ...(borderTopStyle ?? {}),
  }}
>
```

Remove the old `shadow-[0_4px_24px_rgba(0,0,0,0.20)]` Tailwind class since we're using the inline style.

- [ ] **Step 5.2 — Switch numeric value to Syne gradient**

Find the numeric value `<p>` (around line 93). Replace:

```tsx
<p className={clsx(
  compact
    ? 'mt-2 text-lg font-semibold leading-snug'
    : 'mt-2 text-3xl leading-none',
  isNumeric
    ? 'stat-value-display'
    : 'text-[#F0F4F8] font-bold'
)}>
  {isNumeric ? animatedValue : value}
</p>
```

The `.stat-value-display` class (added in Task 2) handles Syne + gradient. For non-numeric values (strings), it stays white.

- [ ] **Step 5.3 — Add glow to icon container**

Find the icon `<div>` (around line 126):

```tsx
<div className="ml-4 w-10 h-10 rounded-xl bg-[rgba(99,102,241,0.10)] border border-[rgba(99,102,241,0.22)] flex items-center justify-center text-[#818CF8] flex-shrink-0"
  style={{ boxShadow: '0 0 12px rgba(99,102,241,0.12)' }}
>
```

- [ ] **Step 5.4 — Handle teal variant via accentColor prop**

The `accentColor` prop already exists. Ensure the teal case renders the teal gradient value. Find where `borderTopStyle` is computed and also apply a teal class to the numeric value when `accentColor` equals `#2dd4bf` or `#14b8a6`:

```tsx
const isTeal = accentColor === '#2dd4bf' || accentColor === '#14b8a6' || accentColor === var('--teal');
```

Then in the `<p>` for the value:
```tsx
isNumeric
  ? clsx('stat-value-display', isTeal && 'teal')
  : 'text-[#F0F4F8] font-bold'
```

**Simpler approach** — just check if trendDirection is set; don't add new logic. The `accentColor` prop drives the top border; that's enough. Leave the gradient on all numeric values as indigo — the teal distinction is in the border top, not the value color.

- [ ] **Step 5.5 — Update loading skeleton shadow**

In the loading state div (around line 71), add the same inset highlight:
```tsx
<div className="bg-[rgba(99,102,241,0.06)] backdrop-blur-md border border-[rgba(99,102,241,0.20)] rounded-xl p-5"
  style={{ boxShadow: '0 4px 24px rgba(0,0,0,0.20), inset 0 1px 0 rgba(255,255,255,0.04)' }}
>
```

- [ ] **Step 5.6 — Lint + visual check**

```bash
cd frontend && npm run lint
```

Dashboard stat cards: numbers should render in Syne with the indigo-to-lilac gradient. Cards should have a subtle top-edge highlight (easiest to see if you look closely at the card border's top edge).

- [ ] **Step 5.7 — Commit**

```bash
git add frontend/components/StatsCard.tsx
git commit -m "feat: StatsCard Syne gradient value, inset top-highlight, icon glow"
```

---

## Task 6: TrendChart

**Files:**
- Modify: `frontend/components/TrendChart.tsx`

- [ ] **Step 6.1 — Update MODEL_LINES colors to Prism spec**

Replace the `MODEL_LINES` constant (lines 31–35):

```tsx
const MODEL_LINES: { key: string; label: string; color: string }[] = [
  { key: 'chatgpt',    label: 'ChatGPT',    color: '#10a37f' },
  { key: 'claude',     label: 'Claude',     color: '#d97757' },
  { key: 'perplexity', label: 'Perplexity', color: '#818cf8' },
  { key: 'gemini',     label: 'Gemini',     color: '#4285f4' },
];
const AVG_COLOR = '#818cf8';
```

- [ ] **Step 6.2 — Update area gradient fill opacity**

In the `<defs>` block (around line 216), update `avgAreaGradient`:

```tsx
<linearGradient id="avgAreaGradient" x1="0" y1="0" x2="0" y2="1">
  <stop offset="5%"  stopColor="#818cf8" stopOpacity={0.28} />
  <stop offset="95%" stopColor="#818cf8" stopOpacity={0} />
</linearGradient>
```

- [ ] **Step 6.3 — Update CartesianGrid to indigo-tinted**

Find the `<CartesianGrid>` component (around line 222):

```tsx
<CartesianGrid strokeDasharray="3 3" stroke="rgba(99,102,241,0.07)" vertical={false} />
```

- [ ] **Step 6.4 — Update font reference in tooltip and single-point display**

In `CustomTooltip` (line ~79) and the single-point display (line ~206), replace `var(--font-fira-code, monospace)` with `var(--font-jetbrains, monospace)`.

In CustomTooltip around line 79:
```tsx
fontFamily: 'var(--font-jetbrains, monospace)',
```

In the single-point large score display around line 206:
```tsx
<p className="text-3xl font-bold text-[#818cf8]" style={{ fontFamily: 'var(--font-jetbrains, monospace)' }}>
```

- [ ] **Step 6.5 — Update card wrapper styling**

Both the empty-state wrapper (line ~147) and the main chart wrapper (line ~161) use the same old inline className. Update both to:

```tsx
className="bg-[rgba(99,102,241,0.08)] backdrop-blur-md border border-[rgba(99,102,241,0.20)] rounded-xl p-6"
style={{ boxShadow: '0 4px 24px rgba(0,0,0,0.30), inset 0 1px 0 rgba(255,255,255,0.055)' }}
```

- [ ] **Step 6.6 — Update active dot for average line**

Find the `activeDot` on the `<Area>` component (around line 251):
```tsx
activeDot={{ fill: '#818cf8', r: 5, strokeWidth: 2, stroke: 'rgba(129,140,248,0.30)' }}
```

- [ ] **Step 6.7 — Lint + visual check**

```bash
cd frontend && npm run lint
```

Navigate to `/dashboard` with data. The trend chart legend should show ChatGPT in green, Claude in orange, Perplexity in indigo, Gemini in blue. The average area fill should be slightly more visible. Grid lines more indigo-tinted.

- [ ] **Step 6.8 — Commit**

```bash
git add frontend/components/TrendChart.tsx
git commit -m "feat: TrendChart Prism model colors, gradient opacity, indigo grid, JetBrains font"
```

---

## Task 7: ModelBreakdown component

**Files:**
- Modify: `frontend/components/ModelBreakdown.tsx`

- [ ] **Step 7.1 — Update MODEL_CONFIG colors**

Replace the `MODEL_CONFIG` constant (lines 9–37):

```tsx
const MODEL_CONFIG: Record<
  string,
  { label: string; color: string; bgColor: string; letter: string }
> = {
  chatgpt: {
    label: 'ChatGPT',
    color: '#34d399',
    bgColor: 'rgba(16,163,127,0.15)',
    letter: 'G',
  },
  claude: {
    label: 'Claude',
    color: '#fb923c',
    bgColor: 'rgba(217,119,87,0.15)',
    letter: 'C',
  },
  perplexity: {
    label: 'Perplexity',
    color: '#a5b4fc',
    bgColor: 'rgba(99,102,241,0.18)',
    letter: 'P',
  },
  gemini: {
    label: 'Gemini',
    color: '#60a5fa',
    bgColor: 'rgba(66,133,244,0.15)',
    letter: 'G',
  },
};
```

- [ ] **Step 7.2 — Update card wrapper to Prism elevation**

Both card wrappers (empty state ~line 59 and main ~line 75) use an old className. Update to:

```tsx
className="bg-[rgba(99,102,241,0.08)] backdrop-blur-md border border-[rgba(99,102,241,0.20)] rounded-xl p-6"
style={{ boxShadow: '0 4px 24px rgba(0,0,0,0.30), inset 0 1px 0 rgba(255,255,255,0.055)' }}
```

- [ ] **Step 7.3 — Update progress bar track**

Find `h-2 bg-[rgba(99,102,241,0.10)]` (around line 126) and change to:

```tsx
className="h-2 bg-[rgba(255,255,255,0.06)] rounded-full overflow-hidden"
```

- [ ] **Step 7.4 — Lint + visual check**

```bash
cd frontend && npm run lint
```

On the dashboard Performance by Model section, ChatGPT bar should be green, Claude orange, Perplexity lavender, Gemini blue. Letter avatars should use the new tinted backgrounds.

- [ ] **Step 7.5 — Commit**

```bash
git add frontend/components/ModelBreakdown.tsx
git commit -m "feat: ModelBreakdown Prism model colors and elevation"
```

---

## Task 8: Dashboard page

**Files:**
- Modify: `frontend/app/dashboard/page.tsx`

- [ ] **Step 8.1 — Update MODEL_CONFIG (used for live run-in-progress display)**

Find the `MODEL_CONFIG` object around line 103:

```tsx
const MODEL_CONFIG: Record<string, { label: string; bg: string; text: string }> = {
  chatgpt:    { label: 'ChatGPT',    bg: 'rgba(16,163,127,0.12)',  text: '#34d399' },
  claude:     { label: 'Claude',     bg: 'rgba(217,119,87,0.12)',   text: '#fb923c' },
  perplexity: { label: 'Perplexity', bg: 'rgba(99,102,241,0.12)',   text: '#a5b4fc' },
  gemini:     { label: 'Gemini',     bg: 'rgba(66,133,244,0.12)',   text: '#60a5fa' },
};
```

- [ ] **Step 8.2 — Update brand name to Syne font**

Search the dashboard JSX for where the brand name is rendered in the page header (look for `brandDetail?.name` or similar text rendering the brand name in a heading). Update its style to use Syne:

```tsx
style={{ fontFamily: 'var(--font-syne)', fontWeight: 800, letterSpacing: '-0.3px' }}
```

The exact line will be somewhere around the brand header section rendering `brandDetail?.name`.

- [ ] **Step 8.3 — Add recent runs strip**

Find the brand header / top of the dashboard page content area. Before the main brand header div, add the recent runs strip. Find the `recentRuns` (or `trends`) data already loaded and insert:

```tsx
{/* Recent runs strip */}
{trends.length > 0 && (
  <div className="flex items-center gap-2 mb-5 flex-wrap">
    <span className="text-[10px] font-semibold text-[#2d3a55] uppercase tracking-[0.08em] mr-1">
      Recent Runs
    </span>
    {[...trends].reverse().slice(0, 4).map((t, i) => (
      <div
        key={t.id ?? i}
        className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[10px] font-semibold"
        style={i === 0
          ? { background: 'rgba(16,185,129,0.07)', border: '1px solid rgba(16,185,129,0.18)', color: '#34d399' }
          : { background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)', color: '#475569' }
        }
      >
        <span
          className="w-1.5 h-1.5 rounded-full flex-shrink-0"
          style={{ background: i === 0 ? '#34d399' : 'rgba(255,255,255,0.2)' }}
        />
        {t.completed_at
          ? format(parseUTCISO(t.completed_at), 'MMM d')
          : 'Running'
        } · {Math.round(t.score)}
      </div>
    ))}
  </div>
)}
```

`trends` is already in scope in the dashboard component and contains `TrendPoint[]` with `completed_at` and `score`. `format` and `parseUTCISO` are already imported.

- [ ] **Step 8.4 — Lint + visual check**

```bash
cd frontend && npm run lint
```

Dashboard should show a strip of recent run chips above the brand header. Brand name in Syne. Model chips in the "report in progress" section should use the new colors.

- [ ] **Step 8.5 — Commit**

```bash
git add frontend/app/dashboard/page.tsx
git commit -m "feat: Dashboard Prism — Syne brand name, recent runs strip, model config colors"
```

---

## Task 9: Settings page brand section

**Files:**
- Modify: `frontend/app/settings/page.tsx`

- [ ] **Step 9.1 — Update brand name heading to Syne**

In the settings page JSX, find where the current brand name is displayed as a heading (likely a large `<h1>` or `<h2>` with the brand name). Add Syne styling:

```tsx
style={{ fontFamily: 'var(--font-syne)', fontWeight: 800, letterSpacing: '-0.3px', color: '#eef2ff' }}
```

- [ ] **Step 9.2 — Elevate section card wrappers**

The settings page uses many `rounded-xl` card divs. Find the main section cards (the ones wrapping General, Brand Profile, Prompts, Competitors sections) and update their className from the old pattern:

Old pattern: `className="bg-[rgba(99,102,241,0.06)] ... border border-[rgba(99,102,241,0.22)] rounded-xl ..."`

New pattern for each: add the inset top-highlight inline style:
```tsx
style={{ boxShadow: '0 4px 24px rgba(0,0,0,0.30), inset 0 1px 0 rgba(255,255,255,0.055)' }}
```

And update background to `rgba(99,102,241,0.08)` and border to `rgba(99,102,241,0.20)`.

Since settings/page.tsx is long (~1000+ lines), grep for the repeating card pattern:
```bash
grep -n 'bg-\[rgba(99,102,241,0.06)\]' frontend/app/settings/page.tsx
```
Update each occurrence to use `bg-[rgba(99,102,241,0.08)]` and add the box-shadow inline style to its parent.

- [ ] **Step 9.3 — Lint + visual check**

```bash
cd frontend && npm run lint
```

Navigate to `/settings`. Brand name heading should be in Syne. Section cards should have the subtle top-highlight depth effect.

- [ ] **Step 9.4 — Commit**

```bash
git add frontend/app/settings/page.tsx
git commit -m "feat: Settings page Syne brand name, elevated card wrappers"
```

---

## Task 10: Content Hub

**Files:**
- Modify: `frontend/app/content/[brandId]/page.tsx`
- Modify: `frontend/app/content/page.tsx` (if it contains its own tab bar)

- [ ] **Step 10.1 — Update active tab indicator to pill style**

In the content page(s), find the tab navigation (likely using the `Tabs`/`TabsList`/`TabsTrigger` components from `@/components/ui/tabs`). Update the active tab trigger to use the Prism pill style:

```tsx
<TabsTrigger
  value={value}
  className="px-3 py-1.5 rounded-lg text-xs font-semibold h-auto border-b-0
    data-[state=active]:bg-[rgba(99,102,241,0.18)]
    data-[state=active]:text-[#a5b4fc]
    data-[state=active]:border
    data-[state=active]:border-[rgba(99,102,241,0.30)]
    data-[state=active]:shadow-[0_0_14px_rgba(99,102,241,0.14)]
    data-[state=inactive]:text-[#475569]
    data-[state=inactive]:bg-transparent"
>
```

- [ ] **Step 10.2 — Update draft card styling**

In `ContentDraftCard.tsx` (at `frontend/components/ContentDraftCard.tsx`), or wherever draft cards are rendered inline, update the outer card wrapper to use the Prism elevation:

Find the root card div and update:
- Background: `rgba(99,102,241,0.08)`
- Border: `rgba(99,102,241,0.20)`
- Add `boxShadow: '0 4px 24px rgba(0,0,0,0.30), inset 0 1px 0 rgba(255,255,255,0.055)'`

- [ ] **Step 10.3 — Update gap severity colors**

Search the content page for where content gaps are rendered. Find severity indicators and ensure:
- High severity: `color: #f87171`, with a `box-shadow: 0 0 5px rgba(248,113,113,0.4)` on the dot
- Medium severity: `color: #fbbf24`

These are likely rendered as small colored dots or badges. Update their fill/color values accordingly.

- [ ] **Step 10.4 — Lint + visual check**

```bash
cd frontend && npm run lint
```

Navigate to `/content/[a-brand-id]`. Active tab should show as an indigo pill (not just an underline). Draft cards should have the elevated glass look. Gap severity dots should glow red/amber.

- [ ] **Step 10.5 — Commit**

```bash
git add frontend/app/content/ frontend/components/ContentDraftCard.tsx
git commit -m "feat: Content Hub tab pill, draft card elevation, gap severity colors"
```

---

## Final verification

- [ ] Run `npm run lint` with 0 errors
- [ ] Run `npm run build` — confirms no TypeScript errors in production build
- [ ] Visual walkthrough: Dashboard → Settings → Content Hub → check sidebar on all pages
- [ ] Confirm Syne renders on: brand names, stat card values
- [ ] Confirm JetBrains Mono renders on: TrendChart tooltip values, single-point score display
- [ ] Confirm model colors (ChatGPT green / Claude orange / Perplexity indigo / Gemini blue) appear in: TrendChart legend, ModelBreakdown bars, MODEL_CONFIG badges on in-progress run
- [ ] Confirm `.btn-primary` throughout app is glass-indigo (check Run Now, Generate Draft buttons)
- [ ] Confirm sidebar active state has the glow bar + soft glow background
- [ ] Confirm ambient orbs are visible but not distracting
