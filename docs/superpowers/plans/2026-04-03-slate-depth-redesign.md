# Slate Depth Design System — Full UI Redesign

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate the entire Lumidian frontend from its current mixed glassmorphism/gradient aesthetic to a clean, flat "Slate Depth" design system with strict CSS variable tokens, Inter + Geist Mono typography, and zero blur/glow effects.

**Architecture:** All color/typography/component tokens defined as CSS custom properties in globals.css, referenced via `var()` everywhere. Tailwind config extended with named tokens. No hardcoded hex in component files — always CSS variables.

**Tech Stack:** Next.js 15, React 18, Tailwind CSS, CSS Custom Properties

---

## File Map

### Phase 1 — Tokens, Fonts, Globals
- Modify: `frontend/app/layout.tsx` (body bg class)
- Modify: `frontend/tailwind.config.js` (color tokens, font families)
- Modify: `frontend/app/globals.css` (CSS variables, component classes, remove orb animations)

### Phase 2 — AppShell and Sidebar
- Modify: `frontend/components/AppShell.tsx` (MODEL_CONFIG colors, remove mobile blur)
- Modify: `frontend/components/Sidebar.tsx` (solid bg, border, active state)

### Phase 3 — Dashboard, Stats, Model Cards
- Modify: `frontend/app/dashboard/page.tsx` (MODEL_CONFIG colors, remove font-syne)
- Modify: `frontend/components/StatsCard.tsx` (verify card-elevated, mono font usage)
- Modify: `frontend/components/ModelBreakdown.tsx` (verify model-card usage, progress bar height)

### Phase 4 — Chart and Global Audit
- Modify: `frontend/components/TrendChart.tsx` (remove blur/inset, update container)
- Modify: `frontend/app/settings/page.tsx` (remove blur/inset/font-syne)
- Modify: `frontend/components/ErrorBoundary.tsx` (remove blur)
- Modify: `frontend/components/NotificationPanel.tsx` (remove blur)
- Modify: `frontend/components/SupportPanel.tsx` (remove blur)
- Modify: `frontend/app/login/page.tsx` (remove blur orbs)
- Modify: `frontend/app/register/page.tsx` (remove blur orbs)
- Modify: `frontend/app/verify-email/page.tsx` (remove blur orbs)
- Modify: `frontend/app/reset-password/page.tsx` (remove blur orbs)
- Modify: `frontend/app/forgot-password/page.tsx` (remove blur orbs)
- Modify: `frontend/app/settings/brands/new/page.tsx` (remove blur orbs)
- Modify: `frontend/app/dashboard/loading.tsx` (bg-white/5 → skeleton)
- Modify: `frontend/app/team/loading.tsx` (bg-white/5 → skeleton)
- Modify: `frontend/app/reports/loading.tsx` (bg-white/5 → skeleton)
- Modify: `frontend/app/tracker/loading.tsx` (bg-white/5 → skeleton)
- Modify: `frontend/app/tracker/[brandId]/loading.tsx` (bg-white/5 → skeleton)
- Modify: `frontend/app/results/[brandId]/loading.tsx` (bg-white/5 → skeleton)
- Modify: `frontend/app/content/loading.tsx` (bg-white/5 → skeleton)
- Modify: `frontend/app/account/loading.tsx` (bg-white/5 → skeleton)
- Modify: `frontend/app/settings/loading.tsx` (bg-white/5 → skeleton)

### Phase 5 — Final Report
- No file changes. Produce verification report.

---

## Task 1: Phase 1 — Tokens, Fonts, Globals

**Files:**
- Modify: `frontend/app/layout.tsx`
- Modify: `frontend/tailwind.config.js`
- Modify: `frontend/app/globals.css`

- [ ] **Step 1: Update layout.tsx body background**

Change `bg-[#0a0a0f]` to reference the design system base color `bg-[#020617]` (matches `--bg-base`).

- [ ] **Step 2: Update tailwind.config.js color tokens**

Replace old color map with new Slate Depth tokens:
```js
colors: {
  'bg-base': '#020617',
  'bg-raised': '#0f172a',
  'bg-card': '#1e293b',
  'bg-elevated': '#334155',
  'text-primary': '#f8fafc',
  'text-secondary': '#94a3b8',
  'text-muted': '#64748b',
  'text-faint': '#475569',
  'accent': '#6366f1',
  'accent-hover': '#4f46e5',
  'success': '#22c55e',
  'warning': '#f59e0b',
  'danger': '#ef4444',
  'chatgpt': '#22c55e',
  'claude': '#f97316',
  'perplexity': '#8b5cf6',
  'gemini': '#3b82f6',
}
```

- [ ] **Step 3: Clean globals.css — remove orb animations**

Delete `@keyframes orb-drift-1` through `orb-drift-4` and `.orb-1` through `.orb-4` classes. Delete the `prefers-reduced-motion` rule that references them.

- [ ] **Step 4: Verify globals.css tokens and component classes match spec exactly**

Confirm all CSS custom properties, `.card`, `.card-elevated`, `.model-card`, `.btn-*`, `.model-badge`, `.model-progress` classes exist and match the spec.

- [ ] **Step 5: Add missing component classes to globals.css**

Add `.model-badge` and `.model-progress` / `.model-progress-fill` if not present.

- [ ] **Step 6: Playwright Gate 1 — screenshot and verify**

Navigate to http://localhost:3002, take full-page screenshot, verify Inter loads, no blur/glassmorphism in computed styles, bg-base is #020617.

---

## Task 2: Phase 2 — AppShell and Sidebar

**Files:**
- Modify: `frontend/components/AppShell.tsx`
- Modify: `frontend/components/Sidebar.tsx`

- [ ] **Step 1: Update AppShell MODEL_CONFIG colors**

Replace old model colors with new CSS variable-referencing values:
- chatgpt: bg `rgba(34,197,94,0.15)`, text `#22c55e`
- claude: bg `rgba(249,115,22,0.15)`, text `#f97316`
- perplexity: bg `rgba(139,92,246,0.15)`, text `#8b5cf6`
- gemini: bg `rgba(59,130,246,0.15)`, text `#3b82f6`

- [ ] **Step 2: Remove backdrop-filter from AppShell mobile nav**

Replace `backdropFilter: 'blur(20px)'` with solid background `#080c14`.

- [ ] **Step 3: Overhaul Sidebar background**

Replace gradient + backdropFilter with solid `var(--bg-raised)` (#0f172a). Add `borderRight: '1px solid var(--border-subtle)'`.

- [ ] **Step 4: Fix Sidebar active nav indicator**

Replace gradient left bar with solid `background: '#6366f1'` (3px wide). Active item background stays `rgba(99,102,241,0.12)`.

- [ ] **Step 5: Remove all backdropFilter from Sidebar dropdown**

Replace dropdown background with solid `#0a0e18`. Remove all `backdropFilter` / `WebkitBackdropFilter`.

- [ ] **Step 6: Playwright Gate 2 — screenshot and verify**

Screenshot full app. Verify sidebar has solid dark background, clean border, no glow. Page background is near-black. Active nav item has visible left accent bar.

---

## Task 3: Phase 3 — Dashboard, Stats, Model Cards

**Files:**
- Modify: `frontend/app/dashboard/page.tsx`
- Modify: `frontend/components/StatsCard.tsx`
- Modify: `frontend/components/ModelBreakdown.tsx`

- [ ] **Step 1: Update dashboard MODEL_CONFIG**

Confirm colors match new palette (chatgpt #22c55e, claude #f97316, perplexity #8b5cf6, gemini #3b82f6). They already do in dashboard — verify bg values use 0.12 opacity.

- [ ] **Step 2: Remove font-syne from dashboard h1**

Remove `fontFamily: 'var(--font-syne)'` from the page title. Let it inherit Inter.

- [ ] **Step 3: Verify StatsCard uses design system classes**

Confirm `.card`, `.card-elevated`, `.stat-value`, `.stat-value-lg` are applied correctly. No hardcoded font families.

- [ ] **Step 4: Verify ModelBreakdown uses .model-card**

Confirm model-card class is used, left border driven by model color, progress bars are 4px height.

- [ ] **Step 5: Playwright Gate 3 — screenshot and verify**

Screenshot dashboard. Verify stat numbers are monospace/large, model cards have colored left borders, no glassmorphism.

---

## Task 4: Phase 4 — Chart and Global Audit

**Files:** TrendChart.tsx + every file with blur/inset/bg-white references

- [ ] **Step 1: Fix TrendChart container**

Replace `bg-[rgba(99,102,241,0.08)] backdrop-blur-md` with `.card` class. Remove `inset 0 1px 0` from box-shadow. Remove backdrop-filter from tooltip.

- [ ] **Step 2: Fix settings/page.tsx**

Remove `backdrop-blur-md`, `inset` shadows, `font-syne` reference.

- [ ] **Step 3: Global search-and-destroy — auth pages**

Remove blur orbs and backdrop-filter from: login, register, verify-email, reset-password, forgot-password.

- [ ] **Step 4: Fix remaining components**

Remove backdrop-filter from: ErrorBoundary, NotificationPanel, SupportPanel, settings/brands/new.

- [ ] **Step 5: Replace bg-white/5 in loading skeletons**

Replace all `bg-white/5` with `bg-[rgba(255,255,255,0.05)]` or a solid slate value across all loading.tsx files.

- [ ] **Step 6: Playwright Gate 4 — full app screenshot audit**

Screenshot dashboard, settings, content pages. Verify removal list is gone. Chart colors match. Typography consistent.

---

## Task 5: Phase 5 — Final Report

- [ ] **Step 1: Compile modification report**

List every file modified and what changed, confirm every removal list item, note all Playwright gates, list any deviations.
