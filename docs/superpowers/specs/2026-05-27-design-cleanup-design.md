# Design cleanup — token purify, primitive lift, four-surface deep clean + signature moments

**Status:** Draft for review
**Date:** 2026-05-27
**Author:** Claude Code (brainstorming session with Ken)
**Branch (proposed):** `feat/design-cleanup`

---

## Why

Lumidian's frontend has accumulated three classes of inconsistency that read as "vibe coded":

1. **Token slippage.** 1,434 hardcoded color literals coexist with 3,764 design-token usages (~28% out-of-system). A palette change today requires hunting through 1,000+ lines per surface.
2. **Monolithic page files leaking primitives.** Five files exceed 1,000 lines (settings: 1,926; landing: 1,146; AppShell: 1,064; dashboard: 1,025; Sidebar: 456). Landing reinvents `useInView` / `useCountUp` / `FadeUp` / `ScaleIn` despite identical primitives in `lib/motion.ts`. Dashboard hand-rolls three empty states despite `.empty-state` existing as a utility. Two button systems compete (`.btn-*` CSS utilities vs shadcn `<Button>`).
3. **Animation accumulation.** Eight CSS keyframes (four `orb-drift` variants, `ctaOrb`, `glow-pulse` + duplicate `glowPulse`, `drawLine`, `slideInLeft/Right`, `diamond-pulse-glow`, `shimmer`, `fadeUp`, `scaleIn`) plus framer-motion plus per-surface inline transitions. They don't conflict — they don't compose either.

What's not broken (preserve):
- Slate background scale + slate-blue OKLCH accent + four model colors + three Emil easings (already in `globals.css`).
- Recent work — `/site-audit` Fix Factory redesign (2026-05-12), content tab collapse (2026-05-26), cluster detail, `/wiki` — already disciplined.
- `lib/motion.ts` as the home for motion primitives.
- `components/dashboard/` as the extraction pattern.

User direction: keep the existing visual language, add character + polish, no swap to Linear/Resend/Notion. The cleanup is pruning + tightening + five intentional signature moments — not redirection.

---

## Out of scope

- Light mode (dark-only stays).
- A11y deep audit (fix what we touch; broader audit is a separate exercise).
- Mobile redesign (preserve existing responsiveness).
- Performance optimization beyond not regressing.
- Copy / microcopy review.
- Surfaces: agency cockpit, agency client portal, `/wiki`, `/site-audit`, `/content` + cluster detail, `/reports`, `/team`, `/admin`, `/account`. Auth screens get token sweep only (no redesign).

---

## Architecture

Two PRs, sequenced. Each independently mergeable. Each verifiable.

```
PR1: chore(design): token purify + primitive lift
  └─ Foundation. No visual identity change. ~−1,000 lines of cruft.

PR2: feat(design): surface deep-clean + signature moments
  └─ Consumes PR1 substrate. Four surfaces refactored + five signature moments.
```

---

## PR1 — Token purify + primitive lift

### Tokens added to `globals.css`

| Token | Value | Replaces |
|-------|-------|----------|
| `--bg-tinted` | `rgba(255,255,255,0.06)` | 50+ inline occurrences |
| `--bg-tinted-hover` | `rgba(255,255,255,0.10)` | inline hover state |
| `--border-faint` | `rgba(255,255,255,0.08)` | inline button border |
| `--text-on-accent` | `white` | hardcoded `text-white` on accent bg |
| `--shadow-card` | `0 2px 8px rgba(0,0,0,0.15), inset 0 1px 0 rgba(255,255,255,0.03)` | inline shadow on `.card` |
| `--shadow-card-hover` | `0 4px 16px rgba(0,0,0,0.25), inset 0 1px 0 rgba(255,255,255,0.04)` | inline shadow on `.card-hover` |
| `--shadow-elevated` | `0 4px 24px rgba(0,0,0,0.3), inset 0 1px 0 rgba(255,255,255,0.04)` | inline shadow on `.card-elevated` |
| `--gradient-signature` | `linear-gradient(135deg, oklch(0.58 0.06 235), oklch(0.50 0.08 235), transparent)` | inconsistent gradient usage across hero/empty/CTA |

### Typography scale (new tokens + new `<Heading>` component)

```css
--text-display:  3rem    /* 48px, Syne, -2px tracking — hero only */
--text-h1:       2rem    /* 32px, Syne, -1px tracking — page titles */
--text-h2:       1.5rem  /* 24px, Syne, -0.5px tracking — section titles */
--text-h3:       1.125rem /* 18px, Inter 600 — card titles */
--text-body:     0.875rem /* 14px, Inter 400 — body text */
--text-caption:  0.75rem  /* 12px, Inter 500 — labels */
```

`--text-mono-{lg,md,sm}` for Geist Mono stat values — already conceptually exists as `.stat-value-{lg,sm}`; this names them as tokens.

### Tokens removed

Dead keyframes removed from `globals.css`:
- `slideInLeft`, `slideInRight` — no consumers.
- `drawLine` — referenced once, unused.
- Duplicate `glow-pulse` (second declaration; first stays).
- `orb-drift-2`, `orb-drift-3`, `orb-drift-4` — keep `orb-drift-1`, vary delay/duration at consumer sites.

### Utility classes

Added: `.bg-tinted`, `.bg-tinted-hover`.
Removed: `.btn`, `.btn-primary`, `.btn-secondary`, `.btn-ghost`, `.btn-destructive` — replaced by shadcn `<Button>` component.

### New UI primitives in `components/ui/`

| Component | API | Replaces |
|-----------|-----|----------|
| `<EmptyState icon body title action />` | Standardized empty state with optional CTA | 9+ hand-rolled empty states (dashboard×3, content×2, results, site-audit, etc.) |
| `<Card padding="sm\|md\|lg" tone="default\|elevated\|tinted">` | Card wrapper with consistent padding tokens | 12+ inline `bg-... border ... rounded-2xl p-N` patterns |
| `<Heading level={1\|2\|3\|display} as?>` | Typography component using new tokens | Every `style={{ fontFamily: 'var(--font-syne)' }}` on a heading (~30 in landing alone) |
| `<Stat value size="lg\|md\|sm" label? trend? />` | Stat number + optional label + optional delta indicator | Every inline stat rendering (visibility score, sentiment, position, etc.) |

`<Button>` already exists (shadcn) — keep, codemod `.btn-*` usages to it.

### `lib/motion.ts` exports (new + formalized)

```typescript
export function useInView(threshold?: number, rootMargin?: string): { ref, inView }
export function useCountUp(target: number, duration?: number): string  // already exported
export const FadeUp: React.FC<{ delay?, children }>     // wraps fadeInUp variant
export const ScaleIn: React.FC<{ delay?, children }>    // wraps springModal variant
```

All respect `prefers-reduced-motion`.

After PR1: `app/page.tsx`'s local copies deleted (~150 lines), all surfaces consume from `lib/motion.ts`.

### Migration order (PR1)

1. **Inventory:** `grep -rEo "#[0-9a-fA-F]{6}|rgba?\([^)]+\)" app/ components/ > docs/design-cleanup/hardcoded-colors.txt`. Triage into:
   - **(a) Slate scale** → token-replace via codemod.
   - **(b) Model colors / brand hexes** → keep (some are referenced as hex in style objects).
   - **(c) Intentional one-offs** → keep with `/* one-off: <reason> */` comment.
2. **Add tokens** to `globals.css` (above tables).
3. **Codemod bucket-a colors.** `sed` with a fixed mapping file (~12 patterns). Spot-check 5 random surfaces visually.
4. **Add UI primitives** (`EmptyState`, `Card`, `Heading`, `Stat`) to `components/ui/`. Smoke test each.
5. **Consolidate motion primitives.** Add to `lib/motion.ts`. Delete landing's local copies, update imports. Verify landing animations still work.
6. **Unify buttons.** Codemod `className="btn btn-*"` → `<Button variant="...">`. Delete `.btn-*` CSS. Type check + click-through on key flows.
7. **Remove dead keyframes** from `globals.css`. Confirm landing CTA still animates with the remaining `orb-drift-1`.

### PR1 success criteria

- Hardcoded color count: **<300** (down from 1,434). The remaining are model colors, intentional one-offs, OKLCH math inside gradients.
- All 4 UI primitives exist + pass `tsc --noEmit`.
- No visual regressions on landing + dashboard. Manual Playwright walkthrough; screenshots before/after.
- Net diff: ~**−1,000 lines** (deleted utilities, dead keyframes, duplicated hooks).
- `npm run build`, `tsc --noEmit`, `npm run lint` all green.

---

## PR2 — Surface deep-clean + signature moments

### Surface 1 — Landing (`app/page.tsx`, 1,146 → ~450 lines across 6 files)

Split into `components/landing/`:
- `LandingHeader.tsx` — sticky header (currently `Header`)
- `LandingHero.tsx` — hero + dashboard mockup
- `LandingModelsBar.tsx`
- `LandingFeatures.tsx`
- `LandingHowItWorks.tsx`
- `LandingPricing.tsx`
- `LandingFAQ.tsx`
- `LandingCTA.tsx`
- `LandingFooter.tsx`

Each ≤120 lines. All token-swept. Drop local motion hooks for `lib/motion.ts`. Visual changes:
- **Hero tightened:** replace dual radial gradient + dot-grid + ambient orb stack → single `--gradient-signature` + dot-grid (orb removed from hero).
- **Pricing table zebra stripes** via tokens, not inline `bg-[#020617]`.
- **CTA section keeps the one allowed ambient orb** (the celebratory moment).

### Surface 2 — Dashboard (`app/dashboard/page.tsx`, 1,025 → ~280 lines)

Extract into `components/dashboard/`:
- `SOVCard.tsx` — the 80-line inline SOV rendering, including competitor color palette (palette becomes `--comp-color-1` through `--comp-color-8` tokens).
- `SentimentCard.tsx` — the inline sentiment card with the three-color bar.
- `AvgPositionCard.tsx`.
- `UpgradeModal.tsx`.
- Three hand-rolled empty states → one `<EmptyState>` consumer.

Layout grammar normalized:
- Card padding salad (`p-3/p-4/p-5/p-7`) → consistent `<Card padding="md">`.
- Row 3's awkward 1+2 split → standard 2-col grid (Top Domains becomes its own row).
- All token-swept.

### Surface 3 — Onboarding (`app/onboarding/page.tsx`, 385 → ~250 lines across step files)

- Token sweep.
- Hand-rolled progress indicator → `<StepProgress current={n} of={3} />` shared component.
- Form fields → `<TextField>` / `<UrlField>` primitives in `components/ui/`.
- **Signature character moment:** brand-name → "fetching website context" transition gains a slate-blue progress ring + checkmark (replaces bare `<Loader2>`).

### Surface 4 — Settings (`app/settings/page.tsx`, 1,926 → ~5 files of ~250 lines)

Split by tab into `components/settings/`:
- `ProfileTab.tsx`
- `BillingTab.tsx`
- `SchedulerTab.tsx`
- `ApiKeysTab.tsx`
- `IntegrationsTab.tsx`

`app/settings/page.tsx` becomes a thin tab-switching shell (~80 lines). Each tab uses `<Card>` composition + `<TextField>` primitives shared with onboarding. Token sweep.

### Five signature character moments (PR2)

1. **Model-color crescendo on tracking start** — upgrade `ReportRunningBanner` so the four model icons pulse IN sequence (ChatGPT green → Claude orange → Perplexity purple → Gemini blue) at start, then settle into the existing quiet rotation. Total: ~1.5s. Uses four existing model-color tokens.
2. **Signature gradient (`--gradient-signature`) deployed consistently** in: landing hero badge, empty-state icon backgrounds, "running first report" indicator, new-brand-success moment. Currently used inconsistently — naming + spreading creates the recurring fingerprint.
3. **Dot-grid as recurring texture.** Currently landing-only. Spread to: dashboard "no data" empty state, onboarding step transitions, behind the visibility-score card. Same `radial-gradient(circle, rgba(148,163,184,0.8) 1px, transparent 1px)` at 32×32 spacing, masked.
4. **Visibility score upsized to focal point.** 36px → 56px on desktop, `-2px` letterspacing, subtle `text-shadow: 0 0 24px rgba(95,126,166,0.15)` glow. Horizontal sparkline immediately below. `useCountUp` animates in on load.
5. **Mention-cite micro-moment.** On QueryResult row expand, the model icon glows briefly in its brand color (Emil `ease-drawer`, 600ms, once). Tiny detail; high frequency.

### Explicitly NOT in PR2

- No custom illustration (Lucide stays).
- No new typeface (Inter + Syne + Geist Mono stays).
- No light mode.
- No glassmorphism, neumorphism, or other named style.
- No 3D / parallax / scroll-jacking.
- No micro-interactions added beyond the five above (budget).

### Migration order (PR2)

1. **Settings split first** (highest line count → highest leverage on follow-up work).
2. **Dashboard refactor** (extract cards, modal, normalize layout).
3. **Landing refactor** (split into landing/* components, tighten hero).
4. **Onboarding token sweep + StepProgress + signature gradient transition.**
5. **Signature moments** — each its own commit:
   - 5a: model-color crescendo
   - 5b: gradient spread
   - 5c: dot-grid spread
   - 5d: score upsize
   - 5e: mention micro-moment

### PR2 success criteria

- No page file in `app/` exceeds **350 lines** (cluster detail excepted — separate concern).
- Lighthouse Performance on landing **≥90**.
- All 5 signature moments demonstrable in a single recorded walkthrough.
- `npm run build` clean, `tsc --noEmit` clean, `npm run lint` clean.
- Cross-page consistency check: same UI primitive (empty state, stat card) on 3 different surfaces renders visually identically.

---

## Verification

Per `superpowers:verification-before-completion`:
- Each PR ends with manual Playwright walkthrough on dev server.
- Screenshots before/after for touched surfaces, committed to `docs/design-cleanup/screenshots/`.
- `npm run build` + `tsc --noEmit` + `npm run lint` green before merge.
- New tooling: `scripts/audit/count-hardcoded-colors.sh` — one-liner that runs the grep + count from PR1's success criteria, so the metric is trackable over time.

---

## Risks + mitigations

| Risk | Likelihood | Mitigation |
|------|-----------|------------|
| Color codemod misses an edge case (e.g. `rgba(...)` inside a JS template literal) | Medium | Triage step in PR1 produces a whitelist; spot-check 5 random surfaces visually after codemod |
| Removing `.btn-*` breaks a surface I didn't read | Medium | grep before delete; codemod runs first; type check catches missing imports |
| Dashboard refactor changes behavior accidentally | Low | Extract-only, no logic changes; existing state lives in `page.tsx`; tests for dashboard analytics still pass |
| Signature moments feel gratuitous | Low | Capped at 5; each tied to high-frequency user moments (run start, empty state, score view, transition, citation expand) |
| Settings split breaks deep links | Low | `?tab=profile` query param mapping preserved; route stays `/settings` |
| Animation pruning makes the app feel "flat" | Low | Two remaining flourishes (CTA orb + signature moments) are sufficient; cleanup adds *meaning* to motion, doesn't remove it |

---

## Open questions

None blocking. Surface selection confirmed (landing, dashboard, onboarding, settings). Style direction confirmed (preserve current language). Out-of-scope surfaces confirmed.

---

## Related work

- `docs/superpowers/specs/2026-05-22-content-tab-collapse-design.md` — content surface cleanup (already shipped).
- `docs/superpowers/specs/2026-05-20-agency-portal-cleanup-design.md` — agency cockpit cleanup pattern (similar shape).
- `globals.css` — current design tokens (preserve + extend).
- `lib/motion.ts` — current motion primitives (extend).

