# Content Page Polish — Draft Links, Separate Filters, Pro Gate Toggles

**Goal:** Three targeted improvements to the content page: add post-creation links for LinkedIn/X drafts, split the platform filter so Drafts and Live Opportunities have independent filters, and show LinkedIn/X toggles to all users with a Pro gate for non-Pro tiers.

## 1. Draft Post Links for LinkedIn & X

**Problem:** Reddit, Quora, and Medium draft cards all include a link to create/post content on the platform. LinkedIn and X drafts fall through to a generic text-only fallback with no link.

**Solution:** Add two new platform branches in `DraftCard` (in `ContentTabPanels.tsx`), following the existing pattern:

- **LinkedIn drafts** — link to `https://www.linkedin.com/article/new/` with text "Post on LinkedIn". Styled with a LinkedIn blue accent, matching the pattern used by Quora (`--color-gemini`) and Reddit (`--color-claude`). Includes `↗` prefix and `ExternalLink` icon.
- **X drafts** — link to `https://x.com/compose/post` with text "Post on X". Styled with a neutral/dark accent (X brand is black/white). Same icon pattern.
- Both show `content_brief` below the link if present, matching the Medium card pattern.

**Files:** `frontend/components/content/ContentTabPanels.tsx` — `DraftCard` function, in the platform-specific link section (around lines 610–760).

## 2. Separate Platform Filters for Drafts vs Live Opportunities

**Problem:** A single `platformFilter` state in `content/page.tsx` is shared between the Drafts tab and the Live Opportunities tab. Selecting a platform filter on one tab changes the filter on the other.

**Solution:** Split into two independent filter states:

- `draftPlatformFilter` — used by DraftsPanel (and Scheduled/Posted panels if they share the filter)
- `oppPlatformFilter` — used by OpportunitiesPanel only

**Drafts filter behavior** (unchanged from current): derives available platforms from existing drafts. Only shows filter buttons when 2+ platforms have drafts.

**Opportunities filter behavior** (new): shows a fixed set of four buttons — Reddit, Quora, LinkedIn, X — since those are the only platforms with scanners. All four buttons always visible regardless of whether results exist, so users know what's being scanned.

Both filters reset to "All" when the selected brand changes.

**Files:**
- `frontend/app/content/page.tsx` — split `platformFilter` state into two, pass each to the appropriate panel, reset both on brand change
- `frontend/components/content/ContentTabPanels.tsx` — update `ContentTabPanelsProps` to accept two filter states, update `DraftsPanel` and `OpportunitiesPanel` to use their respective filter

## 3. Platform Toggles — Pro Gate for Free/Standard Users

**Problem:** LinkedIn and X platform toggles are visible to all users with a "PRO" badge and greyed-out styling, but clicking them does nothing (`disabled={isLocked}`). Non-Pro users get no feedback.

**Current state (already implemented at `content/page.tsx:2609–2670`):**
- All six platform toggles render for all users
- `isLocked` correctly gates LinkedIn/X for non-Pro users
- "PRO" badge shows next to locked toggles
- Greyed out styling with `opacity-50 cursor-not-allowed`

**Remaining fix:** Change the locked toggle's `onClick` to open the upgrade modal instead of being fully disabled. Remove `disabled={isLocked}` so the click handler fires, and route locked clicks to the existing upgrade modal.

**Files:** `frontend/app/content/page.tsx` — platform toggle section at lines 2609–2670.

## Scope

All changes are frontend-only. No backend changes required. All work stays on the `feature/linkedin-x-integration` branch.
