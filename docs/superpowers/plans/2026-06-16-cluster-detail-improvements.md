# Cluster Detail Page Improvements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Polish the content cluster detail page — remove the dead "used by N" label, wire the empty Opportunities/Gap-analysis inputs, complete the brief editor (Stats + Tone notes), add a one-click "Save & regenerate" loop, and tidy the source panel.

**Architecture:** Almost entirely frontend (Next.js/React/TypeScript). All required backend endpoints, schemas, and frontend API client methods already exist — `getOpportunities`, `getContentGaps`, `editClusterBrief` (which already accepts `stats` + `tone_notes`), `regenerateClusterPieces`. We add two small read-only "input" components, edit two existing components (`BriefPanel`, `SourceSpinePanel`), and extend the cluster page's data load. Source provenance (the "why was this source included" label) is the **one** item needing backend work and is split out as an optional Task 2 with its own decision.

**Tech Stack:** Next.js 15 / React 18 / TypeScript (strict) / Tailwind. No frontend test harness exists in this repo (per CLAUDE.md, tests are backend-only), so frontend verification is `npm run build` + `npm run lint` + a manual smoke check on the dev server (frontend :3002, backend :3001).

---

## File Structure

| File | Change | Responsibility |
|------|--------|----------------|
| `frontend/components/content/cluster/SourceSpinePanel.tsx` | Modify | Drop "used by N"; dim zero-count tier chips |
| `frontend/components/content/cluster/BriefPanel.tsx` | Modify | Add Stats + Tone-notes edit fields; add "Save & regenerate"; header "Edit" affordance |
| `frontend/components/content/cluster/OpportunitiesInput.tsx` | Create | Compact read-only list of opportunities for this prompt |
| `frontend/components/content/cluster/GapInput.tsx` | Create | Compact read-only gap summary for this prompt |
| `frontend/app/content/[brandId]/cluster/[clusterId]/page.tsx` | Modify | Load opps + gaps, filter to this prompt, feed InputsZone; pass regenerate handler to BriefPanel |
| _(optional Task 2)_ `backend/app/models.py`, `backend/app/services/cluster_evidence.py`, `backend/app/routers/clusters.py`, `backend/app/schemas.py`, `frontend/lib/api.ts`, `SourceSpinePanel.tsx` | Modify | Per-source provenance (`kind`) field |

---

## Task 1: Tidy the Source panel (remove "used by N", dim empty tiers)

Implements spec item #1 ("we don't care about used by N" → remove it) and the frontend half of item #5.

**Files:**
- Modify: `frontend/components/content/cluster/SourceSpinePanel.tsx`

- [ ] **Step 1: Dim zero-count tier counters**

Replace the tier-count block (currently lines 42–52) so a tier with 0 sources renders muted instead of looking like a broken tab:

```tsx
      <div className="flex gap-3 text-xs text-slate-300">
        <TierCount label="T1" count={data.total_t1} activeColor="text-emerald-300" />
        <TierCount label="T2" count={data.total_t2} activeColor="text-sky-300" />
        <TierCount label="T3" count={data.total_t3} activeColor="text-slate-400" />
      </div>
```

Add this helper at the bottom of the file (after the main component's closing brace):

```tsx
function TierCount({
  label,
  count,
  activeColor,
}: {
  label: string;
  count: number;
  activeColor: string;
}) {
  const dim = count === 0;
  return (
    <span className={dim ? "opacity-40" : ""}>
      <span className={`font-semibold ${dim ? "text-slate-500" : activeColor}`}>{label}</span>{" "}
      {count}
    </span>
  );
}
```

- [ ] **Step 2: Remove the "used by N" label**

Delete this line from the source `<li>` (currently line 74):

```tsx
            <div className="text-xs text-slate-500 shrink-0">used by {s.times_cited}</div>
```

The row's `justify-between` no longer needs a right element; the source block already has `min-w-0` and will fill the row.

- [ ] **Step 3: Verify build + lint**

Run: `cd /Users/ken/Desktop/Lumidian/frontend && npm run lint && npm run build`
Expected: PASS, no new errors. (`times_cited` remains in the `ClusterSourceItem` type and API — only the UI label is removed. No type change needed.)

- [ ] **Step 4: Commit**

```bash
cd /Users/ken/Desktop/Lumidian
git add frontend/components/content/cluster/SourceSpinePanel.tsx
git commit -m "feat(cluster): drop dead 'used by N' label, dim empty source tiers"
```

---

## Task 2 (OPTIONAL — needs approval): Source provenance label

Implements the deeper half of spec item #5 — show **why** a source is in the pack (a real AI citation vs. a Serper search hit vs. brand-as-authority fallback). This is the **only** item touching the database/backend, and existing clusters won't show provenance until they're rebuilt. **Detailed steps will be written only if you approve this task** (see "Permission" section). Outline:

1. `backend/app/models.py` — add `kind: Mapped[str]` (`"citation" | "search" | "brand"`) to `ContentClusterSource`, default `"search"`.
2. `backend/app/database.py:run_migrations()` — append `ALTER TABLE content_cluster_sources ADD COLUMN kind ...` (append-only, never edit existing steps).
3. `backend/app/services/cluster_evidence.py` — set `kind` when persisting sources (the builder already distinguishes the three origins).
4. `backend/app/schemas.py` `ClusterSourceItem` + `frontend/lib/api.ts` `ClusterSourceItem` — add `kind`.
5. `backend/app/routers/clusters.py:cluster_sources` — pass `kind` through.
6. `SourceSpinePanel.tsx` — render a small chip ("cited" / "search" / "brand") where "used by N" used to sit.
7. `backend/tests/` — a pytest asserting a built pack persists `kind` correctly.

---

## Task 3: Complete the brief editor (Stats + Tone notes)

Implements spec item #3. The backend `EditBriefRequest` and frontend `editClusterBrief` already accept `stats` and `tone_notes` — this is purely surfacing them in the edit form. The read-only view already renders both (BriefPanel lines 128–144).

**Files:**
- Modify: `frontend/components/content/cluster/BriefPanel.tsx`

- [ ] **Step 1: Add edit state for stats + tone notes**

After the existing `narrative` state (line 24), add:

```tsx
  const [stats, setStats] = useState(
    (brief?.stats ?? []).map((s) => [s.label, s.value, s.source].join(" | ")).join("\n"),
  );
  const [toneNotes, setToneNotes] = useState(brief?.tone_notes ?? "");
```

- [ ] **Step 2: Include them in the save payload**

In `save()` (lines 42–53), extend the `editClusterBrief` argument with `stats` and `tone_notes`:

```tsx
      const updated = await editClusterBrief(brandId, clusterId, {
        positioning,
        key_claims: keyClaims.split("\n").map((s) => s.trim()).filter(Boolean),
        canonical_phrasings: phrasings.split("\n").map((s) => s.trim()).filter(Boolean),
        narrative_spine: narrative,
        stats: stats
          .split("\n")
          .map((l) => l.trim())
          .filter(Boolean)
          .map((l) => {
            const [label = "", value = "", source = ""] = l.split("|").map((p) => p.trim());
            return { label, value, source };
          }),
        tone_notes: toneNotes,
      });
```

- [ ] **Step 3: Add the edit fields to the form**

In the editing branch, after the Narrative spine `<Field>` (ends line 198) and before the buttons `<div className="flex gap-2">` (line 199), insert:

```tsx
              <Field label="Stats (one per line — label | value | source)">
                <textarea
                  value={stats}
                  onChange={(e) => {
                    setStats(e.target.value);
                    setDraftDirty(true);
                  }}
                  className="input font-mono text-xs"
                  rows={3}
                  placeholder="Conversion lift | 32% | internal benchmark 2026"
                />
              </Field>
              <Field label="Tone notes">
                <textarea
                  value={toneNotes}
                  onChange={(e) => {
                    setToneNotes(e.target.value);
                    setDraftDirty(true);
                  }}
                  className="input"
                  rows={2}
                />
              </Field>
```

- [ ] **Step 4: Sync stats + tone on version revert**

In the `BriefVersionHistory` `onRevert` callback (lines 221–228), add stats + tone so reverting populates them too:

```tsx
            onRevert={(b) => {
              setPositioning(b.positioning);
              setPhrasings((b.canonical_phrasings ?? []).join("\n"));
              setKeyClaims((b.key_claims ?? []).join("\n"));
              setNarrative(b.narrative_spine ?? "");
              setStats((b.stats ?? []).map((s) => [s.label, s.value, s.source].join(" | ")).join("\n"));
              setToneNotes(b.tone_notes ?? "");
              setDraftDirty(true);
              setEditing(true);
            }}
```

- [ ] **Step 5: Verify build + lint**

Run: `cd /Users/ken/Desktop/Lumidian/frontend && npm run lint && npm run build`
Expected: PASS. (`editClusterBrief`'s `Partial<Pick<...,'stats'|'tone_notes'|...>>` type already permits both fields.)

- [ ] **Step 6: Commit**

```bash
cd /Users/ken/Desktop/Lumidian
git add frontend/components/content/cluster/BriefPanel.tsx
git commit -m "feat(cluster): make Stats and Tone notes editable in the brief editor"
```

---

## Task 4: One-click "Save & regenerate" + discoverable edit

Implements spec item #4. Currently editing the brief and applying it to the posts are two separate, far-apart actions (Save in BriefPanel, then "Rewrite all posts" in the page header). Add a combined action, and make "Edit brief" reachable from the collapsed header.

**Files:**
- Modify: `frontend/components/content/cluster/BriefPanel.tsx`
- Modify: `frontend/app/content/[brandId]/cluster/[clusterId]/page.tsx`

- [ ] **Step 1: Add an optional regenerate prop to BriefPanel**

Extend `Props` (lines 9–16):

```tsx
interface Props {
  brandId: number;
  clusterId: number;
  brief: ContentBrief | null;
  /** Version pieces were generated from. Defaults to brief.version when omitted. */
  currentVersion?: number;
  onUpdated: (b: ContentBrief) => void;
  /** When provided, enables a "Save & regenerate" action that saves the brief then rewrites all posts. */
  onRegeneratePieces?: () => Promise<void>;
}
```

And destructure it (line 18):

```tsx
export function BriefPanel({ brandId, clusterId, brief, currentVersion, onUpdated, onRegeneratePieces }: Props) {
```

- [ ] **Step 2: Add a save-and-regenerate handler + a `regenerating` flag**

After the existing `saving` state (line 25) add:

```tsx
  const [regenerating, setRegenerating] = useState(false);
```

After `save()` (ends line 61) add:

```tsx
  async function saveAndRegenerate() {
    await save();
    if (!onRegeneratePieces) return;
    setRegenerating(true);
    try {
      await onRegeneratePieces();
    } finally {
      setRegenerating(false);
    }
  }
```

- [ ] **Step 3: Add the button in the editing action row**

In the editing branch button row (lines 199–214), add a third button after the Save button and before Cancel — only when the prop is present:

```tsx
                {onRegeneratePieces && (
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={saveAndRegenerate}
                    disabled={saving || regenerating}
                    title="Save the brief and immediately rewrite all 5 posts from it"
                  >
                    {regenerating ? "Regenerating…" : "Save & regenerate"}
                  </Button>
                )}
```

- [ ] **Step 4: Make "Edit brief" reachable from the collapsed header**

In the header button (lines 65–82), the whole row currently toggles expand. Add a right-aligned "Edit" text button next to the timestamp that expands AND enters edit mode in one click. Replace the closing of the header `<button>`'s right span (lines 79–81) region by moving the timestamp + new Edit control into a sibling. Concretely, change the header so it is a flex container with the expand toggle on the left and an Edit affordance on the right:

```tsx
      <div className="w-full px-5 py-3 flex items-center justify-between hover:bg-[var(--bg-card)]">
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="flex items-center gap-2 font-semibold text-[var(--text-primary)] text-left"
        >
          {expanded ? (
            <ChevronDown className="h-4 w-4 text-[var(--text-secondary)]" />
          ) : (
            <ChevronRight className="h-4 w-4 text-[var(--text-secondary)]" />
          )}
          Brief
          <span className="text-xs font-medium text-[var(--text-faint)]">v{brief.version}</span>
        </button>
        <div className="flex items-center gap-3">
          <span className="text-xs text-[var(--text-faint)] hidden sm:inline">
            Generated {new Date(brief.created_at).toLocaleString()}
          </span>
          <button
            type="button"
            onClick={() => {
              setExpanded(true);
              setEditing(true);
            }}
            className="text-xs font-medium text-[var(--accent,#60a5fa)] hover:underline"
          >
            Edit
          </button>
        </div>
      </div>
```

(This replaces the single `<button>` header at lines 65–82.)

- [ ] **Step 5: Pass the handler from the cluster page**

In `page.tsx`, the `<BriefPanel>` (lines 278–284) gains the prop. `onRegeneratePieces` already exists in the page (lines 143–151):

```tsx
        <BriefPanel
          brandId={brandId}
          clusterId={cluster.id}
          brief={cluster.brief}
          currentVersion={cluster.brief?.version}
          onUpdated={(b) => setCluster((c) => (c ? { ...c, brief: b } : c))}
          onRegeneratePieces={onRegeneratePieces}
        />
```

- [ ] **Step 6: Verify build + lint**

Run: `cd /Users/ken/Desktop/Lumidian/frontend && npm run lint && npm run build`
Expected: PASS. (Confirm `Button` supports `variant="secondary"`; if not, fall back to `variant="outline"`.)

- [ ] **Step 7: Commit**

```bash
cd /Users/ken/Desktop/Lumidian
git add frontend/components/content/cluster/BriefPanel.tsx "frontend/app/content/[brandId]/cluster/[clusterId]/page.tsx"
git commit -m "feat(cluster): add Save & regenerate and a discoverable Edit affordance to the brief"
```

---

## Task 5: Opportunities input

Implements half of spec item #2. Render the brand's opportunities scoped to this cluster's prompt as a compact, read-only list inside the existing InputsZone "Opportunities for this prompt" row. Read-only here on purpose — drafting/dismissing lives on the main `/content/[brandId]` Opportunities tab; this row is context, not an action surface.

**Files:**
- Create: `frontend/components/content/cluster/OpportunitiesInput.tsx`
- Modify: `frontend/app/content/[brandId]/cluster/[clusterId]/page.tsx`

- [ ] **Step 1: Create the OpportunitiesInput component**

```tsx
"use client";

import { ExternalLink } from "lucide-react";
import type { ContentOpportunity } from "@/lib/api";

/**
 * Read-only list of opportunities tied to a cluster's prompt, shown inside the
 * cluster InputsZone. Drafting/dismissing happens on the /content tab — this is
 * context only.
 */
export function OpportunitiesInput({ items }: { items: ContentOpportunity[] }) {
  return (
    <ul className="space-y-2">
      {items.map((o) => (
        <li key={o.id} className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-xs text-[var(--text-faint)] uppercase tracking-wide">
              <span>{o.platform}</span>
              {o.subreddit && <span>· r/{o.subreddit}</span>}
              <span>· {Math.round(o.relevance_score * 100)}% match</span>
            </div>
            <a
              href={o.thread_url}
              target="_blank"
              rel="noreferrer"
              className="block text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)] truncate"
            >
              {o.thread_title || o.thread_url}
            </a>
          </div>
          <a href={o.thread_url} target="_blank" rel="noreferrer" className="shrink-0 pt-0.5">
            <ExternalLink className="h-3.5 w-3.5 text-[var(--text-faint)] hover:text-[var(--text-secondary)]" />
          </a>
        </li>
      ))}
    </ul>
  );
}
```

- [ ] **Step 2: Verify build + lint** — `cd /Users/ken/Desktop/Lumidian/frontend && npm run lint && npm run build` → PASS (wired into the page in Task 7's integration; component compiles standalone as it's imported there).

> Note: this component is imported and rendered in Task 7. To keep each task independently buildable, Tasks 5 and 6 create the components and Task 7 wires both plus the data load in one page edit. Build after Task 7 is the meaningful gate.

- [ ] **Step 3: Commit**

```bash
cd /Users/ken/Desktop/Lumidian
git add frontend/components/content/cluster/OpportunitiesInput.tsx
git commit -m "feat(cluster): add OpportunitiesInput component for the Inputs zone"
```

---

## Task 6: Gap analysis input

Implements the other half of spec item #2. Render the `ContentGap` for this prompt as a compact summary in the InputsZone "Gap analysis" row.

**Files:**
- Create: `frontend/components/content/cluster/GapInput.tsx`

- [ ] **Step 1: Create the GapInput component**

```tsx
"use client";

import type { ContentGap } from "@/lib/api";

/**
 * Compact, read-only gap summary for a cluster's prompt, shown in the InputsZone.
 * Surfaces the gap score, current visibility, where the brand is missing, and
 * who is winning — the "why this cluster matters" context.
 */
export function GapInput({ items }: { items: ContentGap[] }) {
  return (
    <div className="space-y-3">
      {items.map((g) => {
        const topCompetitors = Object.entries(g.competitor_mentions ?? {})
          .sort((a, b) => b[1] - a[1])
          .slice(0, 3);
        return (
          <div key={g.id} className="space-y-1.5">
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
              <span>
                <span className="text-[var(--text-faint)]">Gap score</span>{" "}
                <span className="text-[var(--text-primary)] font-medium">
                  {g.gap_score.toFixed(1)}
                </span>
              </span>
              {g.prompt_visibility !== null && (
                <span>
                  <span className="text-[var(--text-faint)]">Visibility</span>{" "}
                  <span className="text-[var(--text-primary)] font-medium">
                    {Math.round(g.prompt_visibility)}%
                  </span>
                </span>
              )}
            </div>
            {g.platforms_lacking.length > 0 && (
              <div className="text-xs">
                <span className="text-[var(--text-faint)]">Missing on:</span>{" "}
                <span className="text-[var(--text-secondary)]">
                  {g.platforms_lacking.join(", ")}
                </span>
              </div>
            )}
            {topCompetitors.length > 0 && (
              <div className="text-xs">
                <span className="text-[var(--text-faint)]">Winning here:</span>{" "}
                <span className="text-[var(--text-secondary)]">
                  {topCompetitors.map(([name, n]) => `${name} (${n})`).join(", ")}
                </span>
              </div>
            )}
            {g.quora_questions.length > 0 && (
              <div className="text-xs text-[var(--text-faint)]">
                {g.quora_questions.length} related Quora question
                {g.quora_questions.length === 1 ? "" : "s"}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
cd /Users/ken/Desktop/Lumidian
git add frontend/components/content/cluster/GapInput.tsx
git commit -m "feat(cluster): add GapInput component for the Inputs zone"
```

---

## Task 7: Wire opportunities + gaps into the cluster page

Connects Tasks 5 & 6 to live data, filtered to this cluster's prompt.

**Files:**
- Modify: `frontend/app/content/[brandId]/cluster/[clusterId]/page.tsx`

- [ ] **Step 1: Extend imports**

Update the `@/lib/api` import (lines 12–20) to add the data functions and types, and import the two new components:

```tsx
import {
  getCluster,
  getContentGaps,
  getOpportunities,
  proposeClusterPillar,
  rebuildCluster,
  regenerateClusterPieces,
  type ContentClusterDetail,
  type ContentDraft,
  type ContentGap,
  type ContentOpportunity,
  type PillarCandidate,
} from "@/lib/api";
import { GapInput } from "@/components/content/cluster/GapInput";
import { OpportunitiesInput } from "@/components/content/cluster/OpportunitiesInput";
```

(Keep the existing `BriefPanel`, `InputsZone`, `PieceCard`, `PillarCard`, `SourceSpinePanel` imports.)

- [ ] **Step 2: Add state for opportunities + gaps**

After `const [candidate, setCandidate] = useState<PillarCandidate | null>(null);` (line 51):

```tsx
  const [opportunities, setOpportunities] = useState<ContentOpportunity[]>([]);
  const [gaps, setGaps] = useState<ContentGap[]>([]);
```

- [ ] **Step 3: Load them alongside the cluster, filtered to this prompt**

Replace the `load()` body (lines 57–67) so all four fetches run together and opps/gaps are filtered to this cluster's prompt (and dismissed opps dropped):

```tsx
    async function load() {
      const [c, cand, opps, gapList] = await Promise.all([
        getCluster(brandId, clusterId),
        proposeClusterPillar(brandId, clusterId).catch(() => null),
        getOpportunities(brandId).catch(() => [] as ContentOpportunity[]),
        getContentGaps(brandId).catch(() => [] as ContentGap[]),
      ]);
      if (!cancelled) {
        setCluster(c);
        setCandidate(cand);
        setOpportunities(
          opps.filter((o) => o.prompt_id === c.prompt_id && o.status !== "dismissed"),
        );
        setGaps(gapList.filter((g) => g.prompt_id === c.prompt_id));
        setLoading(false);
      }
    }
```

- [ ] **Step 4: Feed the InputsZone**

Replace the `<InputsZone>` `opportunities`/`gaps` props (lines 309–310) which are currently `undefined`:

```tsx
        opportunities={
          opportunities.length ? <OpportunitiesInput items={opportunities} /> : undefined
        }
        gaps={gaps.length ? <GapInput items={gaps} /> : undefined}
```

(When empty, `undefined` keeps the existing InputsZone "none" treatment — Row already handles that, InputsZone.tsx lines 59–61.)

- [ ] **Step 5: Verify build + lint**

Run: `cd /Users/ken/Desktop/Lumidian/frontend && npm run lint && npm run build`
Expected: PASS. This is the real gate for Tasks 5–7.

- [ ] **Step 6: Manual smoke check**

Start backend (`:3001`) and frontend (`:3002`), open a cluster whose prompt has opportunities and a gap. Confirm the Inputs rows now expand and show data, and rows with no data still read "none". (Per memory: backend 3001, frontend 3002 — never 8000.)

- [ ] **Step 7: Commit**

```bash
cd /Users/ken/Desktop/Lumidian
git add "frontend/app/content/[brandId]/cluster/[clusterId]/page.tsx"
git commit -m "feat(cluster): wire prompt-scoped opportunities and gap analysis into Inputs zone"
```

---

## Self-Review

**Spec coverage:**
- Item #1 (remove "used by N") → Task 1 ✅
- Item #2 (build out opportunities + gaps inputs) → Tasks 5, 6, 7 ✅
- Item #3 (brief editor Stats + Tone notes) → Task 3 ✅
- Item #4 (tighten edit→apply loop) → Task 4 ✅
- Item #5 (source panel polish) → dim zero tiers in Task 1 ✅; provenance label split into optional Task 2 ⚠️ (decision required)

**Type consistency:** `ContentOpportunity` (`relevance_score: number`, `subreddit: string|null`, `thread_title: string|null`, `status`, `prompt_id: number|null`), `ContentGap` (`competitor_mentions: Record<string,number>`, `platforms_lacking: string[]`, `quora_questions: QuoraQuestion[]`, `prompt_visibility: number|null`, `gap_score: number`) all match `lib/api.ts`. `editClusterBrief`'s `Partial<Pick<ContentBrief,'stats'|'tone_notes'|...>>` already allows the Task 3 fields. `onRegeneratePieces` matches the page's existing `() => Promise<void>` handler.

**Placeholder scan:** No TBD/TODO/"handle edge cases" — every code step is concrete.

**Risks I'd flag if I were Ken:**
1. **No frontend tests** — this is real. The plan can't write failing-test-first for React here; verification leans on `npm run build`/`lint` + a manual check. That's the honest ceiling given the repo.
2. **`variant="secondary"`** on the Save & regenerate button may not exist on the `Button` component — Step 4.6 says fall back to `outline`. Cheap to confirm during implementation.
3. **Header restructure in Task 4 Step 4** is the fiddliest edit (replacing a `<button>` with a flex `<div>` containing two buttons). Low risk but worth eyeballing the rendered header.
4. **Task 2 (provenance) is the only DB/backend change** and the only one with a migration + a "won't show on old clusters until rebuilt" caveat. It's genuinely optional; the dim-tiers change already delivers most of item #5's value.

---

## Decision required before implementation

Spec item #5 has two parts. The cheap, high-value part (dim empty tiers + remove "used by N") is in Task 1 and I'd just do it. The deeper part — a per-source provenance label — needs a DB column + builder change + won't backfill existing clusters. **Do you want Task 2 (provenance) included, or should I ship Tasks 1, 3, 4, 5, 6, 7 and leave provenance out?**
