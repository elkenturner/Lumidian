# Visual Polish & Layout Cleanup — Design

**Date:** 2026-06-18
**Status:** Approved (design phase)
**Author:** Ken + Claude
**Supersedes/extends:** `docs/superpowers/plans/2026-05-27-design-cleanup.md` (reframes the token/primitive work as plumbing that rides along, not standalone)

---

## Problem

The app does not look *broken* — the slate-blue dark theme is cohesive and intentional. But the **implementation is scattered**, and the result reads as "vibecoded" to the eye. Per Ken: the color tokens are not the issue (those refactors are invisible); the issue is **layout, composition, and look-and-feel** — how sections are arranged, spacing rhythm, visual hierarchy, alignment, and the small craft details that separate "an AI built this" from "a designer built this."

Evidence from a frontend audit (2026-06-18):
- ~28% of color decisions are hardcoded hex/rgba literals (1,400+ instances) instead of tokens.
- ~10 undocumented alpha shades of the accent (`rgba(95,126,166,X)`) scattered across 170+ files.
- Three parallel button systems: shadcn `<Button>`, legacy `.btn-*` CSS, raw inline `<button>`.
- Ad-hoc spacing, border-radius (cards mix `rounded-2xl`/`rounded-xl`), and shadows (inline `shadow-[...]` one-offs vs. `--shadow-*` tokens).
- Primitives (`Button`, `Card`, `Heading`, `Stat`, `EmptyState`) exist but adoption is incomplete; many pages still build cards from raw `className="bg-... border-..."`.

## Goal

Make the whole product feel **cleaner, more visually appealing, and clearly designed** — keeping the existing slate-blue dark aesthetic (no from-scratch redesign). Two qualities, equally weighted: **cleaner** (consistency) and **more appealing** (elevated layout/look-and-feel).

## Decisions (from brainstorming)

- **Scope:** Everything, consistently — marketing site *and* the logged-in product.
- **Ambition:** Polish + elevate — consistency pass *plus* targeted layout/composition upgrades. Not a visual redesign; the slate-blue direction stays.
- **Approach:** Surface-by-surface (highest-impact first), with a thin layout-language layer defined up front so the surfaces cohere instead of being five separately-prettied pages.
- **What "vibecoded" means here:** layout & composition, not color tokens. Token work is plumbing that rides along on the pages we touch — never an invisible standalone refactor.

---

## Part 1 — The Layout Language

The standard every surface is held to. These are concrete, enforced decisions.

### Page shell & rhythm
- **Container standard:** app pages `max-width: 1200px`; marketing/reading pages `max-width: 1100px`. Consistent responsive gutters. (Today widths vary per page — a major source of the "off" feeling.)
- **Vertical rhythm:** standardized section spacing — ~`96px` between major marketing sections, ~`32px` between app blocks — replacing ad-hoc per-page margins.
- **Spacing base:** 4px. **One card padding** (`24px`) as default. **One section-header pattern** everywhere: eyebrow → title → description.

### Surface craft
- **One radius scale, applied consistently:** cards `12px`, controls `8px`, pills `full`. (Today cards randomly mix `rounded-2xl`/`rounded-xl`.)
- **One shadow set:** the existing `--shadow-card` / `--shadow-card-hover` / `--shadow-elevated` tokens. Remove inline `shadow-[0_4px_24px...]` one-offs.
- **One border treatment:** via `--border-subtle` / `--border-default` / `--border-strong`.
- **Accent alpha ladder:** collapse the ~10 ad-hoc `rgba(95,126,166,X)` shades into a named scale (`--accent-06` … `--accent-30`). Tinting becomes a documented decision, not a guess.

### Hierarchy, states & motion
- **Type hierarchy:** every page uses the existing `<Heading>` / type scale — one H1, consistent section titles, deliberate body-copy sizing.
- **Interaction states:** defined for buttons/cards/inputs — hover, **focus-visible**, active, disabled, loading.
- **Motion:** consolidated into `lib/motion.ts`, used as restrained accent (fade-up on scroll, subtle hover lift) — never decoration. Respect `prefers-reduced-motion`.

### Consistency mechanics (plumbing that rides along)
- Token codemod (hardcoded literals → tokens) applied **only on the pages we are already editing**.
- Button-system consolidation: 3 systems → 1 (`<Button>`), as those buttons are touched.
- Primitive adoption (`Card`, `Heading`, `Stat`, `EmptyState`) on each surface as we pass through.

---

## Part 2 — Execution Order & Per-Surface Scope

Each surface gets a **layout + composition pass** held to Part 1, adopting tokens/primitives as we touch it. **Ken reviews each surface before moving to the next** (a review gate per surface).

1. **Landing / marketing** (`app/page.tsx`, pricing, comparison tables) — biggest first impression. Fix hero composition, section rhythm, pricing/comparison table craft.
2. **Dashboard** (`app/dashboard/`) — Ken's daily surface. Tighten stats grid, chart framing, card consistency, header.
3. **Content hub + cluster detail** (`app/content/[brandId]/`) — content-dense. Hierarchy, panel layout, source/citation panels.
4. **Auth / onboarding** (`login`, `register`, `onboarding`, password reset, verify) — first-run polish; centered-form craft, consistent framing.
5. **Settings / billing / account** — quiet consistency pass.

Order rationale: highest external-judgment surface first (landing), then highest internal-usage surface (dashboard), then the rest by visibility.

---

## Non-goals

- No new color palette / no rethink of the slate-blue direction.
- No backend changes. No new product features.
- No global big-bang refactor decoupled from a visible surface. Every token/primitive change must ride a page we are improving.
- No frontend test framework introduction (none exists today; see verification).

## Verification (per surface)

No frontend test suite exists, so visual evidence is the proof:
- `npm run build` passes (TypeScript strict).
- `npm run lint` clean.
- **Playwright before/after screenshots** of the surface (key viewports: desktop + mobile) captured so each page change has visual evidence it actually improved.
- Manual review gate by Ken before advancing to the next surface.

## Risks & mitigations

- **Scope is large.** Mitigated by surface-by-surface gates — value lands incrementally, and we can stop after any surface with a coherent result.
- **Regression risk from token codemod.** Mitigated by scoping codemod to the page under edit + build/lint/screenshot checks.
- **"Consistency drift" returns later.** Mitigated by writing the Layout Language (Part 1) into a short reference (tokens documented in `globals.css` + a brief design-language note) so future work has a standard to follow.

## Open questions

- None blocking. Container width exact values (1200/1100) and section-spacing values (96/32) are starting points; may tune during the landing-page pass with screenshots in hand.
