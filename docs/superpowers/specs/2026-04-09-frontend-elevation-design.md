# Frontend Elevation Design

**Date:** 2026-04-09
**Goal:** Elevate the Lumidian frontend to Linear/Railway caliber through accent color refinement, full motion design with Framer Motion, component polish following Emil Kowalski's design engineering principles, and Impeccable's anti-AI-slop rules.
**Approach:** Linear-Inspired Elevation (Approach B) — build on the existing solid foundation, don't rewrite.

---

## References & Design Principles

- **Visual references:** Linear, Railway — dark-first, ultra-clean, buttery animations, minimal chrome
- **Skill: Emil Design Engineering** — custom easing curves, animation decision framework, component feel, performance rules
- **Skill: Impeccable** — OKLCH colors, banned patterns (no side-stripe borders, no gradient text), origin-aware popovers, taste over defaults

---

## Section 1: Accent Color Swap + Color System

### Accent Colors (OKLCH)

| Token | Old Value | New Value (OKLCH) | Hex Approx |
|-------|-----------|-------------------|------------|
| `--accent` | `#6366f1` (indigo) | `oklch(0.746 0.16 293)` | `#a78bfa` (lavender) |
| `--accent-hover` | `#4f46e5` | `oklch(0.655 0.19 293)` | `#8b5cf6` |
| `--accent-light` | `#818cf8` | `oklch(0.84 0.1 293)` | `#c4b5fd` |

Gradient CTAs: `linear-gradient(135deg, oklch(0.58 0.22 293), oklch(0.746 0.16 293))`

Reduced chroma at high lightness for `--accent-light` per Impeccable's OKLCH principle.

### Neutral Backgrounds

Keep current background colors unchanged (`--bg-base`, `--bg-raised`, `--bg-card`, `--bg-elevated`). User preference: current dark slate backgrounds are fine as-is.

### Banned Patterns

- No gradient text (`background-clip: text` with gradients) anywhere. Solid colors only.
- No side-stripe borders > 1px on cards/list items/callouts (Impeccable absolute ban #1).

### Unchanged

Model colors (green/orange/purple/blue for ChatGPT/Claude/Perplexity/Gemini), semantic colors (success/warning/danger), background lightness levels, text color hierarchy.

---

## Section 2: Animation & Motion System

### Dependencies

Install `framer-motion`.

### Custom Easing Curves

```css
--ease-out: cubic-bezier(0.23, 1, 0.32, 1);
--ease-in-out: cubic-bezier(0.77, 0, 0.175, 1);
--ease-drawer: cubic-bezier(0.32, 0.72, 0, 1);
```

Never use `ease-in` (sluggish). Never use bounce/elastic (dated).

### Duration Guidelines

| Element | Duration | Easing |
|---------|----------|--------|
| Button press feedback | 100-160ms | ease-out |
| Tooltips, small popovers | 125-200ms | ease-out |
| Dropdowns, selects | 150-250ms | ease-out |
| Modals, dialogs | 200-400ms | spring (duration: 0.4, bounce: 0.15) |
| Tab content switch | 150-200ms | ease-out |
| Page content fade-in | 250-350ms | ease-out |
| Stagger between items | 30-50ms delay | — |
| Enters | 300-400ms | deliberate |
| Exits | 150-200ms | snappy |

### Animation Variants (`lib/motion.ts`)

- **fadeIn** — opacity 0→1, 300ms, custom ease-out
- **fadeInUp** — opacity 0→1 + translateY 8px→0, 350ms, custom ease-out
- **staggerContainer** — staggers children by 40ms
- **staggerChild** — fadeInUp variant, paired with container
- **scalePress** — `transform: scale(0.97)` on tap, 160ms ease-out
- **springModal** — scale 0.95→1 + opacity (never scale(0)), spring `{ duration: 0.4, bounce: 0.15 }`
- **slideIn** — translateX -12→0 + opacity, 200ms, custom ease-out
- **countUp** — animated number interpolation for stat values

### Where Animations Apply

| Element | Animation | Duration |
|---------|-----------|----------|
| Page content | fadeIn | 300ms |
| Stat cards | staggerContainer + child | 40ms stagger |
| Brand list items | staggerContainer + child | 40ms stagger |
| Table rows | stagger (CSS, not FM) | 30ms stagger |
| Modals/dialogs | springModal | spring 0.4s |
| All buttons | scalePress (CSS `:active`) | 160ms |
| Clickable cards | scalePress gentler (0.98) | 160ms |
| Tab content | slideIn | 200ms |
| Sidebar expand/collapse | width + opacity spring | spring 0.3s |
| Toasts | CSS transition slideIn | 400ms enter, 200ms exit |
| Stat numbers | countUp interpolation | 600ms |
| Loading → content | fadeIn crossfade | 250ms |
| Card hover | translateY(-1px) + shadow | 200ms, hover-gated |
| Dropdowns/popovers | scale(0.95)→1 + opacity, origin-aware | 200ms |

### Framer Motion Hardware Acceleration

Always use `animate={{ transform: "translateX(100px)" }}` not `animate={{ x: 100 }}`. Shorthand props use `requestAnimationFrame` on main thread and drop frames under load. Full `transform` strings run on GPU compositor.

### CSS vs JS Animation Decision

- Predetermined animations (stagger on mount, hover states) → CSS transitions (off main thread)
- Dynamic/interruptible animations (drag, spring, gesture) → Framer Motion
- Rapidly-triggered elements (toasts, toggles) → CSS transitions, never keyframes

### Touch & Accessibility

- Gate ALL hover animations behind `@media (hover: hover) and (pointer: fine)`
- `prefers-reduced-motion: reduce` — keep opacity/color transitions, remove transform-based motion
- Popovers: `transform-origin: var(--radix-popover-content-transform-origin)` (scale from trigger)
- Modals: keep `transform-origin: center` (not anchored to triggers)
- Tooltips: skip delay + skip animation on subsequent hovers after first is open

---

## Section 3: Component Polish & Banned Pattern Removal

### Model Card Left Borders (Banned → Replaced)

Current `.model-card-chatgpt`, `.model-card-claude` etc. use `border-left: 3px solid [color]`. This is Impeccable's absolute ban #1.

Replace with: subtle full-card background tint of the model color at 3-4% opacity. Examples:
- ChatGPT: `background: oklch(0.72 0.19 142 / 0.03)` (green tint)
- Claude: `background: oklch(0.72 0.19 55 / 0.03)` (orange tint)
- Perplexity: `background: oklch(0.65 0.19 293 / 0.03)` (purple tint)
- Gemini: `background: oklch(0.65 0.19 250 / 0.03)` (blue tint)

The model's existing colored icon/dot serves as the primary identifier. The background tint is supplementary, not the sole indicator.

### Button Refinements

- Add `transform: scale(0.97)` on `:active` to ALL interactive elements
- Use `transition: transform 160ms cubic-bezier(0.23, 1, 0.32, 1)` — never `transition: all`
- Always list exact transition properties

### Input Refinements

- Focus ring uses lavender: `box-shadow: 0 0 0 2px oklch(0.746 0.16 293 / 0.2)`
- Transition only `border-color, box-shadow`

### Card Refinements

- Remove any nested cards-in-cards patterns
- Hover: subtle `translateY(-1px)` + shadow lift, gated behind `@media (hover: hover) and (pointer: fine)`
- Use `gap` for spacing between cards instead of margins

### Popover/Dropdown Refinements

- `transform-origin` set to trigger location via Radix CSS variable
- Start from `scale(0.95); opacity: 0` — never `scale(0)`
- Duration 150-250ms with custom ease-out

### Global `transition: all` Audit

Find and replace every `transition: all` with specific property transitions throughout the codebase.

---

## Section 4: Component Refactoring

### Files to Decompose

| File | Current Size | Split Into |
|------|-------------|------------|
| `app/dashboard/page.tsx` | ~1580 lines | `DashboardHeader`, `StatsGrid`, `VisibilityChart`, `BrandTable`, `ModelBreakdown` — page becomes orchestrator |
| `components/content/ContentTabPanels.tsx` | ~87KB | `DraftsPanel`, `OpportunitiesPanel`, `GapsPanel`, `PostedPanel` — one component per tab |
| `components/AppShell.tsx` | Large | Extract `Sidebar`, `SidebarNav`, `BrandSwitcher`, `RunBanner` as standalone components |

### Decomposition Rules

- Each extracted component gets its own file in a logical directory
- Components own their own animation variants (e.g., `StatsGrid` owns its stagger config)
- No prop drilling more than 2 levels deep
- Each component independently understandable without reading its parent

### Not Refactoring

Pages already well-scoped: login, register, tracker, settings. Only files where size hurts readability.

---

## Section 5: Implementation Phasing

### Phase 1: Foundation

- Install Framer Motion
- Update CSS variables: accent color swap, OKLCH conversion, neutral tinting
- Add custom easing curves to `globals.css`
- Create `lib/motion.ts` with animation variants
- Add `prefers-reduced-motion` and hover media query utilities
- Remove banned patterns (model-card left borders → background tints)
- Add button `:active` scale feedback globally
- Audit and fix all `transition: all` instances

### Phase 2: Component Refactoring

- Decompose `dashboard/page.tsx` → extracted components
- Decompose `ContentTabPanels.tsx` → per-tab panels
- Extract `AppShell.tsx` → Sidebar, BrandSwitcher, RunBanner
- Verify no regressions after each decomposition

### Phase 3: Core Animation

- Page content fadeIn on mount
- Stagger animations on lists, stat cards, table rows
- Modal/dialog spring animations (origin-aware for popovers, centered for modals)
- Tab content slide transitions
- Toast enter/exit transitions (CSS transitions)
- Dropdown/popover origin-aware scale animations
- Stat number countUp
- Tooltip skip-delay on subsequent hovers

### Phase 4: Polish Pass (page by page)

- Dashboard: card hover lifts, chart animate-on-load
- Tracker: brand list stagger, run status animations
- Content: draft card interactions, tab transitions
- Results: response table stagger, model breakdown animations
- Sidebar: expand/collapse spring, nav link transitions
- Fix any remaining cramped areas or color inconsistencies

Each phase is independently shippable — the app improves after each one.
