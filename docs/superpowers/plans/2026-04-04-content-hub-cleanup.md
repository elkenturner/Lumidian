# Content Hub Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the raw/preview toggle from draft cards and add one-click destination links for standalone Reddit posts and Medium drafts.

**Architecture:** All changes are in a single frontend file (`ContentTabPanels.tsx`). The raw/preview toggle is removed and replaced with always-on formatted rendering. Platform destination links are added to the existing context area of each draft card, using data already available in `content_brief`.

**Tech Stack:** React, TypeScript, Next.js, Tailwind CSS

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `frontend/components/content/ContentTabPanels.tsx` | Modify | Remove toggle, add platform links |

---

### Task 1: Remove the Raw/Preview Toggle

**Files:**
- Modify: `frontend/components/content/ContentTabPanels.tsx:521-522` (state), `757-783` (toggle UI)

- [ ] **Step 1: Remove `previewMode` state declaration**

In the `DraftCard` function at line 522, delete:

```typescript
const [previewMode, setPreviewMode] = useState(false);
```

- [ ] **Step 2: Replace the toggle + conditional render block**

Replace lines 757-783 (the toggle buttons + raw/preview conditional) with a single always-formatted view:

```tsx
          <div className="flex items-center justify-end mb-1.5">
            <span className="text-[10px] text-[var(--text-faint)] font-mono">{wordCount} words</span>
          </div>
          <div
            className="text-sm text-[var(--text-secondary)] leading-relaxed overflow-y-auto bg-[var(--bg-base)] border border-[var(--border-subtle)] rounded-lg p-3"
            style={{ maxHeight: '12rem', scrollbarWidth: 'thin', scrollbarColor: 'var(--border-subtle) transparent' }}
            dangerouslySetInnerHTML={{ __html: `<p style="margin:0">${renderPreviewHtml(draft.content_text)}</p>` }}
          />
```

This removes the Raw/Preview toggle buttons entirely and always renders the formatted markdown view. The word count moves to a right-aligned label above the content.

- [ ] **Step 3: Verify the app compiles**

Run: `cd /Users/ken/Desktop/Lumidian/frontend && npm run build 2>&1 | tail -20`
Expected: Build succeeds with no TypeScript errors about `previewMode` or `setPreviewMode`.

- [ ] **Step 4: Commit**

```bash
git add frontend/components/content/ContentTabPanels.tsx
git commit -m "fix(content): remove raw/preview toggle, always show formatted view"
```

---

### Task 2: Add Subreddit Submit Link for Standalone Reddit Drafts

**Files:**
- Modify: `frontend/components/content/ContentTabPanels.tsx:692-698`

- [ ] **Step 1: Replace the standalone Reddit `content_brief` display**

Replace lines 692-698 (the `draft.content_brief && draft.platform === 'reddit'` branch that renders plain text) with a clickable subreddit submit link:

```tsx
      ) : draft.content_brief && draft.platform === 'reddit' ? (
        <>
          {(() => {
            const sub = extractSubreddit(draft.content_brief);
            const contextText = draft.content_brief.includes(' — ')
              ? draft.content_brief.split(' — ').slice(1).join(' — ')
              : null;
            return (
              <>
                {sub ? (
                  <a
                    href={`https://www.reddit.com/r/${sub}/submit`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-2 bg-[color-mix(in_srgb,var(--color-claude)_7%,transparent)] border border-[color-mix(in_srgb,var(--color-claude)_20%,transparent)] rounded-lg px-3 py-2 group transition-colors hover:border-[color-mix(in_srgb,var(--color-claude)_35%,transparent)] hover:bg-[color-mix(in_srgb,var(--color-claude)_11%,transparent)]"
                  >
                    <span className="text-[var(--color-claude)] text-xs flex-shrink-0">↗</span>
                    <span className="text-xs text-[var(--color-claude)] font-medium flex-1 min-w-0 truncate">
                      Post in r/{sub}
                    </span>
                    <ExternalLink size={11} className="text-[var(--color-claude)]/60 flex-shrink-0 group-hover:text-[var(--color-claude)]" />
                  </a>
                ) : (
                  <p className="text-xs text-[var(--text-faint)] leading-relaxed">
                    <span className="text-[var(--color-claude)] font-medium">{draft.content_brief.split(' — ')[0]}</span>
                  </p>
                )}
                {contextText && (
                  <p className="text-xs text-[var(--text-faint)] leading-relaxed">{contextText}</p>
                )}
                {sub && isPromoRestricted(sub) && (
                  <div className="flex items-center gap-1.5 text-[10px] text-[var(--warning)] bg-[color-mix(in_srgb,var(--warning)_8%,transparent)] border border-[color-mix(in_srgb,var(--warning)_20%,transparent)] rounded-md px-2.5 py-1.5">
                    <AlertTriangle size={10} className="flex-shrink-0" />
                    <span>
                      <span className="font-semibold">r/{sub} bans promotion</span>
                      {' '}— this draft avoids direct brand mentions. You may cite sources or reference research indirectly.
                    </span>
                  </div>
                )}
              </>
            );
          })()}
        </>
```

This reuses the same link pill styling as opportunity-based Reddit drafts (lines 612-622) and adds the promo-restricted warning using the existing `isPromoRestricted()` and `extractSubreddit()` helpers. Falls back to the original plain text if no subreddit can be parsed.

- [ ] **Step 2: Verify the app compiles**

Run: `cd /Users/ken/Desktop/Lumidian/frontend && npm run build 2>&1 | tail -20`
Expected: Build succeeds with no errors.

- [ ] **Step 3: Commit**

```bash
git add frontend/components/content/ContentTabPanels.tsx
git commit -m "feat(content): add subreddit submit link for standalone Reddit drafts"
```

---

### Task 3: Add Medium Destination Link

**Files:**
- Modify: `frontend/components/content/ContentTabPanels.tsx:699-703`

- [ ] **Step 1: Add a Medium-specific branch before the generic `content_brief` fallback**

The current line 699 is the generic fallback for any platform with `content_brief`:

```tsx
      ) : draft.content_brief ? (
```

Insert a new Medium-specific branch **before** that fallback. After the closing of the standalone Reddit branch (the `</>` from Task 2), add:

```tsx
      ) : draft.platform === 'medium' ? (
        <>
          <a
            href="https://medium.com/new-story"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2 bg-[rgba(148,163,184,0.07)] border border-[rgba(148,163,184,0.18)] rounded-lg px-3 py-2 group transition-colors hover:border-[rgba(148,163,184,0.35)] hover:bg-[rgba(148,163,184,0.11)]"
          >
            <span className="text-[var(--text-secondary)] text-xs flex-shrink-0">↗</span>
            <span className="text-xs text-[var(--text-secondary)] font-medium flex-1 min-w-0 truncate">
              Write on Medium
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

This uses Medium's platform color (`rgba(148,163,184,...)` matching `PlatformBadge.tsx` line 14) for the link pill styling. The content brief targeting info is preserved below the link.

- [ ] **Step 2: Verify the app compiles**

Run: `cd /Users/ken/Desktop/Lumidian/frontend && npm run build 2>&1 | tail -20`
Expected: Build succeeds with no errors.

- [ ] **Step 3: Commit**

```bash
git add frontend/components/content/ContentTabPanels.tsx
git commit -m "feat(content): add Medium new-story destination link on draft cards"
```

---

### Task 4: Visual Verification

- [ ] **Step 1: Start the dev server**

Run: `cd /Users/ken/Desktop/Lumidian/frontend && npm run dev`

- [ ] **Step 2: Verify in browser**

Navigate to the content hub page and check:
1. Draft cards no longer show Raw/Preview toggle — content is always formatted
2. Standalone Reddit drafts show a clickable "Post in r/{subreddit}" link pill that opens `reddit.com/r/{sub}/submit`
3. Promo-restricted subreddits show the warning badge on standalone drafts
4. Medium drafts show a "Write on Medium" link pill that opens `medium.com/new-story`
5. Opportunity-based Reddit drafts (with thread URLs) still work as before
6. Quora drafts still work as before
7. Wikipedia drafts still work as before
8. Edit mode still shows raw markdown textarea

- [ ] **Step 3: Final commit if any tweaks needed**

```bash
git add frontend/components/content/ContentTabPanels.tsx
git commit -m "fix(content): polish platform destination links"
```
