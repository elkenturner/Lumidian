# Reports UX & Profile Banner Improvements

**Date:** 2026-04-04  
**Status:** Approved

## Overview

Three improvements to the Lumidian dashboard and reports experience:
1. Tabbed interface on reports page to elevate Competitor Share of Voice visibility
2. Subtle notification banner for incomplete brand profiles
3. Verification of platforms toggle functionality

## Scope

### In Scope
- Reports page: Add tabs for "Prompt Breakdown" and "Competitor Analysis"
- Dashboard: Replace profile completeness card with slim notification banner
- Content page: Verify platforms toggle works correctly

### Out of Scope
- 30/90 day trend chart issue (confirmed as expected behavior with <30 days of data)
- Any changes to the competitor SOV data/logic itself
- New features or additional notifications

---

## Section 1: Reports Page Tabs

### Current State
- Reports page has a stacked layout: Trend Chart → Prompt Visibility list → Competitor SOV table
- Competitor SOV is at the bottom, often missed by users

### Target State
- Tabbed interface after the Trend Chart
- Two tabs: **"Prompt Breakdown"** (default) | **"Competitor Analysis"**
- Tab content is mutually exclusive (one visible at a time)

### Implementation Details

**File:** `frontend/app/reports/page.tsx`

1. Import `Tabs`, `TabsList`, `TabsTrigger`, `TabsContent` from `@/components/ui/tabs`
2. Wrap existing Prompt Visibility section in `<TabsContent value="prompts">`
3. Wrap existing Competitor SOV section in `<TabsContent value="competitors">`
4. Add tab navigation after the Trend Chart

**Styling:**
- Match TrendChart's timeframe selector style
- Background: `rgba(255,255,255,0.04)`
- Border: `rgba(99,102,241,0.12)`
- Active tab: `rgba(99,102,241,0.25)` background, `var(--accent-light)` text

**Behavior:**
- Default to "Prompt Breakdown" tab
- Tab state is local (resets on navigation away from page)
- Both tabs show loading skeleton when data is loading

---

## Section 2: Profile Completeness Notification

### Current State
- Prominent card with progress bar at top of dashboard
- Contains: title, percentage, progress bar, description text, link
- Takes significant vertical space

### Target State
- Slim, non-dismissible notification banner
- Single line of text with link
- Always visible when `completion_pct < 100`

### Implementation Details

**File:** `frontend/app/dashboard/page.tsx`

1. Replace the existing profile completeness card (lines ~1022-1036)
2. New component: slim banner div

**Content:**
```
"Complete your brand profile to improve draft quality" [Complete profile →]
```

**Styling:**
- Height: ~36px
- Background: `rgba(99,102,241,0.06)`
- Border-bottom: `1px solid rgba(99,102,241,0.12)`
- Text: 12px, `var(--text-muted)`
- Link: `var(--accent)`, hover `var(--accent-light)`
- Centered or left-aligned with padding

**Behavior:**
- Not dismissible
- Hidden when `completion_pct === 100` or `brandProfile` is null
- Clicking link navigates to `/settings?tab=profile`

---

## Section 3: Platforms Toggle Verification

### Current State
- Toggle switches in Content page sidebar for reddit, quora, medium, wikipedia
- Calls `updateContentSettings(brandId, platform, { enabled })` on toggle
- Updates local state on success

### Verification Checklist

**File:** `frontend/app/content/page.tsx`

1. **Toggle off** → Verify API call to `PUT /content/{brandId}/settings/{platform}` succeeds
2. **Visual feedback** → "Saved" indicator appears next to toggled platform
3. **Filtering** → Drafts for disabled platforms are excluded from visible list
4. **Persistence** → Reload page, verify toggle state persists
5. **Toggle on** → Drafts for re-enabled platform reappear

### Expected Outcome
- If all checks pass: No code changes needed
- If issues found: Document and fix specific bug

---

## Files to Modify

| File | Changes |
|------|---------|
| `frontend/app/reports/page.tsx` | Add tabs wrapping Prompt Visibility and Competitor SOV |
| `frontend/app/dashboard/page.tsx` | Replace profile completeness card with slim banner |
| `frontend/app/content/page.tsx` | Verify only (potential bug fixes if issues found) |

## Testing

1. **Reports tabs:** Switch between tabs, verify content renders correctly, check loading states
2. **Profile banner:** Verify shows when incomplete, hides when complete, link works
3. **Platforms toggle:** Run through verification checklist above

## Risks

- **Low:** Tab component already used elsewhere in codebase (TrendChart)
- **Low:** Profile banner is simpler than current implementation
- **Low:** Platforms toggle is verification only, minimal change risk
