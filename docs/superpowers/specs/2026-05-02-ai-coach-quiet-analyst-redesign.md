# AI Visibility Coach — "Quiet Analyst" Redesign

**Date:** 2026-05-02
**Branch:** feat/ai-coach
**Frame:** A (Quiet analyst) · A2 (asymmetric, borderless assistant) · B2 (brand-aware briefing)

## Goal

Restyle and tighten the dashboard's AI visibility coach so it reads as a credible, dark-themed analyst panel instead of a generic light-mode chatbot. Apply Emil-Kowalski-style motion (curve-based, short, never bouncy) and impeccable-grade visual discipline so the coach matches the dashboard it lives inside. Add a brand-aware opening briefing so Lumi acts before the user types.

## Non-Goals

- Persistent global FAB / launcher (decision: keep contextual `AskCoachButton` only).
- Cross-session message persistence.
- Edit-question-before-send affordance for `AskCoachButton` (will be a separate follow-up).
- Mobile-specific layout work beyond making the drawer full-width on `<sm`.

## Problems being fixed

1. **Theme mismatch.** Drawer is hard-coded `bg-white` / `text-slate-900` on a dark dashboard (`var(--bg-base)`, `var(--text-primary: #f8fafc)`). Visually feels grafted on.
2. **Generic Radix slide.** Uses Tailwind's `slide-in-from-right`, ignores `--ease-drawer: cubic-bezier(0.32, 0.72, 0, 1)` already in `globals.css`.
3. **No streaming feedback.** Text appends with no caret; tool-status pills appear all at once with no spinner / completion cue.
4. **No markdown rendering.** Assistant output uses `whitespace-pre-wrap` only — bullets, bold, links, code render as raw chars.
5. **Bare empty state.** "Hi — I'm Lumi" + 3 generic chips. No personality, no anchoring on the user's actual data.
6. **Anemic header.** Single word "Lumi" + usage pill — no identity beat.
7. **Off-palette controls.** Send button uses `bg-slate-900` instead of `var(--accent)`.

## Architecture

The coach already separates cleanly:

```
CoachShell (layout boundary)
  └─ CoachProvider (state, send loop, openWith)
      ├─ {dashboard children}
      └─ CoachDrawer
          ├─ Header (title + UsagePill + close)
          ├─ MessageList (or Briefing when empty)
          └─ CoachInput (or LimitHitCard when capped)
```

This redesign is mostly **visual reskin + motion** inside that structure, plus **one new endpoint** (`GET /api/coach/{brand_id}/briefing`) that powers the brand-aware empty state. The reducer and SSE flow are unchanged.

### State additions in `CoachContext`

- `briefing: CoachBriefing | null`
- `briefingLoading: boolean`
- Action: `set_briefing` (called when drawer opens or brand changes)
- Briefing is fetched on `open` / `openWith` alongside `refreshUsage`.

## Component changes

### `CoachDrawer.tsx` — full reskin + Emil drawer animation

- Replace Radix Dialog's `data-[state=open]:slide-in-from-right` with `framer-motion` `motion.div` driven by Radix open state, animating `transform: translateX(100% → 0)` over 360ms on `--ease-drawer`. Overlay fades 200ms ease-out (`bg-black/60 backdrop-blur-sm`).
- Panel: `bg-[var(--bg-card)]`, left border `1px var(--border-default)`, soft shadow leaking left.
- Width: `w-full sm:w-[440px] sm:max-w-[440px]`.
- Header (~64px):
  - Lumi mark: 12px `var(--accent)` dot inside a 24px `var(--accent-muted)` ring; idle 2.4s opacity pulse 0.6 ↔ 1 (ease-in-out).
  - Two-line block: "Lumi" 14px semibold `--text-primary`; "Visibility analyst" 11px `--text-faint` `tracking-wide`.
  - Right group: restyled `UsagePill` + close button (X 16px, `--text-secondary` → `--text-primary` on hover, 1px hover background `rgba(255,255,255,0.06)`).
  - Border-bottom `var(--border-subtle)`.

### `Briefing.tsx` (new) — brand-aware empty state

- Mounts when `state.messages.length === 0` and `state.brandId != null`.
- Layout (vertical, 16px gaps):
  1. 28px Lumi avatar (radial gradient: accent → accent-muted, no face).
  2. Faint label `BRIEFING · {date}` 10px `--text-faint` tracking-wide.
  3. Briefing body: 3 short lines, 14px `--text-primary`, leading 1.55. No markdown.
  4. Chip row: 3 chips, `bg-[rgba(255,255,255,0.04)]` `border var(--border-subtle)` `rounded-md` `px-3 py-1.5` `text-[12px]` `--text-secondary`; hover `bg-[rgba(255,255,255,0.07)]`. Click → `send(chip)`.
  5. Microcopy: "Or ask anything below" `--text-faint` 11px.
- Stagger fade-up (8px → 0, 200ms each, 60ms apart, `--ease-out`).
- Loading state: skeleton lines (3 shimmer bars) instead of avatar+text.
- Failure state: graceful fallback to **B3 static chips** ("Walk me through this run.", "What changed since last week?", "Where am I leaking visibility?") with no briefing line. Never blocks drawer open.

### `MessageList.tsx` — A2 asymmetric layout

- User turn (right-aligned):
  - `bg-[var(--accent-muted)]` `border var(--accent-border)` `text-[var(--text-primary)]`
  - `rounded-2xl rounded-tr-md` `px-3.5 py-2.5` `max-w-[86%] text-sm`
- Assistant turn (left-aligned, no bubble):
  - Plain body text, `text-[var(--text-primary)]` 14px leading-[1.55] `max-w-[92%]`
  - Markdown rendered through new `AssistantMarkdown` component
- Tool-status row above streaming assistant text — see `ToolStatus.tsx` below.
- Streaming caret (see `StreamingCaret.tsx`) appended at the tail of in-progress text.
- Per-turn entry animation: framer-motion `motion.div` initial `opacity: 0, y: 6` → `opacity: 1, y: 0`, 200ms `--ease-out`. Animate only the latest turn, not full re-mount.
- 28px gap between turns (`space-y-7`).

### `AssistantMarkdown.tsx` (new)

- Wraps `react-markdown` + `remark-gfm`.
- Custom renderers:
  - `strong` → `text-[var(--accent-light)] font-semibold`
  - `code` (inline) → `bg-[rgba(255,255,255,0.06)] text-[var(--accent-light)] font-mono text-[13px] px-1 rounded`
  - `pre` → block `bg-[rgba(255,255,255,0.04)] border var(--border-subtle) rounded-md p-3 text-[13px]`, mono
  - `a` → underline accent, target=_blank rel=noopener
  - `ul / ol` → tight spacing (space-y-1), 14px
  - `li` → marker color `var(--accent)` for `ul`
  - `table` → minimal, 12px, border `--border-subtle`
- Paragraphs: `mb-2 last:mb-0`.

### `StreamingCaret.tsx` (new)

- 1.5px wide, 0.9em tall `bg-[var(--accent-light)]`, blinking via CSS `animation: caret-blink 530ms steps(1,start) infinite`.
- Inline span at the end of the streaming text node (positioned via flexbox, vertically aligned with text).
- Renders only while parent message has `inProgress: true`.

### `ToolStatus.tsx` (new)

- Row of stacked tool entries, each: italic 11px `text-[var(--text-faint)]`, prefixed by an animated indicator:
  - In progress: 3 dots fading in sequence (200ms each, 600ms total cycle).
  - Done (next assistant text starts): swap dots → ✓ glyph in `text-[var(--success-text)]`, 200ms cross-fade.
- Persists across the turn — does **not** disappear once done. Cleared on next user turn.
- Mounts above the assistant text content, separated by 6px.

### `CoachInput.tsx` — auto-resize, accent focus, icon send

- Container: `border-top var(--border-subtle)` `bg-[var(--bg-card)]` `px-4 py-3`.
- Textarea:
  - Auto-resize 1 → 5 lines (then internal scroll). Use a small ref-based `useAutoResize` hook (compute `scrollHeight` clamped to 5 line-heights).
  - `bg-[rgba(255,255,255,0.03)]` `border var(--border-default)` `rounded-md` `px-3 py-2` `text-sm` `text-[var(--text-primary)]` `placeholder-[var(--text-faint)]`.
  - Focus: `border var(--accent)` + `box-shadow 0 0 0 3px var(--accent-muted)`.
  - Placeholder picked once at mount from a 3-item rotation (e.g. "Ask why Reddit is leaking…", "Ask what to fix first…", "Ask anything about your visibility…"). Static within the session, no animation cycling.
- Send button:
  - Icon-only `ArrowUp` lucide 16px, 32×32, rounded-md, `bg-[var(--accent)] text-white`.
  - Press: scale 0.94, 120ms `--ease-out` rebound (framer-motion `whileTap`).
  - Disabled: `bg-[rgba(255,255,255,0.06)] text-[var(--text-faint)]` cursor-not-allowed.
- Hint row (below): only when textarea is focused (fade-in 150ms). `kbd`-styled chips: `⌘` `Enter` (or `Ctrl` `Enter` on non-mac), each `bg-[rgba(255,255,255,0.06)] border var(--border-subtle) text-[var(--text-faint)] text-[10px] px-1.5 rounded`.
- Behavior: ⌘/Ctrl + Enter submits (existing behavior preserved). Plain Enter inserts newline (current behavior preserved).

### `UsagePill.tsx` — dark restyle

- `bg-[rgba(255,255,255,0.04)] border var(--border-subtle) text-[var(--text-faint)] text-[11px] tabular-nums px-2 py-0.5 rounded-md`.
- ≥80%: `bg-[rgba(245,158,11,0.10)] border var(--warning-text) text-[var(--warning-text)]`.
- At limit: `bg-[rgba(239,68,68,0.10)] border var(--danger-text) text-[var(--danger-text)]`, label "Limit reached".

### `LimitHitCard.tsx` — dark restyle

- `bg-[var(--bg-raised)] border var(--border-subtle) rounded-md p-4`.
- Title `text-[var(--text-primary)]` semibold; subtext `text-[var(--text-secondary)]`; resets-at `text-[var(--text-faint)]`.
- Upgrade button: `bg-[var(--accent)] text-white hover:bg-[var(--accent-hover)]`.
- Pro fallback copy: `text-[var(--text-faint)]`.

## Backend changes

### New endpoint: `GET /api/coach/{brand_id}/briefing`

**File:** `backend/app/routers/coach.py` (extend), `backend/app/services/coach_briefing.py` (new).

**Behavior:**

1. Auth + brand ownership (reuse `_verify_brand`).
2. Check 5-min in-memory cache keyed by `brand_id`.
3. On miss: gather facts via existing `coach_tools` handlers — `get_run_summary`, `get_competitor_landscape`, `get_citation_gaps`. These already enforce ownership and are token-budgeted.
4. Call Anthropic `claude-haiku-4-5-20251001` with a tight system prompt: "Compose a 2–3-sentence visibility briefing in the voice of a quiet analyst. Then propose three short follow-up questions the user is likely to ask. Output JSON: `{briefing: str, chips: [str, str, str]}`. Do not exceed 80 words in the briefing." Max output tokens 256, no tools.
5. Parse JSON, validate shape, return:
   ```json
   { "briefing": "...", "chips": ["...", "...", "..."], "generated_at": "<iso>" }
   ```
6. Cache for 5 minutes.

**Failure modes:**
- Tools fail / no run data → return `{briefing: null, chips: <static fallback>}` with HTTP 200. Frontend treats `briefing: null` as "show fallback chips, no briefing line."
- Anthropic call times out (5s ceiling) or returns invalid JSON → same fallback behavior, 200 response.
- Anthropic key missing → same fallback.

**Rate limit:** does NOT count against the daily message cap (it's a load action, not a user-initiated turn). Bound by 1 request / brand / 60s via in-memory throttle to prevent rapid open/close storms.

**Tests** (`backend/tests/test_coach_briefing.py`):
- 200 returns `{briefing, chips}` shape with three chips.
- 404 for non-owned brand.
- 401 unauthenticated.
- Fallback chips returned when tool calls return empty.
- Cache hit on second call (mock LLM, assert called once).

### Frontend wiring

**`frontend/lib/coach-types.ts`:**
```ts
export interface CoachBriefing {
  briefing: string | null;
  chips: string[];
  generated_at: string;
}
```

**`frontend/lib/api.ts`:** add `getCoachBriefing(brandId: number): Promise<CoachBriefing>`.

**`frontend/contexts/CoachContext.tsx`:**
- New state: `briefing: CoachBriefing | null`, `briefingLoading: boolean`.
- Action: `set_briefing` (sets both, clears loading).
- Action: `start_briefing_load` (sets loading=true).
- `open()` and `openWith()` trigger fetch alongside `refreshUsage`.
- Reset briefing on `reset_for_brand`.

## Dependencies to add

- `react-markdown` (~12kb gzipped)
- `remark-gfm` (~18kb gzipped)
- No others. `framer-motion` is already installed.

## Testing

### Backend
- `test_coach_briefing.py` — see test bullets above.
- Existing coach tests must continue to pass (nothing changes in `run_turn` or rate-limit flow).

### Frontend
- The project has no frontend test suite (per CLAUDE.md). Verify by running the dev server (`npm run dev` on port 3002, backend on 3001) and exercising:
  1. Open the dashboard, click "Why this score?" — drawer slides in with Emil curve, briefing renders, click a chip, response streams with caret + tool-status row.
  2. Theme: drawer is dark, no white surfaces, accent matches dashboard cards.
  3. Markdown: assistant response with bullets and bold renders correctly.
  4. Limit hit: usage pill flips amber/red appropriately, `LimitHitCard` is dark.
  5. Briefing failure: with `ANTHROPIC_API_KEY` unset, fallback chips appear, drawer still works.
  6. Mobile width (<640px): drawer is full-width.

## Spec self-review

- [x] No TBDs.
- [x] Architecture matches feature description (reducer additions enumerated).
- [x] Tool-status persistence is unambiguous: stays visible until next user turn.
- [x] Briefing failure path is explicit and matches the existing CLAUDE.md "Graceful API Key Handling" pattern.
- [x] Scope: single PR, single implementation plan. No decomposition needed.
- [x] Dependency additions are listed; size justified.
- [x] Mobile behavior specified (full-width <sm).
- [x] Animation timings inventoried; nothing exceeds 360ms; no spring physics.
