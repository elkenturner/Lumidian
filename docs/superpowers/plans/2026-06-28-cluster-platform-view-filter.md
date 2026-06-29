# Cluster Platform View-Filter + Prompt-Driven List — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a view-only platform switcher that hides platforms across all cluster views, and make the cluster list show every tracked prompt (with a "Generate cluster" CTA for prompts that have no cluster yet).

**Architecture:** Pure frontend change. A `useHiddenPlatforms(brandId)` hook persists the hidden-platform set in localStorage; a `PlatformFilter` chip row toggles it; list and detail views read it and filter which pieces/cards render. The cluster list merges `brand.prompts` (already fetched) with the cluster rows the backend returns, rendering a lightweight shell card for prompts without a cluster. No backend, schema, or API changes.

**Tech Stack:** Next.js 15 (App Router, client components), React 18, TypeScript (strict), Tailwind, lucide-react.

**Testing note:** This repo has **no frontend test suite** (see CLAUDE.md). Verification for every task is `npm run lint` + `npm run build` from `frontend/`, plus the manual browser checks listed in each task. There are no unit tests to write.

---

## Implementation status (actual — 2026-06-28)

**Re-scoped to view-filter only.** While executing, a concurrent "two-pool / eager-shell"
cluster redesign landed on `fix/resilient-tracking-runs`: `brands.py` now eagerly creates a
shell `ContentCluster` per prompt, so the cluster list already shows every prompt with a
"Generate cluster" CTA via the existing `ClusterCard` shell branch. That **delivers the
prompt-driven list (Option B) on its own**, so the following were dropped as redundant:
- **Task 4 (`PromptShellCard`)** — not built.
- **Task 6 prompt-merge** — only the platform-filter parts were built (PlatformFilter render +
  piece filtering); no `ungeneratedPrompts`/shell-card rendering.

**Shipped (commits on `fix/resilient-tracking-runs`):**
- `e856f70` — Task 1 (shared `clusterPlatforms.ts` constant; detail page uses local name `PLATFORMS`).
- `98c4337` — Tasks 2, 3, 5, and view-filter parts of 6 + 7.
- `778e2db` — fix: `useHiddenPlatforms` must be called **before** the cluster detail page's
  `loading`/`!cluster` early returns (Rules of Hooks). The plan's Task 7 placed it after them,
  which crashed the detail page once data loaded. Caught via live browser verification.

**Verified live** (Playwright, brand 2): filter chips render and toggle; hiding Reddit removes its
`PieceCard` on the detail page (5→4) and restores it (4→5); state persists in
`localStorage["cluster-hidden-platforms:2"]` and syncs across the list and detail surfaces.

---

## File Structure

**Create:**
- `frontend/lib/clusterPlatforms.ts` — single source of truth for the 5 cluster platforms + display labels.
- `frontend/lib/useHiddenPlatforms.ts` — localStorage-backed hook for the per-brand hidden-platform set.
- `frontend/components/content/cluster/PlatformFilter.tsx` — the chip-row switcher UI.
- `frontend/components/content/cluster/PromptShellCard.tsx` — card for a tracked prompt that has no cluster yet ("Generate cluster" CTA).

**Modify:**
- `frontend/app/content/[brandId]/page.tsx` — render `PlatformFilter`, filter pieces passed to `ClusterCard`, merge ungenerated prompts as shell cards.
- `frontend/components/content/cluster/ClusterCard.tsx` — clamp the green-dot count so a filtered piece list never renders more "posted" dots than visible pieces.
- `frontend/app/content/[brandId]/cluster/[clusterId]/page.tsx` — filter the Posts zone (and Posted history) by the hidden set; reuse the shared platform constant.

---

## Task 1: Shared cluster-platform constant

**Files:**
- Create: `frontend/lib/clusterPlatforms.ts`
- Modify: `frontend/app/content/[brandId]/cluster/[clusterId]/page.tsx:38`

- [ ] **Step 1: Create the shared constant module**

Create `frontend/lib/clusterPlatforms.ts`:

```ts
// The five platforms a content cluster generates pieces for.
// Wikipedia is intentionally excluded — it lives on its own surface.
// Order here is the canonical display order across cluster views.
//
// Typed as `readonly string[]` (NOT `as const`) on purpose: the detail page
// calls `PLATFORM_ORDER.includes(p)` with a plain `string`, which a literal
// tuple type would reject under strict TS.
export const CLUSTER_PLATFORMS: readonly string[] = ["linkedin", "medium", "reddit", "quora", "x"];

// Human-facing labels for the platform filter chips.
export const CLUSTER_PLATFORM_LABELS: Record<string, string> = {
  linkedin: "LinkedIn",
  medium: "Medium",
  reddit: "Reddit",
  quora: "Quora",
  x: "X",
};
```

- [ ] **Step 2: Reuse it in the detail page (DRY)**

In `frontend/app/content/[brandId]/cluster/[clusterId]/page.tsx`, the file currently declares its own list at line 38:

```ts
const PLATFORM_ORDER = ["linkedin", "medium", "reddit", "quora", "x"];
```

Replace that line with an import-based alias. Add to the existing import block near the top of the file:

```ts
import { CLUSTER_PLATFORMS } from "@/lib/clusterPlatforms";
```

And replace the `const PLATFORM_ORDER = [...]` line with:

```ts
const PLATFORM_ORDER = CLUSTER_PLATFORMS;
```

(Keeping the local name `PLATFORM_ORDER` avoids touching its other usages at lines 149–151.)

- [ ] **Step 3: Verify build + lint**

Run from `frontend/`:
```bash
npm run lint && npm run build
```
Expected: passes (no type errors — `CLUSTER_PLATFORMS` is a `readonly` tuple of strings, compatible with the existing `.filter`/`.includes` usage).

- [ ] **Step 4: Commit**

```bash
git add frontend/lib/clusterPlatforms.ts "frontend/app/content/[brandId]/cluster/[clusterId]/page.tsx"
git commit -m "refactor(content): extract shared cluster platform constant"
```

---

## Task 2: `useHiddenPlatforms` hook

**Files:**
- Create: `frontend/lib/useHiddenPlatforms.ts`

- [ ] **Step 1: Create the hook**

Create `frontend/lib/useHiddenPlatforms.ts`:

```ts
"use client";

import { useCallback, useEffect, useState } from "react";

function storageKey(brandId: number): string {
  return `cluster-hidden-platforms:${brandId}`;
}

function readHidden(brandId: number): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = window.localStorage.getItem(storageKey(brandId));
    if (!raw) return new Set();
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? new Set(arr.filter((x) => typeof x === "string")) : new Set();
  } catch {
    return new Set();
  }
}

/**
 * Per-brand, view-only set of platforms hidden from cluster surfaces.
 * Persisted in localStorage. Does NOT affect generation — purely a render filter.
 */
export function useHiddenPlatforms(brandId: number): {
  hidden: Set<string>;
  toggle: (platform: string) => void;
  isVisible: (platform: string) => boolean;
} {
  const [hidden, setHidden] = useState<Set<string>>(() => new Set());

  // Hydrate from localStorage after mount (avoids SSR/client mismatch).
  useEffect(() => {
    setHidden(readHidden(brandId));
  }, [brandId]);

  const toggle = useCallback(
    (platform: string) => {
      setHidden((prev) => {
        const next = new Set(prev);
        if (next.has(platform)) {
          next.delete(platform);
        } else {
          next.add(platform);
        }
        try {
          window.localStorage.setItem(storageKey(brandId), JSON.stringify([...next]));
        } catch {
          /* ignore quota/availability errors — filter is best-effort */
        }
        return next;
      });
    },
    [brandId],
  );

  const isVisible = useCallback((platform: string) => !hidden.has(platform), [hidden]);

  return { hidden, toggle, isVisible };
}
```

- [ ] **Step 2: Verify build + lint**

Run from `frontend/`:
```bash
npm run lint && npm run build
```
Expected: passes. (The hook is not yet imported anywhere; this just confirms it type-checks.)

- [ ] **Step 3: Commit**

```bash
git add frontend/lib/useHiddenPlatforms.ts
git commit -m "feat(content): add useHiddenPlatforms localStorage hook"
```

---

## Task 3: `PlatformFilter` switcher component

**Files:**
- Create: `frontend/components/content/cluster/PlatformFilter.tsx`

- [ ] **Step 1: Create the component**

Create `frontend/components/content/cluster/PlatformFilter.tsx`:

```tsx
"use client";

import { CLUSTER_PLATFORMS, CLUSTER_PLATFORM_LABELS } from "@/lib/clusterPlatforms";

interface Props {
  hidden: Set<string>;
  onToggle: (platform: string) => void;
}

/**
 * View-only platform switcher. A platform toggled off is hidden from cluster
 * views; it does NOT stop generation. State lives in useHiddenPlatforms.
 */
export function PlatformFilter({ hidden, onToggle }: Props) {
  return (
    <div className="flex items-center gap-1.5 text-[var(--text-faint)]">
      <span title="Show or hide platforms across all clusters. Does not affect generation.">
        Show:
      </span>
      {CLUSTER_PLATFORMS.map((platform) => {
        const on = !hidden.has(platform);
        return (
          <button
            key={platform}
            type="button"
            aria-pressed={on}
            onClick={() => onToggle(platform)}
            className={`px-2 py-1 rounded ${
              on
                ? "bg-[var(--bg-card)] text-[var(--text-primary)] font-medium"
                : "text-[var(--text-faint)] line-through hover:text-[var(--text-secondary)]"
            }`}
          >
            {CLUSTER_PLATFORM_LABELS[platform]}
          </button>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 2: Verify build + lint**

Run from `frontend/`:
```bash
npm run lint && npm run build
```
Expected: passes.

- [ ] **Step 3: Commit**

```bash
git add frontend/components/content/cluster/PlatformFilter.tsx
git commit -m "feat(content): add PlatformFilter switcher component"
```

---

## Task 4: `PromptShellCard` for ungenerated prompts

**Files:**
- Create: `frontend/components/content/cluster/PromptShellCard.tsx`

- [ ] **Step 1: Create the component**

Create `frontend/components/content/cluster/PromptShellCard.tsx`. This mirrors `ClusterCard`'s shell branch visually but is keyed by prompt (no cluster exists yet):

```tsx
"use client";

import { Sparkles, Loader2 } from "lucide-react";

interface Props {
  promptId: number;
  promptText: string;
  generating: boolean;
  onGenerate: (promptId: number) => void;
}

export function PromptShellCard({ promptId, promptText, generating, onGenerate }: Props) {
  return (
    <div className="card border-dashed flex flex-col gap-4">
      <h3 className="text-base font-semibold text-[var(--text-primary)] leading-snug line-clamp-2">
        {promptText}
      </h3>
      <p className="text-sm text-[var(--text-secondary)]">No cluster yet for this prompt.</p>
      <div className="pt-1 border-t border-[var(--border-subtle)]">
        <button
          type="button"
          disabled={generating}
          onClick={() => onGenerate(promptId)}
          className="inline-flex items-center gap-1.5 text-sm font-medium text-[var(--accent-foreground)] hover:text-[var(--text-primary)] disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {generating ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Sparkles className="h-3.5 w-3.5" />
          )}
          {generating ? "Generating…" : "Generate cluster"}
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify build + lint**

Run from `frontend/`:
```bash
npm run lint && npm run build
```
Expected: passes. (Component is unused so far — wired up in Task 6.)

- [ ] **Step 3: Commit**

```bash
git add frontend/components/content/cluster/PromptShellCard.tsx
git commit -m "feat(content): add PromptShellCard for ungenerated prompts"
```

---

## Task 5: Clamp posted-dot count in `ClusterCard`

**Why:** When the list filters out a platform's piece, `enabledPlatformCount` (= `pieces.length`) shrinks while `posted_count` (a prompt-level number from the backend) does not. The dot loop colors `i < postedCount` dots green; with fewer dots that could try to color more green dots than exist. Clamp it. **This is a no-op when nothing is hidden** (the loop already only runs `enabledPlatformCount` times), so default behavior is unchanged.

**Files:**
- Modify: `frontend/components/content/cluster/ClusterCard.tsx:19-20,59-71`

- [ ] **Step 1: Add the clamped value**

In `frontend/components/content/cluster/ClusterCard.tsx`, find (around line 18–21):

```tsx
  const isShell = cluster.status === "pending" && cluster.pieces.length === 0;
  const enabledPlatformCount = cluster.pieces.length;
  const postedCount = cluster.posted_count;
```

Add a clamped value right after `postedCount`:

```tsx
  const isShell = cluster.status === "pending" && cluster.pieces.length === 0;
  const enabledPlatformCount = cluster.pieces.length;
  const postedCount = cluster.posted_count;
  const postedDots = Math.min(postedCount, enabledPlatformCount);
```

- [ ] **Step 2: Use the clamped value in the dot loop**

Find the dot rendering (around line 59–68):

```tsx
            {Array.from({ length: enabledPlatformCount }).map((_, i) => (
              <span
                key={i}
                className={`inline-block h-2 w-2 rounded-full ${
                  i < postedCount
                    ? "bg-[#4ade80]"
                    : "border border-[var(--border-subtle)]"
                }`}
              />
            ))}
```

Change `i < postedCount` to `i < postedDots`:

```tsx
            {Array.from({ length: enabledPlatformCount }).map((_, i) => (
              <span
                key={i}
                className={`inline-block h-2 w-2 rounded-full ${
                  i < postedDots
                    ? "bg-[#4ade80]"
                    : "border border-[var(--border-subtle)]"
                }`}
              />
            ))}
```

Leave the `{postedCount} of {enabledPlatformCount} posts live` text as-is (it reflects the prompt-level posted total, which is intentional).

- [ ] **Step 3: Verify build + lint**

Run from `frontend/`:
```bash
npm run lint && npm run build
```
Expected: passes.

- [ ] **Step 4: Commit**

```bash
git add frontend/components/content/cluster/ClusterCard.tsx
git commit -m "fix(content): clamp ClusterCard posted dots to visible piece count"
```

---

## Task 6: Wire prompt-merge + filter into the cluster list page

**Files:**
- Modify: `frontend/app/content/[brandId]/page.tsx`

- [ ] **Step 1: Add imports**

At the top of `frontend/app/content/[brandId]/page.tsx`, add to the existing imports:

```tsx
import { useHiddenPlatforms } from "@/lib/useHiddenPlatforms";
import { PlatformFilter } from "@/components/content/cluster/PlatformFilter";
import { PromptShellCard } from "@/components/content/cluster/PromptShellCard";
```

- [ ] **Step 2: Use the hook in the component**

Inside `ContentBrandPage`, after the existing `useState` declarations (after line 46, the `regeneratingPromptId` state), add:

```tsx
  const { hidden, toggle, isVisible } = useHiddenPlatforms(brandId);
```

- [ ] **Step 3: Add a generate-by-prompt handler**

Below the existing `onRegenerate` function (after line 98), add a handler for shell cards. It reuses the same regenerate-by-prompt endpoint and the existing `regeneratingPromptId` state:

```tsx
  async function onGeneratePrompt(promptId: number) {
    setRegeneratingPromptId(promptId);
    try {
      await regenerateClusterByPrompt(brandId, promptId);
      const fresh = await listClusters(brandId);
      setClusters(fresh);
    } finally {
      setRegeneratingPromptId(null);
    }
  }
```

- [ ] **Step 4: Compute ungenerated prompts**

After the existing `visible` useMemo (after line 85), add a memo for prompts that have no cluster yet:

```tsx
  const ungeneratedPrompts = useMemo(() => {
    if (!brand) return [];
    const promptIdsWithCluster = new Set(clusters.map((c) => c.prompt_id));
    return brand.prompts.filter((p) => !promptIdsWithCluster.has(p.id));
  }, [brand, clusters]);
```

- [ ] **Step 5: Render the PlatformFilter in the controls row**

Find the controls row (the `<div className="flex flex-wrap items-center gap-3 text-xs">` block starting at line 131). Add the `PlatformFilter` as a new child at the end of that flex container, just before its closing `</div>` (line 158):

```tsx
        <PlatformFilter hidden={hidden} onToggle={toggle} />
```

- [ ] **Step 6: Filter pieces passed to ClusterCard**

Find the `ClusterCard` render (lines 168–176). Replace the `cluster={c}` prop with a filtered copy so hidden platforms' pieces don't count toward the card's dots/drafts display:

```tsx
          {visible.map((c) => (
            <ClusterCard
              key={c.id}
              brandId={brandId}
              cluster={{ ...c, pieces: c.pieces.filter((p) => isVisible(p.platform)) }}
              onRegenerate={onRegenerate}
              regenerating={regeneratingPromptId === c.prompt_id}
            />
          ))}
```

- [ ] **Step 7: Render shell cards for ungenerated prompts (only under the "all" filter)**

Replace the entire results block (lines 160–178, the `{visible.length === 0 ? ... : ...}` ternary) with a version that also renders shell cards. Shells only appear under the `all` filter (they have no status that maps to ready/in_progress/failed/needs_attention):

```tsx
      {visible.length === 0 && (filter !== "all" || ungeneratedPrompts.length === 0) ? (
        <div className="card border-dashed text-sm text-[var(--text-secondary)] text-center py-10">
          {clusters.length === 0 && ungeneratedPrompts.length === 0
            ? "No tracked prompts yet. Add prompts to this brand to generate clusters."
            : "No clusters match the current filter."}
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {visible.map((c) => (
            <ClusterCard
              key={c.id}
              brandId={brandId}
              cluster={{ ...c, pieces: c.pieces.filter((p) => isVisible(p.platform)) }}
              onRegenerate={onRegenerate}
              regenerating={regeneratingPromptId === c.prompt_id}
            />
          ))}
          {filter === "all" &&
            ungeneratedPrompts.map((p) => (
              <PromptShellCard
                key={`prompt-${p.id}`}
                promptId={p.id}
                promptText={p.text}
                generating={regeneratingPromptId === p.id}
                onGenerate={onGeneratePrompt}
              />
            ))}
        </div>
      )}
```

- [ ] **Step 8: Verify build + lint**

Run from `frontend/`:
```bash
npm run lint && npm run build
```
Expected: passes. Confirm no unused-variable lint error for `isVisible`/`hidden`/`toggle` (all are now used).

- [ ] **Step 9: Manual browser check**

Start the app (backend on 3001, frontend on 3002 per project setup) and open a brand with several tracked prompts where only some have clusters:
- Prompts without a cluster appear as dashed "Generate cluster" cards (under the "All" filter).
- Clicking "Generate cluster" kicks off generation (spinner), then the card becomes a real cluster card after reload.
- Toggling a platform off in the "Show:" row removes that platform's contribution to each cluster card's dots; toggling on restores it.
- Switching to a non-"All" filter hides the shell cards.

- [ ] **Step 10: Commit**

```bash
git add "frontend/app/content/[brandId]/page.tsx"
git commit -m "feat(content): prompt-driven cluster list + platform view-filter"
```

---

## Task 7: Apply the filter in the cluster detail page

**Files:**
- Modify: `frontend/app/content/[brandId]/cluster/[clusterId]/page.tsx:147-152,296,309-318`

- [ ] **Step 1: Add the hook import and usage**

In `frontend/app/content/[brandId]/cluster/[clusterId]/page.tsx`, add to the imports:

```tsx
import { useHiddenPlatforms } from "@/lib/useHiddenPlatforms";
```

Inside the page component, near the other derived state (e.g. just before the `draftsByPlatform` map at line 123), add:

```tsx
  const { isVisible } = useHiddenPlatforms(brandId);
```

(`brandId` is already defined in this component — it is used throughout, e.g. line 299.)

- [ ] **Step 2: Filter the Posts zone platform list**

Find the `platforms` derivation (lines 147–152):

```tsx
  const platforms = platformSet.size
    ? [
        ...PLATFORM_ORDER.filter((p) => platformSet.has(p)),
        ...Array.from(platformSet).filter((p) => !PLATFORM_ORDER.includes(p)),
      ]
    : PLATFORM_ORDER;
```

Wrap the result with the visibility filter by adding a derived constant immediately after it:

```tsx
  const visiblePlatforms = platforms.filter((p) => isVisible(p));
```

Then update the Posts zone map (line 296) to use `visiblePlatforms` instead of `platforms`:

```tsx
          {visiblePlatforms.map((platform) => (
```

- [ ] **Step 3: Filter the Posted history zone**

Find the Posted history block (lines 309–318). It iterates `cluster.drafts.filter(d => d.status === "posted")`. Add a visibility check to that filter so a hidden platform's posted rows are also hidden:

```tsx
      {cluster.drafts.some(d => d.status === "posted" && isVisible(d.platform)) && (
        <div>
          <div className="text-[11px] uppercase tracking-wider text-[var(--text-faint)] font-semibold mb-3">
            Posted history
          </div>
          <div className="space-y-2">
            {cluster.drafts
              .filter(d => d.status === "posted" && isVisible(d.platform))
              .sort((a, b) => (b.posted_at ?? "").localeCompare(a.posted_at ?? ""))
              .map(d => (
```

(Only the two `.filter`/`.some` predicates change — the rest of the block is unchanged.)

- [ ] **Step 4: Verify build + lint**

Run from `frontend/`:
```bash
npm run lint && npm run build
```
Expected: passes.

- [ ] **Step 5: Manual browser check**

Open a cluster detail page:
- Hide a platform via the list page's "Show:" row, then open a cluster — that platform's `PieceCard` is absent from the Posts zone, and its posted-history rows are gone.
- Toggle it back on (list page) → it reappears on the detail page after navigating back in.
- Confirm the hidden set is shared between list and detail (same localStorage key, same brand).

- [ ] **Step 6: Commit**

```bash
git add "frontend/app/content/[brandId]/cluster/[clusterId]/page.tsx"
git commit -m "feat(content): apply platform view-filter to cluster detail page"
```

---

## Final verification

- [ ] **Full build + lint clean**

Run from `frontend/`:
```bash
npm run lint && npm run build
```
Expected: both pass with no errors.

- [ ] **End-to-end manual pass**

1. Brand with mixed prompts (some clustered, some not): list shows real cards + dashed shell cards under "All".
2. Generate a cluster from a shell → it becomes a real card.
3. Hide LinkedIn + X in "Show:" → both vanish from list-card dots and from detail Posts/Posted-history; reload persists the choice; toggling on restores them.
4. Generation is untouched: regenerating a cluster still produces all 5 platforms regardless of what's hidden (open the cluster with everything shown to confirm all pieces still exist).

---

## Notes / accepted limitations

- **List-card aggregate metrics stay prompt-level.** `cluster_delta` (AI visibility lift) and the `{postedCount} of {enabledPlatformCount}` text remain prompt-scoped (they intentionally include Wikipedia/legacy posts). The view-filter only changes which pieces feed the dot/draft display. This keeps lift attribution honest and avoids divergence from backend semantics.
- **Per-browser preference.** localStorage means the hidden set does not sync across devices or teammates — an accepted trade-off for a view preference (per the design spec).
- **No generation impact.** The existing `BrandContentSettings.enabled` generation flags (legacy `ContentHub.tsx`) are a separate concept and are untouched.
