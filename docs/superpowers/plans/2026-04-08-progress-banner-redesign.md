# Progress Banner Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the plain progress banners on the content and reports pages with animated accent-styled banners featuring rotating platform/LLM logos.

**Architecture:** A single reusable `ProgressBanner` component handles all visual effects (shimmer bar, glow pulse, logo crossfade). Two new icon components (`ModelIcon`) provide LLM lettermarks. The content page and reports page each swap their existing inline loading UI for `ProgressBanner` instances.

**Tech Stack:** React 18, TypeScript, Tailwind CSS, CSS keyframes (no animation libraries)

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `frontend/components/ModelIcon.tsx` | Create | SVG lettermark icons for ChatGPT, Claude, Perplexity, Gemini |
| `frontend/components/ProgressBanner.tsx` | Create | Shared animated banner with shimmer, glow, logo rotation |
| `frontend/app/content/page.tsx` | Modify (lines 2008-2023) | Replace inline banner with `ProgressBanner` for generating/scanning |
| `frontend/app/reports/page.tsx` | Modify (lines 366-370) | Replace skeleton with `ProgressBanner` for loading state |

---

### Task 1: Create `ModelIcon` Component

**Files:**
- Create: `frontend/components/ModelIcon.tsx`

- [ ] **Step 1: Create the ModelIcon component**

```tsx
'use client';

import { memo } from 'react';
import { MODEL_ORDER, MODEL_CONFIG, type ModelKey } from '@/lib/constants/models';

interface ModelIconProps {
  model: string;
  size?: number;
  color?: string;
  className?: string;
}

const FONT_MAP: Record<ModelKey, { letter: string; weight: number; family: string }> = {
  chatgpt:    { letter: 'G', weight: 800, family: 'system-ui, sans-serif' },
  claude:     { letter: 'C', weight: 800, family: 'system-ui, sans-serif' },
  perplexity: { letter: 'P', weight: 800, family: 'system-ui, sans-serif' },
  gemini:     { letter: 'G', weight: 800, family: 'system-ui, sans-serif' },
};

function normalize(model: string): ModelKey | null {
  const lower = model.toLowerCase().replace(/[-_\s]/g, '');
  for (const key of MODEL_ORDER) {
    if (lower.includes(key)) return key;
  }
  return null;
}

const ModelIcon = memo(function ModelIcon({ model, size = 16, color, className }: ModelIconProps) {
  const key = normalize(model);
  if (!key) return null;

  const font = FONT_MAP[key];
  const fill = color ?? MODEL_CONFIG[key].color;

  return (
    <span className={`inline-flex items-center justify-center ${className ?? ''}`}>
      <svg width={size} height={size} viewBox="0 0 20 20" fill="none">
        <text
          x="50%"
          y="52%"
          dominantBaseline="central"
          textAnchor="middle"
          fill={fill}
          fontSize="14"
          fontWeight={font.weight}
          fontFamily={font.family}
        >
          {font.letter}
        </text>
      </svg>
    </span>
  );
});

export default ModelIcon;
```

- [ ] **Step 2: Verify it renders**

Run: `cd /Users/ken/Desktop/Lumidian/frontend && npm run build 2>&1 | head -20`
Expected: Build succeeds (or at least no TypeScript errors in ModelIcon.tsx)

- [ ] **Step 3: Commit**

```bash
git add frontend/components/ModelIcon.tsx
git commit -m "feat: add ModelIcon component for LLM lettermark icons"
```

---

### Task 2: Create `ProgressBanner` Component

**Files:**
- Create: `frontend/components/ProgressBanner.tsx`

- [ ] **Step 1: Create the ProgressBanner component**

```tsx
'use client';

import { memo, useEffect, useState, type ReactNode } from 'react';

export interface ProgressBannerItem {
  key: string;
  label: string;
  icon: ReactNode;
  color: string;
}

interface ProgressBannerProps {
  title: string;
  subtitle: string;
  items: ProgressBannerItem[];
}

const ProgressBanner = memo(function ProgressBanner({ title, subtitle, items }: ProgressBannerProps) {
  const [activeIndex, setActiveIndex] = useState(0);

  useEffect(() => {
    if (items.length <= 1) return;
    const interval = setInterval(() => {
      setActiveIndex((prev) => (prev + 1) % items.length);
    }, 2500);
    return () => clearInterval(interval);
  }, [items.length]);

  const activeItem = items[activeIndex];

  return (
    <div className="mb-6 relative overflow-hidden rounded-xl border border-[rgba(99,102,241,0.3)] animate-[glow-pulse_2s_ease-in-out_infinite]"
      style={{ background: 'radial-gradient(ellipse at 30% 50%, rgba(99,102,241,0.10) 0%, rgba(99,102,241,0.03) 70%, transparent 100%)' }}
    >
      <div className="px-5 py-4 flex items-center gap-4">
        {/* Rotating logo area */}
        <div className="relative w-12 h-12 shrink-0">
          {items.map((item, i) => (
            <div
              key={item.key}
              className="absolute inset-0 flex flex-col items-center justify-center rounded-lg transition-opacity duration-400 ease-in-out"
              style={{
                opacity: i === activeIndex ? 1 : 0,
                background: `${item.color}15`,
                border: `1px solid ${item.color}30`,
              }}
            >
              <span className="flex items-center justify-center" style={{ width: 20, height: 20 }}>
                {item.icon}
              </span>
              <span className="text-[8px] font-bold mt-0.5 leading-none" style={{ color: item.color }}>
                {item.label}
              </span>
            </div>
          ))}
        </div>

        {/* Text */}
        <div className="min-w-0">
          <p className="text-sm font-medium text-[var(--text-primary)]">{title}</p>
          <p className="text-xs text-[var(--text-secondary)] mt-0.5">{subtitle}</p>
        </div>
      </div>

      {/* Shimmer bar */}
      <div
        className="h-[3px] w-full animate-[shimmer_2s_linear_infinite]"
        style={{
          background: 'linear-gradient(90deg, transparent, rgba(99,102,241,0.5), rgba(168,85,247,0.5), transparent)',
          backgroundSize: '200% 100%',
        }}
      />

      {/* Inline keyframes */}
      <style jsx>{`
        @keyframes shimmer {
          0% { background-position: -200% 0; }
          100% { background-position: 200% 0; }
        }
        @keyframes glow-pulse {
          0%, 100% { box-shadow: 0 0 20px rgba(99,102,241,0.12), 0 0 6px rgba(99,102,241,0.06); }
          50% { box-shadow: 0 0 30px rgba(99,102,241,0.22), 0 0 12px rgba(99,102,241,0.10); }
        }
      `}</style>
    </div>
  );
});

export default ProgressBanner;
```

**Note on `style jsx`:** Next.js supports styled-jsx out of the box. This keeps keyframes scoped to the component without a global CSS file. If the project uses a different CSS approach, these keyframes can be moved to `globals.css` instead — but styled-jsx works here with zero config.

- [ ] **Step 2: Verify it compiles**

Run: `cd /Users/ken/Desktop/Lumidian/frontend && npx tsc --noEmit 2>&1 | grep -i "ProgressBanner" | head -10`
Expected: No errors referencing ProgressBanner.tsx

- [ ] **Step 3: Commit**

```bash
git add frontend/components/ProgressBanner.tsx
git commit -m "feat: add ProgressBanner component with shimmer, glow, and logo rotation"
```

---

### Task 3: Wire Up Content Page Banners

**Files:**
- Modify: `frontend/app/content/page.tsx:2008-2023` (replace inline banner)

- [ ] **Step 1: Add imports to the top of content/page.tsx**

Add these imports near the existing import block (around line 30):

```tsx
import ProgressBanner from '@/components/ProgressBanner';
import PlatformIcon from '@/components/PlatformIcon';
```

`PlatformIcon` may already be imported — check first and skip if so.

- [ ] **Step 2: Replace the inline progress banner**

Replace lines 2008-2023 (the `{/* Progress banner for regeneration actions */}` block) with:

```tsx
      {/* Progress banner for regeneration actions */}
      {generating && (
        <ProgressBanner
          title="Generating fresh drafts…"
          subtitle="Creating up to 20 AI drafts. This takes about 30 seconds."
          items={[
            { key: 'reddit', label: 'Reddit', icon: <PlatformIcon platform="reddit" size={18} color="#FF4500" />, color: '#FF4500' },
            { key: 'quora', label: 'Quora', icon: <PlatformIcon platform="quora" size={18} color="#B92B27" />, color: '#B92B27' },
            { key: 'linkedin', label: 'LinkedIn', icon: <PlatformIcon platform="linkedin" size={18} color="#0A66C2" />, color: '#0A66C2' },
            { key: 'x', label: 'X', icon: <PlatformIcon platform="x" size={18} color="var(--text-secondary)" />, color: 'var(--text-secondary)' },
            { key: 'medium', label: 'Medium', icon: <PlatformIcon platform="medium" size={18} color="var(--text-secondary)" />, color: 'var(--text-secondary)' },
          ]}
        />
      )}
      {scanning && (
        <ProgressBanner
          title="Scanning for new opportunities…"
          subtitle="Finding new content opportunities. This takes about 15 seconds."
          items={[
            { key: 'reddit', label: 'Reddit', icon: <PlatformIcon platform="reddit" size={18} color="#FF4500" />, color: '#FF4500' },
            { key: 'quora', label: 'Quora', icon: <PlatformIcon platform="quora" size={18} color="#B92B27" />, color: '#B92B27' },
            { key: 'linkedin', label: 'LinkedIn', icon: <PlatformIcon platform="linkedin" size={18} color="#0A66C2" />, color: '#0A66C2' },
            { key: 'x', label: 'X', icon: <PlatformIcon platform="x" size={18} color="var(--text-secondary)" />, color: 'var(--text-secondary)' },
          ]}
        />
      )}
```

- [ ] **Step 3: Remove unused Loader2 import if no longer needed**

Check if `Loader2` is still used elsewhere in the file. It almost certainly is (draft cards, buttons, etc.), so likely keep it. Only remove from the lucide import if `grep -c "Loader2" frontend/app/content/page.tsx` returns 1 (the import line only).

- [ ] **Step 4: Verify the build**

Run: `cd /Users/ken/Desktop/Lumidian/frontend && npm run build 2>&1 | tail -5`
Expected: Build succeeds

- [ ] **Step 5: Manual visual check**

Run dev server (`npm run dev`), navigate to Content Hub, trigger "Regenerate Drafts" or "Regenerate Live Opportunities" and confirm:
- Animated banner appears with rotating platform logos
- Shimmer bar animates at the bottom
- Glow pulse is visible on the border
- Logos crossfade every ~2.5 seconds
- Banner disappears when generation/scanning completes

- [ ] **Step 6: Commit**

```bash
git add frontend/app/content/page.tsx
git commit -m "feat: replace content page progress banners with animated ProgressBanner"
```

---

### Task 4: Wire Up Reports Page Banner

**Files:**
- Modify: `frontend/app/reports/page.tsx:366-370` (replace skeleton loading state)

- [ ] **Step 1: Add imports to reports/page.tsx**

Add near the existing imports at the top of the file:

```tsx
import ProgressBanner from '@/components/ProgressBanner';
import ModelIcon from '@/components/ModelIcon';
```

- [ ] **Step 2: Replace the skeleton loading state for the trend chart**

Replace lines 366-370 (the loading skeleton inside the trend chart `<div className="mb-4">` block):

```tsx
            {loading ? (
              <ProgressBanner
                title="Loading report data…"
                subtitle="Pulling latest visibility scores across models."
                items={[
                  { key: 'chatgpt', label: 'ChatGPT', icon: <ModelIcon model="chatgpt" size={18} />, color: 'var(--color-chatgpt)' },
                  { key: 'claude', label: 'Claude', icon: <ModelIcon model="claude" size={18} />, color: 'var(--color-claude)' },
                  { key: 'perplexity', label: 'Perplexity', icon: <ModelIcon model="perplexity" size={18} />, color: 'var(--color-perplexity)' },
                  { key: 'gemini', label: 'Gemini', icon: <ModelIcon model="gemini" size={18} />, color: 'var(--color-gemini)' },
                ]}
              />
            ) : (
```

The closing `) : (` and `<TrendChart data={trends} />` and closing tags after it remain unchanged.

- [ ] **Step 3: Verify the build**

Run: `cd /Users/ken/Desktop/Lumidian/frontend && npm run build 2>&1 | tail -5`
Expected: Build succeeds

- [ ] **Step 4: Manual visual check**

Navigate to Reports page, select a brand. On initial load, confirm:
- Animated banner with rotating LLM logos replaces the old skeleton
- Each model shows in its brand color (green for ChatGPT, orange for Claude, cyan for Perplexity, blue for Gemini)
- Banner transitions to the TrendChart once data loads

- [ ] **Step 5: Commit**

```bash
git add frontend/app/reports/page.tsx
git commit -m "feat: replace reports skeleton with animated ProgressBanner showing LLM logos"
```

---

### Task 5: Polish and Final Verification

- [ ] **Step 1: Full build check**

Run: `cd /Users/ken/Desktop/Lumidian/frontend && npm run build`
Expected: Build succeeds with no errors or warnings related to new components.

- [ ] **Step 2: Verify styled-jsx works at runtime**

If `style jsx` causes issues at runtime (some Next.js configs disable it), the fix is to move keyframes to Tailwind config or `globals.css`. Check by running `npm run dev` and opening the content page — if animations don't work, move the keyframes:

Add to `frontend/app/globals.css` (or equivalent):
```css
@keyframes shimmer {
  0% { background-position: -200% 0; }
  100% { background-position: 200% 0; }
}
@keyframes glow-pulse {
  0%, 100% { box-shadow: 0 0 20px rgba(99,102,241,0.12), 0 0 6px rgba(99,102,241,0.06); }
  50% { box-shadow: 0 0 30px rgba(99,102,241,0.22), 0 0 12px rgba(99,102,241,0.10); }
}
```

And remove the `<style jsx>` block from `ProgressBanner.tsx`, replacing the Tailwind classes with standard animation utilities that reference these keyframes.

- [ ] **Step 3: Final commit (if globals.css was modified)**

```bash
git add frontend/components/ProgressBanner.tsx frontend/app/globals.css
git commit -m "fix: move keyframes to globals.css for styled-jsx compatibility"
```
