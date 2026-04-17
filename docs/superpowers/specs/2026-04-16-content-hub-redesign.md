# Content Hub Redesign: Opportunities vs Drafts Clarity

## Problem

Users don't understand the difference between "Visibility Opportunities" (replies to live threads on Reddit/Quora/LinkedIn/X) and "Content Drafts" (standalone original content targeting visibility gaps). When an opportunity is drafted, it gets lost in the general drafts list with minimal visual distinction. Tab naming ("Drafts" vs "Saved Drafts") adds further confusion. Saved drafts display fully expanded instead of compact.

## Solution

Restructure the Content Hub tabs, add type badges to distinguish draft types, show opportunity drafts inline under their source opportunity, and use compact expandable rows for scheduled/posted content.

## Tab Structure

### Current → New

| Current | New | Notes |
|---------|-----|-------|
| Live Opportunities | **Visibility Opportunities** | Renamed for clarity |
| Drafts | **Content Drafts** → Queue sub-tab | Merged with Saved Drafts |
| Saved Drafts | **Content Drafts** → Scheduled sub-tab | Compact expandable rows |
| Posted | **Posted** | Compact expandable rows |

Three primary tabs: **Visibility Opportunities** | **Content Drafts** | **Posted**

Content Drafts has two sub-tabs: **Queue** | **Scheduled**

Tab badges show counts (e.g., "4 new" on opportunities, "5" on drafts, "12" on posted).

URL sync via `?tab=` parameter preserved. Values: `opportunities`, `drafts`, `scheduled`, `posted`. The `drafts` and `scheduled` values both activate the Content Drafts primary tab with the appropriate sub-tab selected.

## Visibility Opportunities Tab

### Existing elements preserved
- Platform filter buttons (All | Reddit | Quora | LinkedIn | X)
- Opportunity cards: platform badge, relevance score (color-coded), thread title (clickable), body preview (expandable), subreddit label, matched prompt, posted time
- Actions: Draft Reply (with loading spinner, queue-full disable), Dismiss, Visit
- Empty state, loading state
- Sidebar: "Scan for Opportunities" button, platform toggles, queue stats

### New: Inline drafted replies
When an opportunity has status `drafted`, the reply appears as a nested panel directly underneath the opportunity card:
- Label: "Your drafted reply" with edit icon
- Draft text truncated to 3 lines with overflow hidden
- Actions: Edit (navigates to Content Drafts → Queue sub-tab with `pinnedDraftId` set to scroll/highlight the draft), Copy (clipboard), Post (same as draft card post action)
- The opportunity's "Draft Reply" button is replaced since it's already drafted; only "Visit" remains

**Data flow:** The main `page.tsx` already loads `draftItems` (all drafts for the brand). The inline reply is found by matching `draftItems.find(d => d.opportunity_id === opp.id)`. This match is passed from `OpportunitiesPanel` to `OpportunityCard` as a prop — no new API calls needed.

This means opportunity drafts have a **primary home** in the Opportunities tab (inline, with full thread context) and a **secondary listing** in the Content Drafts Queue (with badge + link back).

## Content Drafts Tab

### Queue sub-tab

Shows all unreviewed drafts (status: `draft`) — both standalone and opportunity replies.

**Type badges on every card:**
- `Original Content` badge (green background `#1a2a1a`, green text `#4ade80`) — standalone gap-targeted drafts (`source != 'opportunity'`, `opportunity_id == null`)
- `Thread Reply` badge (purple background `#1a1a2d`, purple text `#818cf8`) — opportunity drafts (`source == 'opportunity'` or `opportunity_id != null`). Additional elements:
  - Purple left border (3px solid `#6366f1`)
  - Thread title shown as "Re: [thread title]" in the prompt/targeting line
  - "View original thread" link (using `platform_guidelines_applied` URL or `opportunity.thread_url`)

**All existing card elements preserved:**
- Platform badge with colored dot
- Created time (relative)
- Quality checklist (collapsible)
- Word count
- Targeting prompt info
- Platform-specific context sections (Reddit subreddit warnings, Quora question links, LinkedIn/X/Medium post links)
- Edit mode (inline textarea + title input + save)
- Actions: Edit, Copy, Approve, Dismiss
- WikipediaDraftCard remains a separate component, unchanged

**Other preserved elements:**
- Platform filter buttons (All + per-platform)
- "Approve All" button
- Sidebar: "Regenerate Drafts" button, cooldown timer, weekly quota, queue capacity
- `pinnedDraftId` highlight for newly drafted opportunities
- Empty state with regenerate button
- Loading skeleton

### Scheduled sub-tab

Replaces "Saved Drafts" with **compact expandable rows** (collapsed by default).

**Collapsed row shows:**
- Type badge (Original / Reply, same styling as Queue)
- Truncated title or first line of content (single line, ellipsis overflow)
- Platform label
- Expand/collapse arrow icon

**Expanded view shows (all existing ScheduledCard functionality):**
- Full draft text with copy button
- Platform badge + "Approved X time ago"
- Targeting brief
- Posting guide (collapsible, per-platform steps)
- Actions: Mark as Posted, Move back to Drafts, Copy

Reply-type rows get the same purple left border treatment.

**Preserved elements:**
- Empty state
- Sidebar queue capacity stats

## Posted Tab

Same compact expandable row style as Scheduled sub-tab.

**Collapsed row shows:**
- Type badge (Original / Reply)
- Truncated title/preview
- Platform label
- Expand arrow

**Expanded view shows (all existing PostedCard functionality):**
- Full content
- Visibility tracking: score at posting, current score, delta, confidence tier
- Context note about data sufficiency

## Preserved (No Changes)

These elements stay exactly as they are:

- **Right sidebar:** Generate/scan buttons, cooldown timers, weekly quota display, queue stats with capacity bars, platform toggles (per-tab independent), upgrade upsell for free users
- **Modals:** Hub help, opportunities help, posting guide (platform tabs with steps), upgrade modal, draft request modal
- **Brand selector:** Brand pill with pre-selection from localStorage
- **All API calls:** No backend changes needed. All data fields already exist (`source`, `opportunity_id`, `platform_guidelines_applied`)
- **State management:** All existing state variables, handlers, and effects
- **Quality checklist:** Component and platform-specific checks unchanged
- **WikipediaDraftCard:** Separate component, unchanged
- **Subscription flows:** Pro platform locks, upgrade modals, subscription banners
- **Loading/empty/error states:** All preserved, adapted to new tab names where text references them
- **Platform toggles:** `tabDisabledPlatforms` per-tab behavior preserved
- **Helpers:** All utility functions in `helpers.tsx` unchanged

## Backend Changes

None. The `ContentDraft` model already has `opportunity_id` and `source` fields. The `ContentOpportunity` model already tracks `status` (new/drafted/dismissed). All data needed for the frontend changes is already returned by existing API endpoints.

## Files to Modify

| File | Change |
|------|--------|
| `frontend/app/content/page.tsx` | Tab structure (3 primary + 2 sub-tabs), tab switching logic, URL sync values |
| `frontend/components/content/ContentTabPanels.tsx` | Route to new tab/sub-tab structure |
| `frontend/components/content/DraftsPanel.tsx` | Add type badges (Original Content / Thread Reply) to draft cards |
| `frontend/components/content/cards/DraftCard.tsx` | Type badge rendering, purple left border for opportunity drafts, "Re: [thread]" line, "View original thread" link |
| `frontend/components/content/cards/OpportunityCard.tsx` | Inline drafted reply panel when opportunity.status === 'drafted' |
| `frontend/components/content/cards/ScheduledCard.tsx` | Compact/expandable redesign — collapsed by default, expand on click |
| `frontend/components/content/cards/PostedCard.tsx` | Compact/expandable redesign matching ScheduledCard pattern |
| `frontend/components/content/OpportunitiesPanel.tsx` | Pass drafted reply data to OpportunityCard for inline display |
| `frontend/components/content/ScheduledPanel.tsx` | Adapt to new compact card style |
| `frontend/components/content/PostedPanel.tsx` | Adapt to new compact card style |

## Out of Scope

- New features or functionality
- Backend/API changes
- New pages or routes
- Changes to other pages (dashboard, settings, etc.)
- Mobile-specific layouts (existing responsive behavior preserved)
