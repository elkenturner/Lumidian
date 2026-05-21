# Agency Portal Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the cluttered agency cockpit + redundant Today page with a guided, tab-driven flow: a "Next step" shelf surfaces the single most urgent action, and the 8-section stack collapses into 5 real tabs.

**Architecture:** Pure frontend refactor inside `/agency/*` routes. No backend changes. New components: `ClientNextStepShelf.tsx`, `CopyReviewLinkButton.tsx`. Restructured: `ClientCockpit.tsx`, `AgencySidebar.tsx`, `/agency/page.tsx`, `ClientPipelineTab.tsx`. Deleted: 6 unused components, 3 dead stub routes, orphaned API methods.

**Tech Stack:** Next.js 15 App Router, React 18, TypeScript (strict), Tailwind CSS, Radix UI (`Tabs`, `DropdownMenu`, `Dialog` — all already installed), lucide-react.

**Spec:** `docs/superpowers/specs/2026-05-20-agency-portal-cleanup-design.md`.

**Verification model:** Frontend has no unit tests. Each task ends with `npm run lint` (must pass) and a manual smoke step. Final task runs the full smoke checklist plus `npm run build`.

---

## File Plan

### New files
- `frontend/components/agency/ClientNextStepShelf.tsx` — pure presentational shelf surfacing the highest-priority next action.
- `frontend/components/agency/CopyReviewLinkButton.tsx` — compact header button that provisions a review link if missing and copies it.

### Modified files
- `frontend/components/agency/AgencySidebar.tsx` — add `Settings` entry.
- `frontend/components/agency/ClientCockpit.tsx` — full restructure: new header row, shelf, tabs replacing the 8 sections + right rail.
- `frontend/components/agency/ClientPipelineTab.tsx` — accept "Send drafts to client" CTA into its header area; absorbed from the deleted rail.
- `frontend/app/agency/page.tsx` — strip to `MyQueueSection` only; drop the 3-column layout and `agencyToday` call.
- `frontend/app/agency/clients/[id]/page.tsx` — no logic change, but pass any additional hooks the cockpit needs.
- `frontend/lib/api.ts` — prune exports orphaned by deletions (after verification).

### Deleted files
- `frontend/components/agency/ClientQuickActionsRail.tsx`
- `frontend/components/agency/TaskList.tsx`
- `frontend/components/agency/TaskRow.tsx`
- `frontend/components/agency/AssigneePicker.tsx`
- `frontend/components/agency/ActivityFeed.tsx`
- `frontend/components/agency/RecentActivitySection.tsx`
- `frontend/components/agency/activity-icons.tsx`
- `frontend/components/agency/ReviewLinkSection.tsx`
- `frontend/app/agency/calendar/page.tsx`
- `frontend/app/agency/opportunities/page.tsx`
- `frontend/app/agency/performance/page.tsx`

---

## Task 1: Sidebar — add Settings entry

**Files:**
- Modify: `frontend/components/agency/AgencySidebar.tsx:14-18`

- [ ] **Step 1: Add the Settings entry to the NAV array**

Edit `frontend/components/agency/AgencySidebar.tsx`. Update imports to include `Settings` icon, and add the new nav item:

Change line 5-11 from:
```tsx
import {
  Home,
  Users,
  FileText,
  ArrowLeft,
  Shield,
} from 'lucide-react';
```
to:
```tsx
import {
  Home,
  Users,
  FileText,
  Settings as SettingsIcon,
  ArrowLeft,
  Shield,
} from 'lucide-react';
```

Change line 14-18 from:
```tsx
const NAV = [
  { href: '/agency', label: 'Today', icon: Home, exact: true },
  { href: '/agency/clients', label: 'Clients', icon: Users, exact: false },
  { href: '/agency/documents', label: 'Documents', icon: FileText, exact: false },
];
```
to:
```tsx
const NAV = [
  { href: '/agency', label: 'Today', icon: Home, exact: true },
  { href: '/agency/clients', label: 'Clients', icon: Users, exact: false },
  { href: '/agency/documents', label: 'Documents', icon: FileText, exact: false },
  { href: '/agency/settings', label: 'Settings', icon: SettingsIcon, exact: false },
];
```

- [ ] **Step 2: Verify lint passes**

Run: `cd frontend && npm run lint`
Expected: no errors.

- [ ] **Step 3: Smoke verify in browser**

Start dev server (`cd frontend && npm run dev` in another terminal if not already running on port 3002). Navigate to `/agency`. Confirm sidebar shows Today / Clients / Documents / Settings. Click Settings — should render the existing stub page without errors.

- [ ] **Step 4: Commit**

```bash
git add frontend/components/agency/AgencySidebar.tsx
git commit -m "feat(agency): add Settings to sidebar nav"
```

---

## Task 2: Today page — strip to queue only

**Files:**
- Modify: `frontend/app/agency/page.tsx` (full rewrite)

- [ ] **Step 1: Replace `frontend/app/agency/page.tsx` contents**

Write the new file. This drops the 3 columns (`drafts_to_review`, `awaiting_client`, `approved`), the `agencyToday()` call, the `NudgePill` imports, and the `agency-helpers` imports — `MyQueueSection` is the only section that remains, plus a compact header. Use `agencyMyQueue()` directly for the summary line so we don't depend on `agencyToday()` at all.

```tsx
'use client';

import { useEffect, useState } from 'react';
import { agencyMyQueue, type MyQueueResponse } from '@/lib/api';
import { MyQueueSection } from '@/components/agency/MyQueueSection';

export default function AgencyTodayPage() {
  const [queue, setQueue] = useState<MyQueueResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    agencyMyQueue()
      .then(setQueue)
      .catch((e) => setError(String(e?.message ?? e)));
  }, []);

  if (error) return <div className="p-8 text-sm text-red-400">{error}</div>;

  const total = queue ? queue.drafts.length + queue.tasks.length : 0;

  return (
    <div className="p-8 text-[var(--text-primary)]">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Today</h1>
        <p className="text-sm text-[var(--text-muted)]">
          {queue == null
            ? 'Loading…'
            : total === 0
              ? 'Nothing in your queue.'
              : `${total} item${total === 1 ? '' : 's'} in your queue`}
        </p>
      </div>

      <MyQueueSection />
    </div>
  );
}
```

Note: `MyQueueSection` already fetches its own data via `agencyMyQueue`. We make a second call here for the summary line — that's fine for a low-traffic staff tool. If lint/perf reviewer complains later, lift state into the page.

- [ ] **Step 2: Verify lint passes**

Run: `cd frontend && npm run lint`
Expected: no errors. (If unused imports remain, remove them.)

- [ ] **Step 3: Smoke verify**

Open `/agency`. Confirm: only the header + "Your queue" section is visible. No 3-column block. Hard-refresh; confirm count line renders correctly with both 0 items and N items.

- [ ] **Step 4: Commit**

```bash
git add frontend/app/agency/page.tsx
git commit -m "feat(agency): strip Today to queue-only layout"
```

---

## Task 3: Delete dead stub routes

**Files:**
- Delete: `frontend/app/agency/calendar/page.tsx`
- Delete: `frontend/app/agency/opportunities/page.tsx`
- Delete: `frontend/app/agency/performance/page.tsx`

- [ ] **Step 1: Confirm no internal links to these routes**

Run:
```bash
grep -rn "agency/calendar\|agency/opportunities\|agency/performance" frontend --include="*.tsx" --include="*.ts"
```
Expected: zero matches (the sidebar nav doesn't reference them; nothing else should).

If any match is found, evaluate whether the linker needs to be updated or whether to keep that stub. (Do not proceed with deletion until matches are explained.)

- [ ] **Step 2: Delete the three route folders**

```bash
rm -rf frontend/app/agency/calendar
rm -rf frontend/app/agency/opportunities
rm -rf frontend/app/agency/performance
```

- [ ] **Step 3: Verify lint + build**

```bash
cd frontend && npm run lint
cd frontend && npm run build
```
Expected: both pass. (Build catches any straggler imports.)

- [ ] **Step 4: Smoke verify 404s**

Hit `/agency/calendar`, `/agency/opportunities`, `/agency/performance` in the dev server. Each should 404.

- [ ] **Step 5: Commit**

```bash
git add -A frontend/app/agency
git commit -m "chore(agency): delete dead stub routes (calendar, opportunities, performance)"
```

---

## Task 4: Build `CopyReviewLinkButton` component

**Files:**
- Create: `frontend/components/agency/CopyReviewLinkButton.tsx`

This is the compact replacement for `ReviewLinkSection.tsx`. It's a single button: if no review link exists, click provisions one and copies it; if one exists, click copies it. Shows a brief "Copied!" state.

- [ ] **Step 1: Write the new component**

Create `frontend/components/agency/CopyReviewLinkButton.tsx`:

```tsx
'use client';

import { useEffect, useState } from 'react';
import { Link2, Check } from 'lucide-react';
import {
  agencyGetReviewLink,
  agencyRotateReviewLink,
  type ReviewLinkOut,
} from '@/lib/api';

interface Props {
  clientId: number;
}

export function CopyReviewLinkButton({ clientId }: Props) {
  const [link, setLink] = useState<ReviewLinkOut | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    agencyGetReviewLink(clientId)
      .then(setLink)
      .catch(() => setLink(null));
  }, [clientId]);

  const handleClick = async () => {
    setError(null);
    let current = link;
    if (!current) {
      setBusy(true);
      try {
        current = await agencyRotateReviewLink(clientId);
        setLink(current);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to generate link');
        setBusy(false);
        return;
      }
      setBusy(false);
    }
    try {
      await navigator.clipboard.writeText(current.url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setError('Could not copy to clipboard');
    }
  };

  return (
    <div className="flex items-center gap-2">
      <button
        onClick={handleClick}
        disabled={busy}
        title={link ? 'Copy client review link' : 'Generate & copy client review link'}
        className="flex items-center gap-1.5 rounded-md border border-[var(--border-default)] bg-[var(--bg-card)] px-2.5 py-1 text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-raised)] hover:text-[var(--text-primary)] disabled:opacity-50"
      >
        {copied ? <Check className="h-3 w-3" /> : <Link2 className="h-3 w-3" />}
        {copied ? 'Copied' : link ? 'Copy review link' : busy ? 'Generating…' : 'Review link'}
      </button>
      {error && <span className="text-xs text-red-400">{error}</span>}
    </div>
  );
}
```

- [ ] **Step 2: Verify lint passes**

Run: `cd frontend && npm run lint`
Expected: no errors. (The file is not yet imported anywhere, so it's allowed to exist on its own.)

- [ ] **Step 3: Commit**

```bash
git add frontend/components/agency/CopyReviewLinkButton.tsx
git commit -m "feat(agency): add CopyReviewLinkButton for cockpit header"
```

---

## Task 5: Build `ClientNextStepShelf` component

**Files:**
- Create: `frontend/components/agency/ClientNextStepShelf.tsx`

Single-card shelf that surfaces the top-priority action for this client. Pure presentational — takes precomputed counts + a last-run timestamp as props so the cockpit owns data fetching.

- [ ] **Step 1: Write the new component**

Create `frontend/components/agency/ClientNextStepShelf.tsx`:

```tsx
'use client';

import { ArrowRight, CheckCircle2 } from 'lucide-react';

export interface NextStepDraftCounts {
  /** drafts where status === 'draft' or 'changes_requested' */
  toReview: number;
  /** drafts where status === 'approved' (staff-approved, awaiting client send / mark-posted) */
  approved: number;
  /** drafts where status === 'awaiting_client' AND have sat there > STALE_DAYS days */
  staleWithClient: number;
  /** total drafts in any non-terminal status (draft, changes_requested, awaiting_client, approved) */
  inFlight: number;
}

export type NextStepAction =
  | { kind: 'review_drafts'; count: number }
  | { kind: 'send_to_client'; count: number }
  | { kind: 'nudge_client'; count: number }
  | { kind: 'mark_posted'; count: number }
  | { kind: 'run_tracking'; daysStale: number }
  | { kind: 'generate_drafts' }
  | { kind: 'all_caught_up' };

const TRACKING_STALE_DAYS = 14;

export function computeNextStep(
  counts: NextStepDraftCounts,
  lastTrackingRunIso: string | null,
): NextStepAction {
  if (counts.toReview > 0) return { kind: 'review_drafts', count: counts.toReview };

  // "approved" drafts split between two cards: nothing on the front end distinguishes
  // "approved but not yet sent" from "approved by client, ready to post". We treat any
  // 'approved' draft as ready for the next staff action and surface "Send to client review"
  // — staff will hit "Mark as posted" on the Pipeline tab once the draft is live.
  if (counts.approved > 0) return { kind: 'send_to_client', count: counts.approved };

  if (counts.staleWithClient > 0) return { kind: 'nudge_client', count: counts.staleWithClient };

  const daysStale = computeDaysStaleTracking(lastTrackingRunIso);
  if (daysStale >= TRACKING_STALE_DAYS) return { kind: 'run_tracking', daysStale };

  if (counts.inFlight === 0) return { kind: 'generate_drafts' };

  return { kind: 'all_caught_up' };
}

function computeDaysStaleTracking(lastRunIso: string | null): number {
  if (!lastRunIso) return Number.MAX_SAFE_INTEGER;
  const normalized = /[Zz]|[+-]\d{2}:?\d{2}$/.test(lastRunIso) ? lastRunIso : lastRunIso + 'Z';
  const t = new Date(normalized).getTime();
  return Math.floor((Date.now() - t) / 86_400_000);
}

interface ShelfProps {
  action: NextStepAction;
  clientName: string;
  /** Called when the CTA is clicked. Cockpit dispatches to the right handler based on `action.kind`. */
  onAction: (action: NextStepAction) => void;
}

export function ClientNextStepShelf({ action, clientName, onAction }: ShelfProps) {
  if (action.kind === 'all_caught_up') {
    return (
      <div className="flex items-center gap-3 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-card)] px-5 py-4 text-sm text-[var(--text-secondary)]">
        <CheckCircle2 className="h-4 w-4 text-emerald-400" />
        All caught up for {clientName}.
      </div>
    );
  }

  const { headline, cta } = describe(action);

  return (
    <button
      onClick={() => onAction(action)}
      className="flex w-full items-center justify-between gap-4 rounded-lg border border-[var(--border-default)] bg-[var(--bg-elevated)] px-5 py-4 text-left transition hover:border-[var(--border-strong)] hover:bg-[var(--bg-card)]"
    >
      <div>
        <div className="text-xs uppercase tracking-wide text-[var(--text-muted)]">Next step</div>
        <div className="mt-1 text-sm font-medium text-[var(--text-primary)]">{headline}</div>
      </div>
      <span className="flex items-center gap-2 text-sm font-medium text-[var(--accent-foreground)]">
        {cta}
        <ArrowRight className="h-4 w-4" />
      </span>
    </button>
  );
}

function describe(action: NextStepAction): { headline: string; cta: string } {
  switch (action.kind) {
    case 'review_drafts': {
      const s = action.count === 1 ? '' : 's';
      return { headline: `${action.count} draft${s} ready for your review`, cta: 'Open Pipeline' };
    }
    case 'send_to_client': {
      const s = action.count === 1 ? '' : 's';
      return { headline: `${action.count} approved draft${s} — send to client review`, cta: 'Send drafts' };
    }
    case 'nudge_client': {
      const s = action.count === 1 ? '' : 's';
      return { headline: `${action.count} draft${s} pending client review for too long`, cta: 'Copy nudge' };
    }
    case 'mark_posted': {
      const s = action.count === 1 ? '' : 's';
      return { headline: `${action.count} client-approved draft${s} ready to mark posted`, cta: 'Open Pipeline' };
    }
    case 'run_tracking': {
      const phrase = action.daysStale >= Number.MAX_SAFE_INTEGER / 2 ? 'never' : `${action.daysStale} days ago`;
      return { headline: `Tracking last ran ${phrase}`, cta: 'Run tracking' };
    }
    case 'generate_drafts':
      return { headline: 'No drafts in flight — generate some', cta: 'Generate drafts' };
    case 'all_caught_up':
      // unreachable
      return { headline: '', cta: '' };
  }
}
```

- [ ] **Step 2: Verify lint passes**

Run: `cd frontend && npm run lint`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add frontend/components/agency/ClientNextStepShelf.tsx
git commit -m "feat(agency): add ClientNextStepShelf component"
```

---

## Task 6: Lift Pipeline data + restructure `ClientCockpit`

This is the biggest task. The cockpit moves from an 8-section vertical stack with right rail to: header → shelf → 5-tab layout. Data for the shelf and Pipeline tab is fetched once at the cockpit level.

**Files:**
- Modify: `frontend/components/agency/ClientCockpit.tsx` (full rewrite)
- Modify: `frontend/components/agency/ClientPipelineTab.tsx` (accept drafts as prop, accept refresh handler, header gains "Send drafts to client" button)
- Read for reference: `frontend/components/ui/tabs.tsx`, `frontend/components/ui/dropdown-menu.tsx`

### Sub-task 6a: Make `ClientPipelineTab` accept drafts via prop

The shelf and the Pipeline tab both need the draft list. To avoid double-fetching we lift the call to the cockpit. Pipeline accepts drafts + a refresh callback as props.

- [ ] **Step 1: Edit `ClientPipelineTab.tsx` — accept lifted data**

Replace the `Props` interface and the data-loading effect.

Current (lines 16-20):
```tsx
interface Props {
  brandId: number | null;
  reviewLinkUrl?: string | null;
  primaryContactName?: string | null;
}
```

Change to:
```tsx
interface Props {
  brandId: number | null;
  reviewLinkUrl?: string | null;
  primaryContactName?: string | null;
  /** Drafts already fetched by the cockpit. When provided, ClientPipelineTab does not refetch. */
  drafts?: AgencyDraft[] | null;
  /** Optional: called after a draft mutation (status change, posted) so the cockpit can refresh. */
  onDraftsChanged?: () => void;
}
```

Replace the `useEffect` data load (lines 104-113) with:
```tsx
useEffect(() => {
  if (drafts != null) {
    setDrafts(drafts);
    setLoading(false);
    return;
  }
  if (brandId == null) {
    setLoading(false);
    return;
  }
  getDrafts(brandId)
    .then((data) => setDrafts(data as AgencyDraft[]))
    .catch((e) => setError(String(e?.message ?? e)))
    .finally(() => setLoading(false));
}, [brandId, drafts]);
```

Note: there's a local state collision (the prop is named `drafts` and the state is also `drafts`). Rename the prop to `lifted` to avoid this:

Final Props block:
```tsx
interface Props {
  brandId: number | null;
  reviewLinkUrl?: string | null;
  primaryContactName?: string | null;
  /** Drafts already fetched by the cockpit. When provided, ClientPipelineTab does not refetch. */
  lifted?: AgencyDraft[] | null;
  /** Optional: called after a draft mutation (status change, posted) so the cockpit can refresh. */
  onDraftsChanged?: () => void;
}
```

And the useEffect:
```tsx
useEffect(() => {
  if (lifted != null) {
    setDrafts(lifted);
    setLoading(false);
    return;
  }
  if (brandId == null) {
    setLoading(false);
    return;
  }
  getDrafts(brandId)
    .then((data) => setDrafts(data as AgencyDraft[]))
    .catch((e) => setError(String(e?.message ?? e)))
    .finally(() => setLoading(false));
}, [brandId, lifted]);
```

Also wire `onDraftsChanged` into `updateLocal`:
Replace:
```tsx
const updateLocal = (id: number, patch: Partial<AgencyDraft>) => {
  setDrafts((prev) => prev.map((d) => (d.id === id ? { ...d, ...patch } : d)));
};
```
with:
```tsx
const updateLocal = (id: number, patch: Partial<AgencyDraft>) => {
  setDrafts((prev) => prev.map((d) => (d.id === id ? { ...d, ...patch } : d)));
  onDraftsChanged?.();
};
```

Update the destructuring on line 98:
```tsx
export function ClientPipelineTab({ brandId, reviewLinkUrl, primaryContactName, lifted, onDraftsChanged }: Props) {
```

- [ ] **Step 2: Verify lint + types pass**

```bash
cd frontend && npm run lint
```
Expected: no errors.

- [ ] **Step 3: Smoke verify Pipeline still works**

Open any client page. Confirm Pipeline section (still rendered inside cockpit at this point) loads drafts as before. No behavior change visible yet.

- [ ] **Step 4: Commit**

```bash
git add frontend/components/agency/ClientPipelineTab.tsx
git commit -m "refactor(agency): allow ClientPipelineTab to accept lifted draft data"
```

### Sub-task 6b: Rewrite `ClientCockpit.tsx`

- [ ] **Step 5: Replace `ClientCockpit.tsx` with the new structure**

Write the new file in full (overwrites the existing). Key elements:

1. Status dropdown using `DropdownMenu` instead of 4 pills.
2. Contact popover (we use `DropdownMenu` for accessibility — simpler than installing `Popover`).
3. `CopyReviewLinkButton` in header.
4. `Video studio →` link in header.
5. `ClientNextStepShelf` directly under header.
6. 5 tabs: Pipeline / Tracking / Audit / Brand / Documents — using the existing `Tabs` primitive.
7. Default tab = Pipeline; tab state in URL query `?tab=`.
8. Drafts + latest-run timestamp fetched at this level and passed to Pipeline + Shelf.
9. Right rail removed; `SendDraftsToClientModal` opened from inline buttons.
10. `Video`, `Tasks`, `Activity`, `Status pills` removed.

```tsx
'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import {
  ChevronDown,
  FileText,
  Loader2,
  Mail,
  Send,
  User,
  Video as VideoIcon,
} from 'lucide-react';
import {
  agencyGenerateWeeklyReport,
  agencyUpdateClient,
  getDrafts,
  getRecentRuns,
  type AgencyClient,
  type AgencyDocument,
  type ContentDraft,
  type TrackingRun,
} from '@/lib/api';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import { ClientBrandTab } from './ClientBrandTab';
import { ClientPipelineTab } from './ClientPipelineTab';
import { DocumentList } from './DocumentList';
import { GenerateDraftButton } from './GenerateDraftButton';
import { LumidianTrackingWidget } from './LumidianTrackingWidget';
import { PromptScoresPanel } from './PromptScoresPanel';
import { RunTrackingButton } from './RunTrackingButton';
import { AuditSummaryCard } from './AuditSummaryCard';
import { CopyReviewLinkButton } from './CopyReviewLinkButton';
import { SendDraftsToClientModal } from './SendDraftsToClientModal';
import {
  ClientNextStepShelf,
  computeNextStep,
  type NextStepAction,
  type NextStepDraftCounts,
} from './ClientNextStepShelf';
import { isDraftStale, nudgeMessageText } from './agency-helpers';

interface Props {
  client: AgencyClient;
  onChange: (next: AgencyClient) => void;
  reviewLinkUrl: string | null;
}

const STATUSES: AgencyClient['status'][] = ['onboarding', 'active', 'paused', 'churned'];

const STATUS_COLORS: Record<AgencyClient['status'], string> = {
  onboarding: 'bg-amber-500/20 text-amber-300',
  active: 'bg-emerald-500/20 text-emerald-300',
  paused: 'bg-slate-500/20 text-slate-300',
  churned: 'bg-rose-500/20 text-rose-300',
};

const TABS = ['pipeline', 'tracking', 'audit', 'brand', 'documents'] as const;
type TabKey = (typeof TABS)[number];

type AgencyDraft = Omit<ContentDraft, 'status'> & {
  status: string;
  client_feedback?: string | null;
  updated_at?: string | null;
};

export function ClientCockpit({ client, onChange, reviewLinkUrl }: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const tabFromUrl = searchParams.get('tab');
  const initialTab: TabKey = (TABS as readonly string[]).includes(tabFromUrl ?? '')
    ? (tabFromUrl as TabKey)
    : 'pipeline';
  const [tab, setTab] = useState<TabKey>(initialTab);

  const [saving, setSaving] = useState(false);
  const [statusError, setStatusError] = useState<string | null>(null);

  const [drafts, setDrafts] = useState<AgencyDraft[] | null>(null);
  const [latestRunIso, setLatestRunIso] = useState<string | null>(null);
  const [trackingRefreshKey, setTrackingRefreshKey] = useState(0);
  const [draftsRefreshKey, setDraftsRefreshKey] = useState(0);

  const [sendDraftsOpen, setSendDraftsOpen] = useState(false);
  const [justGeneratedDoc, setJustGeneratedDoc] = useState<AgencyDocument | null>(null);
  const [docsBusy, setDocsBusy] = useState(false);
  const [docsError, setDocsError] = useState<string | null>(null);

  // Fetch drafts (for shelf + Pipeline tab).
  useEffect(() => {
    if (client.brand_id == null) {
      setDrafts([]);
      return;
    }
    getDrafts(client.brand_id)
      .then((data) => setDrafts(data as AgencyDraft[]))
      .catch(() => setDrafts([]));
  }, [client.brand_id, draftsRefreshKey]);

  // Fetch latest tracking run timestamp (for shelf).
  useEffect(() => {
    if (client.brand_id == null) {
      setLatestRunIso(null);
      return;
    }
    getRecentRuns(client.brand_id)
      .then((runs: TrackingRun[]) => {
        const completed = runs.filter((r) => r.completed_at).sort((a, b) => {
          return new Date(b.completed_at as string).getTime() - new Date(a.completed_at as string).getTime();
        });
        setLatestRunIso(completed[0]?.completed_at ?? null);
      })
      .catch(() => setLatestRunIso(null));
  }, [client.brand_id, trackingRefreshKey]);

  // Sync tab selection to URL (?tab=pipeline).
  const handleTabChange = (next: string) => {
    setTab(next as TabKey);
    const params = new URLSearchParams(searchParams.toString());
    params.set('tab', next);
    router.replace(`?${params.toString()}`, { scroll: false });
  };

  const counts: NextStepDraftCounts = useMemo(() => {
    if (!drafts) return { toReview: 0, approved: 0, staleWithClient: 0, inFlight: 0 };
    let toReview = 0;
    let approved = 0;
    let staleWithClient = 0;
    let inFlight = 0;
    for (const d of drafts) {
      if (d.status === 'draft' || d.status === 'changes_requested') toReview++;
      if (d.status === 'approved') approved++;
      if (d.status === 'awaiting_client' && isDraftStale(d)) staleWithClient++;
      if (
        d.status === 'draft' ||
        d.status === 'changes_requested' ||
        d.status === 'awaiting_client' ||
        d.status === 'approved'
      ) {
        inFlight++;
      }
    }
    return { toReview, approved, staleWithClient, inFlight };
  }, [drafts]);

  const action = useMemo(
    () => computeNextStep(counts, latestRunIso),
    [counts, latestRunIso],
  );

  const updateStatus = async (status: AgencyClient['status']) => {
    setSaving(true);
    setStatusError(null);
    try {
      const next = await agencyUpdateClient(client.id, { status });
      onChange(next);
    } catch (err) {
      setStatusError(err instanceof Error ? err.message : 'Failed to update.');
    } finally {
      setSaving(false);
    }
  };

  const onGenerateWeekly = async () => {
    setDocsBusy(true);
    setDocsError(null);
    try {
      const doc = await agencyGenerateWeeklyReport(client.id);
      setJustGeneratedDoc(doc);
    } catch (e) {
      setDocsError(e instanceof Error ? e.message : 'Failed to generate report');
    } finally {
      setDocsBusy(false);
    }
  };

  const handleNextStep = useCallback(
    (a: NextStepAction) => {
      switch (a.kind) {
        case 'review_drafts':
        case 'mark_posted':
          handleTabChange('pipeline');
          return;
        case 'send_to_client':
          setSendDraftsOpen(true);
          return;
        case 'nudge_client': {
          const msg = nudgeMessageText(client.primary_contact_name ?? null, reviewLinkUrl ?? '');
          navigator.clipboard.writeText(msg).catch(() => {});
          return;
        }
        case 'run_tracking':
          handleTabChange('tracking');
          return;
        case 'generate_drafts':
          handleTabChange('pipeline');
          return;
        case 'all_caught_up':
          return;
      }
    },
    [client.primary_contact_name, reviewLinkUrl, searchParams],
  );

  return (
    <div className="p-8 text-[var(--text-primary)]">
      <Link href="/agency/clients" className="text-xs text-[var(--text-muted)] hover:underline">
        ← All clients
      </Link>

      {/* Header row */}
      <div className="mt-2 flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="truncate text-2xl font-semibold tracking-tight">{client.name}</h1>
          <p className="text-sm text-[var(--text-muted)]">/{client.slug}</p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Status chip */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                disabled={saving}
                className={`flex items-center gap-1 rounded-full px-3 py-1 text-xs font-medium ${STATUS_COLORS[client.status]} hover:opacity-90 disabled:opacity-50`}
              >
                {client.status}
                <ChevronDown className="h-3 w-3 opacity-70" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuLabel>Set status</DropdownMenuLabel>
              <DropdownMenuSeparator />
              {STATUSES.map((s) => (
                <DropdownMenuItem
                  key={s}
                  onSelect={() => updateStatus(s)}
                  disabled={s === client.status}
                >
                  {s}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>

          {/* Retainer chip */}
          {client.retainer_amount_usd != null && (
            <span className="rounded-full bg-[var(--bg-card)] px-3 py-1 text-xs text-[var(--text-secondary)]">
              ${client.retainer_amount_usd}/mo
            </span>
          )}

          {/* Contact popover */}
          {(client.primary_contact_name || client.primary_contact_email) && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  className="rounded-md border border-[var(--border-default)] bg-[var(--bg-card)] p-1.5 text-[var(--text-secondary)] hover:bg-[var(--bg-raised)] hover:text-[var(--text-primary)]"
                  title="Contact"
                >
                  <User className="h-3.5 w-3.5" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuLabel>Primary contact</DropdownMenuLabel>
                <DropdownMenuSeparator />
                {client.primary_contact_name && (
                  <DropdownMenuItem disabled className="flex gap-2 opacity-100">
                    <User className="h-3.5 w-3.5" />
                    {client.primary_contact_name}
                  </DropdownMenuItem>
                )}
                {client.primary_contact_email && (
                  <DropdownMenuItem
                    onSelect={() => {
                      window.location.href = `mailto:${client.primary_contact_email}`;
                    }}
                    className="flex gap-2"
                  >
                    <Mail className="h-3.5 w-3.5" />
                    {client.primary_contact_email}
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          )}

          <Link
            href={`/agency/clients/${client.id}/video`}
            className="flex items-center gap-1.5 rounded-md border border-[var(--border-default)] bg-[var(--bg-card)] px-2.5 py-1 text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-raised)] hover:text-[var(--text-primary)]"
          >
            <VideoIcon className="h-3 w-3" />
            Video studio
          </Link>

          <CopyReviewLinkButton clientId={client.id} />
        </div>
      </div>

      {statusError && <p className="mt-3 text-sm text-red-400">{statusError}</p>}

      {/* Next-step shelf */}
      {drafts != null && (
        <div className="mt-6">
          <ClientNextStepShelf
            action={action}
            clientName={client.name}
            onAction={handleNextStep}
          />
        </div>
      )}

      {/* Tabs */}
      <Tabs value={tab} onValueChange={handleTabChange} className="mt-6">
        <TabsList>
          <TabsTrigger value="pipeline">Pipeline</TabsTrigger>
          <TabsTrigger value="tracking">Tracking</TabsTrigger>
          <TabsTrigger value="audit">Audit</TabsTrigger>
          <TabsTrigger value="brand">Brand</TabsTrigger>
          <TabsTrigger value="documents">Documents</TabsTrigger>
        </TabsList>

        <TabsContent value="pipeline" className="mt-6">
          <div className="mb-4 flex flex-wrap items-center justify-end gap-2">
            <button
              onClick={() => setSendDraftsOpen(true)}
              disabled={counts.approved === 0}
              className="flex items-center gap-1.5 rounded-md border border-[var(--border-default)] bg-[var(--bg-card)] px-3 py-1.5 text-xs font-medium text-[var(--text-secondary)] hover:bg-[var(--bg-raised)] hover:text-[var(--text-primary)] disabled:opacity-40"
              title={counts.approved === 0 ? 'No approved drafts to send' : 'Send approved drafts to client review'}
            >
              <Send className="h-3 w-3" />
              Send drafts to client review
            </button>
            <GenerateDraftButton
              clientId={client.id}
              brandId={client.brand_id}
              onGenerated={() => setDraftsRefreshKey((k) => k + 1)}
            />
          </div>
          <ClientPipelineTab
            brandId={client.brand_id}
            reviewLinkUrl={reviewLinkUrl}
            primaryContactName={client.primary_contact_name}
            lifted={drafts}
            onDraftsChanged={() => setDraftsRefreshKey((k) => k + 1)}
          />
        </TabsContent>

        <TabsContent value="tracking" className="mt-6">
          <div className="mb-4 flex items-center justify-end">
            <RunTrackingButton
              clientId={client.id}
              onTriggered={() => setTrackingRefreshKey((k) => k + 1)}
            />
          </div>
          <LumidianTrackingWidget key={trackingRefreshKey} brandId={client.brand_id} />
          <div className="mt-4">
            <PromptScoresPanel brandId={client.brand_id} />
          </div>
        </TabsContent>

        <TabsContent value="audit" className="mt-6">
          <AuditSummaryCard clientId={client.id} brandId={client.brand_id} />
        </TabsContent>

        <TabsContent value="brand" className="mt-6">
          <ClientBrandTab brandId={client.brand_id} />
        </TabsContent>

        <TabsContent value="documents" className="mt-6">
          <div className="mb-4 flex flex-wrap items-center justify-end gap-3">
            {docsError && <span className="text-xs text-red-400">{docsError}</span>}
            <button
              onClick={onGenerateWeekly}
              disabled={docsBusy}
              className="flex items-center gap-2 rounded-md border border-[var(--border-default)] bg-[var(--bg-elevated)] px-3 py-1.5 text-xs font-medium text-[var(--text-primary)] hover:bg-[var(--bg-card)] disabled:opacity-50"
            >
              {docsBusy ? <Loader2 className="h-3 w-3 animate-spin" /> : <FileText className="h-3 w-3" />}
              {docsBusy ? 'Generating…' : 'Generate weekly report'}
            </button>
          </div>
          <DocumentList clientId={client.id} injectDoc={justGeneratedDoc} />
        </TabsContent>
      </Tabs>

      <SendDraftsToClientModal
        open={sendDraftsOpen}
        onOpenChange={setSendDraftsOpen}
        clientId={client.id}
        clientName={client.name}
        brandId={client.brand_id}
        primaryContactName={client.primary_contact_name}
        primaryContactEmail={client.primary_contact_email ?? null}
        onSent={() => setDraftsRefreshKey((k) => k + 1)}
      />
    </div>
  );
}
```

- [ ] **Step 6: Verify lint + build pass**

```bash
cd frontend && npm run lint
cd frontend && npm run build
```
Expected: both pass. The build is the type-checker — it will catch any signature mismatch with `ClientPipelineTab` (Sub-task 6a).

- [ ] **Step 7: Smoke verify**

Open any client page and walk through:
1. Header shows: client name, slug, status chip (clickable), retainer chip if set, contact icon (popover), Video studio link, Copy review link button.
2. Status chip dropdown lets you change status; the chip color updates.
3. Below header, shelf shows the correct "Next step" based on the client's drafts state.
4. Tabs render and switch (Pipeline / Tracking / Audit / Brand / Documents). Default = Pipeline.
5. URL updates with `?tab=…` on switch; deep link `?tab=audit` opens Audit tab on load.
6. Pipeline tab still shows the 3-column drafts board.
7. "Send drafts to client review" button is disabled if no approved drafts; opens modal when enabled.
8. "Generate draft" button still works from Pipeline tab header.
9. "Run tracking" button on Tracking tab triggers a run.
10. "Generate weekly report" button on Documents tab works.
11. Video studio link navigates to `/agency/clients/{id}/video`.
12. Shelf "Open Pipeline" CTA switches to Pipeline tab.
13. Shelf "Send drafts" CTA opens the Send modal directly.
14. Shelf "Copy nudge" CTA copies a message to clipboard (paste somewhere to confirm).

- [ ] **Step 8: Commit**

```bash
git add frontend/components/agency/ClientCockpit.tsx
git commit -m "feat(agency): restructure cockpit into shelf + 5-tab layout"
```

---

## Task 7: Delete orphaned components

After Task 6, the following components are no longer imported anywhere. Verify each, then delete.

**Files to delete:**
- `frontend/components/agency/ClientQuickActionsRail.tsx`
- `frontend/components/agency/TaskList.tsx`
- `frontend/components/agency/TaskRow.tsx`
- `frontend/components/agency/AssigneePicker.tsx`
- `frontend/components/agency/ActivityFeed.tsx`
- `frontend/components/agency/RecentActivitySection.tsx`
- `frontend/components/agency/activity-icons.tsx`
- `frontend/components/agency/ReviewLinkSection.tsx`

> ⚠️ `AssigneePicker` is currently used inside `ClientPipelineTab.tsx`. We are removing this feature — Pipeline drafts no longer expose per-draft assignment. We will edit `ClientPipelineTab.tsx` to drop the `AssigneePicker` usage as part of this task.

- [ ] **Step 1: Remove `AssigneePicker` from `ClientPipelineTab.tsx`**

In `frontend/components/agency/ClientPipelineTab.tsx`:

Remove the import line:
```tsx
import { AssigneePicker } from './AssigneePicker';
import { agencyAssignDraft } from '@/lib/api';
```

Remove the `<AssigneePicker>` block inside the draft list item (the block wrapped by `<div className="mt-2"> <AssigneePicker ... /> </div>`).

- [ ] **Step 2: Verify no other importers**

Run, for each file slated for deletion:
```bash
grep -rn "from './ClientQuickActionsRail'\|from '@/components/agency/ClientQuickActionsRail'" frontend --include="*.tsx" --include="*.ts"
grep -rn "from './TaskList'\|from '@/components/agency/TaskList'" frontend --include="*.tsx" --include="*.ts"
grep -rn "from './TaskRow'\|from '@/components/agency/TaskRow'" frontend --include="*.tsx" --include="*.ts"
grep -rn "from './AssigneePicker'\|from '@/components/agency/AssigneePicker'" frontend --include="*.tsx" --include="*.ts"
grep -rn "from './ActivityFeed'\|from '@/components/agency/ActivityFeed'" frontend --include="*.tsx" --include="*.ts"
grep -rn "from './RecentActivitySection'\|from '@/components/agency/RecentActivitySection'" frontend --include="*.tsx" --include="*.ts"
grep -rn "from './activity-icons'\|from '@/components/agency/activity-icons'" frontend --include="*.tsx" --include="*.ts"
grep -rn "from './ReviewLinkSection'\|from '@/components/agency/ReviewLinkSection'" frontend --include="*.tsx" --include="*.ts"
```
Expected: **zero matches** for each.

If any file still imports one of these, find out why and resolve (most likely a stale path; fix by removing the import or migrating to the new component).

- [ ] **Step 3: Delete the files**

```bash
rm frontend/components/agency/ClientQuickActionsRail.tsx
rm frontend/components/agency/TaskList.tsx
rm frontend/components/agency/TaskRow.tsx
rm frontend/components/agency/AssigneePicker.tsx
rm frontend/components/agency/ActivityFeed.tsx
rm frontend/components/agency/RecentActivitySection.tsx
rm frontend/components/agency/activity-icons.tsx
rm frontend/components/agency/ReviewLinkSection.tsx
```

- [ ] **Step 4: Verify lint + build pass**

```bash
cd frontend && npm run lint
cd frontend && npm run build
```
Expected: both pass.

- [ ] **Step 5: Smoke verify**

Reload a client page. Confirm: no missing-module errors in dev server logs. Pipeline still renders drafts (without the assignee picker chip on each row). All tabs render.

- [ ] **Step 6: Commit**

```bash
git add -A frontend/components/agency
git commit -m "chore(agency): delete unused components (rail, tasks, activity, review link section)"
```

---

## Task 8: Prune orphaned `lib/api.ts` exports

After Task 7, the following exports in `frontend/lib/api.ts` are likely orphaned. Verify each, then delete only the ones with zero remaining callers.

**Candidates:**
- `agencyToday`, `AgencyTodayDraft`, `AgencyTodayResponse` (Today no longer calls these)
- `agencyListActivity`, `agencyCreateNote`, `agencyUpdateNote`, `agencyDeleteNote`, `agencyListRecentActivity` (ActivityFeed + RecentActivitySection deleted)
- `agencyListTasks`, `agencyCreateTask`, `agencyUpdateTask`, `agencyDeleteTask` (TaskList deleted)
- `agencyAssignDraft` (was only used in Pipeline + AssigneePicker; both removed)

> ⚠️ Some of these types may still be transitively used by `MyQueueResponse`, `AgencyDocumentWithClient`, or backend-shape sharing. Verify before deleting.

- [ ] **Step 1: Check each candidate for remaining callers**

For each symbol, run:
```bash
grep -rn "\bagencyToday\b" frontend --include="*.tsx" --include="*.ts"
grep -rn "\bAgencyTodayDraft\b" frontend --include="*.tsx" --include="*.ts"
grep -rn "\bAgencyTodayResponse\b" frontend --include="*.tsx" --include="*.ts"
grep -rn "\bagencyListActivity\b" frontend --include="*.tsx" --include="*.ts"
grep -rn "\bagencyCreateNote\b" frontend --include="*.tsx" --include="*.ts"
grep -rn "\bagencyUpdateNote\b" frontend --include="*.tsx" --include="*.ts"
grep -rn "\bagencyDeleteNote\b" frontend --include="*.tsx" --include="*.ts"
grep -rn "\bagencyListRecentActivity\b" frontend --include="*.tsx" --include="*.ts"
grep -rn "\bagencyListTasks\b" frontend --include="*.tsx" --include="*.ts"
grep -rn "\bagencyCreateTask\b" frontend --include="*.tsx" --include="*.ts"
grep -rn "\bagencyUpdateTask\b" frontend --include="*.tsx" --include="*.ts"
grep -rn "\bagencyDeleteTask\b" frontend --include="*.tsx" --include="*.ts"
grep -rn "\bagencyAssignDraft\b" frontend --include="*.tsx" --include="*.ts"
```

Expected for a true orphan: 1 match in `frontend/lib/api.ts` itself (the declaration) and **0** elsewhere.

If a symbol has any other matches, **do not delete it**. Note that on the open list of `frontend/lib/api.ts` symbols.

- [ ] **Step 2: Delete the verified-orphan exports from `frontend/lib/api.ts`**

For each symbol confirmed orphan in Step 1, remove its declaration + any interfaces only used by that declaration. Keep `MyQueueResponse` (still used by `MyQueueSection`).

Open `frontend/lib/api.ts` and remove the orphaned blocks. Use the line ranges in the spec as a starting point:
- `AgencyTodayDraft` interface (line ~1065)
- `AgencyTodayResponse` interface (line ~1075)
- `agencyToday` function (line ~1110)
- `agencyListActivity` function and related Note CRUD (~lines 2097-2150)
- `agencyListRecentActivity` (find via grep)
- `agencyListTasks` / `agencyCreateTask` / `agencyUpdateTask` / `agencyDeleteTask` (~lines 2184-2210)
- `AgencyTask`, `AgencyTaskCreate`, `AgencyTaskUpdate`, `TaskStatus` types if no other callers
- `agencyAssignDraft` function (line ~1115)

Be conservative: if you can't quickly verify a type is orphaned, leave it. The goal of this task is "delete the dead code we're confident about," not "leave api.ts pristine."

- [ ] **Step 3: Verify lint + build pass**

```bash
cd frontend && npm run lint
cd frontend && npm run build
```
Expected: both pass.

- [ ] **Step 4: Commit**

```bash
git add frontend/lib/api.ts
git commit -m "chore(agency): prune orphaned API exports after cockpit cleanup"
```

---

## Task 9: Final verification

- [ ] **Step 1: Full lint + build**

```bash
cd frontend && npm run lint && npm run build
```
Expected: both pass.

- [ ] **Step 2: Run backend smoke**

```bash
cd backend && source venv/bin/activate && pytest tests/test_agency*.py -q
```
Expected: all green. We did not touch the backend, but the import paths and frontend's expected response shapes have not changed for any endpoint still in use.

- [ ] **Step 3: Walk the full smoke checklist**

Open the dev frontend (port 3002) and the backend (port 3001 — Ken's standard ports per project memory) and verify each of the following. Tick off as you go.

1. `/agency` shows only the queue + header. No 3-column block.
2. Sidebar shows Today / Clients / Documents / Settings. Settings reaches the stub page.
3. `/agency/calendar`, `/agency/opportunities`, `/agency/performance` 404.
4. Click into a client with pending drafts (status `draft` or `changes_requested`): shelf shows "{N} drafts ready for your review", CTA "Open Pipeline" switches the tab.
5. Click into a client with approved (staff-approved) drafts: shelf shows "{N} approved drafts — send to client review", CTA opens the Send modal.
6. Click into a client where all drafts are sent and tracking last ran ≥14 days ago: shelf shows "Tracking last ran X days ago" with CTA → Tracking tab.
7. Click into a client with zero drafts: shelf shows "No drafts in flight — generate some", CTA → Pipeline tab (with Generate Draft button visible).
8. Click into a client with nothing pending: shelf shows "All caught up for {client}.".
9. Status chip dropdown updates client status for each of the 4 statuses; color updates.
10. Contact icon popover shows name (read-only) + email (clickable mailto).
11. "Video studio →" navigates to `/agency/clients/{id}/video`. That page still renders.
12. "Copy review link" button: copies the URL to clipboard. If no review link existed, the click both provisions one and copies it. Verify by pasting.
13. Tab switching via clicks updates URL `?tab=…`. Reloading the page restores the selected tab.
14. Pipeline tab "Send drafts to client review" button is disabled when no approved drafts; enabled otherwise; opens modal on click.
15. Generate Draft modal still works from Pipeline header.
16. Tracking tab: visibility widget + prompt scores both render; Run Tracking button triggers a run.
17. Audit tab: AuditSummaryCard renders.
18. Brand tab: prompts + brand profile editor renders.
19. Documents tab: list + Generate Weekly Report button works.
20. No dev-server console errors during the walk.

- [ ] **Step 4: Update CURRENT_STATE.md**

Append a short entry to `CURRENT_STATE.md` under "Recent Decisions":

```
- 2026-05-20 — Shipped agency portal cleanup on this branch. Cockpit collapsed
  from 8-section vertical stack + right rail into header → "Next step" shelf →
  5 tabs (Pipeline default / Tracking / Audit / Brand / Documents). Today
  stripped to queue-only. Dead stubs (calendar, opportunities, performance)
  deleted. 8 unused components removed (rail, tasks, activity, assignee picker,
  review-link section, activity-icons). Lib/api orphan exports pruned. Backend
  untouched; backend /api/agency endpoints for tasks/activity/today remain as
  dead code on the server side, follow-up to remove later.
```

Update the "Last updated" header at the top of the file.

- [ ] **Step 5: Final commit**

```bash
git add CURRENT_STATE.md
git commit -m "docs: update CURRENT_STATE after agency portal cleanup"
```

---

## Spec coverage check

| Spec section | Covered by |
|---|---|
| Sidebar — add Settings | Task 1 |
| Today page — queue only | Task 2 |
| Delete dead stubs | Task 3 |
| Cockpit header (status chip, contact popover, video link, copy review link) | Task 6 (sub-task 6b) + Task 4 (`CopyReviewLinkButton`) |
| Next-step shelf | Task 5 (component) + Task 6 (wire-up in cockpit) |
| 5-tab layout, default Pipeline, URL `?tab=` | Task 6 |
| "Send drafts" moved to Pipeline tab | Task 6 (sub-task 6b) |
| Delete `ClientQuickActionsRail`, `TaskList`, `TaskRow`, `AssigneePicker`, `ActivityFeed`, `RecentActivitySection`, `activity-icons`, `ReviewLinkSection` | Task 7 |
| Prune `lib/api.ts` orphans | Task 8 |
| Smoke verification | Task 9 |
