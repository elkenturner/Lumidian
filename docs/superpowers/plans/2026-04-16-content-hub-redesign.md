# Content Hub Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restructure the Content Hub to clearly separate Visibility Opportunities from Content Drafts, add type badges, show inline drafted replies on opportunities, and make scheduled/posted cards compact and expandable.

**Architecture:** Frontend-only changes across ~10 files. The tab structure changes from 4 flat tabs to 3 primary tabs (Visibility Opportunities | Content Drafts | Posted), with Content Drafts having Queue/Scheduled sub-tabs. DraftCard gets type badges, OpportunityCard gets inline drafted replies, ScheduledCard and PostedCard become compact/expandable. No backend changes — all data fields already exist.

**Tech Stack:** Next.js 15, React 18, TypeScript, Tailwind CSS, Framer Motion, lucide-react

**IMPORTANT:** Use the `impeccable` and `emil-design-eng` skills when implementing UI changes. These skills guide production-grade design and interaction polish.

**Spec:** `docs/superpowers/specs/2026-04-16-content-hub-redesign.md`

---

### Task 1: Update Tab Structure and Type Definitions

**Files:**
- Modify: `frontend/components/content/helpers.tsx:23` (QueueTab type)
- Modify: `frontend/app/content/page.tsx:87` (QueueTab type)
- Modify: `frontend/app/content/page.tsx:2105-2110` (TABS constant)
- Modify: `frontend/app/content/page.tsx:1558` (default activeTab)
- Modify: `frontend/app/content/page.tsx:1569-1574` (URL sync)
- Modify: `frontend/app/content/page.tsx:1624-1630` (tabDisabledPlatforms)
- Modify: `frontend/app/content/page.tsx:1645-1650` (tabCounts)

This task changes the type system and tab definitions. No visual changes yet.

- [ ] **Step 1: Update QueueTab type in helpers.tsx**

In `frontend/components/content/helpers.tsx`, the type needs a new `'content_drafts'` value for the primary tab. But since `drafts` and `scheduled` still exist as sub-tab values used by URL sync and platform toggles, we add the primary tab concept alongside:

```typescript
// line 23 — replace existing type
export type QueueTab = 'drafts' | 'scheduled' | 'opportunities' | 'posted';
export type PrimaryTab = 'opportunities' | 'content_drafts' | 'posted';
export type ContentDraftsSubTab = 'queue' | 'scheduled';
```

- [ ] **Step 2: Update QueueTab type in page.tsx**

In `frontend/app/content/page.tsx`, line 87:

```typescript
type QueueTab = 'drafts' | 'scheduled' | 'opportunities' | 'posted';
type PrimaryTab = 'opportunities' | 'content_drafts' | 'posted';
type ContentDraftsSubTab = 'queue' | 'scheduled';
```

- [ ] **Step 3: Update state variables in page.tsx**

Replace the `activeTab` state and add `activeSubTab`. Around line 1558:

```typescript
const [activePrimaryTab, setActivePrimaryTab] = useState<PrimaryTab>('content_drafts');
const [activeSubTab, setActiveSubTab] = useState<ContentDraftsSubTab>('queue');
```

Derive `activeTab` for backward compatibility with ContentTabPanels:

```typescript
// Derive the legacy activeTab value for ContentTabPanels
const activeTab: QueueTab = activePrimaryTab === 'content_drafts'
  ? (activeSubTab === 'scheduled' ? 'scheduled' : 'drafts')
  : activePrimaryTab === 'opportunities'
  ? 'opportunities'
  : 'posted';
```

- [ ] **Step 4: Update URL sync**

Replace lines 1569-1574:

```typescript
useEffect(() => {
  const tab = new URLSearchParams(window.location.search).get('tab');
  if (tab === 'opportunities') {
    setActivePrimaryTab('opportunities');
  } else if (tab === 'drafts') {
    setActivePrimaryTab('content_drafts');
    setActiveSubTab('queue');
  } else if (tab === 'scheduled') {
    setActivePrimaryTab('content_drafts');
    setActiveSubTab('scheduled');
  } else if (tab === 'posted') {
    setActivePrimaryTab('posted');
  }
}, []);
```

- [ ] **Step 5: Update TABS constant**

Replace lines 2105-2110:

```typescript
const PRIMARY_TABS: { key: PrimaryTab; label: string }[] = [
  { key: 'opportunities', label: 'Visibility Opportunities' },
  { key: 'content_drafts', label: 'Content Drafts' },
  { key: 'posted', label: 'Posted' },
];
```

- [ ] **Step 6: Update tabDisabledPlatforms initial state**

Replace lines 1624-1630. The platform toggles still need to work per-view. Map primary tabs to their toggle keys:

```typescript
const [tabDisabledPlatforms, setTabDisabledPlatforms] = useState<Record<QueueTab, string[]>>({
  drafts: [],
  scheduled: [],
  opportunities: [],
  posted: [],
});
```

Keep this as-is since `_disabledPlatforms` still uses `activeTab` (the derived value).

- [ ] **Step 7: Update tabCounts**

Replace lines 1645-1650. Add a combined count for Content Drafts:

```typescript
const tabCounts = {
  drafts: draftItems.length,
  scheduled: scheduledItems.length,
  opportunities: opportunities.length,
  posted: postedItems.length,
};
const primaryTabCounts = {
  opportunities: opportunities.length,
  content_drafts: draftItems.length + scheduledItems.length,
  posted: postedItems.length,
};
```

- [ ] **Step 8: Verify build compiles**

Run: `cd frontend && npx tsc --noEmit 2>&1 | head -30`

Fix any type errors before proceeding.

- [ ] **Step 9: Commit**

```bash
git add frontend/components/content/helpers.tsx frontend/app/content/page.tsx
git commit -m "refactor: add primary tab types and state for content hub redesign"
```

---

### Task 2: Update Tab Bar Rendering with Sub-Tabs

**Files:**
- Modify: `frontend/app/content/page.tsx:2488-2512` (tab bar rendering)

- [ ] **Step 1: Replace tab bar with primary tabs + sub-tabs**

Replace the tab bar section (lines 2488-2512) with:

```tsx
{/* Primary tab bar */}
<div className="flex gap-1 mb-3 overflow-x-auto" style={{ scrollbarWidth: 'none' }}>
  {PRIMARY_TABS.map((tab) => (
    <button
      key={tab.key}
      onClick={() => {
        setActivePrimaryTab(tab.key);
        if (tab.key === 'content_drafts') setActiveSubTab('queue');
      }}
      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-[color,background-color,border-color] ${
        activePrimaryTab === tab.key
          ? 'bg-[rgba(95,126,166,0.18)] text-[var(--accent-foreground)] border border-[rgba(95,126,166,0.30)] shadow-[0_0_14px_rgba(95,126,166,0.14)]'
          : 'text-[var(--text-faint)] bg-transparent border border-transparent hover:text-[var(--text-muted)]'
      }`}
    >
      {tab.label}
      {primaryTabCounts[tab.key] > 0 && (
        <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${
          activePrimaryTab === tab.key
            ? 'bg-[rgba(95,126,166,0.25)] text-[var(--accent-foreground)]'
            : 'bg-[rgba(255,255,255,0.08)] text-[var(--text-faint)]'
        }`}>
          {primaryTabCounts[tab.key]}
        </span>
      )}
    </button>
  ))}
</div>

{/* Sub-tabs for Content Drafts */}
{activePrimaryTab === 'content_drafts' && (
  <div className="flex gap-1 mb-5 pl-0.5">
    {([
      { key: 'queue' as ContentDraftsSubTab, label: 'Queue', count: tabCounts.drafts },
      { key: 'scheduled' as ContentDraftsSubTab, label: 'Scheduled', count: tabCounts.scheduled },
    ]).map((sub) => (
      <button
        key={sub.key}
        onClick={() => setActiveSubTab(sub.key)}
        className={`px-2.5 py-1 rounded-md text-xs font-medium transition-[color,background-color] ${
          activeSubTab === sub.key
            ? 'bg-[var(--bg-card)] text-[var(--text-primary)]'
            : 'text-[var(--text-faint)] hover:text-[var(--text-secondary)]'
        }`}
      >
        {sub.label}
        {sub.count > 0 && (
          <span className="text-[10px] ml-1 text-[var(--accent)]">{sub.count}</span>
        )}
      </button>
    ))}
  </div>
)}

{/* Non-content-drafts tabs get their own spacing */}
{activePrimaryTab !== 'content_drafts' && <div className="mb-2" />}
```

- [ ] **Step 2: Update sidebar button logic**

The sidebar currently checks `activeTab === 'opportunities'` to show scan vs generate button (line 2589). Update to use `activePrimaryTab`:

Replace `activeTab === 'opportunities'` with `activePrimaryTab === 'opportunities'` at line 2589.

- [ ] **Step 3: Update sidebar "Saved Drafts" label**

In the queue stats section (line 2666), update the label:

Replace `{ label: 'Saved Drafts', count: draftStatus.scheduled_count, cap: draftStatus.scheduled_cap }` with `{ label: 'Scheduled', count: draftStatus.scheduled_count, cap: draftStatus.scheduled_cap }`.

- [ ] **Step 4: Update platform toggle filter for opportunities**

Line 2726 checks `activeTab === 'opportunities'`. Replace with `activePrimaryTab === 'opportunities'`.

- [ ] **Step 5: Verify the page renders with new tabs**

Run: `cd frontend && npm run dev`

Open http://localhost:3002/content and verify:
- Three primary tabs render: Visibility Opportunities | Content Drafts | Posted
- Content Drafts tab shows Queue / Scheduled sub-tabs
- Clicking between tabs works
- Sidebar buttons switch correctly between scan and generate

- [ ] **Step 6: Commit**

```bash
git add frontend/app/content/page.tsx
git commit -m "feat: implement three-tab layout with sub-tabs for content hub"
```

---

### Task 3: Update ContentTabPanels Router

**Files:**
- Modify: `frontend/components/content/ContentTabPanels.tsx`

- [ ] **Step 1: Update the panel router**

The ContentTabPanels already receives `activeTab` which is now the derived legacy value. It should continue to work as-is since we derive `activeTab` from the primary/sub-tab state. Verify by reading the component and confirming it routes based on the same `'drafts' | 'scheduled' | 'opportunities' | 'posted'` values.

No code change needed if the derived `activeTab` value correctly maps. Verify this works by clicking through all tabs in the browser.

- [ ] **Step 2: Commit (if changes were needed)**

Only commit if changes were made.

---

### Task 4: Add Type Badges to DraftCard

**Files:**
- Modify: `frontend/components/content/cards/DraftCard.tsx:246-254` (top row of card)

- [ ] **Step 1: Add the type badge to DraftCard**

In `frontend/components/content/cards/DraftCard.tsx`, after the opening `<div>` of the card (line 247), update the top row. The card already has `<PlatformBadge platform={draft.platform} />` at line 250. Add a type badge next to it.

Find the top row section:
```tsx
      {/* Top row */}
      <div className="flex items-center justify-between gap-2">
        <PlatformBadge platform={draft.platform} />
        <span className="text-[10px] text-[var(--text-faint)] shrink-0">
          {relativeTime(draft.created_at)}
        </span>
      </div>
```

Replace with:
```tsx
      {/* Top row */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <PlatformBadge platform={draft.platform} />
          {draft.opportunity_id != null || draft.source === 'opportunity' ? (
            <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-[rgba(99,102,241,0.12)] text-[#818cf8]">
              Thread Reply
            </span>
          ) : (
            <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-[rgba(74,222,128,0.10)] text-[#4ade80]">
              Original Content
            </span>
          )}
        </div>
        <span className="text-[10px] text-[var(--text-faint)] shrink-0">
          {relativeTime(draft.created_at)}
        </span>
      </div>
```

- [ ] **Step 2: Add purple left border for opportunity drafts**

Update the card wrapper's className. Find line 247:
```tsx
    <div className={`card card-hover p-5 flex flex-col gap-3 transition-colors ${qualityClass}`}>
```

Replace with:
```tsx
    <div className={`card card-hover p-5 flex flex-col gap-3 transition-colors ${qualityClass} ${draft.opportunity_id != null || draft.source === 'opportunity' ? 'border-l-[3px] border-l-[#6366f1]' : ''}`}>
```

- [ ] **Step 3: Add "Re: [thread]" line and "View original thread" link for opportunity drafts**

Add a new block right after the type badge row (before the existing platform-specific context blocks). Insert after the top row closing `</div>`:

```tsx
      {/* Thread reply context */}
      {(draft.opportunity_id != null || draft.source === 'opportunity') && (
        <div className="flex flex-col gap-1">
          {draft.content_brief && (
            <p className="text-xs text-[var(--text-muted)] leading-relaxed truncate">
              Re: {draft.content_brief.replace(/^Reply .* in r\/\w+ — /, '').replace(/^Targeting: /, '')}
            </p>
          )}
          {draft.platform_guidelines_applied?.startsWith('http') && (
            <a
              href={draft.platform_guidelines_applied}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1 text-[11px] text-[#818cf8] hover:text-[#a5b4fc] transition-colors"
            >
              <ExternalLink size={10} />
              View original thread
            </a>
          )}
        </div>
      )}
```

- [ ] **Step 4: Verify in browser**

Open http://localhost:3002/content and check:
- Standalone drafts show green "Original Content" badge
- Opportunity drafts (if any) show purple "Thread Reply" badge with left border
- Thread reply link appears for opportunity drafts

- [ ] **Step 5: Commit**

```bash
git add frontend/components/content/cards/DraftCard.tsx
git commit -m "feat: add type badges and thread context to DraftCard"
```

---

### Task 5: Add Type Badges to page.tsx DraftCard (Legacy Inline Version)

**Files:**
- Modify: `frontend/app/content/page.tsx:91-300` (inline DraftCard function)

The main `page.tsx` has its own `DraftCard` function (lines 91-300) that's used in some contexts. Apply the same type badge and border treatment.

- [ ] **Step 1: Check if the inline DraftCard is still used**

Run: `cd frontend && grep -n 'DraftCard' app/content/page.tsx | head -20`

If the inline DraftCard at line 91 is unused (the component-based one from `cards/DraftCard.tsx` is used via `DraftsPanel`), skip this task. If it IS used somewhere, apply the same badge pattern from Task 4.

- [ ] **Step 2: Apply changes if needed or skip**

- [ ] **Step 3: Commit if changes were made**

---

### Task 6: Add Inline Drafted Reply to OpportunityCard

**Files:**
- Modify: `frontend/components/content/cards/OpportunityCard.tsx`
- Modify: `frontend/components/content/OpportunitiesPanel.tsx`
- Modify: `frontend/components/content/helpers.tsx:33-79` (ContentTabPanelsProps)

- [ ] **Step 1: Add props to ContentTabPanelsProps**

No new props needed — `draftItems` is already in `ContentTabPanelsProps` (line 39). OpportunitiesPanel already has access to it via `props`.

- [ ] **Step 2: Update OpportunitiesPanel to pass draft data to OpportunityCard**

In `frontend/components/content/OpportunitiesPanel.tsx`, destructure `draftItems` from props, and pass the matching draft to each OpportunityCard:

Add `draftItems` to the destructured props (after line 14):

```typescript
const {
  opportunities, visibleOpportunities, oppPlatformFilter, setOppPlatformFilter,
  handleDraftOpportunity, handleDismissOpportunity, draftStatus, setOppHelpOpen,
  _disabledPlatforms, draftItems,
} = props;
```

Update the OpportunityCard rendering (line 81-86):

```tsx
{visibleOpportunities.map((o) => (
  <motion.div key={o.id} variants={staggerChild}>
    <OpportunityCard
      opp={o}
      onDraft={handleDraftOpportunity}
      onDismiss={handleDismissOpportunity}
      queueFull={!!draftStatus?.draft_queue_full}
      draftedReply={draftItems.find((d) => d.opportunity_id === o.id) ?? null}
      onNavigateToDraft={(draftId: number) => {
        // This will be handled by a new prop from the parent page
      }}
    />
  </motion.div>
))}
```

We also need to pass the navigate handler from the parent. Add to ContentTabPanelsProps in `helpers.tsx`:

```typescript
// Add to ContentTabPanelsProps interface:
onNavigateToQueueDraft?: (draftId: number) => void;
```

- [ ] **Step 3: Update OpportunityCard to accept and render inline draft**

Replace the full `OpportunityCard` component in `frontend/components/content/cards/OpportunityCard.tsx`:

```tsx
'use client';

import { useState } from 'react';
import {
  Loader2,
  X,
  ExternalLink,
  Clock,
  Sparkles,
  Edit2,
  Copy,
  Check,
} from 'lucide-react';
import { ContentOpportunity, ContentDraft } from '@/lib/api';
import PlatformBadge from '@/components/PlatformBadge';
import { relativeTime } from '../helpers';

export function OpportunityCard({
  opp,
  onDraft,
  onDismiss,
  queueFull,
  draftedReply,
  onNavigateToDraft,
}: {
  opp: ContentOpportunity;
  onDraft: (id: number) => void;
  onDismiss: (id: number) => void;
  queueFull?: boolean;
  draftedReply?: ContentDraft | null;
  onNavigateToDraft?: (draftId: number) => void;
}) {
  const [drafting, setDrafting] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);

  async function handleDraft() {
    setDrafting(true);
    try {
      await onDraft(opp.id);
    } finally {
      setDrafting(false);
    }
  }

  async function handleCopy() {
    if (!draftedReply) return;
    try {
      await navigator.clipboard.writeText(draftedReply.content_text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // clipboard unavailable
    }
  }

  const relevanceColor =
    opp.relevance_score >= 70
      ? 'text-[var(--success)]'
      : opp.relevance_score >= 40
      ? 'text-[var(--warning)]'
      : 'text-[var(--text-muted)]';

  const hasDraft = !!draftedReply;

  return (
    <div className="card p-4 flex flex-col gap-3 transition-colors">
      <div className="flex items-center gap-2 flex-wrap">
        <PlatformBadge platform={opp.platform} />
        {opp.subreddit && (
          <span className="text-xs text-[var(--text-muted)] font-medium">r/{opp.subreddit}</span>
        )}
        {hasDraft && (
          <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-[rgba(251,191,36,0.12)] text-[#fbbf24]">
            Drafted
          </span>
        )}
        <span className={`text-xs font-semibold font-mono ml-auto ${relevanceColor}`}>
          {Math.round(opp.relevance_score)}% relevance
        </span>
      </div>

      <a
        href={opp.thread_url}
        target="_blank"
        rel="noopener noreferrer"
        className="text-sm font-medium text-[var(--text-primary)] hover:text-[var(--accent)] transition-colors leading-snug flex items-start gap-1.5"
      >
        {opp.thread_title || opp.thread_url}
        <ExternalLink size={11} className="shrink-0 mt-0.5 text-[var(--text-faint)]" />
      </a>

      {opp.body_preview && (
        <div className="relative">
          <p
            className={`text-xs text-[var(--text-faint)] leading-relaxed cursor-pointer ${
              expanded ? 'max-h-48 overflow-y-auto pr-2' : 'line-clamp-2'
            }`}
            onClick={() => setExpanded(!expanded)}
          >
            {opp.body_preview}
          </p>
          {opp.body_preview.length > 150 && (
            <button
              onClick={() => setExpanded(!expanded)}
              className="text-[10px] text-[var(--accent)] hover:text-[var(--accent-foreground)] mt-1"
            >
              {expanded ? 'Show less' : 'Show more'}
            </button>
          )}
        </div>
      )}

      <div className="flex items-center gap-3 text-xs text-[var(--text-faint)]">
        {opp.posted_at && (
          <span className="flex items-center gap-1">
            <Clock size={10} />
            {relativeTime(opp.posted_at)}
          </span>
        )}
        {opp.prompt_text && (
          <span className="text-[var(--text-faint)] truncate max-w-[200px]">
            Prompt: {opp.prompt_text}
          </span>
        )}
      </div>

      {/* Action buttons — show Draft Reply if not drafted, Visit always */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 pt-1">
        {!hasDraft && (
          <button
            onClick={handleDraft}
            disabled={drafting || queueFull}
            title={queueFull ? 'Draft queue full — approve or dismiss drafts to make room' : undefined}
            className="flex items-center gap-1.5 text-xs bg-[var(--accent)] hover:bg-[var(--accent-hover)] disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-lg px-3 py-1.5 transition-colors min-h-[44px] sm:min-h-0"
          >
            {drafting ? <Loader2 size={11} className="animate-spin" /> : <Sparkles size={11} />}
            {drafting ? 'Drafting…' : queueFull ? 'Queue full' : 'Draft Reply'}
          </button>
        )}
        <a
          href={opp.thread_url}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-1.5 text-xs text-[var(--text-secondary)] hover:text-[var(--accent)] rounded-lg px-3 py-1.5 transition-colors border border-[var(--border-subtle)] hover:border-[var(--accent)] min-h-[44px] sm:min-h-0"
        >
          <ExternalLink size={11} />
          Visit Thread
        </a>
        {!hasDraft && (
          <button
            onClick={() => onDismiss(opp.id)}
            className="flex items-center gap-1.5 text-xs text-[var(--danger)]/70 hover:text-[var(--danger)] rounded-lg px-3 py-1.5 transition-colors sm:ml-auto min-h-[44px] sm:min-h-0"
          >
            <X size={11} />
            Dismiss
          </button>
        )}
      </div>

      {/* Inline drafted reply */}
      {hasDraft && draftedReply && (
        <div className="bg-[rgba(99,102,241,0.05)] border border-[rgba(99,102,241,0.15)] rounded-lg p-3 mt-1">
          <p className="text-[11px] font-semibold text-[#818cf8] mb-2 flex items-center gap-1.5">
            <Edit2 size={10} />
            Your drafted reply
          </p>
          <p className="text-xs text-[var(--text-secondary)] leading-relaxed line-clamp-3">
            {draftedReply.content_text}
          </p>
          <div className="flex items-center gap-2 mt-3">
            <button
              onClick={() => onNavigateToDraft?.(draftedReply.id)}
              className="flex items-center gap-1.5 text-xs bg-[var(--bg-raised)] hover:bg-[var(--bg-card)] border border-[var(--border-subtle)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] rounded-lg px-3 py-1.5 transition-colors"
            >
              <Edit2 size={10} />
              Edit
            </button>
            <button
              onClick={handleCopy}
              className={`flex items-center gap-1.5 text-xs rounded-lg px-3 py-1.5 transition-colors border ${
                copied
                  ? 'bg-[color-mix(in_srgb,var(--success)_10%,transparent)] border-[color-mix(in_srgb,var(--success)_25%,transparent)] text-[var(--success)]'
                  : 'bg-[var(--bg-raised)] border-[var(--border-subtle)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-card)]'
              }`}
            >
              {copied ? <Check size={10} /> : <Copy size={10} />}
              {copied ? 'Copied!' : 'Copy'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Wire up the navigate-to-draft handler in page.tsx**

In `frontend/app/content/page.tsx`, add a handler function near the other handlers (around line 1890):

```typescript
function handleNavigateToQueueDraft(draftId: number) {
  setActivePrimaryTab('content_drafts');
  setActiveSubTab('queue');
  setPinnedDraftId(draftId);
}
```

Pass it to ContentTabPanels:

```tsx
onNavigateToQueueDraft={handleNavigateToQueueDraft}
```

- [ ] **Step 5: Pass the handler through OpportunitiesPanel**

In `frontend/components/content/OpportunitiesPanel.tsx`, add `onNavigateToQueueDraft` to destructured props, and pass it to OpportunityCard:

```tsx
onNavigateToDraft={onNavigateToQueueDraft ? (id: number) => onNavigateToQueueDraft(id) : undefined}
```

- [ ] **Step 6: Update OpportunitiesPanel header text**

Change the subtitle from "Threads and questions matched to your tracked prompts" to "Live threads where your brand can gain visibility":

```tsx
<p className="text-xs text-[var(--text-muted)]">
  Live threads where your brand can gain visibility
</p>
```

- [ ] **Step 7: Verify in browser**

Open http://localhost:3002/content and go to Visibility Opportunities tab:
- New opportunities show "Draft Reply" and "Dismiss" buttons
- Drafted opportunities show inline reply panel with Edit/Copy buttons
- Clicking "Edit" on inline draft navigates to Content Drafts → Queue with the draft highlighted
- "Visit Thread" button works on all opportunity cards

- [ ] **Step 8: Commit**

```bash
git add frontend/components/content/cards/OpportunityCard.tsx frontend/components/content/OpportunitiesPanel.tsx frontend/components/content/helpers.tsx frontend/app/content/page.tsx
git commit -m "feat: add inline drafted replies to opportunity cards"
```

---

### Task 7: Redesign ScheduledCard as Compact Expandable

**Files:**
- Modify: `frontend/components/content/cards/ScheduledCard.tsx`

- [ ] **Step 1: Redesign ScheduledCard to be collapsed by default**

Replace the entire `ScheduledCard` component. Key changes: `expanded` defaults to `false`, collapsed view shows a single compact row, type badge added:

```tsx
'use client';

import React, { useState } from 'react';
import {
  FileText,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  CheckCircle2,
  Edit2,
  AlertTriangle,
  Copy,
  Check,
  BookOpen,
  HelpCircle,
} from 'lucide-react';
import { ContentDraft } from '@/lib/api';
import PlatformBadge from '@/components/PlatformBadge';
import { relativeTime, PLATFORM_DISPLAY } from '../helpers';

const POSTING_GUIDANCE: Record<string, (brief: string | null) => React.ReactNode> = {
  reddit: (brief) => {
    const subreddit = brief?.match(/r\/([^\s,)]+)/)?.[1] ?? 'relevant subreddit';
    return (
      <ol className="list-decimal list-inside space-y-1 text-xs text-[var(--text-secondary)] leading-relaxed">
        <li>Go to <span className="text-[var(--accent)]">reddit.com/r/{subreddit}</span></li>
        <li>Click <span className="text-[var(--text-primary)] font-medium">New Post</span></li>
        <li>Choose <span className="text-[var(--text-primary)] font-medium">Text post</span></li>
        <li>Paste the title and body from the draft above</li>
        <li>Add relevant flair if available</li>
        <li>Click <span className="text-[var(--text-primary)] font-medium">Submit</span></li>
        <p className="mt-1 text-[var(--text-faint)] not-italic">Tip: Post between 9 am–12 pm in your target audience&apos;s timezone for best engagement.</p>
      </ol>
    );
  },
  quora: (brief) => {
    const isDirectUrl = brief?.startsWith('https://www.quora.com') || brief?.startsWith('https://quora.com');
    if (isDirectUrl) {
      return (
        <ol className="list-decimal list-inside space-y-1 text-xs text-[var(--text-secondary)] leading-relaxed">
          <li>Open <a href={brief!} target="_blank" rel="noopener noreferrer" className="text-[var(--accent)] hover:underline break-all">{brief}</a></li>
          <li>Click <span className="text-[var(--text-primary)] font-medium">Answer</span></li>
          <li>Paste your draft</li>
          <li>Add your credentials if relevant</li>
          <li>Click <span className="text-[var(--text-primary)] font-medium">Submit</span></li>
          <p className="mt-1 text-[var(--text-faint)] not-italic">Tip: Answer questions posted within the last 30 days for maximum visibility.</p>
        </ol>
      );
    }
    const topic = brief ? brief.split(' — ')[0].replace(/^Targeting: /i, '') : 'your topic';
    return (
      <ol className="list-decimal list-inside space-y-1 text-xs text-[var(--text-secondary)] leading-relaxed">
        <li>Go to <span className="text-[var(--accent)]">quora.com</span> and search for <span className="text-[var(--text-primary)] font-medium">&ldquo;{topic.slice(0, 40)}&rdquo;</span></li>
        <li>Find a relevant question</li>
        <li>Click <span className="text-[var(--text-primary)] font-medium">Answer</span></li>
        <li>Paste your draft</li>
        <li>Add your credentials if relevant</li>
        <li>Click <span className="text-[var(--text-primary)] font-medium">Submit</span></li>
        <p className="mt-1 text-[var(--text-faint)] not-italic">Tip: Answer questions posted within the last 30 days for maximum visibility.</p>
      </ol>
    );
  },
  medium: () => (
    <ol className="list-decimal list-inside space-y-1 text-xs text-[var(--text-secondary)] leading-relaxed">
      <li>Go to <a href="https://medium.com/new-story" target="_blank" rel="noopener noreferrer" className="text-[var(--accent)] hover:underline">medium.com/new-story</a></li>
      <li>Paste your title and body</li>
      <li>Add tags relevant to your topic (up to 5)</li>
      <li>Set a featured image if possible</li>
      <li>Click <span className="text-[var(--text-primary)] font-medium">Publish</span></li>
      <p className="mt-1 text-[var(--text-faint)] not-italic">Tip: Add your company publication if you have one set up.</p>
    </ol>
  ),
  wikipedia: () => (
    <ol className="list-decimal list-inside space-y-1 text-xs text-[var(--text-secondary)] leading-relaxed">
      <li>Find the target article on Wikipedia</li>
      <li>Click <span className="text-[var(--text-primary)] font-medium">Edit</span></li>
      <li>Navigate to the suggested section</li>
      <li>Paste the wiki-formatted text (use Copy Wiki Format button)</li>
      <li>Add an edit summary explaining your addition</li>
      <li>Click <span className="text-[var(--text-primary)] font-medium">Save</span></li>
      <p className="mt-1 text-[var(--warning)] not-italic flex items-start gap-1"><AlertTriangle size={10} className="shrink-0 mt-0.5" />Disclose any conflict of interest on the article talk page first.</p>
    </ol>
  ),
};

export function ScheduledCard({
  draft,
  onMarkPosted,
  onMoveToDrafts,
}: {
  draft: ContentDraft;
  onMarkPosted: (id: number) => void;
  onMoveToDrafts: (id: number) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [guideOpen, setGuideOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const title = draft.title ?? draft.content_text.slice(0, 80) + (draft.content_text.length > 80 ? '…' : '');
  const isReply = draft.opportunity_id != null || draft.source === 'opportunity';

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(draft.content_text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // clipboard unavailable
    }
  }

  const guidance = POSTING_GUIDANCE[draft.platform];

  // Compact collapsed view
  if (!expanded) {
    return (
      <button
        onClick={() => setExpanded(true)}
        className={`card w-full text-left px-4 py-3 flex items-center gap-3 transition-colors hover:border-[rgba(255,255,255,0.14)] cursor-pointer ${isReply ? 'border-l-[3px] border-l-[#6366f1]' : ''}`}
      >
        {isReply ? (
          <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-[rgba(99,102,241,0.12)] text-[#818cf8] shrink-0">
            Reply
          </span>
        ) : (
          <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-[rgba(74,222,128,0.10)] text-[#4ade80] shrink-0">
            Original
          </span>
        )}
        <p className="text-sm text-[var(--text-secondary)] truncate flex-1 min-w-0">{title}</p>
        <span className="text-[11px] text-[var(--text-faint)] shrink-0">{PLATFORM_DISPLAY[draft.platform] ?? draft.platform}</span>
        <ChevronRight size={14} className="text-[var(--text-faint)] shrink-0" />
      </button>
    );
  }

  // Expanded view — all existing functionality
  return (
    <div className={`card p-4 flex flex-col gap-3 transition-colors ${isReply ? 'border-l-[3px] border-l-[#6366f1]' : ''}`}>
      <div className="flex items-center gap-2 flex-wrap">
        <PlatformBadge platform={draft.platform} />
        {isReply ? (
          <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-[rgba(99,102,241,0.12)] text-[#818cf8]">
            Thread Reply
          </span>
        ) : (
          <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-[rgba(74,222,128,0.10)] text-[#4ade80]">
            Original Content
          </span>
        )}
        {draft.approved_at && (
          <span className="text-xs text-[var(--text-muted)] flex items-center gap-1">
            <CheckCircle2 size={11} className="text-[var(--success)]" />
            Approved {relativeTime(draft.approved_at)}
          </span>
        )}
        <button
          onClick={() => setExpanded(false)}
          className="ml-auto text-[var(--text-faint)] hover:text-[var(--text-secondary)] transition-colors"
          aria-label="Collapse"
        >
          <ChevronDown size={14} />
        </button>
      </div>

      {draft.content_brief && (
        <p className="text-xs text-[var(--text-faint)] leading-relaxed line-clamp-2">
          <span className="text-[var(--text-muted)]">Targeting: </span>
          {draft.content_brief}
        </p>
      )}

      <div>
        {draft.title && (
          <p className="text-sm font-semibold text-[var(--text-primary)] leading-snug mb-1">{draft.title}</p>
        )}
        {!draft.title && (
          <p className="text-sm text-[var(--text-secondary)] leading-relaxed truncate">{title}</p>
        )}
      </div>

      <div className="bg-[var(--bg-raised)] border border-[var(--border-subtle)] rounded-lg p-3 relative">
        <pre className="text-xs text-[var(--text-secondary)] whitespace-pre-wrap leading-relaxed font-mono pr-14">
          {draft.content_text}
        </pre>
        <button
          onClick={handleCopy}
          className="absolute top-2 right-2 flex items-center gap-1 text-[10px] text-[var(--text-faint)] hover:text-[var(--text-secondary)] transition-colors"
        >
          {copied ? <Check size={11} className="text-[var(--success)]" /> : <Copy size={11} />}
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>

      {guidance && (
        <div className="border border-[var(--border-default)] rounded-lg overflow-hidden">
          <button
            onClick={() => setGuideOpen(!guideOpen)}
            className="w-full flex items-center justify-between px-3 py-2 bg-[var(--bg-raised)] hover:bg-[var(--bg-card)] text-left transition-colors"
          >
            <span className="flex items-center gap-1.5 text-xs text-[var(--text-muted)] font-medium">
              <BookOpen size={11} />
              How to Post on {PLATFORM_DISPLAY[draft.platform] ?? draft.platform}
            </span>
            <ChevronDown size={11} className={`text-[var(--text-faint)] transition-transform ${guideOpen ? 'rotate-180' : ''}`} />
          </button>
          {guideOpen && (
            <div className="px-3 py-3 bg-transparent">
              {guidance(draft.content_brief)}
            </div>
          )}
        </div>
      )}

      <div className="bg-[color-mix(in_srgb,var(--success)_5%,transparent)] border border-[color-mix(in_srgb,var(--success)_12%,transparent)] rounded-lg px-3 py-2 flex items-start gap-2">
        <HelpCircle size={11} className="text-[var(--success)] mt-0.5 shrink-0" />
        <p className="text-[11px] text-[var(--text-faint)] leading-relaxed">
          <span className="text-[var(--text-muted)] font-medium">This draft needs to be posted manually.</span>
          {' '}Copy the content, post it on {PLATFORM_DISPLAY[draft.platform] ?? draft.platform}, then click{' '}
          <span className="text-[var(--success)]">Mark as Posted</span> to record it and start tracking visibility changes.
        </p>
      </div>

      <div className="flex items-center gap-2 pt-1 flex-wrap">
        <button
          onClick={() => onMarkPosted(draft.id)}
          className="flex items-center gap-1.5 text-xs bg-[color-mix(in_srgb,var(--success)_10%,transparent)] hover:bg-[color-mix(in_srgb,var(--success)_15%,transparent)] border border-[color-mix(in_srgb,var(--success)_25%,transparent)] text-[var(--success)] rounded-lg px-3 py-1.5 transition-colors duration-150"
        >
          <CheckCircle2 size={11} />
          Mark as Posted
        </button>
        <button
          onClick={() => onMoveToDrafts(draft.id)}
          className="flex items-center gap-1.5 text-xs text-[var(--text-faint)] hover:text-[var(--text-muted)] rounded-lg px-3 py-1.5 transition-colors ml-auto"
        >
          <Edit2 size={11} />
          Move back to Queue
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Update ScheduledPanel empty state text**

In `frontend/components/content/ScheduledPanel.tsx`, update the empty state:

```tsx
<EmptyState
  icon={<Clock size={26} className="text-[var(--accent-foreground)]" />}
  title="No scheduled drafts yet"
  description="Approve a draft from the Queue — it will appear here ready to post."
/>
```

- [ ] **Step 3: Update DraftsPanel notice text**

In `frontend/components/content/DraftsPanel.tsx`, line 127, update the "Saved Drafts" reference:

Replace `<span className="text-[var(--text-secondary)]">Saved Drafts</span>` with `<span className="text-[var(--text-secondary)]">Scheduled</span>`.

- [ ] **Step 4: Verify in browser**

Open http://localhost:3002/content → Content Drafts → Scheduled:
- Cards show as compact single-line rows by default
- Clicking a row expands it to show full content, posting guide, actions
- Type badges show (Reply vs Original)
- Reply-type cards have purple left border
- "Move back to Queue" label (not "Move back to Drafts")

- [ ] **Step 5: Commit**

```bash
git add frontend/components/content/cards/ScheduledCard.tsx frontend/components/content/ScheduledPanel.tsx frontend/components/content/DraftsPanel.tsx
git commit -m "feat: redesign ScheduledCard as compact expandable rows with type badges"
```

---

### Task 8: Redesign PostedCard as Compact Expandable

**Files:**
- Modify: `frontend/components/content/cards/PostedCard.tsx`

- [ ] **Step 1: Redesign PostedCard with collapsed/expanded states**

Replace the entire `PostedCard` component to match the ScheduledCard compact pattern:

```tsx
'use client';

import { useState } from 'react';
import {
  ArrowRight,
  BarChart2,
  ChevronRight,
  ChevronDown,
} from 'lucide-react';
import { ContentDraft, DraftAttribution } from '@/lib/api';
import PlatformBadge from '@/components/PlatformBadge';
import { relativeTime, PLATFORM_DISPLAY } from '../helpers';

export function PostedCard({ draft, attribution }: { draft: ContentDraft; attribution?: DraftAttribution }) {
  const [expanded, setExpanded] = useState(false);
  const title = draft.title ?? draft.content_text.slice(0, 80) + (draft.content_text.length > 80 ? '…' : '');
  const isReply = draft.opportunity_id != null || draft.source === 'opportunity';

  type ConfidenceTier = 'awaiting' | 'early' | 'developing' | 'established';
  function getConfidenceTier(runs: number): ConfidenceTier {
    if (runs === 0) return 'awaiting';
    if (runs <= 2) return 'early';
    if (runs <= 5) return 'developing';
    return 'established';
  }
  const TIER_LABELS: Record<ConfidenceTier, string> = {
    awaiting: 'Awaiting next report',
    early: 'Early data',
    developing: 'Developing',
    established: 'Established',
  };
  const TIER_COLORS: Record<ConfidenceTier, string> = {
    awaiting: 'var(--text-faint)',
    early: 'var(--text-muted)',
    developing: 'var(--accent-foreground)',
    established: 'var(--success)',
  };

  let attributionNode: JSX.Element | null = null;
  if (attribution) {
    const tier = getConfidenceTier(attribution.runs_since_posting);
    const tierColor = TIER_COLORS[tier];
    const tierLabel = TIER_LABELS[tier];

    if (tier === 'awaiting') {
      attributionNode = (
        <div className="flex items-center gap-1.5 mt-1">
          <span className="text-[10px] px-1.5 py-0.5 rounded-full border" style={{ color: tierColor, borderColor: `color-mix(in srgb, ${tierColor} 25%, transparent)`, backgroundColor: `color-mix(in srgb, ${tierColor} 6%, transparent)` }}>
            {tierLabel}
          </span>
          <span className="text-xs text-[var(--text-faint)]">Next tracking run will measure visibility change.</span>
        </div>
      );
    } else {
      const scoreBefore = attribution.score_at_posting;
      const scoreNow = attribution.current_score ?? 0;
      const delta = attribution.delta;
      const deltaColor = delta == null ? 'var(--text-secondary)' : delta > 0 ? 'var(--success)' : delta < 0 ? 'var(--danger)' : 'var(--text-secondary)';
      const deltaLabel = delta == null ? '—' : delta > 0 ? `+${delta.toFixed(1)}pp` : `${delta.toFixed(1)}pp`;
      const runs = attribution.runs_since_posting;

      attributionNode = (
        <div className="mt-2 flex flex-col gap-1.5">
          <div className="flex items-center gap-3 flex-wrap">
            {scoreBefore != null && (
              <div className="flex items-center gap-1">
                <span className="text-[10px] text-[var(--text-faint)]">At posting</span>
                <span className="text-xs font-medium font-mono text-[var(--text-secondary)]">{scoreBefore.toFixed(1)}%</span>
              </div>
            )}
            {scoreBefore != null && <ArrowRight size={10} className="text-[var(--text-faint)]" />}
            <div className="flex items-center gap-1">
              <span className="text-[10px] text-[var(--text-faint)]">Now</span>
              <span className="text-xs font-medium font-mono text-[var(--text-primary)]">{scoreNow.toFixed(1)}%</span>
            </div>
            {delta != null && (
              <span className="text-xs font-semibold font-mono" style={{ color: deltaColor }}>{deltaLabel}</span>
            )}
            <span className="text-[10px] px-1.5 py-0.5 rounded-full border ml-auto" style={{ color: tierColor, borderColor: `color-mix(in srgb, ${tierColor} 25%, transparent)`, backgroundColor: `color-mix(in srgb, ${tierColor} 6%, transparent)` }}>
              {tierLabel}
            </span>
          </div>
          <p className="text-[10px] text-[var(--text-faint)] leading-relaxed">
            Based on {runs} tracking run{runs !== 1 ? 's' : ''} since posting.{' '}
            {tier === 'early' && 'More data needed before drawing conclusions.'}
            {tier === 'developing' && 'Trend is forming — keep an eye on the next few runs.'}
            {tier === 'established' && 'Sufficient data to observe a trend (correlation, not causation).'}
          </p>
        </div>
      );
    }
  } else if (draft.visibility_at_post != null) {
    attributionNode = (
      <div className="flex items-center gap-1 mt-1">
        <span className="text-[10px] text-[var(--text-faint)]">Brand visibility at time of posting:</span>
        <span className="text-xs font-medium font-mono text-[var(--text-secondary)]">{draft.visibility_at_post.toFixed(1)}%</span>
      </div>
    );
  }

  // Compact collapsed view
  if (!expanded) {
    return (
      <button
        onClick={() => setExpanded(true)}
        className={`card w-full text-left px-4 py-3 flex items-center gap-3 transition-colors hover:border-[rgba(255,255,255,0.14)] cursor-pointer ${isReply ? 'border-l-[3px] border-l-[#6366f1]' : ''}`}
      >
        {isReply ? (
          <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-[rgba(99,102,241,0.12)] text-[#818cf8] shrink-0">
            Reply
          </span>
        ) : (
          <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-[rgba(74,222,128,0.10)] text-[#4ade80] shrink-0">
            Original
          </span>
        )}
        <p className="text-sm text-[var(--text-secondary)] truncate flex-1 min-w-0">{title}</p>
        <span className="text-[11px] text-[var(--text-faint)] shrink-0">{PLATFORM_DISPLAY[draft.platform] ?? draft.platform}</span>
        <span className="text-xs text-[var(--text-faint)] shrink-0">{relativeTime(draft.updated_at)}</span>
        <ChevronRight size={14} className="text-[var(--text-faint)] shrink-0" />
      </button>
    );
  }

  // Expanded view
  return (
    <div className={`card p-4 flex flex-col gap-2 transition-colors ${isReply ? 'border-l-[3px] border-l-[#6366f1]' : ''}`}>
      <div className="flex items-center gap-2">
        <PlatformBadge platform={draft.platform} />
        {isReply ? (
          <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-[rgba(99,102,241,0.12)] text-[#818cf8]">
            Thread Reply
          </span>
        ) : (
          <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-[rgba(74,222,128,0.10)] text-[#4ade80]">
            Original Content
          </span>
        )}
        <p className="flex-1 text-sm text-[var(--text-secondary)] truncate">{title}</p>
        <span className="text-xs text-[var(--text-faint)] shrink-0">{relativeTime(draft.updated_at)}</span>
        <button
          onClick={() => setExpanded(false)}
          className="text-[var(--text-faint)] hover:text-[var(--text-secondary)] transition-colors"
          aria-label="Collapse"
        >
          <ChevronDown size={14} />
        </button>
      </div>

      <div className="bg-[var(--bg-base)] border border-[var(--border-subtle)] rounded-lg p-3">
        <pre className="text-xs text-[var(--text-muted)] whitespace-pre-wrap leading-relaxed font-mono">{draft.content_text}</pre>
      </div>

      {attributionNode && (
        <div className="border-t border-[var(--border-subtle)] pt-2">
          <p className="text-[10px] text-[var(--text-faint)] uppercase tracking-wide mb-1 flex items-center gap-1">
            <BarChart2 size={9} />
            Visibility change since posting
          </p>
          {attributionNode}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Verify in browser**

Open http://localhost:3002/content → Posted tab:
- Cards show as compact rows
- Clicking expands to show full content + visibility tracking
- Type badges and purple borders show correctly
- Collapse button works

- [ ] **Step 3: Commit**

```bash
git add frontend/components/content/cards/PostedCard.tsx
git commit -m "feat: redesign PostedCard as compact expandable rows with type badges"
```

---

### Task 9: Final Integration and Cleanup

**Files:**
- Modify: `frontend/app/content/page.tsx` (any remaining references)
- Modify: `frontend/components/content/ContentTabPanels.tsx` (if needed)

- [ ] **Step 1: Verify all tab transitions work**

Test in browser:
1. Click Visibility Opportunities → see opportunities with inline drafts
2. Click Content Drafts → Queue sub-tab active by default, drafts with type badges
3. Click Scheduled sub-tab → compact expandable cards
4. Click Posted → compact expandable cards
5. Click "Edit" on an inline drafted reply → navigates to Queue with draft highlighted

- [ ] **Step 2: Verify URL sync**

Test:
- Navigate to `/content?tab=opportunities` → Visibility Opportunities tab
- Navigate to `/content?tab=drafts` → Content Drafts → Queue
- Navigate to `/content?tab=scheduled` → Content Drafts → Scheduled
- Navigate to `/content?tab=posted` → Posted

- [ ] **Step 3: Verify platform toggles work per tab**

Test:
- Toggle off Reddit in Opportunities tab → Reddit opportunities hidden
- Switch to Content Drafts → Reddit drafts still visible (toggles are per-tab)
- Toggle off Reddit in Content Drafts → Reddit drafts hidden

- [ ] **Step 4: Verify sidebar context switches**

Test:
- On Visibility Opportunities tab → sidebar shows "Regenerate Live Opportunities"
- On Content Drafts tab → sidebar shows "Regenerate Drafts"
- On Posted tab → sidebar shows "Regenerate Drafts"

- [ ] **Step 5: Clean up any remaining "Saved Drafts" or "Live Opportunities" text**

Search for old terminology:

```bash
cd frontend && grep -rn "Saved Drafts\|Live Opportunities" --include="*.tsx" --include="*.ts" | grep -v node_modules | grep -v .next
```

Update any remaining references to use the new names ("Scheduled" and "Visibility Opportunities").

- [ ] **Step 6: Verify the build passes**

Run: `cd frontend && npm run build 2>&1 | tail -20`

Fix any type errors or build failures.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat: complete content hub redesign — opportunities vs drafts clarity"
```
