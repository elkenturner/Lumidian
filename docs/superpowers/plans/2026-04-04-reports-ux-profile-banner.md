# Reports UX & Profile Banner Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add tabbed interface to reports page, replace profile completeness card with slim banner, verify platforms toggle.

**Architecture:** Frontend-only changes. Reports page gets Tabs component wrapping existing sections. Dashboard profile card becomes a single-line notification. Content page toggle verified manually.

**Tech Stack:** React, Next.js, Radix UI Tabs, Tailwind CSS

---

## Task 1: Add Tabs to Reports Page

**Files:**
- Modify: `frontend/app/reports/page.tsx`

**Overview:** Wrap the existing "Search/Sort + Prompt Visibility" section (lines 384-639) and "Competitors" section (lines 641-749) in a Tabs component. The existing JSX stays intact - we just add wrapper elements.

- [ ] **Step 1.1: Add Tabs import**

Find line 36 with `import { Badge } from '@/components/ui/badge';` and add after it:

```tsx
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
```

- [ ] **Step 1.2: Add tab state**

Find line 138 with `const [competitorModelFilter, setCompetitorModelFilter] = useState<string>('all');` and add after it:

```tsx
const [activeTab, setActiveTab] = useState<'prompts' | 'competitors'>('prompts');
```

- [ ] **Step 1.3: Insert Tabs opening and TabsList before Search controls**

Find line 384 with the comment `{/* Search + sort controls */}`. Insert BEFORE this line:

```tsx
          {/* Tabs for Prompt Breakdown and Competitor Analysis */}
          <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as 'prompts' | 'competitors')} className="mt-4">
            <TabsList className="bg-[rgba(255,255,255,0.04)] border border-[rgba(99,102,241,0.12)] rounded-lg p-0.5 h-auto gap-0 mb-4">
              <TabsTrigger
                value="prompts"
                className="px-4 py-2 rounded-md text-sm font-medium h-auto data-[state=active]:bg-[rgba(99,102,241,0.25)] data-[state=active]:text-[var(--accent-light)] data-[state=inactive]:text-[var(--text-faint)]"
              >
                Prompt Breakdown
              </TabsTrigger>
              <TabsTrigger
                value="competitors"
                className="px-4 py-2 rounded-md text-sm font-medium h-auto data-[state=active]:bg-[rgba(99,102,241,0.25)] data-[state=active]:text-[var(--accent-light)] data-[state=inactive]:text-[var(--text-faint)]"
              >
                Competitor Analysis
              </TabsTrigger>
            </TabsList>

            <TabsContent value="prompts" className="mt-0">
```

- [ ] **Step 1.4: Close prompts TabsContent after Prompt Visibility section**

Find line 639 with the closing `</div>` that ends the Prompt Visibility list (the one right before the `{/* Competitors section */}` comment on line 641). Insert AFTER this `</div>`:

```tsx
            </TabsContent>

            <TabsContent value="competitors" className="mt-0">
```

- [ ] **Step 1.5: Close competitors TabsContent and Tabs after Competitors section**

Find line 749 with the closing `</div>` that ends the competitors section (the last `</div>` inside the `{competitorAnalysis && competitorAnalysis.has_data && (` block). Insert AFTER this `</div>` but BEFORE the closing `)}` of that conditional:

Actually, simpler approach: Find line 749 which closes the competitor table. After the `)}` on line 749 that closes the `{competitorAnalysis && competitorAnalysis.has_data && (` block, add:

```tsx
              {loading && (
                <div className="bg-[var(--bg-raised)] border border-[var(--border-subtle)] rounded-xl p-6 animate-pulse">
                  <div className="h-5 bg-[rgba(255,255,255,0.06)] rounded w-48 mb-4" />
                  <div className="h-32 bg-[rgba(255,255,255,0.06)] rounded-lg" />
                </div>
              )}
            </TabsContent>
          </Tabs>
```

- [ ] **Step 1.6: Remove mt-4 from competitors section**

The original competitors sections (both the "no data" and "has data" variants) have `mt-4` or `className="mt-4 ..."`. Remove the `mt-4` from these since the tabs wrapper now handles spacing. 

Find and change:
- `<div className="mt-4 bg-[var(--bg-raised)]...` → `<div className="bg-[var(--bg-raised)]...`

- [ ] **Step 1.7: Build and verify no TypeScript errors**

Run: `cd frontend && npm run build`
Expected: Build succeeds with no errors

- [ ] **Step 1.8: Manual test**

1. Navigate to `/reports`
2. Verify "Prompt Breakdown" tab is active by default and shows search/sort + prompt list
3. Click "Competitor Analysis" tab
4. Verify competitor SOV content displays (or "No competitor data" message)
5. Switch back to "Prompt Breakdown"
6. Verify prompt list displays correctly

- [ ] **Step 1.9: Commit**

```bash
git add frontend/app/reports/page.tsx
git commit -m "feat(reports): add tabs for Prompt Breakdown and Competitor Analysis

Elevates competitor SOV visibility by giving it equal prominence with
prompt breakdown via tabbed interface."
```

---

## Task 2: Replace Profile Completeness Card with Slim Banner

**Files:**
- Modify: `frontend/app/dashboard/page.tsx:1022-1036`

- [ ] **Step 2.1: Replace the profile completeness card**

Find this block (around lines 1022-1036):

```tsx
              {/* Brand profile completeness nudge */}
              {brandProfile && brandProfile.completion_pct < 100 && (
                <div className="mb-4 flex items-center gap-4 card px-5 py-3">
                  <div className="flex-1">
                    <div className="flex items-center justify-between mb-1.5">
                      <p className="text-xs font-medium text-[var(--text-secondary)]">Brand Profile — {brandProfile.completion_pct}% complete</p>
                      <Link href="/settings?tab=profile" className="text-xs text-[var(--accent)] hover:text-[var(--accent-light)] transition-colors font-medium">Complete profile →</Link>
                    </div>
                    <div className="h-1.5 bg-[rgba(255,255,255,0.06)] rounded-full overflow-hidden">
                      <div className="h-full bg-[var(--accent)] rounded-full transition-all" style={{ width: `${brandProfile.completion_pct}%` }} />
                    </div>
                    <p className="text-[11px] text-[var(--text-faint)] mt-1">A complete brand profile improves draft quality and visibility tracking accuracy.</p>
                  </div>
                </div>
              )}
```

Replace it with:

```tsx
              {/* Brand profile completeness notification */}
              {brandProfile && brandProfile.completion_pct < 100 && (
                <div
                  className="mb-4 flex items-center justify-between px-4 py-2"
                  style={{
                    background: 'rgba(99,102,241,0.06)',
                    borderBottom: '1px solid rgba(99,102,241,0.12)',
                    borderRadius: '8px',
                  }}
                >
                  <p className="text-xs text-[var(--text-muted)]">
                    Complete your brand profile to improve draft quality
                  </p>
                  <Link
                    href="/settings?tab=profile"
                    className="text-xs text-[var(--accent)] hover:text-[var(--accent-light)] transition-colors font-medium whitespace-nowrap ml-4"
                  >
                    Complete profile →
                  </Link>
                </div>
              )}
```

- [ ] **Step 2.2: Build and verify no TypeScript errors**

Run: `cd frontend && npm run build`
Expected: Build succeeds with no errors

- [ ] **Step 2.3: Manual test**

1. Navigate to `/dashboard` with a brand that has incomplete profile
2. Verify slim banner appears at top (not the old card with progress bar)
3. Verify clicking "Complete profile →" navigates to `/settings?tab=profile`
4. Verify banner is not dismissible (no X button)
5. Complete the profile to 100% and verify banner disappears

- [ ] **Step 2.4: Commit**

```bash
git add frontend/app/dashboard/page.tsx
git commit -m "feat(dashboard): replace profile completeness card with slim notification

Non-intrusive single-line banner that shows until profile is 100% complete."
```

---

## Task 3: Verify Platforms Toggle Functionality

**Files:**
- Verify: `frontend/app/content/page.tsx` (no changes expected)

- [ ] **Step 3.1: Test toggle off**

1. Navigate to `/content`
2. In the right sidebar under "Platforms", click the toggle for "reddit" to turn it OFF
3. Verify: "Saved" indicator appears briefly
4. Verify: Any Reddit drafts disappear from the drafts list

- [ ] **Step 3.2: Test persistence**

1. Refresh the page (Cmd+R / F5)
2. Verify: Reddit toggle is still OFF
3. Verify: Reddit drafts are still hidden

- [ ] **Step 3.3: Test toggle on**

1. Click the Reddit toggle to turn it ON
2. Verify: "Saved" indicator appears
3. Verify: Reddit drafts reappear in the list

- [ ] **Step 3.4: Test other platforms**

Repeat steps 3.1-3.3 for quora, medium, and wikipedia toggles.

- [ ] **Step 3.5: Document results**

If all tests pass: No code changes needed. Create a verification commit:

```bash
git commit --allow-empty -m "verify: platforms toggle working correctly

Tested toggle on/off, persistence across page reload, and draft filtering
for all platforms (reddit, quora, medium, wikipedia)."
```

If any tests fail: Document the specific failure and create a bugfix task.

---

## Task 4: Final Verification and Cleanup

- [ ] **Step 4.1: Full build**

Run: `cd frontend && npm run build`
Expected: Build succeeds with no errors or warnings

- [ ] **Step 4.2: End-to-end test**

1. Reports page: Switch between tabs, verify both render correctly
2. Dashboard: Verify slim profile banner appears/hides based on completion
3. Content: Verify platform toggles filter drafts correctly

- [ ] **Step 4.3: Final commit (if any cleanup needed)**

```bash
git add -A
git commit -m "chore: final cleanup for reports UX and profile banner"
```
