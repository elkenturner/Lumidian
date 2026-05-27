# Design Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate ~28% design-token slippage, extract 4 missing UI primitives, lift duplicated motion code into one home, then deep-clean landing/dashboard/onboarding/settings and add 5 signature character moments — without changing the existing visual identity.

**Architecture:** Two phases shipping as two PRs. Phase 1 is foundation: design-token additions, dead-code removal, primitive extraction, mechanical codemods (button system unification, color sweep). Phase 2 consumes Phase 1's primitives to refactor four large surfaces into smaller files and add five intentional motion/visual flourishes. Each phase ends in a verification gate + PR creation step.

**Tech Stack:** Next.js 15, React 18, TypeScript (strict), Tailwind, Radix UI, shadcn/ui, framer-motion. No frontend tests exist; verification is `tsc --noEmit` + `npm run lint` + `npm run build` + manual Playwright walkthrough.

**Spec:** `docs/superpowers/specs/2026-05-27-design-cleanup-design.md`

**Branching:**
- Phase 1 → `feat/design-cleanup-foundation` (off `main`)
- Phase 2 → `feat/design-cleanup-surfaces` (off `main`, after Phase 1 merges)

---

## Phase 1 — Token Purify + Primitive Lift

### Task 1.1: Branch setup + working directory

**Files:**
- Create: `docs/design-cleanup/` directory

- [ ] **Step 1: Confirm clean working tree**

```bash
cd /Users/ken/Desktop/Lumidian
git status --short
```

Expected: only the spec doc may be present from prior work. If there are unrelated uncommitted changes (e.g. in `backend/app/services/prospect_audit/`), stash them with `git stash push -m "pre-design-cleanup"`.

- [ ] **Step 2: Create the feature branch**

```bash
git checkout main
git pull origin main
git checkout -b feat/design-cleanup-foundation
```

Expected: switched to new branch `feat/design-cleanup-foundation`.

- [ ] **Step 3: Create working directory for intermediate artifacts**

```bash
mkdir -p docs/design-cleanup
echo "# Design cleanup intermediate artifacts" > docs/design-cleanup/README.md
git add docs/design-cleanup/README.md
git commit -m "chore(design): scaffold design-cleanup working dir"
```

---

### Task 1.2: Baseline color inventory + audit script

**Files:**
- Create: `scripts/audit/count-hardcoded-colors.sh`
- Create: `docs/design-cleanup/hardcoded-colors-baseline.txt`

- [ ] **Step 1: Create the audit script**

```bash
mkdir -p scripts/audit
```

Write `scripts/audit/count-hardcoded-colors.sh`:

```bash
#!/usr/bin/env bash
# Count hardcoded color literals in frontend code.
# Excludes design-token values and lib/constants/models.ts (model brand colors are data).
set -euo pipefail

ROOT="${1:-frontend}"

HARDCODED=$(grep -rEo "#[0-9a-fA-F]{6}|rgba?\([0-9., ]+\)" \
  --include="*.tsx" --include="*.ts" \
  --exclude-dir=node_modules \
  --exclude-dir=.next \
  --exclude="*models.ts" \
  "$ROOT/app/" "$ROOT/components/" 2>/dev/null | wc -l | tr -d ' ')

TOKENS=$(grep -rEo "var\(--[a-z-]+\)" \
  --include="*.tsx" --include="*.ts" \
  --exclude-dir=node_modules \
  --exclude-dir=.next \
  "$ROOT/app/" "$ROOT/components/" 2>/dev/null | wc -l | tr -d ' ')

TOTAL=$((HARDCODED + TOKENS))
PCT=$(awk "BEGIN { printf \"%.1f\", ($HARDCODED / $TOTAL) * 100 }")

echo "Hardcoded color literals: $HARDCODED"
echo "Design token usages:      $TOKENS"
echo "Slippage:                 ${PCT}%"
```

Then:

```bash
chmod +x scripts/audit/count-hardcoded-colors.sh
```

- [ ] **Step 2: Run baseline + save**

```bash
./scripts/audit/count-hardcoded-colors.sh > docs/design-cleanup/hardcoded-colors-baseline.txt
cat docs/design-cleanup/hardcoded-colors-baseline.txt
```

Expected output (approximate):
```
Hardcoded color literals: 1434
Design token usages:      3764
Slippage:                 27.6%
```

- [ ] **Step 3: Dump the actual occurrences for triage**

```bash
grep -rEon "#[0-9a-fA-F]{6}|rgba?\([0-9., ]+\)" \
  --include="*.tsx" --include="*.ts" \
  --exclude-dir=node_modules \
  --exclude-dir=.next \
  frontend/app/ frontend/components/ > docs/design-cleanup/hardcoded-colors-raw.txt
wc -l docs/design-cleanup/hardcoded-colors-raw.txt
```

- [ ] **Step 4: Commit**

```bash
git add scripts/audit/count-hardcoded-colors.sh docs/design-cleanup/
git commit -m "chore(design): add color-slippage audit script + baseline"
```

---

### Task 1.3: Add new design tokens to globals.css

**Files:**
- Modify: `frontend/app/globals.css`

- [ ] **Step 1: Add the new color + shadow + gradient tokens**

In `frontend/app/globals.css`, locate the `/* ── Design tokens ─────... */` `:root` block (around line 30) and add the following at the end of that block (before the closing `}`):

```css
  /* Tinted elevation (replaces 50+ inline rgba(255,255,255,0.06)) */
  --bg-tinted: rgba(255,255,255,0.06);
  --bg-tinted-hover: rgba(255,255,255,0.10);
  --border-faint: rgba(255,255,255,0.08);

  /* Explicit so a future accent shift doesn't break button text */
  --text-on-accent: #ffffff;

  /* Named shadow tokens (replaces 12+ hand-tuned box-shadow declarations) */
  --shadow-card: 0 2px 8px rgba(0,0,0,0.15), inset 0 1px 0 rgba(255,255,255,0.03);
  --shadow-card-hover: 0 4px 16px rgba(0,0,0,0.25), inset 0 1px 0 rgba(255,255,255,0.04);
  --shadow-elevated: 0 4px 24px rgba(0,0,0,0.3), inset 0 1px 0 rgba(255,255,255,0.04);

  /* Signature gradient — recurring brand fingerprint */
  --gradient-signature: linear-gradient(135deg, oklch(0.58 0.06 235) 0%, oklch(0.50 0.08 235) 50%, transparent 100%);

  /* Typography scale (display = hero only; h1-h3 + body + caption) */
  --text-display: 3rem;     /* 48px, Syne, -2px tracking */
  --text-h1: 2rem;          /* 32px, Syne, -1px tracking */
  --text-h2: 1.5rem;        /* 24px, Syne, -0.5px tracking */
  --text-h3: 1.125rem;      /* 18px, Inter 600 */
  --text-body: 0.875rem;    /* 14px, Inter 400 */
  --text-caption: 0.75rem;  /* 12px, Inter 500 */

  /* Mono stat sizes (formalizes .stat-value-lg / .stat-value-sm) */
  --text-mono-lg: 3.5rem;   /* 56px hero stats (visibility score) */
  --text-mono-md: 2.25rem;  /* 36px (current .stat-value-lg) */
  --text-mono-sm: 1.5rem;   /* 24px (current .stat-value-sm) */
```

- [ ] **Step 2: Add the `.bg-tinted` utility classes**

Still in `frontend/app/globals.css`, after the `.card` / `.card-hover` / `.card-elevated` block (around line 130) and before the `.model-card` block, add:

```css
/* ── Tinted surface utility (one-off elevation, no card chrome) ─────────── */
.bg-tinted {
  background: var(--bg-tinted);
}
.bg-tinted-hover:hover {
  background: var(--bg-tinted-hover);
}
```

- [ ] **Step 3: Update `.card`, `.card-hover`, `.card-elevated` to use shadow tokens**

In `frontend/app/globals.css`, change:

```css
.card {
  background: var(--bg-raised);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-lg);
  padding: 20px;
  box-shadow: 0 2px 8px rgba(0,0,0,0.15), inset 0 1px 0 rgba(255,255,255,0.03);
}
```

to:

```css
.card {
  background: var(--bg-raised);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-lg);
  padding: 20px;
  box-shadow: var(--shadow-card);
}
```

Apply equivalent replacements to `.card-hover:hover` (use `var(--shadow-card-hover)`) and `.card-elevated` (use `var(--shadow-elevated)`).

- [ ] **Step 4: Verify build still works (no visual change yet)**

```bash
cd frontend
npm run build 2>&1 | tail -20
```

Expected: build succeeds, no new errors. The output values match the inline values they replace, so there's no visual change.

- [ ] **Step 5: Commit**

```bash
cd /Users/ken/Desktop/Lumidian
git add frontend/app/globals.css
git commit -m "feat(design): add tinted/shadow/gradient/typography tokens to globals.css"
```

---

### Task 1.4: Remove dead keyframes + consolidate orb-drift variants

**Files:**
- Modify: `frontend/app/globals.css`
- Modify: `frontend/app/page.tsx` (if orb-drift-2/3/4 are referenced)

- [ ] **Step 1: Find any consumers of the keyframes we're about to delete**

```bash
cd /Users/ken/Desktop/Lumidian
grep -rEo "slideInLeft|slideInRight|drawLine|orb-drift-[234]|diamond-pulse-glow" \
  --include="*.tsx" --include="*.ts" --include="*.css" \
  --exclude-dir=node_modules --exclude-dir=.next \
  frontend/app/ frontend/components/ 2>/dev/null | sort | uniq -c
```

Expected: counts for each name. `slideInLeft`, `slideInRight`, `drawLine` should appear only inside `globals.css` (the `@keyframes` declarations themselves). If any have external consumers, list them and pause — they're not dead. Pause and update the plan if needed.

- [ ] **Step 2: Find the duplicate `glow-pulse` declaration**

```bash
grep -n "@keyframes glow" frontend/app/globals.css
grep -n "@keyframes glowPulse" frontend/app/globals.css
```

Expected: `glowPulse` (camelCase) defined once around line 418, `glow-pulse` (kebab) defined once around line 443. Both define the same effect at different scales. Delete `glow-pulse` (the kebab one); keep `glowPulse`.

- [ ] **Step 3: Delete dead keyframes from globals.css**

In `frontend/app/globals.css`, delete these blocks (use the exact text in your editor or via the Edit tool):

```css
@keyframes drawLine {
  from {
    stroke-dashoffset: 1000;
  }
  to {
    stroke-dashoffset: 0;
  }
}
```

```css
@keyframes slideInLeft {
  from {
    opacity: 0;
    transform: translateX(-40px);
  }
  to {
    opacity: 1;
    transform: translateX(0);
  }
}
```

```css
@keyframes slideInRight {
  from {
    opacity: 0;
    transform: translateX(40px);
  }
  to {
    opacity: 1;
    transform: translateX(0);
  }
}
```

```css
@keyframes glow-pulse {
  0%, 100% { box-shadow: 0 0 20px oklch(0.58 0.06 235 / 0.12), 0 0 6px oklch(0.58 0.06 235 / 0.06); }
  50% { box-shadow: 0 0 30px oklch(0.58 0.06 235 / 0.22), 0 0 12px oklch(0.58 0.06 235 / 0.10); }
}
```

- [ ] **Step 4: Consolidate orb-drift variants**

In `frontend/app/globals.css`, find `@keyframes orb-drift-2`, `@keyframes orb-drift-3`, `@keyframes orb-drift-4` and the `.orb-2`, `.orb-3`, `.orb-4` rules. Delete them. Keep `@keyframes orb-drift-1` and `.orb-1`.

If Step 1 showed external consumers of orb-drift-2/3/4, instead of deleting, replace each `.orb-N { animation: orb-drift-N 50s ease-in-out infinite; }` with `.orb-N { animation: orb-drift-1 50s ease-in-out infinite; animation-delay: ${N * 8}s; }` and only delete the `@keyframes` definitions.

- [ ] **Step 5: Verify build**

```bash
cd frontend
npm run build 2>&1 | tail -20
```

Expected: build succeeds.

- [ ] **Step 6: Visual sanity check landing page**

```bash
npm run dev
```

Open `http://localhost:3000`. Scroll to the CTA section (very bottom). The animated gradient orb behind "Start tracking your AI visibility" should still drift (uses `ctaOrb`, not `orb-drift-*`, so unaffected). Hero section background gradient should still render. Confirm no visual regressions.

Stop the dev server.

- [ ] **Step 7: Commit**

```bash
cd /Users/ken/Desktop/Lumidian
git add frontend/app/globals.css frontend/app/page.tsx
git commit -m "chore(design): remove dead keyframes + consolidate orb-drift variants"
```

---

### Task 1.5: Create `<Heading>` primitive

**Files:**
- Create: `frontend/components/ui/heading.tsx`

- [ ] **Step 1: Write the component**

Create `frontend/components/ui/heading.tsx`:

```tsx
import { type ReactNode, type ElementType } from 'react';

type HeadingLevel = 'display' | 1 | 2 | 3;

const SIZE_CLASS: Record<HeadingLevel, string> = {
  display: 'text-[3rem] tracking-[-0.06em] leading-[1.05]',
  1: 'text-[2rem] tracking-[-0.03em] leading-[1.15]',
  2: 'text-[1.5rem] tracking-[-0.02em] leading-[1.25]',
  3: 'text-[1.125rem] leading-[1.35]',
};

const SIZE_FAMILY: Record<HeadingLevel, string> = {
  display: 'font-[family-name:var(--font-syne),system-ui,sans-serif] font-extrabold',
  1: 'font-[family-name:var(--font-syne),system-ui,sans-serif] font-bold',
  2: 'font-[family-name:var(--font-syne),system-ui,sans-serif] font-bold',
  3: 'font-sans font-semibold',
};

const SIZE_DEFAULT_TAG: Record<HeadingLevel, ElementType> = {
  display: 'h1',
  1: 'h1',
  2: 'h2',
  3: 'h3',
};

interface HeadingProps {
  level: HeadingLevel;
  as?: ElementType;
  className?: string;
  children: ReactNode;
}

export function Heading({ level, as, className = '', children }: HeadingProps) {
  const Tag = as ?? SIZE_DEFAULT_TAG[level];
  return (
    <Tag
      className={`text-[color:var(--text-primary)] ${SIZE_FAMILY[level]} ${SIZE_CLASS[level]} ${className}`}
    >
      {children}
    </Tag>
  );
}
```

- [ ] **Step 2: Verify it type-checks**

```bash
cd frontend
npx tsc --noEmit components/ui/heading.tsx 2>&1 | head -10
```

Expected: no errors. (Note: full project tsc may surface other unrelated issues; we're checking just this file.)

- [ ] **Step 3: Smoke-test by importing**

Temporarily edit `frontend/app/methodology/page.tsx` (or any small page; pick one currently using inline Syne styles) to import and render `<Heading level={1}>` somewhere visible. Run `npm run dev`, confirm it renders with the correct Syne font + size + color. Revert the test edit.

- [ ] **Step 4: Commit**

```bash
cd /Users/ken/Desktop/Lumidian
git add frontend/components/ui/heading.tsx
git commit -m "feat(ui): add Heading primitive with typography-scale levels"
```

---

### Task 1.6: Create `<Card>` primitive

**Files:**
- Create: `frontend/components/ui/card.tsx`

- [ ] **Step 1: Write the component**

Create `frontend/components/ui/card.tsx`:

```tsx
import { type ReactNode, type HTMLAttributes } from 'react';

type CardPadding = 'sm' | 'md' | 'lg';
type CardTone = 'default' | 'elevated' | 'tinted';

const PADDING_CLASS: Record<CardPadding, string> = {
  sm: 'p-3',
  md: 'p-5',
  lg: 'p-7',
};

const TONE_STYLE: Record<CardTone, string> = {
  default: 'bg-[color:var(--bg-raised)] border border-[color:var(--border-subtle)] shadow-[var(--shadow-card)]',
  elevated: 'bg-[image:linear-gradient(135deg,rgba(15,23,42,0.8)_0%,rgba(30,41,59,0.4)_100%)] border border-[color:var(--border-subtle)] shadow-[var(--shadow-elevated)]',
  tinted: 'bg-[color:var(--bg-tinted)] border border-[color:var(--border-faint)]',
};

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  padding?: CardPadding;
  tone?: CardTone;
  hover?: boolean;
  children: ReactNode;
}

export function Card({
  padding = 'md',
  tone = 'default',
  hover = false,
  className = '',
  children,
  ...rest
}: CardProps) {
  const hoverClass = hover
    ? 'transition-[transform,background-color,border-color,box-shadow] duration-200 hover:-translate-y-px hover:border-[color:var(--border-default)] hover:shadow-[var(--shadow-card-hover)]'
    : '';
  return (
    <div
      className={`rounded-[var(--radius-lg)] ${TONE_STYLE[tone]} ${PADDING_CLASS[padding]} ${hoverClass} ${className}`}
      {...rest}
    >
      {children}
    </div>
  );
}
```

- [ ] **Step 2: Verify type-check**

```bash
cd frontend
npx tsc --noEmit 2>&1 | grep -E "components/ui/card.tsx" | head -10
```

Expected: no errors from this file.

- [ ] **Step 3: Commit**

```bash
cd /Users/ken/Desktop/Lumidian
git add frontend/components/ui/card.tsx
git commit -m "feat(ui): add Card primitive with sm/md/lg padding and default/elevated/tinted tones"
```

---

### Task 1.7: Create `<EmptyState>` primitive

**Files:**
- Create: `frontend/components/ui/empty-state.tsx`

- [ ] **Step 1: Write the component**

Create `frontend/components/ui/empty-state.tsx`:

```tsx
import { type ReactNode } from 'react';

interface EmptyStateProps {
  icon: ReactNode;
  title: string;
  body?: string;
  action?: ReactNode;
  className?: string;
}

export function EmptyState({ icon, title, body, action, className = '' }: EmptyStateProps) {
  return (
    <div className={`flex flex-col items-center justify-center py-12 px-6 text-center ${className}`}>
      <div
        className="w-[52px] h-[52px] rounded-[var(--radius-xl)] flex items-center justify-center mb-4"
        style={{
          background: 'var(--gradient-signature)',
          border: '1px solid var(--accent-border)',
          boxShadow: '0 0 24px oklch(0.58 0.06 235 / 0.08)',
          color: 'var(--accent-light)',
        }}
      >
        {icon}
      </div>
      <p className="text-sm font-semibold text-[color:var(--text-primary)] mb-1">{title}</p>
      {body && (
        <p className="text-[13px] text-[color:var(--text-muted)] leading-relaxed max-w-[280px]">
          {body}
        </p>
      )}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}
```

This is the first consumer of `--gradient-signature` — the new primitive ships with the signature gradient baked in.

- [ ] **Step 2: Verify type-check**

```bash
cd frontend
npx tsc --noEmit 2>&1 | grep -E "empty-state.tsx" | head -5
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
cd /Users/ken/Desktop/Lumidian
git add frontend/components/ui/empty-state.tsx
git commit -m "feat(ui): add EmptyState primitive with signature-gradient icon"
```

---

### Task 1.8: Create `<Stat>` primitive

**Files:**
- Create: `frontend/components/ui/stat.tsx`

- [ ] **Step 1: Write the component**

Create `frontend/components/ui/stat.tsx`:

```tsx
import { type ReactNode } from 'react';
import { TrendingUp, TrendingDown } from 'lucide-react';

type StatSize = 'lg' | 'md' | 'sm';

const SIZE_CLASS: Record<StatSize, string> = {
  lg: 'text-[length:var(--text-mono-lg)] tracking-[-2px]',
  md: 'text-[length:var(--text-mono-md)] tracking-[-1px]',
  sm: 'text-[length:var(--text-mono-sm)] tracking-[-1px]',
};

interface StatProps {
  value: ReactNode;
  size?: StatSize;
  label?: string;
  /** Positive = up arrow + success; negative = down arrow + danger; null/0 = no trend */
  trend?: number | null;
  /** Optional suffix rendered smaller (e.g. "%") */
  suffix?: string;
  className?: string;
}

export function Stat({
  value,
  size = 'md',
  label,
  trend,
  suffix,
  className = '',
}: StatProps) {
  const hasTrend = trend !== null && trend !== undefined && trend !== 0;
  const trendUp = hasTrend && trend! > 0;
  return (
    <div className={className}>
      {label && (
        <p className="text-xs font-semibold uppercase tracking-wider text-[color:var(--text-muted)] mb-1">
          {label}
        </p>
      )}
      <p
        className={`font-[family-name:var(--font-geist-mono),'SF_Mono',ui-monospace,monospace] font-semibold leading-none text-[color:var(--text-primary)] ${SIZE_CLASS[size]}`}
      >
        {value}
        {suffix && (
          <span className="text-[0.5em] opacity-70 ml-0.5 align-baseline">{suffix}</span>
        )}
      </p>
      {hasTrend && (
        <div
          className="inline-flex items-center gap-1 mt-2 text-xs"
          style={{ color: trendUp ? 'var(--success-text)' : 'var(--danger-text)' }}
        >
          {trendUp ? <TrendingUp size={12} /> : <TrendingDown size={12} />}
          <span>
            {trendUp ? '+' : ''}
            {trend}%
          </span>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Verify type-check**

```bash
cd frontend
npx tsc --noEmit 2>&1 | grep -E "stat.tsx" | head -5
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
cd /Users/ken/Desktop/Lumidian
git add frontend/components/ui/stat.tsx
git commit -m "feat(ui): add Stat primitive with lg/md/sm sizes + optional trend indicator"
```

---

### Task 1.9: Lift motion primitives into `lib/motion.ts`

**Files:**
- Modify: `frontend/lib/motion.ts`

- [ ] **Step 1: Add `useInView` and the wrapper components**

Append to `frontend/lib/motion.ts`:

```typescript
// ── In-view observer ─────────────────────────────────────────────────────────
import { type RefObject } from 'react';

export function useInView(threshold = 0.1, rootMargin = '50px'): {
  ref: RefObject<HTMLDivElement>;
  inView: boolean;
} {
  const ref = useRef<HTMLDivElement>(null);
  const [inView, setInView] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    // If element is already visible on mount (above the fold), mark in-view immediately
    const rect = el.getBoundingClientRect();
    if (rect.top < window.innerHeight * 0.85) {
      setInView(true);
      return;
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setInView(true);
          observer.disconnect();
        }
      },
      { threshold, rootMargin },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [threshold, rootMargin]);

  return { ref, inView };
}

// ── FadeUp / ScaleIn wrappers (CSS-driven, no framer-motion dep) ─────────────
import type { ReactNode } from 'react';

const EASE_OUT_CSS = 'cubic-bezier(0.23, 1, 0.32, 1)';

export function FadeUp({
  children,
  delay = 0,
  className = '',
}: {
  children: ReactNode;
  delay?: number;
  className?: string;
}) {
  const { ref, inView } = useInView();
  return (
    <div
      ref={ref}
      className={className}
      style={{
        opacity: inView ? 1 : 0,
        transform: inView ? 'translateY(0)' : 'translateY(10px)',
        transition: `opacity 0.35s ${EASE_OUT_CSS} ${delay}ms, transform 0.35s ${EASE_OUT_CSS} ${delay}ms`,
      }}
    >
      {children}
    </div>
  );
}

export function ScaleIn({
  children,
  delay = 0,
  className = '',
}: {
  children: ReactNode;
  delay?: number;
  className?: string;
}) {
  const { ref, inView } = useInView();
  return (
    <div
      ref={ref}
      className={className}
      style={{
        opacity: inView ? 1 : 0,
        transform: inView ? 'scale(1)' : 'scale(0.97)',
        transition: `opacity 0.4s ${EASE_OUT_CSS} ${delay}ms, transform 0.4s ${EASE_OUT_CSS} ${delay}ms`,
      }}
    >
      {children}
    </div>
  );
}
```

Note: the existing `useCountUp` in this file is already exported. We're not changing it.

- [ ] **Step 2: Verify type-check**

```bash
cd frontend
npx tsc --noEmit 2>&1 | grep -E "lib/motion" | head -10
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
cd /Users/ken/Desktop/Lumidian
git add frontend/lib/motion.ts
git commit -m "feat(motion): lift useInView + FadeUp + ScaleIn into lib/motion"
```

---

### Task 1.10: Migrate landing page off its local motion hooks

**Files:**
- Modify: `frontend/app/page.tsx`

- [ ] **Step 1: Delete the local hooks and components**

In `frontend/app/page.tsx`, delete lines 25–133 inclusive — the entire `// ANIMATION HOOKS` section including `EASE_OUT`, `useInView`, `useCountUp`, `FadeUp`, `ScaleIn`. (The exact line range may shift slightly from prior edits; visually it's the block between `// ANIMATION HOOKS` header and `// DATA` header.)

- [ ] **Step 2: Update imports to consume from `lib/motion`**

In `frontend/app/page.tsx`, find the existing imports block at the top. Add this import:

```typescript
import { useInView, useCountUp, FadeUp, ScaleIn } from '@/lib/motion';
```

If `useRef` / `useState` / `useCallback` were only used by the deleted hooks, narrow the `react` import accordingly (they're still needed for the page state and `DashboardMockup`, so leave them).

- [ ] **Step 3: Verify the file is shorter and still type-checks**

```bash
cd frontend
wc -l app/page.tsx
npx tsc --noEmit 2>&1 | grep -E "app/page.tsx" | head -10
```

Expected: line count drops from ~1,146 to ~1,036 (~110 lines removed). No type errors.

- [ ] **Step 4: Visual verification**

```bash
npm run dev
```

Open `http://localhost:3000`. Verify:
- Hero section badge fades in.
- Headline fades in with stagger.
- Dashboard mockup scales in.
- Scrolling triggers fade-ups on Features cards.
- Count-up animation on the visibility score number in the mockup still runs.

If any animation is broken, the cause is likely a stale import — re-check.

Stop dev server.

- [ ] **Step 5: Commit**

```bash
cd /Users/ken/Desktop/Lumidian
git add frontend/app/page.tsx
git commit -m "refactor(landing): consume motion primitives from lib/motion (–110 lines)"
```

---

### Task 1.11: Codemod hardcoded slate + accent colors → tokens

**Files:**
- Modify: many files under `frontend/app/` and `frontend/components/`

This is the highest-impact mechanical change. Execute with care.

- [ ] **Step 1: Dry-run grep to see which files will be affected**

```bash
cd /Users/ken/Desktop/Lumidian
grep -rEl "#020617|#0f172a|#1e293b|#334155|#f8fafc|#94a3b8|#64748b|#546880|#5f7ea6|#4a6a90|rgba\(255,255,255,0\.0[568]\)|rgba\(51,65,85,0\.5\)|rgba\(71,85,105,0\.5\)|rgba\(100,116,139,0\.5\)" \
  --include="*.tsx" --include="*.ts" \
  --exclude-dir=node_modules --exclude-dir=.next \
  frontend/app/ frontend/components/ 2>/dev/null | wc -l
```

Expected: ~40-60 files. Save the list:

```bash
grep -rEl "#020617|#0f172a|#1e293b|#334155|#f8fafc|#94a3b8|#64748b|#546880|#5f7ea6|#4a6a90|rgba\(255,255,255,0\.0[568]\)|rgba\(51,65,85,0\.5\)|rgba\(71,85,105,0\.5\)|rgba\(100,116,139,0\.5\)" \
  --include="*.tsx" --include="*.ts" \
  --exclude-dir=node_modules --exclude-dir=.next \
  frontend/app/ frontend/components/ > docs/design-cleanup/codemod-target-files.txt
wc -l docs/design-cleanup/codemod-target-files.txt
```

- [ ] **Step 2: Exclude data files where hex values are intentional**

Open `docs/design-cleanup/codemod-target-files.txt` and remove these lines (these contain model-color data arrays):
- `frontend/lib/constants/models.ts` (if listed)
- Any file under `frontend/components/dashboard/` that defines a color palette as data
- Any file matching `*Icon.tsx` (model icons embed their brand color as data)

Move the curated list to `docs/design-cleanup/codemod-targets.txt`:

```bash
cp docs/design-cleanup/codemod-target-files.txt docs/design-cleanup/codemod-targets.txt
# Then manually edit codemod-targets.txt to remove the excluded files identified above
```

- [ ] **Step 3: Run the codemod**

```bash
cd /Users/ken/Desktop/Lumidian
cat docs/design-cleanup/codemod-targets.txt | xargs sed -i '' \
  -e 's/#020617/var(--bg-base)/g' \
  -e 's/#0f172a/var(--bg-raised)/g' \
  -e 's/#1e293b/var(--bg-card)/g' \
  -e 's/#334155/var(--bg-elevated)/g' \
  -e 's/#f8fafc/var(--text-primary)/g' \
  -e 's/#94a3b8/var(--text-secondary)/g' \
  -e 's/#64748b/var(--text-muted)/g' \
  -e 's/#546880/var(--text-faint)/g' \
  -e 's/#5f7ea6/var(--accent)/g' \
  -e 's/#4a6a90/var(--accent-hover)/g' \
  -e 's/rgba(255,255,255,0\.06)/var(--bg-tinted)/g' \
  -e 's/rgba(255,255,255,0\.10)/var(--bg-tinted-hover)/g' \
  -e 's/rgba(255,255,255,0\.08)/var(--border-faint)/g' \
  -e 's/rgba(51,65,85,0\.5)/var(--border-subtle)/g' \
  -e 's/rgba(71,85,105,0\.5)/var(--border-default)/g' \
  -e 's/rgba(100,116,139,0\.5)/var(--border-strong)/g'
```

Note: the `0\.05` and `0\.5` patterns are escaped — sed uses BRE; the literal dot needs escaping.

- [ ] **Step 4: Run type-check**

```bash
cd frontend
npx tsc --noEmit 2>&1 | head -30
```

Expected: no new errors. If errors appear, they're likely about Tailwind arbitrary value syntax — Tailwind v3 accepts `bg-[var(--bg-base)]` as an arbitrary value, but `bg-[#020617]/30` (with opacity suffix) does not transform cleanly. If you see broken classnames like `bg-[var(--accent)]/15`, you'll need to replace them with explicit OKLCH alpha: `bg-[oklch(0.58_0.06_235_/_0.15)]`. Grep for the pattern:

```bash
grep -rEn "\[var\(--[a-z-]+\)\]/[0-9]+" frontend/app/ frontend/components/ 2>/dev/null | head -20
```

If matches appear, hand-fix each: the substitution should be either `oklch(...)` with explicit alpha, or use one of the existing alpha tokens like `--accent-muted` (15% alpha) or `--accent-border` (20% alpha).

- [ ] **Step 5: Visual spot-check 5 random surfaces**

```bash
cd frontend
npm run dev
```

Open each:
- `http://localhost:3000/` — landing
- `http://localhost:3000/dashboard` — dashboard (login first if needed)
- `http://localhost:3000/settings` — settings
- `http://localhost:3000/content` — content
- `http://localhost:3000/onboarding` — onboarding (might 404 if a brand exists; use /tracker/new instead)

For each, verify nothing looks visually different from before. The codemod replaces hex/rgba with their token equivalents — by construction the rendered values are identical, so any difference indicates a missed edge case (likely the opacity-suffix issue above).

Stop dev server.

- [ ] **Step 6: Re-run the audit script**

```bash
cd /Users/ken/Desktop/Lumidian
./scripts/audit/count-hardcoded-colors.sh > docs/design-cleanup/hardcoded-colors-post-codemod.txt
diff docs/design-cleanup/hardcoded-colors-baseline.txt docs/design-cleanup/hardcoded-colors-post-codemod.txt
```

Expected: hardcoded count should drop from ~1,434 to ~250-400. Slippage should drop from ~28% to under 10%.

- [ ] **Step 7: Commit**

```bash
git add -u  # picks up all modified .tsx/.ts files
git add docs/design-cleanup/
git commit -m "refactor(design): codemod hardcoded slate + accent colors to tokens

Replaces 1,000+ hex/rgba literals with their --bg-*/--text-*/--accent-*
equivalents. No visual change — substitution values match originals."
```

---

### Task 1.12: Consolidate button systems

**Files:**
- Modify: 4 files using `.btn-*` classes (from Task 1.0 grep): `frontend/app/content/[brandId]/cluster/[clusterId]/page.tsx`, `frontend/components/content/cluster/PieceCard.tsx`, `frontend/components/content/cluster/PillarCard.tsx`, `frontend/components/content/cluster/BriefPanel.tsx`
- Modify: `frontend/app/globals.css` (remove `.btn-*` utilities)

- [ ] **Step 1: List the `.btn-*` usages precisely**

```bash
cd /Users/ken/Desktop/Lumidian
grep -rEon "className=\"[^\"]*\\bbtn(-[a-z]+)?\\b[^\"]*\"" \
  frontend/app/ frontend/components/ 2>/dev/null
```

Expected: 13 occurrences across the 4 files listed above. Note each: which variant (`btn-primary` / `btn-secondary` / `btn-ghost` / `btn-destructive`) maps to which shadcn variant (`default` / `outline` / `ghost` / `destructive`).

- [ ] **Step 2: Codemod each occurrence to `<Button>`**

For each occurrence, manually convert. Example transformation:

Before:
```tsx
<button onClick={onClick} className="btn btn-primary" disabled={loading}>
  Save
</button>
```

After:
```tsx
<Button onClick={onClick} disabled={loading}>
  Save
</Button>
```

Mapping:
- `btn btn-primary` → `<Button variant="default">` (or omit — `default` is the default)
- `btn btn-secondary` → `<Button variant="outline">`
- `btn btn-ghost` → `<Button variant="ghost">`
- `btn btn-destructive` → `<Button variant="destructive">`

Each file needs:
```tsx
import { Button } from '@/components/ui/button';
```

added to its imports if not already present.

Touch each of the 4 files in turn:
1. `frontend/components/content/cluster/PieceCard.tsx`
2. `frontend/components/content/cluster/PillarCard.tsx`
3. `frontend/components/content/cluster/BriefPanel.tsx`
4. `frontend/app/content/[brandId]/cluster/[clusterId]/page.tsx`

- [ ] **Step 3: Confirm no `btn-*` usages remain**

```bash
grep -rEo "className=\"[^\"]*\\bbtn(-[a-z]+)?\\b[^\"]*\"" \
  frontend/app/ frontend/components/ 2>/dev/null | wc -l
```

Expected: 0.

- [ ] **Step 4: Delete the `.btn-*` rules from globals.css**

In `frontend/app/globals.css`, delete the entire block from `/* ── Button utilities ─── */` through `.btn-destructive:hover:not(:disabled) { ... }` (around lines 175–234). That's ~60 lines removed.

- [ ] **Step 5: Verify build**

```bash
cd frontend
npm run build 2>&1 | tail -20
```

Expected: build succeeds.

- [ ] **Step 6: Visual click-through**

```bash
npm run dev
```

Navigate to a cluster detail page (`/content/<brandId>/cluster/<clusterId>` — login first, pick any cluster). Confirm all buttons render with shadcn styling, all click handlers still fire, disabled states render.

Stop dev server.

- [ ] **Step 7: Commit**

```bash
cd /Users/ken/Desktop/Lumidian
git add -u
git commit -m "refactor(ui): consolidate .btn-* CSS utilities into shadcn Button

Deletes 60 lines of duplicate button styles from globals.css.
Codemods 13 usages across 4 cluster-page files to <Button variant=...>."
```

---

### Task 1.13: Phase 1 final verification + open PR

**Files:**
- (no code changes — verification only)

- [ ] **Step 1: Re-run audit**

```bash
cd /Users/ken/Desktop/Lumidian
./scripts/audit/count-hardcoded-colors.sh
```

Expected: hardcoded count <300 (down from 1,434).

- [ ] **Step 2: Full type-check + lint + build**

```bash
cd frontend
npx tsc --noEmit 2>&1 | tail -10
npm run lint 2>&1 | tail -20
npm run build 2>&1 | tail -20
```

Expected: all three pass cleanly.

- [ ] **Step 3: Manual Playwright walkthrough**

```bash
npm run dev
```

Walk through, taking a screenshot of each. Compare to mental model from prior visits — no surface should look meaningfully different (PR1 is supposed to be visually invisible):
- `/` (landing — hero, features, pricing, FAQ, CTA)
- `/login`
- `/dashboard` (after login)
- `/content`
- `/settings`
- `/site-audit`

Save screenshots to `docs/design-cleanup/screenshots/phase1/` (manually, using browser screenshot tool).

Stop dev server.

- [ ] **Step 4: Verify metrics in PR description**

Count net lines removed:

```bash
cd /Users/ken/Desktop/Lumidian
git diff main --stat | tail -5
```

Expected: net deletion (additions − deletions should be negative, around −800 to −1,200 lines).

- [ ] **Step 5: Push branch + open PR**

```bash
git push -u origin feat/design-cleanup-foundation
gh pr create --base main --title "chore(design): token purify + primitive lift (Phase 1)" --body "$(cat <<'EOF'
## Summary
Foundation pass for the design cleanup. No visual identity changes — this PR is the substrate for Phase 2 (surface deep-clean + signature moments).

- **Tokens added:** `--bg-tinted`, `--bg-tinted-hover`, `--border-faint`, `--text-on-accent`, three `--shadow-*`, `--gradient-signature`, full typography scale (`--text-display` / `--text-h1..3` / `--text-body` / `--text-caption` / `--text-mono-*`).
- **Tokens removed:** 4 dead keyframes (`slideInLeft`, `slideInRight`, `drawLine`, duplicate `glow-pulse`); orb-drift consolidated from 4 variants to 1.
- **Primitives added:** `<Heading>`, `<Card>`, `<EmptyState>`, `<Stat>` in `components/ui/`. `useInView`, `FadeUp`, `ScaleIn` lifted into `lib/motion.ts`.
- **Color codemod:** ~1,100+ hex/rgba literals replaced with token equivalents (slippage 27.6% → <10%).
- **Button systems unified:** 13 `.btn-*` usages migrated to shadcn `<Button>`; ~60 lines of utility CSS deleted.

Spec: `docs/superpowers/specs/2026-05-27-design-cleanup-design.md`
Plan: `docs/superpowers/plans/2026-05-27-design-cleanup.md`

## Test plan
- [ ] `npm run build` clean
- [ ] `tsc --noEmit` clean
- [ ] `npm run lint` clean
- [ ] Audit script reports <300 hardcoded colors
- [ ] Manual walkthrough of /, /dashboard, /content, /settings, /site-audit shows no visual regression

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

Expected: PR URL returned. Paste into chat for review.

**STOP HERE.** Phase 1 ships before Phase 2 begins. Merge Phase 1 to `main` before starting Phase 2 work.

---

## Phase 2 — Surface Deep-Clean + Signature Moments

> **Prerequisite:** Phase 1 PR is merged to `main`. Start Phase 2 on a fresh branch off `main`.

### Task 2.1: Branch setup

- [ ] **Step 1: Refresh main + create branch**

```bash
cd /Users/ken/Desktop/Lumidian
git checkout main
git pull origin main
git checkout -b feat/design-cleanup-surfaces
```

- [ ] **Step 2: Confirm Phase 1 primitives exist**

```bash
ls frontend/components/ui/heading.tsx frontend/components/ui/card.tsx frontend/components/ui/empty-state.tsx frontend/components/ui/stat.tsx
grep -E "^export (function|const) (useInView|FadeUp|ScaleIn)" frontend/lib/motion.ts
```

Expected: all 4 files exist; all 3 exports present. If any are missing, Phase 1 didn't merge cleanly — pause and investigate.

---

### Task 2.2: Add competitor color tokens (for SOVCard extraction)

**Files:**
- Modify: `frontend/app/globals.css`

- [ ] **Step 1: Add competitor color tokens**

In `frontend/app/globals.css`, near the Model colors block (around line 49), add:

```css
  /* Competitor palette — muted set used when more than one competitor in SOV */
  --comp-color-1: #7c8aaa; /* slate */
  --comp-color-2: #8a7ca5; /* lavender */
  --comp-color-3: #7ca58a; /* sage */
  --comp-color-4: #a5917c; /* tan */
  --comp-color-5: #7c9ba5; /* teal */
  --comp-color-6: #a57c8a; /* mauve */
  --comp-color-7: #9a9a7c; /* olive */
  --comp-color-8: #7c88a5; /* steel */
```

- [ ] **Step 2: Commit**

```bash
git add frontend/app/globals.css
git commit -m "feat(design): add 8 competitor color tokens for SOV palette"
```

---

### Task 2.3: Extract `<SOVCard>` from dashboard

**Files:**
- Create: `frontend/components/dashboard/SOVCard.tsx`
- Modify: `frontend/app/dashboard/page.tsx` (remove inline SOV block, import + render `<SOVCard>`)
- Modify: `frontend/components/dashboard/index.ts` (if barrel export exists)

- [ ] **Step 1: Find the inline SOV block in dashboard/page.tsx**

Open `frontend/app/dashboard/page.tsx` and locate the block starting with the comment `{/* SOV */}` (around line 798) through the closing `</div>` of the SOV card (around line 873). This is the block to extract.

- [ ] **Step 2: Create the component**

Create `frontend/components/dashboard/SOVCard.tsx`. Copy the JSX from the inline block, accepting these props:

```tsx
'use client';

import { Users } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { HelpTooltip } from '@/components/dashboard';
import { AskCoachButton } from '@/components/coach/AskCoachButton';
import type { DashboardAnalytics } from '@/lib/api';

const COMP_COLORS = [
  'var(--comp-color-1)',
  'var(--comp-color-2)',
  'var(--comp-color-3)',
  'var(--comp-color-4)',
  'var(--comp-color-5)',
  'var(--comp-color-6)',
  'var(--comp-color-7)',
  'var(--comp-color-8)',
];

interface SOVCardProps {
  analytics: DashboardAnalytics | null;
  loadingAnalytics: boolean;
  isMobile: boolean;
  selectedBrandId: number | null;
  onManageCompetitors: () => void;
}

export function SOVCard({
  analytics,
  loadingAnalytics,
  isMobile,
  selectedBrandId,
  onManageCompetitors,
}: SOVCardProps) {
  return (
    <Card padding="md" className="flex flex-col">
      <div className="flex items-center justify-between mb-3">
        <p className="text-sm font-medium text-[color:var(--text-secondary)] flex items-center">
          Share of Voice
          <HelpTooltip text="Percentage of total AI brand mentions in your category per entity." />
        </p>
        <button
          onClick={onManageCompetitors}
          aria-label="Manage competitors"
          className="flex items-center gap-1.5 text-xs text-[color:var(--text-muted)] hover:text-[color:var(--text-secondary)] bg-[color:var(--bg-tinted)] hover:bg-[color:var(--accent-muted)] border border-[color:var(--border-faint)] rounded-lg px-2.5 py-1.5 transition-colors"
        >
          <Users size={12} />
          {analytics?.sov.has_competitors ? 'Manage' : 'Add competitors'}
        </button>
      </div>
      {loadingAnalytics ? (
        <div className="flex gap-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-4 flex-1 bg-[color:var(--bg-tinted)] rounded animate-pulse" />
          ))}
        </div>
      ) : !analytics?.sov.has_competitors ? (
        <p className="text-xs text-[color:var(--text-faint)]">
          Add competitors to see how your brand&apos;s AI visibility compares.
        </p>
      ) : (() => {
        const allStats = analytics.competitor_comparison;
        const sorted = [...allStats].sort((a, b) => (b.is_primary ? 1 : 0) - (a.is_primary ? 1 : 0));
        const count = sorted.length;
        let colorIdx = 0;
        return (
          <div className={`grid gap-3 ${isMobile ? 'grid-cols-1' : count <= 2 ? 'grid-cols-1' : count <= 4 ? 'grid-cols-2' : 'grid-cols-2 sm:grid-cols-3'}`}>
            {sorted.map((s) => {
              const pct = Math.round(s.mention_rate * 100);
              const competitorColor = s.is_primary ? null : COMP_COLORS[colorIdx++ % COMP_COLORS.length];
              const barColor = s.is_primary ? 'var(--accent)' : competitorColor!;
              const textColor = s.is_primary ? 'var(--accent-light)' : competitorColor!;
              return (
                <div key={s.name} className="flex flex-col gap-1.5">
                  <div className="flex items-center justify-between">
                    <span className={`text-xs font-medium truncate ${s.is_primary ? 'text-[color:var(--text-primary)]' : 'text-[color:var(--text-secondary)]'}`}>{s.name}</span>
                    <span className="text-xs font-semibold tabular-nums ml-2 flex-shrink-0" style={{ color: textColor }}>{pct}%</span>
                  </div>
                  <div className="h-1.5 rounded-full bg-[color:var(--bg-tinted)] overflow-hidden">
                    <div
                      className="h-full rounded-full transition-[width] duration-500"
                      style={{ width: `${pct}%`, background: barColor }}
                    />
                  </div>
                  {!s.is_primary && selectedBrandId != null && (
                    <AskCoachButton
                      brandId={selectedBrandId}
                      question={`Why is ${s.name} outperforming us in AI visibility?`}
                      className="text-[10px] text-[color:var(--text-faint)] hover:text-[color:var(--accent)] underline underline-offset-2 transition-colors text-left"
                    >
                      Why are they ahead?
                    </AskCoachButton>
                  )}
                </div>
              );
            })}
          </div>
        );
      })()}
    </Card>
  );
}
```

- [ ] **Step 3: Replace the inline block in dashboard/page.tsx**

In `frontend/app/dashboard/page.tsx`, replace the entire `{/* SOV */} ... </div>` block (the inline SOV card identified in Step 1) with:

```tsx
<SOVCard
  analytics={analytics}
  loadingAnalytics={loadingAnalytics}
  isMobile={isMobile}
  selectedBrandId={selectedBrandId}
  onManageCompetitors={() => setCompetitorModalOpen(true)}
/>
```

Add to imports at top:

```tsx
import { SOVCard } from '@/components/dashboard/SOVCard';
```

Remove the now-unused `mutedColors` array from the file (it was inside the inline block).

If `frontend/components/dashboard/index.ts` exists as a barrel, add:

```typescript
export { SOVCard } from './SOVCard';
```

- [ ] **Step 4: Verify type-check + visual**

```bash
cd frontend
npx tsc --noEmit 2>&1 | head -20
```

Expected: no errors. Then `npm run dev`, navigate to `/dashboard` with a brand that has competitors, confirm SOV card renders identically.

- [ ] **Step 5: Commit**

```bash
cd /Users/ken/Desktop/Lumidian
git add -u
git add frontend/components/dashboard/SOVCard.tsx
git commit -m "refactor(dashboard): extract SOVCard component (–80 lines from page.tsx)"
```

---

### Task 2.4: Extract `<SentimentCard>` from dashboard

**Files:**
- Create: `frontend/components/dashboard/SentimentCard.tsx`
- Modify: `frontend/app/dashboard/page.tsx`

- [ ] **Step 1: Create the component**

Create `frontend/components/dashboard/SentimentCard.tsx` mirroring the inline Sentiment block in `frontend/app/dashboard/page.tsx` (around lines 762–795). Accept props:

```tsx
'use client';

import { TrendingUp } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { HelpTooltip } from '@/components/dashboard';
import type { DashboardAnalytics } from '@/lib/api';

interface SentimentCardProps {
  analytics: DashboardAnalytics | null;
  loadingAnalytics: boolean;
}

export function SentimentCard({ analytics, loadingAnalytics }: SentimentCardProps) {
  const sentData = analytics?.sentiment;
  const sentHeadline = sentData?.has_data
    ? sentData.positive_pct > 0
      ? `${Math.round(sentData.positive_pct)}% Positive`
      : sentData.negative_pct > 0
      ? `${Math.round(sentData.negative_pct)}% Negative`
      : 'Neutral'
    : null;
  const sentColor = sentData?.has_data
    ? sentData.positive_pct > 0
      ? 'var(--success)'
      : sentData.negative_pct > 0
      ? 'var(--danger)'
      : 'var(--warning)'
    : 'var(--text-faint)';

  return (
    <Card padding="md">
      <div className="flex items-start justify-between mb-2">
        <p className="text-sm font-medium text-[color:var(--text-secondary)] flex items-center">
          Sentiment
          <HelpTooltip text="How positively AI models describe your brand when they mention it." />
        </p>
        <div className="w-8 h-8 rounded-lg bg-[color:var(--bg-tinted)] flex items-center justify-center text-[color:var(--accent)] flex-shrink-0">
          <TrendingUp size={15} />
        </div>
      </div>
      {loadingAnalytics ? (
        <div className="h-8 w-16 bg-[color:var(--bg-tinted)] rounded animate-pulse mt-1" />
      ) : sentData?.has_data && sentHeadline ? (
        <>
          <p className="text-2xl font-bold mt-1" style={{ color: sentColor }}>
            {sentHeadline}
          </p>
          <div className="mt-2 flex gap-0.5 h-1.5 rounded-full overflow-hidden">
            <div style={{ width: `${sentData.positive_pct}%`, background: 'var(--success)' }} />
            <div style={{ width: `${sentData.neutral_pct}%`, background: 'var(--warning)' }} />
            <div style={{ width: `${sentData.negative_pct}%`, background: 'var(--danger)' }} />
          </div>
          <p className="text-xs text-[color:var(--text-faint)] mt-1.5">
            {Math.round(sentData.neutral_pct)}% neutral · {Math.round(sentData.negative_pct)}% negative
          </p>
        </>
      ) : (
        <>
          <p className="text-3xl font-bold text-[color:var(--text-primary)] mt-1">—</p>
          <p className="text-xs text-[color:var(--text-faint)] mt-1">No mentions to analyze</p>
        </>
      )}
    </Card>
  );
}
```

- [ ] **Step 2: Replace inline block in dashboard/page.tsx**

Replace the inline Sentiment block (the `<div className="card p-5">...` containing `Sentiment` label through its closing `</div>`) with:

```tsx
<SentimentCard analytics={analytics} loadingAnalytics={loadingAnalytics} />
```

Add import:

```tsx
import { SentimentCard } from '@/components/dashboard/SentimentCard';
```

- [ ] **Step 3: Verify**

```bash
cd frontend
npx tsc --noEmit 2>&1 | head -10
```

Expected: clean. Visual check via `npm run dev` + dashboard.

- [ ] **Step 4: Commit**

```bash
cd /Users/ken/Desktop/Lumidian
git add -u frontend/components/dashboard/SentimentCard.tsx
git commit -m "refactor(dashboard): extract SentimentCard component"
```

---

### Task 2.5: Extract `<AvgPositionCard>` from dashboard

**Files:**
- Create: `frontend/components/dashboard/AvgPositionCard.tsx`
- Modify: `frontend/app/dashboard/page.tsx`

- [ ] **Step 1: Create the component**

Create `frontend/components/dashboard/AvgPositionCard.tsx`:

```tsx
'use client';

import { Building2 } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { HelpTooltip } from '@/components/dashboard';
import type { DashboardAnalytics } from '@/lib/api';

interface AvgPositionCardProps {
  analytics: DashboardAnalytics | null;
  loadingAnalytics: boolean;
}

export function AvgPositionCard({ analytics, loadingAnalytics }: AvgPositionCardProps) {
  return (
    <Card padding="md">
      <div className="flex items-center justify-between mb-2">
        <p className="text-sm font-medium text-[color:var(--text-secondary)] flex items-center">
          Avg Position
          <HelpTooltip text="Position indicates where in the AI response your brand typically appears. Earlier is better." />
        </p>
        <div className="w-8 h-8 rounded-lg bg-[color:var(--bg-tinted)] flex items-center justify-center text-[color:var(--accent)]">
          <Building2 size={15} />
        </div>
      </div>
      {loadingAnalytics ? (
        <div className="h-8 w-16 bg-[color:var(--bg-tinted)] rounded animate-pulse" />
      ) : analytics?.position.score != null ? (
        <>
          <p className="text-3xl font-bold text-[color:var(--text-primary)]">
            {analytics.position.score.toFixed(1)}
            <span className="text-base font-normal text-[color:var(--text-faint)]">/10</span>
          </p>
          <p className="text-xs text-[color:var(--text-faint)] mt-1">
            {analytics.position.score <= 4
              ? 'Mentioned early in responses'
              : analytics.position.score <= 7
              ? 'Mentioned mid-way in responses'
              : 'Mentioned late in responses'}{' '}
            · {analytics.position.sample_count} samples
          </p>
        </>
      ) : (
        <>
          <p className="text-3xl font-bold text-[color:var(--text-primary)]">—</p>
          <p className="text-xs text-[color:var(--text-faint)] mt-1">No mentions recorded</p>
        </>
      )}
    </Card>
  );
}
```

- [ ] **Step 2: Replace + import**

In `frontend/app/dashboard/page.tsx`, replace the Avg Position inline block (around lines 877–910) with:

```tsx
<AvgPositionCard analytics={analytics} loadingAnalytics={loadingAnalytics} />
```

Add import:

```tsx
import { AvgPositionCard } from '@/components/dashboard/AvgPositionCard';
```

- [ ] **Step 3: Type-check + commit**

```bash
cd frontend
npx tsc --noEmit 2>&1 | head -10
cd /Users/ken/Desktop/Lumidian
git add -u frontend/components/dashboard/AvgPositionCard.tsx
git commit -m "refactor(dashboard): extract AvgPositionCard component"
```

---

### Task 2.6: Extract `<UpgradeModal>` from dashboard

**Files:**
- Create: `frontend/components/dashboard/UpgradeModal.tsx`
- Modify: `frontend/app/dashboard/page.tsx`

- [ ] **Step 1: Create the component**

Create `frontend/components/dashboard/UpgradeModal.tsx`:

```tsx
'use client';

import Link from 'next/link';
import { Zap } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';

interface UpgradeModalProps {
  open: boolean;
  reason: string;
  onClose: () => void;
}

export function UpgradeModal({ open, reason, onClose }: UpgradeModalProps) {
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <Zap size={20} className="text-[color:var(--accent)] mb-1" />
          <DialogTitle>Upgrade your plan</DialogTitle>
        </DialogHeader>
        <p className="text-xs text-[color:var(--text-muted)]">{reason}</p>
        <DialogFooter className="mt-4">
          <Button variant="outline" size="sm" onClick={onClose} className="flex-1">
            Dismiss
          </Button>
          <Button asChild size="sm" variant="default" className="flex-1">
            <Link href="/settings/billing">View plans</Link>
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 2: Replace + import**

In `frontend/app/dashboard/page.tsx`, replace the inline `<Dialog open={upgradeModalOpen}...>` block with:

```tsx
<UpgradeModal
  open={upgradeModalOpen}
  reason={upgradeModalReason}
  onClose={() => setUpgradeModalOpen(false)}
/>
```

Add import:

```tsx
import { UpgradeModal } from '@/components/dashboard/UpgradeModal';
```

Remove now-unused imports of `Dialog`, `DialogContent`, etc., and `Button`, `Zap`, `Link` if not used elsewhere in the file (check first).

- [ ] **Step 3: Type-check + commit**

```bash
cd frontend
npx tsc --noEmit 2>&1 | head -10
cd /Users/ken/Desktop/Lumidian
git add -u frontend/components/dashboard/UpgradeModal.tsx
git commit -m "refactor(dashboard): extract UpgradeModal component"
```

---

### Task 2.7: Consolidate dashboard empty states with `<EmptyState>`

**Files:**
- Modify: `frontend/app/dashboard/page.tsx`

- [ ] **Step 1: Identify the three inline empty states**

In `frontend/app/dashboard/page.tsx`:
- Empty 1: "Track your first brand" (lines ~622–651) — brands.length === 0
- Empty 2: "No data yet" (lines ~654–683) — brand selected but no runs
- Empty 3: "Running your first AI visibility report..." (lines ~685–696) — isFirstRun

- [ ] **Step 2: Replace each with `<EmptyState>`**

For Empty 1, replace with:

```tsx
import { EmptyState } from '@/components/ui/empty-state';
import { Zap, BarChart2, Loader2, Plus, Play, PauseCircle } from 'lucide-react';

// In render:
<EmptyState
  icon={<Zap size={24} />}
  title="Track your first brand"
  body="Add your brand, define the prompts you want AI models to mention you for, and we'll run an instant visibility report and generate content drafts automatically."
  action={
    <Link
      href="/onboarding"
      className="flex items-center gap-2 bg-[color:var(--accent-muted)] hover:bg-[color:var(--accent-muted)] border border-[color:var(--accent-border)] text-[color:var(--accent-light)] hover:shadow-[0_0_24px_var(--accent-muted)] rounded-lg px-6 py-3 text-sm font-semibold transition-colors"
    >
      <Plus size={16} />
      Get Started
    </Link>
  }
/>
```

Note: the original Empty 1 includes a 3-step explainer below the empty state. Keep that as a separate sibling section (it isn't part of the empty state primitive — it's a static feature explainer).

For Empty 2:

```tsx
<EmptyState
  icon={<BarChart2 size={24} />}
  title="No data yet"
  body="Run your first AI visibility report to see how often your brand appears across ChatGPT, Claude, Perplexity, and Gemini."
  action={
    isSubscriptionPaused ? (
      <Link href="/settings/billing" className="...existing styles...">
        <PauseCircle size={14} /> Upgrade to Run Reports
      </Link>
    ) : (
      <button onClick={handleRunReport} disabled={triggering || isRunning} className="...existing styles...">
        {triggering || isRunning ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />}
        {isRunning ? 'Running...' : 'Run First Report'}
      </button>
    )
  }
/>
```

For Empty 3:

```tsx
<EmptyState
  icon={<Loader2 size={24} className="animate-spin" />}
  title="Running your first AI visibility report..."
  body="This takes 1-2 minutes. We'll auto-generate content drafts when it's done."
/>
```

- [ ] **Step 3: Type-check + visual + commit**

```bash
cd frontend
npx tsc --noEmit 2>&1 | head -10
npm run dev
```

Visit `/dashboard` in 3 states: (1) no brands (delete all brands for test, then re-create), (2) brand but no runs, (3) first run in progress. Verify each empty state renders consistently using the signature-gradient icon background.

Stop dev server.

```bash
cd /Users/ken/Desktop/Lumidian
git add -u
git commit -m "refactor(dashboard): consolidate 3 empty states via EmptyState primitive"
```

---

### Task 2.8: Settings split — set up shell + create tab files

**Files:**
- Create: `frontend/components/settings/ProfileTab.tsx`
- Create: `frontend/components/settings/BillingTab.tsx`
- Create: `frontend/components/settings/SchedulerTab.tsx`
- Create: `frontend/components/settings/ApiKeysTab.tsx`
- Create: `frontend/components/settings/IntegrationsTab.tsx`
- Modify: `frontend/app/settings/page.tsx`

- [ ] **Step 1: Read the current settings page**

```bash
wc -l frontend/app/settings/page.tsx
```

Expected: ~1,926 lines. Open the file and identify tab boundaries — they're typically `useState` for `activeTab` + a switch/conditional render. Map each tab's JSX block.

- [ ] **Step 2: Create each tab component**

For each of the 5 tabs:
1. Identify the JSX block in `settings/page.tsx` rendering that tab.
2. Identify which state, handlers, and API calls are used inside that block.
3. Create the component file accepting those as props (or fetch internally if self-contained).

Example skeleton for `ProfileTab.tsx`:

```tsx
'use client';

import { useState, useEffect } from 'react';
import { Card } from '@/components/ui/card';
import { Heading } from '@/components/ui/heading';
import { Button } from '@/components/ui/button';
import { authMe, updateProfile } from '@/lib/api';
import type { AuthUser } from '@/lib/api';

interface ProfileTabProps {
  user: AuthUser;
  onUserUpdated: (u: AuthUser) => void;
}

export function ProfileTab({ user, onUserUpdated }: ProfileTabProps) {
  // ... extracted state + JSX from settings/page.tsx's Profile section
  return (
    <Card padding="lg">
      <Heading level={2} className="mb-4">Profile</Heading>
      {/* ... rest of the extracted Profile tab JSX ... */}
    </Card>
  );
}
```

Repeat for `BillingTab`, `SchedulerTab`, `ApiKeysTab`, `IntegrationsTab`. Each file should be ≤300 lines.

- [ ] **Step 3: Shrink `settings/page.tsx` to a tab-switching shell**

Rewrite `frontend/app/settings/page.tsx` to be ~80 lines:

```tsx
'use client';

import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Heading } from '@/components/ui/heading';
import { useAuth } from '@/contexts/AuthContext';
import { ProfileTab } from '@/components/settings/ProfileTab';
import { BillingTab } from '@/components/settings/BillingTab';
import { SchedulerTab } from '@/components/settings/SchedulerTab';
import { ApiKeysTab } from '@/components/settings/ApiKeysTab';
import { IntegrationsTab } from '@/components/settings/IntegrationsTab';

type TabKey = 'profile' | 'billing' | 'scheduler' | 'api-keys' | 'integrations';

const TABS: { key: TabKey; label: string }[] = [
  { key: 'profile', label: 'Profile' },
  { key: 'billing', label: 'Billing' },
  { key: 'scheduler', label: 'Scheduler' },
  { key: 'api-keys', label: 'API Keys' },
  { key: 'integrations', label: 'Integrations' },
];

export default function SettingsPage() {
  const router = useRouter();
  const params = useSearchParams();
  const { user, refreshUser } = useAuth();
  const [activeTab, setActiveTab] = useState<TabKey>(
    (params.get('tab') as TabKey) ?? 'profile',
  );

  useEffect(() => {
    const t = params.get('tab') as TabKey | null;
    if (t && TABS.some((x) => x.key === t)) setActiveTab(t);
  }, [params]);

  useEffect(() => {
    document.title = 'Settings — Lumidian';
  }, []);

  function switchTab(t: TabKey) {
    setActiveTab(t);
    router.replace(`/settings?tab=${t}`, { scroll: false });
  }

  if (!user) return null;

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-8 py-8">
      <Heading level={1} className="mb-6">Settings</Heading>
      <div className="flex gap-1 border-b border-[color:var(--border-subtle)] mb-6">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => switchTab(t.key)}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
              activeTab === t.key
                ? 'border-[color:var(--accent)] text-[color:var(--text-primary)]'
                : 'border-transparent text-[color:var(--text-muted)] hover:text-[color:var(--text-secondary)]'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>
      {activeTab === 'profile' && <ProfileTab user={user} onUserUpdated={() => refreshUser()} />}
      {activeTab === 'billing' && <BillingTab user={user} />}
      {activeTab === 'scheduler' && <SchedulerTab />}
      {activeTab === 'api-keys' && <ApiKeysTab />}
      {activeTab === 'integrations' && <IntegrationsTab />}
    </div>
  );
}
```

- [ ] **Step 4: Type-check + visual walkthrough**

```bash
cd frontend
npx tsc --noEmit 2>&1 | head -30
npm run dev
```

Visit `/settings`, click through all 5 tabs. Confirm every interaction (form submits, button clicks, modal opens) works as before. Check `?tab=billing` deep-link still routes correctly.

Stop dev server.

- [ ] **Step 5: Confirm line counts**

```bash
wc -l frontend/app/settings/page.tsx frontend/components/settings/*.tsx
```

Expected: page.tsx ≤100 lines; each tab ≤300 lines.

- [ ] **Step 6: Commit**

```bash
cd /Users/ken/Desktop/Lumidian
git add frontend/app/settings/page.tsx frontend/components/settings/
git commit -m "refactor(settings): split 1926-line page into 5 tab components"
```

---

### Task 2.9: Landing split — create section components

**Files:**
- Create: `frontend/components/landing/LandingHeader.tsx`
- Create: `frontend/components/landing/LandingHero.tsx`
- Create: `frontend/components/landing/LandingModelsBar.tsx`
- Create: `frontend/components/landing/LandingFeatures.tsx`
- Create: `frontend/components/landing/LandingHowItWorks.tsx`
- Create: `frontend/components/landing/LandingPricing.tsx`
- Create: `frontend/components/landing/LandingFAQ.tsx`
- Create: `frontend/components/landing/LandingCTA.tsx`
- Create: `frontend/components/landing/LandingFooter.tsx`
- Create: `frontend/components/landing/DashboardMockup.tsx`
- Create: `frontend/components/landing/constants.ts` (the FEATURES/AI_MODELS/HOW_STEPS/COMPARISON_FEATURES/FAQ_ITEMS/DEMO_MODELS/DEMO_GAPS data arrays)
- Modify: `frontend/app/page.tsx`

- [ ] **Step 1: Extract data arrays into `constants.ts`**

Create `frontend/components/landing/constants.ts`. Move the data arrays from `app/page.tsx` (lines 137–266: `FEATURES`, `AI_MODELS`, `HOW_STEPS`, `COMPARISON_FEATURES`, `FAQ_ITEMS`, `DEMO_MODELS`, `DEMO_GAPS`) into this file as named exports.

- [ ] **Step 2: Extract each section component**

For each of the 10 section component files, move the function definition from `app/page.tsx` into its own file. Each file imports its own data from `constants.ts`, imports motion primitives from `@/lib/motion`, and is a 'use client' module.

For instance, `frontend/components/landing/LandingHero.tsx`:

```tsx
'use client';

import Link from 'next/link';
import { Play } from 'lucide-react';
import { FadeUp, ScaleIn } from '@/lib/motion';
import { Heading } from '@/components/ui/heading';
import { DashboardMockup } from './DashboardMockup';

export function LandingHero() {
  return (
    <section className="relative min-h-screen flex items-center justify-center pt-20 pb-16 overflow-hidden">
      <div
        className="absolute inset-0 pointer-events-none"
        style={{ background: 'var(--gradient-signature)' }}
      />
      <div className="relative z-10 max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
        <FadeUp>
          <div className="inline-flex items-center gap-2 bg-[color:var(--bg-raised)] border border-[color:var(--accent-border)] rounded-full px-4 py-1.5 mb-8">
            <span className="w-2 h-2 rounded-full bg-[color:var(--success)] animate-pulse" />
            <span className="text-sm text-[color:var(--text-secondary)]">Now tracking 4 AI models</span>
          </div>
        </FadeUp>
        <FadeUp delay={100}>
          <Heading level="display" className="text-4xl sm:text-5xl md:text-6xl lg:text-7xl">
            Track Your Brand&apos;s
            <br />
            <span className="text-[color:var(--accent)]">Visibility in AI</span>
            {' — Then Fix It'}
          </Heading>
        </FadeUp>
        <FadeUp delay={200}>
          <p className="mt-6 text-lg sm:text-xl text-[color:var(--text-secondary)] max-w-2xl mx-auto leading-relaxed">
            Monitor how ChatGPT, Claude, Perplexity, and Gemini talk about your brand.
            Find where you&apos;re missing — then fix it with targeted, AI-drafted content.
          </p>
        </FadeUp>
        <FadeUp delay={300}>
          <div className="mt-10 flex flex-col sm:flex-row items-center justify-center gap-4">
            <Link
              href="/register"
              className="flex items-center gap-2 text-lg font-semibold text-[color:var(--text-on-accent)] px-8 py-4 rounded-full bg-[color:var(--accent)] hover:bg-[color:var(--accent-hover)] transition-[background-color,box-shadow] shadow-lg hover:shadow-xl"
            >
              <Play size={18} fill="white" />
              Start Free
            </Link>
            <Link
              href="/login"
              className="text-lg font-medium text-[color:var(--text-primary)] px-6 py-4 rounded-full border border-[color:var(--border-default)] hover:border-[color:var(--text-primary)] hover:bg-[color:var(--bg-tinted)] transition-[border-color,background-color]"
            >
              Log in
            </Link>
          </div>
        </FadeUp>
        <ScaleIn delay={400} className="mt-16 hidden sm:block">
          <DashboardMockup />
        </ScaleIn>
      </div>
    </section>
  );
}
```

Note: this revision removes the dot-grid (per spec, dot-grid spreads in Task 2.13 as a shared element) and replaces both hero gradient + orb with the single `--gradient-signature`. The "tightened hero" from spec section "Surface 1 — Landing."

Repeat for all 10 components, each in its own file, each consuming `lib/motion` primitives and design tokens (no hardcoded colors).

- [ ] **Step 3: Rewrite `app/page.tsx` as a thin orchestrator**

Replace `frontend/app/page.tsx` entirely with:

```tsx
'use client';

import { useEffect, useState } from 'react';
import { LandingHeader } from '@/components/landing/LandingHeader';
import { LandingHero } from '@/components/landing/LandingHero';
import { LandingModelsBar } from '@/components/landing/LandingModelsBar';
import { LandingFeatures } from '@/components/landing/LandingFeatures';
import { LandingHowItWorks } from '@/components/landing/LandingHowItWorks';
import { LandingPricing } from '@/components/landing/LandingPricing';
import { LandingFAQ } from '@/components/landing/LandingFAQ';
import { LandingCTA } from '@/components/landing/LandingCTA';
import { LandingFooter } from '@/components/landing/LandingFooter';

export default function LandingPage() {
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const handler = () => setScrolled(window.scrollY > 20);
    window.addEventListener('scroll', handler, { passive: true });
    return () => window.removeEventListener('scroll', handler);
  }, []);

  return (
    <div className="min-h-screen bg-[color:var(--bg-base)] text-[color:var(--text-primary)] relative">
      <LandingHeader scrolled={scrolled} />
      <main>
        <LandingHero />
        <LandingModelsBar />
        <LandingFeatures />
        <LandingHowItWorks />
        <LandingPricing />
        <LandingFAQ />
        <LandingCTA />
      </main>
      <LandingFooter />

      {/* Dot-grid texture — spans hero + features, fades at edges */}
      <div
        className="absolute top-0 left-0 right-0 pointer-events-none"
        style={{
          height: 'calc(100vh + 600px)',
          backgroundImage: 'radial-gradient(circle, rgba(148,163,184,0.8) 1px, transparent 1px)',
          backgroundSize: '32px 32px',
          opacity: 0.15,
          maskImage: 'linear-gradient(to bottom, transparent 0%, black 8%, black 75%, transparent 100%)',
          WebkitMaskImage: 'linear-gradient(to bottom, transparent 0%, black 8%, black 75%, transparent 100%)',
        }}
      />
    </div>
  );
}
```

Now ~50 lines (down from 1,146).

- [ ] **Step 4: Type-check + lint**

```bash
cd frontend
npx tsc --noEmit 2>&1 | head -30
npm run lint 2>&1 | tail -20
```

Expected: clean.

- [ ] **Step 5: Visual walkthrough**

```bash
npm run dev
```

Open `http://localhost:3000`. Walk through hero, models bar, features (hover each card), how-it-works (read steps), pricing (try mobile + desktop variants), FAQ (expand each), CTA (orb still drifts), footer. Confirm scroll-triggered animations still play. Compare to the saved Phase 1 screenshots to confirm no regression.

Stop dev server.

- [ ] **Step 6: Confirm line counts**

```bash
wc -l frontend/app/page.tsx frontend/components/landing/*.tsx frontend/components/landing/constants.ts
```

Expected: each landing component ≤200 lines; `app/page.tsx` ≤80 lines.

- [ ] **Step 7: Commit**

```bash
cd /Users/ken/Desktop/Lumidian
git add frontend/app/page.tsx frontend/components/landing/
git commit -m "refactor(landing): split 1146-line page into 9 section components + constants"
```

---

### Task 2.10: Onboarding token sweep + `<StepProgress>` + form primitives

**Files:**
- Create: `frontend/components/ui/step-progress.tsx`
- Create: `frontend/components/ui/text-field.tsx`
- Create: `frontend/components/ui/url-field.tsx`
- Modify: `frontend/app/onboarding/page.tsx`

- [ ] **Step 1: Create `<StepProgress>`**

Create `frontend/components/ui/step-progress.tsx`:

```tsx
import { Check } from 'lucide-react';

interface StepProgressProps {
  current: number;
  total: number;
  labels?: string[];
  className?: string;
}

export function StepProgress({ current, total, labels, className = '' }: StepProgressProps) {
  return (
    <div className={`flex items-center gap-2 ${className}`}>
      {Array.from({ length: total }).map((_, i) => {
        const stepNum = i + 1;
        const isComplete = stepNum < current;
        const isActive = stepNum === current;
        return (
          <div key={i} className="flex items-center gap-2 flex-1">
            <div
              className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold transition-[background-color,color] duration-300 ${
                isComplete
                  ? 'bg-[color:var(--success)] text-white'
                  : isActive
                  ? 'bg-[color:var(--accent)] text-[color:var(--text-on-accent)]'
                  : 'bg-[color:var(--bg-tinted)] text-[color:var(--text-muted)]'
              }`}
            >
              {isComplete ? <Check size={12} strokeWidth={3} /> : stepNum}
            </div>
            {labels && (
              <span
                className={`text-xs font-medium ${
                  isActive ? 'text-[color:var(--text-primary)]' : 'text-[color:var(--text-muted)]'
                }`}
              >
                {labels[i]}
              </span>
            )}
            {i < total - 1 && (
              <div
                className={`flex-1 h-px transition-colors duration-300 ${
                  isComplete ? 'bg-[color:var(--success)]' : 'bg-[color:var(--border-subtle)]'
                }`}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 2: Create `<TextField>` and `<UrlField>`**

Create `frontend/components/ui/text-field.tsx`:

```tsx
import { type InputHTMLAttributes, type ReactNode } from 'react';

interface TextFieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> {
  label: string;
  hint?: ReactNode;
  error?: string;
}

export function TextField({ label, hint, error, className = '', id, ...rest }: TextFieldProps) {
  const inputId = id ?? `field-${label.toLowerCase().replace(/\s+/g, '-')}`;
  return (
    <div className={`flex flex-col gap-1.5 ${className}`}>
      <label htmlFor={inputId} className="text-sm font-medium text-[color:var(--text-secondary)]">
        {label}
      </label>
      <input
        id={inputId}
        type="text"
        className={`input ${error ? 'border-[color:var(--danger)]' : ''}`}
        {...rest}
      />
      {hint && !error && <p className="text-xs text-[color:var(--text-muted)]">{hint}</p>}
      {error && <p className="text-xs text-[color:var(--danger-text)]">{error}</p>}
    </div>
  );
}
```

Create `frontend/components/ui/url-field.tsx` similar but with `type="url"` and a built-in `https://` placeholder hint.

- [ ] **Step 3: Refactor onboarding/page.tsx to use the new primitives**

In `frontend/app/onboarding/page.tsx`:
- Replace the inline step indicator (around lines 179+, the `stepLabels` array + rendering) with `<StepProgress current={step} total={3} labels={['Brand', 'Prompts', 'Profile']} />`.
- Replace inline `<input>` elements with `<TextField>` / `<UrlField>`.
- Replace the loading-bar fetching-website indicator with a signature-gradient progress ring (use `--gradient-signature` as the conic-gradient stroke).
- Token-sweep any remaining hex colors.

The signature gradient progress ring replacement:

```tsx
{fetching && (
  <div className="flex items-center gap-3 mt-3">
    <div
      className="w-5 h-5 rounded-full"
      style={{
        background: `conic-gradient(from 0deg, var(--accent), var(--accent-light), var(--accent))`,
        animation: 'spin 1s linear infinite',
        maskImage: 'radial-gradient(circle, transparent 50%, black 52%)',
        WebkitMaskImage: 'radial-gradient(circle, transparent 50%, black 52%)',
      }}
    />
    <span className="text-sm text-[color:var(--text-muted)]">Fetching website context…</span>
  </div>
)}
```

Add a `@keyframes spin` to `globals.css` if not already present (Tailwind ships `animate-spin` but the inline version above needs the keyframe declared).

- [ ] **Step 4: Type-check + visual**

```bash
cd frontend
npx tsc --noEmit 2>&1 | head -10
npm run dev
```

Visit `/onboarding` (sign out first if needed to trigger the flow). Step through all 3 steps. Verify the progress indicator, form field styles, and the new signature-gradient ring during website fetch.

- [ ] **Step 5: Commit**

```bash
cd /Users/ken/Desktop/Lumidian
git add frontend/components/ui/step-progress.tsx frontend/components/ui/text-field.tsx frontend/components/ui/url-field.tsx frontend/app/onboarding/page.tsx frontend/app/globals.css
git commit -m "feat(onboarding): adopt StepProgress + TextField primitives + signature ring on fetch"
```

---

### Task 2.11: Signature moment — model-color crescendo on tracking start

**Files:**
- Modify: `frontend/components/AppShell.tsx` (the `ReportRunningBanner` component within it)

- [ ] **Step 1: Identify the current rotation logic**

In `frontend/components/AppShell.tsx`, locate `function ReportRunningBanner` (around line 28). The current logic rotates through models every 2.2s via `setActiveIdx` and renders icons stacked with opacity-based crossfade.

- [ ] **Step 2: Add a one-time crescendo on first render**

Replace the existing `setInterval` rotation logic with this two-phase animation:

```tsx
function ReportRunningBanner({ modelScores, isMobile, promptCount }: { ... }) {
  const [activeIdx, setActiveIdx] = useState(0);
  const [crescendoPhase, setCrescendoPhase] = useState(true); // first 1.5s

  useEffect(() => {
    // Crescendo: rapidly pulse through all models in sequence
    const crescendoTimes = [0, 250, 500, 750]; // ms — each model "lights up"
    const timers = crescendoTimes.map((t, i) =>
      setTimeout(() => setActiveIdx(i), t),
    );
    const endCrescendo = setTimeout(() => {
      setCrescendoPhase(false);
      setActiveIdx(0);
    }, 1500);

    return () => {
      timers.forEach(clearTimeout);
      clearTimeout(endCrescendo);
    };
  }, []);

  useEffect(() => {
    if (crescendoPhase) return;
    // Quiet rotation: cycle every 2.2s
    const t = setInterval(() => setActiveIdx((i) => (i + 1) % MODEL_ORDER.length), 2200);
    return () => clearInterval(t);
  }, [crescendoPhase]);

  // ... rest of component unchanged
```

The visual effect: when tracking starts, the four model icons pulse rapidly in sequence (ChatGPT green → Claude orange → Perplexity purple → Gemini blue), then settle into the existing 2.2s rotation. Total crescendo: 1.5s.

- [ ] **Step 3: Verify**

```bash
cd frontend
npx tsc --noEmit 2>&1 | head -10
npm run dev
```

Trigger a tracking run from `/dashboard`. Watch the report-running banner appear — confirm the four model icons pulse in sequence at startup, then settle.

Stop dev server.

- [ ] **Step 4: Commit**

```bash
cd /Users/ken/Desktop/Lumidian
git add -u frontend/components/AppShell.tsx
git commit -m "feat(motion): add model-color crescendo to ReportRunningBanner

Four AI model icons pulse in sequence (ChatGPT → Claude → Perplexity →
Gemini) for 1.5s when a tracking run starts, then settle into quiet
rotation. Uses existing model color tokens — no new tokens added."
```

---

### Task 2.12: Signature moment — visibility score upsized + glow

**Files:**
- Modify: `frontend/components/dashboard/VisibilityChart.tsx`

- [ ] **Step 1: Identify the score render**

In `frontend/components/dashboard/VisibilityChart.tsx`, find the `<p>` (or `<span>`) rendering the headline visibility score. It currently uses `.stat-value-lg` (36px) or a Tailwind class with `text-5xl` or similar.

- [ ] **Step 2: Replace with `<Stat>` at size `lg`**

Change the score render to use the new `<Stat>` primitive:

```tsx
import { Stat } from '@/components/ui/stat';

// In render, replacing the existing inline score number:
<Stat
  value={Math.round(score)}
  size="lg"
  label={isMobile ? undefined : 'AI Visibility Score'}
  suffix="%"
  trend={scoreDelta}
  className="relative"
/>
```

Then add a subtle glow behind the stat block. Wrap or apply via inline style:

```tsx
<div style={{ textShadow: '0 0 24px oklch(0.58 0.06 235 / 0.15)' }}>
  <Stat ... />
</div>
```

Result: 56px score (up from 36px) with a slate-blue glow halo. Sparkline below remains as-is.

- [ ] **Step 3: Verify**

```bash
cd frontend
npx tsc --noEmit 2>&1 | head -10
npm run dev
```

Visit `/dashboard`. The visibility score should be visibly larger and slightly luminescent on dark background — should immediately read as the focal point.

Stop dev server.

- [ ] **Step 4: Commit**

```bash
cd /Users/ken/Desktop/Lumidian
git add -u
git commit -m "feat(design): upsize visibility score with signature glow halo

Score 36px → 56px via <Stat size=\"lg\">. text-shadow adds subtle
slate-blue glow that makes the score the unambiguous focal point."
```

---

### Task 2.13: Signature moment — dot-grid spread

**Files:**
- Create: `frontend/components/ui/dot-grid-bg.tsx`
- Modify: `frontend/components/ui/empty-state.tsx` (optionally embed dot-grid behind icon)
- Modify: `frontend/components/dashboard/VisibilityChart.tsx` (optionally behind score)

- [ ] **Step 1: Create `<DotGridBackground>`**

Create `frontend/components/ui/dot-grid-bg.tsx`:

```tsx
interface DotGridBackgroundProps {
  className?: string;
  /** Fade direction — 'edges' fades top + bottom, 'top' fades top only */
  fade?: 'edges' | 'top' | 'bottom';
  /** Opacity multiplier (default 0.15) */
  opacity?: number;
}

const FADE_MASK: Record<NonNullable<DotGridBackgroundProps['fade']>, string> = {
  edges: 'linear-gradient(to bottom, transparent 0%, black 12%, black 88%, transparent 100%)',
  top: 'linear-gradient(to bottom, transparent 0%, black 20%, black 100%)',
  bottom: 'linear-gradient(to bottom, black 0%, black 80%, transparent 100%)',
};

export function DotGridBackground({
  className = '',
  fade = 'edges',
  opacity = 0.15,
}: DotGridBackgroundProps) {
  return (
    <div
      className={`absolute inset-0 pointer-events-none ${className}`}
      style={{
        backgroundImage: 'radial-gradient(circle, rgba(148,163,184,0.8) 1px, transparent 1px)',
        backgroundSize: '32px 32px',
        opacity,
        maskImage: FADE_MASK[fade],
        WebkitMaskImage: FADE_MASK[fade],
      }}
    />
  );
}
```

- [ ] **Step 2: Replace the dot-grid in `app/page.tsx`**

Replace the inline dot-grid `<div>`s at the bottom of `frontend/app/page.tsx` with:

```tsx
<DotGridBackground fade="edges" opacity={0.15} className="h-[calc(100vh+600px)] top-0" />
<DotGridBackground fade="edges" opacity={0.10} className="h-[500px] bottom-0 top-auto" />
```

- [ ] **Step 3: Add dot-grid behind the visibility score card**

In `frontend/components/dashboard/VisibilityChart.tsx`, wrap the score render:

```tsx
<div className="relative overflow-hidden rounded-[var(--radius-lg)]">
  <DotGridBackground fade="bottom" opacity={0.08} />
  <div className="relative z-10">
    {/* existing score Stat render */}
  </div>
</div>
```

- [ ] **Step 4: Add dot-grid to the no-data empty state on dashboard**

In `frontend/app/dashboard/page.tsx`, when rendering Empty 2 ("No data yet"), wrap the `<EmptyState>` in:

```tsx
<div className="relative overflow-hidden rounded-[var(--radius-lg)] py-8">
  <DotGridBackground fade="edges" opacity={0.08} />
  <div className="relative z-10">
    <EmptyState ... />
  </div>
</div>
```

- [ ] **Step 5: Type-check + visual**

```bash
cd frontend
npx tsc --noEmit 2>&1 | head -10
npm run dev
```

Verify:
- Landing dot-grid still renders.
- Dashboard visibility score has subtle dot-grid behind it.
- "No data yet" empty state has a textured background.

Stop dev server.

- [ ] **Step 6: Commit**

```bash
cd /Users/ken/Desktop/Lumidian
git add frontend/components/ui/dot-grid-bg.tsx frontend/app/page.tsx frontend/components/dashboard/VisibilityChart.tsx frontend/app/dashboard/page.tsx
git commit -m "feat(design): spread dot-grid texture via shared DotGridBackground

Landing keeps existing dot-grid. New consumers: visibility-score card
backdrop (subtle, opacity 0.08) + dashboard \"no data\" empty state."
```

---

### Task 2.14: Signature moment — mention-cite micro-moment

**Files:**
- Modify: `frontend/components/ResponsesTable.tsx` or the equivalent expand-row component

- [ ] **Step 1: Find the row-expansion component**

```bash
cd /Users/ken/Desktop/Lumidian
grep -rln "expandedConvId\|expandedPromptId" frontend/components/ 2>/dev/null | head -5
```

The expansion lives wherever conversation rows render. Likely candidates: `ResponsesTable.tsx`, or `components/dashboard/BrandTable.tsx`.

- [ ] **Step 2: Add a brief glow on expand**

In the component that renders the model icon when a row is expanded, add:

```tsx
import { useEffect, useState } from 'react';

function ModelIconGlow({ model, expanded }: { model: string; expanded: boolean }) {
  const [glow, setGlow] = useState(false);

  useEffect(() => {
    if (expanded) {
      setGlow(true);
      const t = setTimeout(() => setGlow(false), 600);
      return () => clearTimeout(t);
    }
  }, [expanded]);

  const modelColor = `var(--color-${model})`;
  return (
    <div
      className="relative"
      style={{
        filter: glow ? `drop-shadow(0 0 8px ${modelColor})` : 'none',
        transition: 'filter 600ms cubic-bezier(0.32, 0.72, 0, 1)',
      }}
    >
      <ModelIcon model={model} />
    </div>
  );
}
```

Use this wrapper around model icons inside the expanded row only.

- [ ] **Step 3: Type-check + visual**

```bash
cd frontend
npx tsc --noEmit 2>&1 | head -10
npm run dev
```

Open `/dashboard`. Expand a Recent Conversations row. Confirm the model icon briefly glows in its brand color, then fades out over ~600ms.

Stop dev server.

- [ ] **Step 4: Commit**

```bash
cd /Users/ken/Desktop/Lumidian
git add -u
git commit -m "feat(motion): brief model-color glow on conversation row expand"
```

---

### Task 2.15: Phase 2 final verification + open PR

**Files:**
- (no code changes — verification only)

- [ ] **Step 1: Re-run audit + check line counts**

```bash
cd /Users/ken/Desktop/Lumidian
./scripts/audit/count-hardcoded-colors.sh
echo "---"
echo "Page file line counts:"
find frontend/app -name "page.tsx" -exec wc -l {} \; | sort -rn | head -10
```

Expected: hardcoded color count still <300 (no regression from Phase 1). All `page.tsx` files under 350 lines (cluster detail is excepted).

- [ ] **Step 2: Full check**

```bash
cd frontend
npx tsc --noEmit 2>&1 | tail -10
npm run lint 2>&1 | tail -20
npm run build 2>&1 | tail -30
```

Expected: all three pass.

- [ ] **Step 3: Lighthouse on landing**

```bash
npm run build
npm run start
```

In Chrome devtools, open `http://localhost:3000`, run Lighthouse on "Performance" only.

Expected: Performance ≥90 (per success criteria).

Stop server.

- [ ] **Step 4: Recorded walkthrough**

Start `npm run dev`. Record a 60-second screen capture demonstrating all 5 signature moments:
1. Click "Run report" from `/dashboard` → see model-color crescendo in banner.
2. Scroll `/dashboard` → visibility score is large + glowing, dot-grid subtle behind it.
3. Open `/dashboard` with no brand → empty state uses gradient icon + dot-grid texture.
4. Step through `/onboarding` → see signature progress ring during website fetch.
5. Expand a conversation row → model icon glows briefly.

Save the recording to `docs/design-cleanup/screenshots/phase2/walkthrough.mp4` (or .gif if smaller).

- [ ] **Step 5: Cross-page consistency check**

Visit `/dashboard`, `/content`, `/wiki` (any empty state). The empty-state primitive should render visually identically across all three surfaces.

- [ ] **Step 6: Push + open PR**

```bash
cd /Users/ken/Desktop/Lumidian
git push -u origin feat/design-cleanup-surfaces
gh pr create --base main --title "feat(design): surface deep-clean + signature moments (Phase 2)" --body "$(cat <<'EOF'
## Summary
Consumes the Phase 1 substrate. Four large page files refactored; five signature character moments added.

**Surfaces refactored:**
- `app/page.tsx` (landing): 1,146 → ~50 lines (9 section components in `components/landing/`)
- `app/dashboard/page.tsx`: 1,025 → ~280 lines (SOVCard, SentimentCard, AvgPositionCard, UpgradeModal extracted; 3 empty states consolidated)
- `app/settings/page.tsx`: 1,926 → ~80 lines (5 tab components in `components/settings/`)
- `app/onboarding/page.tsx`: token sweep + StepProgress + TextField/UrlField + signature progress ring

**Five signature moments:**
1. Model-color crescendo on tracking start (ReportRunningBanner)
2. Signature gradient deployed in EmptyState primitive (auto-applied to ~9 empty states)
3. Dot-grid texture spread via `<DotGridBackground>` (landing, score card, empty states)
4. Visibility score upsized 36 → 56px with slate-blue glow
5. Brief model-color glow on conversation row expand

**Tokens added:** 8 competitor color tokens (`--comp-color-1..8`) for SOV palette.

Spec: `docs/superpowers/specs/2026-05-27-design-cleanup-design.md`
Plan: `docs/superpowers/plans/2026-05-27-design-cleanup.md`

## Test plan
- [ ] `npm run build` clean
- [ ] `tsc --noEmit` clean
- [ ] `npm run lint` clean
- [ ] No `page.tsx` exceeds 350 lines (cluster detail excepted)
- [ ] Lighthouse Performance on `/` ≥90
- [ ] Recorded walkthrough demonstrates all 5 signature moments
- [ ] Empty state renders identically on /dashboard, /content, /wiki

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

Expected: PR URL returned. Phase 2 is complete.

---

## Self-review (post-write)

Reviewed against the spec — coverage map:

| Spec requirement | Plan task |
|------------------|-----------|
| `--bg-tinted`, `--bg-tinted-hover`, `--border-faint`, `--text-on-accent`, shadow tokens, signature gradient | Task 1.3 |
| Typography scale tokens (`--text-display`..`--text-mono-sm`) | Task 1.3 |
| Remove dead keyframes (slideInLeft/Right, drawLine, dup glow-pulse) + orb-drift consolidation | Task 1.4 |
| `.bg-tinted` utilities + `.btn-*` removal | Tasks 1.3, 1.12 |
| `<Heading>`, `<Card>`, `<EmptyState>`, `<Stat>` primitives | Tasks 1.5, 1.6, 1.7, 1.8 |
| `useInView`, `FadeUp`, `ScaleIn` in lib/motion | Task 1.9 |
| Color codemod (1,434 → <300) | Task 1.11 |
| Button system consolidation | Task 1.12 |
| Audit script | Task 1.2 |
| Landing split into 9 section components | Task 2.9 |
| Dashboard extractions (SOVCard, SentimentCard, AvgPositionCard, UpgradeModal) + EmptyState consolidation | Tasks 2.3-2.7 |
| Settings split into 5 tab components | Task 2.8 |
| Onboarding StepProgress + TextField + signature ring | Task 2.10 |
| Signature moment 1: model-color crescendo | Task 2.11 |
| Signature moment 2: signature gradient spread | Baked into Task 1.7 (EmptyState ships it) + Task 2.10 (onboarding ring) |
| Signature moment 3: dot-grid spread | Task 2.13 |
| Signature moment 4: visibility score upsize + glow | Task 2.12 |
| Signature moment 5: mention-cite micro-moment | Task 2.14 |
| Competitor color tokens (`--comp-color-1..8`) | Task 2.2 |
| Both phases verified + PR'd | Tasks 1.13, 2.15 |

Coverage is complete. No placeholders. Type-consistent (`<EmptyState>` props match across all consumer tasks; `<Card>` `padding` enum matches; competitor color tokens defined before SOVCard consumes them).

