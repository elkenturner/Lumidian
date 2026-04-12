# Mobile UX Redesign — Design Spec

**Date:** 2026-04-12
**Approach:** Mobile Shell Redesign + Full Component Pass
**Target:** All phone sizes (iPhone + Android), broad compatibility, no tablet-specific breakpoint
**Philosophy:** Full features available but with clear hierarchy surfacing most-used actions. Mobile-first shell with per-component adaptations.

---

## 1. Mobile App Shell

### 1.1 Mobile Header (new)

Currently there is no header on mobile — page content starts at the top edge. Add a sticky top header:

- **Left:** Lumidian logo mark (24px)
- **Center:** Active brand name + avatar (tappable → opens brand switcher bottom sheet)
- **Right:** Notification bell (toggles existing `NotificationPanel` component, badge dot if unread) + user avatar (tap → navigates to /account)
- **Height:** 48px
- **Background:** Frosted glass — `rgba(8,12,20,0.97)` with `backdrop-filter: blur(24px)`, matching bottom nav
- **Border:** `1px solid rgba(255,255,255,0.08)` on bottom edge
- **Z-index:** 50 (same as bottom nav)
- Status banners (report running, drafts generating, scanning) render directly below this header

### 1.2 Brand Switcher (bottom sheet)

Tapping the brand name/avatar in the header opens a bottom sheet:

- Drag handle at top (32px wide, 4px tall, rounded, centered)
- Slides up from bottom with `--ease-drawer` spring animation (`cubic-bezier(0.32, 0.72, 0, 1)`)
- Backdrop overlay: `bg-black/60 backdrop-blur-sm` (same as dialog overlay)
- `max-height: 70vh`, internal scroll for brand list
- Each brand row: avatar (28px) + name + tier badge, 52px row height for comfortable tap targets
- "Add new brand" row at bottom with + icon
- Tapping a brand selects it and dismisses the sheet
- Swipe down on handle or tap backdrop to dismiss

### 1.3 Bottom Navigation (revised)

**Current:** Dashboard, Settings, Reports, Content, Account (5 tabs)
**New:** Dashboard, Reports, Content, Settings (4 tabs)

- Account access moves to header avatar — infrequently used, wastes primary nav slot
- 4 tabs gives each more room on narrow screens
- Active state: filled icon + accent color indicator bar on top + label with `font-weight: 600`
- Inactive: outline icon (`strokeWidth: 1.75`) + muted label
- `padding-bottom: env(safe-area-inset-bottom)` for iPhone home indicator
- Icon size: 20px, label: 10px (unchanged)
- Min touch target: 48px height per tab item

---

## 2. Dialogs → Bottom Sheets on Mobile

### 2.1 DialogContent Mobile Behavior

On mobile (`< 768px`), `DialogContent` renders as a bottom sheet instead of centered modal:

- Anchored to bottom of viewport instead of `top-1/2 left-1/2 -translate`
- `width: 100%`, horizontal margin: 8px each side
- `max-height: 85vh` with internal `overflow-y: auto`
- `border-radius: 16px 16px 0 0` (top corners only)
- Drag handle at top: 32px × 4px, `rgba(255,255,255,0.2)`, centered, `margin: 8px auto 4px`
- Swipe down to dismiss (track touch delta, dismiss when > 100px)
- Entry animation: `translateY(100%)` → `translateY(0)` with `--ease-drawer`
- Exit animation: `translateY(0)` → `translateY(100%)` with `--ease-out`
- Close button: 44px × 44px tap target (up from current ~24px)

On desktop (`≥ 768px`): no changes, existing centered modal behavior preserved.

### 2.2 DialogFooter Mobile Behavior

- Buttons stack vertically (`flex-direction: column`) instead of inline
- Full width each
- Primary action on top, cancel/secondary below
- Sticky at bottom of the sheet so always reachable (`position: sticky; bottom: 0`)
- Frosted glass background behind sticky footer

---

## 3. Dashboard Page Mobile Layout

### 3.1 Page Padding & Spacing

- Horizontal padding: `px-3` on mobile (down from `px-4`)
- Major section gaps: `mb-4` instead of `mb-6`

### 3.2 Dashboard Header

- Title: `text-lg` (down from `text-xl`)
- Subtitle "AI visibility analytics": hidden on mobile (header provides context)
- "Prompts" + "Refresh" buttons: side-by-side in a row
- "Run Report Now": full-width below the button row
- Cancel button (when run active): its own full-width row for easy tap

### 3.3 Visibility Score Card

- Score: `text-4xl` (down from `text-5xl`/`text-6xl`)
- Live/Index sub-scores: stack vertically instead of inline
- Sparkline chart: full width, maintained — high-value display

### 3.4 Stats Grid

- Keep existing horizontal snap-scroll
- Increase min card width from `160px` to `170px`

### 3.5 Model Breakdown

- Model cards: stack vertically (1 column) instead of 2×2 grid
- Each card maintains horizontal layout internally (icon left, stats right)

### 3.6 Brand Table (Recent Conversations)

- Model filter tabs: horizontally scrollable strip with `overflow-x: auto`, hidden scrollbar
- Conversation rows: model badge + mentioned badge stack below prompt text instead of inline right
- Expanded response text: full width, 14px font size

### 3.7 Citation Gaps / Best Prompt / Donut Charts

- Stack single-column (most already do via Tailwind grid)
- Donut chart: constrain `max-width` to prevent over-stretching

---

## 4. Content Hub Mobile Layout

### 4.1 Tab Bar

- On mobile: horizontal scroll with hidden scrollbar, `flex-shrink-0` per tab
- Active tab indicator animates between tabs

### 4.2 Platform Filter Pills

- Horizontally scrollable strip when they overflow
- Larger tap targets: `py-1.5` (up from `py-1`)

### 4.3 Draft Cards

- Platform badge + status: top row
- Content preview: more vertical space, comfortable line-height
- Action buttons (Approve, Edit, Copy, Delete): bottom row within card, evenly spaced, 44px min tap targets
- Edit/preview toggle: full-width segmented control
- Quality checklist: expands below card content, not floating

### 4.4 Opportunity Cards

- Thread title: `line-clamp-2`, comfortable text size
- Relevance score + platform badge: one row
- "Draft" and "Dismiss" buttons: full-width, stacked vertically

### 4.5 Primary Actions

- "Regenerate Drafts" / "New Draft": uses `position: sticky; bottom: 72px` (above bottom nav height) so the button pins to the viewport bottom when its natural position scrolls out of view
- Frosted glass background matching header/nav

### 4.6 Draft Editing Mode

- Textarea: `font-size: 16px` to prevent iOS zoom
- Save/Cancel buttons: sticky at bottom of editing view

---

## 5. Settings Page Mobile Layout

### 5.1 Tab Navigation

- Full-width segmented control (General / Profile / Team)
- Sticky below mobile header while scrolling long forms

### 5.2 General Tab

- All inputs: full-width, `font-size: 16px`
- Prompts list: full-width rows, delete button right-aligned, 44px tap target
- Add prompt: input full-width, add button below (stacked)
- Competitors: same treatment as prompts
- Scheduler toggle: larger touch target

### 5.3 Profile Tab

- All textareas: full-width, `font-size: 16px`, comfortable padding
- "AI Fill" button: full-width, clear loading state
- Publications tags: wrap naturally, larger remove tap targets
- "Refresh Website Context": full-width

### 5.4 Team Tab

- Member rows: avatar + name + role on one row, remove action via explicit button
- Invite form: email full-width, role selector below, invite button full-width below (3-row stack)

### 5.5 Sticky Save Button

- When form has unsaved changes: save button sticks to bottom of viewport (above bottom nav)
- Frosted glass background, full-width, prominent accent color

---

## 6. Reports Page Mobile Layout

### 6.1 Run History

- Table layout → card-based list on mobile
- Each card: date, overall score (large), status badge
- Model score pills wrap to second line
- Tap card to expand prompt-level detail

### 6.2 Prompt Groups (expanded)

- Prompt text: full width, comfortable size
- Model stats: vertical list (one row per model: icon + label + mentioned/total + percentage)
- Response text: full-width expandable accordion, 14px font

### 6.3 Trend Chart

- Full-width, maintained aspect ratio
- Touch: tap-and-hold shows tooltip (Recharts default behavior)
- Legend: wraps below chart instead of inline

### 6.4 Competitor Analysis

- Table → stacked card layout
- Each competitor: own card with name, mention rate, model breakdown as small horizontal bar

### 6.5 Export PDF

- Full-width button at top of page

---

## 7. Remaining Pages

### 7.1 Account Page

- User info: avatar + name + email stacked vertically, centered
- Billing status, subscription: full-width cards
- Action buttons (change password, logout, delete): full-width, stacked
- 2FA setup: clear step-by-step, large tap targets

### 7.2 Auth Pages (Login, Register, Forgot/Reset Password)

- Inputs: `font-size: 16px` to prevent iOS zoom
- Google OAuth button: full-width
- Submit buttons: full-width, 48px height
- Password visibility toggle: 44px tap target

### 7.3 Onboarding

- Step indicators: compact at top
- Form fields: full-width
- Prompt chips: wrap naturally, larger remove buttons
- Navigation (Back/Next): full-width, stacked, primary on top

### 7.4 Methodology Page

- Body text: 15-16px, line-height 1.6+
- TOC: collapsible sticky header instead of sidebar

---

## 8. Global CSS & Patterns

### 8.1 Shared Utilities

- `.mobile-scroll-tabs`: horizontal scroll strip with hidden scrollbar, used for filter tabs and tab bars consistently across all pages
- All interactive elements: `min-height: 44px` on mobile (Apple HIG)
- All text inputs: `font-size: 16px` on mobile (prevents Safari auto-zoom)
- `.card` padding: 16px on mobile (already exists, maintain)

### 8.2 Toast Positioning

- On mobile: render at top of screen (below header) instead of bottom
- Prevents overlap with bottom nav

### 8.3 Breakpoint Strategy

- Primary breakpoint: `768px` (matches existing `useIsMobile` hook and Tailwind `md:`)
- No tablet-specific breakpoint
- Prefer Tailwind responsive prefixes (`sm:`, `md:`) over JS-based `isMobile` where possible for SSR compatibility. Keep JS `useIsMobile` for cases requiring conditional rendering (e.g., bottom sheet vs centered dialog).

### 8.4 Animation

- Use existing CSS custom properties: `--ease-out`, `--ease-in-out`, `--ease-drawer`
- Bottom sheet entrance: `--ease-drawer` (cubic-bezier(0.32, 0.72, 0, 1))
- Respect `prefers-reduced-motion` — skip animations when set

---

## Files to Modify

| File | Changes |
|------|---------|
| `components/AppShell.tsx` | Add mobile header, revise bottom nav (4 tabs), add brand switcher bottom sheet |
| `components/ui/dialog.tsx` | Bottom sheet behavior on mobile, drag-to-dismiss, sticky footer |
| `app/globals.css` | `.mobile-scroll-tabs` utility, toast positioning, input zoom prevention, tap target sizing |
| `components/dashboard/DashboardHeader.tsx` | Mobile button layout, hide subtitle |
| `components/dashboard/VisibilityChart.tsx` | Responsive score sizing, vertical sub-score stacking |
| `components/dashboard/StatsGrid.tsx` | Adjust min card width |
| `components/dashboard/DashboardModelBreakdown.tsx` | Single-column stack on mobile |
| `components/dashboard/BrandTable.tsx` | Scrollable filter tabs, mobile row layout |
| `components/dashboard/CitationGaps.tsx` | Single-column mobile |
| `components/dashboard/DonutDomains.tsx` | Max-width constraint |
| `app/dashboard/page.tsx` | Mobile padding/spacing adjustments |
| `app/content/page.tsx` | Tab scroll, sticky action bar |
| `components/content/DraftsPanel.tsx` | Filter pill scroll, card layout adjustments |
| `components/content/cards/DraftCard.tsx` | Mobile action button layout, edit mode |
| `components/content/OpportunitiesPanel.tsx` | Stacked button layout |
| `app/settings/page.tsx` | Segmented tab control, form stacking, sticky save |
| `app/reports/page.tsx` | Card-based run list, vertical model stats |
| `app/account/page.tsx` | Stacked layout, button sizing |
| `app/login/page.tsx` | Input sizing, button sizing |
| `app/register/page.tsx` | Input sizing, button sizing |
| `app/onboarding/page.tsx` | Form stacking, button layout |
| `app/methodology/page.tsx` | Reading typography, collapsible TOC |
| `components/AppToast.tsx` | Top-positioned on mobile |
| `hooks/useIsMobile.ts` | No changes (keep as-is) |
