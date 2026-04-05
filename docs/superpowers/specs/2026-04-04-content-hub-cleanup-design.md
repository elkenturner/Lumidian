# Content Hub Cleanup: Remove Raw/Preview Toggle & Add Platform Destination Links

**Date:** 2026-04-04
**Scope:** Frontend-only changes to `ContentTabPanels.tsx`

---

## Problem

1. Every draft card has a Raw/Preview toggle, but the "raw" view (plain markdown text) is not useful to most users. The preview is just generic markdown rendering — identical across all platforms. Two views for no meaningful distinction.
2. Standalone Reddit posts show the target subreddit as plain text, not a clickable link. Since Lumidian doesn't auto-post, users need a one-click path to the destination.
3. Medium drafts have no destination link at all.

## Solution

Frontend-only cleanup in `ContentTabPanels.tsx`. No backend changes.

### Change 1: Remove Raw/Preview Toggle

**File:** `ContentTabPanels.tsx` lines 757-783

Remove the two-button toggle (Raw | Preview). Always render the formatted view using the existing `renderPreviewHtml()` function. Keep the word count label.

The edit mode textarea (lines 707-744) is unchanged — users still edit raw markdown.

### Change 2: Standalone Reddit Subreddit Links

**File:** `ContentTabPanels.tsx` lines 692-698

**Current:** Standalone Reddit drafts (no `opportunity_id`, but have `content_brief` with subreddit info like `"Post in r/startup — discussion about..."`) render as plain styled text.

**New:**
- Parse the subreddit name using the existing `extractSubreddit()` helper
- Render as a clickable `<a>` link to `https://www.reddit.com/r/{subreddit}/submit` (the subreddit's submit page)
- Style using the same link pill as opportunity-based Reddit links (lines 612-622): `--color-claude` themed with `ExternalLink` icon
- Show the rest of `content_brief` (after " — ") as context text below the link
- Apply the existing promo-restricted subreddit warning (lines 624-636) — if the subreddit is restricted, show the same warning badge

### Change 3: Medium Destination Link

**File:** `ContentTabPanels.tsx` lines 699-703 (the generic `content_brief` fallback)

**New:** When `draft.platform === 'medium'`, render a clickable link to `https://medium.com/new-story` before the content brief. Style consistently with the Reddit/Quora link pills, using a Medium-appropriate color. Link text: "Write on Medium" with `ExternalLink` icon.

## What Stays the Same

- **Opportunity-based Reddit drafts** (with thread URLs at lines 609-637): Already have clickable links. No change.
- **Quora drafts** (lines 638-691): Already have question links. No change.
- **Wikipedia drafts**: Have their own wiki format handling. No change.
- **Edit mode** (lines 707-744): Still shows raw markdown textarea. No change.
- **Quality checklists**: No change.
- **Backend**: No changes. All data needed (subreddit names, URLs) is already available in existing fields.

## Files Modified

| File | Change |
|------|--------|
| `frontend/components/content/ContentTabPanels.tsx` | Remove raw/preview toggle, add Reddit subreddit submit link for standalone posts, add Medium new-story link |
