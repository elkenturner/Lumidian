# Progress Banner Redesign

**Date:** 2026-04-08
**Scope:** Redesign the three progress/status banners (draft generation, opportunity scanning, report loading) with animated accent styling and rotating platform/LLM logos.

---

## Problem

The current progress banners are plain indigo boxes with a `Loader2` spinner and static text. They feel disconnected from the premium UI and give no visual sense of what's being processed.

## Solution

A shared `ProgressBanner` component with:
- Animated gradient shimmer bar
- Glowing pulsing border
- Rotating logo carousel showing the platforms/models being queried
- Consistent accent-themed visual language

---

## Components

### 1. `ProgressBanner` (new — `frontend/components/ProgressBanner.tsx`)

Reusable component used by all three banners.

**Props:**
```ts
interface ProgressBannerItem {
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
```

**Layout:**
- Rounded-xl container with radial gradient background (`rgba(99,102,241,0.08)` center fading out)
- Border: `rgba(99,102,241,0.3)` with animated box-shadow glow pulse (2s cycle, `0 0 20px` to `0 0 30px` in accent color)
- Left side: 48x48 rounded-lg logo area with platform-tinted background; icon + label crossfade every 2.5s
- Right side: title (sm font-medium) + subtitle (xs text-secondary)
- Bottom: 3px shimmer bar — CSS gradient (`indigo → purple → indigo`) sliding left-to-right in a loop (2s linear infinite)

**CSS animations (all keyframes, no JS libs):**
- `@keyframes shimmer` — `background-position` shift for the bottom bar
- `@keyframes glow-pulse` — `box-shadow` oscillation on the container
- Logo crossfade: `useEffect` with `setInterval(2500)` cycling an index; icons use `opacity` + `transition: opacity 0.4s ease` for smooth crossfade via absolute positioning within the logo area

### 2. `ModelIcon` (new — `frontend/components/ModelIcon.tsx`)

SVG lettermark icons for LLMs, matching the `PlatformIcon` pattern.

**Renders:** Styled letter from `MODEL_CONFIG.letter` field in the model's brand color, inside an SVG. Uses the same `memo` + props pattern as `PlatformIcon`.

```ts
interface ModelIconProps {
  model: string;       // 'chatgpt' | 'claude' | 'perplexity' | 'gemini'
  size?: number;       // default 16
  color?: string;      // default from MODEL_CONFIG
  className?: string;
}
```

Each model gets a distinct font treatment:
- ChatGPT: bold sans-serif "G" in `var(--color-chatgpt)`
- Claude: bold sans-serif "C" in `var(--color-claude)`
- Perplexity: bold sans-serif "P" in `var(--color-perplexity)`
- Gemini: bold sans-serif "G" in `var(--color-gemini)`

---

## Banner Instances

### Draft Generation Banner
- **Location:** `frontend/app/content/page.tsx`, replaces lines 2009-2023 (the `generating` branch)
- **Title:** "Generating fresh drafts..."
- **Subtitle:** "Creating up to 20 AI drafts. This takes about 30 seconds."
- **Items:** Reddit, Quora, LinkedIn, X, Medium — using `PlatformIcon` + colors from `PLATFORM_STYLES`

### Opportunity Scanning Banner
- **Location:** `frontend/app/content/page.tsx`, same conditional block (the `scanning` branch)
- **Title:** "Scanning for new opportunities..."
- **Subtitle:** "Finding new content opportunities. This takes about 15 seconds."
- **Items:** Reddit, Quora, LinkedIn, X — using `PlatformIcon` + colors from `PLATFORM_STYLES`

### Report Loading Banner
- **Location:** `frontend/app/reports/page.tsx`, replaces skeleton at lines 366-370 (the `loading` state)
- **Title:** "Loading report data..."
- **Subtitle:** "Pulling latest visibility scores across models."
- **Items:** ChatGPT, Claude, Perplexity, Gemini — using `ModelIcon` + colors from `MODEL_CONFIG`

---

## Technical Details

### Logo Rotation Mechanism
```tsx
const [activeIndex, setActiveIndex] = useState(0);

useEffect(() => {
  if (items.length <= 1) return;
  const interval = setInterval(() => {
    setActiveIndex((prev) => (prev + 1) % items.length);
  }, 2500);
  return () => clearInterval(interval);
}, [items.length]);
```

Icons are absolutely positioned in the logo container. Each has `opacity: activeIndex === i ? 1 : 0` with `transition: opacity 0.4s ease`.

### Shimmer Bar CSS
```css
@keyframes shimmer {
  0% { background-position: -200% 0; }
  100% { background-position: 200% 0; }
}
```
Applied to a 3px-tall pseudo-element at the banner bottom with `background: linear-gradient(90deg, transparent, rgba(99,102,241,0.5), rgba(168,85,247,0.5), transparent)` and `background-size: 200% 100%`.

### Glow Pulse CSS
```css
@keyframes glow-pulse {
  0%, 100% { box-shadow: 0 0 20px rgba(99,102,241,0.15); }
  50% { box-shadow: 0 0 30px rgba(99,102,241,0.25); }
}
```

### No External Dependencies
All animations are CSS keyframes. Logo rotation uses a single `setInterval`. No animation libraries added.

---

## Files Changed

| File | Change |
|------|--------|
| `frontend/components/ProgressBanner.tsx` | **New** — shared banner component |
| `frontend/components/ModelIcon.tsx` | **New** — LLM lettermark icons |
| `frontend/app/content/page.tsx` | Replace lines 2009-2023 with `ProgressBanner` instances for generating/scanning |
| `frontend/app/reports/page.tsx` | Replace skeleton at lines 366-370 with `ProgressBanner` for loading state |

## Files NOT Changed

- `PlatformIcon.tsx` — reused as-is
- `PlatformBadge.tsx` — not used in banners (banners use icons directly)
- `MODEL_CONFIG` / `models.ts` — reused as-is
