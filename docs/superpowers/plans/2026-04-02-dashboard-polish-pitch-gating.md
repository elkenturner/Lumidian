# Dashboard Polish & Pitch Gating Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix duplicate banners, hide N/A stats during first run, gate pitch users from opportunity drafting, and add subreddit links for standalone Reddit drafts.

**Architecture:** Extend background-status API to return model scores for the AppShell banner. Add first-run detection to dashboard to show empty state. Add pitch brand check to opportunity drafting endpoint. Extract subreddit from content_brief for Reddit draft links.

**Tech Stack:** Python 3.11 / FastAPI (backend); Next.js 15 / TypeScript / React (frontend)

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `backend/app/routers/tracking.py` | Modify | Add model_scores to background-status response |
| `frontend/lib/api.ts` | Modify | Update BackgroundStatus type |
| `frontend/components/AppShell.tsx` | Modify | Render model progress pills in banner |
| `frontend/app/dashboard/page.tsx` | Modify | Remove per-brand progress card; add first-run empty state |
| `backend/app/routers/opportunities.py` | Modify | Add pitch brand check to draft_opportunity |
| `frontend/app/content/page.tsx` | Modify | Handle 402 with upgrade modal; add subreddit links |

---

## Task 1: Extend background-status API to return model scores

**Files:**
- Modify: `backend/app/routers/tracking.py:743-790`

- [ ] **Step 1: Update the background-status endpoint**

In `backend/app/routers/tracking.py`, find the `get_background_status` function (around line 743). Replace the entire function with:

```python
@router.get("/background-status")
async def get_background_status(db: DbDep, user: CurrentUser):
    """
    Lightweight poll endpoint for AppShell banners.

    Returns three boolean flags reflecting what is currently happening
    across all of the authenticated user's brands:

    - report_running:    any TrackingRun for user's brands is pending/running
    - drafts_generating: any brand_id is in state.generating_brands
    - scanning:          any brand_id is in state.scanning_brands
    - model_scores:      list of {model, score} for the active run (if any)
    """
    from app import state as _state
    from sqlalchemy import func as _sqlfunc

    # Get all brand IDs owned by this user
    brands_result = await db.execute(
        select(Brand.id).where(Brand.user_id == user.id)
    )
    user_brand_ids: set[int] = set(brands_result.scalars().all())

    if not user_brand_ids:
        return {"report_running": False, "drafts_generating": False, "scanning": False, "model_scores": []}

    # Check for active tracking runs in the DB
    running_result = await db.execute(
        select(TrackingRun).where(
            TrackingRun.brand_id.in_(user_brand_ids),
            TrackingRun.status.in_(["pending", "running"]),
        ).order_by(TrackingRun.created_at.desc()).limit(1)
    )
    active_run = running_result.scalar_one_or_none()
    report_running = active_run is not None

    # Get model scores for the active run
    model_scores = []
    if active_run and active_run.model_scores:
        model_scores = [
            {"model": ms.model, "score": round((ms.total_mentions / ms.total_queries) * 100) if ms.total_queries > 0 else 0}
            for ms in active_run.model_scores
        ]

    # Check in-memory sets for drafts and scanning
    drafts_generating = bool(user_brand_ids & _state.generating_brands)
    scanning = bool(user_brand_ids & _state.scanning_brands)

    return {
        "report_running": report_running,
        "drafts_generating": drafts_generating,
        "scanning": scanning,
        "model_scores": model_scores,
    }
```

- [ ] **Step 2: Verify endpoint loads**

```bash
cd /Users/ken/Desktop/Lumidian/backend
python3 -c "from app.routers.tracking import router; print('OK')"
```

Expected: `OK`

- [ ] **Step 3: Commit**

```bash
cd /Users/ken/Desktop/Lumidian
git add backend/app/routers/tracking.py
git commit -m "feat: add model_scores to background-status API response"
```

---

## Task 2: Update frontend API types and AppShell banner

**Files:**
- Modify: `frontend/lib/api.ts`
- Modify: `frontend/components/AppShell.tsx`

- [ ] **Step 1: Update BackgroundStatus type in api.ts**

In `frontend/lib/api.ts`, find the `BackgroundStatus` interface (search for "BackgroundStatus") and update it:

```typescript
export interface BackgroundStatus {
  report_running: boolean;
  drafts_generating: boolean;
  scanning: boolean;
  model_scores: Array<{ model: string; score: number }>;
}
```

- [ ] **Step 2: Update AppShell to store and render model scores**

In `frontend/components/AppShell.tsx`, update the state declarations (around line 25):

```typescript
  const [reportRunning, setReportRunning] = useState(false);
  const [draftsGenerating, setDraftsGenerating] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [modelScores, setModelScores] = useState<Array<{ model: string; score: number }>>([]);
  const [isMobile, setIsMobile] = useState(false);
```

- [ ] **Step 3: Update the poll effect to capture model_scores**

In the same file, find the poll function in the useEffect (around line 62) and update it:

```typescript
    const poll = async () => {
      try {
        const status = await getBackgroundStatus();
        if (!cancelled) {
          setReportRunning(status.report_running);
          setDraftsGenerating(status.drafts_generating);
          setScanning(status.scanning);
          setModelScores(status.model_scores || []);
        }
      } catch {
        // Silently ignore poll errors — don't flash misleading banners
      }
    };
```

- [ ] **Step 4: Add model config helper**

In `frontend/components/AppShell.tsx`, add this helper function after the imports (around line 12):

```typescript
const MODEL_CONFIG: Record<string, { label: string; bg: string; text: string }> = {
  chatgpt: { label: 'ChatGPT', bg: 'rgba(16,163,127,0.15)', text: '#10a37f' },
  claude: { label: 'Claude', bg: 'rgba(217,119,87,0.15)', text: '#d97757' },
  perplexity: { label: 'Perplexity', bg: 'rgba(32,170,215,0.15)', text: '#20aad7' },
  gemini: { label: 'Gemini', bg: 'rgba(66,133,244,0.15)', text: '#4285f4' },
};
```

- [ ] **Step 5: Update the reportRunning banner to show model progress pills**

Find the reportRunning banner (around line 127) and replace it with:

```typescript
        {reportRunning && (
          <div style={{
            background: 'rgba(99,102,241,0.08)',
            borderBottom: '1px solid rgba(99,102,241,0.20)',
            padding: '8px 28px',
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            flexWrap: 'wrap',
          }}>
            <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#6366f1', display: 'inline-block', animation: 'pulse 2s cubic-bezier(0.4,0,0.6,1) infinite' }} />
            <span style={{ fontSize: 12, color: '#818cf8', fontWeight: 600 }}>Report in progress</span>
            <span style={{ fontSize: 12, color: '#6366f1' }}>— querying AI models with your prompts.</span>
            {modelScores.length > 0 && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginLeft: 8 }}>
                {modelScores.map((ms) => {
                  const cfg = MODEL_CONFIG[ms.model] || { label: ms.model, bg: 'rgba(100,116,139,0.15)', text: '#64748b' };
                  return (
                    <span
                      key={ms.model}
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 4,
                        fontSize: 10,
                        fontWeight: 600,
                        padding: '2px 8px',
                        borderRadius: 9999,
                        background: cfg.bg,
                        color: cfg.text,
                      }}
                    >
                      <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="20 6 9 17 4 12" />
                      </svg>
                      {cfg.label}: {ms.score}%
                    </span>
                  );
                })}
              </div>
            )}
          </div>
        )}
```

- [ ] **Step 6: Verify frontend builds**

```bash
cd /Users/ken/Desktop/Lumidian/frontend
npm run build 2>&1 | tail -10
```

Expected: Build succeeds

- [ ] **Step 7: Commit**

```bash
cd /Users/ken/Desktop/Lumidian
git add frontend/lib/api.ts frontend/components/AppShell.tsx
git commit -m "feat: show model progress pills in AppShell report banner"
```

---

## Task 3: Remove per-brand progress card and add first-run empty state

**Files:**
- Modify: `frontend/app/dashboard/page.tsx`

- [ ] **Step 1: Add first-run detection variable**

In `frontend/app/dashboard/page.tsx`, find the line that defines `isRunning` (around line 672). Add a new variable below it:

```typescript
  const isRunning = activeRunId !== null || latestRun?.status === 'running' || latestRun?.status === 'pending' || (newBrandMode && newBrandStep !== 'done');
  const isFirstRun = isRunning && !analytics?.total_responses_analyzed && trends.length === 0;
```

- [ ] **Step 2: Remove the "Running your first AI visibility report" banner**

Find the `newBrandStep` banner section (around lines 840-872). This is the banner that shows "Running your first AI visibility report...". Remove the entire `{newBrandStep === 'running' && (...)}` block since we'll show this message in the empty state instead.

Look for:
```typescript
            {newBrandStep === 'running' && (
              <>
                <p className="text-sm font-medium text-[#F0F4F8]">Running your first AI visibility report…</p>
```

And remove that entire conditional block (the `{newBrandStep === 'running' && (...)}` part, keeping the other newBrandStep conditions).

- [ ] **Step 3: Remove the per-brand "Report in progress" card**

Find the "Running banner" comment and the `{isRunning && (` block that follows (around lines 953-990). Remove the entire block:

```typescript
      {/* Running banner */}
      {isRunning && (
        <div className="bg-[rgba(99,102,241,0.10)] border border-[rgba(99,102,241,0.25)] rounded-xl p-4 mb-6">
          ... entire card ...
        </div>
      )}
```

Delete all of it.

- [ ] **Step 4: Add first-run empty state before the stats section**

Find the comment `{/* ── OVERVIEW ─────` (around line 1047). Just before the `<>` that opens the overview section, add the first-run empty state:

```typescript
          {/* ── FIRST-RUN EMPTY STATE ──────────────────────────────────── */}
          {isFirstRun && (
            <div className="flex flex-col items-center justify-center py-20 text-center max-w-md mx-auto mb-8">
              <div className="w-16 h-16 bg-[rgba(99,102,241,0.10)] border border-[rgba(99,102,241,0.25)] rounded-2xl flex items-center justify-center mb-5">
                <Loader2 size={28} className="text-[#6366f1] animate-spin" />
              </div>
              <h3 className="text-lg font-bold text-[#F0F4F8] mb-2">Running your first AI visibility report...</h3>
              <p className="text-sm text-[#64748B] leading-relaxed">
                This takes 1-2 minutes. We&apos;ll auto-generate content drafts when it&apos;s done.
              </p>
            </div>
          )}

          {/* ── OVERVIEW ─────────────────────────────────────────────────── */}
```

- [ ] **Step 5: Hide stats section during first run**

Wrap the entire overview section in a conditional to hide it during first run. Find the `{/* ── OVERVIEW ─────` comment and wrap everything from the opening `<>` to its matching closing `</>` (this is a large section) with:

```typescript
          {!isFirstRun && (
            <>
              {/* ── OVERVIEW ───────────────────────────────────────────────── */}
              ... existing overview content ...
            </>
          )}
```

- [ ] **Step 6: Verify frontend builds**

```bash
cd /Users/ken/Desktop/Lumidian/frontend
npm run build 2>&1 | tail -10
```

Expected: Build succeeds

- [ ] **Step 7: Commit**

```bash
cd /Users/ken/Desktop/Lumidian
git add frontend/app/dashboard/page.tsx
git commit -m "feat: replace duplicate banners with first-run empty state"
```

---

## Task 4: Add pitch brand gating to opportunity drafting

**Files:**
- Modify: `backend/app/routers/opportunities.py`

- [ ] **Step 1: Add pitch brand check to draft_opportunity endpoint**

In `backend/app/routers/opportunities.py`, find the `draft_opportunity` function (around line 110). After the `require_brand_active(brand, user)` line (around line 122), add:

```python
    # Check if brand is paused
    require_brand_active(brand, user)

    # Pitch brands cannot draft from opportunities — paid feature
    if brand.brand_type == "pitch":
        raise HTTPException(
            status_code=status.HTTP_402_PAYMENT_REQUIRED,
            detail="Opportunity drafting is available on Starter and Pro plans. Upgrade to draft replies from live opportunities.",
        )

    try:
```

- [ ] **Step 2: Verify endpoint loads**

```bash
cd /Users/ken/Desktop/Lumidian/backend
python3 -c "from app.routers.opportunities import router; print('OK')"
```

Expected: `OK`

- [ ] **Step 3: Commit**

```bash
cd /Users/ken/Desktop/Lumidian
git add backend/app/routers/opportunities.py
git commit -m "feat: gate pitch brands from opportunity drafting"
```

---

## Task 5: Handle 402 with upgrade modal in content page

**Files:**
- Modify: `frontend/app/content/page.tsx`

- [ ] **Step 1: Add upgrade modal state**

In `frontend/app/content/page.tsx`, find the state declarations section (around line 180-220). Add these new state variables:

```typescript
  const [upgradeModalOpen, setUpgradeModalOpen] = useState(false);
  const [upgradeModalReason, setUpgradeModalReason] = useState('');
```

- [ ] **Step 2: Add Dialog imports**

At the top of the file, find the existing Dialog import and ensure it includes DialogFooter:

```typescript
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
```

Also add Zap icon if not already imported:

```typescript
import {
  // ... existing imports ...
  Zap,
  // ... rest ...
} from 'lucide-react';
```

- [ ] **Step 3: Update handleDraftOpportunity to show upgrade modal on 402**

Find the `handleDraftOpportunity` function (around line 2046). Replace the catch block:

```typescript
    } catch (e: unknown) {
      const err = e as { response?: { status?: number; data?: { detail?: string } } };
      const detail = err?.response?.data?.detail ?? 'Failed to draft reply. Try again.';
      const httpStatus = err?.response?.status;
      if (httpStatus === 402) {
        setUpgradeModalReason(detail);
        setUpgradeModalOpen(true);
      } else {
        alert(detail);
      }
    }
```

- [ ] **Step 4: Add upgrade modal JSX**

Find a good location for the modal (near other modals in the file, around line 2300). Add:

```typescript
      {/* Upgrade modal — shown when pitch user tries to draft opportunity */}
      <Dialog open={upgradeModalOpen} onOpenChange={(o) => !o && setUpgradeModalOpen(false)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <Zap size={20} className="text-[#6366f1] mb-1" />
            <DialogTitle>Upgrade to Draft Opportunities</DialogTitle>
          </DialogHeader>
          <p className="text-xs text-[#64748b]">{upgradeModalReason}</p>
          <DialogFooter className="mt-4">
            <button
              onClick={() => setUpgradeModalOpen(false)}
              className="flex-1 px-4 py-2 text-sm border border-[rgba(99,102,241,0.25)] rounded-lg text-[#94a3b8] hover:bg-[rgba(99,102,241,0.06)]"
            >
              Dismiss
            </button>
            <Link
              href="/settings/billing"
              className="flex-1 px-4 py-2 text-sm bg-[#5b5ef4] hover:bg-[#4f46e5] text-white rounded-lg text-center font-medium"
            >
              View plans
            </Link>
          </DialogFooter>
        </DialogContent>
      </Dialog>
```

- [ ] **Step 5: Verify frontend builds**

```bash
cd /Users/ken/Desktop/Lumidian/frontend
npm run build 2>&1 | tail -10
```

Expected: Build succeeds

- [ ] **Step 6: Commit**

```bash
cd /Users/ken/Desktop/Lumidian
git add frontend/app/content/page.tsx
git commit -m "feat: show upgrade modal when pitch user tries to draft opportunity"
```

---

## Task 6: Add subreddit links to standalone Reddit drafts

**Files:**
- Modify: `frontend/app/content/page.tsx`

- [ ] **Step 1: Find the draft card rendering for Reddit**

In `frontend/app/content/page.tsx`, find the section that renders the Reddit draft link (around line 603-630). This is where `{draft.opportunity_id != null && draft.platform === 'reddit'` is checked.

- [ ] **Step 2: Add standalone Reddit draft link**

After the existing Reddit opportunity link block (the one that checks `draft.opportunity_id != null`), add a new condition for standalone drafts:

```typescript
      {/* Reddit opportunity reply: link to thread */}
      {draft.opportunity_id != null && draft.platform === 'reddit' &&
       draft.platform_guidelines_applied?.startsWith('http') ? (
        // ... existing thread link code ...
      ) : null}

      {/* Standalone Reddit draft: link to subreddit */}
      {draft.opportunity_id == null && draft.platform === 'reddit' && (() => {
        const sub = extractSubreddit(draft.content_brief);
        const url = sub ? `https://reddit.com/r/${sub}` : 'https://reddit.com/submit';
        const label = sub ? `Post to r/${sub}` : 'Post to Reddit';
        return (
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2 bg-[rgba(249,115,22,0.07)] border border-[rgba(249,115,22,0.20)] rounded-lg px-3 py-2 group transition-colors hover:border-[rgba(249,115,22,0.35)] hover:bg-[rgba(249,115,22,0.11)]"
          >
            <span className="text-[#f97316] text-xs flex-shrink-0">↗</span>
            <span className="text-xs text-[#f97316] font-medium flex-1 min-w-0 truncate">
              {label}
            </span>
            <ExternalLink size={11} className="text-[#f97316]/60 flex-shrink-0 group-hover:text-[#f97316]" />
          </a>
        );
      })()}
```

- [ ] **Step 3: Verify the extractSubreddit helper exists**

The file should already have an `extractSubreddit` function (around line 135). Verify it exists:

```typescript
function extractSubreddit(contentBrief: string | null | undefined): string | null {
  if (!contentBrief) return null;
  const m = contentBrief.match(/\bin r\/([A-Za-z0-9_]+)/i);
  return m ? m[1] : null;
}
```

If it doesn't exist, add it after the other helper functions.

- [ ] **Step 4: Verify frontend builds**

```bash
cd /Users/ken/Desktop/Lumidian/frontend
npm run build 2>&1 | tail -10
```

Expected: Build succeeds

- [ ] **Step 5: Commit**

```bash
cd /Users/ken/Desktop/Lumidian
git add frontend/app/content/page.tsx
git commit -m "feat: add subreddit links to standalone Reddit drafts"
```

---

## Task 7: Manual Testing

- [ ] **Step 1: Start backend**

```bash
cd /Users/ken/Desktop/Lumidian/backend
source venv/bin/activate
python3 -m uvicorn app.main:app --reload --port 3001
```

- [ ] **Step 2: Start frontend**

```bash
cd /Users/ken/Desktop/Lumidian/frontend
npm run dev
```

- [ ] **Step 3: Test merged banner with model progress**

1. Go to dashboard with a brand
2. Click "Run Report Now"
3. Verify: only AppShell banner shows at top with model progress pills appearing as each completes
4. Verify: no separate per-brand "Report in progress" card below

- [ ] **Step 4: Test first-run empty state**

1. Create a new brand via onboarding
2. Verify: stats section replaced with centered "Running your first AI visibility report..." message
3. Verify: after run completes, stats populate normally

- [ ] **Step 5: Test pitch user opportunity gating**

1. Log in as a user with a pitch brand
2. Go to Content Hub → Live Opportunities
3. Click "Draft Reply" on any opportunity
4. Verify: upgrade modal appears (not error alert)
5. Verify: can still dismiss opportunities

- [ ] **Step 6: Test Reddit draft subreddit links**

1. Find a standalone Reddit draft (not from an opportunity)
2. Verify: shows link to subreddit like "Post to r/sneakers"
3. Verify: clicking opens correct Reddit URL

---

## Summary

| Task | Description |
|------|-------------|
| 1 | Extend background-status API to return model_scores |
| 2 | Update AppShell to show model progress pills in banner |
| 3 | Remove duplicate banners; add first-run empty state |
| 4 | Add pitch brand check to opportunity drafting endpoint |
| 5 | Handle 402 with upgrade modal in content page |
| 6 | Add subreddit links to standalone Reddit drafts |
| 7 | Manual testing |
