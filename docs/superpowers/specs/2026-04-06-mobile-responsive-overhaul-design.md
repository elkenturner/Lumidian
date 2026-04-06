# Mobile-Native Overhaul Design Spec

**Date:** 2026-04-06
**Scope:** Landing page, auth pages, dashboard, reports page
**Constraint:** All changes gated behind mobile breakpoints (< 768px / Tailwind `md:` prefix). Zero impact on desktop.

---

## 1. App Shell & Navigation

### Bottom Nav
- 5 tabs: Dashboard, Brands, Reports, Content, Settings
- Account accessible from Settings page (not a separate tab)
- Active tab: filled icon + accent color dot above label
- Height: 64px + `env(safe-area-inset-bottom)` for notched phones
- Brand switcher: Brands tab shows active brand name as subtitle

### Status Banners (report running, drafts generating, scanning)
- Condensed to single-line pill on mobile
- Tap to expand for full details
- Smaller text, tighter padding (px-3 py-1.5 instead of px-7 py-2)

### Safe Areas
- Bottom nav: `padding-bottom: env(safe-area-inset-bottom)`
- Top content: respect `safe-area-inset-top` on headerless pages

---

## 2. Landing Page

### Hero
- Stack headline/subtitle vertically, `text-3xl` (down from desktop large)
- CTA buttons: full-width stacked
- Demo mockup: scale down or hide on mobile to prioritize CTA
- Mobile menu overlay: full-screen, 48px+ row tap targets

### Feature Grid
- Single column (from 3-col desktop)
- Card padding: `p-4` (from `p-6`)

### How It Works
- Vertical stack with connecting line between step numbers

### Pricing/Comparison Table
- Horizontal scroll with sticky first column (feature labels)
- Active plan column gets subtle highlight

### FAQ
- Full-width accordion, 48px tap targets on question rows

### Social Proof / Stats Row
- 2x2 grid (from 4-col desktop)

### Footer
- Single-column stack, larger link tap targets

---

## 3. Auth Pages (Login, Register, Forgot/Reset Password, Verify Email)

### Layout
- Full-bleed centered card: remove horizontal margins for spacious feel
- Logo: centered, 24px (from 28px)

### Form Inputs
- Height: 48px on mobile (from ~36px)
- Font size: 16px (prevents iOS auto-zoom on focus)
- Field spacing: `gap-4` (from `gap-3.5`)

### Buttons
- Full-width, 48px minimum height
- Google OAuth button same height as primary submit

### 2FA Code Input
- Larger monospaced digits, centered, generous letter-spacing

### Links
- 44px minimum tap target via padding

---

## 4. Dashboard

### Header
- Brand avatar + name left, action buttons below as full-width row
- "Run Report Now": full-width
- Prompts + Refresh: side-by-side, 50% width each

### Quick Stats Row (currently `grid-cols-3`)
- Horizontally scrollable row with snap-scrolling
- Each card ~140px wide, swipeable
- Avoids cramming 3 cards into 375px

### Visibility Score Card
- Full-width
- Score text: `text-5xl` (from `text-6xl`)
- Live/Index sub-scores: compact stacking, remove 108px left padding on model names

### Right Column Cards (Best Prompt, Sentiment, SOV)
- Stack below visibility card, full-width (from 2-col side-by-side)

### Model Breakdown
- Full-width, no changes needed (bar layout works vertically)

### Trend Chart
- Full-width, larger touch targets on data points

### Prompt Groups
- Full-width cards
- Model badges: wrap naturally (already `flex-wrap`)
- Response transcripts: tap-to-expand truncation at 3 lines

### Pull-to-Refresh
- Pull gesture at top of dashboard triggers `loadData(selectedBrandId)`
- Subtle spinner animation, accent color

### Competitor Grid
- Single column (from `grid-cols-2`)

---

## 5. Reports Page

### Header
- Brand info left, actions stacked below full-width
- PDF download + refresh: full-width row

### Run Selector Dropdown
- 48px height, full-width

### Trend Chart
- Full-width, touch-friendly data points (same as dashboard)

### Prompt Group Cards
- Full-width single column
- Model stat grid inside cards: single column (from `grid-cols-2`)
- Response transcripts: truncated at 3 lines, tap to expand

### Response Table
- Keep horizontal scroll (`overflow-x-auto`)
- Add scroll hint: subtle gradient fade on right edge
- Row height: 48px for comfortable tapping

### Competitor Analysis
- Cards stack single column
- Bar charts: full-width (already work)

### Export Buttons
- Full-width stacked

---

## 6. Cross-Cutting Patterns

### Touch Targets
- All interactive elements: minimum 44px touch target
- Buttons: 48px height on mobile
- Links in nav/lists: 48px row height

### Gesture Interactions
- Pull-to-refresh on dashboard
- Snap-scroll on quick stats row
- Tap-to-expand on truncated transcripts and status banners

### Typography Scaling
- Reduce oversized headings (6xl -> 5xl, etc.) on mobile
- 16px minimum on form inputs (iOS zoom prevention)

### Card Padding
- `.card` class: reduce to `p-4` on mobile (from `p-5`/`p-6`) via Tailwind responsive

### Safe Area Insets
- Bottom nav: `env(safe-area-inset-bottom)`
- Viewport meta: `viewport-fit=cover` for edge-to-edge

### Breakpoint Strategy
- All mobile styles at `< 768px` (Tailwind default `md:` breakpoint)
- Use mobile-first additions, never override desktop styles
- `isMobile` state in AppShell already exists at `window.innerWidth < 768` — reuse this

### Desktop Safety
- Every CSS change gated behind `max-width: 767px` media query or mobile-first Tailwind (default classes are mobile, `md:` restores desktop)
- No changes to desktop-only code paths (`!isMobile` branches)
- No changes to Sidebar component (desktop-only)
