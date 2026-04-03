# Dashboard Polish & Pitch Gating Design

**Date:** 2026-04-02  
**Status:** Approved  
**Goal:** Fix duplicate banners, hide N/A stats during first run, gate pitch users from opportunity drafting, and add subreddit links for standalone Reddit drafts.

---

## Problem Statement

Four UX issues identified during testing:

1. **Duplicate banners** — Global AppShell "Report in progress" banner AND per-brand progress card show simultaneously, looking unprofessional.

2. **N/A stats visible during first run** — Stats cards show "N/A", "No data yet" while first report runs, cluttering the view.

3. **Pitch users can draft from opportunities** — The `draft_opportunity` endpoint has no pitch-brand restriction. Opportunity drafting is a paid feature.

4. **Reddit drafts missing links** — Standalone Reddit drafts (not thread replies) have no link to the target subreddit.

---

## Solution 1: Merged Global Banner with Model Progress

### Current Behavior
- AppShell shows global "Report in progress" banner at top
- Dashboard shows separate per-brand "Report in progress" card with model progress pills
- New brands also show "Running your first AI visibility report..." banner

### New Behavior
- Keep only AppShell global banner
- Add model progress pills directly to the AppShell banner
- Remove per-brand "Report in progress" card from dashboard
- Remove "Running your first AI visibility report" banner (replaced by empty state — see Solution 2)

### Banner Layout

```
● Report in progress — querying AI models with your prompts
  [Gemini ✓ 82%] [Claude ✓ 56%] [ChatGPT ...] [Perplexity ...]
```

Pills appear as each model completes its queries for the active run.

### Implementation

**AppShell.tsx changes:**
- Accept optional `modelScores` prop (array of `{model, score}`)
- Render progress pills inline with banner text when `modelScores` is provided
- Style pills same as current per-brand card (colored badges per model)

**Dashboard page.tsx changes:**
- Remove the per-brand "Report in progress" card (lines ~1010-1035)
- Remove the "Running your first AI visibility report" banner (lines ~870-890)
- Pass `runModelScores` up to AppShell via context or prop drilling

---

## Solution 2: First-Run Empty State

### Current Behavior
Stats cards visible with "N/A" values while first report runs.

### New Behavior
When brand has:
- Zero completed runs (`analytics.total_responses_analyzed === 0` or no runs)
- AND a run is currently in progress

Replace the entire stats grid with centered empty state:

```
┌─────────────────────────────────────────────────────┐
│                                                     │
│         [spinner icon]                              │
│                                                     │
│         Running your first AI visibility report...  │
│                                                     │
│         This takes 1-2 minutes.                     │
│         We'll auto-generate content drafts          │
│         when it's done.                             │
│                                                     │
└─────────────────────────────────────────────────────┘
```

### Implementation

**Dashboard page.tsx changes:**
- Add condition: `const isFirstRun = !analytics?.total_responses_analyzed && activeRunId`
- Wrap stats section in conditional: if `isFirstRun`, render empty state instead
- Empty state component: centered card with spinner, heading, subtext

---

## Solution 3: Pitch User Opportunity Draft Gating

### Current Behavior
Any user can call `POST /opportunities/{id}/draft` regardless of brand type.

### New Behavior

**Backend (`opportunities.py`):**
```python
@router.post("/{opportunity_id}/draft", ...)
async def draft_opportunity(...):
    ...
    brand = await get_brand_for_user(opp.brand_id, db, user)
    
    # NEW: Block pitch brands from opportunity drafting
    if brand.brand_type == "pitch":
        raise HTTPException(
            status_code=status.HTTP_402_PAYMENT_REQUIRED,
            detail="Opportunity drafting is available on Starter and Pro plans. Upgrade to draft replies from live opportunities.",
        )
    ...
```

**Frontend (`content/page.tsx`):**
- Catch 402 response in `handleDraftOpportunity`
- Show upgrade modal instead of generic error alert
- Modal: title, explanation, "Upgrade" button → `/settings/billing`

### User Experience
- Pitch users CAN see the Live Opportunities tab (useful for evaluation)
- Pitch users CAN dismiss opportunities
- Pitch users CANNOT draft replies — clicking "Draft Reply" shows upgrade modal

---

## Solution 4: Reddit Draft Subreddit Links

### Current Behavior
- Opportunity-based Reddit drafts: link to thread via `platform_guidelines_applied`
- Standalone Reddit drafts: no link

### New Behavior

**For opportunity-based drafts (thread replies):**
- Keep existing behavior — clickable link to specific thread

**For standalone Reddit drafts:**
- Extract subreddit from `content_brief` field (e.g., "Post in r/sneakers about...")
- Regex: `/\br\/([A-Za-z0-9_]+)/i`
- If subreddit found: display link to `https://reddit.com/r/{subreddit}`
- If no subreddit found: display link to `https://reddit.com/submit`

### UI
Same orange link pill style as thread links:
```
[↗ Post to r/sneakers] (clickable, opens in new tab)
```

### Implementation

**content/page.tsx changes:**
- In draft card rendering, check if `platform === 'reddit'` and `opportunity_id === null`
- Extract subreddit using existing `extractSubreddit()` helper (or similar)
- Render link pill with appropriate URL

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `frontend/components/AppShell.tsx` | Modify | Add model progress pills to scanning banner |
| `frontend/app/dashboard/page.tsx` | Modify | Remove per-brand progress card; add first-run empty state; pass model scores to AppShell |
| `backend/app/routers/opportunities.py` | Modify | Add pitch brand check to `draft_opportunity` endpoint |
| `frontend/app/content/page.tsx` | Modify | Handle 402 with upgrade modal; add subreddit link for standalone Reddit drafts |

---

## Out of Scope

- **ChatGPT/Perplexity missing from reports** — Already fixed via `openai` and `anthropic` package upgrades (httpx compatibility issue).

---

## Testing Checklist

- [ ] Start a tracking run → only AppShell banner shows with model progress pills
- [ ] New brand first run → stats section replaced with "Running your first report..." message
- [ ] Run completes → stats populate, empty state disappears
- [ ] Pitch brand → click "Draft Reply" on opportunity → upgrade modal appears
- [ ] Pitch brand → can still dismiss opportunities
- [ ] Standalone Reddit draft → shows link to subreddit
- [ ] Opportunity-based Reddit draft → shows link to specific thread
