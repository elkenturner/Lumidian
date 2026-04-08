# Content Page Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add LinkedIn/X post links to draft cards, split platform filters between Drafts and Live Opportunities tabs, and wire locked platform toggles to the upgrade modal.

**Architecture:** Three independent frontend changes in `ContentTabPanels.tsx` and `content/page.tsx`. No backend changes. Each task produces a working, testable change.

**Tech Stack:** Next.js 15, React 18, TypeScript, Tailwind CSS

---

### Task 1: Add LinkedIn and X post links to DraftCard

**Files:**
- Modify: `frontend/components/content/ContentTabPanels.tsx:737-763`

The `DraftCard` component has a chain of platform-specific link sections (Reddit → Quora → Medium → generic fallback). LinkedIn and X drafts currently fall through to the generic `else` at line 758 which only shows `content_brief` text. Insert two new branches before the Medium branch.

- [ ] **Step 1: Add LinkedIn draft link branch**

In `frontend/components/content/ContentTabPanels.tsx`, find this block inside `DraftCard` (around line 737):

```tsx
      ) : draft.platform === 'medium' ? (
```

Insert the LinkedIn branch **before** that line:

```tsx
      ) : draft.platform === 'linkedin_article' || draft.platform === 'linkedin' ? (
        <>
          <a
            href="https://www.linkedin.com/article/new/"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2 bg-[rgba(10,102,194,0.07)] border border-[rgba(10,102,194,0.20)] rounded-lg px-3 py-2 group transition-colors hover:border-[rgba(10,102,194,0.35)] hover:bg-[rgba(10,102,194,0.11)]"
          >
            <span className="text-[#0a66c2] text-xs flex-shrink-0">↗</span>
            <span className="text-xs text-[#0a66c2] font-medium flex-1 min-w-0 truncate">
              Post on LinkedIn
            </span>
            <ExternalLink size={11} className="text-[#0a66c2]/60 flex-shrink-0 group-hover:text-[#0a66c2]" />
          </a>
          {draft.content_brief && (
            <p className="text-xs text-[var(--text-faint)] leading-relaxed line-clamp-2">
              <span className="text-[var(--text-muted)]">Targeting: </span>
              {draft.content_brief}
            </p>
          )}
        </>
```

- [ ] **Step 2: Add X draft link branch**

Immediately after the LinkedIn branch's closing, insert the X branch **before** the Medium branch:

```tsx
      ) : draft.platform === 'x_thread' || draft.platform === 'x' ? (
        <>
          <a
            href="https://x.com/compose/post"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2 bg-[rgba(148,163,184,0.07)] border border-[rgba(148,163,184,0.18)] rounded-lg px-3 py-2 group transition-colors hover:border-[rgba(148,163,184,0.35)] hover:bg-[rgba(148,163,184,0.11)]"
          >
            <span className="text-[var(--text-secondary)] text-xs flex-shrink-0">↗</span>
            <span className="text-xs text-[var(--text-secondary)] font-medium flex-1 min-w-0 truncate">
              Post on X
            </span>
            <ExternalLink size={11} className="text-[var(--text-secondary)]/60 flex-shrink-0 group-hover:text-[var(--text-secondary)]" />
          </a>
          {draft.content_brief && (
            <p className="text-xs text-[var(--text-faint)] leading-relaxed line-clamp-2">
              <span className="text-[var(--text-muted)]">Targeting: </span>
              {draft.content_brief}
            </p>
          )}
        </>
```

- [ ] **Step 3: Verify in browser**

Run: `npm run build` from `frontend/`
Expected: Build succeeds with no errors.

Manual check: Open `http://localhost:3002`, go to Content, select a brand with LinkedIn/X drafts. Verify:
- LinkedIn drafts show a blue "Post on LinkedIn" link opening `linkedin.com/article/new/`
- X drafts show a "Post on X" link opening `x.com/compose/post`
- Reddit, Quora, Medium drafts still render their existing links unchanged

- [ ] **Step 4: Commit**

```bash
git add frontend/components/content/ContentTabPanels.tsx
git commit -m "feat: add post-creation links for LinkedIn and X draft cards"
```

---

### Task 2: Split platform filter into separate Drafts and Opportunities filters

**Files:**
- Modify: `frontend/app/content/page.tsx:1619-1620,1985-1991,2439-2440`
- Modify: `frontend/components/content/ContentTabPanels.tsx:67-69,1726,1747-1755,1879,1900-1917`

- [ ] **Step 1: Split state in content/page.tsx**

In `frontend/app/content/page.tsx`, replace the single `platformFilter` state (line 1619):

```tsx
  const [platformFilter, setPlatformFilter] = useState<string>('all');
```

With two separate states:

```tsx
  const [draftPlatformFilter, setDraftPlatformFilter] = useState<string>('all');
  const [oppPlatformFilter, setOppPlatformFilter] = useState<string>('all');
```

- [ ] **Step 2: Update filtering logic**

In the same file, update the `visibleDraftItems` and `visibleOpportunities` filters (around line 1985):

Replace:
```tsx
  const visibleDraftItems = draftItems.filter(
    (d) => !_disabledPlatforms.has(d.platform) && (platformFilter === 'all' || d.platform === platformFilter)
  );
  const visibleScheduledItems = scheduledItems.filter((d) => !_disabledPlatforms.has(d.platform));
  const visibleOpportunities = opportunities.filter(
    (o) => platformFilter === 'all' || o.platform === platformFilter
  );
```

With:
```tsx
  const visibleDraftItems = draftItems.filter(
    (d) => !_disabledPlatforms.has(d.platform) && (draftPlatformFilter === 'all' || d.platform === draftPlatformFilter)
  );
  const visibleScheduledItems = scheduledItems.filter((d) => !_disabledPlatforms.has(d.platform));
  const visibleOpportunities = opportunities.filter(
    (o) => oppPlatformFilter === 'all' || o.platform === oppPlatformFilter
  );
```

- [ ] **Step 3: Reset both filters on brand change**

In the `useEffect` that fires on `selectedBrandId` change (around line 1681), add resets after the existing `setGenerating(false)`:

```tsx
    setDraftPlatformFilter('all');
    setOppPlatformFilter('all');
```

- [ ] **Step 4: Update props interface in ContentTabPanels.tsx**

In `frontend/components/content/ContentTabPanels.tsx`, update the `ContentTabPanelsProps` interface (around line 67-69):

Replace:
```tsx
  // Platform filter
  platformFilter: string;
  setPlatformFilter: (v: string) => void;
```

With:
```tsx
  // Platform filters (independent per tab)
  draftPlatformFilter: string;
  setDraftPlatformFilter: (v: string) => void;
  oppPlatformFilter: string;
  setOppPlatformFilter: (v: string) => void;
```

- [ ] **Step 5: Update DraftsPanel to use draftPlatformFilter**

In the `DraftsPanel` function (around line 1724-1755), replace all references to `platformFilter` and `setPlatformFilter` with `draftPlatformFilter` and `setDraftPlatformFilter`. This includes:

- The destructured props (line ~1726): change `platformFilter` → `draftPlatformFilter`, `setPlatformFilter` → `setDraftPlatformFilter`
- The filter bar buttons (lines ~1747-1755): replace `platformFilter` with `draftPlatformFilter` and `setPlatformFilter` with `setDraftPlatformFilter`
- The empty state references (lines ~1780-1782): replace `platformFilter` with `draftPlatformFilter`

- [ ] **Step 6: Update OpportunitiesPanel to use oppPlatformFilter with fixed platform set**

In the `OpportunitiesPanel` function (around line 1877-1917), replace `platformFilter`/`setPlatformFilter` with `oppPlatformFilter`/`setOppPlatformFilter`.

Additionally, change the platform list from being derived from existing opportunities:

Replace:
```tsx
  const oppPlatforms = Array.from(new Set(opportunities.map((o) => o.platform))).sort();
```

With a fixed set:
```tsx
  const oppPlatforms = ['reddit', 'quora', 'linkedin', 'x'];
```

Update all `platformFilter` → `oppPlatformFilter` and `setPlatformFilter` → `setOppPlatformFilter` in the filter bar buttons (lines ~1905-1913) and empty state (line ~1950).

- [ ] **Step 7: Update parent component props**

In `frontend/app/content/page.tsx`, update the `ContentTabPanels` JSX (around line 2439-2440):

Replace:
```tsx
              platformFilter={platformFilter}
              setPlatformFilter={setPlatformFilter}
```

With:
```tsx
              draftPlatformFilter={draftPlatformFilter}
              setDraftPlatformFilter={setDraftPlatformFilter}
              oppPlatformFilter={oppPlatformFilter}
              setOppPlatformFilter={setOppPlatformFilter}
```

- [ ] **Step 8: Verify build and test in browser**

Run: `npm run build` from `frontend/`
Expected: Build succeeds with no errors.

Manual check:
- Select a brand, go to Drafts tab, filter by a platform → switch to Live Opportunities tab → filter should be "All" (independent)
- Switch back to Drafts → original filter is still set
- Change brand → both filters reset to "All"

- [ ] **Step 9: Commit**

```bash
git add frontend/app/content/page.tsx frontend/components/content/ContentTabPanels.tsx
git commit -m "feat: split platform filter into independent drafts and opportunities filters"
```

---

### Task 3: Wire locked platform toggles to upgrade modal

**Files:**
- Modify: `frontend/app/content/page.tsx:2625-2628`

The platform toggles at lines 2609-2670 already show LinkedIn/X as greyed out with a "PRO" badge for non-Pro users. But clicking does nothing because `disabled={isLocked}`. Change it so locked toggles open the upgrade modal.

- [ ] **Step 1: Update the toggle click handler**

In `frontend/app/content/page.tsx`, find the toggle button (around line 2625-2628):

Replace:
```tsx
                    <button
                      key={key}
                      onClick={() => !isLocked && handleTogglePlatform(key, !enabled)}
                      disabled={isLocked}
```

With:
```tsx
                    <button
                      key={key}
                      onClick={() => {
                        if (isLocked) {
                          setUpgradeModalReason(`${key === 'linkedin' ? 'LinkedIn' : 'X'} scanning and drafting requires a Pro subscription.`);
                          setUpgradeModalOpen(true);
                          return;
                        }
                        handleTogglePlatform(key, !enabled);
                      }}
```

Remove the `disabled={isLocked}` prop entirely — the button must be clickable for the modal to fire. The existing `opacity-50 cursor-not-allowed` class from `isLocked` still provides the visual disabled appearance.

- [ ] **Step 2: Verify build and test in browser**

Run: `npm run build` from `frontend/`
Expected: Build succeeds with no errors.

Manual check (test with a non-Pro user, or temporarily set your user to non-Pro):
- LinkedIn and X toggles appear greyed out with "PRO" badge
- Clicking a locked toggle opens the upgrade modal with "LinkedIn scanning and drafting requires a Pro subscription."
- Clicking "View plans" navigates to `/settings/billing`
- Clicking "Dismiss" closes the modal
- Pro users can still toggle all platforms normally

- [ ] **Step 3: Commit**

```bash
git add frontend/app/content/page.tsx
git commit -m "feat: wire locked platform toggles to upgrade modal"
```
