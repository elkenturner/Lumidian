# Agency Portal UX Overhaul Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Hide the outer Lumidian sidebar on `/agency/*`, trim the agency nav, collapse the per-client 4-tab page into one cockpit with a sticky right rail of quick actions, compress Pipeline to 3 columns, add a stale-draft Nudge pill, ship a "Send drafts to client" modal with pre-filled copy, add global doc generation, and scrub Peec from the new-client flow.

**Architecture:** All frontend. Zero backend changes. The existing `NO_SIDEBAR_PATHS` mechanism in `AppShell.tsx` is reused for #1; everything else is component-level work in `frontend/components/agency/` + the two page files under `frontend/app/agency/`.

**Tech Stack:** Next.js 16, React 18, TypeScript, Tailwind, Radix Dialog + DropdownMenu, existing `@/lib/api` client.

**Spec:** `docs/superpowers/specs/2026-05-12-agency-portal-ux-overhaul-design.md`

---

## File Structure

### Modify

- `frontend/components/AppShell.tsx` — add `/agency` to `NO_SIDEBAR_PATHS`.
- `frontend/components/agency/AgencySidebar.tsx` — keep only Today / Clients / Documents in nav.
- `frontend/components/agency/NewClientDialog.tsx` — remove Peec URL field.
- `frontend/components/agency/ClientPipelineTab.tsx` — collapse 5 columns to 3; add Nudge pill on "With client" cards; add status sub-badges on Drafting cards.
- `frontend/app/agency/page.tsx` (Today) — remove `RecentActivitySection`; render Nudge pill on awaiting-client items.
- `frontend/app/agency/clients/[id]/page.tsx` — replace tabbed page with `<ClientCockpit clientId={...} />`.
- `frontend/app/agency/documents/page.tsx` — add "Generate document" button + modal.

### Create

- `frontend/components/agency/agency-helpers.ts` — `isDraftStale()`, `nudgeMessageText()`, `sendDraftsMessageText()` pure helpers.
- `frontend/components/agency/NudgePill.tsx` — small pill component that copies a nudge message on click.
- `frontend/components/agency/SendDraftsToClientModal.tsx` — batch-send flow + pre-filled message step.
- `frontend/components/agency/ClientQuickActionsRail.tsx` — sticky right rail (review link + send drafts + generate doc + recent client actions).
- `frontend/components/agency/ClientCockpit.tsx` — replaces the tabbed page; renders all sections stacked + the right rail.
- `frontend/components/agency/GenerateForAnyClientModal.tsx` — global doc generation modal (client picker + template picker).

### Delete (or leave unused — keep files, just unwire from routes)

- The four tab wrapper components (`ClientOverviewTab`, `ClientStrategyTab`, `ClientContentTab`, `ClientReportsTab`) become unused. Delete the files. Underlying components (`LumidianTrackingWidget`, `ReviewLinkSection`, `ClientBrandTab`, `ClientPipelineTab`, `TaskList`, `ActivityFeed`, `DocumentList`, `GenerateDocumentButton`) stay — referenced by the cockpit.

---

## Task 1: Hide outer sidebar on `/agency/*`

**Files:**
- Modify: `frontend/components/AppShell.tsx`

- [ ] **Step 1: Add `/agency` to `NO_SIDEBAR_PATHS`**

Find line 25 in `frontend/components/AppShell.tsx`:

```tsx
const NO_SIDEBAR_PATHS = ['/', '/login', '/register', '/onboarding', '/forgot-password', '/reset-password', '/verify-email', '/terms', '/privacy', '/methodology', '/account-paused'];
```

Replace with:

```tsx
const NO_SIDEBAR_PATHS = ['/', '/login', '/register', '/onboarding', '/forgot-password', '/reset-password', '/verify-email', '/terms', '/privacy', '/methodology', '/account-paused', '/agency'];
```

The existing matcher already handles prefix matching (`pathname.startsWith(p + '/')`), so adding `/agency` covers `/agency`, `/agency/clients`, `/agency/clients/123`, `/agency/documents`, etc.

- [ ] **Step 2: TS check**

```bash
cd /Users/ken/Desktop/Lumidian/frontend
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add frontend/components/AppShell.tsx
git commit -m "feat(agency): hide outer Lumidian sidebar on /agency/*"
```

---

## Task 2: Trim agency sidebar to live items

**Files:**
- Modify: `frontend/components/agency/AgencySidebar.tsx`

- [ ] **Step 1: Remove stub items from `NAV`**

In `frontend/components/agency/AgencySidebar.tsx`, replace the `NAV` constant:

```tsx
const NAV = [
  { href: '/agency', label: 'Today', icon: Home, exact: true },
  { href: '/agency/clients', label: 'Clients', icon: Users, exact: false },
  { href: '/agency/calendar', label: 'Calendar', icon: Calendar, exact: false },
  { href: '/agency/opportunities', label: 'Opportunities', icon: Inbox, exact: false },
  { href: '/agency/performance', label: 'Performance', icon: BarChart3, exact: false },
  { href: '/agency/documents', label: 'Documents', icon: FileText, exact: false },
  { href: '/agency/settings', label: 'Settings', icon: SettingsIcon, exact: false },
];
```

With:

```tsx
const NAV = [
  { href: '/agency', label: 'Today', icon: Home, exact: true },
  { href: '/agency/clients', label: 'Clients', icon: Users, exact: false },
  { href: '/agency/documents', label: 'Documents', icon: FileText, exact: false },
];
```

Also remove the now-unused icon imports (`Calendar`, `Inbox`, `BarChart3`, `Settings as SettingsIcon`) from the `lucide-react` import line.

- [ ] **Step 2: TS check**

```bash
cd /Users/ken/Desktop/Lumidian/frontend
npx tsc --noEmit
```

Expected: no errors. If there are unused-import warnings, clean them up.

- [ ] **Step 3: Commit**

```bash
git add frontend/components/agency/AgencySidebar.tsx
git commit -m "feat(agency): trim sidebar nav to Today / Clients / Documents"
```

---

## Task 3: Scrub Peec from New Client dialog

**Files:**
- Modify: `frontend/components/agency/NewClientDialog.tsx`

- [ ] **Step 1: Remove Peec form field and its state**

In `frontend/components/agency/NewClientDialog.tsx`:

1. Delete the line `const [peecUrl, setPeecUrl] = useState('');`.
2. Delete `setPeecUrl('')` from the `reset()` function body.
3. Delete the entire `<div>` containing the "Peec dashboard URL" label and input.
4. Remove `peec_dashboard_url: peecUrl.trim() || undefined,` from the `agencyCreateClient` payload.

- [ ] **Step 2: TS check**

```bash
cd /Users/ken/Desktop/Lumidian/frontend
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add frontend/components/agency/NewClientDialog.tsx
git commit -m "feat(agency): remove Peec URL field from New Client dialog"
```

---

## Task 4: Helpers + NudgePill

**Files:**
- Create: `frontend/components/agency/agency-helpers.ts`
- Create: `frontend/components/agency/NudgePill.tsx`

- [ ] **Step 1: Create `agency-helpers.ts`**

```typescript
/**
 * Shared helpers for the agency portal UI.
 *
 * Stale-draft computation, message templates for "send to client" and "nudge."
 */

export const STALE_DAYS = 3;

function normalizeIso(iso: string): string {
  return /[Zz]|[+-]\d{2}:?\d{2}$/.test(iso) ? iso : iso + 'Z';
}

/**
 * True when a draft has been with the client for > STALE_DAYS days.
 *
 * Uses the draft's `updated_at` if available (set whenever status changes via
 * the agency router), else falls back to `created_at`. Caller must verify the
 * draft is actually in `awaiting_client` status before treating "stale" as
 * meaningful.
 */
export function isDraftStale(draft: { updated_at?: string | null; created_at: string }): boolean {
  const stamp = draft.updated_at || draft.created_at;
  const t = new Date(normalizeIso(stamp)).getTime();
  const ageDays = (Date.now() - t) / 86_400_000;
  return ageDays > STALE_DAYS;
}

/**
 * Pre-filled message for "send drafts to client" flow.
 */
export function sendDraftsMessageText(
  contactName: string | null,
  draftCount: number,
  reviewLinkUrl: string,
): string {
  const greeting = contactName ? `Hey ${contactName},` : 'Hey there,';
  const plural = draftCount === 1 ? 'piece' : 'pieces';
  return `${greeting}

I've got ${draftCount} new ${plural} for your review. Take a look and approve, request changes, or reject inline:

${reviewLinkUrl}

Quick turnaround appreciated — happy to iterate.`;
}

/**
 * Pre-filled message for "nudge" — a draft has sat in awaiting_client too long.
 */
export function nudgeMessageText(
  contactName: string | null,
  reviewLinkUrl: string,
): string {
  const greeting = contactName ? `Hey ${contactName},` : 'Quick ping —';
  return `${greeting} the drafts at ${reviewLinkUrl} are still waiting on your review. Let me know if you need anything from me to help wrap them up.`;
}
```

- [ ] **Step 2: Create `NudgePill.tsx`**

```tsx
'use client';

import { useState } from 'react';
import { Bell } from 'lucide-react';

interface Props {
  message: string;
}

export function NudgePill({ message }: Props) {
  const [copied, setCopied] = useState(false);

  const copy = (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    navigator.clipboard.writeText(message);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <button
      onClick={copy}
      title="Click to copy a nudge message for this client"
      className="inline-flex items-center gap-1 rounded-full bg-amber-500/20 px-2 py-0.5 text-xs font-medium text-amber-300 hover:bg-amber-500/30"
    >
      <Bell className="h-3 w-3" />
      {copied ? 'Copied!' : 'Nudge?'}
    </button>
  );
}
```

- [ ] **Step 3: TS check**

```bash
cd /Users/ken/Desktop/Lumidian/frontend
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add frontend/components/agency/agency-helpers.ts frontend/components/agency/NudgePill.tsx
git commit -m "feat(agency): helpers + NudgePill component"
```

---

## Task 5: Compress Pipeline to 3 columns + Nudge pill

**Files:**
- Modify: `frontend/components/agency/ClientPipelineTab.tsx`

- [ ] **Step 1: Replace the entire file with the 3-column version**

The full new content:

```tsx
'use client';

import { useEffect, useState } from 'react';
import {
  agencyUpdateDraftStatus,
  getDrafts,
  type ContentDraft,
  type DraftStaffStatus,
} from '@/lib/api';
import { AssigneePicker } from './AssigneePicker';
import { NudgePill } from './NudgePill';
import { agencyAssignDraft } from '@/lib/api';
import { isDraftStale, nudgeMessageText } from './agency-helpers';

interface Props {
  brandId: number | null;
  reviewLinkUrl?: string | null;
  primaryContactName?: string | null;
}

// ContentDraft.status covers core states; agency workflow adds extras at runtime.
type AgencyDraft = Omit<ContentDraft, 'status'> & {
  status: string;
  client_feedback?: string | null;
  updated_at?: string | null;
};

interface DraftActionsProps {
  draft: AgencyDraft;
  onChange: (next: Partial<AgencyDraft>) => void;
}

function DraftActions({ draft, onChange }: DraftActionsProps) {
  const [busy, setBusy] = useState(false);
  const set = async (status: DraftStaffStatus) => {
    setBusy(true);
    try {
      await agencyUpdateDraftStatus(draft.id, status);
      onChange({ status });
    } finally {
      setBusy(false);
    }
  };

  if (draft.status === 'draft' || draft.status === 'changes_requested') {
    return (
      <button
        onClick={() => set('awaiting_client')}
        disabled={busy}
        className="mt-2 rounded-md border border-[var(--border-default)] px-2 py-1 text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-raised)] disabled:opacity-50"
      >
        Send to client review
      </button>
    );
  }
  if (draft.status === 'approved') {
    return (
      <button
        onClick={() => set('posted')}
        disabled={busy}
        className="mt-2 rounded-md border border-[var(--border-default)] px-2 py-1 text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-raised)] disabled:opacity-50"
      >
        Mark as posted
      </button>
    );
  }
  return null;
}

const COLUMNS: Array<{ key: string; label: string; matchesStatus: (s: string) => boolean }> = [
  {
    key: 'drafting',
    label: 'Drafting',
    matchesStatus: (s) => s === 'draft' || s === 'changes_requested',
  },
  {
    key: 'with_client',
    label: 'With client',
    matchesStatus: (s) => s === 'awaiting_client',
  },
  {
    key: 'done',
    label: 'Done',
    matchesStatus: (s) => s === 'approved' || s === 'posted',
  },
];

export function ClientPipelineTab({ brandId, reviewLinkUrl, primaryContactName }: Props) {
  const [drafts, setDrafts] = useState<AgencyDraft[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [showRejected, setShowRejected] = useState(false);

  useEffect(() => {
    if (brandId == null) {
      setLoading(false);
      return;
    }
    getDrafts(brandId)
      .then((data) => setDrafts(data as AgencyDraft[]))
      .catch((e) => setError(String(e?.message ?? e)))
      .finally(() => setLoading(false));
  }, [brandId]);

  const updateLocal = (id: number, patch: Partial<AgencyDraft>) => {
    setDrafts((prev) => prev.map((d) => (d.id === id ? { ...d, ...patch } : d)));
  };

  if (brandId == null) {
    return <p className="text-sm text-[var(--text-muted)]">No brand attached to this client.</p>;
  }
  if (loading) return <p className="text-sm text-[var(--text-muted)]">Loading…</p>;
  if (error) return <p className="text-sm text-red-400">{error}</p>;

  const rejectedCount = drafts.filter((d) => d.status === 'rejected').length;
  const visibleDrafts = showRejected ? drafts : drafts.filter((d) => d.status !== 'rejected');

  if (drafts.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-[var(--border-subtle)] p-10 text-center text-sm text-[var(--text-muted)]">
        No drafts yet. Use the Lumidian Content section to generate some for this client&apos;s
        brand — they&apos;ll show up here.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {rejectedCount > 0 && (
        <div className="flex justify-end">
          <label className="flex items-center gap-2 text-xs text-[var(--text-muted)]">
            <input
              type="checkbox"
              checked={showRejected}
              onChange={(e) => setShowRejected(e.target.checked)}
            />
            Show rejected ({rejectedCount})
          </label>
        </div>
      )}
      <div className="grid grid-cols-1 gap-4 text-[var(--text-primary)] md:grid-cols-3">
        {COLUMNS.map(({ key, label, matchesStatus }) => {
          const items = visibleDrafts.filter((d) => matchesStatus(d.status));
          return (
            <section
              key={key}
              className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-card)] p-4"
            >
              <h3 className="mb-3 flex items-center justify-between text-sm font-medium">
                <span>{label}</span>
                <span className="text-xs text-[var(--text-muted)]">{items.length}</span>
              </h3>
              <ul className="space-y-2">
                {items.map((d) => {
                  const stale = key === 'with_client' && isDraftStale(d);
                  return (
                    <li
                      key={d.id}
                      className="rounded-md border border-[var(--border-subtle)] bg-[var(--bg-raised)] p-3 text-sm"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="font-medium">{d.title || `Draft #${d.id}`}</div>
                        {d.status === 'changes_requested' && (
                          <span className="rounded-full bg-amber-500/20 px-2 py-0.5 text-xs text-amber-300">
                            Changes requested
                          </span>
                        )}
                        {d.status === 'approved' && (
                          <span className="rounded-full bg-emerald-500/20 px-2 py-0.5 text-xs text-emerald-300">
                            Ready to post
                          </span>
                        )}
                        {d.status === 'posted' && (
                          <span className="rounded-full bg-slate-500/20 px-2 py-0.5 text-xs text-slate-300">
                            Posted
                          </span>
                        )}
                        {d.status === 'rejected' && (
                          <span className="rounded-full bg-rose-500/20 px-2 py-0.5 text-xs text-rose-300">
                            Rejected
                          </span>
                        )}
                      </div>
                      <div className="mt-1 text-xs text-[var(--text-muted)]">{d.platform}</div>
                      {d.content_text && (
                        <p className="mt-2 line-clamp-3 text-xs text-[var(--text-muted)]">
                          {d.content_text}
                        </p>
                      )}
                      {d.status === 'changes_requested' && d.client_feedback && (
                        <p className="mt-2 rounded border border-amber-500/30 bg-amber-500/10 p-2 text-xs text-amber-200">
                          {d.client_feedback}
                        </p>
                      )}
                      {stale && reviewLinkUrl && (
                        <div className="mt-2">
                          <NudgePill
                            message={nudgeMessageText(primaryContactName ?? null, reviewLinkUrl)}
                          />
                        </div>
                      )}
                      <div className="mt-2">
                        <AssigneePicker
                          value={d.assigned_to_user_id ?? null}
                          onChange={async (userId) => {
                            await agencyAssignDraft(d.id, userId);
                            updateLocal(d.id, { assigned_to_user_id: userId });
                          }}
                          compact
                        />
                      </div>
                      <DraftActions draft={d} onChange={(patch) => updateLocal(d.id, patch)} />
                    </li>
                  );
                })}
                {items.length === 0 && (
                  <li className="rounded-md border border-dashed border-[var(--border-subtle)] p-3 text-xs text-[var(--text-muted)]">
                    Empty
                  </li>
                )}
              </ul>
            </section>
          );
        })}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: TS check**

```bash
cd /Users/ken/Desktop/Lumidian/frontend
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add frontend/components/agency/ClientPipelineTab.tsx
git commit -m "feat(agency): 3-column pipeline with status sub-badges + Nudge pill"
```

---

## Task 6: SendDraftsToClientModal

**Files:**
- Create: `frontend/components/agency/SendDraftsToClientModal.tsx`

- [ ] **Step 1: Create the modal**

```tsx
'use client';

import { useEffect, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { Copy, Send, X } from 'lucide-react';
import {
  agencyGetReviewLink,
  agencyRotateReviewLink,
  agencyUpdateDraftStatus,
  getDrafts,
  type ContentDraft,
} from '@/lib/api';
import { sendDraftsMessageText } from './agency-helpers';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  clientId: number;
  clientName: string;
  brandId: number | null;
  primaryContactName: string | null;
  onSent: () => void; // caller may want to refresh pipeline
}

interface SendableDraft extends ContentDraft {
  status: string;
}

export function SendDraftsToClientModal({
  open,
  onOpenChange,
  clientId,
  clientName,
  brandId,
  primaryContactName,
  onSent,
}: Props) {
  const [drafts, setDrafts] = useState<SendableDraft[]>([]);
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [stage, setStage] = useState<'pick' | 'message'>('pick');
  const [reviewUrl, setReviewUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!open || brandId == null) return;
    setLoading(true);
    setStage('pick');
    setError(null);
    setReviewUrl(null);
    getDrafts(brandId)
      .then((all) => {
        const sendable = (all as SendableDraft[]).filter(
          (d) => d.status === 'draft' || d.status === 'changes_requested',
        );
        setDrafts(sendable);
        setPicked(new Set(sendable.map((d) => d.id)));
      })
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load drafts'))
      .finally(() => setLoading(false));
  }, [open, brandId]);

  const toggle = (id: number) => {
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const submit = async () => {
    if (picked.size === 0) return;
    setSending(true);
    setError(null);
    try {
      // Transition each picked draft to awaiting_client
      for (const id of picked) {
        await agencyUpdateDraftStatus(id, 'awaiting_client');
      }
      // Ensure a review link exists; generate if missing
      let link = await agencyGetReviewLink(clientId);
      if (!link) {
        link = await agencyRotateReviewLink(clientId);
      }
      setReviewUrl(link.url);
      onSent();
      setStage('message');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to send drafts');
    } finally {
      setSending(false);
    }
  };

  const messageText = reviewUrl
    ? sendDraftsMessageText(primaryContactName, picked.size, reviewUrl)
    : '';

  const copyMessage = () => {
    navigator.clipboard.writeText(messageText);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/60" />
        <Dialog.Content className="fixed left-1/2 top-1/2 w-[min(90vw,640px)] max-h-[85vh] -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-lg border border-[var(--border-default)] bg-[var(--bg-raised)] text-[var(--text-primary)] shadow-lg">
          <div className="flex items-start justify-between border-b border-[var(--border-subtle)] p-5">
            <Dialog.Title className="text-base font-semibold">
              {stage === 'pick' ? `Send drafts to ${clientName} for review` : 'Drafts sent — now message your client'}
            </Dialog.Title>
            <Dialog.Close asChild>
              <button className="rounded-md border border-[var(--border-default)] p-2 hover:bg-[var(--bg-card)]">
                <X className="h-4 w-4" />
              </button>
            </Dialog.Close>
          </div>

          <div className="max-h-[60vh] overflow-y-auto p-5">
            {error && <p className="mb-3 text-sm text-red-400">{error}</p>}

            {stage === 'pick' && (
              <>
                {loading && <p className="text-sm text-[var(--text-muted)]">Loading drafts…</p>}
                {!loading && drafts.length === 0 && (
                  <p className="text-sm text-[var(--text-muted)]">
                    No drafts in &ldquo;Drafting&rdquo; status. Generate some content first.
                  </p>
                )}
                {!loading && drafts.length > 0 && (
                  <ul className="space-y-2">
                    {drafts.map((d) => (
                      <li
                        key={d.id}
                        className="flex items-start gap-3 rounded-md border border-[var(--border-subtle)] bg-[var(--bg-card)] p-3 text-sm"
                      >
                        <input
                          type="checkbox"
                          checked={picked.has(d.id)}
                          onChange={() => toggle(d.id)}
                          className="mt-1"
                        />
                        <div className="flex-1 min-w-0">
                          <div className="font-medium">{d.title || `Draft #${d.id}`}</div>
                          <div className="text-xs text-[var(--text-muted)]">
                            {d.platform} · {d.status === 'changes_requested' ? 'changes requested' : 'draft'}
                          </div>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </>
            )}

            {stage === 'message' && reviewUrl && (
              <div className="space-y-3">
                <p className="text-sm text-[var(--text-secondary)]">
                  {picked.size} draft{picked.size === 1 ? '' : 's'} moved to client review. Copy this
                  message and paste it into Slack / email:
                </p>
                <textarea
                  readOnly
                  value={messageText}
                  rows={9}
                  className="w-full rounded-md border border-[var(--border-default)] bg-[var(--bg-card)] p-3 font-mono text-xs text-[var(--text-primary)]"
                />
              </div>
            )}
          </div>

          <div className="flex items-center justify-end gap-2 border-t border-[var(--border-subtle)] p-4">
            {stage === 'pick' && (
              <>
                <Dialog.Close asChild>
                  <button className="rounded-md border border-[var(--border-default)] px-3 py-1.5 text-xs text-[var(--text-secondary)]">
                    Cancel
                  </button>
                </Dialog.Close>
                <button
                  onClick={submit}
                  disabled={sending || picked.size === 0}
                  className="flex items-center gap-2 rounded-md bg-[var(--bg-elevated)] px-3 py-1.5 text-xs font-medium text-[var(--text-primary)] hover:bg-[var(--bg-card)] disabled:opacity-50"
                >
                  <Send className="h-3 w-3" />
                  {sending ? 'Sending…' : `Send ${picked.size} draft${picked.size === 1 ? '' : 's'}`}
                </button>
              </>
            )}
            {stage === 'message' && (
              <>
                <a
                  href={reviewUrl ?? '#'}
                  target="_blank"
                  rel="noreferrer"
                  className="rounded-md border border-[var(--border-default)] px-3 py-1.5 text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-card)]"
                >
                  Open review page
                </a>
                <button
                  onClick={copyMessage}
                  className="flex items-center gap-1 rounded-md bg-[var(--bg-elevated)] px-3 py-1.5 text-xs font-medium text-[var(--text-primary)] hover:bg-[var(--bg-card)]"
                >
                  <Copy className="h-3 w-3" />
                  {copied ? 'Copied!' : 'Copy message'}
                </button>
                <Dialog.Close asChild>
                  <button className="rounded-md border border-[var(--border-default)] px-3 py-1.5 text-xs text-[var(--text-secondary)]">
                    Done
                  </button>
                </Dialog.Close>
              </>
            )}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
```

- [ ] **Step 2: TS check**

```bash
cd /Users/ken/Desktop/Lumidian/frontend
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add frontend/components/agency/SendDraftsToClientModal.tsx
git commit -m "feat(agency): batch SendDraftsToClient modal with pre-filled message"
```

---

## Task 7: ClientQuickActionsRail

**Files:**
- Create: `frontend/components/agency/ClientQuickActionsRail.tsx`

This component renders the sticky right rail on the cockpit page. It composes existing pieces (review link, generate doc) and triggers the SendDraftsToClientModal.

- [ ] **Step 1: Create the component**

```tsx
'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  agencyListActivity,
  type ActivityEvent,
  type AgencyClient,
  type AgencyDocument,
} from '@/lib/api';
import { GenerateDocumentButton } from './GenerateDocumentButton';
import { ReviewLinkSection } from './ReviewLinkSection';
import { SendDraftsToClientModal } from './SendDraftsToClientModal';
import { iconForEventType } from './activity-icons';

interface Props {
  client: AgencyClient;
  onDocumentGenerated: (doc: AgencyDocument) => void;
  onDraftsSent: () => void;
}

const CLIENT_EVENT_TYPES = new Set([
  'client_approved',
  'client_changes_requested',
  'client_rejected',
]);

function timeAgo(iso: string): string {
  const normalized = /[Zz]|[+-]\d{2}:?\d{2}$/.test(iso) ? iso : iso + 'Z';
  const diff = (Date.now() - new Date(normalized).getTime()) / 1000;
  if (diff < 0) return 'just now';
  if (diff < 60) return `${Math.floor(diff)}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

export function ClientQuickActionsRail({ client, onDocumentGenerated, onDraftsSent }: Props) {
  const [sendOpen, setSendOpen] = useState(false);
  const [recent, setRecent] = useState<ActivityEvent[]>([]);

  useEffect(() => {
    agencyListActivity(client.id, { limit: 30 })
      .then((events) => {
        setRecent(events.filter((e) => CLIENT_EVENT_TYPES.has(e.event_type)).slice(0, 5));
      })
      .catch(() => setRecent([]));
  }, [client.id]);

  return (
    <aside className="sticky top-6 space-y-4 self-start">
      <ReviewLinkSection clientId={client.id} />

      <section className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-card)] p-5">
        <h3 className="mb-3 text-sm font-medium text-[var(--text-secondary)]">Quick actions</h3>
        <div className="space-y-2">
          <button
            onClick={() => setSendOpen(true)}
            className="w-full rounded-md bg-[var(--bg-elevated)] px-3 py-2 text-sm font-medium text-[var(--text-primary)] hover:bg-[var(--bg-card)]"
          >
            Send drafts to client review
          </button>
          <GenerateDocumentButton clientId={client.id} onGenerated={onDocumentGenerated} />
        </div>
      </section>

      <section className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-card)] p-5">
        <h3 className="mb-3 text-sm font-medium text-[var(--text-secondary)]">Recent client actions</h3>
        {recent.length === 0 && (
          <p className="text-sm text-[var(--text-muted)]">No client actions yet.</p>
        )}
        <ul className="space-y-2">
          {recent.map((e) => {
            const Icon = iconForEventType(e.event_type);
            return (
              <li key={e.id} className="flex items-start gap-2 text-xs">
                <div className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-[var(--bg-raised)] text-[var(--text-secondary)]">
                  <Icon width={11} height={11} />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-[var(--text-primary)]">{e.body}</p>
                  <p className="text-[var(--text-muted)]">{timeAgo(e.created_at)}</p>
                </div>
              </li>
            );
          })}
        </ul>
      </section>

      <SendDraftsToClientModal
        open={sendOpen}
        onOpenChange={setSendOpen}
        clientId={client.id}
        clientName={client.name}
        brandId={client.brand_id}
        primaryContactName={client.primary_contact_name}
        onSent={onDraftsSent}
      />
    </aside>
  );
}
```

- [ ] **Step 2: TS check**

```bash
cd /Users/ken/Desktop/Lumidian/frontend
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add frontend/components/agency/ClientQuickActionsRail.tsx
git commit -m "feat(agency): ClientQuickActionsRail (review link + send drafts + generate doc + recent actions)"
```

---

## Task 8: ClientCockpit + replace client detail page

**Files:**
- Create: `frontend/components/agency/ClientCockpit.tsx`
- Modify: `frontend/app/agency/clients/[id]/page.tsx`

- [ ] **Step 1: Create `ClientCockpit.tsx`**

```tsx
'use client';

import { useState } from 'react';
import Link from 'next/link';
import {
  agencyUpdateClient,
  type AgencyClient,
  type AgencyDocument,
} from '@/lib/api';
import { ActivityFeed } from './ActivityFeed';
import { ClientBrandTab } from './ClientBrandTab';
import { ClientPipelineTab } from './ClientPipelineTab';
import { ClientQuickActionsRail } from './ClientQuickActionsRail';
import { DocumentList } from './DocumentList';
import { LumidianTrackingWidget } from './LumidianTrackingWidget';
import { TaskList } from './TaskList';

interface Props {
  client: AgencyClient;
  onChange: (next: AgencyClient) => void;
  reviewLinkUrl: string | null;
}

const STATUSES: AgencyClient['status'][] = ['onboarding', 'active', 'paused', 'churned'];

const SECTIONS = [
  { id: 'tracking', label: 'Tracking' },
  { id: 'pipeline', label: 'Pipeline' },
  { id: 'brand', label: 'Brand' },
  { id: 'documents', label: 'Documents' },
  { id: 'tasks', label: 'Tasks' },
  { id: 'activity', label: 'Activity' },
];

export function ClientCockpit({ client, onChange, reviewLinkUrl }: Props) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [justGeneratedDoc, setJustGeneratedDoc] = useState<AgencyDocument | null>(null);
  const [pipelineRefreshKey, setPipelineRefreshKey] = useState(0);

  const updateStatus = async (status: AgencyClient['status']) => {
    setSaving(true);
    setError(null);
    try {
      const next = await agencyUpdateClient(client.id, { status });
      onChange(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="p-8 text-[var(--text-primary)]">
      <Link href="/agency/clients" className="text-xs text-[var(--text-muted)] hover:underline">
        ← All clients
      </Link>
      <h1 className="mt-2 text-2xl font-semibold tracking-tight">{client.name}</h1>
      <p className="text-sm text-[var(--text-muted)]">/{client.slug}</p>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <span className="text-xs text-[var(--text-muted)]">Status:</span>
        {STATUSES.map((s) => (
          <button
            key={s}
            onClick={() => updateStatus(s)}
            disabled={saving || client.status === s}
            className={`rounded-md border px-3 py-1 text-xs ${
              client.status === s
                ? 'border-[var(--border-strong)] bg-[var(--bg-elevated)] text-[var(--text-primary)]'
                : 'border-[var(--border-default)] bg-[var(--bg-card)] text-[var(--text-secondary)] hover:bg-[var(--bg-raised)]'
            }`}
          >
            {s}
          </button>
        ))}
        <span className="ml-auto text-xs text-[var(--text-muted)]">
          {client.retainer_amount_usd ? `$${client.retainer_amount_usd}/mo` : 'No retainer'}
          {client.primary_contact_name && ` · ${client.primary_contact_name}`}
          {client.primary_contact_email && ` · ${client.primary_contact_email}`}
        </span>
      </div>

      {error && <p className="mt-3 text-sm text-red-400">{error}</p>}

      <nav className="mt-6 sticky top-0 z-10 -mx-8 border-y border-[var(--border-subtle)] bg-[var(--bg-base)] px-8 py-2">
        <ul className="flex gap-4 text-xs">
          {SECTIONS.map((s) => (
            <li key={s.id}>
              <a
                href={`#${s.id}`}
                className="text-[var(--text-muted)] hover:text-[var(--text-primary)]"
              >
                {s.label}
              </a>
            </li>
          ))}
        </ul>
      </nav>

      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-[1fr_320px]">
        <div className="space-y-8 min-w-0">
          <section id="tracking" className="scroll-mt-24">
            <h2 className="mb-3 text-sm font-medium text-[var(--text-secondary)]">Tracking</h2>
            <LumidianTrackingWidget brandId={client.brand_id} />
          </section>

          <section id="pipeline" className="scroll-mt-24">
            <h2 className="mb-3 text-sm font-medium text-[var(--text-secondary)]">Pipeline</h2>
            <ClientPipelineTab
              key={pipelineRefreshKey}
              brandId={client.brand_id}
              reviewLinkUrl={reviewLinkUrl}
              primaryContactName={client.primary_contact_name}
            />
          </section>

          <section id="brand" className="scroll-mt-24">
            <h2 className="mb-3 text-sm font-medium text-[var(--text-secondary)]">Brand & prompts</h2>
            <ClientBrandTab brandId={client.brand_id} />
          </section>

          <section id="documents" className="scroll-mt-24">
            <h2 className="mb-3 text-sm font-medium text-[var(--text-secondary)]">Documents</h2>
            <DocumentList clientId={client.id} injectDoc={justGeneratedDoc} />
          </section>

          <section id="tasks" className="scroll-mt-24">
            <TaskList clientId={client.id} />
          </section>

          <section id="activity" className="scroll-mt-24">
            <ActivityFeed clientId={client.id} />
          </section>
        </div>

        <ClientQuickActionsRail
          client={client}
          onDocumentGenerated={setJustGeneratedDoc}
          onDraftsSent={() => setPipelineRefreshKey((k) => k + 1)}
        />
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Replace `frontend/app/agency/clients/[id]/page.tsx`**

```tsx
'use client';

import { use, useEffect, useState } from 'react';
import { agencyGetClient, agencyGetReviewLink, type AgencyClient } from '@/lib/api';
import { ClientCockpit } from '@/components/agency/ClientCockpit';

export default function AgencyClientDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const clientId = parseInt(id, 10);
  const [client, setClient] = useState<AgencyClient | null>(null);
  const [reviewLinkUrl, setReviewLinkUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    agencyGetClient(clientId).then(setClient).catch((e) => setError(String(e?.message ?? e)));
    agencyGetReviewLink(clientId)
      .then((link) => setReviewLinkUrl(link?.url ?? null))
      .catch(() => setReviewLinkUrl(null));
  }, [clientId]);

  if (error) return <div className="p-8 text-sm text-red-400">{error}</div>;
  if (!client) {
    return <div className="p-8 text-sm text-[var(--text-muted)]">Loading…</div>;
  }

  return <ClientCockpit client={client} onChange={setClient} reviewLinkUrl={reviewLinkUrl} />;
}
```

- [ ] **Step 3: Delete now-unused tab wrapper files**

```bash
rm /Users/ken/Desktop/Lumidian/frontend/components/agency/ClientOverviewTab.tsx
rm /Users/ken/Desktop/Lumidian/frontend/components/agency/ClientStrategyTab.tsx
rm /Users/ken/Desktop/Lumidian/frontend/components/agency/ClientContentTab.tsx
rm /Users/ken/Desktop/Lumidian/frontend/components/agency/ClientReportsTab.tsx
```

- [ ] **Step 4: TS check + clear .next**

```bash
cd /Users/ken/Desktop/Lumidian/frontend
rm -rf .next
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add frontend/components/agency/ClientCockpit.tsx frontend/app/agency/clients/[id]/page.tsx frontend/components/agency/ClientOverviewTab.tsx frontend/components/agency/ClientStrategyTab.tsx frontend/components/agency/ClientContentTab.tsx frontend/components/agency/ClientReportsTab.tsx
git commit -m "feat(agency): single-cockpit client page + delete unused tab wrappers"
```

---

## Task 9: Today screen redesign

**Files:**
- Modify: `frontend/app/agency/page.tsx`

- [ ] **Step 1: Replace the file**

```tsx
'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  agencyGetReviewLink,
  agencyToday,
  type AgencyTodayDraft,
  type AgencyTodayResponse,
  type ReviewLinkOut,
} from '@/lib/api';
import { MyQueueSection } from '@/components/agency/MyQueueSection';
import { NudgePill } from '@/components/agency/NudgePill';
import { isDraftStale, nudgeMessageText } from '@/components/agency/agency-helpers';

interface DraftRowProps {
  draft: AgencyTodayDraft;
  showNudge?: boolean;
  nudgeMessageByClient: Map<number, string>;
}

function DraftRow({ draft, showNudge, nudgeMessageByClient }: DraftRowProps) {
  const msg = nudgeMessageByClient.get(draft.client_id);
  const stale = showNudge && isDraftStale(draft) && !!msg;
  return (
    <li className="rounded-md border border-[var(--border-subtle)] bg-[var(--bg-raised)] p-3 text-sm">
      <div className="flex items-start justify-between gap-2">
        <div className="font-medium">{draft.title || `Draft #${draft.draft_id}`}</div>
        {stale && msg && <NudgePill message={msg} />}
      </div>
      <div className="mt-1 text-xs text-[var(--text-muted)]">
        <Link href={`/agency/clients/${draft.client_id}`} className="hover:underline">
          {draft.client_name}
        </Link>{' '}
        · {draft.platform}
      </div>
    </li>
  );
}

function DraftList({
  drafts,
  emptyText,
  showNudge,
  nudgeMessageByClient,
}: {
  drafts: AgencyTodayDraft[];
  emptyText: string;
  showNudge?: boolean;
  nudgeMessageByClient: Map<number, string>;
}) {
  if (drafts.length === 0) {
    return <p className="text-sm text-[var(--text-muted)]">{emptyText}</p>;
  }
  return (
    <ul className="space-y-2">
      {drafts.slice(0, 10).map((d) => (
        <DraftRow
          key={d.draft_id}
          draft={d}
          showNudge={showNudge}
          nudgeMessageByClient={nudgeMessageByClient}
        />
      ))}
    </ul>
  );
}

export default function AgencyTodayPage() {
  const [data, setData] = useState<AgencyTodayResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [nudgeMessageByClient, setNudgeMessageByClient] = useState<Map<number, string>>(new Map());

  useEffect(() => {
    agencyToday()
      .then(async (resp) => {
        setData(resp);
        // For any client that has awaiting-client drafts, fetch the review link to build a nudge msg.
        const clientIds = Array.from(
          new Set((resp.awaiting_client ?? []).map((d) => d.client_id)),
        );
        const map = new Map<number, string>();
        const linkResults = await Promise.allSettled(clientIds.map((id) => agencyGetReviewLink(id)));
        clientIds.forEach((id, i) => {
          const r = linkResults[i];
          if (r.status === 'fulfilled' && r.value) {
            const link: ReviewLinkOut = r.value;
            map.set(id, nudgeMessageText(null, link.url));
          }
        });
        setNudgeMessageByClient(map);
      })
      .catch((e) => setError(String(e?.message ?? e)));
  }, []);

  if (error) return <div className="p-8 text-sm text-red-400">{error}</div>;
  if (!data) return <div className="p-8 text-sm text-[var(--text-muted)]">Loading…</div>;

  const totalAttention =
    data.drafts_to_review_count + (data.awaiting_client?.length ?? 0) + (data.approved?.length ?? 0);

  return (
    <div className="p-8 text-[var(--text-primary)]">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Today</h1>
        <p className="text-sm text-[var(--text-muted)]">
          {data.active_clients} active client{data.active_clients === 1 ? '' : 's'} ·{' '}
          {totalAttention} draft{totalAttention === 1 ? '' : 's'} in flight
        </p>
      </div>

      <MyQueueSection />

      <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
        <section className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-card)] p-5">
          <h2 className="mb-3 text-sm font-medium text-[var(--text-secondary)]">
            Awaiting your review ({data.drafts_to_review_count})
          </h2>
          <DraftList
            drafts={data.drafts_to_review}
            emptyText="Nothing to work on right now."
            nudgeMessageByClient={nudgeMessageByClient}
          />
        </section>

        <section className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-card)] p-5">
          <h2 className="mb-3 text-sm font-medium text-[var(--text-secondary)]">
            With client ({data.awaiting_client?.length ?? 0})
          </h2>
          <DraftList
            drafts={data.awaiting_client ?? []}
            emptyText="Nothing waiting on the client."
            showNudge
            nudgeMessageByClient={nudgeMessageByClient}
          />
        </section>

        <section className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-card)] p-5">
          <h2 className="mb-3 text-sm font-medium text-[var(--text-secondary)]">
            Ready to post ({data.approved?.length ?? 0})
          </h2>
          <DraftList
            drafts={data.approved ?? []}
            emptyText="Nothing approved yet."
            nudgeMessageByClient={nudgeMessageByClient}
          />
        </section>
      </div>
    </div>
  );
}
```

The `RecentActivitySection` import is intentionally removed (it's gone from Today).

- [ ] **Step 2: TS check**

```bash
cd /Users/ken/Desktop/Lumidian/frontend
npx tsc --noEmit
```

Expected: no errors. Note: `AgencyTodayDraft` doesn't currently have `updated_at` — the `isDraftStale` helper falls back to `created_at` which is present, so this still works.

- [ ] **Step 3: Commit**

```bash
git add frontend/app/agency/page.tsx
git commit -m "feat(agency): Today drops Recent Activity, adds Nudge pill on With-client items"
```

---

## Task 10: Global Documents — generate from any client

**Files:**
- Create: `frontend/components/agency/GenerateForAnyClientModal.tsx`
- Modify: `frontend/app/agency/documents/page.tsx`

- [ ] **Step 1: Create the modal**

```tsx
'use client';

import { useEffect, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { Loader2, X } from 'lucide-react';
import {
  agencyGenerateDocument,
  agencyListClients,
  agencyListDocumentTemplates,
  type AgencyClient,
  type AgencyDocument,
  type DocumentTemplate,
} from '@/lib/api';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onGenerated: (doc: AgencyDocument) => void;
}

export function GenerateForAnyClientModal({ open, onOpenChange, onGenerated }: Props) {
  const [clients, setClients] = useState<AgencyClient[]>([]);
  const [templates, setTemplates] = useState<DocumentTemplate[]>([]);
  const [clientId, setClientId] = useState<number | ''>('');
  const [kind, setKind] = useState<string>('');
  const [filter, setFilter] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setError(null);
    Promise.all([agencyListClients(), agencyListDocumentTemplates()])
      .then(([cs, ts]) => {
        setClients(cs);
        setTemplates(ts);
      })
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load'));
  }, [open]);

  const filteredClients = clients.filter(
    (c) =>
      !filter ||
      c.name.toLowerCase().includes(filter.toLowerCase()) ||
      c.slug.toLowerCase().includes(filter.toLowerCase()),
  );

  const submit = async () => {
    if (clientId === '' || !kind) return;
    setBusy(true);
    setError(null);
    try {
      const doc = await agencyGenerateDocument(clientId, kind);
      onGenerated(doc);
      onOpenChange(false);
      setClientId('');
      setKind('');
      setFilter('');
    } catch (e) {
      const status = (e as { response?: { status?: number } })?.response?.status;
      if (status === 503) {
        setError('LLM unavailable. Check that ANTHROPIC_API_KEY is set on the backend.');
      } else {
        setError(e instanceof Error ? e.message : 'Generation failed');
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/60" />
        <Dialog.Content className="fixed left-1/2 top-1/2 w-[min(90vw,560px)] -translate-x-1/2 -translate-y-1/2 rounded-lg border border-[var(--border-default)] bg-[var(--bg-raised)] text-[var(--text-primary)] shadow-lg">
          <div className="flex items-start justify-between border-b border-[var(--border-subtle)] p-5">
            <Dialog.Title className="text-base font-semibold">Generate document</Dialog.Title>
            <Dialog.Close asChild>
              <button className="rounded-md border border-[var(--border-default)] p-2 hover:bg-[var(--bg-card)]">
                <X className="h-4 w-4" />
              </button>
            </Dialog.Close>
          </div>

          <div className="space-y-4 p-5">
            <div>
              <label className="mb-1 block text-xs text-[var(--text-secondary)]">Client</label>
              <input
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                placeholder="Search clients…"
                className="mb-2 w-full rounded-md border border-[var(--border-default)] bg-[var(--bg-card)] px-3 py-2 text-sm"
              />
              <select
                value={clientId}
                onChange={(e) => setClientId(e.target.value === '' ? '' : parseInt(e.target.value, 10))}
                className="w-full rounded-md border border-[var(--border-default)] bg-[var(--bg-card)] px-3 py-2 text-sm"
              >
                <option value="">Pick a client…</option>
                {filteredClients.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} ({c.status})
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="mb-1 block text-xs text-[var(--text-secondary)]">Template</label>
              <select
                value={kind}
                onChange={(e) => setKind(e.target.value)}
                className="w-full rounded-md border border-[var(--border-default)] bg-[var(--bg-card)] px-3 py-2 text-sm"
              >
                <option value="">Pick a template…</option>
                {templates.map((t) => (
                  <option key={t.kind} value={t.kind}>
                    {t.name} — {t.description}
                  </option>
                ))}
              </select>
            </div>

            {error && <p className="text-sm text-red-400">{error}</p>}
          </div>

          <div className="flex items-center justify-end gap-2 border-t border-[var(--border-subtle)] p-4">
            <Dialog.Close asChild>
              <button className="rounded-md border border-[var(--border-default)] px-3 py-1.5 text-xs text-[var(--text-secondary)]">
                Cancel
              </button>
            </Dialog.Close>
            <button
              onClick={submit}
              disabled={busy || clientId === '' || !kind}
              className="flex items-center gap-2 rounded-md bg-[var(--bg-elevated)] px-3 py-1.5 text-xs font-medium text-[var(--text-primary)] hover:bg-[var(--bg-card)] disabled:opacity-50"
            >
              {busy && <Loader2 className="h-3 w-3 animate-spin" />}
              {busy ? 'Generating…' : 'Generate'}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
```

- [ ] **Step 2: Modify `frontend/app/agency/documents/page.tsx`**

Replace the entire file with:

```tsx
'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { FileText, Plus } from 'lucide-react';
import { agencyRecentDocuments, type AgencyDocumentWithClient } from '@/lib/api';
import { DocumentViewer } from '@/components/agency/DocumentViewer';
import { GenerateForAnyClientModal } from '@/components/agency/GenerateForAnyClientModal';

const KINDS = [
  { value: '', label: 'All kinds' },
  { value: 'audit_initial', label: 'Initial audit' },
  { value: 'sow', label: 'Statement of Work' },
  { value: 'monthly_report', label: 'Monthly report' },
  { value: 'kickoff_checklist', label: 'Kickoff checklist' },
];

export default function DocumentsPage() {
  const [docs, setDocs] = useState<AgencyDocumentWithClient[]>([]);
  const [kind, setKind] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeDoc, setActiveDoc] = useState<AgencyDocumentWithClient | null>(null);
  const [genOpen, setGenOpen] = useState(false);

  useEffect(() => {
    setLoading(true);
    agencyRecentDocuments(50, kind || undefined)
      .then(setDocs)
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load'))
      .finally(() => setLoading(false));
  }, [kind]);

  return (
    <div className="p-8 text-[var(--text-primary)]">
      <div className="mb-6 flex items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold tracking-tight">Documents</h1>
        <div className="flex items-center gap-2">
          <select
            value={kind}
            onChange={(e) => setKind(e.target.value)}
            className="rounded-md border border-[var(--border-default)] bg-[var(--bg-raised)] px-3 py-2 text-sm text-[var(--text-primary)]"
          >
            {KINDS.map((k) => (
              <option key={k.value} value={k.value}>
                {k.label}
              </option>
            ))}
          </select>
          <button
            onClick={() => setGenOpen(true)}
            className="flex items-center gap-2 rounded-md bg-[var(--bg-elevated)] px-3 py-2 text-sm font-medium text-[var(--text-primary)] hover:bg-[var(--bg-card)]"
          >
            <Plus className="h-4 w-4" />
            Generate document
          </button>
        </div>
      </div>

      {loading && <p className="text-sm text-[var(--text-muted)]">Loading…</p>}
      {error && <p className="text-sm text-red-400">{error}</p>}
      {!loading && docs.length === 0 && (
        <p className="text-sm text-[var(--text-muted)]">
          No documents yet. Click &ldquo;Generate document&rdquo; to create one.
        </p>
      )}

      <ul className="space-y-2">
        {docs.map((d) => (
          <li
            key={d.id}
            className="flex items-start gap-3 rounded-md border border-[var(--border-subtle)] bg-[var(--bg-card)] p-3 text-sm"
          >
            <FileText className="mt-0.5 h-4 w-4 text-[var(--text-secondary)]" />
            <div className="flex-1 min-w-0">
              <button
                onClick={() => setActiveDoc(d)}
                className="text-left font-medium text-[var(--text-primary)] hover:underline"
              >
                {d.title}
              </button>
              <div className="text-xs text-[var(--text-muted)]">
                {d.kind} ·{' '}
                <Link href={`/agency/clients/${d.client_id}`} className="hover:underline">
                  {d.client_name}
                </Link>{' '}
                ·{' '}
                {new Date(d.generated_at + (d.generated_at.endsWith('Z') ? '' : 'Z')).toLocaleString()}
              </div>
            </div>
          </li>
        ))}
      </ul>

      <DocumentViewer
        doc={activeDoc}
        onClose={() => setActiveDoc(null)}
        onChange={(next) => {
          setDocs((prev) => prev.map((d) => (d.id === next.id ? { ...d, ...next } : d)));
          setActiveDoc((prev) => (prev ? { ...prev, ...next } : null));
        }}
        onDelete={(id) => setDocs((prev) => prev.filter((d) => d.id !== id))}
      />

      <GenerateForAnyClientModal
        open={genOpen}
        onOpenChange={setGenOpen}
        onGenerated={(doc) => {
          // Re-fetch with current kind filter so the new doc appears
          agencyRecentDocuments(50, kind || undefined).then(setDocs);
          setActiveDoc(doc as AgencyDocumentWithClient);
        }}
      />
    </div>
  );
}
```

- [ ] **Step 3: TS check**

```bash
cd /Users/ken/Desktop/Lumidian/frontend
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add frontend/components/agency/GenerateForAnyClientModal.tsx frontend/app/agency/documents/page.tsx
git commit -m "feat(agency): global doc generation with client + template pickers"
```

---

## Task 11: End-to-end smoke

**Files:** None — manual verification.

- [ ] **Step 1: Start dev servers**

Terminal 1: `cd backend && source venv/bin/activate && uvicorn app.main:app --port 3001`
Terminal 2: `cd frontend && npm run dev -- -p 3002`

- [ ] **Step 2: Browser walkthrough**

1. Visit `http://localhost:3002/agency`. Outer Lumidian sidebar is HIDDEN. Only the agency sidebar renders.
2. Sidebar shows only Today / Clients / Documents (plus footer Lumidian app / Admin).
3. Today: "Your queue" at top + 3 columns (Awaiting your review / With client / Ready to post). No "Recent activity across clients" section.
4. Click Clients → click into a client. The page is the cockpit (no tabs). Sticky anchor strip at top (Tracking · Pipeline · Brand · Documents · Tasks · Activity).
5. Right rail: review link (Copy + Rotate), Send drafts to client review button, Generate document dropdown, Recent client actions.
6. Pipeline section: 3 columns (Drafting / With client / Done) with status sub-badges inside the cards.
7. New Client dialog: "Peec dashboard URL" field is gone.
8. If there are any drafts in `awaiting_client` status with old timestamps, a "Nudge?" pill renders. Click it → copies a nudge message.
9. Click "Send drafts to client review" on the rail → modal opens with checkbox list of `draft`/`changes_requested` items. Submit → modal flips to a "copy this message" view with textarea + Copy button + Open review page link.
10. After submit, the drafts move from Drafting → With client in the Pipeline (re-mounted via the key bump).
11. Click Generate document on the rail → existing per-client flow.
12. Visit `/agency/documents` → "Generate document" button at the top. Click → modal with client + template pickers. Pick + Generate → new doc appears in the list and opens in the viewer.

Stop servers.

---

## Self-Review Notes

- Spec §1 (single sidebar): Task 1 ✓
- Spec §1 (trim nav): Task 2 ✓
- Spec §2 (cockpit + rail): Tasks 7, 8 ✓
- Spec §3 (3-col Pipeline): Task 5 ✓
- Spec §4 (Today redesign): Task 9 ✓
- Spec §5 (Send drafts modal with pre-filled message): Task 6 ✓
- Spec §6 (global doc generation): Task 10 ✓
- Spec §7 (Peec scrub): Task 3 ✓
- Spec §8 (stale Nudge pill): Tasks 4, 5, 9 ✓
- Spec §9 (delete unused tab wrappers): Task 8 Step 3 ✓
- Spec §10 (no routing change): n/a ✓

Type consistency:
- `AgencyDraft` widening used in pipeline (Task 5) does NOT need to match SendDraftsToClientModal (Task 6), which casts inline. Both consume the same `getDrafts(brandId)` source; safe.
- `nudgeMessageText(contactName, url)` signature consistent between agency-helpers.ts (Task 4), Today (Task 9), Pipeline (Task 5).
- `sendDraftsMessageText(name, count, url)` only used in Task 6.

No placeholders. All code blocks complete. Ready to execute.
